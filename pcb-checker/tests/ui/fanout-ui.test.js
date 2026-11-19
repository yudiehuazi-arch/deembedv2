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

test('快捷改名关键词重复点选拼接、放大查看无重叠标注、孔心距测量与全局色卡置底', () => {
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

  // 全局 Padstack 色卡必须在 main 最末尾
  const legend = document.getElementById('libraryPadstackLegendBar');
  const main = document.querySelector('main');
  assert.strictEqual(main.lastElementChild, legend);
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
