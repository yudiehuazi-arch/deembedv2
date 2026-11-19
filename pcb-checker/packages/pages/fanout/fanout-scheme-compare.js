/* ============================================================================
 * fanout-scheme-compare.js —— 方案库双方案指标、等比例几何与逐孔明细对比
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var FC = root.FanoutChecker;
  var State = root.State;
  var esc = root.escapeHtml;

  function fanoutCompareRound(value, digits) {
    var scale = Math.pow(10, digits == null ? 1 : digits);
    return Math.round(Number(value || 0) * scale) / scale;
  }

  function fanoutCompareDistanceRange(scheme) {
    var list = scheme.pairwiseDistances || [];
    if (!list.length) return { min: null, max: null, text: '-' };
    var min = list[0].dist, max = list[list.length - 1].dist;
    return { min: fanoutCompareRound(min, 2), max: fanoutCompareRound(max, 2), text: min.toFixed(2) + ' ~ ' + max.toFixed(2) + ' mil' };
  }

  function fanoutCompareDistanceSpectrum(scheme) {
    var buckets = {};
    (scheme.pairwiseDistances || []).forEach(function (item) {
      var key = fanoutCompareRound(item.dist, 1).toFixed(1);
      buckets[key] = (buckets[key] || 0) + 1;
    });
    var keys = Object.keys(buckets).sort(function (a, b) { return Number(a) - Number(b); });
    return keys.length ? keys.map(function (key) { return key + ' mil ×' + buckets[key]; }).join(' / ') : '-';
  }

  function fanoutComparePadstacks(scheme) {
    var entries = Object.keys(scheme.padstackCounts || {}).sort().map(function (name) {
      return { name: name, count: scheme.padstackCounts[name] };
    });
    return {
      key: entries.map(function (item) { return item.name + ':' + item.count; }).join('|'),
      html: entries.length ? entries.map(function (item) {
        return '<span class="scheme-compare-pad">' + esc(item.name) + ' ×' + item.count + '</span>';
      }).join('') : '-'
    };
  }

  function fanoutCompareFindScheme(id) {
    return (State.library.schemes || []).find(function (scheme) { return String(scheme.id) === String(id); }) || null;
  }

  function fanoutCompareMetrics(scheme) {
    var signalCount = (scheme.vias || []).filter(function (via) { return FC.isSignalVia(via); }).length;
    var points = scheme.normalizedVias || [];
    var xs = points.map(function (via) { return via.nx; });
    var ys = points.map(function (via) { return via.ny; });
    var width = xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0;
    var height = ys.length ? Math.max.apply(null, ys) - Math.min.apply(null, ys) : 0;
    var distance = fanoutCompareDistanceRange(scheme);
    return {
      category: scheme.category || '-', total: scheme.viaCount || 0,
      signals: signalCount, grounds: (scheme.viaCount || 0) - signalCount,
      padstacks: fanoutComparePadstacks(scheme), distance: distance,
      spanKey: fanoutCompareRound(width, 1) + 'x' + fanoutCompareRound(height, 1),
      spanText: width.toFixed(1) + ' × ' + height.toFixed(1) + ' mil',
      spectrum: fanoutCompareDistanceSpectrum(scheme)
    };
  }

  function fanoutCompareMetricRow(label, aHtml, bHtml, aKey, bKey) {
    var different = String(aKey) !== String(bKey);
    return '<tr class="' + (different ? 'scheme-compare-different' : 'scheme-compare-same') + '" data-compare-metric="' + esc(label) + '">' +
      '<th>' + esc(label) + '</th><td>' + aHtml + '</td><td class="scheme-compare-state">' +
      (different ? '不同' : '一致') + '</td><td>' + bHtml + '</td></tr>';
  }

  function fanoutCompareViaTable(scheme, side) {
    return '<div class="scheme-compare-via-card"><h4>方案 ' + side + ' 逐孔明细</h4><div class="scheme-compare-via-scroll"><table>' +
      '<thead><tr><th>孔号</th><th>类型</th><th>中心相对坐标 mil</th><th>角色 / Padstack</th></tr></thead><tbody>' +
      (scheme.vias || []).map(function (via, index) {
        var point = (scheme.normalizedVias || [])[index] || { nx: 0, ny: 0 };
        return '<tr><td>#' + esc(via.id) + '</td><td>' + (FC.isSignalVia(via) ? '信号孔' : 'GND / 伴随孔') + '</td>' +
          '<td>[' + point.nx.toFixed(2) + ', ' + point.ny.toFixed(2) + ']</td><td><b>' + esc(via.role || '-') + '</b><br><span>' + esc(via.padstack || '-') + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function fanoutCompareSharedSpan(schemes) {
    var maxSpan = 10;
    schemes.forEach(function (scheme) {
      (scheme.normalizedVias || []).forEach(function (via) {
        maxSpan = Math.max(maxSpan, Math.abs(via.nx), Math.abs(via.ny));
      });
    });
    return maxSpan;
  }

  function drawFanoutComparePreview(canvas, scheme, sharedSpan) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
    var scale = Math.min(w, h) * 0.38 / Math.max(10, sharedSpan);
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148,163,184,.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(16, cy); ctx.lineTo(w - 16, cy); ctx.moveTo(cx, 16); ctx.lineTo(cx, h - 16); ctx.stroke();
    if (FC.syncLibraryPadstackColors) FC.syncLibraryPadstackColors(State.library.schemes);
    var colors = FC.buildPadstackColorMap ? FC.buildPadstackColorMap(scheme.vias, State.library.schemes).map : {};
    (scheme.normalizedVias || []).forEach(function (via) {
      var x = cx + via.nx * scale, y = cy - via.ny * scale;
      var color = colors[String(via.padstack || 'VIA_PAD')] || (FC.getPadstackColorEntry ? FC.getPadstackColorEntry(via.padstack) : null);
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = color ? color.fill : '#38bdf8'; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#0f172a'; ctx.fill();
      ctx.fillStyle = '#f8fafc'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('#' + via.id, x, y - 12);
    });
  }

  function populateFanoutCompareSelectors() {
    var schemes = State.library.schemes || [];
    var a = document.getElementById('selCompareSchemeA'), b = document.getElementById('selCompareSchemeB');
    if (!a || !b) return;
    var previousA = a.value, previousB = b.value;
    var options = schemes.map(function (scheme) {
      return '<option value="' + esc(scheme.id) + '">' + esc(scheme.name) + ' · ' + scheme.viaCount + ' 孔</option>';
    }).join('');
    a.innerHTML = options; b.innerHTML = options;
    a.value = schemes.some(function (scheme) { return String(scheme.id) === previousA; }) ? previousA : (schemes[0] ? String(schemes[0].id) : '');
    b.value = schemes.some(function (scheme) { return String(scheme.id) === previousB && previousB !== a.value; }) ? previousB : (schemes[1] ? String(schemes[1].id) : '');
  }

  function updateFanoutSchemeComparison(changedSide) {
    var schemes = State.library.schemes || [];
    var aSelect = document.getElementById('selCompareSchemeA'), bSelect = document.getElementById('selCompareSchemeB');
    if (!aSelect || !bSelect || schemes.length < 2) return;
    if (aSelect.value === bSelect.value) {
      var replacement = schemes.find(function (scheme) { return String(scheme.id) !== (changedSide === 'a' ? aSelect.value : bSelect.value); });
      if (changedSide === 'a') bSelect.value = String(replacement.id); else aSelect.value = String(replacement.id);
    }
    var schemeA = fanoutCompareFindScheme(aSelect.value), schemeB = fanoutCompareFindScheme(bSelect.value);
    if (!schemeA || !schemeB) return;
    var a = fanoutCompareMetrics(schemeA), b = fanoutCompareMetrics(schemeB);
    var rows = [
      fanoutCompareMetricRow('所属类别', esc(a.category), esc(b.category), a.category, b.category),
      fanoutCompareMetricRow('过孔总数', a.total + ' 孔', b.total + ' 孔', a.total, b.total),
      fanoutCompareMetricRow('信号孔数', a.signals + ' 孔', b.signals + ' 孔', a.signals, b.signals),
      fanoutCompareMetricRow('GND / 伴随孔数', a.grounds + ' 孔', b.grounds + ' 孔', a.grounds, b.grounds),
      fanoutCompareMetricRow('Padstack 构成', a.padstacks.html, b.padstacks.html, a.padstacks.key, b.padstacks.key),
      fanoutCompareMetricRow('最小孔心距', a.distance.min == null ? '-' : a.distance.min.toFixed(2) + ' mil', b.distance.min == null ? '-' : b.distance.min.toFixed(2) + ' mil', a.distance.min, b.distance.min),
      fanoutCompareMetricRow('最大孔心距', a.distance.max == null ? '-' : a.distance.max.toFixed(2) + ' mil', b.distance.max == null ? '-' : b.distance.max.toFixed(2) + ' mil', a.distance.max, b.distance.max),
      fanoutCompareMetricRow('几何跨度', a.spanText, b.spanText, a.spanKey, b.spanKey),
      fanoutCompareMetricRow('孔心距谱', esc(a.spectrum), esc(b.spectrum), a.spectrum, b.spectrum)
    ];
    var output = document.getElementById('schemeCompareOutput');
    output.innerHTML = '<div class="scheme-compare-preview-grid"><div><h4>方案 A · ' + esc(schemeA.name) + '</h4><canvas id="compareCanvasA" width="420" height="260"></canvas></div>' +
      '<div><h4>方案 B · ' + esc(schemeB.name) + '</h4><canvas id="compareCanvasB" width="420" height="260"></canvas></div></div>' +
      '<div class="scheme-compare-scale-note">两幅图使用相同比例与中心原点，便于直接比较孔位跨度</div>' +
      '<div class="table-wrap scheme-compare-metrics"><table><thead><tr><th>对比项</th><th>方案 A</th><th>结论</th><th>方案 B</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<div class="scheme-compare-via-grid">' + fanoutCompareViaTable(schemeA, 'A') + fanoutCompareViaTable(schemeB, 'B') + '</div>';
    var differenceCount = output.querySelectorAll('.scheme-compare-different').length;
    var status = document.getElementById('schemeCompareStatus');
    status.className = 'scheme-compare-status ' + (differenceCount ? 'has-difference' : 'is-aligned');
    status.textContent = differenceCount ? '发现 ' + differenceCount + ' 项关键差异，表格已逐项标出' : rows.length + ' 项关键指标一致，仍需结合逐孔角色复核';
    var sharedSpan = fanoutCompareSharedSpan([schemeA, schemeB]);
    drawFanoutComparePreview(document.getElementById('compareCanvasA'), schemeA, sharedSpan);
    drawFanoutComparePreview(document.getElementById('compareCanvasB'), schemeB, sharedSpan);
  }

  function installFanoutSchemeCompareModal() {
    if (document.getElementById('modalSchemeCompare')) return;
    var modal = document.createElement('div');
    modal.className = 'modal-mask'; modal.id = 'modalSchemeCompare';
    modal.innerHTML = '<div class="modal-box scheme-compare-modal-box"><div class="modal-header"><div>' +
      '<h3>扇出方案对比</h3><div class="hint">使用相同比例预览，并逐项比较孔数、Padstack、孔心距和逐孔定义；对比仅用于复核方案库，不修改检查结果</div></div>' +
      '<button type="button" class="btn sec small" onclick="closeFanoutSchemeCompare()">关闭</button></div>' +
      '<div class="scheme-compare-controls"><div class="form-item"><label for="selCompareSchemeA">方案 A</label>' +
      '<select id="selCompareSchemeA" data-no-persist onchange="updateFanoutSchemeComparison(\'a\')"></select></div>' +
      '<button type="button" class="btn sec small scheme-compare-swap" onclick="swapFanoutSchemeComparison()">交换 A / B</button>' +
      '<div class="form-item"><label for="selCompareSchemeB">方案 B</label>' +
      '<select id="selCompareSchemeB" data-no-persist onchange="updateFanoutSchemeComparison(\'b\')"></select></div>' +
      '<div id="schemeCompareStatus" class="scheme-compare-status"></div></div>' +
      '<div id="schemeCompareOutput" class="scheme-compare-output"></div></div>';
    document.body.appendChild(modal);
  }

  function openFanoutSchemeCompare() {
    if (!State.library || State.library.schemes.length < 2) { root.alert('方案库至少需要两套方案才能对比'); return; }
    installFanoutSchemeCompareModal();
    populateFanoutCompareSelectors();
    document.getElementById('modalSchemeCompare').classList.add('open');
    updateFanoutSchemeComparison('a');
  }

  function closeFanoutSchemeCompare() { document.getElementById('modalSchemeCompare').classList.remove('open'); }
  function swapFanoutSchemeComparison() {
    var a = document.getElementById('selCompareSchemeA'), b = document.getElementById('selCompareSchemeB');
    var value = a.value; a.value = b.value; b.value = value; updateFanoutSchemeComparison('swap');
  }

  root.fanoutCompareMetrics = fanoutCompareMetrics;
  root.openFanoutSchemeCompare = openFanoutSchemeCompare;
  root.closeFanoutSchemeCompare = closeFanoutSchemeCompare;
  root.updateFanoutSchemeComparison = updateFanoutSchemeComparison;
  root.swapFanoutSchemeComparison = swapFanoutSchemeComparison;
})(typeof window !== 'undefined' ? window : globalThis);
