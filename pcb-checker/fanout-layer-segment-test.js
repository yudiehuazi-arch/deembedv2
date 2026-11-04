/**
 * fanout-layer-segment-test.js
 * 盲埋孔分层俯视分解引擎单元测试
 *
 * 覆盖：层跨度解析（Padstack Defined / Connections / 名称后缀）、分界层自动建议、
 *       手改分界层、多数归属 + 平票靠前规则、带内残留叠孔（同网/异网）标注、
 *       与缩略图一致的画布变换、方案序列化往返。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FanoutChecker = require('./fanout-check.js');

const {
  FanoutScheme,
  parseMultiSchemeTxt,
  parseLayerIndexFromName,
  parseLayerSpanFromPadstackName,
  parseViaTextLayerSpan,
  parseViaLayerRange,
  suggestLayerCuts,
  normalizeLayerCuts,
  parseLayerCutsInput,
  buildLayerSegments,
  computeLayerSegmentViews,
  summarizeLayerSegments,
  detectViaOverlapPairs
} = FanoutChecker;

console.log('== 盲埋孔分层俯视分解引擎单元测试 ==');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name} -> ${err.message}`);
    fail++;
  }
}

const SAMPLE_PATH = path.join(__dirname, 'sample', '盲埋孔分层扇出示例.txt');

/* ---------------- 1. 层名解析 ---------------- */
test('叠层名解析：Top=1 / 10G07P=10 / 13G09P=13 / L12=12 / Bottom=9999', () => {
  assert.strictEqual(parseLayerIndexFromName('Top'), 1);
  assert.strictEqual(parseLayerIndexFromName('05G02P'), 5);
  assert.strictEqual(parseLayerIndexFromName('10G07P'), 10);
  assert.strictEqual(parseLayerIndexFromName('13G09P'), 13);
  assert.strictEqual(parseLayerIndexFromName('L12'), 12);
  assert.strictEqual(parseLayerIndexFromName('Layer_3'), 3);
  assert.strictEqual(parseLayerIndexFromName('Bottom'), 9999);
  assert.strictEqual(parseLayerIndexFromName('无层名'), null);
});

test('Padstack 名称尾部层跨度解析：_L1_L5 / _L5_L10 / _L10_11', () => {
  assert.deepStrictEqual(parseLayerSpanFromPadstackName('BGA-HDI-GND-045drill-ring3_L1_L5'), { start: 1, end: 5 });
  assert.deepStrictEqual(parseLayerSpanFromPadstackName('PTH-GND-150drill-ring0_L5_L10'), { start: 5, end: 10 });
  assert.deepStrictEqual(parseLayerSpanFromPadstackName('HDI-X_L10_11'), { start: 10, end: 11 });
  assert.strictEqual(parseLayerSpanFromPadstackName('SMA_Bot-L19_d2m6mil_via-0902'), null);
});

/* ---------------- 2. 过孔文本块层信息 ---------------- */
const VIA_BLOCK_50_10 = `
  Origin-xy:          [21499.9773, 34328.1417]
  Net:                GND
  Padstack Name:      PTH-GND-150drill-ring0_L5_L10
  Circle Drill:       6.0000 Plated

  Padstack Defined from 05G02P to 10G07P

  Connections:
    Shape:            6 (05G02P 06G03P 07G04P 08G05P 09G06P 10G07P)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;

const VIA_BLOCK_SIG = `
  Origin-xy:          [21512.5048, 34359.3701]
  Net:                33_N
  Padstack Name:      BGA-HDI-SIG-045drill-ring3_L10_L12
  Circle Drill:       4.5000 Plated

  Padstack Defined from 10G07P to 12IS02

  Connections:
    Shape:            1 (10G07P)
    Trace:            2 (10G07P 12IS02)
`;

test('过孔文本块解析：优先取 Padstack Defined from（L5–L10）', () => {
  const span = parseViaTextLayerSpan(VIA_BLOCK_50_10);
  assert.strictEqual(span.layerStart, 5);
  assert.strictEqual(span.layerEnd, 10);
  assert.strictEqual(span.layerSource, 'defined');
  assert.deepStrictEqual(span.layers, [5, 6, 7, 8, 9, 10]);
});

test('过孔文本块解析：信号孔取焊盘 Shape 层列表，不被 Trace 行干扰', () => {
  const span = parseViaTextLayerSpan(VIA_BLOCK_SIG);
  assert.strictEqual(span.layerStart, 10);
  assert.strictEqual(span.layerEnd, 12);
  assert.deepStrictEqual(span.layers, [10], '只取第一个 Shape 行的焊盘层，而非 Trace 层');
});

test('无 Padstack Defined 时回退到 Padstack 名称后缀', () => {
  const span = parseViaTextLayerSpan('Padstack Name: BGA-HDI-GND-045drill-ring3_L3_L5\nNet: GND\n');
  assert.strictEqual(span.layerStart, 3);
  assert.strictEqual(span.layerEnd, 5);
  assert.strictEqual(span.layerSource, 'padstack-name');
});

test('parseViaLayerRange：字段优先于名称，缺信息返回 null', () => {
  assert.deepStrictEqual(parseViaLayerRange({ layerStart: 2, layerEnd: 7, padstack: 'X_L1_L5' }), { start: 2, end: 7, source: 'field' });
  assert.deepStrictEqual(parseViaLayerRange({ padstack: 'X_L1_L5' }), { start: 1, end: 5, source: 'padstack-name' });
  assert.strictEqual(parseViaLayerRange({ padstack: 'STANDARD_VIA' }), null);
});

/* ---------------- 3. 分界层建议与规范化 ---------------- */
test('分界层自动建议：样例 43 孔 → [5, 10]', () => {
  const txt = fs.readFileSync(SAMPLE_PATH, 'utf8');
  const schemes = parseMultiSchemeTxt(txt, 0);
  assert.strictEqual(schemes.length, 1, '样例文件应解析出 1 套方案');
  assert.strictEqual(schemes[0].vias.length, 43, '样例方案应包含 43 个过孔');

  const scheme = new FanoutScheme(schemes[0]);
  assert.deepStrictEqual(suggestLayerCuts(scheme.vias), [5, 10]);
});

test('分界层输入解析与规范化：越界剔除 / 去重 / 排序 / 最多 3 个', () => {
  assert.deepStrictEqual(parseLayerCutsInput('5,10'), [5, 10]);
  assert.deepStrictEqual(parseLayerCutsInput('L5 / L10'), [5, 10]);
  assert.deepStrictEqual(parseLayerCutsInput(''), []);
  assert.deepStrictEqual(normalizeLayerCuts([10, 5, 5], 1, 13), [5, 10]);
  assert.deepStrictEqual(normalizeLayerCuts([1, 13], 1, 13), [], '边界层不可作为分界层');
  assert.deepStrictEqual(normalizeLayerCuts([2, 4, 6, 8], 1, 13), [2, 4, 6], '最多保留 3 个分界层');
});

test('层带定义：① L1–L4（不含 L5）② L5–L10（含两端）③ L11–L13（不含 L10）', () => {
  const segs = buildLayerSegments([5, 10], 1, 13);
  assert.strictEqual(segs.length, 3);
  assert.strictEqual(segs[0].rangeText, 'L1–L4');
  assert.strictEqual(segs[0].boundaryText, '不含 L5');
  assert.strictEqual(segs[1].rangeText, 'L5–L10');
  assert.strictEqual(segs[1].boundaryText, '含 L5 / L10');
  assert.strictEqual(segs[2].rangeText, 'L11–L13');
  assert.strictEqual(segs[2].boundaryText, '不含 L10');
  assert.deepStrictEqual(segs.map(s => s.marker), ['①', '②', '③']);
});

/* ---------------- 4. 样例全量分解 ---------------- */
function loadSampleScheme() {
  const txt = fs.readFileSync(SAMPLE_PATH, 'utf8');
  return new FanoutScheme(parseMultiSchemeTxt(txt, 0)[0]);
}

test('样例 43 孔分解：15 / 16 / 12，合计 43，无孔遗漏', () => {
  const scheme = loadSampleScheme();
  const view = computeLayerSegmentViews(scheme, { width: 110, height: 110 });

  assert.strictEqual(view.available, true);
  assert.deepStrictEqual(view.cutLayers, [5, 10]);
  assert.strictEqual(view.isAutoCuts, true, '未手改时应标记为自动建议');
  assert.strictEqual(view.layerMin, 1);
  assert.strictEqual(view.layerMax, 13);

  assert.strictEqual(view.segments.length, 3);
  assert.deepStrictEqual(view.segments.map(s => s.vias.length), [15, 16, 12]);
  assert.strictEqual(view.assignedCount, 43);
  assert.strictEqual(view.unassignedCount, 0);
  assert.strictEqual(
    view.segments.reduce((sum, s) => sum + s.vias.length, 0),
    view.totalVias,
    '三张分带图的孔数之和必须等于总孔数'
  );
});

test('样例分解后每张图内无孔重叠（整体俯视 30 处压盖全部被分开）', () => {
  const scheme = loadSampleScheme();
  const view = computeLayerSegmentViews(scheme, { width: 110, height: 110 });

  assert.ok(view.overlapPairs > 0, '整体俯视图应存在压盖（样例为 30 处）');
  assert.strictEqual(view.overlapPairs, 30);
  assert.strictEqual(view.sameNetOverlapPairs, 30, '样例整体压盖全部同网');
  assert.strictEqual(view.crossNetOverlapPairs, 0);

  view.segments.forEach(seg => {
    assert.strictEqual(seg.overlapPairs.length, 0, `${seg.marker} ${seg.rangeText} 内不应再有孔重叠`);
    assert.strictEqual(seg.crossNetOverlapCount, 0);
  });
  assert.strictEqual(view.residualOverlapPairs, 0);
});

test('归属规则：层跨度多数优先，平票归靠前层带', () => {
  const vias = [
    // L1–L5：A 带占 4 层(L1-L4)、B 带占 1 层(L5) -> A
    { id: 1, x: 0, y: 0, net: 'GND', padstack: 'X_L1_L5', drill: 4.5 },
    // L4–L5：A 带 1 层、B 带 1 层 -> 平票归靠前的 A
    { id: 2, x: 10, y: 0, net: 'GND', padstack: 'X_L4_L5', drill: 4.5 },
    // L5–L10：B 带 6 层 -> B
    { id: 3, x: 20, y: 0, net: 'GND', padstack: 'X_L5_L10', drill: 6 },
    // L11–L13：C 带 3 层 -> C
    { id: 4, x: 30, y: 0, net: 'SIG', padstack: 'X_L11_L13', drill: 4.5 }
  ];
  const view = computeLayerSegmentViews({ vias }, { width: 96, height: 96, cuts: [5, 10] });
  assert.strictEqual(view.isAutoCuts, false, '显式传入分界层时不应标记为自动');
  assert.deepStrictEqual(view.segments.map(s => s.vias.length), [2, 1, 1]);
  assert.deepStrictEqual(view.segments[0].vias.map(v => v.id), [1, 2]);
});

test('手改分界层生效：5,12 -> L5–L12 中段，孔数守恒', () => {
  const scheme = loadSampleScheme();
  scheme.layerCuts = [5, 12];
  // 不传 cuts 时自动读取方案上记住的手改分界层
  const view = computeLayerSegmentViews(scheme, { width: 96, height: 96 });

  assert.deepStrictEqual(view.cutLayers, [5, 12]);
  assert.strictEqual(view.isAutoCuts, false);
  assert.strictEqual(view.segments[1].rangeText, 'L5–L12');
  assert.strictEqual(view.segments.reduce((sum, s) => sum + s.vias.length, 0), 43);
  assert.strictEqual(view.unassignedCount, 0);
});

test('单分界层：2 张分解图', () => {
  const scheme = loadSampleScheme();
  const view = computeLayerSegmentViews(scheme, { width: 96, height: 96, cuts: [5] });
  assert.strictEqual(view.segments.length, 2);
  assert.deepStrictEqual(view.segments.map(s => s.rangeText), ['L1–L4', 'L5–L13']);
});

/* ---------------- 5. 带内残留叠孔标注 ---------------- */
test('同一层带内的同网叠孔：判为同网并保留标注（虚线提示，不静默）', () => {
  const vias = [
    { id: 1, x: 0, y: 0, net: 'GND', padstack: 'X_L5_L10', drill: 6 },
    { id: 2, x: 0.5, y: 0, net: 'GND', padstack: 'X_L6_L10', drill: 4.5 },
    { id: 3, x: 20, y: 0, net: 'GND', padstack: 'X_L5_L10', drill: 6 }
  ];
  const view = computeLayerSegmentViews({ vias }, { width: 96, height: 96, cuts: [5, 10] });
  assert.strictEqual(view.segments[1].vias.length, 3);
  assert.strictEqual(view.segments[1].overlapPairs.length, 1);
  assert.strictEqual(view.segments[1].overlapPairs[0].sameNet, true);
  assert.strictEqual(view.residualSameNetPairs, 1);
  assert.strictEqual(view.residualCrossNetPairs, 0);
  assert.ok(summarizeLayerSegments(view).includes('同网叠孔'));
});

test('同一层带内的异网叠孔：单独计数，摘要提示需复核', () => {
  const vias = [
    { id: 1, x: 0, y: 0, net: 'GND', padstack: 'X_L5_L10', drill: 6 },
    { id: 2, x: 0.5, y: 0, net: 'SIG_A', padstack: 'X_L6_L10', drill: 4.5 }
  ];
  const view = computeLayerSegmentViews({ vias }, { width: 96, height: 96, cuts: [5, 10] });
  assert.strictEqual(view.residualCrossNetPairs, 1);
  assert.strictEqual(view.segments[1].overlapPairs[0].sameNet, false);
  assert.ok(summarizeLayerSegments(view).includes('异网'));
});

test('detectViaOverlapPairs：圆心距 < 孔径和的一半才算压盖', () => {
  const sames = detectViaOverlapPairs([
    { x: 0, y: 0, drill: 6, net: 'GND' },
    { x: 4, y: 0, drill: 6, net: 'GND' },
    { x: 40, y: 0, drill: 6, net: 'GND' }
  ]);
  assert.strictEqual(sames.length, 1);
  assert.strictEqual(sames[0].i, 0);
  assert.strictEqual(sames[0].j, 1);
  assert.strictEqual(sames[0].sameNet, true);
});

/* ---------------- 6. 画布几何与摘要 ---------------- */
test('分带图与整体缩略图共用同一套归一化变换', () => {
  const scheme = loadSampleScheme();
  const W = 110;
  const view = computeLayerSegmentViews(scheme, { width: W, height: W });

  let expectedMaxSpan = 10;
  scheme.normalizedVias.forEach(v => {
    expectedMaxSpan = Math.max(expectedMaxSpan, Math.abs(v.nx), Math.abs(v.ny));
  });
  const expectedScale = (W * 0.38) / Math.max(expectedMaxSpan, 10);

  assert.strictEqual(view.transform.cx, W / 2);
  assert.strictEqual(view.transform.cy, W / 2);
  assert.ok(Math.abs(view.transform.scale - expectedScale) < 1e-9, '缩放必须与 drawSchemeThumbnail 一致');

  const first = view.segments[0].vias[0];
  const nv = scheme.normalizedVias[first.viaIndex];
  assert.ok(Math.abs(first.px - (W / 2 + nv.nx * expectedScale)) < 1e-9);
  assert.ok(Math.abs(first.py - (W / 2 - nv.ny * expectedScale)) < 1e-9);
});

test('摘要文案：分界层、各带孔数与「分解后无孔重叠」', () => {
  const view = computeLayerSegmentViews(loadSampleScheme(), { width: 96, height: 96 });
  const text = summarizeLayerSegments(view);
  assert.ok(text.includes('分界 L5 / L10'), text);
  assert.ok(text.includes('①L1–L4 15孔'), text);
  assert.ok(text.includes('②L5–L10 16孔'), text);
  assert.ok(text.includes('③L11–L13 12孔'), text);
  assert.ok(text.includes('分解后无孔重叠'), text);
});

/* ---------------- 7. 缺信息与序列化 ---------------- */
test('无层信息的方案不产出分解图（避免误报）', () => {
  const view = computeLayerSegmentViews({
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
      { id: 2, x: 20, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' }
    ]
  }, { width: 96, height: 96 });
  assert.strictEqual(view.available, false);
  assert.strictEqual(view.reason, 'no-layer-info');
  assert.strictEqual(view.segments.length, 0);
  assert.strictEqual(summarizeLayerSegments(view), '');
});

test('方案序列化往返：层跨度与手改分界层不丢', () => {
  const scheme = loadSampleScheme();
  scheme.layerCuts = [5, 10];
  const json = scheme.toJSON();
  assert.deepStrictEqual(json.layerCuts, [5, 10]);
  assert.strictEqual(json.vias[0].layerStart, 5);
  assert.strictEqual(json.vias[0].layerEnd, 10);

  const again = new FanoutScheme(json);
  assert.deepStrictEqual(again.layerCuts, [5, 10]);
  assert.strictEqual(again.vias[0].layerStart, 5);
  const view = computeLayerSegmentViews(again, { width: 96, height: 96 });
  assert.deepStrictEqual(view.segments.map(s => s.vias.length), [15, 16, 12]);
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
assert.strictEqual(fail, 0);
