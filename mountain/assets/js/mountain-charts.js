/* =============================================================================
 * mountain-charts.js — 十万大山页图表（纯 SVG 手绘，零外部依赖）
 * -----------------------------------------------------------------------------
 * 数据：window.MOUNTAIN_RECORDS（由 tools/gen_mountain.py 从 mount.xlsx 生成）
 * 两张图：
 *   1) 距离对比  —— 横向柱状图（每座山最长一次攀登距离，按距离降序排名）
 *   2) 累计攀登  —— 折线图（按攀登日期升序的累计距离）
 * 设计：主题色取 CSS 变量 --default-bg-color，亮/暗模式经 MutationObserver 自动重绘。
 * ========================================================================== */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var initialized = false;

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function hexToRgb(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    return {
      r: parseInt(hex.substring(0, 2), 16) || 0,
      g: parseInt(hex.substring(2, 4), 16) || 0,
      b: parseInt(hex.substring(4, 6), 16) || 0
    };
  }

  function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
  }

  function getColors() {
    var d = isDark();
    var accent = cssVar('--default-bg-color', '#49b1f5');
    return {
      accent: accent,
      font: cssVar('--font-color', d ? '#ddd' : '#363636'),
      grid: 'color-mix(in srgb, ' + cssVar('--font-color', '#000') + ' 12%, transparent)',
      axis: 'color-mix(in srgb, ' + cssVar('--font-color', '#000') + ' 22%, transparent)',
      cardBg: cssVar('--card-bg', d ? 'rgba(20,22,30,.95)' : '#fff')
    };
  }

  function fmt(n) {
    // 保留两位小数，去掉多余的 .00
    var s = n.toFixed(2);
    return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  /* ---------- 1) 距离对比：横向柱状图 ---------- */
  function buildBarChart(records, c) {
    var data = records.slice().sort(function (a, b) { return b.bestDist - a.bestDist; });
    var W = 1000;
    var padL = 150;          // 左侧山峰名
    var padR = 70;           // 右侧数值
    var padT = 10;
    var padB = 20;
    var rowH = 30;
    var H = padT + padB + data.length * rowH;
    var barX0 = padL;
    var barMax = W - padL - padR;
    var maxDist = 0;
    data.forEach(function (d) { if (d.bestDist > maxDist) maxDist = d.bestDist; });
    var axis = ChartAxis.niceAxis(maxDist, 4);
    var top = axis.top, step = axis.step;
    var ticks = top / step;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', style: 'max-width:1000px;margin:0 auto;display:block' });

    // 纵向网格 + x 轴刻度（取整、等步长）
    for (var t = 0; t <= ticks; t++) {
      var gx = barX0 + (barMax * t) / ticks;
      svg.appendChild(el('line', { class: 'mc-grid', x1: gx, y1: padT, x2: gx, y2: H - padB }));
      var gt = el('text', { class: 'mc-axis-text', x: gx, y: H - padB + 15, 'text-anchor': 'middle' });
      gt.textContent = Math.round(t * step);
      svg.appendChild(gt);
    }

    data.forEach(function (d, i) {
      var y = padT + i * rowH;
      var cy = y + rowH / 2;
      var bw = (d.bestDist / top) * barMax;

      // 山峰名（右对齐）
      var name = el('text', { class: 'mc-name-label', x: padL - 10, y: cy + 4, 'text-anchor': 'end' });
      name.textContent = d.name;
      svg.appendChild(name);

      // 柱
      svg.appendChild(el('rect', {
        class: 'mc-bar', x: barX0, y: y + 4, width: Math.max(bw, 1), height: rowH - 8, rx: 5
      }));

      // 数值
      var val = el('text', { class: 'mc-bar-label', x: barX0 + bw + 8, y: cy + 4, 'text-anchor': 'start' });
      val.textContent = fmt(d.bestDist) + ' km';
      svg.appendChild(val);
    });

    return svg;
  }

  /* ---------- 2) 累计攀登：折线图 ---------- */
  function buildLineChart(records, c) {
    var data = records.slice().sort(function (a, b) {
      return a.bestDate < b.bestDate ? -1 : a.bestDate > b.bestDate ? 1 : 0;
    });
    var W = 1000, H = 400;
    var mL = 56, mR = 24, mT = 24, mB = 56;
    var plotW = W - mL - mR;
    var plotH = H - mT - mB;
    var n = data.length;

    var cum = [];
    var total = 0;
    data.forEach(function (d) { total += d.bestDist; cum.push(total); });
    var axis = ChartAxis.niceAxis(total, 4);
    var top = axis.top, step = axis.step;
    var ticks = top / step;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', style: 'max-width:1000px;margin:0 auto;display:block' });

    // y 轴网格 + 刻度（取整、等步长）
    for (var t = 0; t <= ticks; t++) {
      var gy = mT + plotH - (plotH * t) / ticks;
      svg.appendChild(el('line', { class: 'mc-grid', x1: mL, y1: gy, x2: W - mR, y2: gy }));
      var yt = el('text', { class: 'mc-axis-text', x: mL - 8, y: gy + 4, 'text-anchor': 'end' });
      yt.textContent = Math.round(t * step);
      svg.appendChild(yt);
    }
    // 坐标轴
    svg.appendChild(el('line', { class: 'mc-axis', x1: mL, y1: mT, x2: mL, y2: mT + plotH }));
    svg.appendChild(el('line', { class: 'mc-axis', x1: mL, y1: mT + plotH, x2: W - mR, y2: mT + plotH }));

    // 横轴：按真实日期时间戳定位（带 3% 余量，由共享 ChartAxis 计算）
    var _dom = ChartAxis.timeDomain(data.map(function (d) { return Date.parse(d.bestDate); }));
    var dom0 = _dom.dom0, dom1 = _dom.dom1;
    function pxRaw(t) { return mL + plotW * (t - dom0) / (dom1 - dom0); }
    function pxDate(s) { var t = Date.parse(s); return isNaN(t) ? mL : pxRaw(t); }
    function px(i) { return pxDate(data[i].bestDate); }
    function py(v) { return mT + plotH - (v / top) * plotH; }

    // 面积
    var area = 'M ' + px(0) + ' ' + py(0);
    for (var i = 0; i < n; i++) area += ' L ' + px(i) + ' ' + py(cum[i]);
    area += ' L ' + px(n - 1) + ' ' + py(0) + ' Z';
    svg.appendChild(el('path', { class: 'mc-area', d: area }));

    // 折线
    var line = '';
    for (var j = 0; j < n; j++) line += (j === 0 ? 'M ' : ' L ') + px(j) + ' ' + py(cum[j]);
    svg.appendChild(el('path', { class: 'mc-line', d: line }));

    // 数据点（x 按真实日期定位）
    for (var k = 0; k < n; k++) {
      var cx = px(k), cyv = py(cum[k]);
      var isLast = k === n - 1;
      svg.appendChild(el('circle', { class: isLast ? 'mc-dot-last' : 'mc-dot', cx: cx, cy: cyv, r: isLast ? 6 : 4 }));
    }

    // 横轴：6 个均匀时间刻度 + 竖直网格线（短跨度自适应到日，相邻重复标签只留一个）
    var xN = 6, spanMs = dom1 - dom0, lastXLabel = null;
    for (var q = 0; q <= xN; q++) {
      var tt = dom0 + spanMs * q / xN;
      var gx = pxRaw(tt);
      svg.appendChild(el('line', { class: 'mc-grid', x1: gx, y1: mT, x2: gx, y2: mT + plotH }));
      var lab = ChartAxis.tickLabel(tt, spanMs);
      if (lab !== lastXLabel) {
        var dt = el('text', {
          class: 'mc-axis-text', x: gx, y: mT + plotH + 16,
          'text-anchor': 'end', transform: 'rotate(-40 ' + gx + ' ' + (mT + plotH + 16) + ')'
        });
        dt.textContent = lab;
        svg.appendChild(dt);
        lastXLabel = lab;
      }
    }

    // 末点总距离标注
    var last = el('text', {
      class: 'mc-bar-label', x: px(n - 1), y: py(total) - 12,
      'text-anchor': 'end'
    });
    last.textContent = '累计 ' + fmt(total) + ' km';
    svg.appendChild(last);

    return svg;
  }

  /* ---------- 概览统计卡 ---------- */
  function fillStats(records) {
    var totalDist = records.reduce(function (s, d) { return s + d.bestDist; }, 0);
    var totalClimbs = records.reduce(function (s, d) { return s + (d.climbs || 1); }, 0);
    setText('stat-peaks', records.length);
    setText('stat-climbs', totalClimbs);
    setText('stat-dist', Math.round(totalDist));
  }

  function setText(id, v) {
    var e = document.getElementById(id);
    if (e) e.textContent = v;
  }

  /* ---------- 攀登记录列表（由数据渲染，单一数据源） ---------- */
  function buildTable(records) {
    var tbody = document.getElementById('mountain-tbody');
    if (!tbody) return;
    var rows = records.slice().sort(function (a, b) {
      return a.bestDate < b.bestDate ? -1 : a.bestDate > b.bestDate ? 1 : 0;
    });
    var html = '';
    rows.forEach(function (d, i) {
      var badge = d.climbs > 1 ? '<span class="badge">登顶 ' + d.climbs + ' 次</span>' : '';
      html +=
        '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td class="peak-name">' + esc(d.name) + badge + '</td>' +
        '<td class="region">' + esc(d.region) + '</td>' +
        '<td>' + d.height + '</td>' +
        '<td>' + (d.plannedDist ? fmt(d.plannedDist) : '—') + '</td>' +
        '<td class="dist">' + fmt(d.bestDist) + '</td>' +
        '<td>' + esc(d.bestDate) + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var records = window.MOUNTAIN_RECORDS;
    if (!records || !records.length) return;
    var c = getColors();
    fillStats(records);
    buildTable(records);
    var barBox = document.getElementById('mountain-bar');
    var lineBox = document.getElementById('mountain-line');
    if (barBox) { barBox.innerHTML = ''; barBox.appendChild(buildBarChart(records, c)); }
    if (lineBox) { lineBox.innerHTML = ''; lineBox.appendChild(buildLineChart(records, c)); }
  }

  function start() {
    if (initialized) return;
    if (!window.MOUNTAIN_RECORDS || !window.MOUNTAIN_RECORDS.length) return;
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
