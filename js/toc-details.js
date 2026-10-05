/* toc-details.js — 目录跳转自动展开 <details> 分组
 * -----------------------------------------------------------------------------
 * 问题：notes（此去经年）/ travel（到此一游）的年份分组是 <details> 折叠面板，
 *   默认仅最新年份展开。点侧栏目录跳进折叠年份时，目标内容处于隐藏状态——
 *   浏览器定位不到（或定位错位），表现为「点了目录没反应 / 位置不对」。
 * 方案：点击目录链接（或 URL hash 变化 / 首屏带 hash 进入）时，把目标元素的
 *   <details> 祖先全部展开。只展开、**不折叠其他分组**——不打断用户当前浏览状态；
 *   需要收起时手动点年份标题即可（手风琴式互斥展开会频繁跳变，故不采用）。
 * 注入：_config.butterfly.yml inject.bottom（全站注入；页面无 <details> 时零开销）。
 */
(function () {
  "use strict";
  if (window.__tocDetailsReady) return;
  window.__tocDetailsReady = true;

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (_) {
      return s;
    }
  }

  // 目标元素的所有 <details> 祖先：未展开的全部展开（不折叠其他）
  function expandFor(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.tagName === "DETAILS" && !node.open) node.open = true;
      node = node.parentElement;
    }
  }

  function jumpByHash() {
    var h = safeDecode((location.hash || "").slice(1));
    if (!h) return;
    var t = document.getElementById(h);
    if (t) expandFor(t);
  }

  // 侧栏目录点击：捕获阶段在浏览器默认锚点跳转「之前」展开分组，保证滚动时目标可见
  document.addEventListener(
    "click",
    function (e) {
      var link = e.target.closest ? e.target.closest('a.toc-link[href^="#"]') : null;
      if (!link) return;
      var id = safeDecode(link.getAttribute("href").slice(1));
      var t = document.getElementById(id);
      if (t) expandFor(t);
    },
    true
  );

  window.addEventListener("hashchange", jumpByHash);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", jumpByHash);
  } else {
    jumpByHash();
  }
})();
