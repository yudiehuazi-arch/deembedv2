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
  assert.strictEqual(PourChecker.shapeItemsTouch(parsed.shapes[0], parsed.shapes[1], 0.05), true,
    '同层同网络的圆形与矩形 Item 应识别为相接铜皮');
  const vias = [
    { id: 10, x: 17880, y: 35965.0001, padstack: 'MULTI_TARGET', net: '9_N' },
    { id: 11, x: 17881, y: 35965.0001, padstack: 'HDI_NEAR', net: '9_N' }
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
      padstack: 'BGA_3510', differentialCenterDistance: 1.0, layer: '02G01P；L3',
      expectedArea: 452.38, areaTolerance: 10.0
    }
  ];

  const res = checkSpecialShapedCopper(vias, shapes, templates);
  assert.strictEqual(res.length, 4, '差分对两颗孔在两个目标层均应生成模板检查记录');
  assert.deepStrictEqual([...new Set(res.map(item => item.layer))].sort(), ['02G01P', 'L3']);
  assert.ok(res.filter(item => item.layer === '02G01P').every(item => item.pass));
  assert.ok(res.filter(item => item.layer === 'L3').every(item => !item.pass));
  assert.ok(res.every(item => item.actualDifferentialCenterDistance === 1));
  assert.ok(res.every(item => [12, 13].includes(item.actualHdiViaId) && item.hdiSearchRadiusMm === null), '未配置 HDI 搜索距离时不得恢复默认值');
  const grouped = groupResultsByTargetObject(res);
  assert.strictEqual(grouped.length, 2, '每颗差分孔的多个目标层应汇总为一个对象');
  assert.ok(grouped.every(item => !item.pass && item.failCount === 1 && item.subRecords.length === 2 && item.layerListStr.includes('L3')));
  console.log('  PASS  第二项：过孔类型、差分孔中心距与多个目标层依次匹配异型铜皮模板');
}

// 4. 每颗目标 Via 独立关联最近的同网络 HDI Via，并按实测中心距选择模板
{
  const defaultRadiusMil = 0.175 * 1000 / 25.4;
  const vias = [
    { id: 20, x: 0, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_A' },
    { id: 21, x: 20, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_B' },
    { id: 22, x: 40, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_C' },
    { id: 23, x: 60, y: 0, padstack: 'TYPE_A_SIG', net: 'NET_D' },
    // NET_A 的等距 HDI 候选故意逆 ID 排列，确定性规则应选较小 ID 30。
    { id: 31, x: -2, y: 0, padstack: 'LASER_HDI_A_TIE', net: 'NET_A' },
    { id: 30, x: 2, y: 0, padstack: 'HDI_LASER_A_NEAREST', net: 'NET_A' },
    { id: 38, x: 5, y: 0, padstack: 'HDI_LASER_A_FARTHER', net: 'NET_A' },
    { id: 32, x: 0.25, y: 0, padstack: 'HDI_WRONG_NET', net: 'OTHER' },
    { id: 33, x: 0.5, y: 0, padstack: 'MICRO_LASER', net: 'NET_A' },
    { id: 34, x: 25, y: 0, padstack: 'laser_hdi_b', net: 'net_b' },
    { id: 35, x: 41, y: 0, padstack: 'HDI_ONLY_WRONG_NET', net: 'OTHER' },
    { id: 36, x: 60 + defaultRadiusMil, y: 0, padstack: 'HDI_BOUNDARY', net: 'NET_D' }
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
  assert.strictEqual(res.length, 3, '三颗有合格同网络 HDI 孔的目标 Via 应各自选择一个中心距模板');
  assert.deepStrictEqual(res.map(item => item.viaId).sort((a, b) => a - b), [20, 21, 23]);
  assert.deepStrictEqual(res.map(item => item.templateId).sort(), ['distance_2', 'distance_5', 'inclusive_boundary']);
  assert.ok(res.every(item => item.pass && item.hdiSearchRadiusMm === null), '未配置搜索距离时仅应用中心距约束');
  assert.strictEqual(res.find(item => item.viaId === 20).actualHdiViaId, 30, '多个/等距候选必须稳定选择最近且 ID 较小的 HDI Via');
  assert.strictEqual(res.find(item => item.viaId === 20).actualDifferentialCenterDistance, 2);
  assert.strictEqual(res.find(item => item.viaId === 21).actualHdiViaId, 34, '网络匹配应忽略大小写');
  assert.ok(Math.abs(res.find(item => item.viaId === 23).actualDifferentialCenterDistance - defaultRadiusMil) < 1e-9, '未配置搜索距离时仍应按中心距找到同网络 HDI 孔');
  assert.ok(!res.some(item => item.viaId === 22), '无同网络 HDI 候选的目标 Via 不应匹配模板');
  assert.ok(!res.some(item => item.templateId === 'narrow_search'), '缩小可配置搜索距离后不得关联范围外 HDI Via');
  assert.ok(res.every(item => item.pairedViaId == null && item.pairedHdiViaId == null), '规则 2 不得依赖 _P/_N 目标孔配对');
  console.log('  PASS  第二项：目标 Via 到最近同网络 HDI Via 的独立中心距、边界与可配置搜索距离');
}

// 4.1 差分孔中心距与 HDI 搜索距离分别可选，且只应用已配置字段
{
  const vias = [
    { id: 40, x: 0, y: 0, padstack: 'OPT_NONE', net: 'NO_HDI' },
    { id: 41, x: 30, y: 0, padstack: 'OPT_CENTER', net: 'CENTER_NET' },
    { id: 42, x: 60, y: 0, padstack: 'OPT_RADIUS', net: 'RADIUS_NET' },
    { id: 43, x: 90, y: 0, padstack: 'OPT_BOTH', net: 'BOTH_NET' },
    { id: 51, x: 40, y: 0, padstack: 'HDI_CENTER', net: 'CENTER_NET' },
    { id: 52, x: 63, y: 0, padstack: 'HDI_RADIUS', net: 'RADIUS_NET' },
    { id: 53, x: 92, y: 0, padstack: 'HDI_BOTH', net: 'BOTH_NET' }
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
  assert.strictEqual(byTemplate.get('optional_radius').actualDifferentialCenterDistance, 3);
  assert.strictEqual(byTemplate.get('optional_both').actualDifferentialCenterDistance, 2);
  assert.strictEqual(byTemplate.get('optional_both').hdiSearchRadiusMm, 0.1);
  assert.ok(!/HDI|中心距|搜索距离/.test(byTemplate.get('optional_none').message), '两项留空时结果描述不得虚构 HDI 约束');
  const grouped = new Map(groupResultsByTargetObject(res).map(item => [item.viaId, item]));
  assert.ok(!/中心距|搜索距离|HDI/.test(grouped.get(40).metricsStr));
  assert.ok(/中心距规则 10 mil/.test(grouped.get(41).metricsStr) && !/搜索距离/.test(grouped.get(41).metricsStr));
  assert.ok(!/中心距规则/.test(grouped.get(42).metricsStr) && /搜索距离 ≤ 0.1 mm/.test(grouped.get(42).metricsStr));
  console.log('  PASS  第二项：中心距与 HDI 搜索距离支持均留空、仅中心距、仅搜索距离和同时配置');
}

// 4.2 PTH-SIG L5/L10 四种 HDI 偏移的内置模板必须覆盖该孔型
{
  const specs = [
    { mm: 0.025, area: 113.09734 },
    { mm: 0.075, area: 50.26548 },
    { mm: 0.125, area: 97.38257 },
    { mm: 0.175, area: 101.16052 }
  ];
  const vias = [], shapes = [];
  specs.forEach((spec, index) => {
    const x = index * 100;
    vias.push({ id: 300 + index, x, y: 0, padstack: 'PTH-SIG-150drill-ring0_L5_L10', net: `PTH_${index}` });
    vias.push({ id: 310 + index, x: x + spec.mm * PourChecker.MIL_PER_MM, y: 0, padstack: 'BGA-HDI-SIG-045drill-ring3', net: `PTH_${index}` });
    ['05G02P', '10G07P'].forEach((layer, layerIndex) => {
      shapes.push({
        id: 320 + index * 2 + layerIndex, layer,
        area: spec.mm === 0.125 ? 50.26548 : spec.area,
        centroid: { x, y: 0 }
      });
    });
  });
  const templates = getDefaultSpecialShapeTemplates().filter(template => template.padstack === 'PTH-SIG-150drill-ring0_L5_L10');
  const results = checkSpecialShapedCopper(vias, shapes, templates);
  assert.strictEqual(templates.length, 4, '应内置 0.025/0.075/0.125/0.175 mm 四种 PTH-SIG 模板');
  assert.strictEqual(results.length, 8, '四颗 PTH-SIG 孔应在 L5/L10 各生成一条检查记录');
  assert.deepStrictEqual([...new Set(results.map(result => result.viaId))].sort(), [300, 301, 302, 303]);
  assert.strictEqual(results.filter(result => !result.pass).length, 2, '0.125 mm 偏移孔的两层面积异常应被检出');
  console.log('  PASS  第二项：PTH-SIG L5/L10 四种 HDI 偏移模板完整覆盖');
}

// 5. 第三项：走线上/下参考层铺铜覆盖与单侧超宽检查 (Trace Reference Layer Margin)
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
    // L3 上参考层：单侧超宽 60mil > 50mil (通过)
    {
      id: 401, layer: 'L3', area: 50000,
      bbox: { minX: 900, minY: 937, maxX: 1300, maxY: 1063 } // Y方向 1000 ± 63 mil -> 单侧外延 60mil
    },
    // L5 下参考层：单侧超宽仅 20mil < 50mil (超差报错)
    {
      id: 402, layer: 'L5', area: 20000,
      bbox: { minX: 950, minY: 977, maxX: 1250, maxY: 1023 } // Y方向 1000 ± 23 mil -> 单侧外延 20mil
    }
  ];

  const rules = [
    { id: 'm1', traceLayer: 'L4', upperRefLayer: 'L3', lowerRefLayer: 'L5', minMargin: 50.0 }
  ];

  const res = checkTraceReferenceMargin(traces, shapes, rules);
  assert.strictEqual(res.length, 2, '包含上参考层 L3 与下参考层 L5');

  const l3Res = res.find(r => r.refLayer === 'L3');
  assert.strictEqual(l3Res.pass, true, 'L3 单侧外延 60mil >= 50mil 应通过');

  const l5Res = res.find(r => r.refLayer === 'L5');
  assert.strictEqual(l5Res.pass, false, 'L5 单侧外延 20mil < 50mil 应报错');
  console.log('  PASS  第三项：走线上/下参考层铺铜覆盖与单侧 50mil 超宽检查');
}

// 5.1 单侧超宽表示走线边缘外规则距离范围必须全部有铜，可由相接铜皮共同覆盖
{
  const trace = {
    id: 302, layer: 'L4', net: 'PCIE_RX_P',
    segments: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, width: 10, len: 200 }]
  };
  const rule = [{ traceLayer: 'L4', upperRefLayer: 'L3', minMargin: 100 }];
  const continuousSplitCopper = [
    { id: 411, layer: 'L3', bbox: { minX: -105, minY: 0, maxX: 305, maxY: 105 } },
    { id: 412, layer: 'L3', bbox: { minX: -105, minY: -105, maxX: 305, maxY: 0 } }
  ];
  const covered = checkTraceReferenceMargin([trace], continuousSplitCopper, rule)[0];
  assert.strictEqual(covered.pass, true, '走线边缘外 100mil 范围由相接铜皮完整覆盖时应通过');
  assert.match(covered.message, /走线边缘外 100 mil 范围内连续有铜/);

  const copperWithGap = [
    { id: 413, layer: 'L3', bbox: { minX: -105, minY: 10, maxX: 305, maxY: 105 } },
    { id: 414, layer: 'L3', bbox: { minX: -105, minY: -105, maxX: 305, maxY: -10 } }
  ];
  const uncovered = checkTraceReferenceMargin([trace], copperWithGap, rule)[0];
  assert.strictEqual(uncovered.pass, false, '走线边缘外 100mil 范围内存在缺铜带时必须不通过');
  assert.match(uncovered.message, /100 mil 范围存在未铺铜区域/);
  console.log('  PASS  第三项语义：走线边缘外规则距离范围必须全部连续有铜');
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
