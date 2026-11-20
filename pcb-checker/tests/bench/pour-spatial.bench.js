/* ============================================================================
 * pour-spatial.bench.js —— 36,781 Item 铜皮五项检查空间索引性能回归
 * 防止孔×铜皮、走线采样点×铜皮、孤铜×过孔重新退化为全量笛卡尔积。
 * ========================================================================== */
'use strict';

const assert = require('assert');
const Pour = require('../../packages/engines/pour');

const SHAPE_COUNT = 28000;
const VIA_COUNT = 8781;
const layers = ['Top', '02G01P', '03G02P', '04G03P', '05G04P'];
const lines = [`Total ${SHAPE_COUNT + VIA_COUNT} Items`];
let itemId = 1;

for (let i = 0; i < SHAPE_COUNT; i++) {
  const x = (i % 280) * 30;
  const y = Math.floor(i / 280) * 30;
  lines.push(
    `Item ${itemId++} < Shape >`,
    `  Subset: ${layers[i % layers.length]}`,
    '  Area: 452.0',
    'Exterior Boundary:',
    `  Arc seg: xy [${x - 12}, ${y}] xy [${x - 12}, ${y}]`,
    `    Center-xy: [${x}, ${y}] Radius (12) CCW`
  );
}
for (let i = 0; i < VIA_COUNT; i++) {
  const x = (i % 280) * 30;
  const y = Math.floor(i / 280) * 30;
  lines.push(
    `Item ${itemId++} < Via >`,
    `  Origin-xy: [${x}, ${y}]`,
    '  Net: TEST_N',
    '  Padstack Name: PERF_PROBE'
  );
}

const text = lines.join('\n');
const started = Date.now();
const result = Pour.runAllCopperChecks(text, {
  viaCoverageRules: [{ padstack: 'PERF_PROBE', layers: 'L1-L5', coverageRadius: 55 }],
  specialShapeTemplates: [],
  traceMarginRules: [],
  smallCopperAreaThreshold: 500,
  minArcRadius: 10
});
const elapsed = Date.now() - started;

assert.strictEqual(result.shapes.length, SHAPE_COUNT);
assert.strictEqual(result.vias.length, VIA_COUNT);
assert.strictEqual(result.results.all.filter(r => r.checkCategory === 'via_coverage').length, VIA_COUNT * 5);
assert.strictEqual(result.results.all.filter(r => r.checkCategory === 'isolated_copper').length, SHAPE_COUNT);
assert.ok(elapsed < 5000, `36,781 Item 铜皮检查耗时 ${elapsed} ms，超过 5 秒预算`);
console.log(`36,781 Item 空间索引基准通过：${(text.length / 1048576).toFixed(1)} MB / ${elapsed} ms / ${result.results.all.length} 条明细`);

// 用户实板的参考层单块 Shape 含 1,700+ 个反焊盘 Void；规则 3 不得对每个走线采样点遍历全部 Void。
const exterior = [
  { type: 'line', x1: 0, y1: 0, x2: 20000, y2: 0 },
  { type: 'line', x1: 20000, y1: 0, x2: 20000, y2: 1000 },
  { type: 'line', x1: 20000, y1: 1000, x2: 0, y2: 1000 },
  { type: 'line', x1: 0, y1: 1000, x2: 0, y2: 0 }
];
const voids = Array.from({ length: 1700 }, (_, i) => {
  const cx = 50 + (i % 200) * 95, cy = 40 + Math.floor(i / 200) * 30, radius = 4;
  return { boundary: [{
    type: 'arc', x1: cx + radius, y1: cy, x2: cx + radius, y2: cy,
    cx, cy, radius, ccw: true
  }] };
});
const voidHeavyShape = {
  id: 1, layer: 'L3', boundary: exterior, voids,
  bbox: { minX: 0, minY: 0, maxX: 20000, maxY: 1000 }
};
const longTrace = {
  id: 1, layer: 'L2', net: 'PERF_TRACE',
  segments: [{ type: 'line', x1: 10, y1: 600, x2: 19990, y2: 600, width: 10, len: 19980 }]
};
const traceStarted = Date.now();
const traceResult = Pour.checkTraceReferenceMargin([longTrace], [voidHeavyShape], [
  { traceLayer: 'L2', upperRefLayer: 'L3', minMargin: 100 }
]);
const traceElapsed = Date.now() - traceStarted;
assert.strictEqual(traceResult[0].pass, true);
assert.ok(traceElapsed < 2500, `1,700 Void 长走线检查耗时 ${traceElapsed} ms，超过 2.5 秒预算`);
assert.strictEqual(Object.keys(voidHeavyShape).includes('_voidRings'), false, '派生轮廓缓存不得进入 Worker 回传数据');
console.log(`1,700 Void 长走线索引基准通过：${traceElapsed} ms`);
