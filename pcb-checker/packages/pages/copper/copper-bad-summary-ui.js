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

  function addCause(entry, group, row) {
    var viaText = (row.sourceViaIds || []).length ? row.sourceViaIds.join('/') : group.via.id;
    if (row.checkType === 'Padstack信号命名' || row.checkType === 'Padstack层名') {
      var prefix = row.checkType === 'Padstack信号命名' ? 'Padstack命名不符合' : 'Padstack层名不符合';
      var named = 'Via ' + viaText + ' ' + prefix + '：' + (row.reason || row.actual || '命名与规则不一致');
      entry.namedCauses[named] = 1;
      return;
    }
    var dim = dimensionName(row.checkType), missing = row.actual === '无铜皮' || row.statusNote === '缺失层';
    var key = [row.checkType, row.expect, missing ? 'missing' : 'value', dim ? '' : row.actual].join('|');
    var bucket = entry.causes[key] || (entry.causes[key] = {
      checkType: row.checkType || '检查项', dim: dim, expect: row.expect, actual: row.actual,
      missing: missing, layers: {}
    });
    if (typeof row.layer === 'number' && row.layer > 0) bucket.layers[row.layer] = 1;
  }

  function causeTexts(entry) {
    var out = Object.keys(entry.namedCauses);
    Object.keys(entry.causes).forEach(function (key) {
      var cause = entry.causes[key], layers = layerText(cause.layers), where = layers ? (layers + ' ') : '';
      if (cause.dim) {
        out.push(cause.missing
          ? (where + '缺' + cause.dim + '，规则值为 ' + expectedText(cause.expect))
          : (where + '实际' + cause.dim + '应为 ' + expectedText(cause.expect)));
      } else {
        out.push(where + cause.checkType + '不符合：实际 ' + String(cause.actual) + '，规则值 ' + String(cause.expect || '无'));
      }
    });
    return out;
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
      entry.reasonList = causeTexts(entry);
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
      if (!point || (item.type !== 'via' && !item.circle)) return;
      points.push({ x: point[0], y: point[1], via: item.type === 'via' });
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    });
    if (!isFinite(minX)) { minX = 0; maxX = 100; minY = 0; maxY = 100; }
    return { points: points, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function boardImage(entry, geometry) {
    var width = 320, height = 190, pad = 9;
    var dx = Math.max(1, geometry.maxX - geometry.minX), dy = Math.max(1, geometry.maxY - geometry.minY);
    var scale = Math.min((width - pad * 2) / dx, (height - pad * 2) / dy);
    function xy(point) {
      return [pad + (point[0] - geometry.minX) * scale, height - pad - (point[1] - geometry.minY) * scale];
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<rect width="100%" height="100%" fill="#07111f"/>';
    var step = Math.max(1, Math.ceil(geometry.points.length / 1200));
    for (var i = 0; i < geometry.points.length; i += step) {
      var point = geometry.points[i], p = xy([point.x, point.y]);
      svg += '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="' + (point.via ? '1.6' : '1.2') + '" fill="' + (point.via ? '#60a5fa' : '#f59e0b') + '" fill-opacity=".88"/>';
    }
    var marked = {};
    entry.groups.forEach(function (group) {
      (group.vias && group.vias.length ? group.vias : [group.via]).forEach(function (via) {
        if (!via || !via.origin || marked[via.id]) return;
        marked[via.id] = 1;
        var p = xy(via.origin);
        svg += '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="5.5" fill="#ef4444" fill-opacity=".28" stroke="#ef4444" stroke-width="2"/>';
        if (entry.viaList.length <= 8) {
          svg += '<text x="' + (p[0] + 7).toFixed(2) + '" y="' + (p[1] - 5).toFixed(2) + '" fill="#f8fafc" font-size="8">' + esc(via.id) + '</text>';
        }
      });
    });
    svg += '<text x="8" y="14" fill="#f8fafc" font-size="10">异常孔 ' + entry.viaList.length + ' 个</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function plainTable(rows) {
    var lines = [['约束方案', '网络', '异常原因', '板上位置']];
    rows.forEach(function (row) {
      lines.push([row.title, row.networkList.join('/'), row.reasonList.join('；'), 'Via ' + row.viaList.join('/')]);
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
        var image = boardImage(row, geometry);
        h += '<tr><td><b>' + esc(row.title) + '</b></td><td><b>' + esc(row.networkList.join('/')) + '</b></td><td>' +
          row.reasonList.map(function (reason) { return '<div class="bad-summary-reason">' + esc(reason) + '</div>'; }).join('') +
          '</td><td><img class="bad-summary-board" src="' + image + '" alt="' + esc(row.title + ' 板上异常位置，Via ' + row.viaList.join('/')) + '"></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    host.innerHTML = h;
    var button = host.querySelector('#btnCopyBadSummary');
    if (button) { button.disabled = !rows.length; button.onclick = function () { copyTable(host, rows); }; }
  }

  root.CopperBadSummary = { render: render, buildRows: buildRows, plainTable: plainTable };
})(typeof window !== 'undefined' ? window : globalThis);
