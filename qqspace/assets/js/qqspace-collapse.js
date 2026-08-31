/* =============================================================================
 * qqspace-collapse.js — QQ空间「按年份折叠」交互
 * -----------------------------------------------------------------------------
 * 背景
 *   内容区年份以 h2.wow_head 扁平排列，年份之间无包裹容器。本脚本在运行时把
 *   每个 h2 到下一个 h2 之间的所有兄弟节点包进 <section.year-group>，形成可
 *   折叠单元，再实现「默认全部折叠、点击目录年份/标题 toggle 整年」的交互。
 *
 * 设计要点
 *   - 运行时包裹：不动 source/index.html 静态结构，回退只需移除本文件与 <script>。
 *   - 状态独立：每个 .year-group 用自身 .is-collapsed 类控制，互不影响。
 *   - 目录同步：目录年份项 (.toc-level-2) 加 .toc-year-open 反映展开状态。
 *   - 包裹仅移动节点、不重建元素，Fancybox 绑定不受影响。
 * ========================================================================== */
(function () {
  "use strict";

  var YEAR_HEAD = "h2.wow_head"; // 年份标题选择器
  var GROUP = "year-group";      // 年份组容器类

  /** 转义 id 中的特殊字符，避免属性选择器语法错误。 */
  function cssEscape(v) {
    return v.replace(/["\\]/g, "\\$&");
  }

  /**
   * 把每个年份标题及其后续兄弟（到下一个年份标题之前）包进 section.year-group。
   * 仅移动节点、不重建元素，Fancybox 绑定不受影响。
   * @returns {Element[]} 分组数组（按年份从新到旧顺序）
   */
  function buildGroups(page) {
    var heads = page.querySelectorAll(YEAR_HEAD);
    if (!heads.length) return [];
    var groups = [];
    for (var i = 0; i < heads.length; i++) {
      var head = heads[i];
      var next = heads[i + 1] || null;
      var nodes = [];
      var sib = head.nextElementSibling;
      while (sib && sib !== next) {
        nodes.push(sib);
        sib = sib.nextElementSibling;
      }
      var section = document.createElement("section");
      section.className = GROUP;
      section.setAttribute("data-year-id", head.id);
      head.parentNode.insertBefore(section, head);
      section.appendChild(head);
      for (var j = 0; j < nodes.length; j++) {
        section.appendChild(nodes[j]);
      }
      groups.push(section);
    }
    return groups;
  }

  /** 目录年份项与内容区状态同步：展开时高亮，折叠时取消。 */
  function syncToc(group, isOpen) {
    var yid = group.getAttribute("data-year-id");
    var link = document.querySelector(
      '.toc-level-2 > a.toc-link[href="#' + cssEscape(yid) + '"]'
    );
    if (!link) return;
    var item = link.closest(".toc-item");
    if (item) item.classList.toggle("toc-year-open", isOpen);
  }

  /**
   * 切换某年份组折叠状态，并同步目录项高亮。
   * @returns {boolean} 折叠后的状态（true=已折叠）
   */
  function toggle(group) {
    var collapsed = group.classList.toggle("is-collapsed");
    syncToc(group, !collapsed);
    return collapsed;
  }

  /** 绑定目录年份链接与年份标题点击，以及目录月份链接的「确保父年展开」增强。 */
  function bind(groups) {
    groups.forEach(function (group) {
      var yid = group.getAttribute("data-year-id");
      var head = group.querySelector(YEAR_HEAD);
      var link = document.querySelector(
        '.toc-level-2 > a.toc-link[href="#' + cssEscape(yid) + '"]'
      );

      // 年份标题自身可点击 toggle（双入口，更直观）
      if (head) {
        head.classList.add("year-toggle");
        head.addEventListener("click", function () {
          toggle(group);
        });
      }

      // 目录年份链接：展开/折叠整年，展开并平滑定位
      if (link) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
          var willOpen = group.classList.contains("is-collapsed");
          toggle(group);
          if (willOpen && head) {
            head.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }
    });

    // 增强：点击目录月份链接时确保其所属年份已展开，否则内容隐藏看不到定位
    var monthLinks = document.querySelectorAll(".toc-level-3 > a.toc-link");
    monthLinks.forEach(function (mLink) {
      mLink.addEventListener("click", function () {
        var mid = (mLink.getAttribute("href") || "").replace("#", "");
        if (!mid) return;
        var target = document.getElementById(mid);
        if (!target) return;
        var group = target.closest("." + GROUP);
        if (group && group.classList.contains("is-collapsed")) {
          toggle(group); // 仅由折叠变展开，不会误折叠
        }
      });
    });
  }

  function init() {
    var page = document.querySelector(".qqspace-page");
    if (!page) return;
    if (page.querySelector("section." + GROUP)) return; // 防重复执行
    var groups = buildGroups(page);
    if (!groups.length) return;
    // 默认：全部折叠
    groups.forEach(function (g) {
      g.classList.add("is-collapsed");
    });
    bind(groups);
    // 自动展开「最新年」：按年份标题文本中的 4 位数字取最大值，
    // 不依赖 DOM 顺序、不硬编码年份，新增年份 / 调整顺序均自动适配。
    var latest = null, maxYear = -1;
    groups.forEach(function (g) {
      var head = g.querySelector(YEAR_HEAD);
      if (!head) return;
      var m = (head.textContent || "").match(/(\d{4})/);
      if (m) {
        var y = parseInt(m[1], 10);
        if (y > maxYear) { maxYear = y; latest = g; }
      }
    });
    if (latest) toggle(latest); // 由折叠切到展开，并同步目录高亮
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
