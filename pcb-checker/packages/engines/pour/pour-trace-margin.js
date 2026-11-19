/* ============================================================================
 * pour-trace-margin.js —— 走线投影铺铜与两侧规则距离内邻近铜检查
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

  function indexCoversPoint(index, x, y) {
    var largeItems = index.largeItems || [];
    for (var li = 0; li < largeItems.length; li++) {
      if (shapeCoversPoint(largeItems[li], x, y)) return true;
    }
    var key = Math.floor(x / index.cellSize) + ',' + Math.floor(y / index.cellSize);
    var bucket = index.cells.get(key) || [];
    for (var bi = 0; bi < bucket.length; bi++) {
      if (shapeCoversPoint(bucket[bi], x, y)) return true;
    }
    return false;
  }

  function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function pointInConvexPolygon(point, polygon) {
    var sign = 0;
    for (var i = 0; i < polygon.length; i++) {
      var value = cross(polygon[i], polygon[(i + 1) % polygon.length], point);
      if (Math.abs(value) <= 1e-8) continue;
      var current = value > 0 ? 1 : -1;
      if (sign && sign !== current) return false;
      sign = current;
    }
    return true;
  }

  function between(value, a, b) {
    return value >= Math.min(a, b) - 1e-8 && value <= Math.max(a, b) + 1e-8;
  }

  function segmentsIntersect(a, b, c, d) {
    var abC = cross(a, b, c), abD = cross(a, b, d);
    var cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > 1e-8 && abD < -1e-8) || (abC < -1e-8 && abD > 1e-8)) &&
        ((cdA > 1e-8 && cdB < -1e-8) || (cdA < -1e-8 && cdB > 1e-8))) return true;
    if (Math.abs(abC) <= 1e-8 && between(c.x, a.x, b.x) && between(c.y, a.y, b.y)) return true;
    if (Math.abs(abD) <= 1e-8 && between(d.x, a.x, b.x) && between(d.y, a.y, b.y)) return true;
    if (Math.abs(cdA) <= 1e-8 && between(a.x, c.x, d.x) && between(a.y, c.y, d.y)) return true;
    return Math.abs(cdB) <= 1e-8 && between(b.x, c.x, d.x) && between(b.y, c.y, d.y);
  }

  function shapePolygonRings(shape) {
    var rings = geom.shapeRings(shape);
    if (rings.length) {
      return rings.map(function (ring) {
        return ring.map(function (point) { return { x: point[0], y: point[1] }; });
      });
    }
    var b = shape.bbox;
    return b ? [[
      { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }
    ]] : [];
  }

  function shapeIntersectsPolygon(shape, polygon) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polygon.forEach(function (point) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    });
    var b = shape && shape.bbox;
    if (!b || b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY) return false;
    if (polygon.some(function (point) { return shapeCoversPoint(shape, point.x, point.y); })) return true;
    var rings = shapePolygonRings(shape);
    for (var ri = 0; ri < rings.length; ri++) {
      var ring = rings[ri];
      for (var pi = 0; pi < ring.length; pi++) {
        var point = ring[pi];
        if (pointInConvexPolygon(point, polygon) && shapeCoversPoint(shape, point.x, point.y)) return true;
        var next = ring[(pi + 1) % ring.length];
        for (var qi = 0; qi < polygon.length; qi++) {
          if (segmentsIntersect(point, next, polygon[qi], polygon[(qi + 1) % polygon.length])) return true;
        }
      }
    }
    return false;
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
        var normalSign = ccw ? -1 : 1;
        return {
          x: seg.cx + Math.cos(angle) * seg.radius,
          y: seg.cy + Math.sin(angle) * seg.radius,
          nx: normalSign * Math.cos(angle),
          ny: normalSign * Math.sin(angle)
        };
      }
    };
  }

  function isPointInExemptRegion(x, y, exemptRegions) {
    for (var i = 0; i < (exemptRegions || []).length; i++) {
      var region = exemptRegions[i], bbox = region.bbox;
      if (x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY &&
          geom.pointInPolygon(x, y, region.ring)) return true;
    }
    return false;
  }

  function firstUncoveredInDisc(cx, cy, radius, step, index, exemptRegions) {
    var rings = Math.max(1, Math.ceil(radius / step));
    for (var ri = 0; ri <= rings; ri++) {
      var r = radius * ri / rings;
      var count = ri === 0 ? 1 : Math.max(8, Math.ceil(2 * Math.PI * r / step));
      for (var ai = 0; ai < count; ai++) {
        var angle = 2 * Math.PI * ai / count;
        var x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
        if (!isPointInExemptRegion(x, y, exemptRegions) && !indexCoversPoint(index, x, y)) return { x: x, y: y };
      }
    }
    return null;
  }

  function querySegmentShapes(seg, index, radius) {
    var minX = Math.min(seg.x1, seg.x2), maxX = Math.max(seg.x1, seg.x2);
    var minY = Math.min(seg.y1, seg.y2), maxY = Math.max(seg.y1, seg.y2);
    if (seg.type === 'arc') {
      minX = seg.cx - seg.radius; maxX = seg.cx + seg.radius;
      minY = seg.cy - seg.radius; maxY = seg.cy + seg.radius;
    }
    return geom.queryBBoxGrid(index, minX - radius, minY - radius, maxX + radius, maxY + radius);
  }

  function segmentToRingDistance(seg, ring) {
    var a = { x: seg.x1, y: seg.y1 }, b = { x: seg.x2, y: seg.y2 };
    var minDistance = Infinity;
    for (var i = 0; i < ring.length; i++) {
      var current = { x: ring[i][0], y: ring[i][1] };
      var nextPoint = ring[(i + 1) % ring.length];
      var next = { x: nextPoint[0], y: nextPoint[1] };
      if (segmentsIntersect(a, b, current, next)) return 0;
      minDistance = Math.min(minDistance,
        geom.pointToSegmentDist(current.x, current.y, a.x, a.y, b.x, b.y),
        geom.pointToSegmentDist(a.x, a.y, current.x, current.y, next.x, next.y),
        geom.pointToSegmentDist(b.x, b.y, current.x, current.y, next.x, next.y));
    }
    return minDistance;
  }

  function isExemptRing(ring, exemptRegions) {
    return (exemptRegions || []).some(function (region) { return region.ring === ring; });
  }

  /** 直线胶囊位于单一 Shape 内且不触碰非豁免 Void 时可精确快速通过，无需降低采样精度。 */
  function lineFootprintCoveredBySingleShape(seg, index, halfWidth, exemptRegions) {
    var candidates = querySegmentShapes(seg, index, halfWidth);
    var minX = Math.min(seg.x1, seg.x2) - halfWidth, maxX = Math.max(seg.x1, seg.x2) + halfWidth;
    var minY = Math.min(seg.y1, seg.y2) - halfWidth, maxY = Math.max(seg.y1, seg.y2) + halfWidth;
    return candidates.some(function (shape) {
      if (!shape.boundary || !shape.boundary.length) {
        var box = shape.bbox;
        return box && box.minX <= minX && box.maxX >= maxX && box.minY <= minY && box.maxY >= maxY;
      }
      var rings = geom.shapeRings(shape), exterior = rings[0];
      var midX = (seg.x1 + seg.x2) / 2, midY = (seg.y1 + seg.y2) / 2;
      if (!exterior || !geom.pointInPolygon(midX, midY, exterior) ||
          segmentToRingDistance(seg, exterior) < halfWidth - 1e-7) return false;
      var voidEntries = geom.shapeVoidRingEntriesInBBox(minX, minY, maxX, maxY, shape);
      for (var i = 0; i < voidEntries.length; i++) {
        var ring = voidEntries[i].ring;
        if (isExemptRing(ring, exemptRegions)) continue;
        if (geom.pointInPolygon(seg.x1, seg.y1, ring) || geom.pointInPolygon(seg.x2, seg.y2, ring) ||
            geom.pointInPolygon(midX, midY, ring) || segmentToRingDistance(seg, ring) < halfWidth - 1e-7) return false;
      }
      return true;
    });
  }

  function firstUncoveredInTraceFootprint(seg, index, exemptRegions) {
    var halfWidth = Math.max(0, Number(seg.width || 6) / 2);
    if (seg.type !== 'arc' && lineFootprintCoveredBySingleShape(seg, index, halfWidth, exemptRegions)) return null;
    var step = Math.max(1, Math.min(3, halfWidth / 3 || 1));
    var path = segmentGeometry(seg);
    var alongCount = Math.max(1, Math.ceil(path.length / step));
    var acrossCount = Math.max(1, Math.ceil(2 * halfWidth / step));
    for (var i = 0; i <= alongCount; i++) {
      var point = path.point(i / alongCount);
      for (var j = 0; j <= acrossCount; j++) {
        var offset = -halfWidth + (2 * halfWidth * j / acrossCount);
        var x = point.x + point.nx * offset, y = point.y + point.ny * offset;
        if (!isPointInExemptRegion(x, y, exemptRegions) && !indexCoversPoint(index, x, y)) return { x: x, y: y };
      }
    }
    var start = path.point(0), end = path.point(1);
    return firstUncoveredInDisc(start.x, start.y, halfWidth, step, index, exemptRegions) ||
      firstUncoveredInDisc(end.x, end.y, halfWidth, step, index, exemptRegions);
  }

  function sideCorridorQuad(start, end, inner, outer, sign) {
    return [
      { x: start.x + sign * start.nx * inner, y: start.y + sign * start.ny * inner },
      { x: end.x + sign * end.nx * inner, y: end.y + sign * end.ny * inner },
      { x: end.x + sign * end.nx * outer, y: end.y + sign * end.ny * outer },
      { x: start.x + sign * start.nx * outer, y: start.y + sign * start.ny * outer }
    ];
  }

  function nearbyCopperSidesInSegment(seg, index, margin) {
    if (margin <= 0) return { left: true, right: true };
    var halfWidth = Math.max(0, Number(seg.width || 6) / 2);
    var shapes = querySegmentShapes(seg, index, halfWidth + margin);
    if (!shapes.length) return { left: false, right: false };
    var path = segmentGeometry(seg);
    var step = Math.max(1, Math.min(5, margin / 12 || 1));
    var alongCount = Math.max(1, Math.ceil(path.length / step));
    var inner = halfWidth + 1e-7, outer = halfWidth + margin;
    var left = false, right = false;
    for (var i = 0; i < alongCount && !(left && right); i++) {
      var start = path.point(i / alongCount);
      var end = path.point((i + 1) / alongCount);
      var leftCorridor = left ? null : sideCorridorQuad(start, end, inner, outer, 1);
      var rightCorridor = right ? null : sideCorridorQuad(start, end, inner, outer, -1);
      for (var si = 0; si < shapes.length && !(left && right); si++) {
        if (!left && shapeIntersectsPolygon(shapes[si], leftCorridor)) left = true;
        if (!right && shapeIntersectsPolygon(shapes[si], rightCorridor)) right = true;
      }
    }
    return { left: left, right: right };
  }

  function stackLayerNumber(layer) {
    var key = String(layer || '').trim().toUpperCase();
    if (key === 'TOP') return 1;
    if (/^(?:BOTTOM|BOT)$/.test(key)) return 9999;
    var match = geom.physicalLayerAlias(key).match(/^L0*(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  function viaSpansReferenceLayer(via, refLayer) {
    var refNum = stackLayerNumber(refLayer);
    if (refNum != null && via.minLayerNum != null && via.maxLayerNum != null) {
      return refNum >= via.minLayerNum && refNum <= via.maxLayerNum;
    }
    if (!via.hasDefinedSpan) return false;
    var refAlias = geom.physicalLayerAlias(refLayer);
    return [via.startLayer, via.endLayer].some(function (layer) {
      return geom.physicalLayerAlias(layer) === refAlias;
    });
  }

  function traceTerminalPoints(segments) {
    var nodes = [];
    function add(x, y, width) {
      var node = nodes.find(function (item) { return Math.hypot(item.x - x, item.y - y) <= 0.01; });
      if (!node) { node = { x: x, y: y, width: Number(width || 6), degree: 0 }; nodes.push(node); }
      node.degree++;
      node.width = Math.max(node.width, Number(width || 6));
    }
    (segments || []).forEach(function (seg) {
      add(seg.x1, seg.y1, seg.width); add(seg.x2, seg.y2, seg.width);
    });
    var terminals = nodes.filter(function (node) { return node.degree === 1; });
    if (terminals.length === 2) return terminals;
    if (!(segments || []).length) return [];
    var first = segments[0], last = segments[segments.length - 1];
    return [{ x: first.x1, y: first.y1, width: first.width }, { x: last.x2, y: last.y2, width: last.width }];
  }

  function viaSpanText(via) {
    if (!via) return '未知';
    if (via.startLayer || via.endLayer) return (via.startLayer || '?') + '–' + (via.endLayer || '?');
    if (via.minLayerNum != null && via.maxLayerNum != null) return 'L' + via.minLayerNum + '–L' + via.maxLayerNum;
    return '未知';
  }

  function inspectEndpointVia(point, trace, refLayer, viaIndex) {
    if (!viaIndex || !point) return { via: null, eligible: false, status: 'no_via_data', reason: '未导入 Via 数据，无法确认端点反焊盘归属' };
    var traceNet = String(trace.net || '').trim().toUpperCase();
    var candidates = geom.queryPointGrid(viaIndex, point.x - 20, point.y - 20, point.x + 20, point.y + 20).map(function (via) {
      var distance = Math.hypot(via.x - point.x, via.y - point.y);
      var tolerance = Math.max(1, Number(point.width || 6) / 2 + Number(via.drill || 0) / 2 + 0.5);
      return { via: via, distance: distance, near: distance <= tolerance };
    }).filter(function (item) { return item.near; }).sort(function (a, b) { return a.distance - b.distance; });
    if (!candidates.length) return { via: null, eligible: false, status: 'no_via', reason: '端点 ' + pointLabel(point) + ' 附近没有连接 Via' };
    var sameNet = candidates.filter(function (item) {
      return traceNet && String(item.via.net || '').trim().toUpperCase() === traceNet;
    });
    if (!sameNet.length) {
      var nearest = candidates[0];
      return { via: nearest.via, distance: nearest.distance, eligible: false, status: 'net_mismatch',
        reason: '附近 Via #' + nearest.via.id + ' 的网络「' + (nearest.via.net || '空') + '」与走线网络「' + (trace.net || '空') + '」不同' };
    }
    var selected = sameNet[0], via = selected.via;
    var spansReferenceLayer = viaSpansReferenceLayer(via, refLayer);
    return {
      via: via, distance: selected.distance, eligible: true, status: 'matched',
      spanKnown: !!via.hasDefinedSpan, spansReferenceLayer: spansReferenceLayer,
      reason: spansReferenceLayer
        ? '同网络 Via #' + via.id + ' 的层跨 ' + viaSpanText(via) + ' 经过参考层 ' + refLayer
        : via.hasDefinedSpan
          ? '同网络 Via #' + via.id + ' 的层跨 ' + viaSpanText(via) + ' 不经过参考层 ' + refLayer
          : '同网络 Via #' + via.id + ' 缺少 Padstack Defined 层跨'
    };
  }

  function pointLabel(point) {
    return '[' + geom.roundN(point.x, 1) + ', ' + geom.roundN(point.y, 1) + ']';
  }

  function ringBBox(ring) {
    var bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    ring.forEach(function (p) {
      bbox.minX = Math.min(bbox.minX, p[0]); bbox.maxX = Math.max(bbox.maxX, p[0]);
      bbox.minY = Math.min(bbox.minY, p[1]); bbox.maxY = Math.max(bbox.maxY, p[1]);
    });
    return bbox;
  }

  function endpointAntipadExemptions(trace, refLayer, shapeIndex, viaIndex) {
    var endpoints = traceTerminalPoints(trace.segments || []);
    if (!endpoints.length) return { regions: [], viaIds: [], checks: [] };
    var regions = [], knownRings = [], viaIds = [], checks = [];
    endpoints.forEach(function (point, index) {
      var inspection = inspectEndpointVia(point, trace, refLayer, viaIndex);
      var endpointRings = [];
      geom.queryBBoxGrid(shapeIndex, point.x, point.y, point.x, point.y).forEach(function (shape) {
        endpointRings.push.apply(endpointRings, geom.shapeVoidRingsAtPoint(point.x, point.y, shape));
      });
      var check = {
        endpoint: index === 0 ? '首端' : '尾端', point: { x: point.x, y: point.y },
        viaId: inspection.via ? inspection.via.id : null, viaNet: inspection.via ? inspection.via.net : '',
        viaSpan: viaSpanText(inspection.via), viaDistance: inspection.distance,
        hasVoid: endpointRings.length > 0, voidBBoxes: endpointRings.map(ringBBox), status: inspection.status, reason: inspection.reason
      };
      if (!endpointRings.length) {
        check.status = inspection.eligible ? 'no_void' : inspection.status;
        check.reason = inspection.eligible
          ? '同网络 Via #' + inspection.via.id + ' 已匹配，但端点未落在参考层 ' + refLayer + ' 的 Void 内，无需反焊盘豁免'
          : inspection.reason;
        checks.push(check); return;
      }
      if (!inspection.eligible) {
        check.reason = inspection.reason + '，因此端点所在 Void 不予豁免';
        checks.push(check); return;
      }
      endpointRings.forEach(function (ring) {
        if (knownRings.indexOf(ring) >= 0) return;
        knownRings.push(ring); regions.push({ ring: ring, bbox: ringBBox(ring) });
      });
      if (viaIds.indexOf(inspection.via.id) < 0) viaIds.push(inspection.via.id);
      check.status = 'exempted';
      check.reason = inspection.spansReferenceLayer
        ? '已豁免同网络 Via #' + inspection.via.id + ' 在 ' + refLayer + ' 的端点反焊盘（层跨 ' + viaSpanText(inspection.via) + ' 经过该层）'
        : '端点实际落在 ' + refLayer + ' 的 Void 内，已按反焊盘豁免；' + inspection.reason + '，层跨仅作诊断，不推翻已存在的 Void 几何';
      checks.push(check);
    });
    return { regions: regions, viaIds: viaIds, checks: checks };
  }

  function explainMissingPoint(missing, checks) {
    if (!missing) return '';
    var blocked = (checks || []).find(function (check) {
      return check.status !== 'exempted' && (check.voidBBoxes || []).some(function (bbox) {
        return missing.x >= bbox.minX && missing.x <= bbox.maxX && missing.y >= bbox.minY && missing.y <= bbox.maxY;
      });
    });
    if (blocked) return '缺铜点位于走线' + blocked.endpoint + '的 Void 内，但该 Void 未获豁免：' + blocked.reason;
    var exempted = (checks || []).filter(function (check) { return check.status === 'exempted'; });
    return exempted.length
      ? '缺铜点不在已豁免的端点反焊盘内，属于反焊盘范围外或走线中途的实际缺铜'
      : '缺铜点不在任何走线端点 Void 内，属于反焊盘范围外或走线中途的实际缺铜';
  }

  function traceMarginCoverage(trace, index, margin, viaIndex, refLayer) {
    var segments = trace.segments || [];
    var missing = null;
    var left = margin <= 0, right = margin <= 0;
    var exemptions = endpointAntipadExemptions(trace, refLayer, index, viaIndex);
    for (var i = 0; i < segments.length; i++) {
      if (!missing) missing = firstUncoveredInTraceFootprint(segments[i], index, exemptions.regions);
      if (!(left && right)) {
        var nearby = nearbyCopperSidesInSegment(segments[i], index, margin);
        left = left || nearby.left;
        right = right || nearby.right;
      }
    }
    var footprintCovered = segments.length > 0 && !missing;
    return {
      pass: footprintCovered && left && right,
      missing: missing,
      footprintCovered: footprintCovered,
      leftSideCopper: left,
      rightSideCopper: right,
      missingReason: explainMissingPoint(missing, exemptions.checks),
      endpointAntipadExemptionCount: exemptions.viaIds.length,
      endpointAntipadViaIds: exemptions.viaIds,
      endpointAntipadChecks: exemptions.checks
    };
  }

  function checkTraceReferenceMargin(traces, shapes, rules, vias) {
    rules = rules || [];
    var results = [], byLayer = new Map(), indexes = new Map();
    var viaIndex = (vias || []).length ? geom.buildPointGrid(vias, 20, function (via) { return via; }) : null;
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
          var coverage = index ? traceMarginCoverage(trace, index, margin, viaIndex, ref.name) : {
            pass: false, missing: null, footprintCovered: false,
            leftSideCopper: false, rightSideCopper: false,
            missingReason: '参考层 ' + ref.name + ' 没有导入可用于检查的铜皮 Shape',
            endpointAntipadExemptionCount: 0, endpointAntipadViaIds: [], endpointAntipadChecks: []
          };
          var location = coverage.missing
            ? '，首个走线投影缺铜点 [' + geom.roundN(coverage.missing.x, 1) + ', ' + geom.roundN(coverage.missing.y, 1) + ']'
            : '';
          var issues = [], failureKinds = [];
          if (!coverage.footprintCovered) {
            issues.push('走线正上方的完整线宽投影存在缺铜' + location + (coverage.missingReason ? '（判定原因：' + coverage.missingReason + '）' : ''));
            failureKinds.push('footprint');
          }
          if (!coverage.leftSideCopper) {
            issues.push('走线左侧边缘外 ' + margin + ' mil 内未检测到铜皮');
            failureKinds.push('left_side');
          }
          if (!coverage.rightSideCopper) {
            issues.push('走线右侧边缘外 ' + margin + ' mil 内未检测到铜皮');
            failureKinds.push('right_side');
          }
          results.push({
            checkCategory: 'trace_ref_margin', checkCategoryName: '③ 走线参考层覆盖与邻近铜检查',
            ruleIndex: ruleIndex + 1, traceId: trace.id, traceNet: trace.net, traceLayer: trace.layer,
            refLayer: ref.name, refType: ref.type, minMargin: margin,
            actualMargin: coverage.pass ? margin : 0, coverageComplete: coverage.pass,
            footprintCovered: coverage.footprintCovered,
            leftSideCopper: coverage.leftSideCopper,
            rightSideCopper: coverage.rightSideCopper,
            missingPoint: coverage.missing,
            missingReason: coverage.missingReason,
            endpointAntipadExemptionCount: coverage.endpointAntipadExemptionCount,
            endpointAntipadViaIds: coverage.endpointAntipadViaIds,
            endpointAntipadChecks: coverage.endpointAntipadChecks,
            failureKinds: failureKinds,
            pass: coverage.pass,
            message: coverage.pass
              ? '✅ 符合：走线【' + trace.net + '】在 ' + ref.type + '【' + ref.name + '】除端点反焊盘外的完整投影有铜，且走线左右两侧边缘外 ' + margin + ' mil 内均存在铜皮' +
                (coverage.endpointAntipadExemptionCount ? '（已豁免端点 Via #' + coverage.endpointAntipadViaIds.join('、#') + ' 的反焊盘）' : '')
              : '❌ 不符合：走线【' + trace.net + '】在 ' + ref.type + '【' + ref.name + '】' + issues.join('；')
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
