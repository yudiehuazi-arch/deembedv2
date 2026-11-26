/* ============================================================================
 * unified-ui.test.js —— 综合一体化检查全流程 UI 回归测试（三栏渐进式 EDA 工作台）
 * ========================================================================== */
'use strict';

const { openPage, tick } = require('../helpers/open-page');

const ctx = openPage('unified.html', { syncCheck: true });
const { w, d } = ctx;
const $ = id => d.getElementById(id);

let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name} -> ${err.message}`);
    fail++;
  }
}

(async () => {
  await tick(150);
  w.alert = () => {};
  console.log('== 综合一体化检查：三栏壳层、六工序、五引擎联检与缺陷清单测试 ==');

  await test('三栏壳层完整，导航在左、工具与遥测在右，静态标题无括号解释', () => {
    if (!d.title.includes('综合一体化')) throw new Error('标题异常：' + d.title);
    if (!d.body.classList.contains('eda-workbench')) throw new Error('缺少 body.eda-workbench');
    if (!d.querySelector('aside.eda-left-rail nav#tabs')) throw new Error('工序条不在左列导轨');
    if (!d.querySelector('aside.eda-left-rail .navlinks a.active[href="unified.html"]')) throw new Error('模块导航未高亮当前页');
    if (!d.querySelector('aside.eda-right-dock #kpiDefectCount')) throw new Error('遥测不在右工具栏');
    if (!d.querySelector('aside.eda-right-dock .global-display-ctrl')) throw new Error('显示控制区不在右工具栏');
    if (d.querySelector('header .navlinks') && !d.querySelector('aside.eda-left-rail header .navlinks, aside.eda-left-rail .navlinks')) {
      throw new Error('顶栏残留横向导航');
    }
    [...d.querySelectorAll('h1, h2, h3, h4, .card-title, nav#tabs button, th')].forEach(el => {
      if (el.id) return;
      if (/[（(].+[)）]/.test(el.textContent)) throw new Error('静态文案仍含括号解释：' + el.textContent.trim());
    });
    const tipCarrier = d.querySelector('[data-tip]');
    w.EdaTooltip.show(tipCarrier);
    if ($('edaFloatingTooltip').style.display !== 'block') throw new Error('悬浮气泡未显示');
    w.EdaTooltip.hide();
  });

  await test('六个工序页签互相切换，规则配置独立成工序且含五个引擎手风琴', () => {
    const tabs = [...d.querySelectorAll('nav#tabs button[data-tab]')];
    if (tabs.length !== 6) throw new Error('页签数量应为 6，实际 ' + tabs.length);
    for (const b of tabs) {
      b.click();
      const pane = $(b.dataset.tab);
      if (!pane || !pane.classList.contains('active')) throw new Error('未激活面板 ' + b.dataset.tab);
      if (d.querySelectorAll('.tab-pane.active').length !== 1) throw new Error('同时激活多个面板');
      if (!b.classList.contains('active')) throw new Error('页签按钮未高亮 ' + b.dataset.tab);
    }
    tabs[0].click();
    if ($('edaActiveStageLabel').textContent.trim() !== '① 数据导入') throw new Error('面包屑未同步：' + $('edaActiveStageLabel').textContent);
    if (d.querySelectorAll('#tabRules .rule-acc').length !== 5) throw new Error('规则配置应含 5 个引擎手风琴');
    if (d.querySelectorAll('#tabData .data-cat-box').length !== 4) throw new Error('数据导入应含 4 个数据框');
    if (!$('cfgCheckNfp') || !$('cfgCheckNfp').disabled || $('cfgCheckPadstackLayers').disabled) throw new Error('预研板约束检查开关状态错误');
  });

  await test('无数据时运行检查被拦截，不产生缺陷', () => {
    let alerted = 0;
    w.alert = () => { alerted++; };
    w.clearUnifiedData();
    w.runMasterInspection();
    if (!alerted) throw new Error('未提示导入数据');
    if (w.State.allChecks.length) throw new Error('无数据却产生了检查项');
    w.alert = () => {};
  });

  await test('载入示例并联检：五类引擎全部出结果，数量与基线一致', () => {
    w.loadUnifiedSampleData();
    w.runMasterInspection();
    const S = w.State;
    const byCat = {};
    S.allChecks.forEach(c => { byCat[c.category] = (byCat[c.category] || 0) + 1; });
    const want = { trace: 16, copper: 40, dfm: 11, fanout: 1, pour: 138 };
    for (const k of Object.keys(want)) {
      if (byCat[k] !== want[k]) throw new Error(`${k} 检查项应为 ${want[k]}，实际 ${byCat[k]}`);
    }

    // 综合样例必须真实经过 SIG 完整孔推算，而不是仅降低旧基线数量：两颗差分
    // SIG Via 各自形成单段完整孔；五颗 GND 非 SIG Via 保留分组但不产生检查行。
    const copperItems = w.CopperCheck.parseBoardItems(w.buildInspectionContext().tConstraint);
    const copperRun = w.CopperCheck.runCopperCheck(copperItems, S.rules.constraintSets, {
      layerCount: 20,
      valTol: 0.5,
      enabled: { '反焊盘尺寸': true, '焊盘尺寸': false, '非功能焊盘尺寸': false, 'Padstack层名': true }
    });
    const signalGroups = copperRun.groups.filter(g => g.signal);
    const nonSignalGroups = copperRun.groups.filter(g => !g.signal);
    if (copperRun.signalGroupCount !== 2 || signalGroups.length !== 2) throw new Error('SIG 完整孔组应为 2');
    if (!signalGroups.every(g => g.vias.length === 1 && g.rule && g.rule.title === 'BGA-L19')) {
      throw new Error('单颗 SIG Via 未按完整孔推算到 BGA-L19');
    }
    if (!signalGroups.every(g => g.mateNet && Math.abs(g.pitchMm - 0.254) < 1e-6)) {
      throw new Error('SIG 差分配对或孔中心距推算异常');
    }
    if (nonSignalGroups.length !== 5 || nonSignalGroups.some(g => g.rule || g.rows.length)) {
      throw new Error('非 SIG Via 不应推算约束或产生检查行');
    }
    if (S.allChecks.some(c => c.category === 'copper' && /GND/.test(c.target))) {
      throw new Error('综合检查结果错误包含非 SIG GND Via');
    }

    const fails = S.allChecks.filter(c => !c.pass).length;
    // 约束中配置的全叠层都要检查；物理 Via 层跨只限制 Shape 来源归属，不能裁掉规则层。
    if (fails !== 192) throw new Error('不符合项应为 192，实际 ' + fails);
    if ($('kpiTotalChecks').textContent !== '206') throw new Error('遥测总检查项异常：' + $('kpiTotalChecks').textContent);
    if ($('kpiDefectCount').textContent !== '192') throw new Error('遥测缺陷数异常：' + $('kpiDefectCount').textContent);
    ['trace', 'copper', 'dfm', 'fanout', 'pour'].forEach(k => {
      if (!S.results[k] || !S.results[k].hasData) throw new Error('引擎无数据：' + k);
    });
  });

  await test('引擎调度已按阶段拆分，且各阶段函数可独立调用', () => {
    ['buildInspectionContext', 'runTraceEngine', 'runCopperEngine', 'runDfmEngine', 'runFanoutEngine', 'runPourEngine']
      .forEach(fn => { if (typeof w[fn] !== 'function') throw new Error('缺少 ' + fn); });
    const c = w.buildInspectionContext();
    if (!c || !c.tTrace) throw new Error('上下文构建失败');
    const n = w.runTraceEngine(c).length;
    if (n !== 16) throw new Error('走线阶段应产出 16 项，实际 ' + n);
  });

  await test('综合走线检查按物理层号复用规则，02IS01 使用 02G01P 而非首条其他层规则', () => {
    const oldRules = w.State.rules.traceLayers;
    const oldResult = w.State.results.trace;
    const oldLayerDiff = $('cfgCheckLayerDiff').checked;
    const oldTotalDiff = $('cfgCheckTotalDiff').checked;
    const oldGlobalLayerTol = $('cfgDiffLayerTol').value;
    try {
      const l3Rule = { layer: '03G02P', combos: '7.7', diffLayerTol: 9 };
      const l2Rule = { layer: '02G01P', combos: '5.6', diffLayerTol: 0.25 };
      w.State.rules.traceLayers = [l3Rule, l2Rule];
      $('cfgCheckLayerDiff').checked = true;
      $('cfgCheckTotalDiff').checked = false;
      $('cfgDiffLayerTol').value = '0.5';
      if (w.unifiedTraceLayerAlias('02IS01') !== 'L2' || w.findUnifiedTraceLayerRule('02IS01', w.State.rules.traceLayers) !== l2Rule) {
        throw new Error('02IS01 未按物理层号命中 02G01P');
      }
      const traces = [
        { id: 1, net: 'ALIAS_P', layer: '02IS01', length: 100, segments: [{ width: 5.6 }] },
        { id: 2, net: 'ALIAS_N', layer: '02IS01', length: 100.4, segments: [{ width: 5.6 }] }
      ];
      const checks = w.runTraceEngine({ tTrace: 'alias-layer-data', parsedTrace: { traces } });
      const widthChecks = checks.filter(check => check.item === '出线层线宽组合顺序');
      if (widthChecks.length !== 2 || widthChecks.some(check => !check.pass || check.rule !== '5.6')) {
        throw new Error('线宽检查未使用 L2 规则：' + JSON.stringify(widthChecks));
      }
      const layerDiff = checks.find(check => check.item === '差分逐层线长差');
      if (!layerDiff || layerDiff.pass || layerDiff.layer !== '02IS01' || layerDiff.rule !== '≤ 0.3 mil') {
        throw new Error('差分逐层容差未使用 L2 规则：' + JSON.stringify(layerDiff));
      }
    } finally {
      w.State.rules.traceLayers = oldRules;
      w.State.results.trace = oldResult;
      $('cfgCheckLayerDiff').checked = oldLayerDiff;
      $('cfgCheckTotalDiff').checked = oldTotalDiff;
      $('cfgDiffLayerTol').value = oldGlobalLayerTol;
    }
  });

  await test('综合检查产品板流程启用 Set=Shape 非功能焊盘并禁用 Padstack 检查', () => {
    const oldSets = w.State.rules.constraintSets;
    const oldResult = w.State.results.copper;
    w.State.rules.constraintSets = [{ kind: '其他', title: 'L7-L33', matchMode: 'connections-trace-layers', constraints: [
      { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L7: '17' } },
      { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L7: '5', L8: '6' } }
    ] }];
    w.renderConstraintSets();
    if ($('cfgCheckNfp').disabled || !$('cfgCheckPadstackLayers').disabled) throw new Error('产品板开关未同步');
    const txt = [
      'Item 901 < Shape >', '  Set: Shape', '  Subset: 07IS03', '  Type: Shape(Static)', 'Exterior Boundary:',
      '  Arc seg: xy [495, 500] xy [495, 500] Width (0)', '    Center-xy: [500, 500] Radius (5) CCW', '~~~~~~~~',
      'Item 902 < Shape >', '  Set: Route Keepout', '  Subset: 07IS03', '  Type: Shape(Static)', 'Exterior Boundary:',
      '  Arc seg: xy [483, 500] xy [483, 500] Width (0)', '    Center-xy: [500, 500] Radius (17) CCW', '~~~~~~~~',
      'Item 90 < Via >', '  Origin-xy: [500, 500]', '  Net: CHANGE_90', '  Padstack Name: VIAOR40DOR15F_D6MIL',
      '  Connections:', '    Trace: 2 (07IS03 33IS10)', '~~~~~~~~'
    ].join('\n');
    $('cfgCheckNfp').checked = true;
    $('cfgCheckPadstackLayers').checked = true;
    const checks = w.runCopperEngine({ tConstraint: txt, parsedConstraint: { vias: [] } });
    const actual = checks.find(check => check.item === '非功能焊盘尺寸' && check.layer === 'L7');
    const missing = checks.find(check => check.item === '非功能焊盘尺寸' && check.layer === 'L8');
    if (!actual || actual.actual !== 5 || actual.rule !== '5' || !actual.pass) throw new Error('非功能焊盘实测结果错误：' + JSON.stringify(actual));
    if (!missing || missing.actual !== '无非功能焊盘' || missing.pass) throw new Error('缺失非功能焊盘未报告：' + JSON.stringify(missing));
    if (checks.some(check => /Padstack/.test(check.item))) throw new Error('产品板不应执行 Padstack 检查');
    w.State.rules.constraintSets = oldSets;
    w.State.results.copper = oldResult;
    w.renderConstraintSets();
    if (!$('cfgCheckNfp').disabled || $('cfgCheckPadstackLayers').disabled) throw new Error('恢复预研板后开关未复原');
  });

  await test('缺陷清单：筛选、复核与 XSS 转义', () => {
    w.switchTab('tabDefects');
    const rows = d.querySelectorAll('#tabDefects tbody tr').length;
    if (rows < 1) throw new Error('缺陷清单为空');
    w.State.allChecks.push({
      id: 'xss_1', category: 'trace', categoryName: '走线检查', target: '<img src=x onerror=alert(1)>',
      targetType: '走线网络', layer: '<b>L1</b>', item: '出线层线宽组合顺序', actual: '1', rule: '2',
      pass: false, deviation: '组合不符', reason: '<script>alert(1)</script>', objId: 'x'
    });
    w.renderMasterDefectsTable();
    if (d.querySelector('#tabDefects tbody img')) throw new Error('目标名未转义，注入了 img 节点');
    if (d.querySelector('#tabDefects tbody script')) throw new Error('原因未转义，注入了 script 节点');
    w.State.allChecks.pop();
    w.filterDefects('trace');
    w.renderMasterDefectsTable();
    w.toggleReview(w.State.allChecks.find(c => !c.pass).id, true);
    w.batchReviewAll();
    w.clearAllReviews();
  });

  await test('仪表盘、2D 视口与规律分析工序可渲染且无异常', () => {
    w.switchTab('tabDashboard');
    if (!$('tabDashboard').classList.contains('active')) throw new Error('仪表盘未激活');
    w.switchTab('tabCanvas');
    w.switchTab('tabAnalysis');
    if (!d.querySelector('#tabAnalysis tbody tr')) throw new Error('规律分析表无内容');
  });

  await test('规则配置：扇出方案库与分层 DFM 规则可增删', () => {
    const n0 = w.State.rules.fanoutSchemes.length;
    if (n0 < 1) throw new Error('默认扇出方案库为空');
    w.State.rules.fanoutSchemes.push({ name: '临时', tag: 't', vias: [] });
    const n1 = w.State.rules.fanoutSchemes.length;
    if (n1 !== n0 + 1) throw new Error('方案新增失败');
    w.State.rules.fanoutSchemes.pop();
    const rows0 = w.eval('UnifiedDfmLayerRules.rows.length');
    w.eval('UnifiedDfmLayerRules.add()');
    const rows1 = w.eval('UnifiedDfmLayerRules.rows.length');
    if (rows1 !== rows0 + 1) throw new Error('分层规则新增失败');
    w.confirm = () => true;
    w.clearFanoutLibrary();
    if (w.State.rules.fanoutSchemes.length !== 0) throw new Error('清空扇出方案库后仍残留方案：' + w.State.rules.fanoutSchemes.length);
    w.loadFanoutPresets();
    if (w.State.rules.fanoutSchemes.length !== n0) throw new Error('恢复预设扇出方案库数量异常：' + w.State.rules.fanoutSchemes.length);
    w.zoomCanvas(1.2);
  });

  await test('铜皮异型模板可编辑匹配字段与 Shape TXT 数据并导出', () => {
    const normalizedTemplates = w.normalizeSpecialShapeTemplates([
      { differentialCenterDistance: '', hdiSearchRadiusMm: '' },
      { differentialCenterDistance: 10 },
      { hdiSearchRadiusMm: 0.15 },
      { differentialCenterDistance: 10, hdiSearchRadiusMm: 0.15, set: 'route   keepout' },
      { set: ' board   geometry ' }
    ]);
    if (normalizedTemplates[0].differentialCenterDistance !== null || normalizedTemplates[0].hdiSearchRadiusMm !== null ||
        normalizedTemplates[1].differentialCenterDistance !== 10 || normalizedTemplates[1].hdiSearchRadiusMm !== null ||
        normalizedTemplates[2].differentialCenterDistance !== null || normalizedTemplates[2].hdiSearchRadiusMm !== 0.15 ||
        normalizedTemplates[0].set !== 'Shape' || normalizedTemplates[3].set !== 'Route Keepout' || normalizedTemplates[4].set !== 'Board Geometry') {
      throw new Error('规则 2 可选字段与 Set 类别未按兼容规则归一化');
    }
    w.renderRulesUI();
    const rule2Headers = [...d.querySelectorAll('#tblPourRule2 th')].map(th => th.textContent.trim());
    const viaTypeIndex = rule2Headers.indexOf('过孔类型');
    if (viaTypeIndex < 0 || rule2Headers[viaTypeIndex + 1] !== '差分孔中心距') {
      throw new Error('规则 2 的“差分孔中心距”未紧邻“过孔类型”右侧');
    }
    if (!rule2Headers.includes('HDI 搜索距离 mm')) {
      throw new Error('规则 2 表格缺少可修改的 HDI 搜索距离列');
    }
    if (!rule2Headers.includes('异型铜皮 Set 类别')) throw new Error('规则 2 表格缺少 Set 类别列');
    if (!$('modalPourShapeInpSet') || [...$('modalPourShapeInpSet').options].map(option => option.value).join('|') !== 'Shape|Route Keepout|Board Geometry') {
      throw new Error('规则 2 弹窗缺少 Shape、Route Keepout 与 Board Geometry 选项');
    }
    if (!w.State.rules.specialShapeTemplates.every(t => t.differentialCenterDistance > 0 && t.hdiSearchRadiusMm > 0)) {
      throw new Error('默认异型模板缺少差分孔中心距或 HDI 搜索距离');
    }
    const copySource = w.State.rules.specialShapeTemplates[0];
    const copyBefore = w.State.rules.specialShapeTemplates.length;
    w.duplicatePourShapeTemplate(0);
    if ($('modalPourShapeInpPadstack').value !== copySource.padstack) throw new Error('综合页复制加层未保留过孔类型');
    if ($('modalPourShapeInpSet').value !== copySource.set) throw new Error('综合页复制加层未保留 Set 类别');
    $('modalPourShapeInpLayer').value = 'L3';
    $('modalPourShapeInpSet').value = 'Board Geometry';
    w.savePourShapeFromModal();
    const layerCopy = w.State.rules.specialShapeTemplates[copyBefore];
    if (!layerCopy || layerCopy.padstack !== copySource.padstack || layerCopy.layer !== 'L3' || layerCopy.set !== 'Board Geometry' || layerCopy.expectedArea !== copySource.expectedArea) {
      throw new Error('综合页未将同一过孔的新增层与 Set 要求保存为独立模板');
    }
    w.State.rules.specialShapeTemplates.splice(copyBefore, 1);
    const before = w.State.rules.specialShapeTemplates.length;
    w.openAddPourShapeModal();
    if ($('modalPourShapeInpDiffDist').value !== '' || $('modalPourShapeInpHdiRadius').value !== '') throw new Error('综合页新增模板不应预填可选字段默认值');
    if ($('modalPourShapeInpSet').value !== 'Shape') throw new Error('综合页新增模板未默认选择 Shape');
    $('modalPourShapeInpName').value = '中心距模板测试';
    $('modalPourShapeInpDiffDist').value = '19.68';
    $('modalPourShapeInpHdiRadius').value = '0.15';
    $('modalPourShapeInpSet').value = 'Route Keepout';
    w.savePourShapeFromModal();
    const added = w.State.rules.specialShapeTemplates[before];
    if (!added || added.differentialCenterDistance !== 19.68 || added.hdiSearchRadiusMm !== 0.15 || added.set !== 'Route Keepout') throw new Error('弹窗未保存差分孔中心距、搜索距离或 Set 类别');
    w.editPourShapeTemplate(before);
    if ($('modalPourShapeInpDiffDist').value !== '19.68') throw new Error('编辑弹窗未回填差分孔中心距');
    if ($('modalPourShapeInpSet').value !== 'Route Keepout') throw new Error('编辑弹窗未回填 Set 类别');
    ['modalPourShapeInpPadstack', 'modalPourShapeInpDiffDist', 'modalPourShapeInpHdiRadius', 'modalPourShapeInpLayer', 'modalPourShapeInpSet', 'modalPourShapeTxt'].forEach(id => {
      if ($(id).disabled) throw new Error('综合页规则 2 字段不可手动输入：' + id);
    });
    const editedShapeTxt = `Item 2  < Shape >\n  Subset: 19IS08\n  Area: 321.12345 (sq mil)\n  Exterior Boundary:\n    Arc seg: xy [23274.13, 27990.27]  xy [23274.13, 27990.27]\n      Center-xy: [23286.13, 27990.27] Radius (12.0000) CCW`;
    $('modalPourShapeInpPadstack').value = 'BGA_EDITABLE';
    $('modalPourShapeInpDiffDist').value = '23.62';
    $('modalPourShapeInpHdiRadius').value = '0.125';
    $('modalPourShapeInpLayer').value = '19IS08, L5';
    $('modalPourShapeInpSet').value = 'Shape';
    $('modalPourShapeTxt').value = editedShapeTxt;
    w.savePourShapeFromModal();
    const edited = w.State.rules.specialShapeTemplates[before];
    if (edited.padstack !== 'BGA_EDITABLE' || edited.differentialCenterDistance !== 23.62 || edited.hdiSearchRadiusMm !== 0.125 || edited.layer !== '19IS08, L5' || edited.set !== 'Shape') {
      throw new Error('综合页编辑弹窗未保存过孔、中心距、搜索距离、目标层与 Set 类别');
    }
    if (edited.rawTxt !== editedShapeTxt || Math.abs(edited.expectedArea - 321.12345) > 0.001 || !edited.shape) {
      throw new Error('综合页编辑弹窗未保存修改后的 Shape TXT 数据');
    }
    const originalDrawPreview = w.drawShapePreviewCanvas;
    let thumbnailShape = null;
    w.drawShapePreviewCanvas = (canvas, shape) => {
      if (canvas && canvas.id === `unifiedR2Thumb_${before}`) thumbnailShape = shape;
      return true;
    };
    w.renderRulesUI();
    w.drawShapePreviewCanvas = originalDrawPreview;
    if (!thumbnailShape || Math.abs(thumbnailShape.area - 321.12345) > 0.001) {
      throw new Error('综合页规则表缩略图未使用编辑面板中的 Shape TXT 轮廓');
    }
    w.editPourShapeTemplate(before);
    if ($('modalPourShapeTxt').value !== editedShapeTxt) throw new Error('综合页编辑弹窗未回填修改后的 Shape TXT 数据');
    $('modalPourShapeInpDiffDist').value = '';
    $('modalPourShapeInpHdiRadius').value = '';
    $('modalPourShapeTxt').value = '';
    w.previewModalPourShape();
    w.savePourShapeFromModal();
    const cleared = w.State.rules.specialShapeTemplates[before];
    if (cleared.rawTxt !== '' || cleared.expectedArea !== 0 || cleared.shape !== null) {
      throw new Error('综合页编辑弹窗未删除已清空的 Shape TXT 数据');
    }
    if (cleared.differentialCenterDistance !== null || cleared.hdiSearchRadiusMm !== null) {
      throw new Error('综合页编辑弹窗未保留两个可选字段空值');
    }
    w.editPourShapeTemplate(before);
    if ($('modalPourShapeTxt').value !== '' || $('modalPourShapeTxt').disabled) throw new Error('综合页清空后的 Shape TXT 数据未保持可编辑空值');
    if ($('modalPourShapeInpDiffDist').value !== '' || $('modalPourShapeInpHdiRadius').value !== '') throw new Error('综合页编辑重开后恢复了可选字段默认值');
    w.closePourShapeModal();
    if (![...d.querySelectorAll('#tblPourRule2Body input[type="text"]')].some(input => input.value === '19IS08, L5')) {
      throw new Error('综合页规则表未显示多个目标层');
    }
    const optionalInputs = d.querySelectorAll('#tblPourRule2Body tr')[before].querySelectorAll('input[type="number"]');
    if (optionalInputs[0].value !== '' || optionalInputs[1].value !== '') throw new Error('综合页规则表未内联保留可选字段空值');
    w.exportPourRulesPrompt();
    const exported = JSON.parse($('txtModalExportContent').value);
    if (exported.specialShapeTemplates[before].differentialCenterDistance !== null || exported.specialShapeTemplates[before].hdiSearchRadiusMm !== null || exported.specialShapeTemplates[before].rawTxt !== '' || exported.specialShapeTemplates[before].set !== 'Shape') {
      throw new Error('铜皮规则 JSON 未保留可选字段、Set 类别与 Shape TXT 空值');
    }
    w.State.rules.specialShapeTemplates.splice(before, 1);
    w.renderRulesUI();
  });

  await test('页面运行期零脚本错误', () => {
    if (ctx.errors.length) throw new Error(ctx.errors.join(' | '));
  });

  ctx.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
})();
