/* ============================================================================
 * fanout-canvas-review.js —— 扇出问题点标记与结果定位往返
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var State = root.State;

  function getFanoutClusterIssueMarkers(cluster) {
    if (!cluster || !cluster.matchResult || cluster.matchResult.pass) return [];
    var result = cluster.matchResult, markers = [], seen = new Set();
    function viaById(id) {
      return (cluster.vias || []).find(function (via) { return String(via.id) === String(id); });
    }
    function add(kind, x, y, label, viaId) {
      if (!isFinite(x) || !isFinite(y)) return;
      var key = kind === 'missing' ? kind + ':' + x.toFixed(4) + ':' + y.toFixed(4) : kind + ':' + String(viaId || '') + ':' + x.toFixed(4) + ':' + y.toFixed(4);
      if (seen.has(key)) return;
      seen.add(key);
      markers.push({ kind: kind, x: Number(x), y: Number(y), label: label, viaId: viaId });
    }

    (result.padstackMismatches || result.padMismatchList || []).forEach(function (issue) {
      var via = viaById(issue.viaId), x = issue.x != null ? issue.x : via && via.x, y = issue.y != null ? issue.y : via && via.y;
      add('padstack', x, y, 'Padstack 不符' + (issue.viaId != null ? ' #' + issue.viaId : ''), issue.viaId);
    });
    (result.viaAudit || []).forEach(function (audit) {
      if (audit.isMatch !== false) return;
      var via = viaById(audit.viaId), x = audit.x != null ? audit.x : via && via.x, y = audit.y != null ? audit.y : via && via.y;
      add('padstack', x, y, 'Padstack 不符' + (audit.viaId != null ? ' #' + audit.viaId : ''), audit.viaId);
    });
    (result.missingVias || []).forEach(function (issue) {
      add('missing', issue.expectedX, issue.expectedY, '缺失孔建议位置');
    });

    if (!markers.length) {
      var targets = cluster.signalVias && cluster.signalVias.length ? cluster.signalVias : [];
      if (!targets.length && cluster.centroid) targets = [cluster.centroid];
      targets.forEach(function (via) {
        add('cluster', via.x, via.y, '孔群匹配异常' + (via.id != null ? ' #' + via.id : ''), via.id);
      });
    }
    return markers;
  }

  function drawFanoutClusterIssueMarkers(ctx, cluster, worldToScreen, padRadius) {
    var markers = getFanoutClusterIssueMarkers(cluster);
    markers.forEach(function (marker, index) {
      var point = worldToScreen(marker.x, marker.y);
      var missing = marker.kind === 'missing';
      var color = missing ? '#f59e0b' : '#ef4444';
      var radius = Math.max(13, padRadius + 8);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = missing ? 'rgba(245,158,11,.18)' : 'rgba(239,68,68,.2)';
      ctx.lineWidth = 3;
      ctx.setLineDash(missing ? [6, 4] : []);
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(point.x - radius - 4, point.y); ctx.lineTo(point.x + radius + 4, point.y);
      ctx.moveTo(point.x, point.y - radius - 4); ctx.lineTo(point.x, point.y + radius + 4);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(point.x + radius, point.y - radius, 10, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 11px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), point.x + radius, point.y - radius);
      ctx.restore();
    });
    return markers;
  }

  function rememberFanoutResultPosition(sourceElement, clusterId) {
    var row = sourceElement && sourceElement.closest ? sourceElement.closest('tr') : null;
    if (!row || State.activeTab !== 'tabResults') return;
    var main = document.querySelector('.eda-center-col > main');
    State.canvas.returnPosition = {
      clusterId: clusterId, rowId: row.id,
      rowTop: row.getBoundingClientRect().top,
      mainScrollTop: main ? main.scrollTop : 0,
      scrollX: root.scrollX || 0, scrollY: root.scrollY || 0,
      page: State.page
    };
    var button = document.getElementById('btnReturnFanoutResults');
    if (button) button.style.display = '';
  }

  function returnToFanoutResults() {
    var saved = State.canvas.returnPosition;
    if (saved && saved.page) State.page = saved.page;
    if (typeof root.renderResultsTable === 'function') root.renderResultsTable();
    root.switchTab('tabResults');
    if (!saved) return;
    var restore = function () {
      var row = saved.rowId && document.getElementById(saved.rowId);
      var main = document.querySelector('.eda-center-col > main');
      if (main && typeof saved.mainScrollTop === 'number') main.scrollTop = saved.mainScrollTop;
      if (!row) {
        if (typeof root.scrollTo === 'function') root.scrollTo(saved.scrollX, saved.scrollY);
        return;
      }
      var delta = row.getBoundingClientRect().top - saved.rowTop;
      if (main && Math.abs(delta) > 4) main.scrollTop += delta;
      if (typeof root.scrollTo === 'function') root.scrollTo(saved.scrollX, saved.scrollY + delta);
      row.classList.add('fanout-located-flash');
      setTimeout(function () { row.classList.remove('fanout-located-flash'); }, 1800);
    };
    restore();
  }

  root.getFanoutClusterIssueMarkers = getFanoutClusterIssueMarkers;
  root.drawFanoutClusterIssueMarkers = drawFanoutClusterIssueMarkers;
  root.rememberFanoutResultPosition = rememberFanoutResultPosition;
  root.returnToFanoutResults = returnToFanoutResults;
})(typeof window !== 'undefined' ? window : globalThis);
