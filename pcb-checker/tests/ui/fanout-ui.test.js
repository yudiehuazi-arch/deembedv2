/* ============================================================================
 * fanout-ui.test.js —— 扇出方案检查模块全流程 UI 回归测试（基于三栏渐进式 EDA 工作台）
 * ========================================================================== */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { openPage, CHECKER_DIR } = require('../helpers/open-page');

const ctx = openPage('fanout.html');
const { w: window, d: document } = ctx;

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

console.log('== 扇出方案检查：三栏 EDA 壳层与全流程测试 ==');

test('三栏 EDA 壳层完整、悬浮 Tips 正常、静态标题/标签无括号解释', () => {
  assert.ok(document.body.classList.contains('eda-workbench'), '缺少 body.eda-workbench');
  assert.ok(document.querySelector('aside.eda-left-rail nav#tabs'), '工序条不在左导轨');
  assert.ok(document.querySelector('aside.eda-right-dock .global-display-ctrl'), '显示控制不在右工具栏');
  [...document.querySelectorAll('h1, h2, nav#tabs button, .form-item label, .stat-box .lbl')].forEach(el => {
    assert.ok(!/[（(].+[)）]/.test(el.textContent), '静态文案仍含括号解释：' + el.textContent.trim());
  });
  const tipCarrier = document.querySelector('[data-tip]');
  window.EdaTooltip.show(tipCarrier);
  assert.strictEqual(document.getElementById('edaFloatingTooltip').style.display, 'block');
  window.EdaTooltip.hide();
});

test('页面初始化与预设 6 套扇出方案库加载', () => {
  assert.strictEqual(document.querySelectorAll('.scheme-card').length, 6);
  assert.strictEqual(document.getElementById('badgeSchemeCount').textContent, '6');
  assert.ok(document.getElementById('statSchemeCount').textContent.includes('6'));
});

test('方案库可选择两套方案并逐项对比关键指标、等比例图形与逐孔明细', () => {
  const button = document.getElementById('btnCompareSchemes');
  assert.ok(button && !button.disabled, '方案库缺少双方案对比入口');
  window.openFanoutSchemeCompare();
  const modal = document.getElementById('modalSchemeCompare');
  const selectA = document.getElementById('selCompareSchemeA');
  const selectB = document.getElementById('selCompareSchemeB');
  assert.ok(modal.classList.contains('open'));
  assert.strictEqual(selectA.options.length, 6);
  assert.strictEqual(selectB.options.length, 6);
  assert.notStrictEqual(selectA.value, selectB.value, '默认应选择两套不同方案');
  assert.strictEqual(document.querySelectorAll('[data-compare-metric]').length, 9);
  assert.strictEqual(document.querySelectorAll('.scheme-compare-different').length, 1,
    '两个 SMA 十字方案应仅在 Padstack 构成上不同');
  assert.ok(document.getElementById('schemeCompareStatus').textContent.includes('1 项关键差异'));
  assert.strictEqual(document.querySelectorAll('.scheme-compare-preview-grid canvas').length, 2);
  assert.strictEqual(document.querySelectorAll('.scheme-compare-via-card').length, 2);
  assert.ok(document.getElementById('schemeCompareOutput').textContent.includes('孔心距谱'));

  selectB.value = selectA.value;
  window.updateFanoutSchemeComparison('b');
  assert.notStrictEqual(selectA.value, selectB.value, '不允许把同一套方案作为 A、B 对比对象');
  const previousA = selectA.value, previousB = selectB.value;
  window.swapFanoutSchemeComparison();
  assert.strictEqual(selectA.value, previousB);
  assert.strictEqual(selectB.value, previousA);
  window.closeFanoutSchemeCompare();
  assert.ok(!modal.classList.contains('open'));
});

test('新建自定义扇出方案模态框与保存、聚类单位切换', () => {
  window.openSchemeModal();
  const modal = document.getElementById('modalScheme');
  assert.ok(modal.classList.contains('open'));
  document.getElementById('modalInpName').value = '测试自定义4孔扇出';
  document.getElementById('modalSelCategory').value = '自定义扇出';
  window.State.modalVias = [
    { id: 1, x: 0, y: 0, padstack: 'TEST_SIG_PAD', net: 'SIG' },
    { id: 2, x: 0, y: 30, padstack: 'TEST_GND_PAD', net: 'GND' },
    { id: 3, x: 30, y: 0, padstack: 'TEST_GND_PAD', net: 'GND' },
    { id: 4, x: 30, y: 30, padstack: 'TEST_GND_PAD', net: 'GND' }
  ];
  window.saveSchemeFromModal();
  assert.strictEqual(window.State.library.schemes.length, 7);

  window.setClusterThresh(1.5, 'mm');
  document.getElementById('selClusterUnit').value = 'mil';
  window.toggleClusterUnit();
  assert.ok(Math.abs(parseFloat(document.getElementById('inpClusterDist').value) - (1.5 / 0.0254)) < 0.1);
  window.setClusterThresh(2.0, 'mm');
});

test('26 孔 + 71 段走线导入、聚类比对、结果筛选、2D 视口同步复核与规律页', () => {
  const sampleTxt = fs.readFileSync(path.join(CHECKER_DIR, 'sample/via_trace_airgap_sample.txt'), 'utf8');
  document.getElementById('txtViaInput').value = sampleTxt;
  window.executeFanoutCheck();

  assert.strictEqual(window.State.vias.length, 26);
  assert.strictEqual(window.State.traces.length, 71);
  assert.strictEqual(window.State.activeTab, 'tabResults');
  assert.strictEqual(document.getElementById('statTotalTraces').textContent, '71');
  assert.strictEqual(document.getElementById('cardImportedTraceOverview').style.display, 'block');

  window.setResultFilter('all');
  const allCount = window.State.filteredClusters.length;
  window.setResultFilter('pass');
  const passCount = window.State.filteredClusters.length;
  window.setResultFilter('fail');
  const failCount = window.State.filteredClusters.length;
  assert.strictEqual(passCount + failCount, allCount);
  window.setResultFilter('all');

  // 2D 空间几何视口复核联动结果表
  const abnormal = window.State.clusters.find(c => !(c.matchResult && c.matchResult.pass)) || window.State.clusters[0];
  window.switchTab('tabCanvas');
  window.openClusterDeepDive(abnormal);
  document.getElementById('btnCanvasToggleReview').click();
  window.switchTab('tabResults');
  assert.ok(document.getElementById(`row_${abnormal.id}`).classList.contains('reviewed'));
  window.toggleReviewCluster(abnormal.id, false);

  window.switchTab('tabAnalysis');
  assert.ok(document.getElementById('pnlDefectRanking').textContent.includes('Padstack 不符'));
});

test('检查结果逐孔说明 Padstack、位置、缺孔和多孔问题及目标修改值', () => {
  const scheme = {
    name: '测试差分双孔方案',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'EXPECTED_P', net: 'DIFF_P', role: '差分P孔' },
      { id: 2, x: 20, y: 0, padstack: 'EXPECTED_N', net: 'DIFF_N', role: '差分N孔' }
    ]
  };
  const library = { schemes: [scheme] };
  const mismatch = {
    vias: [{ id: 11, x: 100, y: 100, padstack: 'WRONG_P', net: 'NET_P' }],
    signalVias: [{ id: 11, x: 100, y: 100, padstack: 'WRONG_P', net: 'NET_P' }],
    matchResult: {
      pass: false,
      status: 'PADSTACK_MISMATCH',
      message: 'Padstack 比对不通过',
      padMismatchList: [{ viaId: 11, x: 100, y: 100, actualPadstack: 'WRONG_P', expectedPadstack: 'EXPECTED_P', role: '差分P孔' }],
      missingVias: [{ expectedX: 120, expectedY: 100, expectedPadstack: 'EXPECTED_N', role: '差分N孔' }]
    }
  };
  const mismatchText = window.FanoutResultDetails.toText(mismatch, library, 2);
  assert.ok(mismatchText.includes('孔 #11') && mismatchText.includes('当前「WRONG_P」') && mismatchText.includes('应改为「EXPECTED_P」'));
  assert.ok(mismatchText.includes('[120, 100]') && mismatchText.includes('EXPECTED_N'), '缺孔应写清目标坐标与 Padstack');

  const misplaced = {
    vias: [
      { id: 31, x: 140, y: 100, padstack: 'GND_WRONG_POS', net: 'GND' },
      { id: 32, x: 160, y: 100, padstack: 'GND_EXTRA', net: 'GND' }
    ],
    signalVias: [],
    matchResult: {
      pass: false,
      status: 'DISTANCE_MISMATCH',
      message: '伴随地孔位置异常',
      viaAudit: [],
      missingVias: [{ expectedX: 120, expectedY: 100, expectedPadstack: 'GND_TARGET', role: '伴随地孔1' }]
    }
  };
  const misplacedText = window.FanoutResultDetails.toText(misplaced, library, 2);
  assert.ok(misplacedText.includes('孔 #31 当前在 [140, 100]') && misplacedText.includes('应移到 [120, 100]'), '位置问题应指出具体孔号、当前位置和目标位置');
  assert.ok(misplacedText.includes('多出孔') && misplacedText.includes('孔 #32'), '未被方案使用的剩余孔应明确标为多出孔');

  const noMatch = {
    vias: [
      { id: 21, x: 0, y: 0, padstack: 'EXPECTED_P', net: 'NET_P' },
      { id: 22, x: 30, y: 0, padstack: 'WRONG_N', net: 'NET_N' },
      { id: 23, x: 45, y: 0, padstack: 'EXTRA', net: 'NET_A' }
    ],
    signalVias: null,
    matchResult: { pass: false, status: 'NO_MATCH_TOPOLOGY', message: '未匹配方案' }
  };
  const noMatchDetail = window.FanoutResultDetails.build(noMatch, library, 2);
  const noMatchText = window.FanoutResultDetails.toText(noMatch, library, 2);
  assert.ok(noMatchText.includes('信号孔多出') && noMatchText.includes('多出 1 个'), '应明确说明孔多了多少');
  assert.ok(noMatchText.includes('孔 #22') && noMatchText.includes('WRONG_N') && noMatchText.includes('EXPECTED_N'), '应逐孔说明 Padstack 实际值与目标值');
  assert.ok(noMatchDetail.issues.some(issue => issue.kind === 'position' && issue.text.includes('应移到约')), '应给出位置不对孔的目标坐标');

  window.switchTab('tabResults');
  window.setResultFilter('all');
  assert.ok(document.querySelector('.fanout-result-summary'), '结果表应使用详细归因组件');
  assert.ok(document.querySelector('.fanout-result-advice'), '结果表应显示怎么改');
});

test('快捷改名关键词重复点选拼接、放大查看无重叠标注、孔心距测量与方案库页尾色卡', () => {
  window.State.library.clear();
  window.loadPresets();
  const targetScheme = window.State.library.schemes[0];
  const origName = targetScheme.name;
  window.openQuickRenameModal(targetScheme.id);
  window.clearSchemeKeywords('quick');
  ['BGA', 'top', 'L12', 'diff', '08pitch', 'BGA'].forEach(kw => window.clickSchemeKeyword('quick', kw));
  assert.strictEqual(document.getElementById('inpQuickRenameName').value, 'BGA_top_L12_diff_08pitch_BGA');
  window.saveQuickRename(false);
  window.State.library.renameScheme(targetScheme.id, origName);
  window.renderSchemeCards();

  // 放大查看 6 套预设方案无重叠检查
  window.State.library.schemes.forEach(scheme => {
    window.viewScheme(scheme.id);
    const layout = window.FanoutChecker.computeSchemeViewLayout(scheme, 760, 520, { showPadstack: true });
    assert.strictEqual(layout.callouts.length, scheme.viaCount);
    window.closeViewSchemeModal();
  });

  // 孔心距标尺测量 (0,0) -> (30,40) = 50.00 mil
  const testSc = new window.FanoutChecker.FanoutScheme({
    id: 'test_measure_sc', name: 'MeasureSc',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'PAD_A', net: 'P' },
      { id: 2, x: 30, y: 40, padstack: 'PAD_B', net: 'GND' }
    ]
  });
  window.State.library.addScheme(testSc);
  window.viewScheme(testSc.id);
  window.toggleViewSchemeMeasureMode(true);
  window.handleViewSchemeViaClick(0);
  window.handleViewSchemeViaClick(1);
  assert.ok(document.getElementById('viewSchemeMeasurePanel').textContent.includes('50.00 mil'));
  window.closeViewSchemeModal();
  window.State.library.removeScheme('test_measure_sc');
  window.renderSchemeCards();

  // 全局 Padstack 色卡只能放在方案库页尾
  const legend = document.getElementById('libraryPadstackLegendBar');
  const libraryTab = document.getElementById('tabLibrary');
  assert.strictEqual(legend.parentElement, libraryTab);
  assert.strictEqual(libraryTab.lastElementChild, legend);
  window.switchTab('tabImport');
  assert.ok(!legend.closest('.tab.active'), '导入页不得显示方案库全局色卡');
  window.switchTab('tabLibrary');
});

test('Trace 连接锚点才创建孔群，并支持纳入同网络 Via Connections 堆叠孔段', () => {
  const eligibilityHint = document.getElementById('fanoutConnectionsEligibilityHint').textContent;
  assert.ok(eligibilityHint.includes('Connections 中含 Trace'), '导入页应明确展示 Trace 锚点资格规则');
  assert.ok(eligibilityHint.includes('沿同网络 Via Connections 纳入完整盲埋孔堆叠'));
  assert.ok(eligibilityHint.includes('没有连接走线的孔群不参与检查'));

  const mixedTxt = `
Item 1 < Via >
  Origin-xy: [1000, 1000]
  Net: SIG
  Padstack Name: TEST_SIG_PAD
  Connections:
    Trace: 1 (Top)
Item 2 < Via >
  Origin-xy: [1000, 1030]
  Net: GND
  Padstack Name: TEST_GND_PAD
Item 3 < Via >
  Origin-xy: [1030, 1000]
  Net: GND
  Padstack Name: TEST_GND_PAD
Item 4 < Via >
  Origin-xy: [1030, 1030]
  Net: GND
  Padstack Name: TEST_GND_PAD
Item 5 < Via >
  Origin-xy: [1010, 1010]
  Net: IDLE_SIG
  Padstack Name: TEST_SIG_PAD
Item 6 < Via >
  Origin-xy: [1500, 1500]
  Net: SHAPE_ONLY_SIG
  Padstack Name: TEST_SIG_PAD
  Connections:
    Shape: 1 (03G02P)
`;
  document.getElementById('txtViaInput').value = mixedTxt;
  window.executeFanoutCheck();
  assert.strictEqual(window.State.summary.totalParsedSignalVias, 3);
  assert.strictEqual(window.State.summary.totalSignalVias, 1);
  assert.strictEqual(window.State.summary.excludedSignalVias, 2);
  assert.strictEqual(window.State.clusters.length, 1, '连接 Trace 的信号孔应正常创建一个检查组');
  assert.deepStrictEqual(Array.from(window.State.clusters[0].signalVias, v => v.id), [1]);
  assert.ok(!window.State.clusters[0].vias.some(v => v.id === 5 || v.id === 6), '无连接或仅连接 Shape 的信号孔不得污染已检查组');
  assert.ok(window.State.clusters[0].vias.some(v => v.net === 'GND'), '附近 GND 应继续关联为伴随地孔');
  assert.ok(document.getElementById('lblImportParseHint').textContent.includes('参与检查 1 / 未关联连接走线 2 不参与'));

  const noConnectedTxt = mixedTxt.replace('  Connections:\n    Trace: 1 (Top)\n', '');
  document.getElementById('txtViaInput').value = noConnectedTxt;
  window.executeFanoutCheck();
  assert.strictEqual(window.State.vias.length, 6, '全部过孔仍应保留供导入概览和视口显示');
  assert.strictEqual(window.State.summary.totalSignalVias, 0);
  assert.strictEqual(window.State.summary.totalClusters, 0);
  assert.strictEqual(window.State.clusters.length, 0, '没有连接 Trace 的信号孔时不得回退组群');
  assert.strictEqual(document.getElementById('statTotalClusters').textContent, '0');
  assert.strictEqual(document.getElementById('cntFilterAll').textContent, '0');
  assert.ok(document.getElementById('lblImportParseHint').textContent.includes('参与检查 0 / 未关联连接走线 3 不参与'));

  window.switchTab('tabCanvas');
  window.fitCanvasToLayout();
  assert.strictEqual(window.State.activeTab, 'tabCanvas');
  assert.ok(Number.isFinite(window.State.canvas.zoom) && window.State.canvas.zoom > 0,
    '零检查组时仍应可按全部导入过孔缩放视口');
});

test('页面运行期零脚本错误', () => {
  assert.strictEqual(ctx.errors.length, 0, ctx.errors.join(' | '));
});

ctx.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
