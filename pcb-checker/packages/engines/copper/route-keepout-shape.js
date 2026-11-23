/* ============================================================================
 * route-keepout-shape.js —— 圆形/长圆形 Route Keepout 几何识别与形状规则核对
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CopperKeepoutShape = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var N = '([+-]?[0-9]+(?:\\.[0-9]+)?)';
  var XY = 'xy\\s*\\[\\s*' + N + '\\s*,\\s*' + N + '\\s*\\]';

  function pointDist(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function close(a, b, tol) {
    return pointDist(a, b) <= tol;
  }

  function parseSegments(body) {
    var out = [], re = new RegExp('(?:^|\\n)\\s*Seg:\\s*' + XY + '\\s*' + XY, 'gi'), m;
    while ((m = re.exec(body))) out.push({ start: [+m[1], +m[2]], end: [+m[3], +m[4]] });
    return out;
  }

  function parseArcs(body) {
    var out = [];
    var re = new RegExp('Arc seg:\\s*' + XY + '\\s*' + XY + '[^\\n]*\\n\\s*Center-xy:\\s*\\[\\s*' + N + '\\s*,\\s*' + N + '\\s*\\]\\s*Radius\\s*\\(\\s*' + N + '\\s*\\)\\s*(CW|CCW)?', 'gi');
    var m;
    while ((m = re.exec(body))) {
      out.push({
        start: [+m[1], +m[2]], end: [+m[3], +m[4]],
        center: [+m[5], +m[6]], radius: +m[7], direction: String(m[8] || '').toUpperCase()
      });
    }
    return out;
  }

  function parallel(a, b, tol) {
    var ax = a.end[0] - a.start[0], ay = a.end[1] - a.start[1];
    var bx = b.end[0] - b.start[0], by = b.end[1] - b.start[1];
    var al = Math.sqrt(ax * ax + ay * ay), bl = Math.sqrt(bx * bx + by * by);
    return al > tol && bl > tol && Math.abs(ax * by - ay * bx) <= al * bl * 0.002 && Math.abs(al - bl) <= tol;
  }

  function isSemicircle(arc, tol) {
    return arc.radius > 0 && Math.abs(pointDist(arc.start, arc.center) - arc.radius) <= tol &&
      Math.abs(pointDist(arc.end, arc.center) - arc.radius) <= tol && Math.abs(pointDist(arc.start, arc.end) - arc.radius * 2) <= tol;
  }

  function boundaryClosed(arcs, segments, tol) {
    var points = [];
    arcs.concat(segments).forEach(function (part) { points.push(part.start, part.end); });
    return points.every(function (point, i) {
      return points.some(function (other, j) { return i !== j && close(point, other, tol); });
    });
  }

  function boundsOf(arcs, segments) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function add(p, pad) {
      minX = Math.min(minX, p[0] - pad); maxX = Math.max(maxX, p[0] + pad);
      minY = Math.min(minY, p[1] - pad); maxY = Math.max(maxY, p[1] + pad);
    }
    segments.forEach(function (seg) { add(seg.start, 0); add(seg.end, 0); });
    arcs.forEach(function (arc) { add(arc.center, arc.radius); });
    return isFinite(minX) ? { minX: minX, maxX: maxX, minY: minY, maxY: maxY } : null;
  }

  function analyzeBoundary(body) {
    var arcs = parseArcs(String(body || '')), segments = parseSegments(String(body || ''));
    var radii = arcs.map(function (arc) { return arc.radius; });
    var scale = radii.length ? Math.max.apply(null, radii) : 1;
    var tol = Math.max(0.01, scale * 0.002);
    var circle = arcs.length === 1 && segments.length === 0 && arcs[0].radius > 0;
    var obround = false;
    if (arcs.length === 2 && segments.length === 2) {
      var centerAxis = { start: arcs[0].center, end: arcs[1].center };
      obround = Math.abs(arcs[0].radius - arcs[1].radius) <= tol &&
        isSemicircle(arcs[0], tol) && isSemicircle(arcs[1], tol) &&
        parallel(segments[0], segments[1], tol) && parallel(segments[0], centerAxis, tol) &&
        Math.abs(pointDist(arcs[0].center, arcs[1].center) - pointDist(segments[0].start, segments[0].end)) <= tol &&
        boundaryClosed(arcs, segments, tol);
    }
    var kind = circle ? '圆形' : (obround ? '长圆形' : (arcs.length ? '其他圆弧' : '非圆弧'));
    var centers = circle ? [arcs[0].center] : (obround ? arcs.map(function (arc) { return arc.center; }) : []);
    var center = centers.length ? [
      centers.reduce(function (n, p) { return n + p[0]; }, 0) / centers.length,
      centers.reduce(function (n, p) { return n + p[1]; }, 0) / centers.length
    ] : null;
    return {
      arcs: arcs, segments: segments, arcRadii: radii, matchingCenters: centers,
      center: center, radius: radii.length ? radii[0] : null,
      circle: circle, obround: obround, arcShape: circle || obround,
      shapeKind: kind, bounds: boundsOf(arcs, segments)
    };
  }

  function applyGeometry(item, geometry) {
    geometry = geometry || {};
    item.circle = !!geometry.circle;
    item.obround = !!geometry.obround;
    item.arcShape = !!geometry.arcShape;
    item.shapeKind = geometry.shapeKind || '';
    item.arcRadii = (geometry.arcRadii || []).slice();
    item.matchingCenters = (geometry.matchingCenters || []).map(function (p) { return p.slice(); });
    item.center = geometry.center ? geometry.center.slice() : null;
    item.radius = geometry.radius == null ? null : geometry.radius;
    item.shapeBoundary = { arcs: geometry.arcs || [], segments: geometry.segments || [] };
    item.shapeBounds = geometry.bounds || null;
    return item;
  }

  function normalizeItem(item) {
    if (!item) return item;
    if (item.circle && !item.shapeKind) item.shapeKind = '圆形';
    if (item.obround && !item.shapeKind) item.shapeKind = '长圆形';
    if (item.circle || item.obround) item.arcShape = true;
    if ((!item.arcRadii || !item.arcRadii.length) && item.radius != null) {
      item.arcRadii = item.obround ? [item.radius, item.radius] : [item.radius];
    }
    if ((!item.matchingCenters || !item.matchingCenters.length) && item.center) item.matchingCenters = [item.center];
    return item;
  }

  function centersOf(item) {
    normalizeItem(item);
    return item && item.matchingCenters && item.matchingCenters.length ? item.matchingCenters : (item && item.center ? [item.center] : []);
  }

  function distanceTo(item, point) {
    var centers = centersOf(item), best = Infinity;
    centers.forEach(function (center) { best = Math.min(best, pointDist(center, point)); });
    return best;
  }

  function isEligible(item) {
    normalizeItem(item);
    return !!(item && item.type === 'shape' && item.arcShape && String(item.set || '').trim().toLowerCase() === 'route keepout');
  }

  function normalizeShapeName(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (!s || s === '圆形' || s === 'circle' || s === '圆') return '圆形';
    if (s === '长圆形' || s === '长圆' || s === 'obround' || s === 'capsule') return '长圆形';
    return String(raw || '').trim();
  }

  function ruleShape(set, layer) {
    var cons = (set && set.constraints) || [];
    var hit = cons.find(function (c) { return /反焊盘形状/.test((c.cat || '') + ' ' + (c.name || '')); });
    var raw = hit && hit.values ? hit.values['L' + layer] : '';
    return normalizeShapeName(raw || '圆形');
  }

  function evaluate(item, expectedRadius, expectedShape, valTol) {
    normalizeItem(item);
    var radii = (item.arcRadii || []).map(Number).filter(isFinite);
    var shapePass = item.shapeKind === expectedShape;
    var radiusPass = radii.length > 0 && radii.every(function (r) { return Math.abs(r - expectedRadius) <= valTol; });
    var reasons = [];
    if (!shapePass) reasons.push('反焊盘形状应为' + expectedShape + '，实际为' + (item.shapeKind || '无法识别'));
    if (!radiusPass && (item.obround || !shapePass)) reasons.push('圆弧半径应为 ' + expectedRadius + ' mil，实际为 ' + (radii.length ? radii.join(' / ') : '无法识别') + ' mil');
    return {
      status: shapePass && radiusPass ? '符合' : '不符合',
      reason: reasons.join('；'),
      actualShape: item.shapeKind || '无法识别', expectedShape: expectedShape,
      actualRadii: radii,
      actualText: (item.shapeKind || '无法识别') + ' · 圆弧半径 ' + (radii.length ? radii.join(' / ') : '—') + ' mil'
    };
  }

  return {
    analyzeBoundary: analyzeBoundary,
    applyGeometry: applyGeometry,
    normalizeItem: normalizeItem,
    centersOf: centersOf,
    distanceTo: distanceTo,
    isEligible: isEligible,
    normalizeShapeName: normalizeShapeName,
    ruleShape: ruleShape,
    evaluate: evaluate
  };
});
