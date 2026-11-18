/* ============================================================================
 * pour-canvas-viewer.js —— 铜皮检查模块：2D 空间几何视口、标尺测量与定位复核浮窗
 * ========================================================================== */
(function (root) {
'use strict';
  if (typeof document === 'undefined') return;
  var NET_COLORS = {
    GND: '#475569',
    '25_N': '#c084fc',
    '25_P': '#84cc16',
    '26_N': '#22c55e',
    '26_P': '#06b6d4',
    '105_P': '#38bdf8',
    '105_N': '#818cf8',
    '106_P': '#f472b6',
    '106_N': '#fb7185'
  };
  var DYNAMIC_NET_PALETTE = ['#38bdf8', '#c084fc', '#84cc16', '#22c55e', '#06b6d4', '#f43f5e', '#eab308', '#ec4899', '#a855f7', '#14b8a6'];
  function getNetColor(netName) {
    if (!netName) return '#94a3b8';
    if (NET_COLORS[netName]) return NET_COLORS[netName];
    var h = 0;
    for (var i = 0; i < netName.length; i++) h = (h * 31 + netName.charCodeAt(i)) >>> 0;
    return DYNAMIC_NET_PALETTE[h % DYNAMIC_NET_PALETTE.length];
  }
  function resizeCanvas() {
    var canvas = document.getElementById('mainCanvas');
    var container = document.getElementById('canvasContainer');
    if (!canvas || !container) return;
    canvas.width = container.clientWidth || 920;
    canvas.height = container.clientHeight || 640;
  }
  function worldToScreen(wx, wy) {
    var c = root.State.canvas;
    return {
      x: c.panX + wx * c.zoom,
      y: c.panY - wy * c.zoom
    };
  }
  function screenToWorld(sx, sy) {
    var c = root.State.canvas;
    return {
      x: (sx - c.panX) / c.zoom,
      y: -(sy - c.panY) / c.zoom
    };
  }
  function canvasViewBounds(canvas, marginPx) {
    var c = root.State.canvas;
    var margin = (marginPx || 24) / Math.max(c.zoom, 0.0001);
    var x1 = (0 - c.panX) / c.zoom, x2 = ((canvas.width || 920) - c.panX) / c.zoom;
    var y1 = -((canvas.height || 640) - c.panY) / c.zoom, y2 = -(0 - c.panY) / c.zoom;
    return { minX: Math.min(x1, x2) - margin, maxX: Math.max(x1, x2) + margin,
      minY: Math.min(y1, y2) - margin, maxY: Math.max(y1, y2) + margin };
  }
  function bboxInView(bbox, view) {
    return !bbox || (bbox.maxX >= view.minX && bbox.minX <= view.maxX &&
      bbox.maxY >= view.minY && bbox.minY <= view.maxY);
  }
  function pointInView(x, y, view) {
    return x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;
  }
  function fitCanvasToLayout() {
    var State = root.State;
    var canvas = document.getElementById('mainCanvas');
    if (!canvas) return;
    var w = canvas.width || 920;
    var h = canvas.height || 640;
    var minX = Infinity, maxX = -Infinity;
    var minY = Infinity, maxY = -Infinity;
    (State.shapes || []).forEach(function (s) {
      if (!s.bbox) return;
      if (s.bbox.minX < minX) minX = s.bbox.minX;
      if (s.bbox.maxX > maxX) maxX = s.bbox.maxX;
      if (s.bbox.minY < minY) minY = s.bbox.minY;
      if (s.bbox.maxY > maxY) maxY = s.bbox.maxY;
    });
    (State.vias || []).forEach(function (v) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    });
    (State.traces || []).forEach(function (t) {
      if (!t.bbox) return;
      if (t.bbox.minX < minX) minX = t.bbox.minX;
      if (t.bbox.maxX > maxX) maxX = t.bbox.maxX;
      if (t.bbox.minY < minY) minY = t.bbox.minY;
      if (t.bbox.maxY > maxY) maxY = t.bbox.maxY;
    });
    if (minX === Infinity) return;
    var spanX = Math.max(maxX - minX, 100);
    var spanY = Math.max(maxY - minY, 100);
    var zoomX = (w * 0.85) / spanX;
    var zoomY = (h * 0.85) / spanY;
    State.canvas.zoom = Math.min(zoomX, zoomY);
    var midX = (minX + maxX) / 2;
    var midY = (minY + maxY) / 2;
    State.canvas.panX = w / 2 - midX * State.canvas.zoom;
    State.canvas.panY = h / 2 + midY * State.canvas.zoom;
    renderCanvas();
  }
  function resetCanvasView() {
    fitCanvasToLayout();
  }
  function zoomCanvas(factor) {
    var State = root.State;
    var canvas = document.getElementById('mainCanvas');
    if (!canvas) return;
    var cx = (canvas.width || 920) / 2;
    var cy = (canvas.height || 640) / 2;
    var newZoom = Math.max(0.01, Math.min(500, State.canvas.zoom * factor));
    State.canvas.panX = cx - (cx - State.canvas.panX) * (newZoom / State.canvas.zoom);
    State.canvas.panY = cy - (cy - State.canvas.panY) * (newZoom / State.canvas.zoom);
    State.canvas.zoom = newZoom;
    renderCanvas();
  }
  function layerKey(layer) {
    return String(layer == null ? '' : layer).trim().toUpperCase();
  }
  function layerOrder(layer) {
    var key = layerKey(layer);
    if (key === 'TOP') return 1;
    if (key === 'BOTTOM') return 9999;
    var logical = key.match(/^L0*(\d+)$/);
    var physical = key.match(/^0*(\d{1,2})(?=[A-Z])/);
    return logical || physical ? parseInt((logical || physical)[1], 10) : 5000;
  }
  function uniqueShapeLayers() {
    var seen = {};
    return (root.State.shapes || []).map(function (shape) { return String(shape.layer || '').trim(); })
      .filter(function (layer) {
        var key = layerKey(layer);
        if (!key || seen[key]) return false;
        seen[key] = true;
        return true;
      }).sort(function (a, b) {
        return layerOrder(a) - layerOrder(b) || a.localeCompare(b, undefined, { numeric: true });
      });
  }
  function refreshCanvasShapeLayerOptions() {
    var select = document.getElementById('selCanvasShapeLayer');
    if (!select) return;
    var c = root.State.canvas;
    var problemLayers = c.problemShapeLayers || [];
    var options = [{ value: '__ALL__', label: '铜皮层：全部层' }];
    if (problemLayers.length) {
      options.push({ value: '__PROBLEM__', label: '问题层：' + problemLayers.join('、') });
    }
    uniqueShapeLayers().forEach(function (layer) {
      options.push({ value: layer, label: '铜皮层：' + layer });
    });
    select.innerHTML = '';
    options.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
    var selected = c.shapeLayerMode === 'problem' ? '__PROBLEM__'
      : (c.shapeLayerMode === 'layer' && c.visibleShapeLayers.length ? c.visibleShapeLayers[0] : '__ALL__');
    select.value = options.some(function (item) { return item.value === selected; }) ? selected : '__ALL__';
  }
  function setCanvasShapeLayer(value, deferRender) {
    var c = root.State.canvas;
    if (value === '__PROBLEM__' && (c.problemShapeLayers || []).length) {
      c.shapeLayerMode = 'problem';
      c.visibleShapeLayers = c.problemShapeLayers.slice();
    } else if (value && value !== '__ALL__') {
      c.shapeLayerMode = 'layer';
      c.visibleShapeLayers = [value];
    } else {
      c.shapeLayerMode = 'all';
      c.visibleShapeLayers = [];
    }
    refreshCanvasShapeLayerOptions();
    if (!deferRender) {
      renderCanvas();
      if (root.State.activeReviewKey && typeof root.renderPourCanvasReviewBox === 'function') {
        root.renderPourCanvasReviewBox(root.State.activeReviewKey);
      }
    }
  }
  function showCanvasProblemLayers(layers, deferRender) {
    var available = uniqueShapeLayers();
    var aliases = root.PourChecker && root.PourChecker.physicalLayerAlias;
    var requested = (layers || []).map(layerKey).filter(Boolean);
    var resolved = available.filter(function (actual) {
      return requested.some(function (target) {
        return layerKey(actual) === target || (aliases && aliases(actual) === aliases(target));
      });
    });
    root.State.canvas.problemShapeLayers = resolved.length ? resolved : requested;
    setCanvasShapeLayer(requested.length ? '__PROBLEM__' : '__ALL__', deferRender);
  }
  function isShapeLayerVisible(shape) {
    var layers = root.State.canvas.visibleShapeLayers || [];
    if (root.State.canvas.shapeLayerMode === 'all' || !layers.length) return true;
    return layers.some(function (layer) { return layerKey(layer) === layerKey(shape.layer); });
  }
  function toggleCanvasLayer(layerKey) {
    var c = root.State.canvas;
    if (layerKey === 'shapes') c.showShapes = !c.showShapes;
    if (layerKey === 'vias') c.showVias = !c.showVias;
    if (layerKey === 'traces') c.showTraces = !c.showTraces;
    if (layerKey === 'ports') c.showPorts = !c.showPorts;
    if (layerKey === 'netLabels') c.showNetLabels = c.showNetLabels === false;
    if (layerKey === 'objectIds') c.showObjectIds = c.showObjectIds === false;
    if (layerKey === 'defects') c.showDefects = !c.showDefects;
    var map = {
      btnToggleShapes: c.showShapes,
      btnToggleVias: c.showVias,
      btnToggleTraces: c.showTraces,
      btnTogglePorts: c.showPorts,
      btnToggleNetLabels: c.showNetLabels !== false,
      btnToggleObjectIds: c.showObjectIds !== false,
      btnToggleDefects: c.showDefects
    };
    Object.keys(map).forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.className = map[id] ? 'active' : '';
    });
    renderCanvas();
  }
  function toggleMeasureMode() {
    var c = root.State.canvas;
    c.measureMode = !c.measureMode;
    c.measurePoints = [];
    var btn = document.getElementById('btnMeasureMode');
    if (btn) {
      btn.className = c.measureMode ? 'active' : '';
      btn.textContent = c.measureMode ? '测距中 · 点击两点' : '测距标尺';
    }
    renderCanvas();
  }
  function renderCanvas() {
    var State = root.State;
    var canvas = document.getElementById('mainCanvas');
    if (!canvas || !canvas.getContext) return;
    var readout = document.getElementById('canvasRulerReadout');
    if (readout) {
      readout.textContent = '比例: ' + State.canvas.zoom.toFixed(2) + 'x | 视口中心: [' +
        (-State.canvas.panX / State.canvas.zoom).toFixed(0) + ', ' +
        (State.canvas.panY / State.canvas.zoom).toFixed(0) + ']';
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    var viewBounds = canvasViewBounds(canvas, 28);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, w, h);
    var PC = root.PourChecker;
    var highlightedShapeIds = new Set((State.canvas.highlightShapeIds || []).map(String));
    /* 1. 铜皮轮廓 */
    if (State.canvas.showShapes && State.shapes) {
      State.shapes.forEach(function (shape) {
        if (!isShapeLayerVisible(shape) || !bboxInView(shape.bbox, viewBounds)) return;
        var isProblemShape = highlightedShapeIds.has(String(shape.id));
        ctx.save();
        ctx.fillStyle = isProblemShape ? 'rgba(239, 68, 68, 0.42)' : 'rgba(180, 83, 9, 0.22)';
        ctx.strokeStyle = isProblemShape ? '#f87171' : '#d97706';
        ctx.lineWidth = isProblemShape ? Math.max(3, 2.4 * State.canvas.zoom) : Math.max(1.0, 1.2 * State.canvas.zoom);
        var rings = PC && PC.shapeRings ? PC.shapeRings(shape) : [];
        if (!rings.length && PC && PC.flattenBoundary) {
          var exteriorRing = PC.flattenBoundary(shape);
          if (exteriorRing.length) rings.push(exteriorRing);
        }
        ctx.beginPath();
        rings.forEach(function (ring) {
          ring.forEach(function (point, index) {
            var sp = worldToScreen(point[0], point[1]);
            if (index === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          });
          ctx.closePath();
        });
        if (rings.length) {
          // evenodd 不依赖 EDA 导出的 CW/CCW 绕向，所有 Void 均稳定镂空。
          ctx.fill('evenodd');
          ctx.stroke();
        }
        if (State.canvas.showObjectIds !== false && (State.canvas.zoom > 1.5 || isProblemShape) && shape.centroid) {
          var cent = worldToScreen(shape.centroid.x, shape.centroid.y);
          ctx.fillStyle = isProblemShape ? '#fecaca' : '#fde68a';
          ctx.font = isProblemShape ? 'bold 12px monospace' : '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText((isProblemShape ? '问题铜皮 · ' : '') + 'Shape #' + shape.id + ' · ' + shape.layer, cent.x, cent.y);
        }
        ctx.restore();
      });
    }
    /* 当前孔铺铜问题：明确画出“孔心阈值范围”，范围内出现任意铜皮即达标。 */
    var activeProblem = State.canvas.activeProblem;
    if (activeProblem && activeProblem.checkCategory === 'via_coverage' && activeProblem.x != null && activeProblem.y != null) {
      var problemCenter = worldToScreen(activeProblem.x, activeProblem.y);
      var searchRadius = Math.max(1, Number(activeProblem.requiredDist || 0) * State.canvas.zoom);
      ctx.save();
      ctx.strokeStyle = '#fb7185';
      ctx.fillStyle = '#fecdd3';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.beginPath();
      ctx.arc(problemCenter.x, problemCenter.y, searchRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(problemCenter.x - 7, problemCenter.y);
      ctx.lineTo(problemCenter.x + 7, problemCenter.y);
      ctx.moveTo(problemCenter.x, problemCenter.y - 7);
      ctx.lineTo(problemCenter.x, problemCenter.y + 7);
      ctx.stroke();
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('铜皮搜索范围 ≤ ' + activeProblem.requiredDist + ' mil', problemCenter.x, problemCenter.y - searchRadius - 8);
      ctx.restore();
    }
    /* 2. 过孔 */
    if (State.canvas.showVias && State.vias) {
      State.vias.forEach(function (v) {
        if (!pointInView(v.x, v.y, viewBounds)) return;
        var sp = worldToScreen(v.x, v.y);
        var isGnd = v.net && v.net.toUpperCase() === 'GND';
        if (isGnd) {
          var padR = Math.max(6.0, 4.0 * State.canvas.zoom);
          var drillR = Math.max(2.0, 1.8 * State.canvas.zoom);
          ctx.save();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, padR, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(71, 85, 105, 0.75)';
          ctx.fill();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, drillR, 0, Math.PI * 2);
          ctx.fillStyle = '#020617';
          ctx.fill();
          ctx.strokeStyle = '#cbd5e1';
          ctx.stroke();
          if (State.canvas.showNetLabels !== false) {
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('GND', sp.x, sp.y);
          }
          if (State.canvas.showObjectIds !== false && State.canvas.zoom > 2.2) {
            ctx.fillStyle = '#cbd5e1';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText('#' + v.id, sp.x, sp.y - padR - 2);
          }
          ctx.restore();
        } else {
          var rad = Math.max(3.5, 4.0 * State.canvas.zoom);
          var dR = Math.max(1.8, 2.0 * State.canvas.zoom);
          ctx.save();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, rad, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
          ctx.fill();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, dR, 0, Math.PI * 2);
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 0.8;
          ctx.stroke();
          if (State.canvas.showObjectIds !== false && State.canvas.zoom > 2.2) {
            ctx.fillStyle = '#fde047';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('#' + v.id, sp.x, sp.y - rad - 2);
          }
          ctx.restore();
        }
      });
    }
    /* 3. 走线（直线与圆弧参数化采样） */
    if (State.canvas.showTraces && State.traces) {
      State.traces.forEach(function (trace) {
        if (!bboxInView(trace.bbox, viewBounds)) return;
        ctx.save();
        var col = getNetColor(trace.net);
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        var traceWidth = Math.max(1.8, (trace.width || 6.0) * State.canvas.zoom);
        ctx.lineWidth = traceWidth;
        trace.segments.forEach(function (seg) {
          if (seg.type === 'line') {
            var p1 = worldToScreen(seg.x1, seg.y1);
            var p2 = worldToScreen(seg.x2, seg.y2);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          } else if (seg.type === 'arc' && PC && PC.sampleArcPoints) {
            var pts = PC.sampleArcPoints([seg.cx, seg.cy], seg.radius, [seg.x1, seg.y1], [seg.x2, seg.y2], seg.dir || 'CCW', 32);
            ctx.beginPath();
            pts.forEach(function (pt, i) {
              var sp = worldToScreen(pt[0], pt[1]);
              if (i === 0) ctx.moveTo(sp.x, sp.y);
              else ctx.lineTo(sp.x, sp.y);
            });
            ctx.stroke();
          }
        });
        if (State.canvas.showNetLabels !== false && State.canvas.zoom > 1.2 && trace.segments.length > 0) {
          var firstSeg = trace.segments[0];
          var midX = (firstSeg.x1 + (firstSeg.x2 || firstSeg.x1)) / 2;
          var midY = (firstSeg.y1 + (firstSeg.y2 || firstSeg.y1)) / 2;
          var spm = worldToScreen(midX, midY);
          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = col;
          ctx.textAlign = 'center';
          ctx.fillText(trace.net + ' · ' + trace.layer, spm.x, spm.y - traceWidth / 2 - 3);
        }
        ctx.restore();
      });
    }
    /* 4. 端口 P1~P4 标注 */
    if (State.canvas.showPorts && State.traces && State.traces.length > 0) {
      var allMinX = Infinity, allMaxX = -Infinity, allMinY = Infinity, allMaxY = -Infinity;
      State.traces.forEach(function (t) {
        if (!t.bbox) return;
        allMinX = Math.min(allMinX, t.bbox.minX);
        allMaxX = Math.max(allMaxX, t.bbox.maxX);
        allMinY = Math.min(allMinY, t.bbox.minY);
        allMaxY = Math.max(allMaxY, t.bbox.maxY);
      });
      var centerX = (allMinX + allMaxX) / 2;
      var centerY = (allMinY + allMaxY) / 2;
      var netEndpoints = {};
      State.traces.forEach(function (t) {
        if (!netEndpoints[t.net]) netEndpoints[t.net] = [];
        t.segments.forEach(function (s) {
          netEndpoints[t.net].push({ x: s.x1, y: s.y1 });
          netEndpoints[t.net].push({ x: s.x2, y: s.y2 });
        });
      });
      Object.keys(netEndpoints).forEach(function (net) {
        if (net === 'GND' || net === 'UNKNOWN') return;
        var pts = netEndpoints[net];
        if (!pts || !pts.length) return;
        var maxDist = -1, outerPt = null;
        pts.forEach(function (p) {
          var d = Math.hypot(p.x - centerX, p.y - centerY);
          if (d > maxDist) { maxDist = d; outerPt = p; }
        });
        if (!outerPt) return;
        var portName = '';
        if (net === '26_N' || (outerPt.y > centerY && outerPt.x > centerX)) portName = 'P1';
        else if (net === '25_N' || (outerPt.y < centerY && outerPt.x < centerX)) portName = 'P2';
        else if (net === '25_P' || (outerPt.y > centerY && outerPt.x < centerX)) portName = 'P3';
        else if (net === '26_P' || (outerPt.y < centerY && outerPt.x > centerX)) portName = 'P4';
        if (portName) {
          var sp = worldToScreen(outerPt.x, outerPt.y);
          ctx.save();
          ctx.font = 'bold 20px monospace';
          ctx.fillStyle = '#fde047';
          ctx.textAlign = outerPt.x >= centerX ? 'left' : 'right';
          var offsetX = outerPt.x >= centerX ? 14 : -14;
          var offsetY = outerPt.y >= centerY ? -10 : 18;
          ctx.fillText(portName, sp.x + offsetX, sp.y + offsetY);
          ctx.restore();
        }
      });
    }
    /* 5. 五类异常位置标记 */
    if (State.canvas.showDefects && State.summary && typeof root.drawPourDefectMarkers === 'function') {
      root.drawPourDefectMarkers(ctx, worldToScreen, viewBounds);
    }
    /* 6. 两点测距标尺 */
    if (State.canvas.measurePoints.length > 0) {
      var pts = State.canvas.measurePoints.map(function (p) { return worldToScreen(p.x, p.y); });
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
      });
      if (pts.length === 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
        var w1 = State.canvas.measurePoints[0];
        var w2 = State.canvas.measurePoints[1];
        var dMil = Math.hypot(w1.x - w2.x, w1.y - w2.y);
        var txt = '实测距离: ' + (dMil * 0.0254).toFixed(3) + ' mm / ' + dMil.toFixed(2) + ' mil';
        var mx = (pts[0].x + pts[1].x) / 2;
        var my = (pts[0].y + pts[1].y) / 2;
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#0f172a';
        var tw = ctx.measureText(txt).width;
        ctx.fillRect(mx - tw / 2 - 4, my - 16, tw + 8, 18);
        ctx.fillStyle = '#fde68a';
        ctx.textAlign = 'center';
        ctx.fillText(txt, mx, my - 3);
      }
      ctx.restore();
    }
  }
  function initCanvas() {
    var canvas = document.getElementById('mainCanvas');
    if (!canvas || canvas.__pourBound) return;
    canvas.__pourBound = true;
    refreshCanvasShapeLayerOptions();
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;
      var mouseY = e.clientY - rect.top;
      var zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      var newZoom = Math.max(0.01, Math.min(500, root.State.canvas.zoom * zoomFactor));
      root.State.canvas.panX = mouseX - (mouseX - root.State.canvas.panX) * (newZoom / root.State.canvas.zoom);
      root.State.canvas.panY = mouseY - (mouseY - root.State.canvas.panY) * (newZoom / root.State.canvas.zoom);
      root.State.canvas.zoom = newZoom;
      renderCanvas();
    });
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      root.State.canvas.isDragging = true;
      root.State.canvas.dragStartX = e.clientX - root.State.canvas.panX;
      root.State.canvas.dragStartY = e.clientY - root.State.canvas.panY;
    });
    root.addEventListener('mousemove', function (e) {
      if (root.State.canvas.isDragging) {
        root.State.canvas.panX = e.clientX - root.State.canvas.dragStartX;
        root.State.canvas.panY = e.clientY - root.State.canvas.dragStartY;
        renderCanvas();
      }
    });
    root.addEventListener('mouseup', function () {
      root.State.canvas.isDragging = false;
    });
    canvas.addEventListener('click', function (e) {
      if (!root.State.canvas.measureMode) return;
      var rect = canvas.getBoundingClientRect();
      var worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      root.State.canvas.measurePoints.push(worldPos);
      if (root.State.canvas.measurePoints.length > 2) {
        root.State.canvas.measurePoints = [worldPos];
      }
      renderCanvas();
    });
    root.addEventListener('resize', function () {
      if (root.State.activeTab === 'tabCanvas') {
        resizeCanvas();
        renderCanvas();
      }
    });
  }
  root.initCanvas = initCanvas;
  root.resizeCanvas = resizeCanvas;
  root.fitCanvasToLayout = fitCanvasToLayout;
  root.resetCanvasView = resetCanvasView;
  root.zoomCanvas = zoomCanvas;
  root.toggleCanvasLayer = toggleCanvasLayer;
  root.refreshCanvasShapeLayerOptions = refreshCanvasShapeLayerOptions;
  root.setCanvasShapeLayer = setCanvasShapeLayer;
  root.showCanvasProblemLayers = showCanvasProblemLayers;
  root.toggleMeasureMode = toggleMeasureMode;
  root.renderCanvas = renderCanvas;
  if (typeof root.initApp === 'function') {
    root.initApp();
  }
})(typeof window !== 'undefined' ? window : globalThis);
