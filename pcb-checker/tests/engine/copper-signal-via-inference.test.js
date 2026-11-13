/* SIG 盲埋孔段合并、差分中心距和完整层跨约束推算回归 */
'use strict';
const C = require('../../packages/engines/copper');

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
  { id: 1, type: 'via', origin: [0, 0], net: 'DP_P', padstack: 'BGA_SIG_L2_L5', traceLayers: ['L2', 'L5'] },
  { id: 2, type: 'via', origin: [mil(0.075), 0], net: 'DP_P', padstack: 'BGA_SIG_L5_L10', traceLayers: ['L5', 'L10'] },
  { id: 3, type: 'via', origin: [mil(0.150), 0], net: 'DP_P', padstack: 'BGA_SIG_L10_L12', traceLayers: ['L10', 'L12'] }
];
const nParts = [
  { id: 4, type: 'via', origin: [mil(0.600), 0], net: 'DP_N', padstack: 'BGA_SIG_L2_L5', traceLayers: ['L2', 'L5'] },
  { id: 5, type: 'via', origin: [mil(0.675), 0], net: 'DP_N', padstack: 'BGA_SIG_L5_L10', traceLayers: ['L5', 'L10'] },
  { id: 6, type: 'via', origin: [mil(0.750), 0], net: 'DP_N', padstack: 'BGA_SIG_L10_L12', traceLayers: ['L10', 'L12'] }
];
const nonSig = { id: 7, type: 'via', origin: [100, 100], net: 'GND', padstack: 'BGA_GND_L2_L12', traceLayers: [] };
const shapes = pParts.map((v, i) => ({
  id: 20 + i, type: 'shape', circle: true, center: v.origin.slice(), radius: 10,
  set: 'Route Keepout', subset: ['L2', 'L5', 'L12'][i], head: 'Route Keepout'
}));
shapes.push({ id: 30, type: 'shape', circle: true, center: nonSig.origin.slice(), radius: 10, set: 'Route Keepout', subset: 'L2', head: 'Route Keepout' });
const sets = [0.5, 0.6, 0.7].map(pitch => ({
  kind: 'BGA', title: `BGA-L2-L12-${pitch}mm`,
  constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L2: '10', L5: '10', L12: '10' } }]
}));
const result = C.runCopperCheck([...pParts, ...nParts, nonSig, ...shapes], sets, { layerCount: 14, posTol: 0.05, valTol: 0.01 });
const pGroup = result.groups.find(g => g.via.net === 'DP_P');
const nGroup = result.groups.find(g => g.via.net === 'DP_N');
const gndGroup = result.groups.find(g => g.via.net === 'GND');

t('0.075mm 错位的三个同网络孔段按连通关系合并为一个完整孔', () => {
  assert(pGroup && pGroup.vias.length === 3, JSON.stringify(pGroup && pGroup.via));
  assert(pGroup.via.id === '1/2/3', '组合孔号=' + pGroup.via.id);
  assert(pGroup.startLayer === 2 && pGroup.endLayer === 12, '完整层跨=' + pGroup.startLayer + '-' + pGroup.endLayer);
});

t('孔段中心距仅命中 0/0.025/0.075/0.125/0.175mm ±0.005mm 才合并', () => {
  assert(C.isSegmentDistance([0, 0], [mil(0.075 + 0.0049), 0]), '容差内应命中');
  assert(!C.isSegmentDistance([0, 0], [mil(0.050), 0]), '0.050mm 不在离散距离集合内');
  assert(!C.isSegmentDistance([0, 0], [mil(0.181), 0]), '超过 0.175+0.005mm 不应命中');
});

t('按常见 _P/_N 后缀配对完整孔组并以孔组中心计算 0.600mm 中心距', () => {
  assert(pGroup.mateNet === 'DP_N' && nGroup.mateNet === 'DP_P', pGroup.mateNet + '/' + nGroup.mateNet);
  near(pGroup.pitchMm, 0.6, 1e-9, 'P/N 中心距');
});

t('同封装与完整层跨下选择中心距最近的 BGA-L2-L12-0.6mm 约束', () => {
  assert(pGroup.rule && pGroup.rule.title === 'BGA-L2-L12-0.6mm', pGroup.rule && pGroup.rule.title);
  assert(nGroup.rule && nGroup.rule.title === 'BGA-L2-L12-0.6mm', nGroup.rule && nGroup.rule.title);
});

t('完整孔三个孔段坐标处的全部 Route Keepout 都归入同一约束核查', () => {
  const real = pGroup.rows.filter(r => !r.missing && !r.isPadstackCheck);
  assert(real.length === 3, '配对 Route Keepout=' + real.length);
  assert(real.every(r => r.status === '符合'), real.map(r => r.status).join(','));
});

t('检查结果补齐完整孔经过的 L2-L12 所有层，稀疏 Shape 层不再被隐藏', () => {
  const geometryRows = pGroup.rows.filter(r => !r.isPadstackCheck);
  for (let layer = 2; layer <= 12; layer++) {
    assert(geometryRows.some(r => r.layer === layer), '结果缺少 L' + layer);
  }
  const sparse = geometryRows.find(r => r.layer === 3);
  assert(sparse && sparse.spanPlaceholder && sparse.status === '未检查', JSON.stringify(sparse));
  assert(sparse.actual === '无铜皮' && sparse.expect === '该层无约束', JSON.stringify(sparse));
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

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
