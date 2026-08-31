/* =============================================================================
 * travel-map.js — 旅行足迹地图（纯 SVG 自研，零地图库依赖）
 * -----------------------------------------------------------------------------
 * 数据：fetch assets/js/china-geo.json（中国省级 GeoJSON，离线）
 * 依赖：assets/js/travel-data.js 提供 TRAVEL_PROVINCES（已访省份，用于高亮）
 *
 * 设计要点：
 *   1) 底图 = 各省份 <path>，已访省份加 .visited（主题强调色），未访浅灰。
 *   2) 省名 = 各省份几何质心处的 <text>，仅显示省份文字（不画城市点）。
 *   3) 默认视图框住大陆架 + 台湾 + 海南，均居中显示；
 *      海南省多边形南端含南海诸岛（低至 3.8°N），计算默认视野框时排除纬度 < 15°N 的点，
 *      避免南海诸岛把大陆主体向下拉偏、缩小（南端岛屿仍照常绘制，缩放后可见）。
 *   4) 交互：初始锁定（不能缩放/拖拽）；点击地图解锁；滚轮按光标放大、拖拽平移；
 *      点击地图外任意处 → 锁定并复位视角。
 *   5) 省名防重叠：低缩放下用贪心算法隐藏被压住的标签（已访省份优先保留）。
 *   6) 主题：颜色全走 CSS 变量，亮/暗模式随 data-theme 自动切换，无需 JS 重绘。
 *   7) 层级：所有省份形状绘制在底层 group（gShapes），所有省名文字绘制在顶层
 *      group（gLabels，最后绘制）；文字始终覆盖在形状之上，互不遮挡可读性。
 * ========================================================================== */

(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var VB_W = 1000, VB_H = 660, MARGIN = 7;
  var MIN_S = 1, MAX_S = 8;
  var BBOX_LAT_FLOOR = 15; // 默认视野框纬度下限（°N）；低于此视为南海诸岛，仅绘不框
  var PROV_FONT = 12;            // 省份字体（像素）；与 CSS --prov-font 保持一致
  var CITY_FONT = PROV_FONT / 2; // 城市文字 = 省份字体的一半

  // 线性渐变（光影质感）：stop 颜色走 CSS 变量，主题切换时自动跟随
  function makeGrad(id) {
    var grad = document.createElementNS(SVGNS, 'linearGradient');
    grad.setAttribute('id', id);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0.3'); grad.setAttribute('y2', '1'); // 左上受光、右下转暗
    var cls = id === 'provUnvisitedGrad' ? 'prov-unv' : 'prov-vis';
    var s1 = document.createElementNS(SVGNS, 'stop');
    s1.setAttribute('offset', '0%'); s1.setAttribute('class', cls + '-light');
    var s2 = document.createElementNS(SVGNS, 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('class', cls + '-dark');
    grad.appendChild(s1); grad.appendChild(s2);
    return grad;
  }

  function makeGlow(id) {
    var f = document.createElementNS(SVGNS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '-30%'); f.setAttribute('y', '-30%');
    f.setAttribute('width', '160%'); f.setAttribute('height', '160%');
    var ds = document.createElementNS(SVGNS, 'feDropShadow');
    ds.setAttribute('dx', '0'); ds.setAttribute('dy', '0');
    ds.setAttribute('stdDeviation', '2.4');
    ds.setAttribute('flood-color', 'var(--default-bg-color)');
    ds.setAttribute('flood-opacity', '0.5');
    f.appendChild(ds);
    return f;
  }

  var initialized = false;

  // 视图状态（group transform = translate(TX,TY) scale(S)）
  var S = 1, TX = 0, TY = 0;
  var locked = true;          // 初始锁定：点击地图后解锁
  var dragging = false, lastX = 0, lastY = 0;
  // 触屏手势状态：双指捏合缩放 + 双击缩放
  var pinchStartDist = 0, pinchStartS = 1, pinchCX = 0, pinchCY = 0;
  var lastTapTime = 0, lastTapX = 0, lastTapY = 0;

  var visitedSet = {};        // 已访省份全称集合
  var labels = [];            // {name, cx, cy, w0, h0, area, visited, el}
  var g = null, svg = null, hintEl = null;

  function shortName(full) {
    return String(full || '')
      .replace(/省$|市$|自治区$|特别行政区$|壮族|回族|维吾尔$/g, '')
      .replace(/^内蒙古.*/, '内蒙古');
  }

  function project(lon, lat) {
    return [offX + (lon - lonMin) * scale, offY + (latMax - lat) * scale];
  }
  var lonMin, lonMax, latMin, latMax, scale, offX, offY;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function ringToPath(ring) {
    var d = '';
    for (var i = 0; i < ring.length; i++) {
      var p = project(ring[i][0], ring[i][1]);
      d += (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ';
    }
    return d + 'Z ';
  }

  function geomToPath(geom) {
    var d = '', polys, i, j;
    if (geom.type === 'Polygon') polys = [geom.coordinates];
    else if (geom.type === 'MultiPolygon') polys = geom.coordinates;
    else return d;
    for (i = 0; i < polys.length; i++)
      for (j = 0; j < polys[i].length; j++) d += ringToPath(polys[i][j]);
    return d;
  }

  // 取「点数最多」的环做质心，保证标签落在主陆块上（MultiPolygon 含离岛时更稳）
  function geomCentroid(geom) {
    var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    var best = null, bestN = 0, i, j, k, ring;
    for (i = 0; i < polys.length; i++)
      for (j = 0; j < polys[i].length; j++) {
        ring = polys[i][j];
        if (ring.length > bestN) { bestN = ring.length; best = ring; }
      }
    var sx = 0, sy = 0;
    for (k = 0; k < best.length; k++) { sx += best[k][0]; sy += best[k][1]; }
    return project(sx / best.length, sy / best.length);
  }

  function computeBBox(features) {
    var minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    features.forEach(function (f) {
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(function (poly) {
        poly.forEach(function (ring) {
          ring.forEach(function (pt) {
            // 纬度低于此阈值的点属南海诸岛（海南省辖区南端），仅绘制不计入默认视野框，
            // 避免把大陆架主体向下拉偏、缩小。海南主岛（≥18°N）仍完整可见、居中。
            if (pt[1] < BBOX_LAT_FLOOR) return;
            if (pt[0] < minLon) minLon = pt[0];
            if (pt[0] > maxLon) maxLon = pt[0];
            if (pt[1] < minLat) minLat = pt[1];
            if (pt[1] > maxLat) maxLat = pt[1];
          });
        });
      });
    });
    lonMin = minLon; lonMax = maxLon; latMin = minLat; latMax = maxLat;
    var lonSpan = lonMax - lonMin || 1, latSpan = latMax - latMin || 1;
    scale = Math.min((VB_W - 2 * MARGIN) / lonSpan, (VB_H - 2 * MARGIN) / latSpan);
    var drawW = lonSpan * scale, drawH = latSpan * scale;
    offX = (VB_W - drawW) / 2;
    offY = (VB_H - drawH) / 2;
  }

  function applyTransform() {
    g.setAttribute('transform', 'translate(' + TX + ' ' + TY + ') scale(' + S + ')');
  }

  // 贪心去重：优先保留已访、面积大的省名；被压住的标签隐藏
  function updateLabels() {
    if (!labels.length) return;
    var placed = [];
    var order = labels.slice().sort(function (a, b) {
      return (b.visited ? 1 : 0) - (a.visited ? 1 : 0) || b.area - a.area;
    });
    order.forEach(function (l) {
      var w = l.w0 * S, h = l.h0 * S;
      var cx = l.cx * S + TX, cy = l.cy * S + TY;
      var box = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
      var hit = false, i;
      for (i = 0; i < placed.length; i++) {
        var p = placed[i];
        if (box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) {
          hit = true; break;
        }
      }
      if (hit) l.el.style.display = 'none';
      else { l.el.style.display = ''; placed.push(box); }
    });
  }

  // 以 (mx,my) 为锚点缩放到绝对比例 newS（捏合缩放调用，避免连续 factor 累积漂移）
  function zoomTo(mx, my, newS) {
    newS = clamp(newS, MIN_S, MAX_S);
    if (newS === S) return;
    TX = mx - (mx - TX) * (newS / S);
    TY = my - (my - TY) * (newS / S);
    S = newS;
    applyTransform();
    updateLabels();
  }
  function zoomAt(mx, my, factor) { zoomTo(mx, my, S * factor); }

  function resetView() {
    S = 1; TX = 0; TY = 0;
    applyTransform();
    updateLabels();
  }

  function bindInteractions() {
    svg.addEventListener('wheel', function (e) {
      if (locked) return;
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width * VB_W;
      var my = (e.clientY - rect.top) / rect.height * VB_H;
      zoomAt(mx, my, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    svg.addEventListener('mousedown', function (e) {
      if (locked) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var rect = svg.getBoundingClientRect();
      TX += (e.clientX - lastX) / rect.width * VB_W;
      TY += (e.clientY - lastY) / rect.height * VB_H;
      lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    window.addEventListener('mouseup', function () { dragging = false; });

    // 点击地图 → 解锁缩放/拖拽（阻止冒泡，避免触发外部复位）
    svg.addEventListener('click', function (e) {
      e.stopPropagation();
      if (locked) {
        locked = false;
        svg.classList.add('zoomable');
        if (hintEl) hintEl.style.display = 'block';
      }
    });
    // 点击地图外任意处 → 锁定并复位
    document.addEventListener('click', function () {
      if (!locked) {
        locked = true;
        svg.classList.remove('zoomable');
        if (hintEl) hintEl.style.display = 'none';
        resetView();
      }
    });

    // 触屏：单击解锁 / 单指拖拽 / 双指捏合缩放 / 双击缩放
    svg.addEventListener('touchstart', function (e) {
      if (locked) { locked = false; svg.classList.add('zoomable'); if (hintEl) hintEl.style.display = 'block'; return; }
      if (e.touches.length === 2) {
        // 双指捏合：记录起始指距与中心点，以中心为锚点做绝对缩放
        dragging = false;
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy) || 1;
        pinchStartS = S;
        var rect = svg.getBoundingClientRect();
        pinchCX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        pinchCY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        return;
      }
      if (e.touches.length === 1) {
        var now = Date.now();
        var tdx = e.touches[0].clientX - lastTapX;
        var tdy = e.touches[0].clientY - lastTapY;
        if (now - lastTapTime < 300 && Math.hypot(tdx, tdy) < 30 && !locked) {
          // 双击：已放大则缩小回，否则以触点为中心放大
          var rect2 = svg.getBoundingClientRect();
          var mx = (e.touches[0].clientX - rect2.left) / rect2.width * VB_W;
          var my = (e.touches[0].clientY - rect2.top) / rect2.height * VB_H;
          zoomAt(mx, my, S > 1.4 ? 1 / 1.8 : 1.8);
          lastTapTime = 0; // 防止三击连发
          dragging = false;
          return;
        }
        lastTapTime = now; lastTapX = e.touches[0].clientX; lastTapY = e.touches[0].clientY;
        dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      }
    }, { passive: false });

    svg.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        // 双指捏合缩放：比例 = 当前指距 / 起始指距，基于起始比例做绝对缩放
        if (!pinchStartDist) return;
        e.preventDefault();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.hypot(dx, dy);
        var rect = svg.getBoundingClientRect();
        var mx = pinchCX / rect.width * VB_W;
        var my = pinchCY / rect.height * VB_H;
        zoomTo(mx, my, pinchStartS * (dist / pinchStartDist));
        return;
      }
      if (!dragging || e.touches.length !== 1) return;
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      TX += (e.touches[0].clientX - lastX) / rect.width * VB_W;
      TY += (e.touches[0].clientY - lastY) / rect.height * VB_H;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      applyTransform();
    }, { passive: false });

    svg.addEventListener('touchend', function (e) {
      dragging = false;
      if (e.touches.length === 0) pinchStartDist = 0; // 双指全部抬起后复位捏合基线
    });
  }

  function build(geo) {
    var features = (geo.features || []).filter(function (f) {
      return f.properties && f.properties.name; // 丢弃空名特征（南海诸岛），避免拉偏聚焦中心
    });
    computeBBox(features); // 默认视图框住大陆架 + 台湾 + 海南，均居中显示

    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'travel-svg');
    svg.setAttribute('viewBox', '0 0 ' + VB_W + ' ' + VB_H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // 渐变 / 滤镜定义（光影质感，颜色走 CSS 变量以响应主题切换）
    var defs = document.createElementNS(SVGNS, 'defs');
    defs.appendChild(makeGrad('provUnvisitedGrad'));
    defs.appendChild(makeGrad('provVisitedGrad'));
    defs.appendChild(makeGlow('provGlow'));
    svg.appendChild(defs);

    g = document.createElementNS(SVGNS, 'g');
    svg.appendChild(g);
    // 内部拆两层：gShapes（底层，所有省份形状）/ gLabels（顶层，所有省名文字）
    var gShapes = document.createElementNS(SVGNS, 'g');
    var gLabels = document.createElementNS(SVGNS, 'g');
    g.appendChild(gShapes);
    g.appendChild(gLabels);

    var fontSize = PROV_FONT;
    features.forEach(function (f) {
      var name = f.properties.name;
      var isVisited = !!visitedSet[name];

      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', geomToPath(f.geometry));
      path.setAttribute('class', 'province' + (isVisited ? ' visited' : ''));
      gShapes.appendChild(path); // 形状置于底层

      var c = geomCentroid(f.geometry);
      var text = document.createElementNS(SVGNS, 'text');
      text.setAttribute('x', c[0].toFixed(1));
      text.setAttribute('y', c[1].toFixed(1));
      text.setAttribute('class', 'province-label');
      text.textContent = shortName(name);
      gLabels.appendChild(text); // 文字置于顶层，最后绘制 → 覆盖所有形状

      // 面积近似：质心所在最大环点数
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      var area = 0;
      polys.forEach(function (poly) { poly.forEach(function (ring) { if (ring.length > area) area = ring.length; }); });

      labels.push({
        name: name, cx: c[0], cy: c[1],
        w0: shortName(name).length * fontSize, h0: fontSize * 1.3,
        area: area, visited: isVisited, el: text
      });
    });

    // ── 城市标注（城市级聚合：每城一个中心圆点 + 标签，参与统一避让）────────
    var gCities = document.createElementNS(SVGNS, 'g');
    (window.TRAVEL_CITIES_CN || []).forEach(function (c) {
      if (!c.coord || c.coord.length < 2) return;
      var p = project(c.coord[0], c.coord[1]);
      var dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('cx', p[0].toFixed(1));
      dot.setAttribute('cy', p[1].toFixed(1));
      dot.setAttribute('r', 2.2);
      dot.setAttribute('class', 'city-dot');
      gCities.appendChild(dot);

      var t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', p[0].toFixed(1));
      t.setAttribute('y', (p[1] - 6).toFixed(1));
      t.setAttribute('class', 'city-label');
      t.textContent = c.name;
      gLabels.appendChild(t); // 城市名置于顶层文字组，纳入统一避让

      // area:0 → 避让排序中优先级最低（省名优先），被压住时先隐藏
      labels.push({
        name: c.name, cx: p[0], cy: p[1] - 6,
        w0: c.name.length * CITY_FONT, h0: CITY_FONT * 1.3,
        area: 0, visited: false, el: t
      });
    });
    g.insertBefore(gCities, gLabels); // 城市点位于省份形状之上、省名之下

    var box = document.getElementById('travel-map');
    box.innerHTML = '';
    box.appendChild(svg);
    hintEl = document.createElement('div');
    hintEl.className = 'travel-map-hint';
    hintEl.textContent = '已启用缩放 · 拖拽平移 · 点击外部复位';
    hintEl.style.display = 'none';
    box.appendChild(hintEl);

    bindInteractions();
    updateLabels();
  }

  function fillStats() {
    var prov = (window.TRAVEL_PROVINCES || []).length;
    var city = (window.TRAVEL_CITIES_CN || []).length;
    var diary = document.querySelectorAll('.travel-card').length;
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-prov', prov); set('stat-city', city); set('stat-diary', diary);
    (window.TRAVEL_PROVINCES || []).forEach(function (p) { visitedSet[p.name] = true; });
  }

  function init() {
    if (initialized) return;
    var box = document.getElementById('travel-map');
    if (!box) return;
    initialized = true;

    try { fillStats(); } catch (e) { /* 统计失败不影响地图 */ }

    fetch('assets/js/china-geo.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(build)
      .catch(function (err) {
        box.innerHTML = '<p style="padding:2rem;text-align:center;opacity:.6">' +
          '中国地图数据加载失败（china-geo.json）：' + err.message + '</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
