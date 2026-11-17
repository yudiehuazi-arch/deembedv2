/* ============================================================================
 * dfm-canvas-defects.js —— DFM 2D 视口：不满足位置筛选与特别标记
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.DfmApp;
  var LINE_GND_COLOR = '#f59e0b';
  var LINE_SIGNAL_COLOR = '#fb7185';
  var PAD_PAIR_COLOR = '#a78bfa';

  function textOfVia(via) {
    return [via && via.padstack, via && via.net].map(function (value) {
      return String(value || '').toLowerCase();
    }).join(' ');
  }

  function matchesPadPairQuery(defect, query) {
    var normalized = String(query || '').trim().toLowerCase();
    if (!normalized) return true;
    return textOfVia(defect.gndVia).indexOf(normalized) >= 0 ||
      textOfVia(defect.sigVia).indexOf(normalized) >= 0;
  }

  /**
   * options: { mode:'none'|'all'|'line'|'pad', lineGnd, lineSignal, query }
   * “全显示”不受子筛选影响；线到孔与孔到孔模式分别应用自己的筛选条件。
   */
  function select(checkResult, options) {
    var result = checkResult || {};
    var opts = options || {};
    var mode = opts.mode || 'all';
    var line = result.defectPairs || (result.pairs || []).filter(function (pair) {
      return pair.status === '不满足';
    });
    var pad = result.padPairDefects || [];

    if (mode === 'none' || mode === 'pad') line = [];
    if (mode === 'line') {
      line = line.filter(function (pair) {
        var isGnd = pair.isGndVia != null ? pair.isGndVia : !!(pair.via && pair.via.isGnd);
        return isGnd ? opts.lineGnd !== false : opts.lineSignal !== false;
      });
    }
    if (mode === 'none' || mode === 'line') pad = [];
    if (mode === 'pad') {
      pad = pad.filter(function (defect) { return matchesPadPairQuery(defect, opts.query); });
    }

    return { line: line, pad: pad, total: line.length + pad.length };
  }

  function inBounds(point, bounds, pad) {
    return point[0] + pad >= bounds.minX && point[0] - pad <= bounds.maxX &&
      point[1] + pad >= bounds.minY && point[1] - pad <= bounds.maxY;
  }

  function drawDiamond(ctx, x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawRing(ctx, point, radius, color, haloColor) {
    ctx.fillStyle = haloColor;
    ctx.beginPath(); ctx.arc(point[0], point[1], radius + 5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(point[0], point[1], radius, 0, 2 * Math.PI); ctx.stroke();
  }

  function drawLineDefect(ctx, pair, o) {
    var viaWorld = pair.via.origin;
    var projWorld = pair.proj;
    if (!inBounds(viaWorld, o.bounds, 50) && !inBounds(projWorld, o.bounds, 50)) return;
    var isGnd = pair.isGndVia != null ? pair.isGndVia : !!pair.via.isGnd;
    var color = isGnd ? LINE_GND_COLOR : LINE_SIGNAL_COLOR;
    var halo = isGnd ? 'rgba(245,158,11,0.18)' : 'rgba(251,113,133,0.18)';
    var viaPoint = o.worldToScreen(viaWorld[0], viaWorld[1]);
    var tracePoint = o.worldToScreen(projWorld[0], projWorld[1]);
    var ringRadius = Math.max(7, (pair.via.padRadius || 3) * o.vp.zoom + 5);

    ctx.save();
    drawRing(ctx, viaPoint, ringRadius, color, halo);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(viaPoint[0], viaPoint[1]); ctx.lineTo(tracePoint[0], tracePoint[1]); ctx.stroke();
    ctx.setLineDash([]);
    drawDiamond(ctx, tracePoint[0], tracePoint[1], 5, color);
    if (o.showLabels && o.vp.zoom > 0.6) {
      ctx.fillStyle = color;
      ctx.font = 'bold 11px ui-monospace, sans-serif';
      ctx.fillText((isGnd ? '线→GND ' : '线→信号 ') + Number(pair.evalDist).toFixed(2) + ' mil', tracePoint[0] + 8, tracePoint[1] - 8);
    }
    ctx.restore();
  }

  function drawPadPairDefect(ctx, defect, o) {
    var gndWorld = defect.gndVia.origin;
    var sigWorld = defect.sigVia.origin;
    var midWorld = [(gndWorld[0] + sigWorld[0]) / 2, (gndWorld[1] + sigWorld[1]) / 2];
    if (!inBounds(gndWorld, o.bounds, 50) && !inBounds(sigWorld, o.bounds, 50) && !inBounds(midWorld, o.bounds, 50)) return;
    var gndPoint = o.worldToScreen(gndWorld[0], gndWorld[1]);
    var sigPoint = o.worldToScreen(sigWorld[0], sigWorld[1]);
    var midPoint = o.worldToScreen(midWorld[0], midWorld[1]);
    var gndRadius = Math.max(7, (defect.gndVia.padRadius || 3) * o.vp.zoom + 5);
    var sigRadius = Math.max(7, (defect.sigVia.padRadius || 3) * o.vp.zoom + 5);

    ctx.save();
    drawRing(ctx, gndPoint, gndRadius, PAD_PAIR_COLOR, 'rgba(167,139,250,0.18)');
    drawRing(ctx, sigPoint, sigRadius, PAD_PAIR_COLOR, 'rgba(167,139,250,0.18)');
    ctx.strokeStyle = PAD_PAIR_COLOR;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 3]);
    ctx.beginPath(); ctx.moveTo(gndPoint[0], gndPoint[1]); ctx.lineTo(sigPoint[0], sigPoint[1]); ctx.stroke();
    ctx.setLineDash([]);
    drawDiamond(ctx, midPoint[0], midPoint[1], 6, PAD_PAIR_COLOR);
    if (o.showLabels && o.vp.zoom > 0.6) {
      ctx.fillStyle = PAD_PAIR_COLOR;
      ctx.font = 'bold 11px ui-monospace, sans-serif';
      ctx.fillText('孔→孔 ' + Number(defect.padAirgap).toFixed(2) + ' mil', midPoint[0] + 9, midPoint[1] - 9);
    }
    ctx.restore();
  }

  function draw(ctx, options) {
    var o = options || {};
    var selection = o.selection || { line: [], pad: [] };
    selection.line.forEach(function (pair) { drawLineDefect(ctx, pair, o); });
    selection.pad.forEach(function (defect) { drawPadPairDefect(ctx, defect, o); });
    return { line: selection.line.length, pad: selection.pad.length, total: selection.line.length + selection.pad.length };
  }

  App.CanvasDefects = {
    select: select,
    draw: draw,
    matchesPadPairQuery: matchesPadPairQuery,
    colors: { lineGnd: LINE_GND_COLOR, lineSignal: LINE_SIGNAL_COLOR, padPair: PAD_PAIR_COLOR }
  };
  root.DfmCanvasDefects = App.CanvasDefects;
})(typeof window !== 'undefined' ? window : globalThis);
