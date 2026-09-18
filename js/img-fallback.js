/**
 * img-fallback.js — 全站图片加载失败（404 / 破图）统一兜底，换成 /img/error.gif
 * -----------------------------------------------------------------------------
 * 为什么还需要它：主题自带的 error_img 配置只覆盖「头像 / 文章封面 / 友链」三处
 * （card_author.pug / sidebar.pug 等模板里的 onerror），而本站的**相册、notes、travel**
 * 都是自定义脚本渲染的，懒加载图（data-lazy-src → src）也不在其覆盖范围内 —— 这些图 404
 * 时会留下破图。这里做统一兜底。
 *
 * 实现要点：
 *   · img 的 error 事件**不冒泡**，只能在**捕获阶段**截获 → addEventListener(..., true)。
 *   · 用**事件委托**挂在 document 上：pjax 跳转后新插入的图、懒加载插件后续补上的
 *     src 出错，都会被拦到，无需重复绑定（故注入时不带 data-pjax）。
 *   · 幂等：换过一次即打 data-fallback="1"；兜底图本身再 404 也不会死循环。
 *   · 换图时一并清掉 data-lazy-src / data-src / srcset，避免懒加载插件把它换回坏地址。
 * -----------------------------------------------------------------------------
 * 兜底图：source/img/error.gif（构建后位于 /img/error.gif），由 _config.butterfly.yml 的
 * error_img 与本脚本共用同一张，保证全站观感一致。
 */
(function () {
  "use strict";

  // 注入可能被重复执行（多入口 / 将来开启 pjax 重注入），只绑定一次
  if (window.__imgFallbackBound) return;
  window.__imgFallbackBound = true;

  var FALLBACK = "/img/error.gif";

  function handled(img) {
    var src = img.getAttribute("src") || "";
    return img.getAttribute("data-fallback") === "1" || src === FALLBACK ||
      src.indexOf(FALLBACK) >= 0;
  }

  function onError(e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG" || handled(img)) return;
    img.setAttribute("data-fallback", "1");
    img.removeAttribute("data-lazy-src");
    img.removeAttribute("data-src");
    img.removeAttribute("srcset");
    img.src = FALLBACK;
  }

  // 捕获阶段：img 的 error 不冒泡，只能这样截获（含后续动态插入的图片）
  document.addEventListener("error", onError, true);
})();
