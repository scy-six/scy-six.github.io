/* eslint-env browser */
/* 相册菜单（album-menu）——清单相册（pet / garden / angling / bird / diy）共用。
 * 取代 2026-09-14 的「照片下方标签切换」：子相册不再堆在照片下面（照片一多就得下滑才能选），
 * 改为顶部菜单 + 悬停下拉。
 *
 * 结构（由 scripts/lib/gallery-core.js 的 renderAlbumMenu 输出）：
 *   .album-nav[data-album]
 *     > .album-menu-bar > .album-menu[data-node] > .album-menu-trigger
 *                                                + .album-menu-list > .album-menu-item[data-node]
 *     > .album-panels   > .album-panel[data-node][data-album]
 * ⚠ 面板是扁平的（每个节点一个、都是 .album-panels 的直接子元素），所以只切 is-active，不涉及嵌套。
 *
 * 交互：
 *   · 有子相册的模块（.has-children）鼠标悬停 / 键盘聚焦 → 下拉展开（纯 CSS :hover / :focus-within）
 *   · 触屏等无 hover 设备：点模块时顺带展开（加 .is-open），点空白处 / Esc 收起
 *   · 点模块本身 → 只显示该相册自身的照片
 *   · 点下拉里的子相册 → 只显示该子相册的照片，并在模块上标出它的名字（避免不知道在看哪本）
 *   · location.hash 深链（#album-panel-…）、localStorage 记住上次选择、ArrowDown/Home/End、Esc
 * 仅当页面存在 .album-nav 时才生效（全局注入，非相册页直接 return）。
 */
(function () {
  "use strict";

  var LS_KEY = "album-menu:";
  var HASH_PREFIX = "#album-panel-";
  var hoverable = null;

  /** 是否支持 hover（触屏设备用点击展开兜底）。结果缓存一次。 */
  function canHover() {
    if (hoverable === null) {
      hoverable = !!(window.matchMedia && window.matchMedia("(hover: hover)").matches);
    }
    return hoverable;
  }

  /** 属性选择器值转义（relPath 可能含引号 / 反斜杠）。 */
  function sel(v) {
    return String(v).replace(/["\\]/g, "\\$&");
  }

  function panelFor(nav, node) {
    return nav.querySelector('.album-panel[data-node="' + sel(node) + '"]');
  }

  function triggerOf(menu) {
    return menu ? menu.querySelector(".album-menu-trigger") : null;
  }

  function openList(menu) {
    if (!menu) return;
    menu.classList.add("is-open");
    var trigger = triggerOf(menu);
    if (trigger && trigger.hasAttribute("aria-expanded")) trigger.setAttribute("aria-expanded", "true");
  }

  function closeList(menu) {
    if (!menu) return;
    menu.classList.remove("is-open");
    var trigger = triggerOf(menu);
    if (trigger && trigger.hasAttribute("aria-expanded")) trigger.setAttribute("aria-expanded", "false");
  }

  function closeAll(nav) {
    var scope = nav || document;
    var open = scope.querySelectorAll(".album-menu.is-open");
    for (var i = 0; i < open.length; i++) closeList(open[i]);
  }

  /** 下拉项的文字（= 子相册名），用于在模块上标注当前所在子相册。 */
  function titleOf(nav, node) {
    var item = nav.querySelector('.album-menu-item[data-node="' + sel(node) + '"]');
    return item ? item.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function activePanel(nav) {
    return (
      nav.querySelector(".album-panels > .album-panel.is-active") ||
      nav.querySelector(".album-panels > .album-panel")
    );
  }

  /** 显示某个面板：切换 is-active，并同步菜单选中态与「当前子相册」标注。 */
  function activate(panel, push) {
    if (!panel) return;
    var nav = panel.closest(".album-nav");
    if (!nav) return;
    var node = panel.dataset.node || "";
    var album = nav.dataset.album || "";

    var panels = nav.querySelectorAll(".album-panels > .album-panel");
    for (var i = 0; i < panels.length; i++) {
      panels[i].classList.toggle("is-active", panels[i] === panel);
    }

    var menus = nav.querySelectorAll(".album-menu");
    for (var j = 0; j < menus.length; j++) {
      var menu = menus[j];
      var mNode = menu.dataset.node || "";
      // 该模块是否「拥有」当前节点：就是它自己，或当前节点位于它的子树内
      var owns = mNode === node || (mNode !== "" && node.indexOf(mNode + "/") === 0);
      menu.classList.toggle("is-active", owns);
      var current = menu.querySelector(".album-menu-current");
      if (current) current.textContent = owns && mNode !== node ? titleOf(nav, node) : "";
      var items = menu.querySelectorAll(".album-menu-item");
      for (var k = 0; k < items.length; k++) {
        items[k].classList.toggle("is-active", items[k].dataset.node === node);
      }
    }

    closeAll(nav);
    if (push !== false) {
      if (panel.id) history.replaceState(null, "", "#" + panel.id);
      try {
        localStorage.setItem(LS_KEY + album, node);
      } catch (e) {
        /* 隐私模式下 localStorage 不可用，忽略 */
      }
    }
  }

  function closest(el, sel2) {
    return el && el.closest ? el.closest(sel2) : null;
  }

  function onClick(e) {
    var nav = closest(e.target, ".album-nav");

    var item = closest(e.target, ".album-menu-item");
    if (item && nav) {
      e.preventDefault();
      activate(panelFor(nav, item.dataset.node || ""), true);
      return;
    }

    var trigger = closest(e.target, ".album-menu-trigger");
    if (trigger && nav) {
      e.preventDefault();
      var menu = closest(trigger, ".album-menu");
      activate(panelFor(nav, trigger.dataset.node || ""), true);
      // 桌面靠 CSS :hover 展下拉；无 hover 设备（触屏）靠这次点击补上
      if (menu && menu.classList.contains("has-children") && !canHover()) openList(menu);
      return;
    }

    // 点到菜单 / 面板之外 → 收起所有下拉
    if (!nav) closeAll(null);
  }

  function onKeydown(e) {
    var trigger = closest(e.target, ".album-menu-trigger");
    if (trigger && (e.key === "ArrowDown" || e.key === "Down")) {
      var menu = closest(trigger, ".album-menu");
      var first = menu ? menu.querySelector(".album-menu-item") : null;
      if (first) {
        e.preventDefault();
        openList(menu);
        first.focus();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Esc") {
      closeAll(null);
      if (trigger) trigger.blur();
    }
  }

  function activateFromHash() {
    var h = location.hash || "";
    if (h.indexOf(HASH_PREFIX) !== 0) return false;
    var panel = document.getElementById(h.slice(1));
    if (panel && panel.classList.contains("album-panel")) {
      activate(panel, false);
      return true;
    }
    return false;
  }

  function activateDefault() {
    var navs = document.querySelectorAll(".album-nav");
    for (var i = 0; i < navs.length; i++) {
      var nav = navs[i];
      var saved = null;
      try {
        saved = localStorage.getItem(LS_KEY + (nav.dataset.album || ""));
      } catch (e) {
        /* 忽略 */
      }
      var panel = saved !== null && saved !== undefined ? panelFor(nav, saved) : null;
      activate(panel || activePanel(nav), false);
    }
  }

  function init() {
    if (!window.__albumMenuBound) {
      document.addEventListener("click", onClick);
      document.addEventListener("keydown", onKeydown);
      window.addEventListener("hashchange", activateFromHash);
      document.addEventListener("pjax:end", function () {
        if (!activateFromHash()) activateDefault();
      });
      window.__albumMenuBound = true;
    }
    if (!activateFromHash()) activateDefault();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
