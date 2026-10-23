/* 番剧页 网格视图（anilist 风格）
 * 本站本地化（2026-09-15）：仅保留网格视图，移除列表视图及其切换 UI（列表/网格按钮、localStorage 记忆）。
 * 容器恒加 .bangumi-view-grid，网格样式见 source/css/custom.css 的「12. 番剧页」段落。
 * 通过 Butterfly _config.butterfly.yml 的 inject.bottom 引入。
 * （GLM 报告 §3.4#10：站点已确认不会启用 pjax，原 ensureBangumiScripts / pjax:complete
 *   兼容层已随 pjax 残留清扫一并删除。）
 *
 * ⚠ 以下逻辑为站点硬约束，删改会导致 tab 切换 / 分页 / 异步渲染失效，不得移除：
 *   - boot 中对 window.renderBilibiliBangumi() 的兜底调用；
 *   - 标题原生 tooltip（bindTitleTooltip）。
 */
(function () {
  "use strict";

  // 幂等守卫：inject.bottom 全局注入下防止意外重复执行（album-menu.js 的 __albumMenuBound 同款做法）。
  if (window.__bangumiViewReady) return;
  window.__bangumiViewReady = true;

  // 容器恒为网格视图（列表视图已随本地化移除）
  function ensureGridView() {
    // 2026-10-03 短路：非番剧页直接返回，避免挂 15 秒的全站 MutationObserver 白等
    // （观察目标 .bangumi-container 只在 /bangumis/ 出现，pjax 进入时本函数会被再次调用）。
    if (location.pathname.indexOf("/bangumis") !== 0) return;
    var c = document.querySelector(".bangumi-container");
    if (c) {
      c.classList.add("bangumi-view-grid");
      return;
    }
    if (typeof MutationObserver !== "undefined") {
      var obs = new MutationObserver(function (_, o) {
        var el = document.querySelector(".bangumi-container");
        if (el) {
          clearTimeout(tid);
          o.disconnect();
          el.classList.add("bangumi-view-grid");
        }
      });
      // 非番剧页上目标永不出现 → 观察器会一直挂着监听全站 DOM；15 秒后自动收工（插件渲染远快于此）
      var tid = setTimeout(function () {
        obs.disconnect();
      }, 15000);
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
    // 同 ensureGridView：非番剧页短路，不挂 15 秒观察器
    if (location.pathname.indexOf("/bangumis") !== 0) return;
    if (document.querySelector(".bangumi-info .bangumi-title")) {
      bindTitleTooltip();
      return;
    }
    if (typeof MutationObserver !== "undefined") {
      var obs = new MutationObserver(function (_, o) {
        if (document.querySelector(".bangumi-info .bangumi-title")) {
          clearTimeout(tid);
          o.disconnect();
          bindTitleTooltip();
        }
      });
      // 同上：15 秒未出现即收工，避免在非番剧页长期监听全站 DOM
      var tid = setTimeout(function () {
        obs.disconnect();
      }, 15000);
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
})();
