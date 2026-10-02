/* =============================================================================
 * site-tree-lines.js — 首页树状图（.site-tree）的连线层
 * -----------------------------------------------------------------------------
 * 为什么要单独一个脚本：
 *   连线原先由 custom.css 里一堆 ::before/::after 伪元素 + 写死的像素偏移画出来
 *   （18px「卡片半高」、40px「卡片半宽」、28/24/14px 各种间距…）。这些偏移量隐含
 *   「卡片恒为 36×80px」的假设，因此：字号档位一变、窗口缩放导致换行、或跨过
 *   768px 断点（只改了 --h，其余常量没跟着改）时，线必然与节点脱节。
 *
 * 现在的做法：
 *   DOM 只负责排版（flex），连线交给这一层绝对定位的 SVG；坐标在「节点真实位置」
 *   上现算，于是对字号变化、换行、折叠、缩放天然免疫。等价于 d3.tree 的渲染层，
 *   但不需要引入任何库 —— 本树的层级浅、无交叉，画正交折线就够了。
 *
 * 重算触发（都是低频事件，不监听 scroll、不做逐帧动画）：
 *   · ResizeObserver 观察 .site-tree（容器尺寸变化：缩放、字号档位、内容增减）
 *   · .site-tree 上的 toggle（details 折叠；toggle 不冒泡，故用捕获阶段）
 *   · window resize / load、document.fonts.ready（字体度量变化）
 * 每次重算先比对「容器尺寸 + 折叠态」签名，没变直接返回；变了才在
 * requestAnimationFrame 里先批量读完所有矩形、再一次性写 SVG（无 layout thrashing）。
 *
 * 线型规则（与 CSS 的排布一一对应，方向由面板的 flex-direction 决定）：
 *   · 子节点【横排】：面板上方一条水平干线，干线向下短垂线接到每个子卡片上边中点；
 *                    换行时多行各有一条干线，最左用一条竖直轨道串起来。
 *   · 子节点【竖排】（父在左、子在右）：父卡片右缘一条竖直轨道，横向短接线连到
 *                    每个子卡片左边中点。
 *   · 顶层总干线：竖直线把所有顶层板块的分叉串起来；单页行没有父节点，干线从总干线
 *                 底部绕过去、在卡片下方接住每个单页卡。
 *
 * 无 JS 时只是不画线（节点仍可正常点击）；非首页命中不到 .site-tree，脚本直接退出。
 * ========================================================================== */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var HOST = ".site-tree";
  var ROW_TOL = 4; // 判定「同一可视行」的纵向容差（px）

  /** 启动：脚本放在 index.pug 的正文里，正常情况下 DOM 已就绪；保险起见兜一层。 */
  function start() {
    var host = document.querySelector(HOST);
    if (host) init(host);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  function init(host) {
    /* 幂等：pjax 之类场景下脚本可能被重复执行，先清掉旧的连线层 */
    var stale = host.querySelector(".site-tree-lines");
    if (stale) stale.parentNode.removeChild(stale);

    /* ── SVG 覆盖层：整棵树只用一个 <path>，重算时整体替换 d ────────────── */
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "site-tree-lines");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(NS, "path");
    svg.appendChild(path);
    host.insertBefore(svg, host.firstChild);

    var raf = 0; // rAF 句柄：同一帧内多次触发只画一次
    var sig = ""; // 上次绘制时的「容器尺寸 + 折叠态」签名

    /* 当前这一帧的绘图上下文（paint 里赋值，供下方工具函数复用） */
    var origin = { x: 0, y: 0 }; // 坐标原点 = SVG 自己的框左上角
    var parts = []; // 折线段集合，最后统一拼成一条 path 的 d
    var bus = 24; // 水平干线到节点卡片的垂直距离（读 CSS 变量 --bus-gap）
    var drop = 24; // 单页行干线到卡片的垂直距离（读 CSS 变量 --drop-gap）
    var corner = 6; // 折线拐角半径（读 CSS 变量 --tree-corner）

    /* ── DOM / 数值小工具 ─────────────────────────────────────────────── */
    function num(value, fallback) {
      var n = parseFloat(value);
      return isFinite(n) ? n : fallback;
    }
    function kids(el, test) {
      return Array.prototype.filter.call(el.children, test);
    }
    function isTag(name) {
      return function (n) {
        return n.tagName === name;
      };
    }
    function shown(el) {
      return !!el && el.getClientRects().length > 0; // display:none（折叠的 details）→ false
    }

    /** 取「节点单元」里的卡片元素：a / summary，或 li > details > summary。 */
    function cardOf(el) {
      if (!el) return null;
      if (el.tagName === "A" || el.tagName === "SUMMARY") return el;
      var details = kids(el, isTag("DETAILS"))[0];
      if (details) return kids(details, isTag("SUMMARY"))[0] || null;
      return kids(el, isTag("A"))[0] || null;
    }

    /** 卡片所属的子面板：details > ul，或 li 里的 ul / .h-row。 */
    function panelOf(card) {
      var holder = card && card.parentElement;
      if (!holder) return null;
      return (
        kids(holder, function (n) {
          return n.tagName === "UL" || n.classList.contains("h-row");
        })[0] || null
      );
    }

    /** 元素相对 SVG 原点的几何（l/t/r/b 四边 + cx/cy 中心）。 */
    function rectOf(el) {
      var r = el.getBoundingClientRect();
      return {
        l: r.left - origin.x,
        t: r.top - origin.y,
        r: r.right - origin.x,
        b: r.bottom - origin.y,
        cx: (r.left + r.right) / 2 - origin.x,
        cy: (r.top + r.bottom) / 2 - origin.y
      };
    }

    /** 按 top 把卡片分组成「可视行」——只有换行时才会出现多行。 */
    function groupRows(rects) {
      var rows = [];
      rects
        .slice()
        .sort(function (a, b) {
          return a.t - b.t || a.l - b.l;
        })
        .forEach(function (r) {
          var row = rows[rows.length - 1];
          if (row && Math.abs(row[0].t - r.t) <= ROW_TOL) row.push(r);
          else rows.push([r]);
        });
      return rows;
    }

    /* ── 折线 → 圆角 path ─────────────────────────────────────────────── */
    function fmt(v) {
      return Math.round(v * 10) / 10;
    }
    /** 把正交折线（点数组）转成带圆角的 path 片段；半径自动受相邻线段长度约束。 */
    function polylineD(pts) {
      if (pts.length < 2) return "";
      var d = "M" + fmt(pts[0].x) + " " + fmt(pts[0].y);
      for (var i = 1; i < pts.length - 1; i++) {
        var a = pts[i - 1];
        var b = pts[i];
        var c = pts[i + 1];
        var inLen = Math.hypot(b.x - a.x, b.y - a.y);
        var outLen = Math.hypot(c.x - b.x, c.y - b.y);
        var r = Math.min(corner, inLen / 2, outLen / 2);
        if (inLen < 0.5 || outLen < 0.5 || r < 0.5) {
          d += " L" + fmt(b.x) + " " + fmt(b.y);
          continue;
        }
        var p1 = { x: b.x + ((a.x - b.x) / inLen) * r, y: b.y + ((a.y - b.y) / inLen) * r };
        var p2 = { x: b.x + ((c.x - b.x) / outLen) * r, y: b.y + ((c.y - b.y) / outLen) * r };
        d += " L" + fmt(p1.x) + " " + fmt(p1.y) +
             " Q" + fmt(b.x) + " " + fmt(b.y) + " " + fmt(p2.x) + " " + fmt(p2.y);
      }
      var last = pts[pts.length - 1];
      return d + " L" + fmt(last.x) + " " + fmt(last.y);
    }

    /* 每帧收集线段：H 水平、V 竖直（都是 x1/x2 或 y1/y2 的形式，方向自动归一） */
    function H(x1, x2, y) {
      if (Math.abs(x2 - x1) < 0.5) return;
      parts.push([{ x: x1, y: y }, { x: x2, y: y }]);
    }
    function V(x, y1, y2) {
      if (Math.abs(y2 - y1) < 0.5) return;
      parts.push([{ x: x, y: y1 }, { x: x, y: y2 }]);
    }

    /* ── 一条「父卡片 → 子面板」的连线 + 递归子树 ─────────────────────── */
    function wire(parentRect, panel) {
      var items = kids(panel, function (n) {
        return n.tagName === "LI" || n.tagName === "A";
      })
        .map(function (n) {
          return n.tagName === "A" ? n : cardOf(n);
        })
        .filter(shown);
      if (!items.length) return;

      var rs = items.map(rectOf);
      var dir = (getComputedStyle(panel).flexDirection || "column").toLowerCase();

      if (dir.indexOf("row") === 0) {
        /* 子节点横排：上方水平干线 + 向下垂线；换行时各行干线用左侧竖直轨道串联 */
        var rows = groupRows(rs);
        /* 单行：轨道就落在首卡片中心（= 干线两端对齐首末卡片中心，常规桌面形态）。
           换行：轨道必须挪到所有卡片之外，否则竖轨会从上一行卡片身上穿过去。 */
        var railX = rows.length > 1
          ? Math.min.apply(null, rs.map(function (r) {
              return r.l;
            })) - Math.min(14, bus)
          : Math.min.apply(null, rows[0].map(function (r) {
              return r.cx;
            }));
        var busYs = rows.map(function (row) {
          return Math.min.apply(null, row.map(function (r) {
            return r.t;
          })) - bus;
        });
        rows.forEach(function (row, i) {
          var lastCx = Math.max.apply(null, row.map(function (r) {
            return r.cx;
          }));
          H(railX, lastCx, busYs[i]);
          row.forEach(function (r) {
            V(r.cx, busYs[i], r.t); // 干线 → 卡片上边中点
          });
        });
        if (rows.length > 1) V(railX, busYs[0], busYs[busYs.length - 1]);
        if (parentRect) {
          var lastCx0 = Math.max.apply(null, rows[0].map(function (r) {
            return r.cx;
          }));
          V(Math.min(Math.max(parentRect.cx, railX), lastCx0), parentRect.b, busYs[0]);
        }
      } else {
        /* 子节点竖排（父在左、子在右）：父卡片右缘竖直轨道 + 横向短接线 */
        var rail = parentRect ? parentRect.r : Math.min.apply(null, rs.map(function (r) {
          return r.l;
        })) - 20;
        var ys = rs.map(function (r) {
          return r.cy;
        });
        if (parentRect) ys.push(parentRect.cy);
        V(rail, Math.min.apply(null, ys), Math.max.apply(null, ys));
        rs.forEach(function (r) {
          H(rail, r.l, r.cy); // 轨道 → 卡片左边中点
        });
      }

      /* 递归：有子面板的卡片继续往下画 */
      items.forEach(function (card) {
        var sub = panelOf(card);
        if (shown(sub)) wire(rectOf(card), sub);
      });
    }

    /* ── 主绘制 ───────────────────────────────────────────────────────── */
    function paint() {
      var box = svg.getBoundingClientRect();
      var topUl = kids(host, isTag("UL"))[0];

      /* 签名没变（宿主框 + 内容框 + 折叠态）→ 空转返回。
         内容框必须参与：.site-tree 有 min-height 且居中，字号变小/内容变短时宿主框不变，
         只看宿主框会漏掉重绘（曾实测：改字号后连线留在原位）。 */
      var open = [];
      Array.prototype.forEach.call(host.querySelectorAll("details"), function (d) {
        open.push(d.open ? 1 : 0);
      });
      var ulBox = shown(topUl) ? topUl.getBoundingClientRect() : { width: 0, height: 0 };
      var next = [Math.round(box.width), Math.round(box.height),
                  Math.round(ulBox.width), Math.round(ulBox.height), open.join("")].join("|");
      if (next === sig) return;
      sig = next;

      origin = { x: box.left, y: box.top };
      parts = [];
      var cs = getComputedStyle(host);
      bus = num(cs.getPropertyValue("--bus-gap"), 24);
      drop = num(cs.getPropertyValue("--drop-gap"), 24);
      corner = num(cs.getPropertyValue("--tree-corner"), 6);

      if (!shown(topUl)) {
        path.setAttribute("d", "");
        return;
      }

      var spineX = rectOf(topUl).l; // 总干线的 x（= 树容器左缘）
      var top = Infinity;
      var bottom = -Infinity;

      /* 顶层各板块：分叉线 + 子树（单页行没有 summary/a，cardOf 返回 null，跳过） */
      kids(topUl, isTag("LI")).forEach(function (li) {
        var card = cardOf(li);
        if (shown(card)) {
          var c = rectOf(card);
          H(spineX, c.l, c.cy); // 总干线 → 板块卡片左边中点
          top = Math.min(top, c.cy);
          bottom = Math.max(bottom, c.cy);
          var panel = panelOf(card);
          if (shown(panel)) wire(c, panel);
        }
      });

      /* 单页行：无父节点，每行一条水平干线，卡片从下方垂线接入，干线左端接总干线 */
      var pageRow = host.querySelector(".h-row");
      if (shown(pageRow)) {
        var pageRects = kids(pageRow, function (n) {
          return n.tagName === "A";
        })
          .filter(shown)
          .map(rectOf);
        groupRows(pageRects).forEach(function (row) {
          var busY = Math.max.apply(null, row.map(function (r) {
            return r.b;
          })) + drop;
          H(spineX, Math.max.apply(null, row.map(function (r) {
            return r.cx;
          })), busY);
          row.forEach(function (r) {
            V(r.cx, r.b, busY); // 卡片下边中点 → 干线
          });
          bottom = Math.max(bottom, busY);
        });
      }

      /* 总干线：从第一个分叉串到最后一个接点 */
      if (isFinite(top) && isFinite(bottom)) V(spineX, top, bottom);

      path.setAttribute("d", parts.map(polylineD).join(" "));
    }

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        paint();
      });
    }

    /* ── 触发点（全部低频）───────────────────────────────────────────── */
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(schedule).observe(host);
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    host.addEventListener("toggle", schedule, true); // details 的 toggle 不冒泡 → 捕获阶段
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    schedule();
  }
})();
