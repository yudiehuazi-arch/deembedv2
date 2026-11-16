/* ============================================================================
 * copper-canvas-viewer.js —— 约束检查空间几何视口、结果定位与两点测量
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.CopperApp, CC = root.CopperCheck, VI = root.CopperViaInference;
  if (!App || !CC) return;
  var UI = App.UI, $ = App.$;
  var canvas = $('copperCanvas');
  var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  var view = {
    zoom: 1, panX: 0, panY: 0, fitted: false,
    groupIndex: -1, rowIndex: -1, returnY: 0,
    measureMode: false, measure: [], dragging: false, moved: false,
    dragX: 0, dragY: 0, dataVer: -1
  };

  function syncSize() {
    if (!canvas) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 200 && h > 200 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function worldToScreen(x, y) {
    return [x * view.zoom + view.panX, canvas.height - (y * view.zoom + view.panY)];
  }

  function screenToWorld(x, y) {
    return [(x - view.panX) / view.zoom, (canvas.height - y - view.panY) / view.zoom];
  }

  function canvasPoint(e) {
    var r = canvas.getBoundingClientRect();
    var rw = r.width || canvas.width, rh = r.height || canvas.height;
    return [(e.clientX - r.left) * canvas.width / rw, (e.clientY - r.top) * canvas.height / rh];
  }

  function itemLayer(item) {
    return CC.subsetToLayer(item && item.subset, App.layerCount());
  }

  function selectedLayer() {
    var el = $('selCopperCanvasLayer');
    return el && el.value ? +el.value : 0;
  }

  function viaOnLayer(via, layer) {
    if (!layer || !VI || !VI.spanOfVia) return true;
    var span = VI.spanOfVia(via, App.layerCount());
    return !span.start || !span.end || (layer >= span.start && layer <= span.end);
  }

  function visibleItem(item) {
    var layer = selectedLayer();
    if (!layer) return true;
    if (item.type === 'via') return viaOnLayer(item, layer);
    var ownLayer = itemLayer(item);
    // Through All 或无法解析层号的数据必须保留，避免单层筛选静默漏图。
    return !ownLayer || ownLayer === layer;
  }

  function boundsOf(items) {
    var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    function point(x, y, pad) {
      if (!isFinite(x) || !isFinite(y)) return;
      pad = pad || 0;
      b.minX = Math.min(b.minX, x - pad); b.maxX = Math.max(b.maxX, x + pad);
      b.minY = Math.min(b.minY, y - pad); b.maxY = Math.max(b.maxY, y + pad);
    }
    (items || []).forEach(function (item) {
      if (item.origin) point(item.origin[0], item.origin[1], 2);
      if (item.center) point(item.center[0], item.center[1], item.radius || 2);
      for (var i = 0; item.pts && i < item.pts.length - 1; i += 2) point(item.pts[i], item.pts[i + 1], 2);
    });
    if (!isFinite(b.minX)) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    return b;
  }

  function fitBounds(b, padding) {
    syncSize();
    var pad = padding == null ? 54 : padding;
    var spanX = Math.max(10, b.maxX - b.minX), spanY = Math.max(10, b.maxY - b.minY);
    view.zoom = Math.max(0.0001, Math.min(5000,
      Math.min((canvas.width - pad * 2) / spanX, (canvas.height - pad * 2) / spanY)));
    var midX = (b.minX + b.maxX) / 2, midY = (b.minY + b.maxY) / 2;
    view.panX = canvas.width / 2 - midX * view.zoom;
    view.panY = canvas.height / 2 - midY * view.zoom;
    view.fitted = true;
  }

  function selectedGroup() {
    return UI.result && UI.result.groups ? UI.result.groups[view.groupIndex] : null;
  }

  function selectedRow() {
    var g = selectedGroup();
    return g && g.rows ? g.rows[view.rowIndex] : null;
  }

  function shapeForRow(row) {
    if (!row || row.shapeId == null || row.shapeId === 'none') return null;
    return UI.items.find(function (item) {
      return item.type === 'shape' && String(item.id) === String(row.shapeId);
    }) || null;
  }

  function allFailuresEnabled() {
    var el = $('ckCopperCanvasAllFails');
    return !!(el && el.checked);
  }

  function collectFailureHighlights() {
    var out = { vias: {}, shapes: {}, groupCount: 0, rowCount: 0, viaCount: 0, shapeCount: 0 };
    if (!UI.result || !UI.result.groups) return out;
    UI.result.groups.forEach(function (g) {
      var rows = (g.failRows || g.rows || []).filter(function (row) { return row.status === '不符合'; });
      if (!rows.length) return;
      out.groupCount++; out.rowCount += rows.length;
      (g.vias && g.vias.length ? g.vias : [g.via]).forEach(function (via) {
        if (via && via.id != null) out.vias[String(via.id)] = 1;
      });
      rows.forEach(function (row) {
        if (row.shapeId != null && row.shapeId !== 'none' && row.shapeId !== 'via' && !String(row.shapeId).startsWith('span-')) {
          out.shapes[String(row.shapeId)] = 1;
        }
      });
    });
    out.viaCount = Object.keys(out.vias).length;
    out.shapeCount = Object.keys(out.shapes).length;
    return out;
  }

  function activeFailureHighlights() {
    return allFailuresEnabled() ? collectFailureHighlights() :
      { vias: {}, shapes: {}, groupCount: 0, rowCount: 0, viaCount: 0, shapeCount: 0 };
  }

  function fitBoard() {
    fitBounds(boundsOf(UI.items), 58);
    updateReview();
    draw();
  }

  function focusLocated() {
    var g = selectedGroup();
    if (!g) return fitBoard();
    var items = (g.vias || [g.via]).slice();
    var sh = shapeForRow(selectedRow());
    if (sh) items.push(sh);
    var b = boundsOf(items);
    var span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 8);
    var extra = Math.max(10, span * 1.2);
    fitBounds({ minX: b.minX - extra, maxX: b.maxX + extra, minY: b.minY - extra, maxY: b.maxY + extra }, 70);
    draw();
  }

  function focusAllFailures() {
    var failures = collectFailureHighlights();
    var items = UI.items.filter(function (item) {
      return (item.type === 'via' && failures.vias[String(item.id)]) ||
        (item.circle && failures.shapes[String(item.id)]);
    });
    if (items.length) fitBounds(boundsOf(items), 70);
    draw();
  }

  function initLayerSelect() {
    var sel = $('selCopperCanvasLayer');
    if (!sel) return;
    var old = sel.value, n = App.layerCount();
    sel.innerHTML = '<option value="">全部层</option>';
    for (var i = 1; i <= n; i++) {
      var opt = document.createElement('option');
      opt.value = String(i); opt.textContent = 'L' + i; sel.appendChild(opt);
    }
    sel.value = old && +old <= n ? old : '';
  }

  function niceGridStep() {
    var raw = 80 / Math.max(view.zoom, 0.0001);
    var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var ratio = raw / pow;
    return (ratio <= 1 ? 1 : (ratio <= 2 ? 2 : (ratio <= 5 ? 5 : 10))) * pow;
  }

  function drawGrid() {
    if (!$('ckCopperCanvasGrid') || !$('ckCopperCanvasGrid').checked) return;
    var step = niceGridStep(), a = screenToWorld(0, canvas.height), b = screenToWorld(canvas.width, 0);
    ctx.strokeStyle = 'rgba(100,116,139,0.18)'; ctx.lineWidth = 1; ctx.beginPath();
    var x0 = Math.floor(a[0] / step) * step, y0 = Math.floor(a[1] / step) * step;
    for (var x = x0; x <= b[0]; x += step) { var sx = worldToScreen(x, 0)[0]; ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); }
    for (var y = y0; y <= b[1]; y += step) { var sy = worldToScreen(0, y)[1]; ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); }
    ctx.stroke();
  }

  function drawTraces() {
    if (!$('ckCopperCanvasTraces') || !$('ckCopperCanvasTraces').checked) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    UI.items.forEach(function (item) {
      if (item.type !== 'trace' || !item.pts || item.pts.length < 4 || !visibleItem(item)) return;
      ctx.beginPath();
      for (var i = 0; i < item.pts.length - 1; i += 2) {
        var p = worldToScreen(item.pts[i], item.pts[i + 1]);
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = '#22c55e'; ctx.globalAlpha = 0.58; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    });
  }

  function drawShapes(failures) {
    if (!$('ckCopperCanvasShapes') || !$('ckCopperCanvasShapes').checked) return;
    var target = shapeForRow(selectedRow());
    UI.items.forEach(function (item) {
      if (!item.circle || !item.center || !visibleItem(item)) return;
      var p = worldToScreen(item.center[0], item.center[1]);
      var radius = Math.max(2, item.radius * view.zoom);
      var isTarget = target && String(target.id) === String(item.id);
      var isFail = !!failures.shapes[String(item.id)];
      ctx.beginPath(); ctx.arc(p[0], p[1], radius, 0, Math.PI * 2);
      ctx.strokeStyle = (isTarget || isFail) ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = isTarget ? 4 : (isFail ? 3 : 1.5); ctx.stroke();
      if (isTarget || isFail) { ctx.fillStyle = 'rgba(239,68,68,0.18)'; ctx.fill(); }
      if (isFail) {
        ctx.beginPath(); ctx.setLineDash([5, 3]); ctx.arc(p[0], p[1], radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fb7185'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
      }
    });
  }

  function memberMap() {
    var out = {}, g = selectedGroup();
    (g && g.vias || []).forEach(function (v) { out[String(v.id)] = 1; });
    return out;
  }

  function drawVias(failures) {
    if (!$('ckCopperCanvasVias') || !$('ckCopperCanvasVias').checked) return;
    var selected = memberMap();
    UI.items.forEach(function (item) {
      if (item.type !== 'via' || !item.origin || !visibleItem(item)) return;
      var p = worldToScreen(item.origin[0], item.origin[1]);
      var on = !!selected[String(item.id)], isFail = !!failures.vias[String(item.id)];
      ctx.beginPath(); ctx.arc(p[0], p[1], on ? 8 : (isFail ? 6 : 3.5), 0, Math.PI * 2);
      ctx.fillStyle = on ? '#38bdf8' : (isFail ? '#ef4444' : (/SIG/i.test(item.padstack || '') ? '#60a5fa' : '#94a3b8')); ctx.fill();
      if (on || isFail) {
        ctx.beginPath(); ctx.arc(p[0], p[1], on ? 13 : 11, 0, Math.PI * 2);
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = on ? 3 : 2.5; ctx.stroke();
      }
      if (on) {
        ctx.fillStyle = '#e2e8f0'; ctx.font = '12px Segoe UI'; ctx.fillText('Via ' + item.id, p[0] + 15, p[1] - 10);
      }
    });
  }

  function drawMeasure() {
    if (!view.measure.length) return;
    var a = worldToScreen(view.measure[0][0], view.measure[0][1]);
    ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(a[0], a[1], 5, 0, Math.PI * 2); ctx.fill();
    if (view.measure.length < 2) return;
    var b = worldToScreen(view.measure[1][0], view.measure[1][1]);
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(b[0], b[1], 5, 0, Math.PI * 2); ctx.fill();
  }

  function updateMeasureText() {
    var el = $('copperMeasureReadout');
    if (!el) return;
    if (!view.measureMode) { el.textContent = '开启测量标尺后，在画布中依次点击两点。'; return; }
    if (!view.measure.length) { el.textContent = '测量模式：请选择起点。'; return; }
    if (view.measure.length === 1) { el.textContent = '起点 [' + view.measure[0].map(function (v) { return v.toFixed(3); }).join(', ') + '] mil，请选择终点。'; return; }
    var a = view.measure[0], b = view.measure[1], dx = b[0] - a[0], dy = b[1] - a[1];
    var d = Math.sqrt(dx * dx + dy * dy);
    el.textContent = '两点距离 ' + d.toFixed(3) + ' mil / ' + (d * 0.0254).toFixed(4) + ' mm · ΔX ' + Math.abs(dx).toFixed(3) + ' · ΔY ' + Math.abs(dy).toFixed(3);
  }

  function updateReview(failures) {
    var text = $('copperSpatialReviewText'), back = $('btnReturnCopperResults');
    var g = selectedGroup(), row = selectedRow();
    if (back) back.style.display = g ? '' : 'none';
    if (!text) return;
    if (allFailuresEnabled()) {
      failures = failures || collectFailureHighlights();
      text.textContent = failures.groupCount
        ? ('全板不符合标注 · ' + failures.groupCount + ' 个完整孔 · ' + failures.rowCount + ' 条不符合记录 · ' +
          failures.viaCount + ' 个孔段 · ' + failures.shapeCount + ' 处异常铜皮' + (g ? (' · 当前定位 Via ' + g.via.id + ' 保留蓝色标记') : ''))
        : '全板不符合标注 · 当前没有不符合记录。';
      return;
    }
    if (!g) { text.textContent = UI.items.length ? '当前为全板视图，可缩放、平移、筛层或使用测量标尺。' : '请先导入板级 Item 数据。'; return; }
    if (!row) {
      text.textContent = 'Via ' + g.via.id + ' · ' + (g.via.net || '无网络') + ' · L' + g.startLayer + '-L' + g.endLayer +
        ' · 完整孔定位 · ' + (g.vias || [g.via]).length + ' 个孔段全部高亮';
      return;
    }
    var layer = typeof row.layer === 'number' ? ('L' + row.layer) : String(row.layer || '—');
    var source = (row.sourceViaIds || []).map(function (id) { return 'Via ' + id; }).join('/') + ' · ' + (row.sourcePadstack || '无 Padstack');
    text.textContent = 'Via ' + g.via.id + ' · ' + (g.via.net || '无网络') + ' · L' + g.startLayer + '-L' + g.endLayer +
      ' · ' + layer + ' ' + row.checkType + ' · 来源 ' + source + ' · 实测 ' + row.actual + ' / 规则 ' + (row.expect || '无') + ' · ' + row.status;
  }

  function visibilityStats() {
    var totals = { via: 0, shape: 0, trace: 0 }, shown = { via: 0, shape: 0, trace: 0 };
    UI.items.forEach(function (item) {
      var key = item.type === 'via' ? 'via' : (item.circle ? 'shape' : (item.type === 'trace' ? 'trace' : ''));
      if (!key) return;
      totals[key]++;
      if (visibleItem(item)) shown[key]++;
    });
    return { totals: totals, shown: shown };
  }

  function draw() {
    if (!canvas) return;
    syncSize();
    var failures = activeFailureHighlights();
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#07111f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawGrid(); drawTraces(); drawShapes(failures); drawVias(failures); drawMeasure();
    }
    var hud = $('copperCanvasHud'), stats = visibilityStats();
    if (hud) {
      hud.textContent = '缩放 ' + Math.round(view.zoom * 100) + '% · ' + (selectedLayer() ? ('L' + selectedLayer()) : '全部层') +
        ' · Via ' + stats.shown.via + '/' + stats.totals.via + ' · Shape ' + stats.shown.shape + '/' + stats.totals.shape +
        (allFailuresEnabled() ? (' · 不符合孔 ' + failures.groupCount + ' · 异常铜皮 ' + failures.shapeCount) : '');
      hud.dataset.failGroups = String(failures.groupCount);
      hud.dataset.failRows = String(failures.rowCount);
      hud.dataset.failVias = String(failures.viaCount);
      hud.dataset.failShapes = String(failures.shapeCount);
    }
    updateMeasureText(); updateReview(failures);
  }

  function renderCopperCanvas() {
    if (!canvas) return;
    var dataChanged = view.dataVer !== UI.dataVer;
    initLayerSelect(); syncSize();
    if (!view.fitted || dataChanged) {
      if (dataChanged) {
        view.groupIndex = -1; view.rowIndex = -1; view.measure = [];
        if ($('selCopperCanvasLayer')) $('selCopperCanvasLayer').value = '';
      }
      view.dataVer = UI.dataVer; fitBounds(boundsOf(UI.items), 58);
    }
    draw();
  }

  function zoomAtCenter(factor) {
    var sx = canvas.width / 2, sy = canvas.height / 2, before = screenToWorld(sx, sy);
    view.zoom = Math.max(0.0001, Math.min(5000, view.zoom * factor));
    view.panX = sx - before[0] * view.zoom;
    view.panY = canvas.height - sy - before[1] * view.zoom;
    draw();
  }

  function locateCopperResult(groupIndex, rowIndex) {
    if (!UI.result || !UI.result.groups[groupIndex]) return;
    view.dataVer = UI.dataVer;
    view.groupIndex = groupIndex; view.rowIndex = typeof rowIndex === 'number' ? rowIndex : -1; view.returnY = root.scrollY || 0;
    var sel = $('selCopperCanvasLayer');
    App.showTab('canvas');
    // 定位只聚焦并高亮完整孔，不自动过滤其他层；否则会让其他孔群看起来像“缺失”。
    if (sel) sel.value = '';
    updateReview();
    var go = function () { focusLocated(); };
    if (root.requestAnimationFrame) root.requestAnimationFrame(go); else setTimeout(go, 0);
  }

  function returnToResults() {
    var si = view.groupIndex;
    App.showTab('result');
    var go = function () {
      var btn = document.querySelector('.copper-locate-btn[data-si="' + si + '"]');
      var target = btn ? btn.closest('.set') : $('grp-' + si);
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
      if (target) { target.classList.add('pulse-target'); setTimeout(function () { target.classList.remove('pulse-target'); }, 1400); }
      else if (root.scrollTo) root.scrollTo(0, view.returnY);
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(go); else setTimeout(go, 0);
  }

  function bindCanvas() {
    if (!canvas) return;
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = canvasPoint(e), before = screenToWorld(p[0], p[1]);
      view.zoom = Math.max(0.0001, Math.min(5000, view.zoom * (e.deltaY < 0 ? 1.18 : 0.84)));
      view.panX = p[0] - before[0] * view.zoom;
      view.panY = canvas.height - p[1] - before[1] * view.zoom;
      draw();
    }, { passive: false });
    canvas.addEventListener('mousedown', function (e) {
      if (view.measureMode) return;
      view.dragging = true; view.moved = false; view.dragX = e.clientX; view.dragY = e.clientY; canvas.classList.add('dragging');
    });
    root.addEventListener('mousemove', function (e) {
      if (!view.dragging) return;
      var dx = e.clientX - view.dragX, dy = e.clientY - view.dragY;
      if (Math.abs(dx) + Math.abs(dy) > 2) view.moved = true;
      view.panX += dx; view.panY -= dy; view.dragX = e.clientX; view.dragY = e.clientY; draw();
    });
    root.addEventListener('mouseup', function () { view.dragging = false; if (canvas) canvas.classList.remove('dragging'); });
    canvas.addEventListener('click', function (e) {
      if (!view.measureMode || view.moved) return;
      var p = canvasPoint(e), world = screenToWorld(p[0], p[1]);
      if (view.measure.length >= 2) view.measure = [];
      view.measure.push(world); draw();
    });
  }

  function bindControls() {
    if ($('btnCopperFit')) $('btnCopperFit').onclick = fitBoard;
    if ($('btnCopperFocus')) $('btnCopperFocus').onclick = focusLocated;
    if ($('btnCopperZoomIn')) $('btnCopperZoomIn').onclick = function () { zoomAtCenter(1.25); };
    if ($('btnCopperZoomOut')) $('btnCopperZoomOut').onclick = function () { zoomAtCenter(0.8); };
    if ($('btnCopperMeasure')) $('btnCopperMeasure').onclick = function () {
      view.measureMode = !view.measureMode;
      $('btnCopperMeasure').classList.toggle('on', view.measureMode);
      canvas.classList.toggle('measure-on', view.measureMode);
      draw();
    };
    if ($('btnCopperClearMeasure')) $('btnCopperClearMeasure').onclick = function () { view.measure = []; draw(); };
    if ($('btnReturnCopperResults')) $('btnReturnCopperResults').onclick = returnToResults;
    if ($('ckCopperCanvasAllFails')) $('ckCopperCanvasAllFails').onchange = function () {
      if ($('ckCopperCanvasAllFails').checked) {
        if ($('selCopperCanvasLayer')) $('selCopperCanvasLayer').value = '';
        if ($('ckCopperCanvasVias')) $('ckCopperCanvasVias').checked = true;
        if ($('ckCopperCanvasShapes')) $('ckCopperCanvasShapes').checked = true;
        focusAllFailures();
      } else draw();
    };
    ['selCopperCanvasLayer', 'ckCopperCanvasVias', 'ckCopperCanvasShapes', 'ckCopperCanvasTraces', 'ckCopperCanvasGrid'].forEach(function (id) {
      if ($(id)) $(id).onchange = draw;
    });
    if (root.ResizeObserver && canvas) new root.ResizeObserver(function () { syncSize(); draw(); }).observe(canvas.parentElement);
    bindCanvas(); updateReview();
  }

  root.renderCopperCanvas = renderCopperCanvas;
  root.locateCopperResult = locateCopperResult;
  root.returnToCopperResults = returnToResults;
  root.CopperCanvas = {
    state: view,
    render: renderCopperCanvas,
    fitBoard: fitBoard,
    focusLocated: focusLocated,
    focusAllFailures: focusAllFailures,
    collectFailureHighlights: collectFailureHighlights,
    locateResult: locateCopperResult,
    returnToResults: returnToResults,
    isVisible: visibleItem
  };
  bindControls();
})(typeof window !== 'undefined' ? window : globalThis);
