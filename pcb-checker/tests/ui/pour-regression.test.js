/* 由旧版 pour.html 单体 UI 测试迁移：加载方式改为 openPage，断言保持原口径，按新三栏结构修正选择器 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { openPage, tick, CHECKER_DIR } = require('../helpers/open-page');
const __dir = CHECKER_DIR;
const ctx = openPage('pour.html', { syncCheck: true });
const w = ctx.w, d = w.document, window = w, document = d;
const $ = id => d.getElementById(id);
let domErr = 0;
const PourChecker = require('../../packages/engines/pour/index.js');
(async () => {
await tick(250);
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


console.log('== 铜皮检查 (Copper Pour Inspection) UI、多规则、对象汇总与规律分析测试 ==');

test('页面基本元素、5 个工序与检查说明页签存在', () => {
  if (!d.title.includes('铜皮检查')) throw new Error('标题不包含铜皮检查');
  const tabs = d.querySelectorAll('nav#tabs button');
  if (tabs.length !== 6) throw new Error('五个工序与检查说明页签应为 6，实际 ' + tabs.length);
});

test('规则 1、规则 2、规则 3 多规则配置表格与卡片存在', () => {
  if (!$('tblRule1Body')) throw new Error('缺少 Rule 1 表格体');
  if (!$('tblRule2Body')) throw new Error('缺少 Rule 2 表格体');
  if (!$('tblRule3Body')) throw new Error('缺少 Rule 3 表格体');
  if (w.State.viaCoverageRules.length < 2) throw new Error('Rule 1 初始规则应至少有 2 条');
  if (w.State.specialShapeTemplates.length < 2) throw new Error('Rule 2 初始模板应至少有 2 条');
  if (w.State.traceMarginRules.length < 2) throw new Error('Rule 3 初始规则应至少有 2 条');
});

test('每个输入框下方均存在历史快捷选项栏 (History Chips)', () => {
  const chipBars = [
    'chipsModalR1Padstack', 'chipsModalR1Layers', 'chipsModalR1Dist',
    'chipsModalR2Name', 'chipsModalR2Padstack', 'chipsModalR2DiffDist', 'chipsModalR2HdiRadius', 'chipsModalR2Layer', 'chipsModalR2Tol',
    'chipsModalR3TraceLayer', 'chipsModalR3UpperRef', 'chipsModalR3LowerRef', 'chipsModalR3Margin',
    'chipsRule4Area', 'chipsRule5Radius'
  ];

  chipBars.forEach(id => {
    const el = $(id);
    if (!el) throw new Error(`缺少历史选项栏: ${id}`);
    if (!el.innerHTML.includes('chip') && !el.innerHTML.includes('快捷选项')) {
      throw new Error(`历史选项栏 ${id} 未正确渲染历史标签`);
    }
  });
});

test('历史快捷标签点击即可回填输入框', () => {
  const chip = d.querySelector('#chipsRule4Area .chip');
  if (!chip) throw new Error('未找到 Rule 4 快捷标签');
  const chipText = chip.textContent.replace(' sq mil', '').trim();
  chip.click();
  if ($('rule4InpArea').value !== chipText) {
    throw new Error(`回填失败: 预期 ${chipText}, 实际 ${$('rule4InpArea').value}`);
  }
});

test('弹窗新增规则 1 (孔铺铜覆盖规则) 并保存', () => {
  w.openAddRule1Modal();
  if (!$('modalRule1').classList.contains('open')) throw new Error('Modal 1 未打开');
  $('modalR1InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR1InpLayers').value = '02G01P, 19IS08';
  $('modalR1InpDist').value = '45.0';
  w.saveRule1FromModal();
  if ($('modalRule1').classList.contains('open')) throw new Error('Modal 1 未在保存后关闭');
  const found = w.State.viaCoverageRules.some(r => r.padstack === 'BGA_GND_pad1mil_0902');
  if (!found) throw new Error('新增的规则 1 未存入 State');
});

test('弹窗导入 Shape TXT 并解析异型铜皮几何与面积 (规则 2)', () => {
  w.openAddRule2Modal();
  if (!$('modalRule2').classList.contains('open')) throw new Error('Modal 2 未打开');
  $('modalR2InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR2InpDiffDist').value = '19.68';
  $('modalR2InpHdiRadius').value = '0.15';
  $('modalR2InpLayer').value = '02G01P';
  $('modalR2TxtShape').value = `Item 1  < Shape >\n  Subset: 02G01P\n  Area: 907.92028 (sq mil)\nExterior Boundary:\n  Arc seg: xy [21208.94, 35522.46]  xy [21208.94, 35522.46]\n    Center-xy: [21220.94, 35522.46] Radius (12.0000) CCW`;
  w.previewModalShape();
  if (!w.State.modalShapeParsed) throw new Error('未解析出 Shape 对象');
  if (Math.abs(w.State.modalShapeParsed.area - 907.92028) > 0.001) throw new Error('解析的面积不符合预期');
  w.saveRule2FromModal();
  if ($('modalRule2').classList.contains('open')) throw new Error('Modal 2 未在保存后关闭');
  const found = w.State.specialShapeTemplates.some(t => Math.abs(t.expectedArea - 907.92028) < 0.1 && t.differentialCenterDistance === 19.68 && t.hdiSearchRadiusMm === 0.15);
  if (!found) throw new Error('新增的规则 2 模板、差分孔中心距与 HDI 搜索距离未存入 State');
});

test('弹窗新增规则 3 (走线参考层投影覆盖与两侧邻近铜规则) 并保存', () => {
  w.openAddRule3Modal();
  if (!$('modalRule3').classList.contains('open')) throw new Error('Modal 3 未打开');
  $('modalR3InpTraceLayer').value = '19IS08';
  $('modalR3InpUpperRef').value = '02G01P';
  $('modalR3InpLowerRef').value = 'Bottom';
  $('modalR3InpMargin').value = '42.0';
  w.saveRule3FromModal();
  if ($('modalRule3').classList.contains('open')) throw new Error('Modal 3 未在保存后关闭');
  const found = w.State.traceMarginRules.some(r => r.traceLayer === '19IS08' && r.minMargin === 42.0);
  if (!found) throw new Error('新增的规则 3 未存入 State');
});

test('【保存规则到本地 (JSON)】整页规则导出功能验证', () => {
  let exportCaptured = null;
  w.showExportBox = function(filename, text, hint) {
    exportCaptured = { filename, text, hint };
  };

  w.exportRulesToLocalFile();
  if (!exportCaptured) throw new Error('未调用 showExportBox 导出规则');
  if (!exportCaptured.filename.includes('.json')) throw new Error('导出文件名应为 json');

  const json = JSON.parse(exportCaptured.text);
  if (!json.viaCoverageRules || json.viaCoverageRules.length === 0) throw new Error('导出 JSON 缺少 viaCoverageRules');
  if (!json.specialShapeTemplates || json.specialShapeTemplates.length === 0) throw new Error('导出 JSON 缺少 specialShapeTemplates');
  if (!json.specialShapeTemplates.every(t => t.differentialCenterDistance > 0 && t.hdiSearchRadiusMm > 0)) throw new Error('导出 JSON 缺少差分孔中心距或 HDI 搜索距离');
  if (!json.traceMarginRules || json.traceMarginRules.length === 0) throw new Error('导出 JSON 缺少 traceMarginRules');
  if (typeof json.smallCopperAreaThreshold !== 'number') throw new Error('导出 JSON 缺少 smallCopperAreaThreshold');
  if (typeof json.minArcRadius !== 'number') throw new Error('导出 JSON 缺少 minArcRadius');
  if (!json.history) throw new Error('导出 JSON 缺少 history 记录');

  const status = $('lblRuleFileStatus');
  if (!status || status.style.display === 'none') throw new Error('未显示导出成功状态横幅');
});

test('【从本地文件读取约束 (JSON)】规则导入与一键恢复验证', () => {
  const customRulePack = {
    version: '1.0',
    tool: 'pcb_pour_checker',
    viaCoverageRules: [
      { id: 'custom_cov_1', padstack: 'TEST_CUSTOM_VIA_STACK', layers: 'L1-L12', coverageRadius: 60.0 }
    ],
    specialShapeTemplates: [
      { id: 'custom_tmpl_1', name: '测试专用异型铜皮模板', padstack: 'TEST_CUSTOM_VIA_STACK', differentialCenterDistance: 23.62, hdiSearchRadiusMm: 0.15, layer: '19IS08', expectedArea: 320.0, areaTolerance: 15.0, rawShapeText: '' }
    ],
    traceMarginRules: [
      { id: 'custom_margin_1', traceLayer: '08IS03', upperRefLayer: 'Top', lowerRefLayer: 'Bottom', minMargin: 55.0 }
    ],
    smallCopperAreaThreshold: 350.0,
    minArcRadius: 8.5,
    history: {
      r1_padstack: ['TEST_CUSTOM_VIA_STACK']
    }
  };

  w.applyRuleSnapshot(customRulePack, true);

  if (w.State.viaCoverageRules.length !== 1 || w.State.viaCoverageRules[0].padstack !== 'TEST_CUSTOM_VIA_STACK') {
    throw new Error('规则 1 未正确恢复');
  }
  if (w.State.specialShapeTemplates.length !== 1 || w.State.specialShapeTemplates[0].name !== '测试专用异型铜皮模板' || w.State.specialShapeTemplates[0].differentialCenterDistance !== 23.62 || w.State.specialShapeTemplates[0].hdiSearchRadiusMm !== 0.15) {
    throw new Error('规则 2 模板、差分孔中心距与 HDI 搜索距离未正确恢复');
  }
  if (w.State.traceMarginRules.length !== 1 || w.State.traceMarginRules[0].minMargin !== 55.0) {
    throw new Error('规则 3 未正确恢复');
  }
  if ($('rule4InpArea').value !== '350') {
    throw new Error('规则 4 输入框值未更新为 350');
  }
  if ($('rule5InpRadius').value !== '8.5') {
    throw new Error('规则 5 输入框值未更新为 8.5');
  }
});

test('【一键复制全部内容】导出浮窗复制功能 Fail-Safe 验证', () => {
  $('exportModalText').value = 'TEST_EXPORT_CONTENT_CLIPBOARD';
  w.copyExportContent();
  const tip = $('copySuccessTip');
  if (!tip || tip.style.display !== 'inline-flex') {
    throw new Error('复制成功提示未显示');
  }
});

test('规则 2 模板关联未命中时显示 HDI 搜索距离与差分 HDI 中心距', () => {
  const problem = w.formatPourResultProblem({
    checkCategory: 'special_shape', layer: '05G02P', pass: false,
    associationFailed: true,
    associationSummary: '孔 #31838 已在 6.89 mil 内关联同网络 HDI 孔 #31839，该 HDI 与差分 HDI 孔 #32083 的实测中心距 31.495 mil 不满足规则 19.685 / 23.62 / 27.56 mil'
  });
  if (!problem.includes('模板关联条件未命中') || !problem.includes('已在 6.89 mil 内关联') || !problem.includes('实测中心距 31.495 mil 不满足规则')) {
    throw new Error('规则 2 未分别显示目标孔到 HDI 的关联距离和差分 HDI 中心距');
  }
});

test('【目标对象汇总展示】同一目标对象的多层问题自动汇总聚合', () => {
  w.State.viaCoverageRules = [
    { id: 'cov_hdi', padstack: 'HDI_045drill', layers: 'L1-L4', coverageRadius: 50.0 }
  ];

  const sampleMultiLayerTxt = `
Total 3 Items
Item 53  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_N
  Location: [21220.94, 35522.46]

Item 54  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_N
  Location: [21250.94, 35522.46]

Item 55  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_P
  Location: [21280.94, 35522.46]
`;

  $('txtDataInput').value = sampleMultiLayerTxt;
  w.executeCopperChecks();

  if (w.State.rawResults.length !== 12) {
    throw new Error(`逐层原始记录应为 3孔 × 4层 = 12条，实际为 ${w.State.rawResults.length}`);
  }

  if (w.State.groupedResults.length !== 3) {
    throw new Error(`按目标对象汇总后应聚合为 3 个孔对象，实际为 ${w.State.groupedResults.length}`);
  }

  const via53Group = w.State.groupedResults.find(g => String(g.viaId) === '53');
  if (!via53Group) throw new Error('未找到孔 #53 汇总对象');
  if (via53Group.failCount !== 4) throw new Error('孔 #53 应汇总 4 层超标');
  if (!via53Group.layerListStr.includes('L1, L2, L3, L4')) throw new Error('孔 #53 涉及层别应列出 L1, L2, L3, L4');

  // Verify UI rendering in grouped mode
  w.setViewMode('grouped');
  const rows = d.querySelectorAll('#tblResultsBody tr');
  if (rows.length !== 3) {
    throw new Error(`汇总视图下表格应只渲染 3 行，实际为 ${rows.length} 行`);
  }

  // Test expanding sub-rows
  w.toggleRowExpand(via53Group.groupKey);
  const subRows = d.querySelectorAll('#tblResultsBody tr.subrow');
  if (subRows.length !== 1) throw new Error('展开后应出现 1 个嵌套明细子表行');
});

test('【走线导入与空间可视化】走线解析、2D 画布渲染与参考层投影及邻近铜检查验证', () => {
  const mixedDataTxt = `
Total 3 Items
Item 1  < Shape >
  Set: ETCH
  Subset: 02G01P
  Area: 50000.0 (sq mil)
  Exterior Boundary:
    Line seg: xy [24000, 23000]  xy [26000, 23000]
    Line seg: xy [26000, 23000]  xy [26000, 24000]
    Line seg: xy [26000, 24000]  xy [24000, 24000]
    Line seg: xy [24000, 24000]  xy [24000, 23000]

Item 2  < Trace >
  Set: Trace
  Subset: 19IS08
  Net: 105_P
  Length: 2000.068301
  Seg: xy [25018.9300, 23592.4500]  xy [24669.2400, 23592.4500] Width (5.6000) Angle (0.000)
  Arc seg: xy [24669.2400, 23592.4500]  xy [24616.8500, 23940.0700] Width (5.6000)
    Center-xy: [24669.2300, 23640.0700]  Radius (52.3800) CCW
  Seg: xy [24616.8500, 23540.0700]  xy [24916.8500, 23456.2000] Width (5.6000) Angle (90.000)

Item 3  < Via >
  Padstack Name: BGA_GND_pad1mil_0902
  Layer: 02G01P
  Origin-xy: [24669.23, 23640.07]
`;

  w.State.traceMarginRules = [
    { id: 'margin_rule_test', traceLayer: '19IS08', upperRefLayer: '02G01P', lowerRefLayer: 'Bottom', minMargin: 50.0 }
  ];

  $('txtDataInput').value = mixedDataTxt;
  w.executeCopperChecks();

  if (w.State.traces.length !== 1) {
    throw new Error(`应解析出 1 条走线，实际为 ${w.State.traces.length}`);
  }
  if (w.State.traces[0].segments.length !== 3) {
    throw new Error(`走线应包含 3 段（直线+圆弧），实际为 ${w.State.traces[0].segments.length}`);
  }

  // Verify Trace Margin check
  const marginResults = w.State.rawResults.filter(r => r.checkCategory === 'trace_ref_margin');
  if (marginResults.length !== 2) {
    throw new Error(`走线参考层检查应生成 2 条记录（上参考 02G01P 与下参考 Bottom），实际为 ${marginResults.length}`);
  }

  const upperRes = marginResults.find(r => r.refLayer.toUpperCase() === '02G01P');
  if (!upperRes || !upperRes.pass) {
    throw new Error('走线投影完整覆盖且左右两侧 50mil 内均有铜时应判定为符合');
  }

  const lowerRes = marginResults.find(r => r.refLayer.toUpperCase() === 'BOTTOM');
  if (!lowerRes || lowerRes.pass) {
    throw new Error('走线在无铜皮的 Bottom 层应判定为不符合');
  }

  // Switch to Canvas Tab and test rendering
  w.switchTab('tabCanvas');
  w.renderCanvas();
});

test('【⑤ 缺陷规律与工程分析】五大分类深度归纳总结与导出', () => {
  w.switchTab('tabAnalysis');
  const container = $('pnlAnalysisContainer');
  if (!container || container.innerHTML.includes('尚无检查数据')) {
    throw new Error('分析页未渲染归纳总结卡片');
  }

  const text = container.textContent;
  if (!text.includes('① 孔经过层铺铜覆盖检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 1 规律分析');
  if (!text.includes('② 特定异型铜皮比对检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 2 规律分析');
  if (!text.includes('③ 走线参考层投影覆盖与两侧邻近铜 — 缺陷规律与工程分析')) throw new Error('缺少分类 3 规律分析');
  if (!text.includes('④ 孤立小铜皮检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 4 规律分析');
  if (!text.includes('⑤ 铜皮最小圆弧半径检查 — 缺陷规律与工程分析')) throw new Error('缺少分类 5 规律分析');

  // Export report test
  let reportCaptured = null;
  w.showExportBox = function(filename, content) {
    reportCaptured = { filename, content };
  };
  w.exportAnalysisReport();
  if (!reportCaptured || !reportCaptured.filename.includes('分析报告')) {
    throw new Error('未能成功导出分析报告');
  }
});

test('判定状态与五类检查可组合筛选，孔层铺铜使用层别缺铜说明', () => {
  const oldRaw = w.State.rawResults;
  const oldGrouped = w.State.groupedResults;
  const oldViewMode = w.State.viewMode;
  const mockResults = [
    { groupKey: 'mock_cov_fail', checkCategory: 'via_coverage', checkCategoryName: '① 孔经过层铺铜覆盖检查', pass: false, failCount: 1, viaId: 1, viaPadstack: 'VIA_A', viaNet: 'N1', layer: 'L2', layerListStr: 'L2, L3', message: '旧的详细阈值描述', subRecords: [{ checkCategory: 'via_coverage', pass: false, layer: 'L2', message: '旧说明' }, { checkCategory: 'via_coverage', pass: true, layer: 'L3', message: '旧说明' }] },
    { groupKey: 'mock_cov_pass', checkCategory: 'via_coverage', checkCategoryName: '① 孔经过层铺铜覆盖检查', pass: true, viaId: 2, viaPadstack: 'VIA_A', viaNet: 'N2', layer: 'L3', layerListStr: 'L3', message: '旧的符合描述', subRecords: [{ checkCategory: 'via_coverage', pass: true, layer: 'L3', message: '旧说明' }] },
    { groupKey: 'mock_shape_fail', checkCategory: 'special_shape', checkCategoryName: '② 特定异型铜皮比对检查', pass: false, failCount: 3, viaId: 3, viaPadstack: 'PTH-SIG-150drill-ring0_L5_L10', viaNet: '21_N', actualDifferentialCenterDistance: 23.622, layer: 'L4', message: '冗长异型铜皮说明', subRecords: [
      { checkCategory: 'special_shape', pass: false, layer: 'L1', templateName: '网络模板', expectedSet: 'Shape', targetShapeId: 21847, targetShapeIds: [21847, 21848], actualArea: 109.78617, expectedArea: 109.78617, areaTolerance: 1, hdiNetMismatch: true, hdiConnectionLayer: 'Top', hdiConnectionShapeIds: [21847, 21848], hdiConnectionShapeNets: ['25_N'], actualHdiViaId: 54649, actualHdiViaNet: '33_P', actualDifferentialCenterDistance: 23.622 },
      { checkCategory: 'special_shape', pass: false, layer: 'L4', templateName: '缺失模板', expectedSet: 'Shape', targetShapeId: null, actualDifferentialCenterDistance: 23.622 },
      { checkCategory: 'special_shape', pass: false, layer: 'L4', templateName: '面积模板', expectedSet: 'Shape', targetShapeId: 301, actualArea: 100, expectedArea: 103.6, areaTolerance: 1, actualDifferentialCenterDistance: 23.622 }
    ] },
    { groupKey: 'mock_margin_fail', checkCategory: 'trace_ref_margin', checkCategoryName: '③ 参考层覆盖与邻近铜检查', pass: false, traceId: 4, refLayer: 'L5', layer: 'L8', minMargin: 100, footprintCovered: false, leftSideCopper: true, rightSideCopper: true, message: '冗长参考层说明' },
    { groupKey: 'mock_small_fail', checkCategory: 'isolated_copper', checkCategoryName: '④ 孤立小铜皮检查', pass: false, shapeId: 5, layer: 'L6', message: '冗长孤铜说明' },
    { groupKey: 'mock_arc_fail', checkCategory: 'arc_radius', checkCategoryName: '⑤ 圆弧半径检查', pass: false, shapeId: 6, layer: 'L7', message: '冗长圆弧说明' }
  ];
  const specialProblem = 'L1 层【网络模板】网络不一致：实际接触的 Top 层铜皮 Shape #21847 + #21848 Net=25_N，但 HDI 孔 #54649 Net=33_P，按异常处理；' +
    'L4 层【缺失模板】缺失异型铜皮：未找到关联的 Set=Shape 的 Shape Item；' +
    'L4 层【面积模板】面积不符：Shape #301 实测 100 sq mil，要求 103.6 ±1 sq mil，偏差 3.6 sq mil';
  w.State.rawResults = mockResults;
  w.State.groupedResults = mockResults;
  w.setViewMode('grouped');
  w.updateTopKPIs();
  if ($('cntFilterAll').textContent !== '6' || $('cntFilterDefects').textContent !== '5' || $('cntFilterPass').textContent !== '1') throw new Error('全部、符合与不符合数量未同步');
  const resultHeaders = [...d.querySelectorAll('#tabResults thead .result-filter-label')].map(el => el.textContent.trim());
  if (resultHeaders.includes('实测值与规则阈值') || !resultHeaders.includes('问题点')) throw new Error('结果明细表未删除实测阈值列或缺少问题点列');
  const columnFilterButtons = d.querySelectorAll('#tabResults thead [data-result-column-filter]');
  if (columnFilterButtons.length !== 6) throw new Error('检查明细表未给六个数据列提供表头筛选');
  w.setResultColumnFilter('layer', ['L8']);
  if (w.State.filteredResults.length !== 1 || w.State.filteredResults[0].groupKey !== 'mock_margin_fail') throw new Error('涉及层别表头筛选未生效');
  if (!d.querySelector('[data-result-column-filter="layer"]').classList.contains('active')) throw new Error('已启用的表头筛选未高亮');
  w.setResultColumnFilter('layer', []);
  w.setResultColumnFilter('target', 'VIA_A');
  if (w.State.filteredResults.length !== 2) throw new Error('目标对象表头关键词筛选未生效');
  w.setResultColumnFilter('target', '');
  const readColumnOptions = key => {
    d.querySelector(`[data-result-column-filter="${key}"]`).click();
    if ($('pourColumnFilterMenu').hidden) throw new Error(`${key} 的 Excel 风格表头筛选菜单未打开`);
    const values = [...$('pourColumnFilterMenu').querySelectorAll('.pour-column-filter-options label span')].map(span => span.textContent.trim());
    w.closeResultColumnFilter();
    return values;
  };
  const layerOptions = readColumnOptions('layer');
  if (!layerOptions.includes('L2, L3') || !layerOptions.includes('L8')) throw new Error('涉及层别筛选未列出表格中的全部不同值');
  const statusOptions = readColumnOptions('status');
  if (!statusOptions.includes('符合') || !statusOptions.includes('不符合') || !statusOptions.includes('不符合 · 1 层未检出') || !statusOptions.includes('不符合 · 3 项未通过')) {
    throw new Error('判定筛选未区分符合、普通不符合、未检出层数及异型模板未通过项数：' + statusOptions.join(' / '));
  }
  const problemOptions = readColumnOptions('problem');
  if (!problemOptions.includes('L2 层缺铜皮') || !problemOptions.includes('L5 层完整走线投影缺铜') ||
      !problemOptions.includes('L7 层铜皮圆弧半径过小')) {
    throw new Error('问题点筛选未列出表格中的全部不同值：' + problemOptions.join(' / '));
  }
  w.setResultColumnFilter('status', ['不符合 · 1 层未检出']);
  if (w.State.filteredResults.length !== 1 || w.State.filteredResults[0].groupKey !== 'mock_cov_fail') throw new Error('判定完整文本筛选未生效');
  w.setResultColumnFilter('status', []);
  w.setResultColumnFilter('problem', [specialProblem]);
  if (w.State.filteredResults.length !== 1 || w.State.filteredResults[0].groupKey !== 'mock_shape_fail') throw new Error('问题点枚举筛选未生效');
  if (JSON.stringify(readColumnOptions('layer')) !== '["L4"]' || JSON.stringify(readColumnOptions('status')) !== '["不符合 · 3 项未通过"]') {
    throw new Error('其他列筛选下拉未基于当前问题点筛选后的列表联动');
  }
  w.setResultColumnFilter('problem', []);

  w.setResultStatusFilter('defects');
  w.setCategoryFilter('via_coverage');
  if (w.State.resultStatusFilter !== 'defects' || w.State.categoryFilter !== 'via_coverage') throw new Error('判定状态与检查分类未独立保存');
  if (w.State.filteredResults.length !== 1 || w.State.filteredResults[0].groupKey !== 'mock_cov_fail') throw new Error('未取到孔层铺铜的不符合项交集');
  if ($('cntFilterAll').textContent !== '2' || $('cntFilterDefects').textContent !== '1' || $('cntFilterPass').textContent !== '1') {
    throw new Error('判定统计数字未随孔层铺铜分类动态变化');
  }
  if (JSON.stringify(readColumnOptions('status')) !== '["不符合 · 1 层未检出"]' ||
      JSON.stringify(readColumnOptions('layer')) !== '["L2, L3"]' ||
      JSON.stringify(readColumnOptions('problem')) !== '["L2 层缺铜皮"]') {
    throw new Error('表头筛选下拉未按当前“不符合项 × 孔层铺铜”列表收窄选项');
  }
  if (!$('btnFilterDefects').classList.contains('pri') || !$('btnFilterCov').classList.contains('pri')) throw new Error('两个组合筛选按钮未同时保持选中');
  const failDescription = d.querySelector('#tblResultsBody tr[data-result-key] td:nth-child(6)').textContent.trim();
  if (failDescription !== 'L2 层缺铜皮') throw new Error('孔层铺铜异常归因未按实际层别简化：' + failDescription);
  w.toggleRowExpand('mock_cov_fail');
  const detailHeaders = [...d.querySelectorAll('#tblResultsBody tr.subrow th')].map(th => th.textContent.trim());
  if (detailHeaders.includes('实测参数') || detailHeaders.includes('规则阈值') || !detailHeaders.includes('问题点')) throw new Error('逐层明细仍显示实测参数或规则阈值');

  w.setResultStatusFilter('pass');
  if (w.State.categoryFilter !== 'via_coverage' || w.State.filteredResults.length !== 1 || w.State.filteredResults[0].groupKey !== 'mock_cov_pass') throw new Error('切换符合项时未保留孔层铺铜分类');
  const passDescription = d.querySelector('#tblResultsBody tr[data-result-key] td:nth-child(6)').textContent.trim();
  if (passDescription !== 'L3 层铜皮覆盖符合要求') throw new Error('孔层铺铜符合项说明不正确：' + passDescription);

  w.setCategoryFilter('special_shape');
  if (w.State.resultStatusFilter !== 'pass' || w.State.filteredResults.length !== 0) throw new Error('切换五类检查时未保留符合项限制');
  if ($('cntFilterAll').textContent !== '1' || $('cntFilterDefects').textContent !== '1' || $('cntFilterPass').textContent !== '0') {
    throw new Error('判定统计数字未随异型铜皮分类动态变化');
  }

  w.setResultStatusFilter('defects');
  if ($('lblResultTargetHeader').textContent.trim() !== 'Padstack / 网络 / 差分孔中心距 / 目标对象') {
    throw new Error('选择异型铜皮后目标列标题未增加差分孔中心距');
  }
  const specialTarget = d.querySelector('#tblResultsBody tr[data-result-key] td:nth-child(3)').textContent.trim();
  if (!specialTarget.includes('PTH-SIG-150drill-ring0_L5_L10 / 21_N / 23.622 mil / 孔 #3')) {
    throw new Error('异型铜皮目标列未显示差分孔中心距：' + specialTarget);
  }
  d.querySelector('[data-result-column-filter="target"]').click();
  const targetSearch = $('pourColumnFilterMenu').querySelector('input[type="search"]');
  targetSearch.value = '21-N';
  $('pourColumnFilterMenu').querySelector('[data-filter-action="apply"]').click();
  if (w.State.filteredResults.length !== 1 || w.State.filteredResults[0].groupKey !== 'mock_shape_fail') {
    throw new Error('目标列筛选未用局部关键词兼容 21-N 与 21_N');
  }
  w.setResultColumnFilter('target', '');
  if (JSON.stringify(readColumnOptions('status')) !== '["不符合 · 3 项未通过"]' ||
      JSON.stringify(readColumnOptions('layer')) !== '["L4"]' ||
      JSON.stringify(readColumnOptions('problem')) !== JSON.stringify([specialProblem])) {
    throw new Error('表头筛选下拉未按当前“不符合项 × 异型铜皮”列表统计全部可能性');
  }
  [
    ['special_shape', specialProblem],
    ['trace_ref_margin', 'L5 层完整走线投影缺铜'],
    ['isolated_copper', 'L6 层存在孤立小铜皮'],
    ['arc_radius', 'L7 层铜皮圆弧半径过小']
  ].forEach(([category, expected]) => {
    w.setCategoryFilter(category);
    const description = d.querySelector('#tblResultsBody tr[data-result-key] td:nth-child(6)').textContent.trim();
    if (description !== expected) throw new Error(`${category} 问题点未精简：${description}`);
  });
  w.State.rawResults = oldRaw;
  w.State.groupedResults = oldGrouped;
  w.State.viewMode = oldViewMode;
  w.updateTopKPIs();
  w.setResultStatusFilter('all');
  w.setCategoryFilter('all');
  if ($('lblResultTargetHeader').textContent.trim() !== 'Padstack / 网络 / 目标对象') throw new Error('离开异型铜皮分类后目标列标题未恢复');
});

test('复核状态勾选与记忆更新', () => {
  const itemKey = 'via_coverage_53_1';
  w.toggleReviewItem(itemKey, true);
  if (!w.State.reviewedItems.has(itemKey)) throw new Error('复核集合中未记录 itemKey');
  w.toggleReviewItem(itemKey, false);
  if (w.State.reviewedItems.has(itemKey)) throw new Error('复核集合未能正确取消');
});

test('CSV 导出弹窗正常生成', () => {
  let opened = false;
  w.showExportBox = function(filename, text) {
    opened = true;
    if (!filename.includes('copper_pour')) throw new Error('文件名不符合规范');
    if (!text.includes('检查分类') || !text.includes('问题点') || text.includes('实测与规则说明')) throw new Error('CSV 表头未同步精简');
  };
  w.exportResultsCSV();
  if (!opened) throw new Error('未调用 showExportBox');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);

})();
