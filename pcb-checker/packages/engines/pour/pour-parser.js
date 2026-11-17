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
  function expandLayerRange(layerInput, availableLayers = []) {
    if (Array.isArray(layerInput)) {
      return layerInput.map(s => String(s).trim()).filter(Boolean);
    }
    if (!layerInput || typeof layerInput !== 'string') return [];

    const str = layerInput.trim();
    if (str === '*' || str.toUpperCase() === 'ALL' || str === '全部' || str === '全部层') {
      return availableLayers.length > 0 ? [...availableLayers] : ['Top', '02G01P', '08IS03', '19IS08', 'Bottom'];
    }

    // 检查范围表达式如 "L1-L5", "L1~L10", "1-10", "01-08"
    const rangeMatch = str.match(/^([a-zA-Z]*)(\d+)\s*(?:-|~|\.\.)\s*([a-zA-Z]*)(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1] || rangeMatch[3] || 'L';
      const startNum = parseInt(rangeMatch[2], 10);
      const endNum = parseInt(rangeMatch[4], 10);
      const minN = Math.min(startNum, endNum);
      const maxN = Math.max(startNum, endNum);
      const res = [];
      for (let i = minN; i <= maxN; i++) {
        res.push(`${prefix}${i}`);
      }
      return res;
    }

    // 普通逗号、分号、斜杠、空格分隔
    return str.split(/[,;\/\s，；、]+/).map(s => s.trim()).filter(Boolean);
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
      shape._ring = ring;
      const exteriorArea = polygonArea(ring);
      const exteriorCentroid = polygonCentroid(ring);
      let filledArea = exteriorArea;
      let centroidXMoment = exteriorCentroid.x * exteriorArea;
      let centroidYMoment = exteriorCentroid.y * exteriorArea;
      shape._voidRings = [];
      voids.forEach(voidContour => {
        const voidRing = flattenBoundary(voidContour.boundary);
        voidContour._ring = voidRing;
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

  /**
   * 解析 Via 块
   */
  function parseViaBlock(itemNum, block) {
    const origM = block.match(/(?:Origin-xy|Location|xy):\s*\[\s*([\d\.\-]+)\s*,\s*([\d\.\-]+)\s*\]/i);
    if (!origM) return null;

    const padM = block.match(/Padstack\s+Name:\s*([^\r\n]+)/i);
    const netM = block.match(/Net:\s*([^\r\n]+)/i);
    const drillM = block.match(/Circle\s+Drill:\s*([\d\.\-]+)/i);
    const connM = block.match(/Connections:[\s\S]*?(?:Trace|Shape):\s*\d+\s*\(([^)]+)\)/i);

    return {
      id: itemNum,
      x: parseFloat(origM[1]),
      y: parseFloat(origM[2]),
      padstack: padM ? padM[1].trim() : 'UNKNOWN_PADSTACK',
      net: netM ? netM[1].trim() : 'GND',
      drill: drillM ? parseFloat(drillM[1]) : 3.94,
      connectedLayers: connM ? connM[1].split(/\s+/).filter(Boolean) : []
    };
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
    expandLayerRange: expandLayerRange,
    parsePcbElements: parsePcbElements,
    parseShapeContours: parseShapeContours,
    parseShapeBlock: parseShapeBlock,
    parseViaBlock: parseViaBlock,
    parseTraceBlock: parseTraceBlock
  };
});
