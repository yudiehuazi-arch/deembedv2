/* ============================================================================
 * pour-canvas-navigation.js —— 铜皮结果定位、问题铜皮标注与返回原条目
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var esc = root.escHtml || function (str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var cleanMsg = root.PourCleanMsg || function (s) {
    return String(s == null ? '' : s).replace(/^[\s✅❌⚠️]+/u, '').trim();
  };
  var safeRAF = root.PourSafeRAF || function (fn) {
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(fn);
    else setTimeout(fn, 0);
  };

  function resultKeyOf(record, index) {
    return record.groupKey || record._rawKey || (record.checkCategory + '_' +
      (record.viaId || record.traceId || record.shapeId) + '_' + record.layer + '_' + index);
  }

  function findResultByKey(itemKey) {
    var State = root.State;
    var sources = [State.filteredResults, State.groupedResults, State.rawResults];
    for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      var source = sources[sourceIndex] || [];
      for (var index = 0; index < source.length; index++) {
        if (resultKeyOf(source[index], index) === itemKey) return source[index];
      }
    }
    return null;
  }

  function findResultRow(itemKey) {
    var rows = document.querySelectorAll('#tblResultsBody tr[data-result-key]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-result-key') === itemKey) return rows[i];
    }
    return null;
  }

  function rememberPourResultPosition(itemKey) {
    var row = findResultRow(itemKey);
    var mainEl = document.querySelector('.eda-center-col > main');
    root.State.canvas.returnPosition = {
      itemKey: itemKey,
      page: root.State.page,
      rowTop: row ? row.getBoundingClientRect().top : 0,
      mainScrollTop: mainEl ? mainEl.scrollTop : 0,
      scrollX: root.scrollX || 0,
      scrollY: root.scrollY || 0
    };
    var btn = document.getElementById('btnReturnPourResults');
    if (btn) btn.style.display = '';
  }

  function collectProblemShapeIds(record) {
    if (!record) return [];
    var candidates = record.subRecords && record.subRecords.length ? record.subRecords : [record];
    if (!record.pass) candidates = candidates.filter(function (sub) { return !sub.pass; });
    var ids = [];
    candidates.forEach(function (sub) {
      [sub.shapeId, sub.targetShapeId, sub.nearestShapeId].forEach(function (id) {
        if (id != null && ids.indexOf(String(id)) < 0) ids.push(String(id));
      });
      (sub.targetShapeIds || []).concat(sub.referenceShapeIds || []).forEach(function (id) {
        if (id != null && ids.indexOf(String(id)) < 0) ids.push(String(id));
      });
    });
    if (!ids.length && record.checkCategory === 'trace_ref_margin') {
      var failedLayers = candidates.map(function (sub) { return String(sub.refLayer || '').toUpperCase(); });
      (root.State.shapes || []).forEach(function (shape) {
        if (failedLayers.indexOf(String(shape.layer || '').toUpperCase()) >= 0) ids.push(String(shape.id));
      });
    }
    return ids;
  }

  function collectProblemShapeLayers(record) {
    if (!record) return [];
    var candidates = record.subRecords && record.subRecords.length ? record.subRecords : [record];
    if (!record.pass) candidates = candidates.filter(function (sub) { return !sub.pass; });
    var layers = [];
    candidates.forEach(function (sub) {
      var category = sub.checkCategory || record.checkCategory;
      var layer = category === 'trace_ref_margin' ? sub.refLayer
        : (sub.layer || sub.nearestShapeLayer || sub.refLayer);
      if (layer && layers.indexOf(String(layer)) < 0) layers.push(String(layer));
    });
    return layers;
  }

  function returnToPourResults() {
    var State = root.State;
    var saved = State.canvas.returnPosition;
    root.switchTab('tabResults');
    if (!saved) return;
    State.page = saved.page || 1;
    if (typeof root.renderResultsTable === 'function') root.renderResultsTable();
    safeRAF(function () {
      var row = findResultRow(saved.itemKey);
      var mainEl = document.querySelector('.eda-center-col > main');
      if (mainEl && typeof saved.mainScrollTop === 'number') mainEl.scrollTop = saved.mainScrollTop;
      if (row) {
        var delta = row.getBoundingClientRect().top - saved.rowTop;
        if (mainEl && Math.abs(delta) > 4) mainEl.scrollTop += delta;
        if (typeof root.scrollTo === 'function') root.scrollTo(saved.scrollX, (root.scrollY || 0) + delta);
        row.classList.add('pour-located-flash');
        setTimeout(function () { row.classList.remove('pour-located-flash'); }, 1800);
      } else if (typeof root.scrollTo === 'function') {
        root.scrollTo(saved.scrollX, saved.scrollY);
      }
    });
  }

  function renderPourCanvasReviewBox(itemKey) {
    var State = root.State;
    var box = document.getElementById('pourCanvasReviewBox');
    var titleEl = document.getElementById('pourCanvasRevTitle');
    var bodyEl = document.getElementById('pourCanvasRevBody');
    if (!box || !bodyEl) return;
    State.activeReviewKey = itemKey;
    var r = findResultByKey(itemKey);
    var isReviewed = State.reviewedItems.has(itemKey);
    if (titleEl && r) titleEl.textContent = (r.checkCategoryName || '铜皮检查') + ' · ' + (r.targetLabel || itemKey);
    var barStyle = isReviewed
      ? 'background:rgba(16,185,129,0.18);border:1px solid rgba(52,211,153,0.55);'
      : 'background:rgba(245,158,11,0.15);border:1px solid rgba(251,191,36,0.45);';
    var safeKey = esc(itemKey);
    var visibleLayerNotice = '';
    if (State.canvas.shapeLayerMode === 'problem' && (State.canvas.problemShapeLayers || []).length) {
      visibleLayerNotice = '当前仅显示问题层铜皮：' + State.canvas.problemShapeLayers.join('、');
    } else if (State.canvas.shapeLayerMode === 'layer' && (State.canvas.visibleShapeLayers || []).length) {
      visibleLayerNotice = '当前仅显示铜皮层：' + State.canvas.visibleShapeLayers.join('、');
    }
    bodyEl.innerHTML =
      '<div style="' + barStyle + 'border-radius:6px;padding:8px 10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:' + (isReviewed ? '#6ee7b7' : '#fde68a') + ';margin:0">' +
          '<input type="checkbox" id="chkPourSpatialReview" data-no-persist ' + (isReviewed ? 'checked' : '') + ' onchange="toggleReviewItem(\'' + safeKey + '\', this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:#10b981">' +
          '<span>' + (isReviewed ? '已复核 · 明细已同步' : '勾选复核此项') + '</span></label>' +
        '<button type="button" class="btn small" onclick="toggleReviewItem(\'' + safeKey + '\', ' + (!isReviewed) + ')" style="padding:3px 9px;font-size:11px;border:none;background:' + (isReviewed ? '#334155' : '#10b981') + ';color:#ffffff">' +
          (isReviewed ? '取消复核' : '确认复核') + '</button></div>' +
      (r ? '<div style="font-size:11px;color:#cbd5e1;line-height:1.5;margin-bottom:8px">' + esc(cleanMsg(r.message)) + '</div>' : '') +
      (visibleLayerNotice
        ? '<div style="font-size:11px;color:#bfdbfe;margin-bottom:8px">' + esc(visibleLayerNotice) + '</div>' : '') +
      ((State.canvas.highlightShapeIds || []).length
        ? '<div style="font-size:11px;color:#fecaca;margin-bottom:8px">红色轮廓：问题铜皮 Shape #' + esc(State.canvas.highlightShapeIds.join(', #')) + '</div>' : '') +
      '<div style="display:flex;justify-content:flex-end"><button type="button" class="btn sec small" onclick="returnToPourResults()">返回结果明细</button></div>';
    box.style.display = 'block';
  }

  function closePourReviewBox() {
    var box = document.getElementById('pourCanvasReviewBox');
    if (box) box.style.display = 'none';
    root.State.activeReviewKey = null;
  }

  function centerLocatedTarget(checkCategory, targetId) {
    var State = root.State;
    var canvas = document.getElementById('mainCanvas');
    var w = canvas ? (canvas.width || 900) : 900;
    var h = canvas ? (canvas.height || 600) : 600;
    var via = (State.vias || []).find(function (v) { return String(v.id) === String(targetId); });
    var trace = (State.traces || []).find(function (t) { return String(t.id) === String(targetId); });
    var shape = (State.shapes || []).find(function (s) { return String(s.id) === String(targetId); });
    var tx = null, ty = null;
    if ((checkCategory === 'via_coverage' || checkCategory === 'special_shape') && via) {
      tx = via.x; ty = via.y;
    } else if (checkCategory === 'trace_ref_margin' && trace && trace.bbox) {
      tx = (trace.bbox.minX + trace.bbox.maxX) / 2; ty = (trace.bbox.minY + trace.bbox.maxY) / 2;
    } else if (shape && shape.bbox) {
      tx = (shape.bbox.minX + shape.bbox.maxX) / 2; ty = (shape.bbox.minY + shape.bbox.maxY) / 2;
    }
    if (tx != null && ty != null) {
      State.canvas.zoom = 5.5;
      State.canvas.panX = w / 2 - tx * State.canvas.zoom;
      State.canvas.panY = h / 2 + ty * State.canvas.zoom;
      State.canvas.hasInitialFit = true;
    }
  }

  function locateElementInCanvas(checkCategory, targetId, itemKey) {
    var result = itemKey ? findResultByKey(itemKey) : null;
    var problemLayers = collectProblemShapeLayers(result);
    if (itemKey) rememberPourResultPosition(itemKey);
    root.State.canvas.highlightShapeIds = collectProblemShapeIds(result);
    root.State.canvas.activeProblem = result ? {
      itemKey: itemKey,
      checkCategory: checkCategory,
      x: result.viaCoord ? result.viaCoord[0] : null,
      y: result.viaCoord ? result.viaCoord[1] : null,
      requiredDist: result.requiredDist || (result.subRecords && result.subRecords[0] ? result.subRecords[0].requiredDist : null),
      layers: problemLayers
    } : null;
    if (typeof root.showCanvasProblemLayers === 'function') root.showCanvasProblemLayers(problemLayers, true);
    root.State.canvas.deferNextTabRender = true;
    root.switchTab('tabCanvas');
    safeRAF(function () {
      if (typeof root.resizeCanvas === 'function') root.resizeCanvas();
      centerLocatedTarget(checkCategory, targetId);
      if (itemKey) renderPourCanvasReviewBox(itemKey);
      if (typeof root.renderCanvas === 'function') root.renderCanvas();
    });
  }

  root.renderPourCanvasReviewBox = renderPourCanvasReviewBox;
  root.closePourReviewBox = closePourReviewBox;
  root.returnToPourResults = returnToPourResults;
  root.locateElementInCanvas = locateElementInCanvas;
})(typeof window !== 'undefined' ? window : globalThis);
