/* =============================================================================
 * categories-chart.js — 分类页「分类雷达」
 * -------------------------------------------------------------------------
 * 纯 SVG 手绘雷达图，零外部依赖。
 * 数据来自页面内 <script type="application/json" id="categories-data">，
 * 由 Hexo 在构建期依据 site.categories 生成：[{ name, value }]。
 *
 * 设计要点：
 *   1) 主题色：取 CSS 变量 --default-bg-color（主题蓝 #49b1f5），并派生不同透明度的
 *      填充/描边/数据点色，与全站蓝色主题统一。
 *   2) 深浅层次：5 层同心多边形网格 + 外层极淡蓝背景 + 半透明数据面积，形成视觉层次。
 *   3) 亮/暗模式自动适配：文字/网格/背景均读 CSS 变量，MutationObserver 监听
 *      data-theme 变化后重绘。
 *   4) 不显示中心总数，保持界面简洁。
 * ========================================================================== */
(function () {
  'use strict';

  var initialized = false;

  function start() {
    if (initialized) return;
    var box = document.getElementById('categories-chart');
    if (!box) return;
    initialized = true;

    /* ---------- 数据解析 ---------- */
    var raw = document.getElementById('categories-data');
    var data = [];
    try { data = raw ? JSON.parse(raw.textContent) : []; } catch (e) { data = []; }

    var maxVal = 1;
    for (var i = 0; i < data.length; i++) {
      if ((data[i].value || 0) > maxVal) maxVal = data[i].value;
    }

    var n = data.length;
    if (n < 3) {
      box.innerHTML = '<p style="padding:2rem;text-align:center;opacity:.6">分类不足 3 个，无法绘制雷达图。</p>';
      return;
    }

    /* ---------- 主题变量与颜色工具 ---------- */
    function isDark() {
      var t = document.documentElement.getAttribute('data-theme');
      if (t === 'dark') return true;
      if (t === 'light') return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function cssVar(name, fallback) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }

    // hex -> {r,g,b}
    function hexToRgb(hex) {
      hex = (hex || '').replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
      return {
        r: parseInt(hex.substring(0, 2), 16) || 0,
        g: parseInt(hex.substring(2, 4), 16) || 0,
        b: parseInt(hex.substring(4, 6), 16) || 0
      };
    }

    // 按指定透明度生成 rgba 字符串，用于同一主题色的深浅层次
    function rgba(hex, alpha) {
      var c = hexToRgb(hex);
      return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
    }

    function getColors() {
      var d = isDark();
      var accent = cssVar('--default-bg-color', '#49b1f5');
      return {
        font:     cssVar('--font-color', d ? '#ddd' : '#363636'),
        accent:   accent,
        areaFill: rgba(accent, d ? 0.28 : 0.32),
        line:     rgba(accent, d ? 0.85 : 0.9),
        dot:      accent,
        grid:     d ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.07)',
        axis:     d ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.12)',
        outerBg:  rgba(accent, d ? 0.03 : 0.05),
        cardBg:   cssVar('--card-bg', d ? 'rgba(20,22,30,.95)' : '#fff')
      };
    }

    /* ---------- SVG 命名空间辅助 ---------- */
    var SVGNS = 'http://www.w3.org/2000/svg';

    function el(tag, attrs) {
      var e = document.createElementNS(SVGNS, tag);
      if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }

    /* ---------- 雷达图核心参数 ---------- */
    var W = 400, H = 400;            // SVG viewBox 尺寸
    var CX = W / 2, CY = H / 2 + 10; // 圆心（略下偏，给标题留空间）
    var R = 130;                     // 最大半径
    var LEVELS = 5;                  // 网格层数

    /* ---------- 计算各顶点角度（从正上方开始顺时针） ---------- */
    var angles = [];
    for (var i = 0; i < n; i++) {
      angles.push(-Math.PI / 2 + (i * 2 * Math.PI) / n);
    }

    /* ---------- 极坐标 → 笛卡尔坐标 ---------- */
    function pt(angle, radius) {
      return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
    }

    /* ---------- 构建 SVG ---------- */
    function buildSVG() {
      var c = getColors();
      var svg = el('svg', {
        viewBox: '0 0 ' + W + ' ' + H,
        width: '100%',
        height: '360',
        style: 'max-width:480px;margin:0 auto;display:block'
      });

      /* --- 标题 --- */
      var title = el('text', {
        x: CX, y: 24, 'text-anchor': 'middle',
        'font-size': '17', 'font-weight': '600', fill: c.font,
        'font-family': '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'
      });
      title.textContent = '分类雷达';
      svg.appendChild(title);

      /* --- 网格（5 层同心多边形） --- */
      for (var lv = 1; lv <= LEVELS; lv++) {
        var r = (R * lv) / LEVELS;
        var points = [];
        for (var i = 0; i < n; i++) {
          var p = pt(angles[i], r);
          points.push(p.x + ',' + p.y);
        }
        // 最外层加极淡主题蓝背景，形成深浅层次
        if (lv === LEVELS) {
          svg.appendChild(el('polygon', {
            points: points.join(' '),
            fill: c.outerBg,
            stroke: 'none'
          }));
        }
        // 网格线
        svg.appendChild(el('polygon', {
          points: points.join(' '),
          fill: 'none',
          stroke: c.grid,
          'stroke-width': '1'
        }));
      }

      /* --- 轴线（从圆心到各顶点） --- */
      for (var i = 0; i < n; i++) {
        var p = pt(angles[i], R);
        svg.appendChild(el('line', {
          x1: CX, y1: CY, x2: p.x, y2: p.y,
          stroke: c.axis, 'stroke-width': '1'
        }));
      }

      /* --- 数据多边形 --- */
      var dataPoints = [];
      var valRatio = data.map(function (d) { return (d.value || 0) / maxVal; });
      for (var i = 0; i < n; i++) {
        var p = pt(angles[i], R * valRatio[i]);
        dataPoints.push(p.x + ',' + p.y);
      }
      // 半透明面积填充 + 主题蓝描边
      svg.appendChild(el('polygon', {
        points: dataPoints.join(' '),
        fill: c.areaFill,
        stroke: c.line,
        'stroke-width': '2.5',
        'stroke-linejoin': 'round'
      }));

      /* --- 数据点（卡片色描边圆） --- */
      for (var i = 0; i < n; i++) {
        var p = pt(angles[i], R * valRatio[i]);
        svg.appendChild(el('circle', {
          cx: p.x, cy: p.y, r: 5,
          fill: c.dot,
          stroke: c.cardBg,
          'stroke-width': '2'
        }));
      }

      /* --- 轴标签（分类名 + 数量） --- */
      for (var i = 0; i < n; i++) {
        var p = pt(angles[i], R + 22);
        // 根据角度调整文本锚点，避免贴边
        var cosA = Math.cos(angles[i]);
        var anchor = 'middle';
        if (cosA > 0.3) anchor = 'start';
        else if (cosA < -0.3) anchor = 'end';

        var label = el('text', {
          x: p.x, y: p.y + 4, 'text-anchor': anchor,
          'font-size': '14', 'font-weight': '500', fill: c.font,
          'font-family': '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'
        });
        label.textContent = data[i].name + ' (' + (data[i].value || 0) + ')';
        svg.appendChild(label);
      }

      return svg;
    }

    /* ---------- 渲染 + 暗亮模式监听 ---------- */
    function render() {
      box.innerHTML = '';
      box.appendChild(buildSVG());
    }
    render();

    if (window.MutationObserver) {
      new MutationObserver(function () { render(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
