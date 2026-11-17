/* ============================================================================
 * pour-ui-large.bench.js —— 25 MB 实板规模的定位与规律分析 UI 性能回归
 * 规模取自 data_via_shape.txt：7,272 Shape、29,509 Via、22,048 条异常。
 * ========================================================================== */
'use strict';

const assert = require('assert');
const { openPage } = require('../helpers/open-page');
const ctx = openPage('pour.html', { syncCheck: true });
const { w, d } = ctx;
const State = w.State;
const VIA_COUNT = 29509;
const SHAPE_COUNT = 7272;

State.vias = Array.from({ length: VIA_COUNT }, (_, i) => ({
  id: i + 1, x: (i % 300) * 30, y: Math.floor(i / 300) * 30,
  padstack: 'PERF_STACK', net: 'PERF_NET'
}));
State.shapes = Array.from({ length: SHAPE_COUNT }, (_, i) => {
  const x = (i % 200) * 40, y = Math.floor(i / 200) * 40;
  return { id: i + 1, layer: 'L1', area: 100, centroid: { x, y },
    bbox: { minX: x - 5, minY: y - 5, maxX: x + 5, maxY: y + 5 }, boundary: [], arcs: [] };
});
State.traces = [];
const isolated = Array.from({ length: 5235 }, (_, i) => ({
  checkCategory: 'isolated_copper', checkCategoryName: '④ 孤立小铜皮检查',
  shapeId: i + 1, layer: 'L1', area: 100 + (i % 300), areaThreshold: 500,
  centroid: State.shapes[i].centroid, pass: false
}));
const arcs = Array.from({ length: 16813 }, (_, i) => {
  const shape = State.shapes[i % SHAPE_COUNT];
  return { checkCategory: 'arc_radius', checkCategoryName: '⑤ 铜皮圆弧半径检查',
    shapeId: shape.id, layer: 'L1', actualRadius: 2 + (i % 7), requiredRadius: 10,
    centerCoord: [shape.centroid.x + (i % 3), shape.centroid.y], pass: false };
});
State.rawResults = isolated.concat(arcs);
State.groupedResults = [];
State.summary = {
  breakdown: { viaCoverageDefects: 0, specialShapeDefects: 0, traceMarginDefects: 0,
    smallCopperDefects: isolated.length, arcRadiusDefects: arcs.length },
  totalChecks: State.rawResults.length, totalDefects: State.rawResults.length,
  totalShapes: SHAPE_COUNT, totalVias: VIA_COUNT, totalTraces: 0
};

let started = Date.now();
w.renderAnalysisTab();
const analysisMs = Date.now() - started;
const analysisHtml = d.getElementById('pnlAnalysisContainer').innerHTML;
assert.ok(analysisMs < 1500, `规律分析耗时 ${analysisMs} ms，超过 1.5 秒预算`);
assert.ok(analysisHtml.length < 500000, `规律分析 HTML ${analysisHtml.length} 字节，聚合失效`);
assert.strictEqual(d.querySelectorAll('.pour-defect-summary-table tbody tr').length, 2);
assert.strictEqual(d.querySelector('.pour-defect-board-canvas').getAttribute('data-all-via-count'), String(VIA_COUNT));

const canvas = d.getElementById('mainCanvas');
const noop = () => {};
canvas.width = 1200; canvas.height = 680;
canvas.getContext = () => ({
  clearRect: noop, fillRect: noop, save: noop, restore: noop, beginPath: noop,
  moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop,
  strokeRect: noop, drawImage: noop, arc: noop, fillText: noop, setLineDash: noop,
  measureText: () => ({ width: 0 })
});
Object.assign(State.canvas, { zoom: 5.5, panX: 600, panY: 340, shapeLayerMode: 'layer',
  visibleShapeLayers: ['L1'], showShapes: true, showVias: true, showTraces: true,
  showPorts: true, showDefects: true, defectFilter: 'all', measurePoints: [] });
started = Date.now();
w.renderCanvas();
const firstLocateRenderMs = Date.now() - started;
started = Date.now();
w.renderCanvas();
const cachedLocateRenderMs = Date.now() - started;
assert.ok(firstLocateRenderMs < 1000, `首次定位绘制耗时 ${firstLocateRenderMs} ms，超过 1 秒预算`);
assert.ok(cachedLocateRenderMs < 150, `缓存后定位绘制耗时 ${cachedLocateRenderMs} ms，超过 150 ms 预算`);

console.log(`25 MB 实板规模 UI 基准通过：规律分析 ${analysisMs} ms / 首次定位 ${firstLocateRenderMs} ms / 缓存定位 ${cachedLocateRenderMs} ms / HTML ${Math.round(analysisHtml.length / 1024)} KB`);
ctx.close();
