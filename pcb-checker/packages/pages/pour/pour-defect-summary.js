/* ============================================================================
 * pour-defect-summary.js —— 缺陷规律分析：五类异常总结、板上位置与放大查看
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var esc = root.escHtml || function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var CATEGORY = {
    via_coverage: { order: 1, type: '孔层铺铜缺失', color: '#ef4444', fix: '在异常层补铺铜，确保孔心检测半径内存在铜皮。' },
    special_shape: { order: 2, type: '异型铜皮不匹配', color: '#a855f7', fix: '按模板重生成异型铜皮，并消除反焊盘侵占。' },
    trace_ref_margin: { order: 3, type: '走线投影或两侧邻近铜不符合', color: '#f59e0b', fix: '补齐首尾端所有被检查层反焊盘豁免区以外的完整走线投影参考铜，并确保整条走线左右两侧各有铜皮位于规则距离内。' },
    isolated_copper: { order: 4, type: '孤立小铜皮', color: '#06b6d4', fix: '删除无连接碎铜，或增加同层过孔可靠接地。' },
    arc_radius: { order: 5, type: '铜皮圆弧半径过小', color: '#ec4899', fix: '增大铜皮圆角半径至规则阈值以上。' }
  };
  var currentModel = null;

  function idMap(items) {
    var map = {};
    (items || []).forEach(function (item) { map[String(item.id)] = item; });
    return map;
  }

  function identity(record, viaMap) {
    var via = record.viaId != null ? viaMap[String(record.viaId)] : null;
    return {
      padstack: record.viaPadstack || (via && via.padstack) || '—',
      network: record.viaNet || record.traceNet || (via && via.net) || '—'
    };
  }

  function groupedObjects(records) {
    if (root.PourChecker && typeof root.PourChecker.groupResultsByTargetObject === 'function') {
      return root.PourChecker.groupResultsByTargetObject(records || []);
    }
    return records || [];
  }

  function buildRows(defects, State) {
    var map = {}, viasById = idMap(State.vias);
    (defects || []).forEach(function (record) {
      var config = CATEGORY[record.checkCategory];
      if (!config || record.pass) return;
      var id = identity(record, viasById);
      var key = [record.checkCategory, id.padstack, id.network].join('|');
      if (!map[key]) map[key] = {
        category: record.checkCategory, config: config, padstack: id.padstack,
        network: id.network, detailCount: 0, objectCount: 0, layers: {}, records: [], points: [], pointKeys: {}
      };
      var row = map[key];
      row.detailCount++;
      row.records.push(record);
      var layer = record.layer || record.refLayer || record.traceLayer;
      if (layer) row.layers[String(layer)] = 1;
    });
    return Object.keys(map).map(function (key) {
      var row = map[key];
      var objects = groupedObjects(row.records);
      row.objectCount = objects.length;
      objects.forEach(function (object) {
        var marker = typeof root.getPourDefectMarker === 'function' ? root.getPourDefectMarker(object) : null;
        if (!marker && object.subRecords) {
          object.subRecords.some(function (record) {
            marker = typeof root.getPourDefectMarker === 'function' ? root.getPourDefectMarker(record) : null;
            return !!marker;
          });
        }
        if (!marker) return;
        var pointKey = marker.targetLabel + '|' + marker.x + '|' + marker.y;
        if (!row.pointKeys[pointKey]) { row.pointKeys[pointKey] = 1; row.points.push(marker); }
      });
      return row;
    }).sort(function (a, b) {
      return a.config.order - b.config.order || b.objectCount - a.objectCount || b.detailCount - a.detailCount || a.network.localeCompare(b.network);
    });
  }

  function boardBounds(State) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function add(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    (State.vias || []).forEach(function (via) { add(via.x, via.y); });
    (State.shapes || []).forEach(function (shape) {
      if (shape.bbox) { add(shape.bbox.minX, shape.bbox.minY); add(shape.bbox.maxX, shape.bbox.maxY); }
    });
    (State.traces || []).forEach(function (trace) {
      if (trace.bbox) { add(trace.bbox.minX, trace.bbox.minY); add(trace.bbox.maxX, trace.bbox.maxY); }
    });
    if (!isFinite(minX)) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    if (minX === maxX) { minX -= 50; maxX += 50; }
    if (minY === maxY) { minY -= 50; maxY += 50; }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function transform(bounds, width, height, pad) {
    var dx = bounds.maxX - bounds.minX, dy = bounds.maxY - bounds.minY;
    var scale = Math.min((width - pad * 2) / dx, (height - pad * 2) / dy);
    var offsetX = (width - dx * scale) / 2, offsetY = (height - dy * scale) / 2;
    return function (x, y) {
      return [offsetX + (x - bounds.minX) * scale, height - offsetY - (y - bounds.minY) * scale];
    };
  }

  function canvasContext(canvas) {
    try { return canvas && canvas.getContext ? canvas.getContext('2d') : null; }
    catch (error) { return null; }
  }

  function drawBoardBase(canvas, model, large) {
    var ctx = canvasContext(canvas);
    if (!ctx) return false;
    var width = canvas.width, height = canvas.height, xy = transform(model.bounds, width, height, large ? 28 : 16);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#07111f'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(148,163,184,.18)'; ctx.lineWidth = 1;
    for (var gx = 1; gx < 4; gx++) {
      var x = width * gx / 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (var gy = 1; gy < 3; gy++) {
      var y = height * gy / 3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(96,165,250,.62)';
    var viaSize = large ? 2.4 : 1.4;
    (model.vias || []).forEach(function (via) {
      var point = xy(via.x, via.y);
      ctx.fillRect(point[0] - viaSize / 2, point[1] - viaSize / 2, viaSize, viaSize);
    });
    ctx.strokeStyle = '#64748b'; ctx.strokeRect(1, 1, width - 2, height - 2);
    return true;
  }

  function drawDefectPoints(ctx, row, bounds, width, height, large) {
    var xy = transform(bounds, width, height, large ? 28 : 16);
    var radius = large ? 7 : 5;
    ctx.fillStyle = row.config.color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    ctx.beginPath();
    row.points.forEach(function (marker) {
      var point = xy(marker.x, marker.y);
      ctx.moveTo(point[0], point[1] - radius); ctx.lineTo(point[0] + radius, point[1]);
      ctx.lineTo(point[0], point[1] + radius); ctx.lineTo(point[0] - radius, point[1]); ctx.closePath();
    });
    ctx.fill(); ctx.stroke();
  }

  function drawThumbnails(host, model) {
    var canvases = host.querySelectorAll('.pour-defect-board-canvas');
    if (!canvases.length) return;
    var base = document.createElement('canvas'); base.width = 520; base.height = 292;
    if (!drawBoardBase(base, model, false)) return;
    Array.prototype.forEach.call(canvases, function (canvas) {
      var row = model.rows[parseInt(canvas.getAttribute('data-row-index'), 10)];
      var ctx = canvasContext(canvas);
      if (!row || !ctx) return;
      ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      drawDefectPoints(ctx, row, model.bounds, canvas.width, canvas.height, false);
    });
  }

  function ensureZoom() {
    var mask = document.getElementById('pourDefectBoardZoom');
    if (mask) return mask;
    mask = document.createElement('div'); mask.id = 'pourDefectBoardZoom'; mask.className = 'pour-board-zoom'; mask.hidden = true;
    mask.innerHTML = '<div class="pour-board-zoom-dialog" role="dialog" aria-modal="true" aria-labelledby="pourBoardZoomTitle">' +
      '<div class="pour-board-zoom-head"><b id="pourBoardZoomTitle"></b><button type="button" class="btn sec pour-board-zoom-close">关闭</button></div>' +
      '<canvas class="pour-board-zoom-canvas" width="960" height="570"></canvas></div>';
    document.body.appendChild(mask);
    mask.querySelector('.pour-board-zoom-close').onclick = function () { mask.hidden = true; };
    mask.onclick = function (event) { if (event.target === mask) mask.hidden = true; };
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') mask.hidden = true; });
    return mask;
  }

  function openZoom(rowIndex) {
    if (!currentModel) return;
    var row = currentModel.rows[rowIndex], mask = ensureZoom();
    if (!row) return;
    mask.querySelector('#pourBoardZoomTitle').textContent = row.config.type + ' · ' + row.network + ' · 异常位置 ' + row.points.length + ' 处';
    var canvas = mask.querySelector('.pour-board-zoom-canvas');
    if (drawBoardBase(canvas, currentModel, true)) {
      drawDefectPoints(canvasContext(canvas), row, currentModel.bounds, canvas.width, canvas.height, true);
    }
    mask.hidden = false;
    mask.querySelector('.pour-board-zoom-close').focus();
  }

  function mount(host) {
    if (!host || !currentModel) return;
    Array.prototype.forEach.call(host.querySelectorAll('.pour-defect-board-open'), function (button) {
      button.onclick = function () { openZoom(parseInt(button.getAttribute('data-row-index'), 10)); };
    });
    var draw = function () { if (currentModel) drawThumbnails(host, currentModel); };
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(draw); else setTimeout(draw, 0);
  }

  function positionText(points) {
    var text = points.slice(0, 3).map(function (point) {
      return point.targetLabel + ' [' + Number(point.x).toFixed(1) + ', ' + Number(point.y).toFixed(1) + ']';
    }).join('；');
    return text + (points.length > 3 ? ' 等 ' + points.length + ' 处' : '');
  }

  function render(defects, State) {
    var rows = buildRows(defects, State);
    var totalObjects = groupedObjects(defects).length;
    var totalDetails = (defects || []).length;
    currentModel = { rows: rows, bounds: boardBounds(State), vias: State.vias || [] };
    var h = '<div class="card pour-defect-summary"><div class="pour-defect-summary-head">' +
      '<div><h3>缺陷总结表</h3><div class="hint">按孔 Padstack、网络与异常类型归纳，共 ' + rows.length + ' 类、' + totalObjects + ' 个异常目标对象、' + totalDetails + ' 条失败明细；同一对象的多模板或多层失败不重复计入对象数。位置图显示全部 ' + currentModel.vias.length + ' 个孔。</div></div></div>';
    if (!rows.length) return h + '<div class="hint pour-defect-summary-empty">当前没有异常记录。</div></div>';
    h += '<div class="tbl-wrap"><table class="pour-defect-summary-table"><thead><tr>' +
      '<th>孔 Padstack</th><th>网络</th><th>异常类型</th><th>如何修改</th><th>板上位置</th></tr></thead><tbody>';
    rows.forEach(function (row, rowIndex) {
      var layerText = Object.keys(row.layers).join('、');
      var typeText = row.config.type + (layerText ? ' · ' + layerText : '') + ' · ' + row.objectCount + ' 个对象 / ' + row.detailCount + ' 条失败明细';
      var location = positionText(row.points) || '无可用坐标';
      h += '<tr><td><b>' + esc(row.padstack) + '</b></td><td><code>' + esc(row.network) + '</code></td>' +
        '<td><span class="pour-defect-type" style="--defect-color:' + row.config.color + '">' + esc(typeText) + '</span></td>' +
        '<td class="pour-defect-fix">' + esc(row.config.fix) + '</td><td><div class="pour-defect-board">' +
          '<button type="button" class="pour-defect-board-open" data-row-index="' + rowIndex + '" aria-label="放大查看' + esc(row.config.type) + '板上位置">' +
            '<canvas class="pour-defect-board-canvas" data-row-index="' + rowIndex + '" data-all-via-count="' + currentModel.vias.length + '" data-object-count="' + row.objectCount + '" data-detail-count="' + row.detailCount + '" width="520" height="292"></canvas>' +
            '<span>放大查看</span></button><div>' + esc(location) + '</div></div></td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  root.PourDefectSummary = { render: render, mount: mount, buildRows: buildRows };
})(typeof window !== 'undefined' ? window : globalThis);
