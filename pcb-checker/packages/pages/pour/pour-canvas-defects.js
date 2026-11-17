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

  function refreshCanvasDefectButtons() {
    var selected = (root.State.canvas && root.State.canvas.defectFilter) || 'all';
    var allButton = document.getElementById('btnCanvasDefectAll');
    if (allButton) allButton.className = selected === 'all' ? 'active' : '';
    Object.keys(CATEGORIES).forEach(function (key) {
      var button = document.getElementById(CATEGORIES[key].buttonId);
      if (button) button.className = selected === key ? 'active' : '';
    });
  }

  function setCanvasDefectFilter(category) {
    root.State.canvas.defectFilter = CATEGORIES[category] ? category : 'all';
    root.State.canvas.showDefects = true;
    refreshCanvasDefectButtons();
    if (typeof root.renderCanvas === 'function') root.renderCanvas();
  }

  function drawPourDefectMarkers(ctx, worldToScreen) {
    var filter = root.State.canvas.defectFilter || 'all';
    var marked = {};
    (root.State.rawResults || []).forEach(function (record) {
      if (record.pass || !CATEGORIES[record.checkCategory]) return;
      if (filter !== 'all' && record.checkCategory !== filter) return;
      var marker = defectMarker(record);
      if (!marker) return;
      var dedupeKey = record.checkCategory + '|' + marker.targetLabel + '|' +
        Number(marker.x).toFixed(4) + '|' + Number(marker.y).toFixed(4);
      if (marked[dedupeKey]) return;
      marked[dedupeKey] = true;
      var meta = CATEGORIES[record.checkCategory];
      var point = worldToScreen(marker.x, marker.y);
      ctx.save();
      ctx.strokeStyle = meta.color;
      ctx.fillStyle = meta.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - 8);
      ctx.lineTo(point.x + 8, point.y);
      ctx.lineTo(point.x, point.y + 8);
      ctx.lineTo(point.x - 8, point.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(meta.index, point.x, point.y + 0.5);
      ctx.restore();
    });
  }

  root.PourDefectCategories = CATEGORIES;
  root.getPourDefectMarker = defectMarker;
  root.refreshCanvasDefectButtons = refreshCanvasDefectButtons;
  root.setCanvasDefectFilter = setCanvasDefectFilter;
  root.drawPourDefectMarkers = drawPourDefectMarkers;
  refreshCanvasDefectButtons();
})(typeof window !== 'undefined' ? window : globalThis);
