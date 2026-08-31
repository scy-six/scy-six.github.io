/* =============================================================================
 * qqspace-lightbox.js — 让 qqspace 配图接入「主题自带 Fancybox」
 * =============================================================================
 * 背景
 *   qqspace 是独立布局（#qqspace.qqspace-page），页面内容不在标准 #article-container
 *   内，因此主题 main.js 的 runLightbox（仅对 #article-container 生效）不会处理它，
 *   全局 Fancybox 也不会自动接管这里的图片。
 *   说说配图锚点为 .message-lightbox、评论配图为 .comment-img-lightbox，
 *   图片真实地址写在 data-src（导出时已写入本地路径）。
 *
 * 做法（复用主题组件，不自写灯箱）
 *   1) 把上述锚点升级为 Fancybox 触发元素：data-fancybox="gallery"、href=data-src、
 *      data-caption 取原 alt。
 *   2) 调用主题已加载的全局 Fancybox.bind('[data-fancybox]') 完成绑定，
 *      与主站其它相册页（angling/bird/garden…）完全一致的交互。
 *
 * 触发时机：DOMContentLoaded 与 PJAX 完成后各跑一次（去重，已升级的锚点跳过），
 *   保证直接打开或站内跳转到达本页都能正常放大。
 * 依赖：主题全局 Fancybox（_config.butterfly.yml 中 lightbox: fancybox 已开启），不依赖 jQuery。
 * ========================================================================== */
(function () {
  "use strict";

  // 待升级的配图锚点选择器
  var SELECTOR = ".message-lightbox, .comment-img-lightbox";

  /** 把单个锚点升级为 Fancybox 触发元素（幂等）。 */
  function upgradeAnchor(el) {
    if (el.dataset.lbUpgraded) return; // 已处理过则跳过
    var src = el.getAttribute("data-src") || el.getAttribute("href");
    if (!src) return; // 无图源则不处理
    el.setAttribute("href", src);
    el.setAttribute("data-fancybox", "gallery");
    if (!el.getAttribute("data-caption")) {
      var img = el.querySelector("img");
      el.setAttribute("data-caption", (img && img.alt) || "");
    }
    el.dataset.lbUpgraded = "1";
  }

  /** 升级全部配图并绑定主题 Fancybox。 */
  function bind() {
    document.querySelectorAll(SELECTOR).forEach(upgradeAnchor);
    if (window.Fancybox) {
      // 重新绑定当前所有 [data-fancybox]，避免 PJAX 多次进入时重复/遗漏
      try {
        window.Fancybox.unbind("[data-fancybox]");
      } catch (e) {}
      window.Fancybox.bind("[data-fancybox]", {
        Hash: false,
        Thumbs: { showOnStart: false },
        Images: { Panzoom: { maxScale: 4 } }
      });
    }
  }

  // 直接打开本页
  if (document.readyState !== "loading") bind();
  else document.addEventListener("DOMContentLoaded", bind);
  // 站内 PJAX 跳转到达本页
  document.addEventListener("pjax:complete", bind);
})();
