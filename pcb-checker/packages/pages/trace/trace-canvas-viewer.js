/* ============================================================================
 * trace-canvas-viewer.js —— 走线检查 2D 空间几何视口、交互式标尺测量、定位复核与 PNG/SVG 导出
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var App = root.TraceApp, TE = root.TraceEngine;
  var S = App.S, $ = App.$, esc = TE.esc, fmt = TE.fmt;
  var PALETTE = ['#22c55e', '#10b981', '#a855f7', '#ec4899', '#f59e0b', '#14b8a6', '#6366f1', '#84cc16'];
  var canvas = $('traceCanvas');
  var ctx = (canvas && canvas.getContext) ? canvas.getContext('2d') : null;

  function syncCanvasSize() {
    if (!canvas) return;
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw > 200 && ch > 200 && (canvas.width !== cw || canvas.height !== ch)) {
      canvas.width = cw;
      canvas.height = ch;
    }
  }

  function netColor(net) {
    var s = String(net || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  function traceKeyOf(r) {
    return (r.item || r.line || '') + '__' + r.net + '__' + r.layer;
  }

  function getRecordSegments(r) {
    if (r && r.segs && r.segs.length) return r.segs;
    var baseLen = (r && !isNaN(r.length) && r.length > 0) ? r.length : 600;
    var w = (r && r.widthsArr && r.widthsArr.length) ? r.widthsArr[0] : 5.0;
    var y = ((r && r.idx) || 0) * 80;
    return [{ type: 'seg', x1: 0, y1: y, x2: baseLen, y2: y, width: w, radius: NaN, len: baseLen, synthetic: true }];
  }

  function sampleArcSeg(seg, steps) {
    var n = steps || 20;
    if (seg.type !== 'arc' || isNaN(seg.cx) || isNaN(seg.cy) || isNaN(seg.radius) || seg.radius <= 0) {
      return [[seg.x1, seg.y1], [seg.x2, seg.y2]];
    }
    var a1 = Math.atan2(seg.y1 - seg.cy, seg.x1 - seg.cx), a2 = Math.atan2(seg.y2 - seg.cy, seg.x2 - seg.cx), da = a2 - a1;
    if (seg.dir === 'CCW') { while (da < 0) da += 2 * Math.PI; while (da >= 2 * Math.PI) da -= 2 * Math.PI; }
    else if (seg.dir === 'CW') { da = a1 - a2; while (da < 0) da += 2 * Math.PI; while (da >= 2 * Math.PI) da -= 2 * Math.PI; da = -da; }
    else { if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; }
    var pts = [];
    for (var i = 0; i <= n; i++) {
      if (i === 0) pts.push([seg.x1, seg.y1]);
      else if (i === n) pts.push([seg.x2, seg.y2]);
      else { var ang = a1 + da * (i / n); pts.push([seg.cx + seg.radius * Math.cos(ang), seg.cy + seg.radius * Math.sin(ang)]); }
    }
    return pts;
  }

  function recordBounds(r) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxW = 0;
    getRecordSegments(r).forEach(function (s) {
      if (!isNaN(s.width) && s.width > maxW) maxW = s.width;
      var pts = s.type === 'arc' ? sampleArcSeg(s, 20) : [[s.x1, s.y1], [s.x2, s.y2]];
      pts.forEach(function (p) {
        if (!isNaN(p[0]) && !isNaN(p[1])) {
          minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
          minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
        }
      });
    });
    if (!isFinite(minX)) return { minX: 0, maxX: 1000, minY: 0, maxY: 1000, maxW: 5 };
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY, maxW: maxW || 5 };
  }

  function worldToScreen(wx, wy) {
    var vp = S.canvas.viewport, ch = canvas ? canvas.height : 620;
    return [wx * vp.zoom + vp.panX, ch - (wy * vp.zoom + vp.panY)];
  }

  function screenToWorld(sx, sy) {
    var vp = S.canvas.viewport, ch = canvas ? canvas.height : 620;
    return [(sx - vp.panX) / vp.zoom, (ch - sy - vp.panY) / vp.zoom];
  }

  function isSegOffending(seg, v) {
    if (!v || v.st !== 'fail') return false;
    var tol = (S.tol != null ? S.tol : 0.001) + 1e-6;
    if (v.badWidths && v.badWidths.some(function (bw) { return Math.abs(bw - seg.width) <= tol; })) return true;
    if (v.badWidthLens && v.badWidthLens.some(function (bw) { return Math.abs(bw - seg.width) <= tol; })) return true;
    if (seg.type === 'arc' && v.badRadii && v.badRadii.some(function (br) { return Math.abs(br - seg.radius) <= tol; })) return true;
    return !!v.length;
  }

  function visibleRecords() {
    var layer = $('selCanvasLayer') ? $('selCanvasLayer').value : '';
    return layer ? S.records.filter(function (r) { return r.layer === layer; }) : S.records;
  }

  function computeRecordsBounds(recs) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    (recs || []).forEach(function (r) {
      var b = recordBounds(r);
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    });
    if (!isFinite(minX)) return { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
    if (maxX - minX < 20) { minX -= 50; maxX += 50; }
    if (maxY - minY < 20) { minY -= 50; maxY += 50; }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function applyBoxToViewport(box, padX, padY) {
    syncCanvasSize();
    var vp = S.canvas.viewport;
    var w = canvas ? canvas.width : 1200, h = canvas ? canvas.height : 620;
    var mx = padX != null ? padX : 80, my = padY != null ? padY : mx;
    var spanX = box.maxX - box.minX, spanY = box.maxY - box.minY;
    var refSpan = Math.max(spanX, spanY, (box.maxW || 5) * 4, 1);
    var dataW = Math.max(spanX, refSpan * 0.08), dataH = Math.max(spanY, refSpan * 0.08);
    var availW = Math.max(160, w - mx * 2), availH = Math.max(160, h - my * 2);
    vp.minX = box.minX; vp.maxX = box.maxX; vp.minY = box.minY; vp.maxY = box.maxY;
    vp.zoom = Math.max(0.05, Math.min(5000, Math.min(availW / dataW, availH / dataH)));
    var midX = (box.minX + box.maxX) / 2, midY = (box.minY + box.maxY) / 2;
    vp.panX = w / 2 - midX * vp.zoom;
    vp.panY = h / 2 - midY * vp.zoom;
  }

  function zoomRecordToFullViewport(r) {
    if (!r) return;
    var box = recordBounds(r);
    var halfW = (box.maxW || 5) / 2;
    applyBoxToViewport({
      minX: box.minX - halfW, maxX: box.maxX + halfW,
      minY: box.minY - halfW, maxY: box.maxY + halfW,
      maxW: box.maxW
    }, 64, 52);
  }

  function initCanvasData() {
    var sel = $('selCanvasLayer');
    if (sel) {
      var layers = Array.from(new Set(S.records.map(function (r) { return r.layer; }).filter(Boolean))).sort();
      var cur = sel.value;
      sel.innerHTML = '<option value="">全部出线层</option>' +
        layers.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('');
      sel.value = layers.indexOf(cur) >= 0 ? cur : '';
    }
    applyBoxToViewport(computeRecordsBounds(S.records), 80, 64);
    if ($('traceSpatialReviewCard')) $('traceSpatialReviewCard').style.display = 'none';
    if ($('traceMeasureCard')) $('traceMeasureCard').style.display = 'none';
    renderTraceCanvas();
  }

  function fitTraceCanvasView() {
    S.canvas.locatedIdx = null;
    if ($('traceSpatialReviewCard')) $('traceSpatialReviewCard').style.display = 'none';
    var recs = visibleRecords();
    applyBoxToViewport(computeRecordsBounds(recs.length ? recs : S.records), 80, 64);
    renderTraceCanvas();
  }

  function zoomTraceToDefects() {
    S.canvas.locatedIdx = null;
    if ($('traceSpatialReviewCard')) $('traceSpatialReviewCard').style.display = 'none';
    var recs = visibleRecords().filter(function (r) { return App.recStatus(r).st === 'fail'; });
    if (!recs.length) return fitTraceCanvasView();
    applyBoxToViewport(computeRecordsBounds(recs), 72, 56);
    renderTraceCanvas();
  }

  function ptToSegProj(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    var qx = x1 + t * dx, qy = y1 + t * dy;
    return { dist: Math.hypot(px - qx, py - qy), proj: [qx, qy] };
  }

  function findNearestTraceSeg(wx, wy) {
    var best = null, minD = Infinity, thresh = 14 / Math.max(0.1, S.canvas.viewport.zoom);
    visibleRecords().forEach(function (r) {
      getRecordSegments(r).forEach(function (seg, sIdx) {
        var pts = seg.type === 'arc' ? sampleArcSeg(seg, 24) : [[seg.x1, seg.y1], [seg.x2, seg.y2]];
        var res = { dist: Infinity, proj: [seg.x1, seg.y1] };
        for (var i = 0; i < pts.length - 1; i++) {
          var cur = ptToSegProj(wx, wy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (cur.dist < res.dist) res = cur;
        }
        var hitR = (seg.width || 4) / 2 + thresh;
        if (res.dist <= hitR && res.dist < minD) {
          minD = res.dist;
          best = { rec: r, seg: seg, segIdx: sIdx, proj: res.proj, dist: res.dist };
        }
      });
    });
    return best;
  }

  function renderMeasureCard() {
    var card = $('traceMeasureCard'), body = $('traceMeasureCardBody');
    if (!card || !body) return;
    var sel = S.canvas.measureSelection;
    if (!sel.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    var u = esc(S.unit || 'mil');
    if (sel.length === 1) {
      var s1 = sel[0];
      body.innerHTML =
        '<div style="font-size:12px;margin-bottom:6px"><b>起点已选定：</b>请继续点击第二处位置或走线段</div>' +
        '<div class="m-row"><span>起点坐标：</span><b>[' + s1.pt[0].toFixed(2) + ', ' + s1.pt[1].toFixed(2) + ']</b></div>' +
        (s1.rec ? ('<div class="m-row"><span>所属走线：</span><b>Item ' + esc(s1.rec.item || s1.rec.idx + 1) + ' · ' + esc(s1.rec.net) + ' · ' + esc(s1.rec.layer) + '</b></div>' +
          '<div class="m-row"><span>当前段线宽 / 段长：</span><b style="color:#38bdf8">' + fmt(s1.seg.width) + ' ' + u + ' / ' + fmt(s1.seg.len) + ' ' + u + '</b></div>' +
          '<div class="m-row"><span>该网络层总长：</span><b>' + fmt(s1.rec.length) + ' ' + u + '</b></div>') : '');
      return;
    }
    var a = sel[0], b = sel[1];
    var dx = Math.abs(b.pt[0] - a.pt[0]), dy = Math.abs(b.pt[1] - a.pt[1]), dist = Math.hypot(dx, dy);
    var airgap = Math.max(0, dist - ((a.seg ? a.seg.width : 0) + (b.seg ? b.seg.width : 0)) / 2);
    body.innerHTML =
      '<div style="font-size:12px;margin-bottom:6px"><b>测量对象：</b>' +
        (a.rec ? ('Item ' + esc(a.rec.item || a.rec.idx + 1) + ' · ' + esc(a.rec.net)) : '点 P1') + ' ↔ ' +
        (b.rec ? ('Item ' + esc(b.rec.item || b.rec.idx + 1) + ' · ' + esc(b.rec.net)) : '点 P2') + '</div>' +
      '<div class="m-row"><span>两点中心距：</span><b style="color:#38bdf8">' + dist.toFixed(3) + ' ' + u + '</b></div>' +
      (a.seg && b.seg ? '<div class="m-row"><span>走线边缘净距 Airgap：</span><b style="color:#4ade80">' + airgap.toFixed(3) + ' ' + u + '</b></div>' : '') +
      '<div class="m-row"><span>ΔX / ΔY 分量：</span><b>' + dx.toFixed(2) + ' / ' + dy.toFixed(2) + ' ' + u + '</b></div>';
  }

  function drawStrokeSeg(seg, color, lw, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    var pts = seg.type === 'arc' ? sampleArcSeg(seg, 28) : [[seg.x1, seg.y1], [seg.x2, seg.y2]];
    ctx.beginPath();
    pts.forEach(function (pt, i) {
      var sPt = worldToScreen(pt[0], pt[1]);
      if (i === 0) ctx.moveTo(sPt[0], sPt[1]); else ctx.lineTo(sPt[0], sPt[1]);
    });
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  function drawLocatedEnvelope(r, v) {
    var b = recordBounds(r);
    var pMin = worldToScreen(b.minX, b.maxY), pMax = worldToScreen(b.maxX, b.minY);
    var bw = Math.abs(pMax[0] - pMin[0]), bh = Math.abs(pMax[1] - pMin[1]);
    ctx.save();
    ctx.strokeStyle = 'rgba(56,189,248,0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(Math.min(pMin[0], pMax[0]) - 14, Math.min(pMin[1], pMax[1]) - 14, bw + 28, bh + 28);
    ctx.setLineDash([]);
    var hdr = '定位放大视图 · Item ' + (r.item || r.line || (r.idx + 1)) + ' · 网络 ' + r.net + ' (' + r.layer + ') · 总长 ' + fmt(r.length) + ' ' + S.unit +
      ' · 跨度 ΔX=' + fmt(b.maxX - b.minX) + ' / ΔY=' + fmt(b.maxY - b.minY) + ' ' + S.unit;
    ctx.font = 'bold 12px "Segoe UI", "Microsoft YaHei", sans-serif';
    var tw = ctx.measureText(hdr).width;
    ctx.fillStyle = v.st === 'fail' ? 'rgba(127,29,29,0.92)' : 'rgba(15,23,42,0.92)';
    ctx.fillRect(14, 12, tw + 20, 26);
    ctx.strokeStyle = v.st === 'fail' ? '#f87171' : '#38bdf8';
    ctx.strokeRect(14, 12, tw + 20, 26);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(hdr, 24, 29);
    ctx.restore();
  }

  function drawRecordOnCanvas(r, v, isLocated, opts) {
    var vp = S.canvas.viewport, segs = getRecordSegments(r), isFail = v.st === 'fail';
    var isRev = isFail && S.traceReviewed && S.traceReviewed.has(traceKeyOf(r));
    var baseCol = isFail ? (isRev ? '#94a3b8' : '#ef4444') : netColor(r.net);
    var minW = (r.widthsArr && r.widthsArr.length) ? Math.max(0.5, r.widthsArr[0]) : 4;
    if (isLocated) drawLocatedEnvelope(r, v);

    segs.forEach(function (seg, idx) {
      var rawLw = (seg.width || 4) * vp.zoom;
      var wRatio = Math.min(1.8, Math.max(1, (seg.width || minW) / minW));
      var lw = isLocated ? Math.max(12 * wRatio, Math.min(42, rawLw)) : Math.max(1.8, rawLw);
      var badSeg = isSegOffending(seg, v);
      if (isLocated) {
        drawStrokeSeg(seg, badSeg ? 'rgba(239,68,68,0.38)' : 'rgba(56,189,248,0.34)', lw + 14);
        drawStrokeSeg(seg, badSeg ? '#ef4444' : '#38bdf8', lw);
        drawStrokeSeg(seg, 'rgba(255,255,255,0.65)', 1.5, [6, 4]);
      } else {
        if (isFail && opts.showDefects && !isRev) drawStrokeSeg(seg, 'rgba(239,68,68,0.28)', lw + 5);
        drawStrokeSeg(seg, baseCol, lw);
      }
      if (opts.showSegs && (isLocated || vp.zoom > 0.35)) {
        var p1 = worldToScreen(seg.x1, seg.y1), p2 = worldToScreen(seg.x2, seg.y2);
        ctx.fillStyle = isLocated ? '#fde047' : '#e2e8f0';
        [p1, p2].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], isLocated ? 4.5 : 2.2, 0, 2 * Math.PI); ctx.fill(); });
      }
      if (opts.showLabels && (isLocated || (isFail && vp.zoom > 0.6))) {
        var mid = seg.type === 'arc' ? sampleArcSeg(seg, 2)[1] : [(seg.x1 + seg.x2) / 2, (seg.y1 + seg.y2) / 2];
        var sMid = worldToScreen(mid[0], mid[1]);
        var lbl = isLocated
          ? ('#' + (idx + 1) + (seg.type === 'arc' ? (' 圆弧 R=' + fmt(seg.radius)) : ' 直线') + ' · W=' + fmt(seg.width) + ' · L=' + fmt(seg.len) + (badSeg ? ' [超标]' : ''))
          : ((seg.type === 'arc' && !isNaN(seg.radius)) ? ('W=' + fmt(seg.width) + ' R=' + fmt(seg.radius)) : ('W=' + fmt(seg.width) + ' L=' + fmt(seg.len)));
        ctx.font = (isLocated ? 'bold 11px ' : 'bold 10px ') + 'ui-monospace, sans-serif';
        var tw = ctx.measureText(lbl).width, bh = isLocated ? 20 : 16;
        ctx.fillStyle = badSeg ? 'rgba(220,38,38,0.94)' : 'rgba(15,23,42,0.92)';
        ctx.fillRect(sMid[0] - tw / 2 - 6, sMid[1] - bh / 2 - (isLocated ? 18 : 0), tw + 12, bh);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lbl, sMid[0], sMid[1] - (isLocated ? 18 : 0));
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    });
  }

  function renderTraceCanvas() {
    syncCanvasSize();
    var recs = visibleRecords();
    var failCount = recs.filter(function (r) { return App.recStatus(r).st === 'fail'; }).length;
    if ($('traceCanvasHud')) {
      $('traceCanvasHud').textContent = '缩放: ' + (S.canvas.viewport.zoom * 100).toFixed(0) + '% | 走线记录: ' +
        recs.length + ' | 不符合: ' + failCount + (S.canvas.locatedIdx != null ? ' | 单条走线放大检视' : '') + (S.canvas.measureMode ? ' | 标尺测量已开启' : '');
    }
    if (!canvas || !ctx) return;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var opts = {
      showAll: $('ckTraceShowAll') ? $('ckTraceShowAll').checked : true,
      showDefects: $('ckTraceShowDefects') ? $('ckTraceShowDefects').checked : true,
      showSegs: $('ckTraceShowSegs') ? $('ckTraceShowSegs').checked : true,
      showLabels: $('ckTraceShowLabels') ? $('ckTraceShowLabels').checked : true,
      showGrid: $('ckTraceShowGrid') ? $('ckTraceShowGrid').checked : true
    };
    if (opts.showGrid) {
      var vp = S.canvas.viewport, step = Math.pow(10, Math.floor(Math.log10(100 / Math.max(0.05, vp.zoom))));
      var sW = screenToWorld(0, h), eW = screenToWorld(w, 0);
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 1; ctx.beginPath();
      for (var gx = Math.floor(sW[0] / step) * step; gx <= eW[0]; gx += step) { var sx = worldToScreen(gx, 0)[0]; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
      for (var gy = Math.floor(sW[1] / step) * step; gy <= eW[1]; gy += step) { var sy = worldToScreen(0, gy)[1]; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
      ctx.stroke();
    }
    var locatedRec = S.canvas.locatedIdx != null ? (S.records.find(function (x) { return x.idx === S.canvas.locatedIdx; }) || null) : null;
    recs.forEach(function (r) {
      if (locatedRec && r.idx === locatedRec.idx) return;
      var v = App.recStatus(r);
      if ((v.st === 'fail' && (opts.showDefects || opts.showAll)) || (v.st !== 'fail' && opts.showAll)) {
        drawRecordOnCanvas(r, v, false, opts);
      }
    });
    if (locatedRec) drawRecordOnCanvas(locatedRec, App.recStatus(locatedRec), true, opts);
    var sel = S.canvas.measureSelection;
    if (sel.length) {
      var p1 = worldToScreen(sel[0].pt[0], sel[0].pt[1]);
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p1[0], p1[1], 5, 0, 2 * Math.PI); ctx.stroke();
      if (sel.length >= 2) {
        var p2 = worldToScreen(sel[1].pt[0], sel[1].pt[1]);
        ctx.setLineDash([4, 2]); ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(p2[0], p2[1], 5, 0, 2 * Math.PI); ctx.stroke();
      }
    }
  }

  function renderSpatialReviewCard(idx) {
    var card = $('traceSpatialReviewCard'), titleEl = $('traceSpatialRevTitle'), bodyEl = $('traceSpatialRevBody');
    if (!card || !bodyEl) return;
    var r = S.records.find(function (x) { return x.idx === idx; }) || S.records[idx];
    if (!r) { card.style.display = 'none'; return; }
    var v = App.recStatus(r), tKey = traceKeyOf(r), isFail = v.st === 'fail';
    var isRev = isFail && S.traceReviewed && S.traceReviewed.has(tKey);
    if (titleEl) titleEl.textContent = 'Item ' + (r.item || r.line || (r.idx + 1)) + ' · ' + r.net + ' (' + r.layer + ')';
    var wSeq = TE.extractWidthSeq(r).map(fmt).join(' → ') || '-';
    var rsnText = (isFail && v.reasons && v.reasons.length) ? v.reasons.map(esc).join('；') : '符合当前层规则';
    var revHtml = isFail
      ? ('<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;font-weight:700;color:' + (isRev ? '#6ee7b7' : '#fde68a') + ';margin:0">' +
          '<input type="checkbox" id="chkTraceSpatialReview" data-no-persist ' + (isRev ? 'checked' : '') + ' onchange="toggleTraceSpatialReview(\'' + esc(tKey) + '\', this.checked)" style="width:14px;height:14px;cursor:pointer">' +
          '<span>' + (isRev ? '已复验' : '勾选复验') + '</span></label>' +
        '<button type="button" class="btn small" onclick="toggleTraceSpatialReview(\'' + esc(tKey) + '\', ' + (!isRev) + ')" style="padding:2px 8px;font-size:11px;background:' + (isRev ? '#334155' : '#10b981') + ';color:#fff">' +
          (isRev ? '取消复验' : '确认复验') + '</button>')
      : '';
    bodyEl.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px">' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:#cbd5e1">' +
          '<span>总线长: <strong style="color:' + (v.length ? '#f87171' : '#4ade80') + ';font-family:var(--mono)">' + fmt(r.length) + ' ' + esc(S.unit) + '</strong></span>' +
          '<span>线宽顺序: <strong style="color:' + (v.width ? '#f87171' : '#38bdf8') + ';font-family:var(--mono)">' + esc(wSeq) + '</strong></span>' +
          '<span style="color:#fecaca">' + rsnText + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' + revHtml +
          '<button type="button" class="btn sec small" onclick="returnToTraceResults()">返回检查结果明细</button>' +
        '</div>' +
      '</div>';
    card.style.display = 'block';
  }

  function syncSpatialReviewCard() {
    if (S.canvas.locatedIdx != null && $('traceSpatialReviewCard') && $('traceSpatialReviewCard').style.display !== 'none') {
      renderSpatialReviewCard(S.canvas.locatedIdx);
    }
    renderTraceCanvas();
  }

  function toggleTraceSpatialReview(traceKey, checked) {
    if (!S.traceReviewed) S.traceReviewed = new Set();
    var next = checked !== undefined ? Boolean(checked) : !S.traceReviewed.has(traceKey);
    if (next) S.traceReviewed.add(traceKey); else S.traceReviewed.delete(traceKey);
    if (typeof App.renderResults === 'function') App.renderResults();
    if (typeof App.updateTraceRevHint === 'function') App.updateTraceRevHint();
    syncSpatialReviewCard();
  }

  function rememberTraceResultPosition(button) {
    var row = button && button.closest('tr');
    if (!row) return;
    if (!row.id) row.id = 'traceReturnRow_' + Date.now();
    var mainEl = document.querySelector('.eda-center-col > main');
    S.canvas.returnPosition = {
      rowId: row.id, rowTop: row.getBoundingClientRect().top,
      mainScrollTop: mainEl ? mainEl.scrollTop : 0,
      scrollX: root.scrollX || 0, scrollY: root.scrollY || 0
    };
    if ($('btnReturnTraceResults')) $('btnReturnTraceResults').style.display = '';
  }

  function returnToTraceResults() {
    var saved = S.canvas.returnPosition;
    App.switchTab('result');
    if (!saved) return;
    var row = saved.rowId && document.getElementById(saved.rowId);
    var mainEl = document.querySelector('.eda-center-col > main');
    if (mainEl && typeof saved.mainScrollTop === 'number') mainEl.scrollTop = saved.mainScrollTop;
    if (row) {
      var delta = row.getBoundingClientRect().top - saved.rowTop;
      if (mainEl && Math.abs(delta) > 4) mainEl.scrollTop += delta;
      root.scrollTo(saved.scrollX, (root.scrollY || 0) + delta);
      row.classList.add('located-flash');
      setTimeout(function () { row.classList.remove('located-flash'); }, 1500);
    } else {
      root.scrollTo(saved.scrollX, saved.scrollY);
    }
  }

  function locateTraceInCanvas(idx) {
    var r = S.records.find(function (x) { return x.idx === idx; }) || S.records[idx];
    if (!r) return;
    S.canvas.locatedIdx = r.idx;
    var sel = $('selCanvasLayer');
    if (sel && sel.value && sel.value !== r.layer) sel.value = '';
    renderSpatialReviewCard(r.idx);
    App.switchTab('canvas');
    zoomRecordToFullViewport(r);
    renderTraceCanvas();
  }

  function onEnterCanvasTab() {
    if (!S.records.length) { renderTraceCanvas(); return; }
    if (S.canvas.locatedIdx != null) {
      var locRec = S.records.find(function (x) { return x.idx === S.canvas.locatedIdx; });
      if (locRec) zoomRecordToFullViewport(locRec);
      renderTraceCanvas();
      return;
    }
    if (S.records.some(function (r) { return App.recStatus(r).st === 'fail'; })) zoomTraceToDefects();
    else fitTraceCanvasView();
  }

  function exportTracePng() {
    if (!canvas || !canvas.toDataURL) return;
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'PCB_走线空间几何视图.png';
    a.click();
  }

  function exportTraceSvg() {
    var recs = visibleRecords();
    if (!recs.length) { alert('请先导入走线数据'); return; }
    var box = computeRecordsBounds(recs), pad = 40;
    var minX = box.minX - pad, minY = box.minY - pad, width = (box.maxX - box.minX) + pad * 2, height = (box.maxY - box.minY) + pad * 2;
    var lines = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + minX.toFixed(2) + ' ' + minY.toFixed(2) + ' ' + width.toFixed(2) + ' ' + height.toFixed(2) + '" style="background:#000">'];
    recs.forEach(function (r) {
      var v = App.recStatus(r), col = (r.idx === S.canvas.locatedIdx) ? '#38bdf8' : (v.st === 'fail' ? '#ef4444' : netColor(r.net));
      getRecordSegments(r).forEach(function (seg) {
        var pts = seg.type === 'arc' ? sampleArcSeg(seg, 20) : [[seg.x1, seg.y1], [seg.x2, seg.y2]];
        var d = pts.map(function (p, i) { return (i === 0 ? 'M ' : 'L ') + p[0].toFixed(2) + ' ' + (box.maxY + box.minY - p[1]).toFixed(2); }).join(' ');
        lines.push('<path d="' + d + '" stroke="' + col + '" stroke-width="' + Math.max(2, seg.width || 4) + '" fill="none" stroke-linecap="round"/>');
      });
    });
    lines.push('</svg>');
    App.download('PCB_走线空间几何视图.svg', lines.join('\n'), 'image/svg+xml;charset=utf-8');
  }

  function bindCanvasMouseEvents() {
    if (!canvas) return;
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var vp = S.canvas.viewport, wBefore = screenToWorld(mx, my);
      vp.zoom = Math.max(0.05, Math.min(5000, vp.zoom * (e.deltaY < 0 ? 1.18 : 0.85)));
      vp.panX = mx - wBefore[0] * vp.zoom;
      vp.panY = (canvas.height - my) - wBefore[1] * vp.zoom;
      renderTraceCanvas();
    });
    canvas.addEventListener('mousedown', function (e) {
      var rect = canvas.getBoundingClientRect(), wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (S.canvas.measureMode) {
        var hit = findNearestTraceSeg(wp[0], wp[1]);
        if (S.canvas.measureSelection.length >= 2) S.canvas.measureSelection = [];
        S.canvas.measureSelection.push(hit ? { pt: hit.proj, rec: hit.rec, seg: hit.seg } : { pt: wp, rec: null, seg: null });
        renderMeasureCard();
        renderTraceCanvas();
        return;
      }
      S.canvas.viewport.isDragging = true;
      S.canvas.viewport.dragStartX = e.clientX;
      S.canvas.viewport.dragStartY = e.clientY;
    });
    canvas.addEventListener('mousemove', function (e) {
      if (S.canvas.viewport.isDragging) return;
      var rect = canvas.getBoundingClientRect(), wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      var hit = findNearestTraceSeg(wp[0], wp[1]), tip = $('traceCanvasTooltip');
      if (!tip) return;
      if (hit) {
        var r = hit.rec, s = hit.seg, v = App.recStatus(r);
        tip.style.display = 'block'; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
        tip.innerHTML = '<b>Item ' + esc(r.item || r.line || (r.idx + 1)) + '</b> · ' + esc(r.net) + ' (' + esc(r.layer) + ')<br>' +
          '当前段: ' + (s.type === 'arc' ? ('圆弧 R=' + fmt(s.radius)) : '直线段') + ' | 线宽: ' + fmt(s.width) + ' ' + esc(S.unit) + ' | 段长: ' + fmt(s.len) + ' ' + esc(S.unit) + '<br>' +
          '总线长: ' + fmt(r.length) + ' ' + esc(S.unit) + ' | 判定: ' + (v.st === 'fail' ? '不符合' : (v.st === 'pass' ? '通过' : '未检查'));
      } else {
        tip.style.display = 'none';
      }
    });
  }

  function bindCanvasEvents() {
    if ($('btnTraceMeasureMode')) {
      $('btnTraceMeasureMode').addEventListener('click', function () {
        S.canvas.measureMode = !S.canvas.measureMode;
        $('btnTraceMeasureMode').classList.toggle('active', S.canvas.measureMode);
        if (canvas) canvas.classList.toggle('measuring', S.canvas.measureMode);
        if ($('btnTraceClearMeasure')) $('btnTraceClearMeasure').style.display = S.canvas.measureMode ? 'inline-flex' : 'none';
        if (!S.canvas.measureMode) { S.canvas.measureSelection = []; if ($('traceMeasureCard')) $('traceMeasureCard').style.display = 'none'; }
        renderTraceCanvas();
      });
    }
    if ($('btnTraceClearMeasure')) {
      $('btnTraceClearMeasure').addEventListener('click', function () {
        S.canvas.measureSelection = [];
        if ($('traceMeasureCard')) $('traceMeasureCard').style.display = 'none';
        renderTraceCanvas();
      });
    }
    if ($('btnCloseTraceMeasureCard')) $('btnCloseTraceMeasureCard').addEventListener('click', function () { if ($('traceMeasureCard')) $('traceMeasureCard').style.display = 'none'; });
    if ($('btnCloseTraceSpatialRev')) $('btnCloseTraceSpatialRev').addEventListener('click', function () { if ($('traceSpatialReviewCard')) $('traceSpatialReviewCard').style.display = 'none'; });
    bindCanvasMouseEvents();
    root.addEventListener('mousemove', function (e) {
      if (S.canvas.viewport.isDragging) {
        var vp = S.canvas.viewport;
        vp.panX += e.clientX - vp.dragStartX; vp.panY -= e.clientY - vp.dragStartY;
        vp.dragStartX = e.clientX; vp.dragStartY = e.clientY;
        renderTraceCanvas();
      }
    });
    root.addEventListener('mouseup', function () { S.canvas.viewport.isDragging = false; });
    if ($('btnTraceFitView')) $('btnTraceFitView').addEventListener('click', fitTraceCanvasView);
    if ($('btnTraceZoomDefects')) $('btnTraceZoomDefects').addEventListener('click', zoomTraceToDefects);
    if ($('btnTraceZoomIn')) $('btnTraceZoomIn').addEventListener('click', function () { S.canvas.viewport.zoom *= 1.25; renderTraceCanvas(); });
    if ($('btnTraceZoomOut')) $('btnTraceZoomOut').addEventListener('click', function () { S.canvas.viewport.zoom *= 0.8; renderTraceCanvas(); });
    if ($('btnTraceResetView')) {
      $('btnTraceResetView').addEventListener('click', function () {
        if (S.canvas.locatedIdx != null) {
          var locRec = S.records.find(function (x) { return x.idx === S.canvas.locatedIdx; });
          if (locRec) { zoomRecordToFullViewport(locRec); renderTraceCanvas(); return; }
        }
        fitTraceCanvasView();
      });
    }
    if ($('selCanvasLayer')) $('selCanvasLayer').addEventListener('change', fitTraceCanvasView);
    if ($('btnTraceExportPng')) $('btnTraceExportPng').addEventListener('click', exportTracePng);
    if ($('btnTraceExportSvg')) $('btnTraceExportSvg').addEventListener('click', exportTraceSvg);
    ['ckTraceShowAll', 'ckTraceShowDefects', 'ckTraceShowSegs', 'ckTraceShowLabels', 'ckTraceShowGrid'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', renderTraceCanvas);
    });
  }

  Object.assign(App, {
    initCanvasData: initCanvasData, onEnterCanvasTab: onEnterCanvasTab,
    fitTraceCanvasView: fitTraceCanvasView, zoomTraceToDefects: zoomTraceToDefects,
    zoomRecordToFullViewport: zoomRecordToFullViewport,
    renderTraceCanvas: renderTraceCanvas, locateTraceInCanvas: locateTraceInCanvas,
    rememberTraceResultPosition: rememberTraceResultPosition, returnToTraceResults: returnToTraceResults,
    toggleTraceSpatialReview: toggleTraceSpatialReview, syncSpatialReviewCard: syncSpatialReviewCard
  });
  root.locateTraceInCanvas = locateTraceInCanvas;
  root.rememberTraceResultPosition = rememberTraceResultPosition;
  root.returnToTraceResults = returnToTraceResults;
  root.toggleTraceSpatialReview = toggleTraceSpatialReview;
  bindCanvasEvents();
})(typeof window !== 'undefined' ? window : globalThis);
