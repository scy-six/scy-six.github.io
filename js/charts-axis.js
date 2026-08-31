/* =============================================================================
 * charts-axis.js — 共享坐标轴工具（Excel 式自动取「漂亮范围」）
 * -----------------------------------------------------------------------------
 * 所有手绘 SVG 图表页（keepfit / mountain …）共用，保证：
 *   - 纵轴：均匀、尽量整数的刻度（步长取 1/2/2.5/5/10 的整数倍）
 *   - 横轴：按真实日期时间戳定位（非按索引等距）
 * 暴露 window.ChartAxis：
 *   - niceScale(lo, hi, count)  通用上下限，返回 {bottom, top, step, ticks}
 *   - niceAxis(max, count)      兼容包装：从 0 起的纵轴（柱状图 x / 累计图 y）
 *   - timeDomain(times)         真实时间戳域（带 3% 余量），用于横轴时间刻度
 *   - tickLabel(ts, spanMs)     时间刻度标签：跨度大 YY.MM；短跨度（≤90 天）YY.MM.DD
 *   - dMonth(ts)                时间戳 → YY.MM（保留兼容）
 * ========================================================================== */
(function () {
  'use strict';

  // 漂亮刻度：步长取 1/2/2.5/5/10 的整数倍，bottom=floor、top=ceil
  function niceScale(lo, hi, count) {
    if (!(hi > lo)) hi = lo + 1;
    var raw = (hi - lo) / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1) ? 1 : (norm <= 2) ? 2 : (norm <= 2.5) ? 2.5 : (norm <= 5) ? 5 : 10;
    step *= mag;
    var bottom = Math.floor(lo / step) * step;
    var top = Math.ceil(hi / step) * step;
    if (top <= bottom) top = bottom + step;
    return { bottom: bottom, top: top, step: step, ticks: Math.round((top - bottom) / step) };
  }

  // 从 0 起的纵轴（柱状图 x、累计图 y），返回 {top, step}
  function niceAxis(max, count) {
    var s = niceScale(0, max, count || 4);
    return { top: s.top, step: s.step };
  }

  // 真实时间域：输入时间戳数组，返回带 3% 余量的 [dom0, dom1]
  function timeDomain(times) {
    var ts = times.filter(function (t) { return !isNaN(t); });
    if (!ts.length) return { dom0: 0, dom1: 1 };
    var tMin = Math.min.apply(null, ts), tMax = Math.max.apply(null, ts);
    var span = (tMax - tMin) || (24 * 3600 * 1000);
    var pad = span * 0.03;
    return { dom0: tMin - pad, dom1: tMax + pad };
  }

  function dMonth(ts) {
    var d = new Date(ts);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    return ('' + d.getFullYear()).slice(2) + '.' + mm;
  }

  // 时间刻度标签：跨度 > 90 天用 YY.MM；短跨度（如游泳 1 天）用 YY.MM.DD，避免月份全重复
  function tickLabel(ts, spanMs) {
    var d = new Date(ts);
    var yy = ('' + d.getFullYear()).slice(2);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var base = yy + '.' + mm;
    if (spanMs > 90 * 24 * 3600 * 1000) return base;
    var dd = ('0' + d.getDate()).slice(-2);
    return base + '.' + dd;
  }

  window.ChartAxis = {
    niceScale: niceScale,
    niceAxis: niceAxis,
    timeDomain: timeDomain,
    tickLabel: tickLabel,
    dMonth: dMonth
  };
})();
