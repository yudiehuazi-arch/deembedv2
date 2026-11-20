/**
 * pour-test.js
 * 铜皮五大检查项单元测试
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PourChecker = require("../../packages/engines/pour");

const {
  parsePcbElements,
  expandLayerRange,
  checkViaLayerCoverage,
  checkSpecialShapedCopper,
  getDefaultSpecialShapeTemplates,
  checkTraceReferenceMargin,
  checkIsolatedSmallCopper,
  checkCopperArcRadius,
  groupResultsByTargetObject,
  runAllCopperChecks
} = PourChecker;

console.log('== 铜皮五项检查引擎单元测试 ==');

// 1. 数据解析测试 (Shape / Via / Trace)
{
  const sampleTxt = fs.readFileSync(path.join(__dirname, '../../sample/铜皮数据示例.txt'), 'utf8');
  const parsed = parsePcbElements(sampleTxt);

  assert.strictEqual(parsed.shapes.length, 3, '应解析出 3 个 Shape');
  assert.strictEqual(parsed.vias.length, 1, '应解析出 1 个 Via');
  assert.strictEqual(parsed.vias[0].hasDefinedSpan, true);
  assert.deepStrictEqual([parsed.vias[0].minLayerNum, parsed.vias[0].maxLayerNum], [1, 9999],
    'Via 必须保留 Padstack Defined 层跨供端点反焊盘诊断显示');
  assert.strictEqual(parsed.shapes[0].layer, 'Top');
  assert.strictEqual(parsed.shapes[0].area, 907.92028);
  assert.strictEqual(parsed.shapes[0].arcs.length, 1);
  assert.strictEqual(parsed.shapes[0].arcs[0].radius, 17.0);

  // 走线数据文件解析测试
  const traceTxt = fs.readFileSync(path.join(__dirname, '../../sample/走线示例.txt'), 'utf8');
  const parsedTrace = parsePcbElements(traceTxt);
  assert.strictEqual(parsedTrace.traces.length, 10, '应解析出 10 条走线 Trace');
  assert.strictEqual(parsedTrace.traces[0].net, '105_P');
  assert.strictEqual(parsedTrace.traces[0].segments.length, 3, 'Item 1 包含 2 条直线段 + 1 条圆弧段');
  assert.strictEqual(parsedTrace.traces[0].segments[1].type, 'arc');
  assert.strictEqual(parsedTrace.traces[0].segments[1].radius, 52.38);
  console.log('  PASS  EDA TXT Shape、Via 与 Trace 走线 (直线+圆弧) 全量元素解析');
}

// 1.1 EDA Shape 的 Seg 与 Arc seg 必须按原始顺序组成真实轮廓
{
  const shapeTxt = fs.readFileSync(path.join(__dirname, '../../sample/special-shape-seg-arc.txt'), 'utf8');
  const shape = parsePcbElements(shapeTxt).shapes[0];
  assert.ok(shape, '应识别用户提供的异型铜皮 Shape');
  assert.strictEqual(shape.layer, '05G02P');
  assert.strictEqual(shape.set, 'Shape');
  assert.strictEqual(shape.area, 97.38256);
  assert.strictEqual(shape.boundary.length, 11, '应识别 5 条 Seg 直线与 6 条 Arc seg 圆弧');
  assert.strictEqual(shape.arcs.length, 6);
  assert.deepStrictEqual(shape.boundary.map(seg => seg.type),
    ['line', 'line', 'arc', 'arc', 'arc', 'arc', 'line', 'line', 'arc', 'line', 'arc']);
  assert.ok(Math.abs(shape.areaComputed - shape.areaReported) < 0.6,
    `真实扫掠轮廓面积 ${shape.areaComputed} 应接近 EDA 报告面积 ${shape.areaReported}`);
  assert.ok(/Item\s+1\s+< Shape >/.test(shape.rawText) && /Subset:\s+05G02P/.test(shape.rawText),
    '解析后的 Shape 应保留可回填编辑框的原始 TXT 块');
  assert.ok(!Object.keys(shape).includes('rawText'), '原始 TXT 不应污染 Shape 的 JSON 导出字段');
  assert.ok(!Object.keys(shape).includes('_ring') && !Object.keys(shape).includes('_voidRings'),
    '离散轮廓缓存不应进入 Worker 结构化克隆数据');
  const boardShape = parsePcbElements(shapeTxt.replace(/Set:\s*Shape/i, 'Set: Board Geometry')).shapes[0];
  assert.strictEqual(boardShape.set, 'Board Geometry', '应解析 Board Geometry Set 类别');
  console.log('  PASS  EDA 异型铜皮：Seg 与 Arc seg 按原始顺序解析并保留源 TXT');
}

// 1.2 多个 Shape Item 共同组成一个异型铜皮模板
{
  const text = fs.readFileSync(path.join(__dirname, '../../sample/special-shape-multi-item.txt'), 'utf8');
  const parsed = parsePcbElements(text);
  assert.strictEqual(parsed.shapes.length, 2, '应完整读取两个 Shape Item');
  assert.deepStrictEqual(parsed.shapes.map(shape => shape.net), ['9_N', '9_N']);
  const composite = PourChecker.composeShapeItems(parsed.shapes);
  assert.strictEqual(composite.itemCount, 2);
  assert.deepStrictEqual(composite.itemIds, [1, 2]);
  assert.ok(Math.abs(composite.area - 118.27433) < 1e-6, '模板面积应为两个 Item 报告面积之和');
  assert.strictEqual(composite.boundary.length, 5, '应保留圆形与矩形的全部五段边界');
  assert.strictEqual(composite.arcs.length, 1);
  const mixedSetComposite = PourChecker.composeShapeItems([
    parsed.shapes[0], Object.assign({}, parsed.shapes[1], { set: 'Route Keepout' })
  ]);
  assert.strictEqual(mixedSetComposite.hasMixedSets, true, '多 Item 模板必须识别混合 Set 类别并阻止保存');
  assert.deepStrictEqual(mixedSetComposite.sets, ['Shape', 'Route Keepout']);
  assert.strictEqual(PourChecker.shapeItemsTouch(parsed.shapes[0], parsed.shapes[1], 0.05), true,
    '同层同网络的圆形与矩形 Item 应识别为相接铜皮');
  const vias = [
    { id: 10, x: 17880, y: 35965.0001, padstack: 'MULTI_TARGET', net: '9_N' },
    { id: 11, x: 17881, y: 35965.0001, padstack: 'HDI_NEAR', net: '9_N' },
    { id: 12, x: 17882, y: 35965.0001, padstack: 'HDI_MATE', net: '9_P' }
  ];
  const checked = checkSpecialShapedCopper(vias, parsed.shapes, [{
    id: 'multi', name: '圆形加矩形', padstack: 'MULTI_TARGET', differentialCenterDistance: 1,
    hdiSearchRadiusMm: 0.175, layer: '02G01P', expectedArea: composite.area,
    areaTolerance: 0.001, shapeItemCount: 2, shape: composite
  }]);
  assert.strictEqual(checked.length, 1);
  assert.strictEqual(checked[0].pass, true, '实际数据的两个相接 Item 应按合计面积匹配模板');
  assert.deepStrictEqual(checked[0].targetShapeIds, [1, 2]);
  assert.strictEqual(checked[0].actualShapeItemCount, 2);
  console.log('  PASS  多 Item 异型铜皮：完整预览、合计面积与实际相接 Shape 联合比对');
}

// 1.3 规则 2 必须按 Shape Item 的 Set 类别隔离候选
{
  const vias = [{ id: 20, x: 100, y: 100, padstack: 'SET_TARGET', net: 'SET_P' }];
  const shapes = [
    { id: 21, layer: 'L2', set: 'Shape', net: 'SET_P', area: 100, centroid: { x: 100, y: 100 } },
    { id: 22, layer: 'L2', set: 'Route Keepout', net: 'SET_P', area: 200, centroid: { x: 100, y: 100 } },
    { id: 23, layer: 'L2', set: 'Board Geometry', net: 'SET_P', area: 300, centroid: { x: 100, y: 100 } }
  ];
  const base = { padstack: 'SET_TARGET', layer: 'L2', areaTolerance: 0.01 };
  const results = checkSpecialShapedCopper(vias, shapes, [
    Object.assign({ id: 'set_shape', name: 'Shape 模板', set: ' shape ', expectedArea: 100 }, base),
    Object.assign({ id: 'set_keepout', name: 'Keepout 模板', set: 'ROUTE   KEEPOUT', expectedArea: 200 }, base),
    Object.assign({ id: 'set_board', name: 'Board Geometry 模板', set: ' board   geometry ', expectedArea: 300 }, base)
  ]);
  assert.strictEqual(results.length, 3);
  assert.ok(results.every(result => result.pass), '三类 Set 应各自只匹配同类别 Shape Item');
  assert.deepStrictEqual(results.map(result => [result.expectedSet, result.actualSet, result.targetShapeId]), [
    ['Shape', 'Shape', 21], ['Route Keepout', 'Route Keepout', 22], ['Board Geometry', 'Board Geometry', 23]
  ]);

  const mismatch = checkSpecialShapedCopper(vias, shapes.slice(1), [
    Object.assign({ id: 'shape_only', name: 'Shape 模板', set: 'Shape', expectedArea: 200 }, base)
  ])[0];
  assert.strictEqual(mismatch.pass, false, 'Route Keepout 不得代替 Shape 类别模板');
  assert.strictEqual(mismatch.targetShapeId, null);
  assert.strictEqual(mismatch.actualSet, 'Route Keepout');
  assert.deepStrictEqual(mismatch.mismatchedSetShapeIds, [22]);
  assert.match(mismatch.message, /Set=Shape.*Set=Route Keepout/);

  const boardMismatch = checkSpecialShapedCopper(vias, shapes.slice(2), [
    Object.assign({ id: 'keepout_only', name: 'Keepout 模板', set: 'Route Keepout', expectedArea: 300 }, base)
  ])[0];
  assert.strictEqual(boardMismatch.pass, false, 'Board Geometry 不得代替 Route Keepout 类别模板');
  assert.strictEqual(boardMismatch.actualSet, 'Board Geometry');
  assert.deepStrictEqual(boardMismatch.mismatchedSetShapeIds, [23]);
  assert.match(boardMismatch.message, /Set=Route Keepout.*Set=Board Geometry/);

  const mixedCount = checkSpecialShapedCopper(vias, shapes, [
    Object.assign({ id: 'mixed_count', name: '两 Item Shape 模板', set: 'Shape', expectedArea: 300, shapeItemCount: 2 }, base)
  ])[0];
  assert.strictEqual(mixedCount.actualShapeItemCount, 1, '多 Item 实测组合不得跨 Set 类别拼接');
  assert.strictEqual(mixedCount.actualArea, 100);
  assert.strictEqual(mixedCount.pass, false);

  const legacy = checkSpecialShapedCopper(vias, shapes, [
    Object.assign({ id: 'legacy_set', name: '旧模板', expectedArea: 100 }, base)
  ])[0];
  assert.strictEqual(legacy.expectedSet, 'Shape', '旧模板缺少 Set 时必须按 Shape 兼容');
  assert.strictEqual(legacy.targetShapeId, 21);
  assert.ok(legacy.pass);
  console.log('  PASS  规则 2：Shape、Route Keepout 与 Board Geometry 按 Set 类别隔离，旧模板默认 Shape');
}

// 2. 第一项：孔经过层铺铜覆盖检查 (Via Layer Coverage Check)
{
  const vias = [
    { id: 1, x: 1000, y: 1000, padstack: 'HDI_045drill_ring3_1_4', net: 'GND' },
    { id: 2, x: 2000, y: 2000, padstack: 'HDI_045drill_ring3_1_4', net: 'GND' }
  ];

  const shapes = [
    // Via 1 附近 20 mil 有铜皮 (满足 <= 50mil)
    {
      id: 101, layer: 'L1', bbox: { minX: 980, minY: 980, maxX: 1050, maxY: 1050 },
      boundary: [{ type: 'line', x1: 980, y1: 980, x2: 1050, y2: 1050 }],
      arcs: [], centroid: { x: 1015, y: 1015 }
    },
    // Via 2 附近无铜皮 (最近铜皮在 500mil 外)
    {
      id: 102, layer: 'L1', bbox: { minX: 2500, minY: 2500, maxX: 2600, maxY: 2600 },
      boundary: [{ type: 'line', x1: 2500, y1: 2500, x2: 2600, y2: 2600 }],
      arcs: [], centroid: { x: 2550, y: 2550 }
    }
  ];

  const rules = [
    { id: 'r1', padstack: 'HDI_045drill', layers: ['L1', 'L2'], coverageRadius: 50.0 }
  ];

  const res = checkViaLayerCoverage(vias, shapes, rules);
  assert.strictEqual(res.length, 4, '2个孔 × 2个层 = 4条检查记录');

  const via1L1 = res.find(r => r.viaId === 1 && r.layer === 'L1');
  assert.strictEqual(via1L1.pass, true, 'Via 1 在 L1 距离铜皮 <= 50mil 应判定为通过');

  const via2L1 = res.find(r => r.viaId === 2 && r.layer === 'L1');
  assert.strictEqual(via2L1.pass, false, 'Via 2 在 L1 距离铜皮 > 50mil 应判定为不通过');

  const via1L2 = res.find(r => r.viaId === 1 && r.layer === 'L2');
  assert.strictEqual(via1L2.pass, false, 'Via 1 在 L2 无铜皮应判定为不通过');

  const rectangle = (id, layer, minX, maxX) => ({
    id, layer, arcs: [], centroid: { x: (minX + maxX) / 2, y: 0 },
    bbox: { minX, minY: -5, maxX, maxY: 5, spanX: maxX - minX, spanY: 10 },
    boundary: [
      { type: 'line', x1: minX, y1: -5, x2: maxX, y2: -5 },
      { type: 'line', x1: maxX, y1: -5, x2: maxX, y2: 5 },
      { type: 'line', x1: maxX, y1: 5, x2: minX, y2: 5 },
      { type: 'line', x1: minX, y1: 5, x2: minX, y2: -5 }
    ]
  });
  const probeVia = [{ id: 3, x: 0, y: 0, padstack: 'PROBE', net: 'N1' }];
  const near = checkViaLayerCoverage(probeVia, [rectangle(201, '02G01P', 54, 64)],
    [{ padstack: 'PROBE', layers: ['L2'], coverageRadius: 55 }]);
  assert.strictEqual(near[0].pass, true, '过孔无需被铜覆盖；孔心 55mil 范围内任意铜皮即达标');
  assert.strictEqual(near[0].actualDist, 54);
  assert.strictEqual(near[0].nearestShapeLayer, '02G01P', '规则 L2 应匹配 Allegro 物理层名 02G01P');
  const far = checkViaLayerCoverage(probeVia, [rectangle(202, '02G01P', 56, 66)],
    [{ padstack: 'PROBE', layers: ['L2'], coverageRadius: 55 }]);
  assert.strictEqual(far[0].pass, false, '最近铜皮距离 56mil 超过 55mil 搜索范围应不达标');
  assert.strictEqual(PourChecker.physicalLayerAlias('Top'), 'L1');
  assert.strictEqual(PourChecker.physicalLayerAlias('08IS03'), 'L8');

  assert.deepStrictEqual(expandLayerRange('L1, L3-L5'), ['L1', 'L3', 'L4', 'L5'], '列表中的层范围必须逐层展开');
  assert.deepStrictEqual(expandLayerRange(['L1', 'L3 - L5']), ['L1', 'L3', 'L4', 'L5'], '数组输入与带空格范围也必须逐层展开');
  const rangeResults = checkViaLayerCoverage(probeVia, [rectangle(203, 'L1', 10, 20)],
    [{ padstack: 'PROBE', layers: 'L1, L3-L5', coverageRadius: 55 }], ['L1']);
  assert.deepStrictEqual(rangeResults.map(result => result.layer), ['L1', 'L3', 'L4', 'L5']);
  assert.deepStrictEqual(rangeResults.map(result => result.pass), [true, false, false, false]);
  const rangeGroup = groupResultsByTargetObject(rangeResults)[0];
  assert.strictEqual(rangeGroup.failCount, 3);
  assert.strictEqual(rangeGroup.layerListStr, 'L1, L3, L4, L5');
  console.log('  PASS  第一项：孔心阈值范围内任意铜皮即达标，并兼容层范围列表与物理层名');
}

// 3. 第二项：特定异型铜皮比对检查 (Special Shaped Copper Check)
{
  const vias = [
    { id: 10, x: 23286.13, y: 27990.27, padstack: 'BGA_3510_L19_ring3mil_L2pad_0907', net: '63_N' },
    { id: 11, x: 23296.13, y: 27990.27, padstack: 'BGA_3510_L19_ring3mil_L2pad_0907', net: '63_P' },
    { id: 12, x: 23287.13, y: 27990.27, padstack: 'HDI_045drill_N', net: '63_N' },
    { id: 13, x: 23297.13, y: 27990.27, padstack: 'HDI_045drill_P', net: '63_P' }
  ];

  const shapes = [
    {
      id: 201, layer: '02G01P', area: 452.38934,
      centroid: { x: 23286.13, y: 27990.27 },
      bbox: { minX: 23274, minY: 27978, maxX: 23298, maxY: 28002 },
      arcs: [{ cx: 23286.13, cy: 27990.27, radius: 12.0 }]
    },
    {
      id: 202, layer: 'L3', area: 500.0,
      centroid: { x: 23286.13, y: 27990.27 },
      bbox: { minX: 23274, minY: 27978, maxX: 23298, maxY: 28002 }, arcs: []
    }
  ];

  const templates = [
    {
      id: 'tmpl_1', name: 'L2特定异型铜皮',
      padstack: 'BGA_3510', differentialCenterDistance: 10.0, layer: '02G01P；L3',
      expectedArea: 452.38, areaTolerance: 10.0
    }
  ];

  const res = checkSpecialShapedCopper(vias, shapes, templates);
  assert.strictEqual(res.length, 4, '差分对两颗孔在两个目标层均应生成模板检查记录');
  assert.deepStrictEqual([...new Set(res.map(item => item.layer))].sort(), ['02G01P', 'L3']);
  assert.ok(res.filter(item => item.layer === '02G01P').every(item => item.pass));
  assert.ok(res.filter(item => item.layer === 'L3').every(item => !item.pass));
  assert.ok(res.every(item => item.actualDifferentialCenterDistance === 10));
  assert.ok(res.every(item => item.hdiAssociationDistance === 1));
  assert.ok(res.every(item => [12, 13].includes(item.actualHdiViaId) && [12, 13].includes(item.pairedHdiViaId) && item.hdiSearchRadiusMm === null), '未配置 HDI 搜索距离时不得恢复默认值');
  const grouped = groupResultsByTargetObject(res);
  assert.strictEqual(grouped.length, 2, '每颗差分孔的多个目标层应汇总为一个对象');
  assert.ok(grouped.every(item => !item.pass && item.failCount === 1 && item.subRecords.length === 2 && item.layerListStr.includes('L3')));
  console.log('  PASS  第二项：过孔类型、差分孔中心距与多个目标层依次匹配异型铜皮模板');
}

// 3.1 同一 Padstack 可有多条逐层异型铜皮要求，命中项全部为必检项
{
  const padstack = 'SMA-HDI-SIG-045drill-ring3_L1_L2';
  const vias = [{ id: 14, x: 100, y: 100, padstack, net: 'SMA_P' }];
  const shapes = [
    { id: 203, layer: '02G01P', area: 118.3, centroid: { x: 100, y: 100 } },
    { id: 204, layer: '03G02P', area: 96.5, centroid: { x: 100, y: 100 } }
  ];
  const templates = [
    { id: 'same_via_l2', name: 'SMA L2 异型铜皮', padstack, layer: 'L2', expectedArea: 118.3, areaTolerance: 0.1 },
    { id: 'same_via_l3', name: 'SMA L3 异型铜皮', padstack, layer: 'L3', expectedArea: 96.5, areaTolerance: 0.1 }
  ];
  const results = checkSpecialShapedCopper(vias, shapes, templates);
  assert.strictEqual(results.length, 2, '同一过孔命中的两条模板都必须生成检查记录');
  assert.deepStrictEqual(results.map(item => item.templateId), ['same_via_l2', 'same_via_l3']);
  assert.ok(results.every(item => item.pass), 'L2 与 L3 两项铜皮要求均满足时才应全部通过');
  const grouped = groupResultsByTargetObject(results);
  assert.strictEqual(grouped.length, 1, '同一过孔的多条异型铜皮要求应合并为一个目标结果');
  assert.strictEqual(grouped[0].subRecords.length, 2);
  assert.deepStrictEqual(grouped[0].templateNames, ['SMA L2 异型铜皮', 'SMA L3 异型铜皮']);
  assert.ok(grouped[0].pass && grouped[0].metricsStr.includes('L2【SMA L2 异型铜皮】') && grouped[0].metricsStr.includes('L3【SMA L3 异型铜皮】'));

  const missingL3 = checkSpecialShapedCopper(vias, shapes.slice(0, 1), templates);
  const failedGroup = groupResultsByTargetObject(missingL3)[0];
  assert.strictEqual(missingL3.length, 2, '缺少 L3 铜皮时不得因 L2 已通过而跳过第二条要求');
  assert.strictEqual(failedGroup.pass, false);
  assert.strictEqual(failedGroup.failCount, 1);
  assert.ok(failedGroup.message.includes('SMA L3 异型铜皮'));
  console.log('  PASS  第二项：同一过孔类型支持多条逐层模板，全部命中要求均参与判定');
}

// 4. 每颗目标 Via 独立搜索同网络 HDI 与差分 HDI 组合，并按实测中心距选择模板
{
  const defaultRadiusMil = 0.175 * 1000 / 25.4;
  const vias = [
    { id: 20, x: 0, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_A_P' },
    { id: 21, x: 20, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_B_P' },
    { id: 22, x: 40, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_C_P' },
    { id: 23, x: 60, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_D_P' },
    // NET_A_P 的等距 HDI 候选故意逆 ID 排列，确定性规则应选较小 ID 30。
    { id: 31, x: -2, y: 0, padstack: 'LASER_HDI_A_TIE', net: 'NET_A_P' },
    { id: 30, x: 2, y: 0, padstack: 'HDI_LASER_A_NEAREST', net: 'NET_A_P' },
    { id: 38, x: 5, y: 0, padstack: 'HDI_LASER_A_FARTHER', net: 'NET_A_P' },
    { id: 39, x: 4, y: 0, padstack: 'HDI_LASER_A_MATE', net: 'NET_A_N' },
    { id: 32, x: 0.25, y: 0, padstack: 'HDI_WRONG_NET', net: 'OTHER' },
    { id: 33, x: 0.5, y: 0, padstack: 'MICRO_LASER', net: 'NET_A_P' },
    { id: 34, x: 25, y: 0, padstack: 'laser_hdi_b', net: 'net_b_p' },
    { id: 37, x: 30, y: 0, padstack: 'laser_hdi_b_mate', net: 'net_b_n' },
    { id: 35, x: 41, y: 0, padstack: 'HDI_ONLY_WRONG_NET', net: 'OTHER' },
    { id: 36, x: 60 + defaultRadiusMil, y: 0, padstack: 'HDI_BOUNDARY', net: 'NET_D_P' },
    { id: 40, x: 60 + defaultRadiusMil * 2, y: 0, padstack: 'HDI_BOUNDARY_MATE', net: 'NET_D_N' }
  ];
  const shapes = [
    { id: 210, layer: 'L2', area: 100, centroid: { x: 0, y: 0 } },
    { id: 211, layer: 'L2', area: 100, centroid: { x: 20, y: 0 } },
    { id: 212, layer: 'L2', area: 100, centroid: { x: 40, y: 0 } },
    { id: 213, layer: 'L2', area: 100, centroid: { x: 60, y: 0 } }
  ];
  const templates = [
    { id: 'distance_2', name: '中心距2模板', padstack: 'TYPE_A', differentialCenterDistance: 2.009, layer: 'L2', expectedArea: 100, areaTolerance: 1 },
    { id: 'outside_tolerance', name: '中心距超容差模板', padstack: 'TYPE_A', differentialCenterDistance: 2.011, layer: 'L2', expectedArea: 999, areaTolerance: 1 },
    { id: 'distance_5', name: '中心距5模板', padstack: 'TYPE_A', differentialCenterDistance: 5, layer: 'L2', expectedArea: 100, areaTolerance: 1 },
    { id: 'inclusive_boundary', name: '中心距模板（不限制搜索距离）', padstack: 'TYPE_A', differentialCenterDistance: defaultRadiusMil, layer: 'L2', expectedArea: 100, areaTolerance: 1 },
    { id: 'narrow_search', name: '修改后搜索距离过小模板', padstack: 'TYPE_A', differentialCenterDistance: 2, hdiSearchRadiusMm: 0.05, layer: 'L2', expectedArea: 999, areaTolerance: 1 }
  ];
  const res = checkSpecialShapedCopper(vias, shapes, templates);
  const matched = res.filter(item => !item.associationFailed);
  const unmatched = res.filter(item => item.associationFailed);
  assert.strictEqual(res.length, 4, '三颗命中模板的 Via 与一颗未命中模板的 Via 都应生成结果');
  assert.deepStrictEqual(matched.map(item => item.viaId).sort((a, b) => a - b), [20, 21, 23]);
  assert.deepStrictEqual(matched.map(item => item.templateId).sort(), ['distance_2', 'distance_5', 'inclusive_boundary']);
  assert.ok(matched.every(item => item.pass && item.hdiSearchRadiusMm === null), '未配置搜索距离时仅应用中心距约束');
  assert.strictEqual(res.find(item => item.viaId === 20).actualHdiViaId, 30, '多个/等距候选必须稳定选择最近且 ID 较小的 HDI Via');
  assert.strictEqual(res.find(item => item.viaId === 20).actualDifferentialCenterDistance, 2);
  assert.strictEqual(res.find(item => item.viaId === 21).actualHdiViaId, 34, '网络匹配应忽略大小写');
  assert.ok(Math.abs(res.find(item => item.viaId === 23).actualDifferentialCenterDistance - defaultRadiusMil) < 1e-9, '未配置搜索距离时仍应按中心距找到同网络 HDI 孔');
  assert.strictEqual(unmatched.length, 1, '无同网络 HDI 候选的目标 Via 不得静默消失');
  assert.strictEqual(unmatched[0].viaId, 22);
  assert.ok(!unmatched[0].pass && /HDI 搜索范围.*未找到同网络/.test(unmatched[0].associationSummary));
  assert.ok(!res.some(item => item.templateId === 'narrow_search'), '缩小可配置搜索距离后不得关联范围外 HDI Via');
  assert.deepStrictEqual(matched.map(item => item.pairedHdiViaId).sort((a, b) => a - b), [37, 39, 40], '中心距必须来自同网络 HDI 与差分网络 HDI');
  console.log('  PASS  第二项：目标 Via 搜索同网络 HDI，再按差分 HDI 孔距选择模板');
}

// 4.1 via2_8-top：搜索范围内任一同网络 HDI 可与差分 HDI 命中模板孔距，不限于最近候选
{
  const vias = [
    { id: 80, x: 0, y: 0, padstack: 'via2_8-top', net: '25_N' },
    { id: 81, x: 5, y: 0, padstack: 'BGA-HDI-SIG-WRONG-PITCH', net: '25_N' },
    { id: 82, x: 24.685, y: 0, padstack: 'BGA-HDI-SIG-WRONG-MATE', net: '25_P' },
    { id: 83, x: 10, y: 10, padstack: 'BGA-HDI-SIG-CORRECT', net: '25_N' },
    { id: 84, x: 33.62, y: 10, padstack: 'BGA-HDI-SIG-CORRECT-MATE', net: '25_P' }
  ];
  const shapes = [{ id: 280, layer: 'Top', set: 'Shape', area: 103.6, centroid: { x: 0, y: 0 } }];
  const results = checkSpecialShapedCopper(vias, shapes, [{
    id: 'via2_8_top_060', name: 'TOP特定异型泪滴铜皮', padstack: 'via2_8-top',
    differentialCenterDistance: 23.62, hdiSearchRadiusMm: 0.5334,
    layer: 'L1', set: 'Shape', expectedArea: 103.6, areaTolerance: 1
  }]);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].pass, true);
  assert.strictEqual(results[0].actualHdiViaId, 83,
    '最近的同网络 HDI 为错误孔距时，应继续寻找范围内能组成 23.62 mil 的同网络 HDI');
  assert.strictEqual(results[0].pairedHdiViaId, 84);
  assert.ok(Math.abs(results[0].actualDifferentialCenterDistance - 23.62) < 1e-9);
  assert.ok(Math.hypot(vias[3].x, vias[3].y) * 0.0254 <= 0.5334,
    '命中的同网络 HDI 必须位于 0.5334 mm 搜索范围内');
  console.log('  PASS  第二项：via2_8-top 在 0.5334 mm 内按 23.62 mil HDI 差分孔距检查 Top 面 103.6 sq mil 铜皮');
}

// 4.2 差分孔中心距与 HDI 搜索距离分别可选，且只应用已配置字段
{
  const vias = [
    { id: 40, x: 0, y: 0, padstack: 'OPT_NONE', net: 'NO_HDI' },
    { id: 41, x: 30, y: 0, padstack: 'OPT_CENTER', net: 'CENTER_P' },
    { id: 42, x: 60, y: 0, padstack: 'OPT_RADIUS', net: 'RADIUS_NET' },
    { id: 43, x: 90, y: 0, padstack: 'OPT_BOTH', net: 'BOTH_P' },
    { id: 51, x: 40, y: 0, padstack: 'HDI_CENTER', net: 'CENTER_P' },
    { id: 54, x: 50, y: 0, padstack: 'HDI_CENTER_MATE', net: 'CENTER_N' },
    { id: 52, x: 63, y: 0, padstack: 'HDI_RADIUS', net: 'RADIUS_NET' },
    { id: 53, x: 92, y: 0, padstack: 'HDI_BOTH', net: 'BOTH_P' },
    { id: 55, x: 94, y: 0, padstack: 'HDI_BOTH_MATE', net: 'BOTH_N' }
  ];
  const shapes = [0, 30, 60, 90].map((x, index) => ({
    id: 240 + index, layer: 'L2', area: 100, centroid: { x, y: 0 }
  }));
  const templates = [
    { id: 'optional_none', name: '均留空', padstack: 'OPT_NONE', differentialCenterDistance: null, hdiSearchRadiusMm: null, layer: 'L2', expectedArea: 100, areaTolerance: 1 },
    { id: 'optional_center', name: '仅中心距', padstack: 'OPT_CENTER', differentialCenterDistance: 10, hdiSearchRadiusMm: null, layer: 'L2', expectedArea: 100, areaTolerance: 1 },
    { id: 'optional_radius', name: '仅搜索距离', padstack: 'OPT_RADIUS', differentialCenterDistance: null, hdiSearchRadiusMm: 0.1, layer: 'L2', expectedArea: 100, areaTolerance: 1 },
    { id: 'optional_both', name: '两者均配置', padstack: 'OPT_BOTH', differentialCenterDistance: 2, hdiSearchRadiusMm: 0.1, layer: 'L2', expectedArea: 100, areaTolerance: 1 }
  ];
  const res = checkSpecialShapedCopper(vias, shapes, templates);
  assert.strictEqual(res.length, 4, '四种可选字段组合都应生成检查结果');
  assert.ok(res.every(item => item.pass));
  const byTemplate = new Map(res.map(item => [item.templateId, item]));
  assert.strictEqual(byTemplate.get('optional_none').actualHdiViaId, null, '两项留空时不得要求附近存在 HDI 孔');
  assert.strictEqual(byTemplate.get('optional_none').expectedDifferentialCenterDistance, null);
  assert.strictEqual(byTemplate.get('optional_none').hdiSearchRadiusMm, null);
  assert.strictEqual(byTemplate.get('optional_center').actualDifferentialCenterDistance, 10, '仅中心距时不得套用旧的 0.175 mm 最大搜索距离');
  assert.strictEqual(byTemplate.get('optional_center').hdiSearchRadiusMm, null);
  assert.strictEqual(byTemplate.get('optional_radius').expectedDifferentialCenterDistance, null, '仅搜索距离时不得套用中心距默认值');
  assert.strictEqual(byTemplate.get('optional_radius').hdiAssociationDistance, 3);
  assert.strictEqual(byTemplate.get('optional_radius').actualDifferentialCenterDistance, null);
  assert.strictEqual(byTemplate.get('optional_both').actualDifferentialCenterDistance, 2);
  assert.strictEqual(byTemplate.get('optional_both').hdiSearchRadiusMm, 0.1);
  assert.ok(!/HDI|中心距|搜索距离/.test(byTemplate.get('optional_none').message), '两项留空时结果描述不得虚构 HDI 约束');
  const grouped = new Map(groupResultsByTargetObject(res).map(item => [item.viaId, item]));
  assert.ok(!/中心距|搜索距离|HDI/.test(grouped.get(40).metricsStr));
  assert.ok(/中心距规则 10 mil/.test(grouped.get(41).metricsStr) && !/搜索距离/.test(grouped.get(41).metricsStr));
  assert.ok(!/中心距规则/.test(grouped.get(42).metricsStr) && /搜索距离 ≤ 0.1 mm/.test(grouped.get(42).metricsStr));
  console.log('  PASS  第二项：中心距与 HDI 搜索距离支持均留空、仅中心距、仅搜索距离和同时配置');
}

// 4.3 已启用 HDI 搜索距离时，无同网络 HDI 或最近 HDI 超出范围都必须明确提示
{
  const vias = [
    { id: 60, x: 0, y: 0, padstack: 'SEARCH_TARGET', net: 'MISSING_P' },
    { id: 61, x: 100, y: 0, padstack: 'SEARCH_TARGET', net: 'FAR_P' },
    { id: 70, x: 110, y: 0, padstack: 'HDI_FAR', net: 'FAR_P' },
    { id: 71, x: 112, y: 0, padstack: 'HDI_FAR_MATE', net: 'FAR_N' }
  ];
  const shapes = [
    { id: 260, layer: 'L2', area: 100, centroid: { x: 0, y: 0 } },
    { id: 261, layer: 'L2', area: 100, centroid: { x: 100, y: 0 } }
  ];
  const results = checkSpecialShapedCopper(vias, shapes, [{
    id: 'search_required', padstack: 'SEARCH_TARGET', differentialCenterDistance: 2,
    hdiSearchRadiusMm: 0.1, layer: 'L2', expectedArea: 100, areaTolerance: 1
  }]);
  assert.strictEqual(results.length, 2);
  assert.ok(results.every(result => result.associationFailed && !result.pass));
  assert.ok(/HDI 搜索范围（0.1 mm）内未找到同网络/.test(results.find(result => result.viaId === 60).associationSummary));
  assert.ok(/最近同网络 HDI 孔 #70 关联距离 10 mil/.test(results.find(result => result.viaId === 61).associationSummary));
  console.log('  PASS  第二项：HDI 搜索范围无候选或候选超距时生成明确不符合提示');
}

// 4.4 PTH-SIG L5/L10 四种 HDI 孔距的内置模板必须覆盖该孔型
{
  const specs = [
    { offsetMm: 0.025, pitchMil: 19.685, area: 113.09734 },
    { offsetMm: 0.075, pitchMil: 23.62, area: 50.26548 },
    { offsetMm: 0.125, pitchMil: 27.56, area: 97.38257 },
    { offsetMm: 0.175, pitchMil: 31.496, area: 101.16052 }
  ];
  const vias = [], shapes = [];
  specs.forEach((spec, index) => {
    const x = index * 100;
    const hdiX = x + spec.offsetMm * PourChecker.MIL_PER_MM;
    vias.push({ id: 300 + index, x, y: 0, padstack: 'PTH-SIG-150drill-ring0_L5_L10', net: `PTH_${index}_P` });
    vias.push({ id: 310 + index, x: hdiX, y: 0, padstack: 'BGA-HDI-SIG-045drill-ring3', net: `PTH_${index}_P` });
    vias.push({ id: 340 + index, x: hdiX, y: spec.pitchMil, padstack: 'BGA-HDI-SIG-045drill-ring3', net: `PTH_${index}_N` });
    ['05G02P', '10G07P'].forEach((layer, layerIndex) => {
      shapes.push({
        id: 320 + index * 2 + layerIndex, layer,
        area: spec.pitchMil === 27.56 ? 50.26548 : spec.area,
        centroid: { x, y: 0 }
      });
    });
  });
  const templates = getDefaultSpecialShapeTemplates().filter(template => template.padstack === 'PTH-SIG-150drill-ring0_L5_L10');
  const results = checkSpecialShapedCopper(vias, shapes, templates);
  assert.strictEqual(templates.length, 4, '应内置 0.5/0.6/0.7/0.8 mm 四种 HDI 差分孔距模板');
  assert.strictEqual(results.length, 8, '四颗 PTH-SIG 孔应在 L5/L10 各生成一条检查记录');
  assert.deepStrictEqual([...new Set(results.map(result => result.viaId))].sort(), [300, 301, 302, 303]);
  assert.strictEqual(results.filter(result => !result.pass).length, 2, '0.7 mm HDI 孔距对应的两层面积异常应被检出');
  assert.ok(results.every(result => result.hdiAssociationDistance <= 0.175 * PourChecker.MIL_PER_MM + 1e-9));
  console.log('  PASS  第二项：PTH-SIG 先搜索同网络 HDI，再按四种 HDI 差分孔距匹配面积');
}

// 4.5 实板同规模回归：搜索半径、HDI 差分孔距、面积与未配置孔距分别判定
{
  const families = [
    { offsetMil: 0.98425, pitchMil: 19.685, area: 113.09734 },
    { offsetMil: 2.95276, pitchMil: 23.62, area: 50.26548 },
    { offsetMil: 4.92126, pitchMil: 27.56, area: 97.38257 },
    { offsetMil: 6.88976, pitchMil: 31.496, area: 101.16052 }
  ];
  const vias = [], shapes = [];
  for (let index = 0; index < 592; index++) {
    const family = families[Math.floor(index / 148)];
    const x = index * 100;
    const hdiX = x + family.offsetMil;
    vias.push({ id: 1000 + index, x, y: 0, padstack: 'PTH-SIG-150drill-ring0_L5_L10', net: `REAL_PTH_${index}_P` });
    vias.push({ id: 2000 + index, x: hdiX, y: 0, padstack: 'BGA-HDI-SIG-045drill-ring3', net: `REAL_PTH_${index}_P` });
    vias.push({ id: 3000 + index, x: hdiX, y: family.pitchMil, padstack: 'BGA-HDI-SIG-045drill-ring3', net: `REAL_PTH_${index}_N` });
    ['05G02P', '10G07P'].forEach((layer, layerIndex) => shapes.push({
      id: 4000 + index * 2 + layerIndex, layer,
      area: family.pitchMil === 27.56 && index < 298 ? 50.26548 : family.area,
      centroid: { x, y: 0 }
    }));
  }
  const templates = [
    { id: 'legacy_pth_1', name: 'L5/10特定异型泪滴铜皮', padstack: 'PTH-SIG-150drill-ring0_L5_L10', differentialCenterDistance: 23.62, hdiSearchRadiusMm: 0.175, layer: 'L10,L5', expectedArea: 50.3, areaTolerance: 1 },
    { id: 'legacy_pth_2', name: 'L5/10特定异型泪滴铜皮', padstack: 'PTH-SIG-150drill-ring0_L5_L10', differentialCenterDistance: 27.56, hdiSearchRadiusMm: 0.175, layer: 'L10,L5', expectedArea: 97.4, areaTolerance: 1 },
    { id: 'legacy_pth_3', name: 'L5/10特定异型泪滴铜皮', padstack: 'PTH-SIG-150drill-ring0_L5_L10', differentialCenterDistance: 19.685, hdiSearchRadiusMm: 0.175, layer: 'L10,L5', expectedArea: 113.1, areaTolerance: 1 }
  ];
  const results = checkSpecialShapedCopper(vias, shapes, templates);
  const grouped = groupResultsByTargetObject(results);
  assert.strictEqual(results.length, 1184, '592 颗目标孔在 L5/L10 均应生成检查结果');
  assert.strictEqual(grouped.length, 592, '按目标对象汇总后必须完整保留 592 颗 PTH-SIG');
  assert.strictEqual(results.filter(result => result.associationFailed).length, 296, '未配置 0.8 mm 模板的 148 颗孔应在两层明确报错');
  assert.ok(/实测中心距 31.496 mil 不满足规则 19.685 \/ 23.62 \/ 27.56 mil/.test(results.find(result => result.associationFailed).associationSummary));
  assert.strictEqual(grouped.filter(result => result.pass).length, 442);
  assert.strictEqual(grouped.filter(result => !result.pass).length, 150, '148 颗未配置孔距加 2 颗面积异常应不符合');
  const first = results.find(result => result.viaId === 1000);
  assert.strictEqual(first.actualHdiViaId, 2000);
  assert.strictEqual(first.pairedHdiViaId, 3000);
  assert.strictEqual(first.hdiAssociationDistance, 0.98425);
  assert.strictEqual(first.actualDifferentialCenterDistance, 19.685);
  assert.ok(!first.associationFailed && first.pass);
  console.log('  PASS  第二项：592 颗 PTH-SIG 按同网络 HDI 搜索与 HDI 差分孔距完整判定');
}

// 5. 第三项：首尾端所有层反焊盘外的完整走线投影覆盖与整条走线左右两侧邻近铜检查
{
  const traces = [
    {
      id: 301, layer: 'L4', net: 'PCIE_TX_P',
      segments: [
        { type: 'line', x1: 1000, y1: 1000, x2: 1200, y2: 1000, width: 6.0, len: 200 }
      ]
    }
  ];

  const shapes = [
    // L3：完整覆盖走线投影，并在左右两侧 50mil 内分别有一小块铜（通过）。
    { id: 401, layer: 'L3', bbox: { minX: 997, minY: 997, maxX: 1203, maxY: 1003 } },
    { id: 402, layer: 'L3', bbox: { minX: 1100, minY: 1030, maxX: 1110, maxY: 1035 } },
    { id: 403, layer: 'L3', bbox: { minX: 1100, minY: 965, maxX: 1110, maxY: 970 } },
    // L5：完整覆盖走线投影，左侧 50mil 内有铜，右侧铜超出搜索距离（不通过）。
    { id: 404, layer: 'L5', bbox: { minX: 997, minY: 997, maxX: 1203, maxY: 1003 } },
    { id: 405, layer: 'L5', bbox: { minX: 1100, minY: 1030, maxX: 1110, maxY: 1035 } },
    { id: 406, layer: 'L5', bbox: { minX: 1100, minY: 930, maxX: 1110, maxY: 940 } }
  ];

  const rules = [
    { id: 'm1', traceLayer: 'L4', upperRefLayer: 'L3', lowerRefLayer: 'L5', minMargin: 50.0 }
  ];

  const res = checkTraceReferenceMargin(traces, shapes, rules);
  assert.strictEqual(res.length, 2, '包含上参考层 L3 与下参考层 L5');

  const l3Res = res.find(r => r.refLayer === 'L3');
  assert.strictEqual(l3Res.pass, true, '完整走线投影及左右两侧 50mil 内均有铜时应通过');
  assert.strictEqual(l3Res.footprintCovered, true);
  assert.strictEqual(l3Res.leftSideCopper, true);
  assert.strictEqual(l3Res.rightSideCopper, true);

  const l5Res = res.find(r => r.refLayer === 'L5');
  assert.strictEqual(l5Res.pass, false, '一侧铜皮超出 50mil 实际搜索距离时应报错');
  assert.strictEqual(l5Res.footprintCovered, true);
  assert.strictEqual(l5Res.leftSideCopper, true);
  assert.strictEqual(l5Res.rightSideCopper, false);
  assert.match(l5Res.message, /走线右侧边缘外 50 mil 内未检测到铜皮/);
  console.log('  PASS  第三项：完整走线投影覆盖与左右两侧规则距离内邻近铜检查');
}

// 5.1 两侧只需整条走线各有一处邻近铜，不要求边缘至规则距离的走廊连续铺满
{
  const trace = {
    id: 302, layer: 'L4', net: 'PCIE_RX_P',
    segments: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, width: 10, len: 200 }]
  };
  const rule = [{ traceLayer: 'L4', upperRefLayer: 'L3', minMargin: 100 }];
  const footprintAndSparseSideCopper = [
    { id: 411, layer: 'L3', bbox: { minX: -5, minY: -5, maxX: 205, maxY: 5 } },
    { id: 412, layer: 'L3', bbox: { minX: 52.3, minY: 52.3, maxX: 52.4, maxY: 52.4 } },
    { id: 413, layer: 'L3', bbox: { minX: 147.7, minY: -52.4, maxX: 147.8, maxY: -52.3 } }
  ];
  const sparse = checkTraceReferenceMargin([trace], footprintAndSparseSideCopper, rule)[0];
  assert.strictEqual(sparse.pass, true, '走线投影完整且左右两侧各有一处微小的 100mil 内铜皮时应通过');
  assert.match(sparse.message, /除首尾端所有被检查层反焊盘豁免区外的完整投影有铜，且走线左右两侧边缘外 100 mil 内均存在铜皮/);

  const footprintOnly = [
    { id: 414, layer: 'L3', bbox: { minX: -5, minY: -5, maxX: 205, maxY: 5 } }
  ];
  const noSideCopper = checkTraceReferenceMargin([trace], footprintOnly, rule)[0];
  assert.strictEqual(noSideCopper.pass, false, '只有完整走线投影、两侧均无邻近铜时必须不通过');
  assert.deepStrictEqual(noSideCopper.failureKinds, ['left_side', 'right_side']);
  assert.match(noSideCopper.message, /走线左侧边缘外 100 mil 内未检测到铜皮/);
  assert.match(noSideCopper.message, /走线右侧边缘外 100 mil 内未检测到铜皮/);
  const noSideGroup = groupResultsByTargetObject([noSideCopper])[0];
  assert.match(noSideGroup.metricsStr, /走线左侧 100 mil 内无铜/);
  assert.match(noSideGroup.metricsStr, /走线右侧 100 mil 内无铜/);

  const footprintGapButBothSidesPresent = [
    { id: 415, layer: 'L3', bbox: { minX: -5, minY: -5, maxX: 95, maxY: 5 } },
    { id: 416, layer: 'L3', bbox: { minX: 105, minY: -5, maxX: 205, maxY: 5 } },
    { id: 417, layer: 'L3', bbox: { minX: 50, minY: 50, maxX: 55, maxY: 55 } },
    { id: 418, layer: 'L3', bbox: { minX: 145, minY: -55, maxX: 150, maxY: -50 } }
  ];
  const footprintGap = checkTraceReferenceMargin([trace], footprintGapButBothSidesPresent, rule)[0];
  assert.strictEqual(footprintGap.pass, false, '左右两侧均有邻近铜也不能弥补走线投影缺铜');
  assert.deepStrictEqual(footprintGap.failureKinds, ['footprint']);
  assert.match(footprintGap.message, /完整线宽投影存在缺铜/);
  console.log('  PASS  第三项语义：首尾端所有层反焊盘外完整投影必须有铜，两侧仅需整条走线各存在一处邻近铜');
}

// 5.2 首尾端在所有被检查层的实际反焊盘均豁免（层跨仅诊断），线路中途 Void 仍必须报错
{
  const rectBoundary = (minX, minY, maxX, maxY) => [
    { type: 'line', x1: minX, y1: minY, x2: maxX, y2: minY },
    { type: 'line', x1: maxX, y1: minY, x2: maxX, y2: maxY },
    { type: 'line', x1: maxX, y1: maxY, x2: minX, y2: maxY },
    { type: 'line', x1: minX, y1: maxY, x2: minX, y2: minY }
  ];
  const trace = {
    id: 304, layer: 'L4', net: 'ENDPOINT_SIG',
    segments: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, width: 4, len: 200 }]
  };
  const vias = [
    { id: 901, x: 0, y: 0, net: 'ENDPOINT_SIG', hasDefinedSpan: true, minLayerNum: 1, maxLayerNum: 4 },
    { id: 902, x: 200, y: 0, net: 'ENDPOINT_SIG', hasDefinedSpan: true, minLayerNum: 1, maxLayerNum: 4 }
  ];
  const rule = [{ traceLayer: 'L4', upperRefLayer: 'L3', minMargin: 20 }];
  const endpointVoids = {
    id: 430, layer: 'L3', net: 'GND',
    boundary: rectBoundary(-50, -50, 250, 50),
    voids: [
      { boundary: rectBoundary(-10, -10, 10, 10) },
      { boundary: rectBoundary(190, -10, 210, 10) }
    ],
    bbox: { minX: -50, minY: -50, maxX: 250, maxY: 50 }
  };

  const withoutViaContext = checkTraceReferenceMargin([trace], [endpointVoids], rule)[0];
  assert.strictEqual(withoutViaContext.pass, false, '没有同网络 Via 佐证时不能把普通端点缺铜当成反焊盘豁免');
  assert.match(withoutViaContext.missingReason, /未导入 Via 数据/, '结果必须解释未豁免是因为缺少 Via 数据');
  const unknownSpan = checkTraceReferenceMargin([trace], [endpointVoids], rule,
    vias.map(via => ({ id: via.id, x: via.x, y: via.y, net: via.net })))[0];
  assert.strictEqual(unknownSpan.pass, true, '同网络 Via 端点已落在参考层 Void 内时，不应因缺少层跨文本拒绝反焊盘豁免');
  assert.match(unknownSpan.endpointAntipadChecks[0].reason, /缺少 Padstack Defined 层跨/, '诊断仍应保留端点 Via 层跨未知信息');
  const wrongSpan = checkTraceReferenceMargin([trace], [endpointVoids], rule,
    vias.map(via => Object.assign({}, via, { startLayer: 'L4', endLayer: 'L4', minLayerNum: 4, maxLayerNum: 4 })))[0];
  assert.strictEqual(wrongSpan.pass, true, '同网络 Via 端点的参考层 Void 是直接几何证据，不应被 Padstack 层跨信息推翻');
  assert.match(wrongSpan.endpointAntipadChecks[0].reason, /首尾端所有被检查层反焊盘均豁免.*层跨 L4–L4 不经过参考层 L3.*不限制其他层的端点反焊盘豁免/,
    '结果必须说明层跨不经过当前层仍不能限制首尾端所有层反焊盘豁免');

  const allLayerVoids = [endpointVoids, Object.assign({}, endpointVoids, { id: 434, layer: 'L5' })];
  const allLayerResults = checkTraceReferenceMargin([trace], allLayerVoids, [{
    traceLayer: 'L4', upperRefLayer: 'L3', lowerRefLayer: 'L5', minMargin: 20
  }], vias);
  assert.strictEqual(allLayerResults.length, 2);
  assert.ok(allLayerResults.every(result => result.pass), '走线首尾端在所有被检查参考层上的反焊盘都应豁免');
  assert.ok(allLayerResults.every(result => result.endpointAntipadExemptionCount === 2));
  const allLayerL5 = allLayerResults.find(result => result.refLayer === 'L5');
  assert.deepStrictEqual(allLayerL5.endpointAntipadViaIds, [901, 902]);
  assert.match(allLayerL5.endpointAntipadChecks[0].reason, /所有被检查层反焊盘均豁免.*L5.*层跨 L1–L4 不经过参考层 L5/,
    'Via 层跨止于 L4 时，L5 实际端点反焊盘仍必须按所有层规则豁免');

  const wrongNet = checkTraceReferenceMargin([trace], [endpointVoids], rule,
    vias.map(via => Object.assign({}, via, { net: '' })))[0];
  assert.strictEqual(wrongNet.pass, false, '空白或未知网络 Via 不能授权端点反焊盘豁免');

  const exempted = checkTraceReferenceMargin([trace], [endpointVoids], rule, vias)[0];
  assert.strictEqual(exempted.pass, true, '同网络 Via 端点反焊盘应从完整投影覆盖检查中豁免');
  assert.strictEqual(exempted.footprintCovered, true);
  assert.strictEqual(exempted.endpointAntipadExemptionCount, 2);
  assert.deepStrictEqual(exempted.endpointAntipadViaIds, [901, 902]);
  assert.match(exempted.message, /已豁免端点 Via #901、#902 的反焊盘/);
  assert.ok(exempted.endpointAntipadChecks.every(check => check.status === 'exempted'), '首尾端点均应记录明确的豁免依据');

  const slightlyOffsetVias = vias.map((via, index) => Object.assign({}, via, { x: index === 0 ? 2.5 : 197.5, drill: 3.94 }));
  const offsetExempted = checkTraceReferenceMargin([trace], [endpointVoids], rule, slightlyOffsetVias)[0];
  assert.strictEqual(offsetExempted.pass, true, '端点落在 Via 焊盘连接范围内时，不应因坐标存在 2.5 mil 小偏差漏掉反焊盘豁免');

  const reverseSegmentTrace = Object.assign({}, trace, { id: 305, segments: [
    { type: 'line', x1: 100, y1: 0, x2: 200, y2: 0, width: 4, len: 100 },
    { type: 'line', x1: 100, y1: 0, x2: 0, y2: 0, width: 4, len: 100 }
  ] });
  const reverseResult = checkTraceReferenceMargin([reverseSegmentTrace], [endpointVoids], rule, vias)[0];
  assert.strictEqual(reverseResult.pass, true, '线段方向相反时仍应按拓扑度数找到真实首尾端点并豁免两端反焊盘');
  assert.deepStrictEqual(reverseResult.endpointAntipadViaIds.slice().sort(), [901, 902]);

  const exemptedGroup = groupResultsByTargetObject([exempted])[0];
  assert.match(exemptedGroup.metricsStr, /首尾端所有被检查层.*Via #901、#902 对应的反焊盘/);

  const withInteriorVoid = Object.assign({}, endpointVoids, {
    id: 431,
    voids: endpointVoids.voids.concat([{ boundary: rectBoundary(95, -10, 105, 10) }])
  });
  const interiorGap = checkTraceReferenceMargin([trace], [withInteriorVoid], rule, vias)[0];
  assert.strictEqual(interiorGap.pass, false, '走线中途的参考层 Void 不属于端点反焊盘豁免');
  assert.strictEqual(interiorGap.footprintCovered, false);
  assert.deepStrictEqual(interiorGap.failureKinds, ['footprint']);
  assert.ok(interiorGap.missingPoint && interiorGap.missingPoint.x >= 95 && interiorGap.missingPoint.x <= 105,
    '应记录中途 Void 内的首个真实缺铜点');
  assert.match(interiorGap.message, /首个走线投影缺铜点/);
  assert.match(interiorGap.missingReason, /不在已豁免的端点反焊盘内/, '中途缺铜必须明确说明不属于端点豁免范围');

  const extendedGap = Object.assign({}, endpointVoids, {
    id: 432,
    voids: endpointVoids.voids.concat([{ boundary: rectBoundary(11, -10, 30, 10) }])
  });
  assert.strictEqual(checkTraceReferenceMargin([trace], [extendedGap], rule, vias)[0].pass, false,
    '端点反焊盘边界外继续延伸的缺铜仍必须检出');
  const nearbyVoid = Object.assign({}, endpointVoids, {
    id: 433,
    voids: [{ boundary: rectBoundary(2, -10, 18, 10) }, endpointVoids.voids[1]]
  });
  assert.strictEqual(checkTraceReferenceMargin([trace], [nearbyVoid], rule, vias)[0].pass, false,
    '靠近但不包含端点 Via 的普通 Void 不得视为端点反焊盘');
  console.log('  PASS  第三项端点反焊盘豁免：首尾端所有被检查层实际反焊盘均豁免，中途或外延缺铜仍检出');
}

// 5.3 Trace #35034 实板几何：04G01P U 形走线两端的 L3 反焊盘必须豁免
{
  const circleBoundary = (cx, cy, radius, count = 36) => Array.from({ length: count }, (_, i) => {
    const a1 = Math.PI * 2 * i / count, a2 = Math.PI * 2 * (i + 1) / count;
    return { type: 'line', x1: cx + Math.cos(a1) * radius, y1: cy + Math.sin(a1) * radius,
      x2: cx + Math.cos(a2) * radius, y2: cy + Math.sin(a2) * radius };
  });
  const line = (x1, y1, x2, y2, width) => ({ type: 'line', x1, y1, x2, y2, width,
    len: Math.hypot(x2 - x1, y2 - y1) });
  const arc = (x1, y1, x2, y2, cx, cy, radius, width) =>
    ({ type: 'arc', x1, y1, x2, y2, cx, cy, radius, dir: 'CW', width });
  const trace35034 = { id: 35034, layer: '04G01P', net: '13_P', segments: [
    line(19358.96, 34300, 19358.96, 34051.9739, 4.5),
    arc(19358.96, 34051.9739, 19351.5315, 34035.6165, 19337.2358, 34051.9742, 21.7242, 4.5),
    arc(19351.5315, 34035.6165, 19338.5756, 34030.25, 19338.5756, 34048.5724, 18.3224, 4.2),
    line(19338.5756, 34030.25, 17900.585, 34030.25, 4.2),
    arc(17900.585, 34030.25, 17887.4285, 34035.6996, 17900.585, 34048.8561, 18.6061, 4.2),
    arc(17887.4285, 34035.6996, 17880, 34052.057, 17901.7242, 34052.0573, 21.7242, 4.5),
    line(17880, 34052.057, 17880, 34300, 4.5)
  ] };
  const shape1418 = { id: 1418, layer: '03IS01', net: 'GND',
    boundary: [
      line(17600, 33800, 19650, 33800), line(19650, 33800, 19650, 34400),
      line(19650, 34400, 17600, 34400), line(17600, 34400, 17600, 33800)
    ],
    voids: [
      { boundary: circleBoundary(19358.96, 34300, 13.0001) },
      { boundary: circleBoundary(17880, 34300, 13.0001) }
    ],
    bbox: { minX: 17600, minY: 33800, maxX: 19650, maxY: 34400 }
  };
  const vias = [
    { id: 31811, x: 19358.96, y: 34300, net: '13_P', hasDefinedSpan: true,
      startLayer: 'Top', endLayer: '04G01P', minLayerNum: 1, maxLayerNum: 4 },
    { id: 31810, x: 17880, y: 34300, net: '13_P', hasDefinedSpan: true,
      startLayer: 'Top', endLayer: '04G01P', minLayerNum: 1, maxLayerNum: 4 }
  ];
  const shapeL5 = Object.assign({}, shape1418, { id: 1354, layer: '05G02P', voids: [] });
  const results = checkTraceReferenceMargin([trace35034], [shape1418, shapeL5], [{
    traceLayer: 'L4', upperRefLayer: 'L3', lowerRefLayer: 'L5', minMargin: 100
  }], vias);
  const resultL3 = results.find(result => result.refLayer === 'L3');
  const resultL5 = results.find(result => result.refLayer === 'L5');
  assert.strictEqual(resultL3.traceId, 35034);
  assert.strictEqual(resultL3.pass, true, 'Trace #35034 在 L3 应仅豁免两个真实端点反焊盘并通过');
  assert.deepStrictEqual(resultL3.endpointAntipadViaIds, [31811, 31810]);
  assert.strictEqual(resultL5.pass, true, 'Trace #35034 在 L5 无端点 Void 时应直接通过完整投影检查');
  assert.deepStrictEqual(resultL5.endpointAntipadViaIds, []);
  console.log('  PASS  Trace #35034 紧凑实板回归：03IS01/L3 两端反焊盘豁免，L5 无豁免且完整通过');
}

// 5.4 规则使用 L2/L3 时，必须匹配 Allegro 物理层 02G01P/03G02P
{
  const trace = {
    id: 303, layer: '02G01P', net: 'ALIAS_LAYER_TRACE',
    segments: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, width: 10, len: 200 }]
  };
  const shapes = [
    { id: 421, layer: 'Top', bbox: { minX: -105, minY: -105, maxX: 305, maxY: 105 } },
    { id: 422, layer: '03G02P', bbox: { minX: -105, minY: 20, maxX: 305, maxY: 105 } },
    { id: 423, layer: '03G02P', bbox: { minX: -105, minY: -105, maxX: 305, maxY: -20 } }
  ];
  const results = checkTraceReferenceMargin([trace], shapes, [
    { traceLayer: 'L2', upperRefLayer: 'Top', lowerRefLayer: 'L3', minMargin: 100 }
  ]);
  assert.strictEqual(results.length, 2, 'L2 规则应匹配 02G01P 走线并检查 Top/L3 两个参考层');
  assert.strictEqual(results.find(result => result.refLayer === 'TOP').pass, true, 'Top 完整覆盖应通过');
  const l3 = results.find(result => result.refLayer === 'L3');
  assert.strictEqual(l3.pass, false, '03G02P 未覆盖完整走线投影时必须报错');
  assert.strictEqual(l3.footprintCovered, false);
  assert.strictEqual(l3.leftSideCopper, true, 'L3 左侧 100mil 内应检测到铜皮');
  assert.strictEqual(l3.rightSideCopper, true, 'L3 右侧 100mil 内应检测到铜皮');
  assert.match(l3.message, /完整线宽投影存在缺铜/);
  console.log('  PASS  第三项层别名：L2/L3 规则匹配 02G01P/03G02P 并检出走线投影缺铜');
}

// 6. 第四项：孤立小铜皮检查 (Isolated Small Copper)
{
  const shapes = [
    { id: 501, layer: 'Top', area: 1200.0, areaMm2: 0.774, centroid: { x: 100, y: 100 } },
    { id: 502, layer: '02G01P', area: 150.0, areaMm2: 0.096, centroid: { x: 500, y: 500 } } // 面积 150 < 500
  ];
  const vias = [];

  const res = checkIsolatedSmallCopper(shapes, vias, 500.0);
  assert.strictEqual(res.length, 1, '应检出 1 个面积小于 500 的孤立小铜皮');
  assert.strictEqual(res[0].shapeId, 502);
  console.log('  PASS  第四项：孤立小铜皮 / 碎铜死铜检查 (500 sq mil 阈值)');
}

// 7. 第五项：铜皮最小圆弧半径检查 (Copper Arc Minimum Radius)
{
  const shapes = [
    {
      id: 601, layer: 'Top',
      arcs: [
        { cx: 100, cy: 100, radius: 17.0 }, // >= 10.0 通过
        { cx: 200, cy: 200, radius: 6.0 }   // < 10.0 报错
      ]
    }
  ];

  const res = checkCopperArcRadius(shapes, 10.0);
  assert.strictEqual(res.length, 1, '应检出 1 处半径 < 10.0 的圆弧');
  assert.strictEqual(res[0].actualRadius, 6.0);
  console.log('  PASS  第五项：铜皮最小圆弧半径检查 (10 mil 阈值)');
}

// 8. 全量集成运行器测试 (runAllCopperChecks)
{
  const sampleTxt = fs.readFileSync(path.join(__dirname, '../../sample/铜皮数据示例.txt'), 'utf8');
  const fullRes = runAllCopperChecks(sampleTxt, {
    smallCopperAreaThreshold: 500.0,
    minArcRadius: 10.0
  });

  assert.strictEqual(fullRes.success, true);
  assert.ok(fullRes.summary.totalChecks > 0);
  console.log(`  PASS  全量 5 项铜皮检查集成运行器 (总检查项 ${fullRes.summary.totalChecks}，检出缺陷 ${fullRes.summary.totalDefects})`);
}

// 9. 走线圆弧高精度参数化插值采样与 image-1.png 全量走线解析对齐测试
{
  const { sampleArcPoints } = PourChecker;
  // Test CCW arc
  const p1 = [21186.10, 35481.67];
  const p2 = [21201.69, 35490.67];
  const center = [21186.1015, 35499.6701];
  const radius = 18.0001;
  const ptsCCW = sampleArcPoints(center, radius, p1, p2, 'CCW', 24);
  assert.strictEqual(ptsCCW.length, 25);
  assert.ok(Math.hypot(ptsCCW[0][0] - p1[0], ptsCCW[0][1] - p1[1]) < 1e-2, '起点应与 p1 一致');
  assert.ok(Math.hypot(ptsCCW[24][0] - p2[0], ptsCCW[24][1] - p2[1]) < 1e-2, '终点应与 p2 一致');

  // Test EDA coordinate report with < Trace Seg > items (image-1.png layout dataset)
  const airgapTxt = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
  const parsedAirgap = parsePcbElements(airgapTxt);
  assert.strictEqual(parsedAirgap.vias.length, 26, '应解析出 26 个过孔 (包含 BGA 阵列与 GND 孔)');
  assert.strictEqual(parsedAirgap.traces.length, 71, '应解析出 71 条走线段');

  const netSet = new Set(parsedAirgap.traces.map(t => t.net));
  assert.ok(netSet.has('25_N'), '应包含 25_N 网络 (对应 P2 端口)');
  assert.ok(netSet.has('25_P'), '应包含 25_P 网络 (对应 P3 端口)');
  assert.ok(netSet.has('26_N'), '应包含 26_N 网络 (对应 P1 端口)');
  assert.ok(netSet.has('26_P'), '应包含 26_P 网络 (对应 P4 端口)');
  console.log('  PASS  圆弧高精度参数化插值采样与 image-1.png 走线/过孔全量元素解析对齐');
}


// 10. 圆弧扫掠角：点位于弧的「缺口」方向时，最近点必须是弧端点
{
  const shape = {
    id: 900, layer: 'Top', bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100, spanX: 100, spanY: 100 },
    boundary: [
      { type: 'line', x1: 100, y1: 0, x2: 100, y2: 0, width: 0 },
      { type: 'arc', x1: 100, y1: 0, x2: 0, y2: 100, cx: 0, cy: 0, radius: 100, ccw: true }
    ],
    arcs: [{ cx: 0, cy: 0, radius: 100 }]
  };
  const px = -110, py = -110;                       // 225° 方向，落在弧的缺口里
  const got = PourChecker.pointToShapeDistance(px, py, shape);
  const toEndpoint = Math.min(Math.hypot(px - 100, py), Math.hypot(px, py - 100));
  const wrong = Math.abs(Math.hypot(px, py) - 100); // 旧算法：|d - r|
  assert.ok(Math.abs(got - toEndpoint) < 1e-6, `应取弧端点距离 ${toEndpoint.toFixed(3)}，实得 ${got.toFixed(3)}`);
  assert.ok(got > wrong + 50, '仍在使用 |d-r| 的错误近似');
  console.log('  PASS  圆弧扫掠角：缺口方向的点按弧端点取距（不再用 |d−r| 逼近）');
}

// 11. 点在形内判定：L 形铜皮的包围盒中心不在铜皮上
{
  const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
  const boundary = L.map((p, i) => ({
    type: 'line', x1: p[0], y1: p[1], x2: L[(i + 1) % L.length][0], y2: L[(i + 1) % L.length][1], width: 0
  }));
  const shape = {
    id: 901, layer: '02G01P', boundary, arcs: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100, spanX: 100, spanY: 100 }
  };
  const inside = PourChecker.pointToShapeDistance(10, 10, shape);
  const outsideButInBBox = PourChecker.pointToShapeDistance(50, 50, shape);
  assert.strictEqual(inside, 0, 'L 形铜皮内部点应为 0');
  assert.ok(Math.abs(outsideButInBBox - 30) < 1e-6,
    `包围盒内但铜皮外的点应返回真实边界距离 30，实得 ${outsideButInBBox}`);
  console.log('  PASS  点在形内判定：L 形/带缺口铜皮的包围盒中心不再被误判为「在上面」');
}

// 12. 孤立小铜皮判定：过孔是否真的落在铜皮轮廓内（同层）
{
  const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
  const boundary = L.map((p, i) => ({
    type: 'line', x1: p[0], y1: p[1], x2: L[(i + 1) % L.length][0], y2: L[(i + 1) % L.length][1], width: 0
  }));
  const shape = {
    id: 902, layer: '02G01P', area: 120, areaMm2: 0.077, boundary, arcs: [],
    centroid: { x: 20, y: 20 },
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100, spanX: 100, spanY: 100 }
  };
  // 质心附近(20,20)有过孔，但包围盒中心(50,50)在铜皮外
  const insideVia = [{ id: 1, x: 10, y: 10 }, ];
  const outsideVia = [{ id: 2, x: 50, y: 50 }];

  const a = checkIsolatedSmallCopper([shape], insideVia, 500);
  const b = checkIsolatedSmallCopper([shape], outsideVia, 500);
  assert.strictEqual(a[0].containsVia, true, '孔在铜皮轮廓内应判为已连接');
  assert.strictEqual(a[0].viaInsideId, 1);
  assert.strictEqual(b[0].containsVia, false, '孔不在轮廓内（即使靠近质心）不应判为已连接');
  assert.strictEqual(a[0].containsViaBy, 'outline');
  console.log('  PASS  孤立小铜皮：按轮廓点内判定 + 同层过滤（不再用「质心 30 mil 内」近似）');
}

// 13. Allegro Shape：Exterior + 重复 Void，Original Boundary 不得混入真实铜皮
{
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/shape-with-voids.txt'), 'utf8');
  const parsed = parsePcbElements(txt);
  assert.deepStrictEqual(parsed.shapes.map(shape => shape.id), [1, 2, 308]);

  const item1 = parsed.shapes[0];
  assert.strictEqual(item1.boundary.length, 4, 'Item 1 exterior 应只有四条边');
  assert.strictEqual(item1.voids.length, 2, 'Item 1 应保留两个有序 Void');
  assert.strictEqual(item1.voids[0].boundary.length, 4);
  assert.strictEqual(item1.voids[1].boundary.length, 1);
  assert.strictEqual(item1.arcs.length, 1, 'Void 圆弧也应进入 Shape 圆弧检查集合');
  assert.strictEqual(item1.bbox.minX, 0, 'Original Boundary 的 -500 不得污染 bbox');
  assert.strictEqual(item1.bbox.maxX, 100, 'Original Boundary 的 500 不得污染 bbox');
  assert.ok(Math.abs(item1.areaComputed - item1.areaReported) < 2.5,
    `扣除 Void 后面积应接近报告值，实得 ${item1.areaComputed}`);
  assert.strictEqual(PourChecker.shapeRings(item1).length, 3, '应缓存 exterior + 两个 Void 环');
  console.log('  PASS  Allegro Shape：重复 Void 有序解析，Original Boundary 与真实铜皮隔离');
}

// 14. 全圆 exterior / Void 的 CW、CCW 方向和孔洞距离必须正确
{
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/shape-with-voids.txt'), 'utf8');
  const item2 = parsePcbElements(txt).shapes.find(shape => shape.id === 2);
  assert.strictEqual(item2.boundary[0].ccw, true);
  assert.strictEqual(item2.voids[0].boundary[0].ccw, false, 'CW 全圆 Void 方向应保留');
  assert.ok(item2._ring.length > 60 && item2._voidRings[0].length > 30, '全圆应完整离散而非退化为单点');
  assert.strictEqual(PourChecker.pointToShapeDistance(30, 0, item2), 0, '圆环铜区内距离应为 0');
  assert.ok(Math.abs(PourChecker.pointToShapeDistance(0, 0, item2) - 20) < 1e-6,
    'Void 中心到铜皮的距离应为内圆半径 20');
  assert.strictEqual(PourChecker.pointInShape(0, 0, item2), false, 'Void 中心不是铜');
  assert.strictEqual(PourChecker.pointInShape(30, 0, item2), true, '圆环区域是铜');
  console.log('  PASS  全圆 Shape/Void：CW/CCW 保真，孔洞不再被判为铜');
}

// 15. Item 308 混合直线/圆弧孔洞同时用于几何检查与参考层覆盖
{
  const txt = fs.readFileSync(path.join(__dirname, '../../sample/shape-with-voids.txt'), 'utf8');
  const item308 = parsePcbElements(txt).shapes.find(shape => shape.id === 308);
  assert.deepStrictEqual(item308.boundary.map(seg => seg.type),
    ['line', 'arc', 'line', 'arc', 'line', 'line']);
  assert.deepStrictEqual(item308.voids[0].boundary.map(seg => seg.type),
    ['line', 'arc', 'line', 'arc']);
  assert.strictEqual(PourChecker.pointInShape(50, 50, item308), false, '胶囊形 Void 内不是铜');
  assert.ok(Math.abs(PourChecker.pointToShapeDistance(50, 50, item308) - 10) < 0.01,
    '胶囊形 Void 中心到铜边距离应为 10 mil');

  const isolated = checkIsolatedSmallCopper([
    Object.assign({}, item308, { area: 100, areaMm2: 0.0645 })
  ], [{ id: 88, x: 50, y: 50, layer: '19IS08' }], 500);
  assert.strictEqual(isolated[0].containsVia, false, '落在 Void 中的过孔不能算作落在铜皮上');

  const item2 = parsePcbElements(txt).shapes.find(shape => shape.id === 2);
  const margin = checkTraceReferenceMargin([{
    id: 99, layer: 'L1', net: 'TEST', width: 2,
    segments: [{ type: 'line', x1: -30, y1: 0, x2: 30, y2: 0, width: 2, len: 60 }]
  }], [item2], [{ traceLayer: 'L1', upperRefLayer: '02G01P', lowerRefLayer: '', minMargin: 1 }]);
  assert.strictEqual(margin.length, 1);
  assert.strictEqual(margin[0].pass, false, '走线穿过 Void 时参考层覆盖必须判失败');
  console.log('  PASS  Item 308：混合线/弧 Void 参与点内、距离、孤铜与参考层覆盖检查');
}

console.log('\n结果: 全部 17 项铜皮检查单元测试通过！');
