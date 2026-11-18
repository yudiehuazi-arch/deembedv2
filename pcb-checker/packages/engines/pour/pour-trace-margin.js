/* ============================================================================
 * pour-trace-margin.js —— 走线边缘外规则距离范围的参考层连续铺铜检查
 * ========================================================================== */
(function (root, factory) {
  var geom = (typeof module === "object" && module.exports) ? require("./pour-geom.js") : root.PourChecker;
  var api = factory(geom);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PourChecker = Object.assign(root.PourChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (geom) {
  "use strict";

  function shapeCoversPoint(shape, x, y) {
    if (!shape || !shape.bbox || !geom.isPointInsideBBox(x, y, shape.bbox)) return false;
    if (!shape.boundary || !shape.boundary.length) return true;
    if (geom.pointInShape(x, y, shape)) return true;
    return geom.pointToShapeBoundaryDistance(x, y, shape) <= 1e-7;
  }

  function anyShapeCoversPoint(shapes, x, y) {
    return shapes.some(function (shape) { return shapeCoversPoint(shape, x, y); });
  }

  function segmentGeometry(seg) {
    if (seg.type !== 'arc') {
      var dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
      var length = Math.hypot(dx, dy);
      return {
        length: length,
        point: function (t) {
          return {
            x: seg.x1 + dx * t,
            y: seg.y1 + dy * t,
            nx: length ? -dy / length : 0,
            ny: length ? dx / length : 1
          };
        }
      };
    }
    var a1 = Math.atan2(seg.y1 - seg.cy, seg.x1 - seg.cx);
    var a2 = Math.atan2(seg.y2 - seg.cy, seg.x2 - seg.cx);
    var ccw = String(seg.dir || 'CCW').toUpperCase() !== 'CW';
    var span = ccw ? (a2 - a1) % (2 * Math.PI) : (a1 - a2) % (2 * Math.PI);
    if (span < 0) span += 2 * Math.PI;
    if (span === 0) span = 2 * Math.PI;
    return {
      length: Math.abs(seg.radius * span),
      point: function (t) {
        var angle = ccw ? a1 + span * t : a1 - span * t;
        return {
          x: seg.cx + Math.cos(angle) * seg.radius,
          y: seg.cy + Math.sin(angle) * seg.radius,
          nx: Math.cos(angle),
          ny: Math.sin(angle)
        };
      }
    };
  }

  function firstUncoveredInDisc(cx, cy, radius, step, shapes) {
    var rings = Math.max(1, Math.ceil(radius / step));
    for (var ri = 0; ri <= rings; ri++) {
      var r = radius * ri / rings;
      var count = ri === 0 ? 1 : Math.max(8, Math.ceil(2 * Math.PI * r / step));
      for (var ai = 0; ai < count; ai++) {
        var angle = 2 * Math.PI * ai / count;
        var x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
        if (!anyShapeCoversPoint(shapes, x, y)) return { x: x, y: y };
      }
    }
    return null;
  }

  function firstUncoveredInSegment(seg, index, margin) {
    var radius = Math.max(0, Number(seg.width || 6) / 2 + margin);
    var step = Math.max(1, Math.min(5, radius / 12 || 1));
    var minX = Math.min(seg.x1, seg.x2), maxX = Math.max(seg.x1, seg.x2);
    var minY = Math.min(seg.y1, seg.y2), maxY = Math.max(seg.y1, seg.y2);
    if (seg.type === 'arc') {
      minX = seg.cx - seg.radius; maxX = seg.cx + seg.radius;
      minY = seg.cy - seg.radius; maxY = seg.cy + seg.radius;
    }
    var shapes = geom.queryBBoxGrid(index, minX - radius, minY - radius, maxX + radius, maxY + radius);
    if (!shapes.length) return { x: seg.x1, y: seg.y1 };

    var path = segmentGeometry(seg);
    var alongCount = Math.max(1, Math.ceil(path.length / step));
    var acrossCount = Math.max(1, Math.ceil(2 * radius / step));
    for (var i = 0; i <= alongCount; i++) {
      var point = path.point(i / alongCount);
      for (var j = 0; j <= acrossCount; j++) {
        var offset = -radius + (2 * radius * j / acrossCount);
        var x = point.x + point.nx * offset, y = point.y + point.ny * offset;
        if (!anyShapeCoversPoint(shapes, x, y)) return { x: x, y: y };
      }
    }
    var start = path.point(0), end = path.point(1);
    return firstUncoveredInDisc(start.x, start.y, radius, step, shapes) ||
      firstUncoveredInDisc(end.x, end.y, radius, step, shapes);
  }

  function traceMarginCoverage(trace, index, margin) {
    for (var i = 0; i < (trace.segments || []).length; i++) {
      var missing = firstUncoveredInSegment(trace.segments[i], index, margin);
      if (missing) return { pass: false, missing: missing };
    }
    return { pass: !!(trace.segments && trace.segments.length), missing: null };
  }

  function checkTraceReferenceMargin(traces, shapes, rules) {
    rules = rules || [];
    var results = [], byLayer = new Map(), indexes = new Map();
    (shapes || []).forEach(function (shape) {
      var layer = String(shape.layer || '').toUpperCase();
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer).push(shape);
    });
    byLayer.forEach(function (layerShapes, layer) {
      var index = geom.buildBBoxGrid(layerShapes, 100);
      indexes.set(layer, index);
      var alias = geom.physicalLayerAlias(layer);
      if (!indexes.has(alias)) indexes.set(alias, index);
    });

    rules.forEach(function (rule, ruleIndex) {
      var traceLayer = String(rule.traceLayer || '').trim().toUpperCase();
      var traceLayerAlias = geom.physicalLayerAlias(traceLayer);
      var parsedMargin = rule.minMargin != null ? parseFloat(rule.minMargin) : 50;
      var margin = isFinite(parsedMargin) && parsedMargin >= 0 ? parsedMargin : 50;
      var refs = [];
      if (String(rule.upperRefLayer || '').trim()) refs.push({ name: String(rule.upperRefLayer).trim().toUpperCase(), type: '上参考层' });
      if (String(rule.lowerRefLayer || '').trim()) refs.push({ name: String(rule.lowerRefLayer).trim().toUpperCase(), type: '下参考层' });
      (traces || []).filter(function (trace) {
        var actualLayer = String(trace.layer || '').trim().toUpperCase();
        return actualLayer === traceLayer ||
          (traceLayerAlias && geom.physicalLayerAlias(actualLayer) === traceLayerAlias);
      }).forEach(function (trace) {
        refs.forEach(function (ref) {
          var index = indexes.get(ref.name) || indexes.get(geom.physicalLayerAlias(ref.name));
          var coverage = index ? traceMarginCoverage(trace, index, margin) : { pass: false, missing: null };
          var location = coverage.missing
            ? '，首个缺铜采样点 [' + geom.roundN(coverage.missing.x, 1) + ', ' + geom.roundN(coverage.missing.y, 1) + ']'
            : '';
          results.push({
            checkCategory: 'trace_ref_margin', checkCategoryName: '③ 走线参考层超宽检查',
            ruleIndex: ruleIndex + 1, traceId: trace.id, traceNet: trace.net, traceLayer: trace.layer,
            refLayer: ref.name, refType: ref.type, minMargin: margin,
            actualMargin: coverage.pass ? margin : 0, coverageComplete: coverage.pass,
            pass: coverage.pass,
            message: coverage.pass
              ? '✅ 符合：走线【' + trace.net + '】在 ' + ref.type + '【' + ref.name + '】的走线边缘外 ' + margin + ' mil 范围内连续有铜'
              : '❌ 不符合：走线【' + trace.net + '】在 ' + ref.type + '【' + ref.name + '】的走线边缘外 ' + margin + ' mil 范围存在未铺铜区域' + location
          });
        });
      });
    });
    return results;
  }

  return {
    traceMarginCoverage: traceMarginCoverage,
    checkTraceReferenceMargin: checkTraceReferenceMargin
  };
});
