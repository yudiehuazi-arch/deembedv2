/* ============================================================================
 * pour-geom.js —— 铜皮轮廓自适应离散、鞋带面积/质心、点在形内与边界距离计算
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PourChecker = Object.assign(root.PourChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MM_PER_MIL = 0.0254;
  const MIL_PER_MM = 1 / 0.0254;

  function dist2D(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  function roundN(val, n = 3) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    const factor = Math.pow(10, n);
    return Math.round(val * factor) / factor;
  }

  /**
   * 圆弧高精度参数化插值采样 (与 EDA/CAD 引擎完全一致，消除 Canvas 角度反转与 270 度环绕 Bug)
   */
  function sampleArcPoints(center, radius, p1, p2, direction, steps) {
    steps = steps || 24;
    const cx = center[0], cy = center[1];
    const ang1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const ang2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    const TWO_PI = 2 * Math.PI;

    let span;
    if (direction === 'CCW') {
      span = (ang2 - ang1) % TWO_PI;
      if (span < 0) span += TWO_PI;
    } else {
      span = (ang1 - ang2) % TWO_PI;
      if (span < 0) span += TWO_PI;
    }
    if (span === 0) span = TWO_PI;

    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const curAng = (direction === 'CCW') ? (ang1 + frac * span) : (ang1 - frac * span);
      pts.push([cx + radius * Math.cos(curAng), cy + radius * Math.sin(curAng)]);
    }
    return pts;
  }

  /**
   * 点到圆弧段的**精确**最短距离（判断投影角是否落在扫掠范围内，不再一律用 |d-r|）
   */
  function pointToArcDistance(px, py, seg) {
    const cx = seg.cx, cy = seg.cy, radius = seg.radius;
    const TWO_PI = 2 * Math.PI;
    const ang1 = Math.atan2(seg.y1 - cy, seg.x1 - cx);
    const ang2 = Math.atan2(seg.y2 - cy, seg.x2 - cx);
    const ccw = seg.ccw !== false;

    let span;
    if (ccw) {
      span = (ang2 - ang1) % TWO_PI;
      if (span < 0) span += TWO_PI;
    } else {
      span = (ang1 - ang2) % TWO_PI;
      if (span < 0) span += TWO_PI;
    }
    if (span === 0) span = TWO_PI;

    const angP = Math.atan2(py - cy, px - cx);
    let cur;
    if (ccw) {
      cur = (angP - ang1) % TWO_PI;
      if (cur < 0) cur += TWO_PI;
    } else {
      cur = (ang1 - angP) % TWO_PI;
      if (cur < 0) cur += TWO_PI;
    }

    const dCenter = dist2D(px, py, cx, cy);
    if (cur <= span + 1e-9) {
      return Math.abs(dCenter - radius);       // 垂足落在弧段内
    }
    // 否则最近点必在弧的两个端点上
    return Math.min(dist2D(px, py, seg.x1, seg.y1), dist2D(px, py, seg.x2, seg.y2));
  }

  /**
   * 把铜皮轮廓（直线 + 圆弧）离散成闭合多边形环。
   * 圆弧按弦高误差 tol(mil) 自适应分段，默认 0.05 mil。
   */
  function flattenBoundary(shapeOrBoundary, tol) {
    const boundary = Array.isArray(shapeOrBoundary)
      ? shapeOrBoundary
      : (shapeOrBoundary && shapeOrBoundary.boundary);
    if (!boundary || !boundary.length) return [];
    const maxErr = tol || 0.05;
    const ring = [];
    for (const seg of boundary) {
      if (seg.type === 'line') {
        ring.push([seg.x1, seg.y1]);
      } else {
        let steps = 8;
        if (seg.radius > maxErr) {
          steps = Math.ceil(Math.abs(arcSpanOf(seg)) / (2 * Math.acos(Math.max(-1, 1 - maxErr / seg.radius))));
        }
        steps = Math.max(4, Math.min(720, steps));
        const pts = sampleArcPoints([seg.cx, seg.cy], seg.radius, [seg.x1, seg.y1], [seg.x2, seg.y2],
          seg.ccw === false ? 'CW' : 'CCW', steps);
        for (let i = 0; i < pts.length - 1; i++) ring.push(pts[i]);
      }
    }
    return ring;
  }

  function arcSpanOf(seg) {
    const TWO_PI = 2 * Math.PI;
    const ang1 = Math.atan2(seg.y1 - seg.cy, seg.x1 - seg.cx);
    const ang2 = Math.atan2(seg.y2 - seg.cy, seg.x2 - seg.cx);
    let span = seg.ccw === false ? (ang1 - ang2) % TWO_PI : (ang2 - ang1) % TWO_PI;
    if (span < 0) span += TWO_PI;
    if (span === 0) span = TWO_PI;
    return span;
  }

  /** 多边形面积（鞋带公式，绝对值） */
  function polygonArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  /** 多边形质心（面积加权）；退化时退回顶点平均值 */
  function polygonCentroid(ring) {
    if (!ring || !ring.length) return { x: 0, y: 0 };
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const cross = p[0] * q[1] - q[0] * p[1];
      a += cross;
      cx += (p[0] + q[0]) * cross;
      cy += (p[1] + q[1]) * cross;
    }
    if (Math.abs(a) < 1e-12) {
      const sx = ring.reduce((t, p) => t + p[0], 0) / ring.length;
      const sy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
      return { x: sx, y: sy };
    }
    a *= 0.5;
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  const polygonRayIndexCache = new WeakMap();

  function buildPolygonRayIndex(ring) {
    let minY = Infinity, maxY = -Infinity;
    ring.forEach(point => { minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]); });
    const cellSize = Math.max(10, (maxY - minY) / 512 || 10);
    const cells = new Map(), longEdges = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const startCell = Math.floor(Math.min(ring[i][1], ring[j][1]) / cellSize);
      const endCell = Math.floor(Math.max(ring[i][1], ring[j][1]) / cellSize);
      if (endCell - startCell > 512) { longEdges.push([i, j]); continue; }
      for (let cell = startCell; cell <= endCell; cell++) {
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell).push([i, j]);
      }
    }
    return { cellSize, cells, longEdges };
  }

  /** 射线法：长轮廓按 Y 区间索引候选边，避免每个查询点遍历整块铜皮的全部边。 */
  function pointInPolygon(px, py, ring) {
    if (!ring || ring.length < 3) return false;
    let edges = null;
    if (ring.length >= 32) {
      let index = polygonRayIndexCache.get(ring);
      if (!index) { index = buildPolygonRayIndex(ring); polygonRayIndexCache.set(ring, index); }
      edges = (index.cells.get(Math.floor(py / index.cellSize)) || []).concat(index.longEdges);
    }
    let inside = false;
    if (!edges) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > py) !== (yj > py)) {
          const xCross = xi + (py - yi) * (xj - xi) / (yj - yi);
          if (px < xCross) inside = !inside;
        }
      }
      return inside;
    }
    for (const edge of edges) {
      const current = ring[edge[0]], previous = ring[edge[1]];
      const xi = current[0], yi = current[1], xj = previous[0], yj = previous[1];
      if ((yi > py) !== (yj > py)) {
        const xCross = xi + (py - yi) * (xj - xi) / (yj - yi);
        if (px < xCross) inside = !inside;
      }
    }
    return inside;
  }

  function setGeometryCache(target, key, value) {
    Object.defineProperty(target, key, { value, writable: true, configurable: true });
    return value;
  }

  /** 铜皮外轮廓多边形环（非枚举缓存），避免 Worker 回传时复制派生点列。 */
  function shapeRing(shape) {
    if (!shape) return [];
    if (Array.isArray(shape._ring)) return shape._ring;
    if (!shape.boundary || !shape.boundary.length) return [];
    return setGeometryCache(shape, '_ring', flattenBoundary(shape.boundary));
  }

  /** 铜皮全部轮廓：第一个是 exterior，其余是按报告顺序排列的 Void。 */
  function shapeRings(shape) {
    const exterior = shapeRing(shape);
    if (!exterior.length) return [];
    if (Array.isArray(shape._voidRings)) return [exterior].concat(shape._voidRings);
    const voidRings = (shape.voids || []).map(voidContour => {
      if (Array.isArray(voidContour._ring)) return voidContour._ring;
      const ring = flattenBoundary(voidContour.boundary || voidContour);
      if (voidContour && !Array.isArray(voidContour)) setGeometryCache(voidContour, '_ring', ring);
      return ring;
    }).filter(ring => ring.length >= 3);
    setGeometryCache(shape, '_voidRings', voidRings);
    return [exterior].concat(voidRings);
  }

  const shapeVoidIndexCache = new WeakMap();

  function ringBBox(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ring.forEach(point => {
      minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
    });
    return { minX, minY, maxX, maxY };
  }

  function buildVoidRingIndex(rings) {
    const cellSize = 25, cells = new Map(), large = [];
    for (let i = 1; i < rings.length; i++) {
      const bbox = ringBBox(rings[i]);
      const minGX = Math.floor(bbox.minX / cellSize), maxGX = Math.floor(bbox.maxX / cellSize);
      const minGY = Math.floor(bbox.minY / cellSize), maxGY = Math.floor(bbox.maxY / cellSize);
      const entry = { ring: rings[i], bbox };
      if ((maxGX - minGX + 1) * (maxGY - minGY + 1) > 256) { large.push(entry); continue; }
      for (let gx = minGX; gx <= maxGX; gx++) {
        for (let gy = minGY; gy <= maxGY; gy++) {
          const key = gx + ',' + gy;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(entry);
        }
      }
    }
    return { cellSize, cells, large };
  }

  function voidRingEntriesAtPoint(px, py, shape) {
    const rings = shapeRings(shape);
    if (rings.length <= 1 || !pointInPolygon(px, py, rings[0])) return [];
    let index = shapeVoidIndexCache.get(shape);
    if (!index) { index = buildVoidRingIndex(rings); shapeVoidIndexCache.set(shape, index); }
    const key = Math.floor(px / index.cellSize) + ',' + Math.floor(py / index.cellSize);
    return index.large.concat(index.cells.get(key) || []).filter(entry => {
      const b = entry.bbox;
      return px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY && pointInPolygon(px, py, entry.ring);
    });
  }

  /** 返回覆盖指定点的 Void 轮廓，供识别走线端点反焊盘。 */
  function shapeVoidRingsAtPoint(px, py, shape) {
    return voidRingEntriesAtPoint(px, py, shape).map(entry => entry.ring);
  }

  /** 按包围盒查询 Shape 的 Void 轮廓，避免长走线逐一遍历整板反焊盘。 */
  function shapeVoidRingEntriesInBBox(minX, minY, maxX, maxY, shape) {
    const rings = shapeRings(shape);
    if (rings.length <= 1) return [];
    let index = shapeVoidIndexCache.get(shape);
    if (!index) { index = buildVoidRingIndex(rings); shapeVoidIndexCache.set(shape, index); }
    const candidates = new Set(index.large);
    for (let gx = Math.floor(minX / index.cellSize); gx <= Math.floor(maxX / index.cellSize); gx++) {
      for (let gy = Math.floor(minY / index.cellSize); gy <= Math.floor(maxY / index.cellSize); gy++) {
        (index.cells.get(gx + ',' + gy) || []).forEach(entry => candidates.add(entry));
      }
    }
    return Array.from(candidates).filter(entry => {
      const b = entry.bbox;
      return b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;
    });
  }

  /** 与 Canvas evenodd 填充一致；Void 按包围盒网格检索，避免逐点扫描整板全部反焊盘。 */
  function pointInShape(px, py, shape) {
    const rings = shapeRings(shape);
    if (!rings.length || !pointInPolygon(px, py, rings[0])) return false;
    if (rings.length === 1) return true;
    let index = shapeVoidIndexCache.get(shape);
    if (!index) { index = buildVoidRingIndex(rings); shapeVoidIndexCache.set(shape, index); }
    const key = Math.floor(px / index.cellSize) + ',' + Math.floor(py / index.cellSize);
    let inside = true;
    for (const entry of index.large) {
      const b = entry.bbox;
      if (px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY && pointInPolygon(px, py, entry.ring)) inside = !inside;
    }
    for (const entry of index.cells.get(key) || []) {
      const b = entry.bbox;
      if (px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY && pointInPolygon(px, py, entry.ring)) inside = !inside;
    }
    return inside;
  }

  function shapeBoundaries(shape) {
    const boundaries = [];
    if (shape && shape.boundary && shape.boundary.length) boundaries.push(shape.boundary);
    (shape && shape.voids || []).forEach(voidContour => {
      const boundary = voidContour && (voidContour.boundary || voidContour);
      if (boundary && boundary.length) boundaries.push(boundary);
    });
    return boundaries;
  }

  /** 点到 exterior 或任一 Void 边缘的精确最短距离。 */
  function pointToShapeBoundaryDistance(px, py, shape) {
    let minD = Infinity;
    shapeBoundaries(shape).forEach(boundary => {
      boundary.forEach(seg => {
        const d = seg.type === 'line'
          ? pointToSegmentDist(px, py, seg.x1, seg.y1, seg.x2, seg.y2)
          : pointToArcDistance(px, py, seg);
        if (d < minD) minD = d;
      });
    });
    return minD;
  }

  /**
   * 辅助函数：层范围解析与展开 (如 "L1-L5" -> ["L1", "L2", "L3", "L4", "L5"])
   * @param {string|Array<string>} layerInput 
   * @param {Array<string>} availableLayers 
   * @returns {Array<string>} 展开后的层列表
   */

  function pointToShapeDistance(px, py, shape) {
    const b = shape.bbox;
    const hasGeom = !!(shape.boundary && shape.boundary.length);

    if (!hasGeom) {
      // 无几何数据（仅 bbox/面积）时的退化路径
      const dxBox = Math.max(0, b.minX - px, px - b.maxX);
      const dyBox = Math.max(0, b.minY - py, py - b.maxY);
      const boxDist = Math.hypot(dxBox, dyBox);
      return isPointInsideBBox(px, py, b) ? 0 : boxDist;
    }

    // 圆形铜皮快捷计算：仅当确实是「整圆」时才走这条路径
    // （单段圆弧 + 一段弦（D 形铜皮）不是圆，必须按真实轮廓算）
    if ((!shape.voids || shape.voids.length === 0) && shape.arcs && shape.arcs.length === 1 && shape.boundary.length <= 2 &&
        Math.abs(arcSpanOf(shape.arcs[0]) - 2 * Math.PI) < 1e-6) {
      const arc = shape.arcs[0];
      const dCenter = dist2D(px, py, arc.cx, arc.cy);
      return dCenter <= arc.radius ? 0 : dCenter - arc.radius;
    }

    // 真实的内外判定：只有 exterior 内且不在 Void 内才是铜。
    if (pointInShape(px, py, shape)) return 0;

    // 位于 Void 内时，距离应取到 Void 边缘；位于外部时取到 exterior/边缘。
    const minD = pointToShapeBoundaryDistance(px, py, shape);
    if (minD === Infinity) {
      const dxBox = Math.max(0, b.minX - px, px - b.maxX);
      const dyBox = Math.max(0, b.minY - py, py - b.maxY);
      return Math.hypot(dxBox, dyBox);
    }
    return minD;
  }

  function isPointInsideBBox(px, py, bbox) {
    return px >= bbox.minX && px <= bbox.maxX && py >= bbox.minY && py <= bbox.maxY;
  }

  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return dist2D(px, py, x1, y1);

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return dist2D(px, py, projX, projY);
  }

  function physicalLayerAlias(layer) {
    const key = String(layer || '').trim().toUpperCase();
    if (!key) return '';
    if (key === 'TOP') return 'L1';
    const logical = key.match(/^L0*(\d+)$/);
    const allegro = key.match(/^0*(\d{1,2})(?=[A-Z])/);
    return logical || allegro ? `L${parseInt((logical || allegro)[1], 10)}` : key;
  }

  function gridKey(gx, gy) { return gx + ',' + gy; }

  /** 点对象空间网格，用于过孔/质心的局部半径查询。 */
  function buildPointGrid(items, cellSize, pointGetter) {
    const size = Math.max(1, cellSize || 100);
    const getter = pointGetter || (item => ({ x: item.x, y: item.y }));
    const cells = new Map();
    (items || []).forEach(item => {
      const point = getter(item);
      if (!point || !isFinite(point.x) || !isFinite(point.y)) return;
      const key = gridKey(Math.floor(point.x / size), Math.floor(point.y / size));
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(item);
    });
    return { cellSize: size, cells, pointGetter: getter };
  }

  function queryPointGrid(index, minX, minY, maxX, maxY) {
    if (!index) return [];
    const size = index.cellSize;
    const result = [];
    for (let gx = Math.floor(minX / size); gx <= Math.floor(maxX / size); gx++) {
      for (let gy = Math.floor(minY / size); gy <= Math.floor(maxY / size); gy++) {
        const bucket = index.cells.get(gridKey(gx, gy)) || [];
        bucket.forEach(item => {
          const point = index.pointGetter(item);
          if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) result.push(item);
        });
      }
    }
    return result;
  }

  /** BBox 空间网格；跨越过多网格的整板大铜皮单独保存，避免索引内存膨胀。 */
  function buildBBoxGrid(items, cellSize) {
    const size = Math.max(1, cellSize || 100);
    const cells = new Map();
    const largeItems = [];
    (items || []).forEach(item => {
      const b = item && item.bbox;
      if (!b) return;
      const minGX = Math.floor(b.minX / size), maxGX = Math.floor(b.maxX / size);
      const minGY = Math.floor(b.minY / size), maxGY = Math.floor(b.maxY / size);
      if ((maxGX - minGX + 1) * (maxGY - minGY + 1) > 256) {
        largeItems.push(item);
        return;
      }
      for (let gx = minGX; gx <= maxGX; gx++) {
        for (let gy = minGY; gy <= maxGY; gy++) {
          const key = gridKey(gx, gy);
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(item);
        }
      }
    });
    return { cellSize: size, cells, largeItems };
  }

  function queryBBoxGrid(index, minX, minY, maxX, maxY) {
    if (!index) return [];
    const size = index.cellSize;
    const candidates = new Set(index.largeItems || []);
    for (let gx = Math.floor(minX / size); gx <= Math.floor(maxX / size); gx++) {
      for (let gy = Math.floor(minY / size); gy <= Math.floor(maxY / size); gy++) {
        (index.cells.get(gridKey(gx, gy)) || []).forEach(item => candidates.add(item));
      }
    }
    return Array.from(candidates).filter(item => {
      const b = item.bbox;
      return b && b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;
    });
  }
  return {
    MM_PER_MIL: MM_PER_MIL,
    MIL_PER_MM: MIL_PER_MM,
    dist2D: dist2D,
    roundN: roundN,
    sampleArcPoints: sampleArcPoints,
    pointToArcDistance: pointToArcDistance,
    flattenBoundary: flattenBoundary,
    arcSpanOf: arcSpanOf,
    polygonArea: polygonArea,
    polygonCentroid: polygonCentroid,
    pointInPolygon: pointInPolygon,
    shapeRing: shapeRing,
    shapeRings: shapeRings,
    shapeVoidRingsAtPoint: shapeVoidRingsAtPoint,
    shapeVoidRingEntriesInBBox: shapeVoidRingEntriesInBBox,
    pointInShape: pointInShape,
    pointToShapeBoundaryDistance: pointToShapeBoundaryDistance,
    pointToShapeDistance: pointToShapeDistance,
    isPointInsideBBox: isPointInsideBBox,
    pointToSegmentDist: pointToSegmentDist,
    physicalLayerAlias: physicalLayerAlias,
    buildPointGrid: buildPointGrid,
    queryPointGrid: queryPointGrid,
    buildBBoxGrid: buildBBoxGrid,
    queryBBoxGrid: queryBBoxGrid
  };
});
