/* ============================================================================
 * fanout-analysis-ui.js —— 扇出方案检查模块：⑤ 规律分析与差分扇出归纳导出
 * ========================================================================== */
(function (root) {
  "use strict";

  var State = root.State;
  var escapeHtml = root.escHtml || function (s) { return String(s == null ? "" : s); };
  var boardCache = { source: null, length: -1, geometry: null, base: null };

  function canvasContext(canvas) {
    try { return canvas && canvas.getContext ? canvas.getContext('2d') : null; }
    catch (error) { return null; }
  }

  function boardGeometry() {
    if (boardCache.source === State.vias && boardCache.length === (State.vias || []).length && boardCache.geometry) return boardCache.geometry;
    var points = [], minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    (State.vias || []).forEach(function (via) {
      if (!via || !isFinite(via.x) || !isFinite(via.y)) return;
      points.push(via);
      minX = Math.min(minX, via.x); maxX = Math.max(maxX, via.x);
      minY = Math.min(minY, via.y); maxY = Math.max(maxY, via.y);
    });
    if (!isFinite(minX)) { minX = 0; maxX = 100; minY = 0; maxY = 100; }
    if (minX === maxX) { minX -= 50; maxX += 50; }
    if (minY === maxY) { minY -= 50; maxY += 50; }
    boardCache = {
      source: State.vias, length: (State.vias || []).length,
      geometry: { points: points, minX: minX, maxX: maxX, minY: minY, maxY: maxY }, base: null
    };
    return boardCache.geometry;
  }

  function boardTransform(geometry, width, height, pad) {
    var dx = geometry.maxX - geometry.minX, dy = geometry.maxY - geometry.minY;
    var scale = Math.min((width - pad * 2) / dx, (height - pad * 2) / dy);
    var offsetX = (width - dx * scale) / 2, offsetY = (height - dy * scale) / 2;
    return function (x, y) {
      return [offsetX + (x - geometry.minX) * scale, height - offsetY - (y - geometry.minY) * scale];
    };
  }

  function drawBoardBase(canvas, large) {
    var ctx = canvasContext(canvas);
    if (!ctx) return false;
    var width = canvas.width, height = canvas.height, geometry = boardGeometry();
    var xy = boardTransform(geometry, width, height, large ? 28 : 12);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#07111f'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(148,163,184,.18)'; ctx.lineWidth = 1;
    for (var gx = 1; gx < 4; gx++) {
      var x = width * gx / 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (var gy = 1; gy < 3; gy++) {
      var y = height * gy / 3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    var step = Math.max(1, Math.ceil(geometry.points.length / (large ? 8000 : 4000)));
    ctx.fillStyle = 'rgba(96,165,250,.72)';
    for (var i = 0; i < geometry.points.length; i += step) {
      var via = geometry.points[i], point = xy(via.x, via.y), size = large ? 2.3 : 1.5;
      ctx.fillRect(point[0] - size / 2, point[1] - size / 2, size, size);
    }
    ctx.strokeStyle = '#64748b'; ctx.strokeRect(1, 1, width - 2, height - 2);
    return true;
  }

  function markerVias(cluster) {
    var vias = cluster && cluster.signalVias && cluster.signalVias.length ? cluster.signalVias : [];
    if (!vias.length && cluster && cluster.centroid) return [{ x: cluster.centroid.x, y: cluster.centroid.y }];
    return vias;
  }

  function drawBoardMarkers(ctx, canvas, item, large) {
    var geometry = boardGeometry(), xy = boardTransform(geometry, canvas.width, canvas.height, large ? 28 : 12);
    var color = item.isPass ? '#22c55e' : (item.hasPadError ? '#ef4444' : (item.hasPosError ? '#f59e0b' : '#a855f7'));
    var radius = large ? 8 : 5;
    ctx.fillStyle = color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = large ? 1.5 : 1;
    markerVias(item.cluster).forEach(function (via) {
      if (!isFinite(via.x) || !isFinite(via.y)) return;
      var point = xy(via.x, via.y);
      ctx.beginPath(); ctx.moveTo(point[0], point[1] - radius); ctx.lineTo(point[0] + radius, point[1]);
      ctx.lineTo(point[0], point[1] + radius); ctx.lineTo(point[0] - radius, point[1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    });
  }

  function drawBoard(canvas, item, large) {
    var ctx = canvasContext(canvas);
    if (!ctx) return;
    boardGeometry();
    if (!large) {
      if (!boardCache.base) {
        boardCache.base = document.createElement('canvas'); boardCache.base.width = canvas.width; boardCache.base.height = canvas.height;
        drawBoardBase(boardCache.base, false);
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(boardCache.base, 0, 0, canvas.width, canvas.height);
    } else drawBoardBase(canvas, true);
    drawBoardMarkers(ctx, canvas, item, large);
  }

  function ensureBoardZoom() {
    var mask = document.getElementById('fanoutAnalysisBoardZoom');
    if (mask) return mask;
    mask = document.createElement('div'); mask.id = 'fanoutAnalysisBoardZoom'; mask.hidden = true;
    mask.style.cssText = 'position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(2,6,23,.82)';
    mask.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="fanoutAnalysisBoardZoomTitle" style="width:min(1000px,calc(100vw - 48px));border:1px solid #475569;border-radius:10px;background:#0f172a;padding:12px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;color:#f8fafc"><b id="fanoutAnalysisBoardZoomTitle"></b><button type="button" class="btn sec fanout-analysis-board-close">关闭</button></div>' +
      '<canvas width="960" height="570" style="display:block;width:100%;height:auto;border:1px solid #334155;border-radius:6px;background:#07111f"></canvas></div>';
    document.body.appendChild(mask);
    function close() { mask.hidden = true; mask.style.display = 'none'; }
    mask.querySelector('.fanout-analysis-board-close').onclick = close;
    mask.onclick = function (event) { if (event.target === mask) close(); };
    return mask;
  }

  function openBoardZoom(item) {
    var mask = ensureBoardZoom();
    mask.querySelector('#fanoutAnalysisBoardZoomTitle').textContent = item.net + ' · ' + item.schemeName + ' · ' + item.locationText;
    drawBoard(mask.querySelector('canvas'), item, true);
    mask.hidden = false; mask.style.display = 'flex';
    mask.querySelector('.fanout-analysis-board-close').focus();
  }

  function boardCell(item) {
    return '<td style="min-width:250px"><button type="button" class="fanout-analysis-board-open" data-cluster-id="' + escapeHtml(item.clusterId) + '" ' +
      'aria-label="放大查看 ' + escapeHtml(item.net) + ' 板上位置" style="display:block;width:240px;padding:0;border:1px solid #334155;border-radius:7px;overflow:hidden;background:#07111f;color:#dbeafe;cursor:zoom-in">' +
      '<canvas class="fanout-analysis-board" width="480" height="270" style="display:block;width:240px;height:135px;background:#07111f"></canvas>' +
      '<span style="display:block;padding:4px 8px;border-top:1px solid #334155;background:#0f172a;font-size:11px;font-weight:700">放大查看</span></button>' +
      '<div style="width:240px;margin-top:4px;color:var(--sub);font:11px var(--mono);overflow-wrap:anywhere">' + escapeHtml(item.locationText) + '</div></td>';
  }

  function mountBoardCells(tbody, items) {
    var byId = {}, buttons = tbody.querySelectorAll('.fanout-analysis-board-open');
    items.forEach(function (item) { byId[item.clusterId] = item; });
    Array.prototype.forEach.call(buttons, function (button) {
      var item = byId[button.getAttribute('data-cluster-id')];
      if (item) button.onclick = function () { openBoardZoom(item); };
    });
    var draw = function () {
      Array.prototype.forEach.call(buttons, function (button) {
        var item = byId[button.getAttribute('data-cluster-id')];
        if (item) drawBoard(button.querySelector('canvas'), item, false);
      });
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(draw); else setTimeout(draw, 0);
  }

  /* ---------- Tab 5: 方案覆盖率与差分规律分析 ---------- */
  function getDiffAnalysisData() {
    if (!State.clusters || !State.clusters.length) return [];
    return State.clusters.map(function (c, idx) {
      var res = c.matchResult || {};
      var sigVias = c.signalVias || [];
      var sigIds = sigVias.map(function (v) { return '#' + v.id; }).join(', ');
      var isReviewed = State.reviewedClusters.has(c.id);
      var isPass = isReviewed ? true : !!res.pass;

      var padSignalCount = 0, padGndCount = 0;
      if (!isReviewed && res.padMismatchList && res.padMismatchList.length > 0) {
        res.padMismatchList.forEach(function (pm) {
          if (pm.net && pm.net.toUpperCase().indexOf('GND') < 0) padSignalCount++;
          else padGndCount++;
        });
      }

      var posSignalCount = 0, posGndCount = 0;
      if (!isReviewed && res.missingVias && res.missingVias.length > 0) {
        res.missingVias.forEach(function (mv) {
          if (mv.net && mv.net.toUpperCase().indexOf('GND') < 0) posSignalCount++;
          else posGndCount++;
        });
      }

      var padErrorText = '无';
      if (!isReviewed && (padSignalCount > 0 || padGndCount > 0)) padErrorText = '信号孔 ' + padSignalCount + ' / GND孔 ' + padGndCount;
      else if (isReviewed && res.padMismatchList && res.padMismatchList.length > 0) padErrorText = '无 · 已复核';

      var posErrorText = '无';
      if (!isReviewed && (posSignalCount > 0 || posGndCount > 0)) posErrorText = '信号孔 ' + posSignalCount + ' / GND孔 ' + posGndCount;
      else if (isReviewed && res.missingVias && res.missingVias.length > 0) posErrorText = '无 · 已复核';

      var center = c.centroid || { x: 0, y: 0 };
      return {
        index: idx + 1,
        clusterId: c.id,
        cluster: c,
        net: c.signalNet || ((sigVias[0] && sigVias[0].net) || 'UNKNOWN'),
        sigIds: sigIds || '-',
        schemeName: res.schemeName || '未匹配方案',
        isPass: isPass,
        isReviewed: isReviewed,
        status: isReviewed ? 'REVIEWED_PASS' : res.status,
        statusText: isReviewed ? '已复核通过' : (res.statusText || (isPass ? '匹配通过' : '未匹配')),
        hasAnyError: !isPass,
        hasPadError: !isReviewed && (padSignalCount > 0 || padGndCount > 0),
        hasPosError: !isReviewed && (posSignalCount > 0 || posGndCount > 0),
        padErrorText: padErrorText,
        posErrorText: posErrorText,
        advice: isReviewed ? '已复核确认' : (res.advice || res.message || '无需调整'),
        locationText: '孔群 [' + Number(center.x).toFixed(1) + ', ' + Number(center.y).toFixed(1) + '] · ' + (sigIds || '无信号孔')
      };
    });
  }

  function renderDiffAnalysisTable() {
    var tbody = document.getElementById('tblDiffAnalysisBody');
    if (!tbody) return;
    var allData = getDiffAnalysisData();

    var setTxt = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = String(v); };
    setTxt('cntAnaFilterAll', allData.length);
    setTxt('cntAnaFilterPass', allData.filter(function (d) { return d.isPass; }).length);
    setTxt('cntAnaFilterPadstack', allData.filter(function (d) { return d.hasPadError; }).length);
    setTxt('cntAnaFilterPos', allData.filter(function (d) { return d.hasPosError; }).length);
    setTxt('cntAnaFilterFail', allData.filter(function (d) { return d.hasAnyError; }).length);

    if (!allData.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--sub)">暂无差分扇出分析数据</td></tr>';
      return;
    }

    var filtered = allData.filter(function (d) {
      if (State.analysisFilter === 'pass') return d.isPass;
      if (State.analysisFilter === 'padstack') return d.hasPadError;
      if (State.analysisFilter === 'pos') return d.hasPosError;
      if (State.analysisFilter === 'fail') return d.hasAnyError;
      return true;
    });
    if (State.analysisSearch) {
      var q = State.analysisSearch;
      filtered = filtered.filter(function (d) {
        return d.net.toLowerCase().indexOf(q) >= 0 || d.sigIds.toLowerCase().indexOf(q) >= 0 ||
          d.schemeName.toLowerCase().indexOf(q) >= 0 || d.advice.toLowerCase().indexOf(q) >= 0;
      });
    }

    var pageSize = State.analysisPageSize || 15;
    var totalItems = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    State.analysisPage = Math.max(1, Math.min(totalPages, State.analysisPage));
    var startIdx = (State.analysisPage - 1) * pageSize;
    var pageItems = filtered.slice(startIdx, startIdx + pageSize);

    setTxt('lblAnaPageStart', totalItems === 0 ? 0 : startIdx + 1);
    setTxt('lblAnaPageEnd', Math.min(totalItems, startIdx + pageItems.length));
    setTxt('lblAnaTotalCount', totalItems);
    setTxt('lblAnaCurrentPage', State.analysisPage + ' / ' + totalPages);

    if (!pageItems.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--sub)">未找到匹配的记录</td></tr>';
      return;
    }

    tbody.innerHTML = pageItems.map(function (d, pIdx) {
      var statusBadge = d.isReviewed
        ? '<span class="badge-tag ok">已复核</span>'
        : (d.isPass ? '<span class="badge-tag ok">匹配通过</span>' : '<span class="badge-tag bad">' + escapeHtml(d.statusText) + '</span>');
      return '<tr class="' + (d.isReviewed ? 'reviewed' : '') + '">' +
        '<td><strong>' + (startIdx + pIdx + 1) + '</strong></td>' +
        '<td style="text-align:center"><input type="checkbox" data-no-persist ' + (d.isReviewed ? 'checked' : '') + ' onchange="toggleReviewCluster(\'' + d.clusterId + '\', this.checked)"></td>' +
        '<td><b style="color:var(--pri);cursor:pointer" onclick="locateClusterInCanvas(\'' + d.clusterId + '\')">' + escapeHtml(d.net) + '</b></td>' +
        '<td style="font-family:var(--mono);font-size:12px">' + escapeHtml(d.sigIds) + '</td>' +
        '<td><b>' + escapeHtml(d.schemeName) + '</b></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="color:' + (d.hasPadError ? 'var(--bad)' : 'var(--ok)') + ';font-weight:600">' + escapeHtml(d.padErrorText) + '</td>' +
        '<td style="color:' + (d.hasPosError ? 'var(--warn)' : 'var(--ok)') + ';font-weight:600">' + escapeHtml(d.posErrorText) + '</td>' +
        '<td style="font-size:12px;color:var(--sub)">' + escapeHtml(d.advice) + '</td>' +
        '<td><button type="button" class="btn small sec" onclick="locateClusterInCanvas(\'' + d.clusterId + '\')">定位</button></td>' +
        boardCell(d) + '</tr>';
    }).join('');
    mountBoardCells(tbody, pageItems);
  }

  function renderAnalysisTab() {
    var pnlScheme = document.getElementById('pnlSchemeRanking');
    var pnlDefect = document.getElementById('pnlDefectRanking');
    if (!State.summary || !State.clusters.length) {
      if (pnlScheme) pnlScheme.innerHTML = '<div style="color:var(--sub)">尚无数据</div>';
      if (pnlDefect) pnlDefect.innerHTML = '<div style="color:var(--sub)">尚无数据</div>';
      return;
    }
    var cov = State.summary.schemeCoverage || {};
    var covEntries = Object.entries(cov).sort(function (a, b) { return b[1] - a[1]; });
    if (pnlScheme) {
      pnlScheme.innerHTML = covEntries.length
        ? covEntries.map(function (e) {
            return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><strong>' + escapeHtml(e[0]) + '</strong><span class="badge-tag ok">' + e[1] + ' 处匹配</span></div>';
          }).join('')
        : '<div style="color:var(--sub)">未匹配到任何方案库模板</div>';
    }
    var s = State.summary;
    if (pnlDefect) {
      pnlDefect.innerHTML =
        '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><span>Padstack 不符</span><span class="badge-tag bad">' + (s.padstackFailCount || 0) + ' 处</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><span>中心距超差 / 伴随地孔缺失</span><span class="badge-tag warn">' + (s.distFailCount || 0) + ' 处</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:6px 0"><span>未匹配方案库</span><span class="badge-tag bad">' + (s.noMatchCount || 0) + ' 处</span></div>';
    }
    renderDiffAnalysisTable();
  }

  function setAnalysisFilter(filterType) {
    State.analysisFilter = filterType;
    State.analysisPage = 1;
    var btnMap = { all: 'btnAnaFilterAll', pass: 'btnAnaFilterPass', padstack: 'btnAnaFilterPadstack', pos: 'btnAnaFilterPos', fail: 'btnAnaFilterFail' };
    Object.keys(btnMap).forEach(function (k) {
      var el = document.getElementById(btnMap[k]);
      if (el) el.className = (k === filterType) ? 'btn small pri' : 'btn small sec';
    });
    renderDiffAnalysisTable();
  }

  function applyAnalysisFilters() {
    var inp = document.getElementById('inpAnaSearch');
    State.analysisSearch = inp ? inp.value.trim().toLowerCase() : '';
    State.analysisPage = 1;
    renderDiffAnalysisTable();
  }

  function changeAnaPage(delta) { State.analysisPage += delta; renderDiffAnalysisTable(); }

  function exportDiffAnalysisCSV() {
    var data = getDiffAnalysisData();
    if (!data.length) { alert('暂无差分分析数据'); return; }
    var csv = '\uFEFF序号,差分网络,信号孔编号,目标扇出方案,判定状态,Padstack错误,位置错误,调整建议,板上位置\n';
    data.forEach(function (d, idx) {
      csv += [idx + 1, '"' + d.net + '"', '"' + d.sigIds + '"', '"' + d.schemeName + '"', '"' + d.statusText + '"', '"' + d.padErrorText + '"', '"' + d.posErrorText + '"', '"' + String(d.advice).replace(/"/g, '""') + '"', '"' + d.locationText + '"'].join(',') + '\n';
    });
    root.showExportBox('diff_fanout_analysis_' + Date.now() + '.csv', csv, '共 ' + data.length + ' 组记录。', 'text/csv');
  }

  root.setClusterThresh = setClusterThresh;

  root.renderAnalysisTab = renderAnalysisTab;
  root.setAnalysisFilter = setAnalysisFilter;
  root.applyAnalysisFilters = applyAnalysisFilters;
  root.changeAnaPage = changeAnaPage;
  root.exportDiffAnalysisCSV = exportDiffAnalysisCSV;
})(typeof window !== "undefined" ? window : globalThis);
