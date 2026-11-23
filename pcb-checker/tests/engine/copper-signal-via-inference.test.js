/* SIG 盲埋孔段合并、差分中心距和完整层跨约束推算回归 */
'use strict';
const C = require('../../packages/engines/copper');
const KS = require('../../packages/engines/copper/route-keepout-shape.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
function assert(ok, msg) { if (!ok) throw new Error(msg); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || '') + ': ' + a + ' != ' + b); }
const mil = mm => mm / C.MM_PER_MIL;

console.log('== 约束检查：SIG 完整孔组与差分孔距推算 ==');

const pParts = [
  { id: 1, type: 'via', origin: [0, 0], net: 'DP_P', padstack: 'BGA-HDI-SIG_L2_L5', traceLayers: ['L2', 'L5'] },
  { id: 2, type: 'via', origin: [mil(0.075), 0], net: 'DP_P', padstack: 'PTH-SIG_L5_L10', traceLayers: ['L5', 'L10'] },
  { id: 3, type: 'via', origin: [0, 0], net: 'DP_P', padstack: 'BGA-HDI-SIG_L10_L12', traceLayers: ['L10', 'L12'] }
];
const nParts = [
  { id: 4, type: 'via', origin: [mil(0.600), 0], net: 'DP_N', padstack: 'BGA-HDI-SIG_L2_L5', traceLayers: ['L2', 'L5'] },
  { id: 5, type: 'via', origin: [mil(0.525), 0], net: 'DP_N', padstack: 'PTH-SIG_L5_L10', traceLayers: ['L5', 'L10'] },
  { id: 6, type: 'via', origin: [mil(0.600), 0], net: 'DP_N', padstack: 'BGA-HDI-SIG_L10_L12', traceLayers: ['L10', 'L12'] }
];
const nonSig = { id: 7, type: 'via', origin: [100, 100], net: 'GND', padstack: 'BGA_GND_L2_L12', traceLayers: [] };
const shapes = [
  { id: 20, type: 'shape', circle: true, center: pParts[0].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L2', head: 'Route Keepout' },
  { id: 21, type: 'shape', circle: true, center: pParts[1].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L5', head: 'Route Keepout' },
  { id: 22, type: 'shape', circle: true, center: pParts[2].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L12', head: 'Route Keepout' },
  { id: 23, type: 'shape', circle: true, center: pParts[0].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L5', head: 'Route Keepout' },
  { id: 24, type: 'shape', circle: true, center: pParts[0].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'Top', head: 'Route Keepout' },
  { id: 25, type: 'shape', circle: true, center: pParts[2].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'Bottom', head: 'Route Keepout' },
  { id: 26, type: 'shape', circle: true, center: pParts[1].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L10', head: 'Route Keepout' },
  { id: 27, type: 'shape', circle: true, center: pParts[2].origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L10', head: 'Route Keepout' },
  { id: 30, type: 'shape', circle: true, center: nonSig.origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L2', head: 'Route Keepout' },
  { id: 31, type: 'shape', circle: true, center: pParts[0].origin.slice(), radius: 5, set: 'Shape', subset: 'L2', head: 'Regular Pad' }
];
const sets = [0.5, 0.6, 0.7].map(pitch => ({
  kind: 'BGA', title: `BGA-L2-L12-${pitch}mm`,
  constraints: [
    { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '10', L2: '10', L3: '10', L4: '10', L5: '10', L6: '10', L7: '10', L8: '10', L9: '10', L10: '10', L11: '10', L12: '10', L13: '10', L14: '10' } },
    { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L2: '5' } }
  ]
}));
const result = C.runCopperCheck([...pParts, ...nParts, nonSig, ...shapes], sets, { layerCount: 14, posTol: 0.05, valTol: 0.01 });
const pGroup = result.groups.find(g => g.via.net === 'DP_P');
const nGroup = result.groups.find(g => g.via.net === 'DP_N');
const gndGroup = result.groups.find(g => g.via.net === 'GND');

t('0.075mm 错位的三个同网络孔段按连通关系合并为一个完整孔', () => {
  assert(pGroup && pGroup.vias.length === 3, JSON.stringify(pGroup && pGroup.via));
  assert(pGroup.via.id === '1/2/3', '组合孔号=' + pGroup.via.id);
  assert(pGroup.startLayer === 2 && pGroup.endLayer === 12, '完整层跨=' + pGroup.startLayer + '-' + pGroup.endLayer);
  assert(pGroup.sourceSegments.map(part => `${part.viaId}:${part.spanText}`).join('|') === '1:L2-L5|2:L5-L10|3:L10-L12', JSON.stringify(pGroup.sourceSegments));
});

t('孔段中心距仅命中 0/0.025/0.075/0.125/0.175mm ±0.005mm 才合并', () => {
  assert(C.isSegmentDistance([0, 0], [mil(0.075 + 0.0049), 0]), '容差内应命中');
  assert(!C.isSegmentDistance([0, 0], [mil(0.050), 0]), '0.050mm 不在离散距离集合内');
  assert(!C.isSegmentDistance([0, 0], [mil(0.181), 0]), '超过 0.175+0.005mm 不应命中');
});

t('差分完整孔吸收相邻 GND 命名孔段，同时逐 Via 报 Padstack 命名不符合', () => {
  const namingItems = [
    { id: 50, type: 'via', origin: [0, 0], net: '21_P', padstack: 'BGA-HDI-SIG_L2_L5', traceLayers: [] },
    { id: 51, type: 'via', origin: [mil(0.175), 0], net: '21_P', padstack: 'PTH-SIG_L5_L10', traceLayers: [] },
    { id: 52, type: 'via', origin: [0, 0], net: '21_P', padstack: 'BGA-HDI-GND_L10_L12', traceLayers: [] },
    { id: 59, type: 'via', origin: [0, 0], net: '21_P', padstack: 'BGA-HDI-PWR_L12_L14', traceLayers: [] },
    { id: 53, type: 'via', origin: [mil(0.8), 0], net: '21_N', padstack: 'BGA-HDI-SIG_L2_L5', traceLayers: [] },
    { id: 54, type: 'via', origin: [mil(0.625), 0], net: '21_N', padstack: 'PTH-SIG_L5_L10', traceLayers: [] },
    { id: 55, type: 'via', origin: [mil(0.8), 0], net: '21_N', padstack: 'BGA-HDI-SIG_L10_L12', traceLayers: [] },
    { id: 56, type: 'via', origin: [100, 0], net: 'GND', padstack: 'BGA-HDI-GND_L10_L12', traceLayers: [] },
    { id: 57, type: 'via', origin: [200, 0], net: 'AUX', padstack: 'BGA-HDI-PWR_L10_L12', traceLayers: [] },
    { id: 58, type: 'via', origin: [300, 0], net: 'AUX2', padstack: 'BGA-HDI-SIG-GND_L10_L12', traceLayers: [] }
  ];
  const rule = { kind: 'BGA', title: 'BGA-L2-L12-0.8mm', constraints: [] };
  const out = C.runCopperCheck(namingItems, [rule], { layerCount: 14 });
  const signal = out.groups.find(g => g.via.net === '21_P');
  const adjacentPower = out.groups.find(g => String(g.via.id) === '59');
  const ground = out.groups.find(g => String(g.via.id) === '56');
  const missingSig = out.groups.find(g => String(g.via.id) === '57');
  const containsGnd = out.groups.find(g => String(g.via.id) === '58');
  assert(signal && signal.via.id === '50/51/52' && signal.startLayer === 2 && signal.endLayer === 12, JSON.stringify(signal && signal.via));
  assert(signal.rule && signal.rule.title === rule.title, signal.rule && signal.rule.title);
  assert(signal.namingError === 'Via 52：未包含 SIG；包含 GND', signal.namingError);
  assert(signal.failRows.length === 1 && signal.failRows[0].sourceViaIds.join('/') === '52', JSON.stringify(signal.failRows));
  assert(signal.failRows[0].sourcePadstack === 'BGA-HDI-GND_L10_L12', signal.failRows[0].sourcePadstack);
  assert(adjacentPower && !adjacentPower.signal && String(adjacentPower.via.id) === '59', JSON.stringify(adjacentPower && adjacentPower.via));
  assert(ground && !ground.namingError && ground.failCount === 0, JSON.stringify(ground));
  assert(missingSig.namingError === 'Via 57：未包含 SIG' && missingSig.failCount === 1, missingSig.namingError);
  assert(containsGnd.namingError === 'Via 58：包含 GND' && containsGnd.failCount === 1, containsGnd.namingError);
});

t('GND 网络即使 Padstack 含 SIG 也不进入信号约束推算', () => {
  const via = { id: 60, type: 'via', origin: [150, 0], net: 'GND', padstack: 'BGA-HDI-SIG_L2_L5', traceLayers: [] };
  const out = C.runCopperCheck([via], sets, { layerCount: 14 });
  const group = out.groups.find(g => String(g.via.id) === '60');
  assert(group && !group.signal && !group.rule && group.failCount === 0, JSON.stringify(group));
  assert(group.note === 'GND 网络：仅显示，不推算信号约束，不执行核查', group.note);
});

t('按 _P/_N 配对后只用 HDI 激光孔中心计算 0.600mm，排除偏移 PTH', () => {
  assert(pGroup.mateNet === 'DP_N' && nGroup.mateNet === 'DP_P', pGroup.mateNet + '/' + nGroup.mateNet);
  near(pGroup.pitchMm, 0.6, 1e-9, 'P/N HDI 中心距');
  assert(pGroup.pitchMode === 'HDI', '孔距模式=' + pGroup.pitchMode);
  assert(pGroup.pitchViaIds.join('/') === '1/3' && pGroup.matePitchViaIds.join('/') === '4/6', JSON.stringify(pGroup.pitchViaIds));
  assert(pGroup.note.includes('HDI 激光孔中心距 0.600 mm') && pGroup.note.includes('Via 1、3 ↔ Via 4、6'), pGroup.note);
});

t('同封装与完整层跨下选择中心距最近的 BGA-L2-L12-0.6mm 约束', () => {
  assert(pGroup.rule && pGroup.rule.title === 'BGA-L2-L12-0.6mm', pGroup.rule && pGroup.rule.title);
  assert(nGroup.rule && nGroup.rule.title === 'BGA-L2-L12-0.6mm', nGroup.rule && nGroup.rule.title);
});

t('完整孔读取各孔段同心位置的全部 Route Keepout，不按 Padstack 层跨裁掉 Shape', () => {
  const real = pGroup.rows.filter(r => !r.missing && !r.isPadstackCheck);
  assert(real.length === 8, '配对 Route Keepout=' + real.length);
  assert(real.every(r => r.status === '符合'), real.map(r => `${r.layer}:${r.status}`).join(','));
  assert(real.some(r => r.layer === 1 && r.shapeId === 24) && real.some(r => r.layer === 14 && r.shapeId === 25), '同心 Top/Bottom Shape 未纳入');
  assert(!result.unmatchedCircles.some(s => s.id === 24 || s.id === 25), '同心层跨外 Shape 不应保持未配对');
});

t('尺寸检查只读取 Set=Route Keepout，其他 Shape 与焊盘规则都不进入结果', () => {
  assert(result.circleCount === 9, 'Route Keepout 数量=' + result.circleCount);
  assert(!pGroup.rows.some(r => r.shapeId === 31 || r.checkType === '焊盘尺寸'), JSON.stringify(pGroup.rows));
  assert(!result.unmatchedCircles.some(shape => shape.id === 31), '非 Route Keepout 不应进入未配对列表');
});

t('标准长圆形按两个圆弧中心配对，只检查形状和两端圆弧半径', () => {
  const txt = `Item 100 < Shape >
  Set: Route Keepout
  Subset: 05IS02
  Type: Shape(Static)
Exterior Boundary:
  Seg: xy [4102.95, 4041.55]  xy [4126.57, 4041.55] Width (0.00)
  Arc seg: xy [4126.57, 4041.55]  xy [4126.57, 4015.55] Width (0.00)
    Center-xy: [4126.57, 4028.55] Radius (13.00) CW
  Seg: xy [4126.57, 4015.55]  xy [4102.95, 4015.55] Width (0.00)
  Arc seg: xy [4102.95, 4015.55]  xy [4102.95, 4041.55] Width (0.00)
    Center-xy: [4102.95, 4028.55] Radius (13.00) CW
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 101 < Via >
  Origin-xy: [4126.57, 4028.55]
  Net: CHANGE_A
  Padstack Name: VIAOR40DOR15F_D6MIL
  Connections:
    Trace: 2 (05IS02 07IS03)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 102 < Via >
  Origin-xy: [4102.95, 4028.55]
  Net: CHANGE_B
  Padstack Name: VIAOR40DOR15F_D6MIL
  Connections:
    Trace: 2 (05IS02 07IS03)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const items = C.parseBoardItems(txt);
  const shape = items.find(item => item.id === 100);
  assert(shape.obround && !shape.circle && shape.shapeKind === '长圆形', JSON.stringify(shape));
  assert(shape.arcRadii.join('/') === '13/13' && shape.matchingCenters.length === 2, JSON.stringify(shape));
  const rule = { kind: '其他', title: 'L5-L7', matchMode: 'connections-trace-layers', constraints: [
    { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L5: '13' } },
    { cat: '反焊盘形状', name: '反焊盘形状', unit: '', values: { L5: '长圆形' } }
  ] };
  const out = C.runCopperCheck(items, [rule], { layerCount: 7, posTol: 0.05, valTol: 0.01 });
  assert(out.circleCount === 1 && out.groups.length === 2, JSON.stringify(out.groups.map(g => g.via.id)));
  out.groups.forEach(group => {
    const row = group.rows.find(r => r.shapeId === 100);
    assert(row && row.status === '符合' && row.shapeKind === '长圆形' && row.expectedShape === '长圆形', JSON.stringify(row));
    assert(row.actualText === '长圆形 · 圆弧半径 13 / 13 mil', row.actualText);
  });
  rule.constraints[1].values.L5 = '圆形';
  const mismatch = C.runCopperCheck(items, [rule], { layerCount: 7, posTol: 0.05, valTol: 0.01 }).groups[0].rows.find(r => r.shapeId === 100);
  assert(mismatch.status === '不符合' && mismatch.reason.includes('形状应为圆形，实际为长圆形'), JSON.stringify(mismatch));
});

t('两端半圆拆成四条连续 Arc seg 时仍按长圆形配对，不误报无铜皮', () => {
  const txt = `Item 43 < Shape >
  Set: Route Keepout
  Subset: 27V08P
  Type: Shape(Static)
Exterior Boundary:
  Seg: xy [8015.15, 4041.55]  xy [8038.77, 4041.55] Width (0.00)
  Arc seg: xy [8038.77, 4041.55]  xy [8051.77, 4028.55] Width (0.00)
    Center-xy: [8038.77, 4028.55] Radius (13.00) CW
  Arc seg: xy [8051.77, 4028.55]  xy [8038.77, 4015.55] Width (0.00)
    Center-xy: [8038.77, 4028.55] Radius (13.00) CW
  Seg: xy [8038.77, 4015.55]  xy [8015.15, 4015.55] Width (0.00)
  Arc seg: xy [8015.15, 4015.55]  xy [8002.15, 4028.55] Width (0.00)
    Center-xy: [8015.15, 4028.55] Radius (13.00) CW
  Arc seg: xy [8002.15, 4028.55]  xy [8015.15, 4041.55] Width (0.00)
    Center-xy: [8015.15, 4028.55] Radius (13.00) CW
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 143 < Via >
  Origin-xy: [8015.15, 4028.55]
  Net: SPLIT_A
  Padstack Name: VIAOR40DOR15F_D6MIL
  Connections:
    Trace: 2 (27V08P 38IS12)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 144 < Via >
  Origin-xy: [8038.77, 4028.55]
  Net: SPLIT_B
  Padstack Name: VIAOR40DOR15F_D6MIL
  Connections:
    Trace: 2 (27V08P 38IS12)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const items = C.parseBoardItems(txt);
  const shape = items.find(item => item.id === 43);
  assert(shape.obround && shape.arcShape && shape.shapeKind === '长圆形', JSON.stringify(shape));
  assert(shape.shapeBoundary.arcs.length === 4, JSON.stringify(shape.shapeBoundary));
  assert(shape.arcRadii.join('/') === '13/13' && shape.matchingCenters.length === 2, JSON.stringify(shape));
  const oneSplitText = txt.replace(`  Arc seg: xy [8038.77, 4041.55]  xy [8051.77, 4028.55] Width (0.00)
    Center-xy: [8038.77, 4028.55] Radius (13.00) CW
  Arc seg: xy [8051.77, 4028.55]  xy [8038.77, 4015.55] Width (0.00)
    Center-xy: [8038.77, 4028.55] Radius (13.00) CW`, `  Arc seg: xy [8038.77, 4041.55]  xy [8038.77, 4015.55] Width (0.00)
    Center-xy: [8038.77, 4028.55] Radius (13.00) CW`);
  const oneSplit = C.parseBoardItems(oneSplitText).find(item => item.id === 43);
  assert(oneSplit.obround && oneSplit.shapeBoundary.arcs.length === 3 && oneSplit.arcRadii.join('/') === '13/13', JSON.stringify(oneSplit));
  const rule = { kind: '其他', title: 'L27-L38', matchMode: 'connections-trace-layers', constraints: [
    { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L27: '13' } },
    { cat: '反焊盘形状', name: '反焊盘形状', unit: '', values: { L27: '长圆形' } }
  ] };
  const out = C.runCopperCheck(items, [rule], { layerCount: 38, posTol: 0.05, valTol: 0.01 });
  assert(out.circleCount === 1 && out.groups.length === 2, JSON.stringify(out.groups.map(g => g.via.id)));
  out.groups.forEach(group => {
    const row = group.rows.find(r => r.shapeId === 43);
    assert(row && !row.missing && row.status === '符合', JSON.stringify(row));
    assert(row.shapeKind === '长圆形' && row.actualText === '长圆形 · 圆弧半径 13 / 13 mil', JSON.stringify(row));
  });

  const malformed = C.parseBoardItems(txt.replace(
    'Center-xy: [8038.77, 4028.55] Radius (13.00) CW',
    'Center-xy: [8039.77, 4028.55] Radius (13.00) CW'
  )).find(item => item.id === 43);
  assert(!malformed.obround && !malformed.arcShape && malformed.shapeKind === '其他圆弧', JSON.stringify(malformed));
  const winding = C.parseBoardItems(txt.split('[8051.77, 4028.55]').join('[8025.77, 4028.55]')).find(item => item.id === 43);
  assert(!winding.obround && winding.shapeKind === '其他圆弧', '同心但总弧度不是半圆的任意多圆弧轮廓不得误判成长圆形');
});

t('同层同心且完全包围的多个 Route Keepout 合并后取最大半径', () => {
  const txt = `Item 3415 < Shape >
  Set: Route Keepout
  Subset: 34G15P
  Type: Shape(Static)
Exterior Boundary:
  Arc seg: xy [482.00, 500.00]  xy [482.00, 500.00] Width (0.00)
    Center-xy: [500.00, 500.00] Radius (18.00) CCW
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 3416 < Shape >
  Set: Route Keepout
  Subset: 34G15P
  Type: Shape(Static)
Exterior Boundary:
  Arc seg: xy [487.00, 500.00]  xy [487.00, 500.00] Width (0.00)
    Center-xy: [500.00, 500.00] Radius (13.00) CCW
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 3417 < Shape >
  Set: Route Keepout
  Subset: 35IS16
  Type: Shape(Static)
Exterior Boundary:
  Arc seg: xy [488.00, 500.00]  xy [488.00, 500.00] Width (0.00)
    Center-xy: [500.00, 500.00] Radius (12.00) CCW
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 37199 < Via >
  Origin-xy: [500.00, 500.00]
  Net: MERGE_RKO
  Padstack Name: VIAOR375DOR125F-27-B
  Connections:
    Trace: 2 (27V08P 42IS21)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const items = C.parseBoardItems(txt);
  const rule = { kind: '其他', title: 'L27-L42', matchMode: 'connections-trace-layers', constraints: [
    { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L34: '18', L35: '12' } },
    { cat: '反焊盘形状', name: '反焊盘形状', unit: '', values: { L34: '圆形', L35: '圆形' } }
  ] };
  const out = C.runCopperCheck(items, [rule], { layerCount: 42, posTol: 0.05, valTol: 0.01 });
  const group = out.groups.find(g => String(g.via.id) === '37199');
  assert(group, JSON.stringify(out.groups.map(g => g.via.id)));
  const realRows = group.rows.filter(row => !row.missing && !row.isPadstackCheck);
  assert(out.circleCount === 3 && out.unmatchedCircles.length === 0, JSON.stringify(out.unmatchedCircles));
  assert(realRows.length === 2, JSON.stringify(realRows));
  const l34 = realRows.find(row => row.layer === 34), l35 = realRows.find(row => row.layer === 35);
  assert(l34.shapeId === 3415 && l34.actual === 18 && l34.status === '符合', JSON.stringify(l34));
  assert(l34.mergedShapeIds.join('/') === '3415/3416', JSON.stringify(l34));
  assert(l34.actualText === '圆形 · 圆弧半径 18 mil（同层同心合并 2 个 Route Keepout，取最大半径）', l34.actualText);
  assert(l35.shapeId === 3417 && l35.mergedShapeIds.join('/') === '3417' && !l35.actualText.includes('合并'), JSON.stringify(l35));
  assert(group.failCount === 0, JSON.stringify(group.failRows));

  const outer = items.find(item => item.id === 3415);
  const crossing = {
    id: 3420, type: 'shape', subset: '34G15P', circle: false, obround: true, arcShape: true,
    shapeKind: '长圆形', center: [500, 500], matchingCenters: [[490, 500], [510, 500]], radius: 13, arcRadii: [13, 13]
  };
  assert(KS.collapseCoincident([outer, crossing], () => 34, 0.05).length === 2,
    '同层同心但没有完全包围的轮廓不得合并');
});

t('L5/L10 交界层的每条 Route Keepout 只追溯实际所在孔段', () => {
  [
    { layer: 5, hdiPad: 'BGA-HDI-SIG_L2_L5', hdiVia: '1' },
    { layer: 10, hdiPad: 'BGA-HDI-SIG_L10_L12', hdiVia: '3' }
  ].forEach(({ layer, hdiPad, hdiVia }) => {
    const rows = pGroup.rows.filter(r => r.layer === layer && !r.missing);
    assert(rows.length === 2 && rows.every(r => r.checkType === '反焊盘尺寸'), JSON.stringify(rows));
    const byPad = Object.fromEntries(rows.map(r => [r.sourcePadstack, r]));
    assert(byPad[hdiPad] && byPad[hdiPad].sourceViaIds.join('/') === hdiVia, JSON.stringify(rows));
    assert(byPad['PTH-SIG_L5_L10'] && byPad['PTH-SIG_L5_L10'].sourceViaIds.join('/') === '2', JSON.stringify(rows));
  });
});

t('逐层来源严格取覆盖本层的孔段，不向最近端点越层借用', () => {
  const l3 = pGroup.rows.find(r => r.layer === 3);
  const l6 = pGroup.rows.find(r => r.layer === 6);
  const l11 = pGroup.rows.find(r => r.layer === 11);
  assert(l3.sourcePadstack === 'BGA-HDI-SIG_L2_L5' && l3.sourceViaSpans === 'Via 1 · L2-L5', JSON.stringify(l3));
  assert(l6.sourcePadstack === 'PTH-SIG_L5_L10' && l6.sourceViaSpans === 'Via 2 · L5-L10', JSON.stringify(l6));
  assert(l11.sourcePadstack === 'BGA-HDI-SIG_L10_L12' && l11.sourceViaSpans === 'Via 3 · L10-L12', JSON.stringify(l11));
});

t('14 层叠层逐层全检，同心层跨外 Shape 使用最近物理孔段作为来源', () => {
  const geometryRows = pGroup.rows.filter(r => !r.isPadstackCheck);
  for (let layer = 1; layer <= 14; layer++) {
    assert(geometryRows.some(r => r.layer === layer), '结果缺少 L' + layer);
  }
  const sparse = geometryRows.find(r => r.layer === 3);
  assert(sparse && sparse.missing && sparse.status === '不符合', JSON.stringify(sparse));
  assert(sparse.actual === '无铜皮' && sparse.expect === '10', JSON.stringify(sparse));
  assert(sparse.sourcePadstack === 'BGA-HDI-SIG_L2_L5' && sparse.sourceViaIds.join('/') === '1', JSON.stringify(sparse));
  const top = geometryRows.find(r => r.shapeId === 24), bottom = geometryRows.find(r => r.shapeId === 25);
  assert(top && top.layer === 1 && top.sourceViaIds.join('/') === '1' && top.sourcePadstack === 'BGA-HDI-SIG_L2_L5', JSON.stringify(top));
  assert(bottom && bottom.layer === 14 && bottom.sourceViaIds.join('/') === '3' && bottom.sourcePadstack === 'BGA-HDI-SIG_L10_L12', JSON.stringify(bottom));
  const l13 = geometryRows.find(r => r.layer === 13);
  assert(l13 && l13.missing && l13.status === '不符合' && !l13.sourceViaIds.length, JSON.stringify(l13));
});

t('不含 SIG 的过孔保留显示，但不推算约束且配对 Keepout 为未检查', () => {
  assert(gndGroup && !gndGroup.signal && !gndGroup.rule, '非 SIG 状态错误');
  assert(gndGroup.rows.length === 1 && gndGroup.rows[0].status === '未检查', JSON.stringify(gndGroup.rows));
  assert(gndGroup.note.includes('仅显示'), gndGroup.note);
});

t('单个 SIG 孔也可按 Top=L1、Bot=L14 与层跨推算约束', () => {
  const oneP = { id: 40, type: 'via', origin: [0, 0], net: 'S_P', padstack: 'SMA_SIG_TOP_L4', traceLayers: [] };
  const oneN = { id: 41, type: 'via', origin: [mil(0.5), 0], net: 'S_N', padstack: 'SMA_SIG_TOP_L4', traceLayers: [] };
  const oneSet = { kind: 'SMA', title: 'SMA-Top-L4-0.5mm', constraints: [] };
  const out = C.runCopperCheck([oneP, oneN], [oneSet], { layerCount: 14 });
  assert(out.groups[0].vias.length === 1, '单孔被错误合并');
  assert(out.groups[0].startLayer === 1 && out.groups[0].endLayer === 4, 'Top 层跨错误');
  assert(out.groups[0].rule && out.groups[0].rule.title === oneSet.title, '单孔未推算约束');
  assert(out.groups[0].pitchMode === 'group', '无 HDI 时未回退完整孔中心');
  const botSpan = C.spanOfVia({ padstack: 'SMA_SIG_BOT_L11' }, 14);
  assert(botSpan.start === 11 && botSpan.end === 14, 'Bot 未映射 L14');
});

t('解析 Padstack Defined from/to 作为名称层号不足时的层跨后备', () => {
  const txt = `Item 1 < Via >\n Origin-xy: [1, 2]\n Net: X_P\n Padstack Name: BGA_SIG\n Padstack Defined from <L2> to <L12>\n~~~~~~~~`;
  const via = C.parseBoardItems(txt)[0];
  const span = C.spanOfVia(via, 14);
  assert(via.padstackStart === 'L2' && via.padstackEnd === 'L12', JSON.stringify(via));
  assert(span.start === 2 && span.end === 12, JSON.stringify(span));
});

t('未标 BGA/SMA 的换层 SIG Via 按“其他”类型和完整层跨匹配用户命名约束', () => {
  const genericP = { id: 65, type: 'via', origin: [0, 0], net: 'CHANGE_P', padstack: 'CHANGE-SIG_L3_L29', traceLayers: [] };
  const genericN = { id: 66, type: 'via', origin: [mil(0.5), 0], net: 'CHANGE_N', padstack: 'CHANGE-SIG_L3_L29', traceLayers: [] };
  const genericSet = { kind: '其他', title: 'L3-L29', constraints: [] };
  const out = C.runCopperCheck([genericP, genericN], [genericSet], { layerCount: 44 });
  assert(out.groups.length === 2 && out.groups.every(g => g.rule && g.rule.title === 'L3-L29'),
    JSON.stringify(out.groups.map(g => g.rule && g.rule.title)));
});

t('换层孔命名表只按 Connections Trace 双层选约束，不要求 Padstack 含 SIG 且不检查其命名', () => {
  const raw = id => `Item ${id} < Via >\n Origin-xy: [${id * 10}, 0]\n Net: CHANGE_${id}\n Padstack Name: VIAOR40DOR15F_D6MIL\n Connections:\n  Trace:            2 (07IS03 33IS10)\n~~~~~~~~`;
  const unmatchedRaw = `Item 69 < Via >\n Origin-xy: [690, 0]\n Net: CHANGE_69\n Padstack Name: VIAOR40DOR15F_D6MIL\n Connections:\n  Trace:            2 (08IS03 33IS10)\n~~~~~~~~`;
  const rules = [
    { kind: '其他', title: 'L3-L29', matchMode: 'connections-trace-layers', constraints: [] },
    { kind: '其他', title: 'L7-L33', matchMode: 'connections-trace-layers', constraints: [
      { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '16' } }
    ] }
  ];
  const vias = C.parseBoardItems(raw(67) + '\n' + unmatchedRaw);
  const keepout = { id: 670, type: 'shape', circle: true, center: vias[0].origin.slice(), radius: 16, set: 'Route Keepout', subset: 'Top', head: 'Route Keepout' };
  assert(vias[0].traceConnected && vias[0].traceLayers.join('/') === '07IS03/33IS10', JSON.stringify(vias[0].traceLayers));
  const out = C.runCopperCheck(vias.concat(keepout), rules, { layerCount: 44 });
  const matched = out.groups.find(g => String(g.via.id) === '67');
  const unmatched = out.groups.find(g => String(g.via.id) === '69');
  assert(matched.signal && matched.rule && matched.rule.title === 'L7-L33', matched.rule && matched.rule.title);
  assert(matched.matchMode === 'connections-trace-layers' && matched.matchTraceLayers.join('/') === '7/33', JSON.stringify(matched));
  assert(!matched.namingError && !matched.rows.some(row => row.isPadstackCheck), JSON.stringify(matched.rows));
  assert(matched.rows.some(row => row.shapeId === 670 && row.status === '符合'), JSON.stringify(matched.rows));
  assert(matched.note.includes('Connections Trace 走线层 L7、L33') && matched.note.includes('匹配约束 L7-L33'), matched.note);
  assert(!unmatched.rule && unmatched.excludedByConstraint && unmatched.failCount === 0, JSON.stringify(unmatched));
  assert(unmatched.note.includes('对应 L8-L33') && unmatched.note.includes('不进行检查'), unmatched.note);
  assert(!unmatched.rows.some(row => row.status === '不符合' || row.isPadstackCheck), JSON.stringify(unmatched.rows));
  const legacyRule = { kind: '其他', title: 'Legacy-L3-L29', constraints: [] };
  const mixed = C.runCopperCheck([vias[1]], [...rules, legacyRule], { layerCount: 44 }).groups[0];
  assert(!mixed.rule && mixed.excludedByConstraint && mixed.matchMode === 'connections-trace-layers',
    'Connections Trace 未命中时不得回退旧规则：' + JSON.stringify(mixed.rule));
  const ineligible = C.parseBoardItems(raw(70).replace('Net: CHANGE_70', 'Net: GND') + '\n' + raw(71).replace('Trace:            2 (07IS03 33IS10)', 'Shape:            1 (Top)'));
  const skipped = C.runCopperCheck(ineligible, rules, { layerCount: 44 }).groups;
  assert(skipped.every(group => !group.signal && !group.rule && group.failCount === 0), JSON.stringify(skipped));
});

t('L1-L5 孔段读取 L13 同心 Shape，但不借此改变约束匹配层跨', () => {
  const p = { id: 70, type: 'via', origin: [0, 0], net: '37_P', padstack: 'BGA-HDI-SIG_L1_L5', traceLayers: [] };
  const n = { id: 71, type: 'via', origin: [mil(0.5), 0], net: '37_N', padstack: 'BGA-HDI-SIG_L1_L5', traceLayers: [] };
  const circles = [p, n].flatMap((via, index) => [
    { id: 80 + index * 2, type: 'shape', circle: true, center: via.origin.slice(), radius: 9, set: 'Route Keepout', subset: 'Top', head: 'Route Keepout' },
    { id: 81 + index * 2, type: 'shape', circle: true, center: via.origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L13', head: 'Route Keepout' }
  ]);
  const rules = [
    { kind: 'BGA', title: 'BGA-Top-L5-0.5mm', constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '10', L5: '10' } }] },
    { kind: 'BGA', title: 'BGA-Top-L12-0.5mm', constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '10', L13: '10' } }] }
  ];
  const out = C.runCopperCheck([p, n, ...circles], rules, { layerCount: 14, posTol: 0.05, valTol: 0.01 });
  const group = out.groups.find(g => String(g.via.id) === '70');
  const top = group.rows.find(row => row.shapeId === 80);
  assert(group.rule && group.rule.title === 'BGA-Top-L5-0.5mm', group.rule && group.rule.title);
  assert(top && top.sourcePadstack === 'BGA-HDI-SIG_L1_L5' && top.status === '不符合', JSON.stringify(top));
  const l13 = group.rows.find(row => row.shapeId === 81);
  assert(l13 && l13.layer === 13 && l13.actual === 10 && l13.status === '无约束', JSON.stringify(l13));
  assert(l13.sourceViaIds.join('/') === '70' && l13.sourcePadstack === 'BGA-HDI-SIG_L1_L5', JSON.stringify(l13));
  for (let layer = 1; layer <= 14; layer++) assert(group.rows.some(row => row.layer === layer), '结果缺少 L' + layer);
  assert(!out.unmatchedCircles.some(shape => shape.id === 81), 'L13 同心 Shape 应纳入整合孔');
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
