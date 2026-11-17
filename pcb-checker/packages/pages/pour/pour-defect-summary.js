/* ============================================================================
 * pour-defect-summary.js —— 缺陷规律分析：五类异常总结与板上位置缩略图
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
    via_coverage: {
      order: 1, type: '孔层铺铜缺失', color: '#ef4444',
      fix: '在异常层补铺铜，确保孔心检测半径内存在铜皮。'
    },
    special_shape: {
      order: 2, type: '异型铜皮不匹配', color: '#a855f7',
      fix: '按模板重生成异型铜皮，并消除反焊盘侵占。'
    },
    trace_ref_margin: {
      order: 3, type: '参考层铜皮外延不足', color: '#f59e0b',
      fix: '外扩参考层铜皮至规则阈值，避免走线跨分割。'
    },
    isolated_copper: {
      order: 4, type: '孤立小铜皮', color: '#06b6d4',
      fix: '删除无连接碎铜，或增加同层过孔可靠接地。'
    },
    arc_radius: {
      order: 5, type: '铜皮圆弧半径过小', color: '#ec4899',
      fix: '增大铜皮圆角半径至规则阈值以上。'
    }
  };

  function findById(items, id) {
    return (items || []).find(function (item) { return String(item.id) === String(id); });
  }

  function identity(record, State) {
    var via = record.viaId != null ? findById(State.vias, record.viaId) : null;
    var shape = record.shapeId != null ? findById(State.shapes, record.shapeId) : null;
    return {
      padstack: record.viaPadstack || (via && via.padstack) || '—',
      network: record.viaNet || record.traceNet || (via && via.net) || (shape && shape.net) || '—'
    };
  }

  function buildRows(defects, State) {
    var map = {};
    (defects || []).forEach(function (record) {
      var config = CATEGORY[record.checkCategory];
      if (!config || record.pass) return;
      var id = identity(record, State);
      var key = [record.checkCategory, id.padstack, id.network].join('|');
      if (!map[key]) map[key] = {
        category: record.checkCategory, config: config, padstack: id.padstack,
        network: id.network, count: 0, layers: {}, points: [], pointKeys: {}
      };
      var row = map[key];
      row.count++;
      var layer = record.layer || record.refLayer || record.traceLayer;
      if (layer) row.layers[String(layer)] = 1;
      var marker = typeof root.getPourDefectMarker === 'function' ? root.getPourDefectMarker(record) : null;
      if (marker) {
        var pointKey = marker.targetLabel + '|' + marker.x + '|' + marker.y;
        if (!row.pointKeys[pointKey]) {
          row.pointKeys[pointKey] = 1;
          row.points.push(marker);
        }
      }
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
      return a.config.order - b.config.order || b.count - a.count || a.network.localeCompare(b.network);
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

  function boardImage(row, bounds) {
    var width = 420, height = 230, pad = 18;
    var dx = bounds.maxX - bounds.minX, dy = bounds.maxY - bounds.minY;
    var scale = Math.min((width - pad * 2) / dx, (height - pad * 2) / dy);
    var offsetX = (width - dx * scale) / 2, offsetY = (height - dy * scale) / 2;
    function xy(point) {
      return [offsetX + (point.x - bounds.minX) * scale, height - offsetY - (point.y - bounds.minY) * scale];
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<rect width="100%" height="100%" rx="8" fill="#07111f"/>' +
      '<rect x="12" y="12" width="396" height="206" rx="5" fill="none" stroke="#64748b" stroke-width="1"/>';
    for (var gx = 1; gx < 4; gx++) {
      var x = width * gx / 4;
      svg += '<line x1="' + x + '" y1="12" x2="' + x + '" y2="218" stroke="#94a3b8" stroke-opacity=".18"/>';
    }
    for (var gy = 1; gy < 3; gy++) {
      var y = 12 + 206 * gy / 3;
      svg += '<line x1="12" y1="' + y + '" x2="408" y2="' + y + '" stroke="#94a3b8" stroke-opacity=".18"/>';
    }
    var step = Math.max(1, Math.ceil(row.points.length / 60));
    for (var i = 0; i < row.points.length; i += step) {
      var point = xy(row.points[i]);
      svg += '<circle cx="' + point[0].toFixed(2) + '" cy="' + point[1].toFixed(2) + '" r="8" fill="' + row.config.color + '" fill-opacity=".28"/>' +
        '<path d="M' + point[0].toFixed(2) + ' ' + (point[1] - 5).toFixed(2) + ' L' + (point[0] + 5).toFixed(2) + ' ' + point[1].toFixed(2) +
        ' L' + point[0].toFixed(2) + ' ' + (point[1] + 5).toFixed(2) + ' L' + (point[0] - 5).toFixed(2) + ' ' + point[1].toFixed(2) + ' Z" fill="' + row.config.color + '" stroke="#fff" stroke-width="1"/>';
    }
    svg += '<text x="20" y="32" fill="#f8fafc" font-size="14" font-family="sans-serif">异常位置 ' + row.points.length + ' 处</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function positionText(points) {
    var text = points.slice(0, 3).map(function (point) {
      return point.targetLabel + ' [' + Number(point.x).toFixed(1) + ', ' + Number(point.y).toFixed(1) + ']';
    }).join('；');
    return text + (points.length > 3 ? ' 等 ' + points.length + ' 处' : '');
  }

  function render(defects, State) {
    var rows = buildRows(defects, State);
    var total = rows.reduce(function (sum, row) { return sum + row.count; }, 0);
    var bounds = boardBounds(State);
    var h = '<div class="card pour-defect-summary"><div class="pour-defect-summary-head">' +
      '<div><h3>缺陷总结表</h3><div class="hint">按孔 Padstack、网络与异常类型归纳，共 ' + rows.length + ' 类、' + total + ' 条异常。</div></div></div>';
    if (!rows.length) {
      h += '<div class="hint pour-defect-summary-empty">当前没有异常记录。</div></div>';
      return h;
    }
    h += '<div class="tbl-wrap"><table class="pour-defect-summary-table"><thead><tr>' +
      '<th>孔 Padstack</th><th>网络</th><th>异常类型</th><th>如何修改</th><th>板上位置</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (row) {
      var layerText = Object.keys(row.layers).join('、');
      var typeText = row.config.type + (layerText ? ' · ' + layerText : '') + (row.count > 1 ? ' · ' + row.count + ' 条' : '');
      var location = positionText(row.points) || '无可用坐标';
      h += '<tr><td><b>' + esc(row.padstack) + '</b></td>' +
        '<td><code>' + esc(row.network) + '</code></td>' +
        '<td><span class="pour-defect-type" style="--defect-color:' + row.config.color + '">' + esc(typeText) + '</span></td>' +
        '<td class="pour-defect-fix">' + esc(row.config.fix) + '</td>' +
        '<td><div class="pour-defect-board"><img src="' + boardImage(row, bounds) + '" alt="' + esc(row.config.type + '板上位置') + '">' +
          '<div>' + esc(location) + '</div></div></td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  root.PourDefectSummary = { render: render, buildRows: buildRows };
})(typeof window !== 'undefined' ? window : globalThis);
