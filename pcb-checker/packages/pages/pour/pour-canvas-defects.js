/* ============================================================================
 * pour-canvas-defects.js —— 铜皮几何视图：五类异常筛选与位置标记
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var CATEGORIES = {
    via_coverage: { index: '1', label: '孔层铺铜', color: '#ef4444', buttonId: 'btnCanvasDefectCov' },
    special_shape: { index: '2', label: '异型铜皮', color: '#a855f7', buttonId: 'btnCanvasDefectSpecial' },
    trace_ref_margin: { index: '3', label: '参考层超宽', color: '#f59e0b', buttonId: 'btnCanvasDefectMargin' },
    isolated_copper: { index: '4', label: '孤立小铜皮', color: '#06b6d4', buttonId: 'btnCanvasDefectSmall' },
    arc_radius: { index: '5', label: '圆弧半径', color: '#ec4899', buttonId: 'btnCanvasDefectArc' }
  };
  var markerCache = { source: null, lists: {}, grids: {} };

  function viaCoverageProblemLabel(record) {
    if (typeof root.formatPourResultProblem === 'function') {
      return root.formatPourResultProblem(record);
    }
    var layer = record && (record.layer || record.layerListStr);
    return (layer ? String(layer) + ' 层' : '目标层') + '缺铜皮';
  }

  function viaCoverageListKey(problemLabel) {
    return 'via_coverage\u0000' + String(problemLabel || '');
  }

  function getViaCoverageProblemTypes() {
    var types = [], byLabel = {};
    (root.State.rawResults || []).forEach(function (record) {
      if (!record || record.pass || record.checkCategory !== 'via_coverage') return;
      var label = viaCoverageProblemLabel(record);
      if (!byLabel[label]) {
        byLabel[label] = { key: label, label: label, count: 0 };
        types.push(byLabel[label]);
      }
      byLabel[label].count += 1;
    });
    return types;
  }

  function findById(items, id) {
    return (items || []).find(function (item) { return String(item.id) === String(id); });
  }

  function defectMarker(record) {
    var State = root.State;
    if (!record) return null;
    if (record.viaCoord && isFinite(record.viaCoord[0]) && isFinite(record.viaCoord[1])) {
      return { x: record.viaCoord[0], y: record.viaCoord[1], targetId: record.viaId, targetLabel: 'Via #' + record.viaId };
    }
    if (record.viaId != null) {
      var via = findById(State.vias, record.viaId);
      if (via) return { x: via.x, y: via.y, targetId: via.id, targetLabel: 'Via #' + via.id };
    }
    if (record.centroid && isFinite(record.centroid.x) && isFinite(record.centroid.y)) {
      return { x: record.centroid.x, y: record.centroid.y, targetId: record.shapeId, targetLabel: 'Shape #' + record.shapeId };
    }
    if (record.centerCoord && isFinite(record.centerCoord[0]) && isFinite(record.centerCoord[1])) {
      return { x: record.centerCoord[0], y: record.centerCoord[1], targetId: record.shapeId, targetLabel: 'Shape #' + record.shapeId };
    }
    if (record.traceId != null) {
      var trace = findById(State.traces, record.traceId);
      if (trace && trace.bbox) return {
        x: (trace.bbox.minX + trace.bbox.maxX) / 2,
        y: (trace.bbox.minY + trace.bbox.maxY) / 2,
        targetId: trace.id,
        targetLabel: 'Trace #' + trace.id
      };
    }
    if (record.shapeId != null) {
      var shape = findById(State.shapes, record.shapeId);
      if (shape && shape.centroid) return {
        x: shape.centroid.x, y: shape.centroid.y,
        targetId: shape.id, targetLabel: 'Shape #' + shape.id
      };
    }
    return null;
  }

  function syncDefectButton(button, active) {
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function setCanvasViaCoverageProblemFilter(problemKey) {
    var canvas = root.State.canvas;
    var key = String(problemKey || '');
    canvas.defectFilter = 'via_coverage';
    canvas.showDefects = true;
    canvas.defectSubFilter = canvas.defectSubFilter === key ? '' : key;
    refreshCanvasDefectButtons();
    if (typeof root.renderCanvas === 'function') root.renderCanvas();
  }

  function refreshCanvasViaCoverageSubfilters() {
    var canvas = root.State.canvas || {};
    var menu = document.getElementById('canvasViaCoverageSubfilters');
    var parent = document.getElementById('btnCanvasDefectCov');
    if (!menu) return;
    var types = getViaCoverageProblemTypes();
    var selected = String(canvas.defectSubFilter || '');
    if (selected && !types.some(function (type) { return type.key === selected; })) {
      selected = '';
      canvas.defectSubFilter = '';
    }
    menu.textContent = '';
    if (!types.length) {
      var empty = document.createElement('span');
      empty.className = 'canvas-defect-subfilter-empty';
      empty.textContent = '当前无孔层铺铜问题';
      menu.appendChild(empty);
    } else {
      types.forEach(function (type) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = selected === type.key ? 'active' : '';
        button.setAttribute('data-via-coverage-problem', type.key);
        button.setAttribute('aria-pressed', selected === type.key ? 'true' : 'false');
        var label = document.createElement('span');
        label.textContent = type.label;
        var count = document.createElement('span');
        count.className = 'canvas-defect-subfilter-count';
        count.textContent = String(type.count);
        button.appendChild(label);
        button.appendChild(count);
        button.addEventListener('click', function (event) {
          event.stopPropagation();
          setCanvasViaCoverageProblemFilter(type.key);
        });
        menu.appendChild(button);
      });
    }
    var expanded = canvas.showDefects !== false && canvas.defectFilter === 'via_coverage';
    menu.hidden = !expanded;
    if (parent) parent.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function refreshCanvasDefectButtons() {
    var canvas = root.State.canvas || {};
    var selected = canvas.showDefects === false ? '' : (canvas.defectFilter || 'all');
    syncDefectButton(document.getElementById('btnCanvasDefectAll'), selected === 'all');
    Object.keys(CATEGORIES).forEach(function (key) {
      syncDefectButton(document.getElementById(CATEGORIES[key].buttonId), selected === key);
    });
    refreshCanvasViaCoverageSubfilters();
  }

  function setCanvasDefectFilter(category) {
    var canvas = root.State.canvas;
    var next = CATEGORIES[category] ? category : 'all';
    var current = CATEGORIES[canvas.defectFilter] ? canvas.defectFilter : 'all';
    if (canvas.showDefects !== false && current === next && !(next === 'via_coverage' && canvas.defectSubFilter)) {
      canvas.showDefects = false;
    } else {
      canvas.defectFilter = next;
      canvas.showDefects = true;
    }
    canvas.defectSubFilter = '';
    refreshCanvasDefectButtons();
    if (typeof root.renderCanvas === 'function') root.renderCanvas();
  }

  function rebuildMarkerCache() {
    var source = root.State.rawResults || [];
    if (markerCache.source === source) return;
    var lists = { all: [] }, seen = {}, subSeen = {};
    Object.keys(CATEGORIES).forEach(function (key) { lists[key] = []; });
    source.forEach(function (record) {
      if (record.pass || !CATEGORIES[record.checkCategory]) return;
      var marker = defectMarker(record);
      if (!marker) return;
      var markerKey = record.checkCategory + '|' + marker.targetLabel + '|' +
        Number(marker.x).toFixed(4) + '|' + Number(marker.y).toFixed(4);
      marker.category = record.checkCategory;
      if (!seen[markerKey]) {
        seen[markerKey] = true;
        lists.all.push(marker);
        lists[record.checkCategory].push(marker);
      }
      if (record.checkCategory === 'via_coverage') {
        var problemLabel = viaCoverageProblemLabel(record);
        var listKey = viaCoverageListKey(problemLabel);
        if (!lists[listKey]) lists[listKey] = [];
        var childMarkerKey = listKey + '|' + markerKey;
        if (!subSeen[childMarkerKey]) {
          subSeen[childMarkerKey] = true;
          lists[listKey].push(marker);
        }
      }
    });
    var grids = {}, PC = root.PourChecker;
    if (PC && PC.buildPointGrid) {
      Object.keys(lists).forEach(function (key) {
        grids[key] = PC.buildPointGrid(lists[key], 500, function (marker) { return marker; });
      });
    }
    markerCache = { source: source, lists: lists, grids: grids };
  }

  function visibleMarkers(filter, viewBounds) {
    rebuildMarkerCache();
    var key = CATEGORIES[filter] ? filter : 'all';
    if (key === 'via_coverage' && root.State.canvas.defectSubFilter) {
      key = viaCoverageListKey(root.State.canvas.defectSubFilter);
    }
    var PC = root.PourChecker, grid = markerCache.grids[key];
    if (viewBounds && grid && PC && PC.queryPointGrid) {
      return PC.queryPointGrid(grid, viewBounds.minX, viewBounds.minY, viewBounds.maxX, viewBounds.maxY);
    }
    return markerCache.lists[key] || [];
  }

  function drawPourDefectMarkers(ctx, worldToScreen, viewBounds) {
    var filter = root.State.canvas.defectFilter || 'all';
    visibleMarkers(filter, viewBounds).forEach(function (marker) {
      var meta = CATEGORIES[marker.category];
      var point = worldToScreen(marker.x, marker.y);
      ctx.save();
      ctx.strokeStyle = meta.color; ctx.fillStyle = meta.color; ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(point.x, point.y, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(point.x, point.y - 8); ctx.lineTo(point.x + 8, point.y);
      ctx.lineTo(point.x, point.y + 8); ctx.lineTo(point.x - 8, point.y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(meta.index, point.x, point.y + 0.5); ctx.restore();
    });
  }

  root.PourDefectCategories = CATEGORIES;
  root.getPourDefectMarker = defectMarker;
  root.getViaCoverageProblemTypes = getViaCoverageProblemTypes;
  root.refreshCanvasDefectButtons = refreshCanvasDefectButtons;
  root.setCanvasDefectFilter = setCanvasDefectFilter;
  root.setCanvasViaCoverageProblemFilter = setCanvasViaCoverageProblemFilter;
  root.drawPourDefectMarkers = drawPourDefectMarkers;
  refreshCanvasDefectButtons();
})(typeof window !== 'undefined' ? window : globalThis);
