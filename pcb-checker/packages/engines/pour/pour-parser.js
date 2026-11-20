/* ============================================================================
 * pour-parser.js —— 铜皮 Shape / Via / Trace 元素块解析与物理层范围展开
 * ========================================================================== */
(function (root, factory) {
  var geom = (typeof module === "object" && module.exports) ? require("./pour-geom.js") : root.PourChecker;
  var api = factory(geom);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PourChecker = Object.assign(root.PourChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (geom) {
  "use strict";
  var MM_PER_MIL = geom.MM_PER_MIL;
  var MIL_PER_MM = geom.MIL_PER_MM;
  var dist2D = geom.dist2D;
  var roundN = geom.roundN;
  var sampleArcPoints = geom.sampleArcPoints;
  var flattenBoundary = geom.flattenBoundary;
  var polygonArea = geom.polygonArea;
  var polygonCentroid = geom.polygonCentroid;

  /** 规则 2 接受三类 Set；旧模板与缺失 Set 的测试对象按 Shape 兼容。 */
  const SPECIAL_SHAPE_SETS = ['Shape', 'Route Keepout', 'Board Geometry'];
  function normalizeSpecialShapeSet(value, fallback) {
    const key = String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
    if (key === 'shape') return 'Shape';
    if (key === 'route keepout') return 'Route Keepout';
    if (key === 'board geometry') return 'Board Geometry';
    return SPECIAL_SHAPE_SETS.includes(fallback) ? fallback : '';
  }

  function expandLayerRange(layerInput, availableLayers = []) {
    if (Array.isArray(layerInput)) {
      return [...new Set(layerInput.flatMap(layer => expandLayerRange(String(layer), availableLayers)))];
    }
    if (!layerInput || typeof layerInput !== 'string') return [];

    const str = layerInput.trim();
    if (str === '*' || str.toUpperCase() === 'ALL' || str === '全部' || str === '全部层') {
      return availableLayers.length > 0 ? [...availableLayers] : ['Top', '02G01P', '08IS03', '19IS08', 'Bottom'];
    }

    // 先拆分逗号等列表，再逐项展开范围；例如 L1, L3-L5 => L1/L3/L4/L5。
    const tokens = str.replace(/\s*(\.\.|[-~～–—])\s*/g, '$1')
      .split(/[,;\/，；、]+/).map(token => token.trim()).filter(Boolean);
    const layers = [];
    tokens.forEach(token => {
      const rangeMatch = token.match(/^([a-zA-Z]*)(\d+)(?:-|~|～|–|—|\.\.)([a-zA-Z]*)(\d+)$/);
      if (!rangeMatch) {
        layers.push(token);
        return;
      }
      const prefix = rangeMatch[1] || rangeMatch[3] || 'L';
      const startNum = parseInt(rangeMatch[2], 10);
      const endNum = parseInt(rangeMatch[4], 10);
      const minN = Math.min(startNum, endNum);
      const maxN = Math.max(startNum, endNum);
      for (let layerNum = minN; layerNum <= maxN; layerNum++) layers.push(`${prefix}${layerNum}`);
    });
    return [...new Set(layers)];
  }

  /**
   * 1. 解析 EDA TXT 中的 Shape (铜皮)、Via (过孔)、Trace (走线)
   * @param {string} text 
   * @returns {Object} { shapes, vias, traces, layers }
   */
  function parsePcbElements(text) {
    if (!text || typeof text !== 'string') {
      return { shapes: [], vias: [], traces: [], layers: [] };
    }

    const RE_ITEM_BLOCK = /Item\s+(\d+)[\s\S]*?(?=Item\s+\d+|\s*~+\s*End\s*~+|\s*$)/g;
    const shapes = [];
    const vias = [];
    const traces = [];
    const layerSet = new Set();

    let match;
    while ((match = RE_ITEM_BLOCK.exec(text)) !== null) {
      const itemNum = parseInt(match[1], 10);
      const block = match[0];

      // === SHAPE (铜皮) ===
      if (/<(?:\s*Shape\s*)>/i.test(block)) {
        const shapeObj = parseShapeBlock(itemNum, block);
        if (shapeObj) {
          shapes.push(shapeObj);
          if (shapeObj.layer) layerSet.add(shapeObj.layer);
        }
      }
      // === VIA (过孔) ===
      else if (/<(?:\s*Via\s*)>/i.test(block)) {
        const viaObj = parseViaBlock(itemNum, block);
        if (viaObj) {
          vias.push(viaObj);
        }
      }
      // === TRACE / LINE / SEG (走线) ===
      else if (/<(?:\s*Trace(?:\s*Seg)?|\s*Line(?:\s*Seg)?|\s*Seg|\s*Segment|\s*Arc)\s*>/i.test(block)) {
        const traceObj = parseTraceBlock(itemNum, block);
        if (traceObj) {
          traces.push(traceObj);
          if (traceObj.layer) layerSet.add(traceObj.layer);
        }
      }
    }

    const layers = Array.from(layerSet).sort();
    return { shapes, vias, traces, layers };
  }

  /**
   * 解析 Shape 的实际铜皮轮廓。
   *
   * Allegro 报告把动态铜皮分成三个概念：Exterior Boundary、零到多个 Void，
   * 以及仅供参考的 Original Boundary。后者不是回填后的真实铜皮，绝不能混入外轮廓。
   */
  function parseShapeContours(block) {
    const lines = String(block || '').split(/\r?\n/);
    const number = '([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?)';
    const SEG_RE = new RegExp('^\\s*(Arc\\s+seg|Line\\s+seg|Seg):\\s*xy\\s*\\[\\s*' + number + '\\s*,\\s*' + number + '\\s*\\]\\s*xy\\s*\\[\\s*' + number + '\\s*,\\s*' + number + '\\s*\\](?:\\s*Width\\s*\\(\\s*' + number + '\\s*\\))?', 'i');
    const CENTER_RE = new RegExp('Center-xy:\\s*\\[\\s*' + number + '\\s*,\\s*' + number + '\\s*\\]\\s*Radius\\s*\\(\\s*' + number + '\\s*\\)(?:\\s*(CCW|CW))?', 'i');
    const exterior = { boundary: [], arcs: [] };
    const voids = [];
    let contour = null;
    let reachedOriginalBoundary = false;

    for (let index = 0; index < lines.length; index++) {
      const heading = lines[index].trim();
      if (/^Exterior\s+Boundary\s*:\s*$/i.test(heading)) {
        contour = exterior;
        reachedOriginalBoundary = false;
        continue;
      }
      if (/^Original\s+Boundary\s*:\s*$/i.test(heading)) {
        contour = null;
        reachedOriginalBoundary = true;
        continue;
      }
      if (/^Void(?:\s*(?:#?\d+|\(\d+\)))?\s*:\s*$/i.test(heading)) {
        // Original Boundary 后的任何子段都属于参考几何，同样忽略。
        if (!reachedOriginalBoundary) {
          contour = { boundary: [], arcs: [] };
          voids.push(contour);
        }
        continue;
      }
      if (!contour || reachedOriginalBoundary) continue;

      const match = lines[index].match(SEG_RE);
      if (!match) continue;
      const segment = {
        type: /^Arc/i.test(match[1]) ? 'arc' : 'line',
        x1: parseFloat(match[2]), y1: parseFloat(match[3]),
        x2: parseFloat(match[4]), y2: parseFloat(match[5]),
        width: match[6] ? parseFloat(match[6]) : 0
      };
      if (segment.type === 'arc') {
        const center = (lines[index + 1] || '').match(CENTER_RE);
        if (!center) continue;
        segment.cx = parseFloat(center[1]);
        segment.cy = parseFloat(center[2]);
        segment.radius = parseFloat(center[3]);
        segment.dir = center[4] ? center[4].toUpperCase() : 'CCW';
        segment.ccw = segment.dir === 'CCW';
        contour.arcs.push(segment);
      }
      contour.boundary.push(segment);
    }

    // 空 Void 标题不是有效孔洞，避免给渲染器留下退化子路径。
    return {
      boundary: exterior.boundary,
      exteriorArcs: exterior.arcs,
      voids: voids.filter(voidContour => voidContour.boundary.length > 0)
    };
  }

  function parseShapeBoundary(block) {
    const parsed = parseShapeContours(block);
    return {
      boundary: parsed.boundary,
      arcs: parsed.exteriorArcs.concat(...parsed.voids.map(voidContour => voidContour.arcs)),
      voids: parsed.voids,
      exteriorArcs: parsed.exteriorArcs
    };
  }

  /**
   * 解析单个 Shape 块
   */
  function parseShapeBlock(itemNum, block) {
    const subsetM = block.match(/Subset:\s*([^\r\n]+)/i);
    const layer = subsetM ? subsetM[1].trim() : 'UNKNOWN_LAYER';
    const setM = block.match(/Set:\s*([^\r\n]+)/i);
    const set = setM ? setM[1].trim() : 'Etch';
    const typeM = block.match(/Type:\s*([^\r\n]+)/i);
    const type = typeM ? typeM[1].trim() : 'Shape(Static)';
    const netM = block.match(/Net:\s*([^\r\n]+)/i);
    const net = netM ? netM[1].trim() : '';
    const areaM = block.match(/Area:\s*([\d\.\-]+)/i);
    const area = areaM ? parseFloat(areaM[1]) : 0;

    const parsedBoundary = parseShapeBoundary(block);
    const boundary = parsedBoundary.boundary;
    const voids = parsedBoundary.voids;
    const arcs = parsedBoundary.arcs;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    function updateBBox(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    boundary.forEach(seg => {
      updateBBox(seg.x1, seg.y1);
      updateBBox(seg.x2, seg.y2);
      if (seg.type === 'arc') {
        // 保守包围盒包含整圆，避免空间筛选漏检；预览按真实扫掠弧绘制。
        updateBBox(seg.cx - seg.radius, seg.cy - seg.radius);
        updateBBox(seg.cx + seg.radius, seg.cy + seg.radius);
      }
    });

    if (minX === Infinity) { minX = 0; maxX = 0; minY = 0; maxY = 0; }

    const shape = {
      id: itemNum,
      rawId: itemNum,
      layer,
      set,
      type,
      net,
      area: area,                     // 以 EDA 报告面积为准（缺失时才用计算值）
      areaReported: area,
      areaComputed: 0,
      areaMm2: area * MM_PER_MIL * MM_PER_MIL,
      boundary,
      voids,
      arcs,
      centroid: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      bbox: { minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY }
    };
    Object.defineProperty(shape, 'rawText', { value: block, enumerable: false });

    // 用 exterior 减去全部 Void 得到实际铜面积与面积加权质心。
    const ring = flattenBoundary(boundary);
    if (ring.length >= 3) {
      Object.defineProperty(shape, '_ring', { value: ring, writable: true, configurable: true });
      const exteriorArea = polygonArea(ring);
      const exteriorCentroid = polygonCentroid(ring);
      let filledArea = exteriorArea;
      let centroidXMoment = exteriorCentroid.x * exteriorArea;
      let centroidYMoment = exteriorCentroid.y * exteriorArea;
      Object.defineProperty(shape, '_voidRings', { value: [], writable: true, configurable: true });
      voids.forEach(voidContour => {
        const voidRing = flattenBoundary(voidContour.boundary);
        Object.defineProperty(voidContour, '_ring', { value: voidRing, writable: true, configurable: true });
        if (voidRing.length < 3) return;
        shape._voidRings.push(voidRing);
        const voidArea = polygonArea(voidRing);
        const voidCentroid = polygonCentroid(voidRing);
        filledArea -= voidArea;
        centroidXMoment -= voidCentroid.x * voidArea;
        centroidYMoment -= voidCentroid.y * voidArea;
      });
      shape.areaComputed = Math.max(0, filledArea);
      if (!(shape.area > 0)) {
        shape.area = shape.areaComputed;
        shape.areaMm2 = shape.area * MM_PER_MIL * MM_PER_MIL;
      }
      if (filledArea > 1e-12) {
        const c = { x: centroidXMoment / filledArea, y: centroidYMoment / filledArea };
        if (isFinite(c.x) && isFinite(c.y)) shape.centroid = c;
      }
    }

    return shape;
  }

  /** 将同一异型铜皮模板的多个 Shape Item 组合为一个预览与面积比对对象。 */
  function composeShapeItems(shapes) {
    const items = (shapes || []).filter(shape => shape && shape.bbox);
    if (!items.length) return null;
    if (items.length === 1) return items[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let area = 0, areaComputed = 0, areaMm2 = 0, momentX = 0, momentY = 0, weightSum = 0;
    const layers = new Set(), nets = new Set(), sets = new Set();
    const boundary = [], voids = [], arcs = [];
    items.forEach(shape => {
      minX = Math.min(minX, shape.bbox.minX); minY = Math.min(minY, shape.bbox.minY);
      maxX = Math.max(maxX, shape.bbox.maxX); maxY = Math.max(maxY, shape.bbox.maxY);
      area += Number(shape.area) || 0;
      areaComputed += Number(shape.areaComputed) || 0;
      areaMm2 += Number(shape.areaMm2) || 0;
      const weight = Number(shape.area) > 0 ? Number(shape.area) : 1;
      if (shape.centroid && isFinite(shape.centroid.x) && isFinite(shape.centroid.y)) {
        momentX += shape.centroid.x * weight; momentY += shape.centroid.y * weight; weightSum += weight;
      }
      if (shape.layer) layers.add(shape.layer);
      if (shape.net) nets.add(shape.net);
      const shapeSet = normalizeSpecialShapeSet(shape.set, shape.set == null ? 'Shape' : '') || String(shape.set || '').trim();
      if (shapeSet) sets.add(shapeSet);
      boundary.push.apply(boundary, shape.boundary || []);
      voids.push.apply(voids, shape.voids || []);
      arcs.push.apply(arcs, shape.arcs || []);
    });
    return {
      id: items[0].id,
      rawId: items[0].rawId,
      itemIds: items.map(shape => shape.id),
      itemCount: items.length,
      components: items,
      layer: Array.from(layers).join(', '),
      layers: Array.from(layers),
      net: Array.from(nets).join(', '),
      nets: Array.from(nets),
      set: Array.from(sets).join(', '),
      sets: Array.from(sets),
      hasMixedSets: sets.size > 1,
      type: 'Shape(Multi-Item)',
      area,
      areaReported: area,
      areaComputed,
      areaMm2,
      boundary,
      voids,
      arcs,
      centroid: weightSum > 0
        ? { x: momentX / weightSum, y: momentY / weightSum }
        : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      bbox: { minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY }
    };
  }

  function shapeItemsTouch(a, b, tolerance) {
    const gap = tolerance == null ? 0.05 : tolerance;
    if (!a || !b || !a.bbox || !b.bbox) return false;
    if (a.bbox.maxX < b.bbox.minX - gap || b.bbox.maxX < a.bbox.minX - gap ||
        a.bbox.maxY < b.bbox.minY - gap || b.bbox.maxY < a.bbox.minY - gap) return false;
    const aRing = geom.shapeRing(a), bRing = geom.shapeRing(b);
    if (a.centroid && geom.pointToShapeDistance(a.centroid.x, a.centroid.y, b) <= gap) return true;
    if (b.centroid && geom.pointToShapeDistance(b.centroid.x, b.centroid.y, a) <= gap) return true;
    for (let i = 0; i < aRing.length; i++) {
      if (geom.pointToShapeDistance(aRing[i][0], aRing[i][1], b) <= gap) return true;
    }
    for (let i = 0; i < bRing.length; i++) {
      if (geom.pointToShapeDistance(bRing[i][0], bRing[i][1], a) <= gap) return true;
    }
    return false;
  }

  function shapeNetCompatible(a, b) {
    const left = String(a || '').trim().toUpperCase(), right = String(b || '').trim().toUpperCase();
    return !left || !right || left === right;
  }

  function viaToShapeDistance(via, shape) {
    if (shape && shape.bbox) return geom.pointToShapeDistance(via.x, via.y, shape);
    return shape && shape.centroid ? dist2D(via.x, via.y, shape.centroid.x, shape.centroid.y) : Infinity;
  }

  function queryShapeAssociationIndex(index, via, radius) {
    if (!index) return [];
    if (!index.bboxIndex && !index.pointIndex) {
      return geom.queryPointGrid(index, via.x - radius, via.y - radius, via.x + radius, via.y + radius);
    }
    const found = new Set();
    geom.queryBBoxGrid(index.bboxIndex, via.x - radius, via.y - radius, via.x + radius, via.y + radius)
      .forEach(shape => found.add(shape));
    geom.queryPointGrid(index.pointIndex, via.x - radius, via.y - radius, via.x + radius, via.y + radius)
      .forEach(shape => found.add(shape));
    return Array.from(found);
  }

  /** 从孔边铜皮出发，收集局部范围内同层、同 Set、同网络且真实边界相接的完整连通分量。 */
  function findAssociatedShapeItems(via, shapeIndex) {
    const radius = 120;
    const candidates = queryShapeAssociationIndex(shapeIndex, via, radius)
      .filter(shape => shapeNetCompatible(via.net, shape.net))
      .map(shape => ({ shape, distance: viaToShapeDistance(via, shape) }))
      .filter(entry => entry.distance <= radius)
      .sort((a, b) => a.distance - b.distance || String(a.shape.id).localeCompare(String(b.shape.id), undefined, { numeric: true }));
    if (!candidates.length) return null;
    const selected = [candidates[0].shape], used = new Set(selected);
    while (true) {
      const next = candidates.find(entry => {
        const shape = entry.shape, first = selected[0];
        if (used.has(shape) || String(shape.layer).toUpperCase() !== String(first.layer).toUpperCase()) return false;
        const shapeSet = normalizeSpecialShapeSet(shape.set, shape.set == null ? 'Shape' : '');
        const firstSet = normalizeSpecialShapeSet(first.set, first.set == null ? 'Shape' : '');
        if (shapeSet !== firstSet || !shapeNetCompatible(first.net, shape.net)) return false;
        return selected.some(current => shapeItemsTouch(current, shape, 0.05));
      });
      if (!next) break;
      selected.push(next.shape); used.add(next.shape);
    }
    return selected.length === 1 ? selected[0] : composeShapeItems(selected);
  }

  function buildShapePointIndexes(shapes) {
    const byLayer = new Map();
    (shapes || []).forEach(shape => {
      const layer = String(shape.layer || '').toUpperCase();
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer).push(shape);
    });
    const indexes = new Map();
    byLayer.forEach((layerShapes, layer) => {
      const index = {
        bboxIndex: geom.buildBBoxGrid(layerShapes.filter(shape => shape && shape.bbox), 120),
        pointIndex: geom.buildPointGrid(layerShapes, 120, shape => shape.centroid)
      };
      indexes.set(layer, index);
      const alias = geom.physicalLayerAlias(layer);
      if (!indexes.has(alias)) indexes.set(alias, index);
    });
    return indexes;
  }

  function stackLayerNumber(layer) {
    const key = String(layer || '').trim().toUpperCase();
    if (key === 'TOP') return 1;
    if (/^(?:BOTTOM|BOT)$/.test(key)) return 9999;
    const alias = geom.physicalLayerAlias(key);
    const match = alias.match(/^L0*(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  function parseViaSpan(block) {
    const only = block.match(/Padstack\s+Defined\s+only\s+on\s+([^\s\r\n]+)/i);
    const pair = block.match(/Padstack\s+Defined\s*(?:from|:)?\s*([^\s\r\n\-~]+?)\s*(?:\s+to\s+|\s*[\-~]\s*)\s*([^\s\r\n]+)/i);
    const startLayer = only ? only[1].trim() : pair ? pair[1].trim() : '';
    const endLayer = only ? startLayer : pair ? pair[2].trim() : '';
    const startLayerNum = stackLayerNumber(startLayer), endLayerNum = stackLayerNumber(endLayer);
    return {
      hasDefinedSpan: !!(only || pair), startLayer: startLayer, endLayer: endLayer,
      startLayerNum: startLayerNum, endLayerNum: endLayerNum,
      minLayerNum: startLayerNum == null || endLayerNum == null ? null : Math.min(startLayerNum, endLayerNum),
      maxLayerNum: startLayerNum == null || endLayerNum == null ? null : Math.max(startLayerNum, endLayerNum)
    };
  }

  /** 解析 Via 块（保留端点反焊盘诊断所需的 Padstack 层跨）。 */
  function parseViaBlock(itemNum, block) {
    const origM = block.match(/(?:Origin-xy|Location|xy):\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i);
    if (!origM) return null;

    const padM = block.match(/Padstack\s+Name:\s*([^\r\n]+)/i);
    const netM = block.match(/Net:\s*([^\r\n]+)/i);
    const drillM = block.match(/Circle\s+Drill:\s*([\d\.\-]+)/i);
    const connM = block.match(/Connections:[\s\S]*?(?:Trace|Shape):\s*\d+\s*\(([^)]+)\)/i);

    return Object.assign({
      id: itemNum,
      x: parseFloat(origM[1]),
      y: parseFloat(origM[2]),
      padstack: padM ? padM[1].trim() : 'UNKNOWN_PADSTACK',
      net: netM ? netM[1].trim() : '',
      drill: drillM ? parseFloat(drillM[1]) : 3.94,
      connectedLayers: connM ? connM[1].split(/\s+/).filter(Boolean) : []
    }, parseViaSpan(block));
  }

  /**
   * 解析 Trace 块
   */
  function parseTraceBlock(itemNum, block) {
    const subsetM = block.match(/(?:Subset|Layer):\s*([^\r\n]+)/i);
    const netM = block.match(/Net:\s*([^\r\n]+)/i);
    const lenM = block.match(/(?:Seg\s+Length|Length):\s*([\d\.\-]+)/i);
    const layer = subsetM ? subsetM[1].trim() : 'UNKNOWN_LAYER';
    const net = netM ? netM[1].trim() : 'UNNAMED_NET';

    const segments = [];
    let totalLen = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    function updateBBox(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const lines = block.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 1. 圆弧段 (Arc seg:)
      if (/^Arc\s+seg:/i.test(line)) {
        const nextLine = (i + 1 < lines.length) ? lines[i + 1] : '';
        const nextLine2 = (i + 2 < lines.length) ? lines[i + 2] : '';
        const fullArcText = line + ' ' + nextLine + ' ' + nextLine2;
        const am = fullArcText.match(/Arc\s+seg:\s*(?:xy\s*)?\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*(?:to\s*|\s*xy\s*)\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:\s*Width\s*\(\s*([\d\.\-]+)\s*\))?[\s\S]*?Center-xy:\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*Radius\s*\(\s*([\d\.\-]+)\s*\)(?:\s*(CCW|CW))?/i);
        if (am) {
          const x1 = parseFloat(am[1]), y1 = parseFloat(am[2]);
          const x2 = parseFloat(am[3]), y2 = parseFloat(am[4]);
          const width = am[5] ? parseFloat(am[5]) : 6.0;
          const cx = parseFloat(am[6]), cy = parseFloat(am[7]);
          const radius = parseFloat(am[8]);
          const dir = am[9] ? am[9].toUpperCase() : (fullArcText.includes('CW') && !fullArcText.includes('CCW') ? 'CW' : 'CCW');
          const len = Math.PI * radius * 0.5;
          totalLen += len;
          segments.push({ type: 'arc', x1, y1, x2, y2, cx, cy, radius, dir, width, len });
          updateBBox(x1, y1); updateBBox(x2, y2);
          updateBBox(cx - radius, cy - radius); updateBBox(cx + radius, cy + radius);
        }
      }
      // 2. 直线段 (Line seg:, Seg:, Segment:)
      else if (/^(?:Line\s+seg|Seg|Segment):/i.test(line)) {
        const lm = line.match(/(?:Line\s+seg|Seg|Segment):\s*(?:xy\s*)?\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]\s*(?:to\s*|\s*xy\s*)\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\](?:\s*Width\s*\(\s*([\d\.\-]+)\s*\))?/i);
        if (lm) {
          const x1 = parseFloat(lm[1]), y1 = parseFloat(lm[2]);
          const x2 = parseFloat(lm[3]), y2 = parseFloat(lm[4]);
          const width = lm[5] ? parseFloat(lm[5]) : 6.0;
          const len = dist2D(x1, y1, x2, y2);
          totalLen += len;
          segments.push({ type: 'line', x1, y1, x2, y2, width, len });
          updateBBox(x1, y1); updateBBox(x2, y2);
        }
      }
    }

    if (segments.length === 0) return null;

    return {
      id: itemNum,
      layer,
      net,
      segments,
      length: lenM ? parseFloat(lenM[1]) : totalLen,
      width: segments[0].width || 6.0,
      bbox: { minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY }
    };
  }

  return {
    SPECIAL_SHAPE_SETS: SPECIAL_SHAPE_SETS,
    normalizeSpecialShapeSet: normalizeSpecialShapeSet,
    expandLayerRange: expandLayerRange,
    parsePcbElements: parsePcbElements,
    parseShapeContours: parseShapeContours,
    parseShapeBlock: parseShapeBlock,
    composeShapeItems: composeShapeItems,
    shapeItemsTouch: shapeItemsTouch,
    findAssociatedShapeItems: findAssociatedShapeItems,
    buildShapePointIndexes: buildShapePointIndexes,
    parseViaBlock: parseViaBlock,
    parseTraceBlock: parseTraceBlock
  };
});
