/* 番剧页 列表/网格视图切换（anilist 风格）
 * 通过 Butterfly _config.butterfly.yml 的 inject.bottom 引入（带 data-pjax，pjax 跳转后重建）。
 * 样式见 source/css/custom.css 的「12. 番剧页」段落。
 */
(function () {
  "use strict";

  var LIST_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z"/></svg>';
  var GRID_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>';

  function applyView(v) {
    var c = document.querySelector(".bangumi-container");
    if (!c) return;
    c.classList.toggle("bangumi-view-grid", v === "grid");
    c.classList.toggle("bangumi-view-list", v !== "grid");
  }

  function bindToggle(bar) {
    if (bar.dataset.bound) return;
    bar.dataset.bound = "1";

    bar.innerHTML =
      '<button type="button" class="bangumi-view-btn active" data-view="list" title="列表视图" aria-label="列表视图">' +
      LIST_SVG +
      "</button>" +
      '<button type="button" class="bangumi-view-btn" data-view="grid" title="网格视图" aria-label="网格视图">' +
      GRID_SVG +
      "</button>";

    bar.querySelectorAll("[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-view");
        applyView(v);
        try {
          localStorage.setItem("bangumi-view", v);
        } catch (_) {}
        bar.querySelectorAll("[data-view]").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-view") === v);
        });
      });
    });

    var saved = "list";
    try {
      saved = localStorage.getItem("bangumi-view") || "list";
    } catch (_) {}
    applyView(saved);
    bar.querySelectorAll("[data-view]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === saved);
    });
  }

  function initView() {
    var bar = document.querySelector(".bangumi-view-toggle");
    if (!bar) {
      var tabs = document.querySelector(".bangumi-tabs");
      if (!tabs) {
        // 插件内容异步渲染：监听 DOM 变化，等 .bangumi-tabs 出现再初始化
        if (typeof MutationObserver !== "undefined") {
          var obs = new MutationObserver(function (mutations, o) {
            if (document.querySelector(".bangumi-tabs")) {
              o.disconnect();
              initView();
            }
          });
          obs.observe(document.body, { childList: true, subtree: true });
        }
        return;
      }
      bar = document.createElement("span");
      bar.className = "bangumi-view-toggle";
      tabs.appendChild(bar);
    }
    bindToggle(bar);
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
    initView();
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
    initView();
    if (typeof window.renderBilibiliBangumi === "function") {
      try {
        window.renderBilibiliBangumi();
      } catch (_) {}
    }
    ensureTitleTooltip();
  });
})();
