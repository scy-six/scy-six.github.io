/* =============================================================================
 * keepfit-charts.js — 修身养性页图表（纯 SVG 手绘，零外部依赖）
 * -----------------------------------------------------------------------------
 * 数据：window.KEEPFIT_RECORDS（由 tools/gen_keepfit.py 从 运动记录.xlsx 生成）
 * 章节：
 *   1) 运动记录 —— 三项速率折线图（跑步/骑行=km/h，游泳=配速 min/100m，纵轴由大到小）
 *   2) 累计趋势 —— 三项运动各自记录表（含累计距离 km）
 * 设计：主题色走 CSS 变量；三项运动各配一色（跑=主色/骑=绿/游=橙）；亮/暗/阅读模式经 MutationObserver 自动重绘。
 * ========================================================================== */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var initialized = false;
  var SPORT_ORDER = ['跑步', '骑行', '游泳'];
  var SPORT_CLASS = { '跑步': 'run', '骑行': 'bike', '游泳': 'swim', '体重': 'weight' };

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function setText(id, v) {
    var e = document.getElementById(id);
    if (e) e.textContent = v;
  }

  function byDate(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  }

  function isPace(sport) { return sport === '游泳'; }

  // 单条记录的速率/配速：跑步/骑行取 km/h（缺则按 距离/时长 估算），游泳直接用 xlsx「配速（min/hm）」列（min/100m）
  function rateOf(rec) {
    if (isPace(rec.sport)) {
      if (rec.pace != null) return rec.pace; // 已为 min/100m（用户确认）
      if (!rec.dist) return null;
      return (rec.duration_h * 60) / (rec.dist * 10); // 兜底：由 时长/距离 估算
    }
    var s = rec.speed;
    if (s == null && rec.dist && rec.duration_h) s = rec.dist / rec.duration_h;
    return s;
  }

  /* ---------- 概览统计卡 ---------- */
  function fillStats(records) {
    var sports = {}, totalH = 0;
    records.forEach(function (r) {
      sports[r.sport] = 1;
      totalH += r.duration_h;
    });
    setText('stat-sports', Object.keys(sports).length);
    setText('stat-counts', records.length);
    setText('stat-hours', Math.round(totalH));
  }

  /* ---------- 通用折线图（单系列，横轴按真实日期时间刻度，纵轴均匀整数） ---------- */
  function drawLineChart(pts, yLo, yHi) {
    var W = 1000, H = 340, mL = 64, mR = 20, mT = 24, mB = 50;
    var plotW = W - mL - mR, plotH = H - mT - mB;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', style: 'max-width:1000px;margin:0 auto;display:block' });

    // 横轴时间域：按真实日期时间戳定位（带 3% 余量，由共享 ChartAxis 计算）
    var _dom = ChartAxis.timeDomain(pts.map(function (p) { return Date.parse(p.date); }));
    var dom0 = _dom.dom0, dom1 = _dom.dom1;
    function px(t) { return mL + plotW * (t - dom0) / (dom1 - dom0); }
    function pxDate(s) { var t = Date.parse(s); return isNaN(t) ? mL : px(t); }

    // 纵轴：均匀、尽量整数的刻度
    var ax = ChartAxis.niceScale(yLo, yHi, 5);
    var yTicks = Math.round((ax.top - ax.bottom) / ax.step);
    for (var t = 0; t <= yTicks; t++) {
      var val = ax.bottom + ax.step * t;
      var gy = mT + plotH - plotH * t / yTicks;
      svg.appendChild(el('line', { class: 'mc-grid', x1: mL, y1: gy, x2: W - mR, y2: gy }));
      var yt = el('text', { class: 'mc-axis-text', x: mL - 8, y: gy + 4, 'text-anchor': 'end' });
      yt.textContent = (ax.step >= 1) ? Math.round(val) : (Math.round(val * 10) / 10);
      svg.appendChild(yt);
    }
    svg.appendChild(el('line', { class: 'mc-axis', x1: mL, y1: mT, x2: mL, y2: mT + plotH }));
    svg.appendChild(el('line', { class: 'mc-axis', x1: mL, y1: mT + plotH, x2: W - mR, y2: mT + plotH }));

    // 横轴时间刻度（约 6 个，真实时间位置均匀分布；短跨度自适应到日，相邻重复标签只留一个）
    var xN = 6, spanMs = dom1 - dom0, lastXLabel = null;
    for (var k = 0; k <= xN; k++) {
      var tt = dom0 + spanMs * k / xN;
      var gx = px(tt);
      svg.appendChild(el('line', { class: 'mc-grid', x1: gx, y1: mT, x2: gx, y2: mT + plotH }));
      var lab = ChartAxis.tickLabel(tt, spanMs);
      if (lab !== lastXLabel) {
        var dt = el('text', {
          class: 'mc-axis-text', x: gx, y: mT + plotH + 16,
          'text-anchor': 'end', transform: 'rotate(-35 ' + gx + ' ' + (mT + plotH + 16) + ')'
        });
        dt.textContent = lab;
        svg.appendChild(dt);
        lastXLabel = lab;
      }
    }

    // 折线 + 数据点（x 按真实日期定位）
    var cls = SPORT_CLASS[pts[0].sport];
    function py(v) { return mT + plotH - (v - ax.bottom) / (ax.top - ax.bottom) * plotH; }
    var parts = [];
    pts.forEach(function (p, i) { parts.push((i ? ' L ' : ' M ') + pxDate(p.date) + ' ' + py(p.v)); });
    svg.appendChild(el('path', { class: 'mc-line ' + cls, d: parts.join('') }));
    pts.forEach(function (p) {
      svg.appendChild(el('circle', { class: 'mc-dot ' + cls, cx: pxDate(p.date), cy: py(p.v), r: 4 }));
    });
    return svg;
  }

  /* ---------- 1) 速率/配速折线图（单系列，按日期） ---------- */
  function buildRateChart(sport, recs) {
    var pts = recs.map(function (r) { return { sport: sport, date: r.date, v: rateOf(r) }; })
                  .filter(function (p) { return p.v != null; });
    if (!pts.length) return null;
    var vs = pts.map(function (p) { return p.v; });
    var vmin = Math.min.apply(null, vs), vmax = Math.max.apply(null, vs);
    return drawLineChart(pts, vmin, vmax);
  }

  /* ---------- 2) 累计趋势：单项累计距离折线图（y 从 0 起） ---------- */
  function buildTrendChart(sport, recs) {
    var rows = recs.slice().sort(byDate);
    var cum = 0, pts = [];
    rows.forEach(function (r) {
      cum += r.dist;
      if (r.dist != null) pts.push({ sport: sport, date: r.date, v: cum });
    });
    if (!pts.length) return null;
    var vmax = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    return drawLineChart(pts, 0, vmax * 1.05 || 1);
  }

  /* ---------- 3) 质量监控：体重趋势折线图（y 自适应，单位 kg） ---------- */
  function buildWeightChart(records) {
    var pts = records
      .map(function (r) { return { sport: '体重', date: r.date, v: r.weight }; })
      .filter(function (p) { return p.v != null; })
      .sort(byDate);
    if (!pts.length) return null;
    var vs = pts.map(function (p) { return p.v; });
    var vmin = Math.min.apply(null, vs), vmax = Math.max.apply(null, vs);
    return drawLineChart(pts, vmin, vmax);
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var records = window.KEEPFIT_RECORDS;
    if (!records || !records.length) return;
    fillStats(records);

    SPORT_ORDER.forEach(function (sp) {
      var recs = records.filter(function (r) { return r.sport === sp; }).sort(byDate);
      var box = document.getElementById('rate-' + SPORT_CLASS[sp]);
      if (box) {
        box.innerHTML = '';
        var svg = buildRateChart(sp, recs);
        if (svg) box.appendChild(svg);
        else box.innerHTML = '<p class="hint">暂无数据</p>';
      }
      var tbox = document.getElementById('trend-' + SPORT_CLASS[sp]);
      if (tbox) {
        tbox.innerHTML = '';
        var tsvg = buildTrendChart(sp, recs);
        if (tsvg) tbox.appendChild(tsvg);
        else tbox.innerHTML = '<p class="hint">暂无数据</p>';
      }
    });

    // 4) 质量监控：体重趋势
    var wbox = document.getElementById('weight-chart');
    if (wbox && window.KEEPFIT_WEIGHT) {
      wbox.innerHTML = '';
      var wsvg = buildWeightChart(window.KEEPFIT_WEIGHT);
      if (wsvg) wbox.appendChild(wsvg);
      else wbox.innerHTML = '<p class="hint">暂无数据</p>';
    }
  }

  function start() {
    if (initialized) return;
    if (!window.KEEPFIT_RECORDS || !window.KEEPFIT_RECORDS.length) return;
    initialized = true;
    render();
    if (window.MutationObserver) {
      new MutationObserver(function () { render(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
