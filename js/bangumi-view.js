/* 番剧页 网格视图（anilist 风格）
 * 本站本地化（2026-09-15）：仅保留网格视图，移除列表视图及其切换 UI（列表/网格按钮、localStorage 记忆）。
 * 容器恒加 .bangumi-view-grid，网格样式见 source/css/custom.css 的「12. 番剧页」段落。
 * 通过 Butterfly _config.butterfly.yml 的 inject.bottom 引入（带 data-pjax，pjax 跳转后重建）。
 *
 * ⚠ 以下逻辑为站点硬约束，删改会导致 tab 切换 / 分页 / 异步渲染失效，不得移除：
 *   - ensureBangumiScripts：扫描含文本 "function renderBilibiliBangumi" 的 <script> 并重新执行（pjax 跳转后恢复事件）；
 *   - boot / pjax:complete 中对 window.renderBilibiliBangumi() 的调用；
 *   - 标题原生 tooltip（bindTitleTooltip）。
 */
(function () {
  "use strict";

  // 容器恒为网格视图（列表视图已随本地化移除）
  function ensureGridView() {
    var c = document.querySelector(".bangumi-container");
    if (c) {
      c.classList.add("bangumi-view-grid");
      return;
    }
    if (typeof MutationObserver !== "undefined") {
      var obs = new MutationObserver(function (_, o) {
        var el = document.querySelector(".bangumi-container");
        if (el) {
          o.disconnect();
          el.classList.add("bangumi-view-grid");
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  // 给每个番剧标题挂原生 title（浏览器 tooltip，位于鼠标右下角、全文不截断、不受卡片 overflow 裁剪）。
  // 必须在插件 renderBilibiliBangumi 生成 .bangumi-info 之后调用。
  function bindTitleTooltip() {
    var infos = document.querySelectorAll(".bangumi-info");
    for (var i = 0; i < infos.length; i++) {
      var t = infos[i].querySelector(".bangumi-title");
      if (!t) continue;
      var full = (t.textContent || "").trim();
      if (!full) continue;
      t.setAttribute("title", full);
    }
  }

  // 插件可能异步渲染 .bangumi-info：存在则直接绑定，否则监听其出现后再绑定（仅一次）。
  function ensureTitleTooltip() {
    if (document.querySelector(".bangumi-info .bangumi-title")) {
      bindTitleTooltip();
      return;
    }
    if (typeof MutationObserver !== "undefined") {
      var obs = new MutationObserver(function (_, o) {
        if (document.querySelector(".bangumi-info .bangumi-title")) {
          o.disconnect();
          bindTitleTooltip();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  function boot() {
    ensureGridView();
    // 兜底：若插件全局渲染函数存在则再调用一次，确保 tab/分页状态正确
    if (typeof window.renderBilibiliBangumi === "function") {
      try {
        window.renderBilibiliBangumi();
      } catch (_) {}
    }
    ensureTitleTooltip();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 插件 bangumi.pug 生成的脚本没有 data-pjax，
  // 从其他页面 pjax 跳进番剧页时不会重新执行，导致 tab/分页事件丢失。
  // 这里通过重新执行页面中的插件脚本来恢复。
  function ensureBangumiScripts() {
    if (typeof window.renderBilibiliBangumi === "function") return true;
    var scripts = document.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || "";
      if (text.indexOf("function renderBilibiliBangumi") !== -1) {
        var ns = document.createElement("script");
        ns.textContent = text;
        document.head.appendChild(ns);
        document.head.removeChild(ns);
        return true;
      }
    }
    return false;
  }

  window.addEventListener("pjax:complete", function () {
    if (!document.querySelector(".bangumi-container")) return;
    ensureBangumiScripts();
    ensureGridView();
    if (typeof window.renderBilibiliBangumi === "function") {
      try {
        window.renderBilibiliBangumi();
      } catch (_) {}
    }
    ensureTitleTooltip();
  });
})();
