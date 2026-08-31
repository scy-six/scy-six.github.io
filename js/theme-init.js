/**
 * theme-init.js —— 防暗色/壁纸闪烁首屏同步脚本
 * -----------------------------------------------------------------------------
 * 本脚本放在 <head> 且非 async，在浏览器绘制 <body> 之前同步执行：
 *   1. 按 localStorage → 时间规则(autoChangeMode:2) → 系统偏好(autoChangeMode:1)
 *      → 默认 light 的顺序确定当前主题；
 *   2. 设置 <html data-theme>，使首帧即按正确主题渲染，消除白→暗闪烁；
 *   3. 向 <head> 注入 #web_bg 壁纸样式（亮/暗各一张），并关闭原生 4s 淡入动画，
 *      避免首屏白闪；同时壁纸会随 data-theme 变化自动切换。
 * -----------------------------------------------------------------------------
 */
(function () {
  function readLocalTheme () {
    try {
      var raw = localStorage.getItem('theme')
      if (!raw) return null
      try {
        var parsed = JSON.parse(raw)
        // 兼容 {value, expiry} 或直接存字符串的旧情况
        return (parsed && (parsed.value === 'dark' || parsed.value === 'light')) ? parsed.value : null
      } catch (e) {
        return (raw === 'dark' || raw === 'light') ? raw : null
      }
    } catch (e) {
      return null
    }
  }

  function decideTheme (cfg) {
    var saved = readLocalTheme()
    if (saved) return saved

    var mode = Number(cfg && cfg.autoChangeMode)
    if (mode === 2) {
      var h = new Date().getHours()
      var s = typeof cfg.start === 'number' ? cfg.start : 8
      var e = typeof cfg.end === 'number' ? cfg.end : 22
      // start <= h < end 为白天（light），否则夜间（dark）；支持跨午夜区间
      if (s < e) {
        return (s <= h && h < e) ? 'light' : 'dark'
      } else {
        return (h >= s || h < e) ? 'light' : 'dark'
      }
    }

    if (mode === 1) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    return 'light'
  }

  function injectWallpaper (cfg) {
    var bgLight = (cfg && cfg.bgLight) || '/img/wall/wallpaper.webp'
    var bgDark = (cfg && cfg.bgDark) || '/img/wall/wall.webp'
    var css =
      'body{background:transparent!important}' +
      '#web_bg{position:fixed!important;z-index:-999!important;width:100%!important;height:100%!important;' +
      'background-attachment:local!important;background-position:center!important;background-size:cover!important;' +
      'background-repeat:no-repeat!important;opacity:1!important;background-image:url(' + bgLight + ')!important}' +
      '[data-theme="dark"] #web_bg{background-image:url(' + bgDark + ')!important}' +
      '#web_bg.bg-animation{animation:none!important}'
    var s = document.createElement('style')
    s.id = 'web-bg-no-flash'
    s.textContent = css
    document.head.appendChild(s)
  }

  try {
    var cfg = (typeof GLOBAL_CONFIG !== 'undefined' && GLOBAL_CONFIG.darkmode) || {}
    var theme = decideTheme(cfg)
    document.documentElement.setAttribute('data-theme', theme)
    injectWallpaper(cfg)
  } catch (e) {
    /* 静默失败，不影响首屏 */
  }
})()
