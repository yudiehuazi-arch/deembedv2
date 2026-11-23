/* ============================================================================
 * copper-bad-summary-ui.js —— ⑥ 规律分析页：不符合归纳表、板上位置缩略图与复制
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.CopperApp, UI = App && App.UI, esc = App && App.esc;
  if (!App || !UI) return;

  function layerText(layers) {
    var nums = Object.keys(layers || {}).map(Number).filter(function (n) { return isFinite(n) && n > 0; });
    nums.sort(function (a, b) { return a - b; });
    if (!nums.length) return '';
    return 'L' + nums.join('/');
  }

  function expectedText(value) {
    var text = String(value == null || value === '' ? '无' : value);
    return /^-?\d+(?:\.\d+)?$/.test(text) ? (text + ' mil') : text;
  }

  function dimensionName(checkType) {
    return {
      '反焊盘尺寸': '反焊盘半径',
      '焊盘尺寸': '焊盘半径',
      '非功能焊盘尺寸': '非功能焊盘半径'
    }[checkType] || '';
  }

  function newCauseBucket(data) {
    var bucket = data || {};
    bucket.networks = {}; bucket.groups = []; bucket.groupIds = {}; bucket.viaIds = {};
    return bucket;
  }

  function addCauseScope(bucket, group) {
    bucket.networks[group.via.net || '无网络'] = 1;
    var groupId = String(group.via.id);
    if (!bucket.groupIds[groupId]) { bucket.groupIds[groupId] = 1; bucket.groups.push(group); }
    (group.vias && group.vias.length ? group.vias : [group.via]).forEach(function (via) { bucket.viaIds[via.id] = 1; });
  }

  function signalNamingText(row, reason) {
    var padstack = String(row.actual || row.sourcePadstack || '当前');
    var issue = reason;
    if (reason.indexOf('未包含 SIG') >= 0) issue = '未包含 SIG';
    else if (reason.indexOf('包含 GND') >= 0) issue = '包含 GND';
    return padstack + ' padstack选取错误，非 GND 网络的 Padstack Name ' + issue;
  }

  function addCause(entry, group, row) {
    if (row.checkType === 'Padstack信号命名' || row.checkType === 'Padstack层名') {
      var signalName = row.checkType === 'Padstack信号命名';
      var reason = String(row.reason || row.actual || '命名与规则不一致');
      var text = signalName ? signalNamingText(row, reason) : ('Padstack层名不符合：' + reason);
      var named = entry.namedCauses[text] || (entry.namedCauses[text] = newCauseBucket({ text: text }));
      addCauseScope(named, group);
      return;
    }
    if (row.reason && !row.missing) {
      var measured = entry.namedCauses[row.reason] || (entry.namedCauses[row.reason] = newCauseBucket({ text: row.reason }));
      addCauseScope(measured, group); return;
    }
    var dim = dimensionName(row.checkType), missing = !!row.missing || row.statusNote === '缺失层';
    var key = [row.checkType, row.expect, missing ? 'missing' : 'value', dim ? '' : row.actual].join('|');
    var bucket = entry.causes[key] || (entry.causes[key] = newCauseBucket({
      checkType: row.checkType || '检查项', dim: dim, expect: row.expect, actual: row.actual,
      missing: missing, layers: {}
    }));
    if (typeof row.layer === 'number' && row.layer > 0) bucket.layers[row.layer] = 1;
    addCauseScope(bucket, group);
  }

  function mergeCauseScope(target, source) {
    Object.keys(source.networks).forEach(function (network) { target.networks[network] = 1; });
    Object.keys(source.viaIds).forEach(function (id) { target.viaIds[id] = 1; });
    source.groups.forEach(function (group) {
      var groupId = String(group.via.id);
      if (!target.groupIds[groupId]) { target.groupIds[groupId] = 1; target.groups.push(group); }
    });
  }

  function causeText(cause) {
    if (cause.text) return cause.text;
    var layers = layerText(cause.layers), where = layers ? (layers + ' ') : '';
    if (cause.dim) return cause.missing
      ? (where + '缺' + cause.dim + '，规则值为 ' + expectedText(cause.expect))
      : (where + '实际' + cause.dim + '应为 ' + expectedText(cause.expect));
    return where + cause.checkType + '不符合：实际 ' + String(cause.actual) + '，规则值 ' + String(cause.expect || '无');
  }

  function buildCauseRows(entry) {
    var rows = [], byText = {};
    function append(cause) {
      var text = causeText(cause), target = byText[text];
      if (!target) {
        target = newCauseBucket({ text: text }); byText[text] = target; rows.push(target);
      }
      mergeCauseScope(target, cause);
    }
    Object.keys(entry.namedCauses).forEach(function (key) { append(entry.namedCauses[key]); });
    Object.keys(entry.causes).forEach(function (key) { append(entry.causes[key]); });
    rows.forEach(function (row) {
      row.networkList = Object.keys(row.networks).sort();
      row.viaList = Object.keys(row.viaIds);
    });
    return rows;
  }

  function buildRows(result) {
    var map = {}, order = [];
    (result && result.groups || []).forEach(function (group) {
      var fails = (group.failRows || []).filter(function (row) { return row.status === '不符合'; });
      if (!fails.length) return;
      var title = group.rule ? (group.rule.title || '未命名约束') : '未推算到约束';
      if (!map[title]) {
        map[title] = { title: title, networks: {}, groups: [], viaIds: {}, causes: {}, namedCauses: {} };
        order.push(title);
      }
      var entry = map[title];
      entry.networks[group.via.net || '无网络'] = 1;
      entry.groups.push(group);
      (group.vias && group.vias.length ? group.vias : [group.via]).forEach(function (via) { entry.viaIds[via.id] = 1; });
      fails.forEach(function (row) { addCause(entry, group, row); });
    });
    return order.map(function (title) {
      var entry = map[title];
      entry.networkList = Object.keys(entry.networks).sort();
      entry.reasonRows = buildCauseRows(entry);
      entry.reasonList = entry.reasonRows.map(function (row) { return row.text; });
      entry.viaList = Object.keys(entry.viaIds);
      return entry;
    });
  }

  function itemPoint(item) {
    if (item && item.origin && isFinite(item.origin[0]) && isFinite(item.origin[1])) return item.origin;
    if (item && item.center && isFinite(item.center[0]) && isFinite(item.center[1])) return item.center;
    return null;
  }

  function boardGeometry() {
    var points = [], minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    (UI.items || []).forEach(function (item) {
      var point = itemPoint(item);
      if (!point || (item.type !== 'via' && !item.arcShape && !item.circle)) return;
      points.push({ x: point[0], y: point[1], via: item.type === 'via' });
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    });
    if (!isFinite(minX)) { minX = 0; maxX = 100; minY = 0; maxY = 100; }
    return { points: points, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function focusedBounds(entry, geometry, viewWidth, viewHeight) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    (entry.groups || []).forEach(function (group) {
      (group.vias && group.vias.length ? group.vias : [group.via]).forEach(function (via) {
        var point = itemPoint(via);
        if (!point) return;
        minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
      });
    });
    if (!isFinite(minX)) return { minX: geometry.minX, maxX: geometry.maxX, minY: geometry.minY, maxY: geometry.maxY };
    var boardDx = Math.max(1, geometry.maxX - geometry.minX), boardDy = Math.max(1, geometry.maxY - geometry.minY);
    var dx = Math.max(maxX - minX, boardDx * 0.04, 1) * 1.16;
    var dy = Math.max(maxY - minY, boardDy * 0.04, 1) * 1.16;
    var ratio = Math.max(0.1, viewWidth / viewHeight), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (dx / dy > ratio) dy = dx / ratio;
    else dx = dy * ratio;
    return { minX: cx - dx / 2, maxX: cx + dx / 2, minY: cy - dy / 2, maxY: cy + dy / 2 };
  }

  function boardImage(entry, geometry) {
    var width = 960, height = 570, pad = 28;
    var focus = focusedBounds(entry, geometry, width - pad * 2, height - pad * 2);
    var dx = Math.max(1, focus.maxX - focus.minX), dy = Math.max(1, focus.maxY - focus.minY);
    var scale = Math.min((width - pad * 2) / dx, (height - pad * 2) / dy);
    var offsetX = (width - dx * scale) / 2, offsetY = (height - dy * scale) / 2;
    function xy(point) {
      return [offsetX + (point[0] - focus.minX) * scale, height - offsetY - (point[1] - focus.minY) * scale];
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<rect width="100%" height="100%" fill="#07111f"/>';
    for (var gridX = 1; gridX < 4; gridX++) {
      var gx = (width * gridX / 4).toFixed(2);
      svg += '<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + height + '" stroke="#94a3b8" stroke-opacity=".16" stroke-width="1"/>';
    }
    for (var gridY = 1; gridY < 3; gridY++) {
      var gy = (height * gridY / 3).toFixed(2);
      svg += '<line x1="0" y1="' + gy + '" x2="' + width + '" y2="' + gy + '" stroke="#94a3b8" stroke-opacity=".16" stroke-width="1"/>';
    }
    var visiblePoints = geometry.points.filter(function (point) {
      return point.x >= focus.minX && point.x <= focus.maxX && point.y >= focus.minY && point.y <= focus.maxY;
    });
    var step = Math.max(1, Math.ceil(visiblePoints.length / 3000));
    for (var i = 0; i < visiblePoints.length; i += step) {
      var point = visiblePoints[i], p = xy([point.x, point.y]);
      svg += '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="' + (point.via ? '2.3' : '1.7') + '" fill="' + (point.via ? '#60a5fa' : '#f59e0b') + '" fill-opacity=".52"/>';
    }
    var marked = {}, count = entry.viaList.length;
    var markerRadius = count > 100 ? 4.2 : (count > 30 ? 5.2 : 7.2);
    entry.groups.forEach(function (group) {
      (group.vias && group.vias.length ? group.vias : [group.via]).forEach(function (via) {
        if (!via || !via.origin || marked[via.id]) return;
        marked[via.id] = 1;
        var p = xy(via.origin);
        svg += '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="' + (markerRadius + 3) + '" fill="#ef4444" fill-opacity=".2"/>' +
          '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="' + markerRadius + '" fill="#ef4444" stroke="#fecaca" stroke-width="1.2"/>';
        if (count <= 8) {
          svg += '<text x="' + (p[0] + 10).toFixed(2) + '" y="' + (p[1] - 8).toFixed(2) + '" fill="#f8fafc" font-size="18">' + esc(via.id) + '</text>';
        }
      });
    });
    svg += '<text x="24" y="32" fill="#f8fafc" font-size="24">异常孔 ' + count + ' 个</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function plainTable(rows) {
    var lines = [['约束方案', '网络', '异常原因', '板上位置']];
    rows.forEach(function (row) {
      row.reasonRows.forEach(function (reason) {
        lines.push([row.title, reason.networkList.join('/'), reason.text, 'Via ' + reason.viaList.join('/')]);
      });
    });
    return lines.map(function (line) { return line.join('\t'); }).join('\n');
  }

  function fallbackCopy(table, text) {
    var selection = root.getSelection && root.getSelection();
    if (selection && document.createRange && document.execCommand) {
      var range = document.createRange();
      range.selectNode(table); selection.removeAllRanges(); selection.addRange(range);
      try { if (document.execCommand('copy')) { selection.removeAllRanges(); return true; } } catch (e) {}
      selection.removeAllRanges();
    }
    var area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area);
    area.focus(); area.select();
    var ok = false;
    try { ok = !!(document.execCommand && document.execCommand('copy')); } catch (err) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  function copyTable(host, rows) {
    var table = host.querySelector('.bad-summary-table'), status = host.querySelector('.bad-summary-copy-status');
    if (!table) return;
    var text = plainTable(rows), html = '<meta charset="utf-8">' + table.outerHTML;
    var done = function (ok) { if (status) status.textContent = ok ? '已复制，可粘贴到 Excel 或 Word' : '请选中表格后复制'; };
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.write && root.ClipboardItem) {
      var item = new root.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      });
      root.navigator.clipboard.write([item]).then(function () { done(true); }, function () { done(fallbackCopy(table, text)); });
    } else done(fallbackCopy(table, text));
  }

  function openBoardZoom(button) {
    var source = button.querySelector('.bad-summary-board');
    if (!source) return;
    var mask = document.getElementById('copperBadSummaryZoom');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'copperBadSummaryZoom'; mask.className = 'bad-summary-zoom'; mask.hidden = true;
      mask.innerHTML = '<div class="bad-summary-zoom-dialog" role="dialog" aria-modal="true" aria-labelledby="copperBadSummaryZoomTitle">' +
        '<div class="bad-summary-zoom-head"><b id="copperBadSummaryZoomTitle"></b><button type="button" class="btn gray bad-summary-zoom-close">关闭</button></div>' +
        '<img class="bad-summary-zoom-image" alt=""></div>';
      document.body.appendChild(mask);
      mask.querySelector('.bad-summary-zoom-close').onclick = function () { mask.hidden = true; };
      mask.onclick = function (event) { if (event.target === mask) mask.hidden = true; };
      document.addEventListener('keydown', function (event) { if (event.key === 'Escape') mask.hidden = true; });
    }
    mask.querySelector('#copperBadSummaryZoomTitle').textContent = source.alt;
    var image = mask.querySelector('.bad-summary-zoom-image');
    image.src = source.src; image.alt = source.alt; mask.hidden = false;
    mask.querySelector('.bad-summary-zoom-close').focus();
  }

  function render(host) {
    if (!host) return;
    var rows = buildRows(UI.result), geometry = boardGeometry();
    var h = '<div class="card bad-summary-card"><div class="bad-summary-head"><div><h2>只看不符合归纳表</h2>' +
      '<div class="hint">按约束方案归纳网络、异常原因和板上位置，共 ' + rows.length + ' 类。</div></div>' +
      '<div class="bad-summary-actions"><button type="button" class="btn gray" id="btnCopyBadSummary">复制表格</button><span class="hint bad-summary-copy-status"></span></div></div>';
    if (!rows.length) h += '<div class="hint bad-summary-empty">当前没有不符合记录。</div>';
    else {
      h += '<div class="bad-summary-wrap"><table class="bad-summary-table"><thead><tr><th>约束方案</th><th>网络</th><th>异常原因</th><th>板上位置</th></tr></thead><tbody>';
      rows.forEach(function (row) {
        row.reasonRows.forEach(function (reason, index) {
          var image = boardImage(reason, geometry);
          var alt = row.title + ' · ' + reason.text + '，Via ' + reason.viaList.join('/');
          h += '<tr>';
          if (index === 0) h += '<td rowspan="' + row.reasonRows.length + '"><b>' + esc(row.title) + '</b></td>';
          h += '<td><div class="bad-summary-network">' + reason.networkList.map(function (network) { return esc(network); }).join('/<wbr>') + '</div></td>' +
            '<td><div class="bad-summary-reason">' + esc(reason.text) + '</div></td>' +
            '<td><button type="button" class="bad-summary-board-open" aria-label="' + esc('放大查看 ' + alt) + '">' +
            '<img class="bad-summary-board" src="' + image + '" alt="' + esc(alt) + '"><span>放大查看</span></button></td></tr>';
        });
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    host.innerHTML = h;
    var button = host.querySelector('#btnCopyBadSummary');
    if (button) { button.disabled = !rows.length; button.onclick = function () { copyTable(host, rows); }; }
    Array.prototype.forEach.call(host.querySelectorAll('.bad-summary-board-open'), function (zoom) {
      zoom.onclick = function () { openBoardZoom(zoom); };
    });
  }

  root.CopperBadSummary = { render: render, buildRows: buildRows, plainTable: plainTable, focusedBounds: focusedBounds };
})(typeof window !== 'undefined' ? window : globalThis);
