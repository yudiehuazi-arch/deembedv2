/* ============================================================================
 * pour-ui.test.js —— 铜皮检查模块全流程 UI 回归测试（基于三栏渐进式 EDA 工作台）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { openPage } = require('../helpers/open-page');

const SPECIAL_SHAPE_TXT = fs.readFileSync(path.join(__dirname, '../../sample/special-shape-seg-arc.txt'), 'utf8');
const MULTI_SHAPE_TXT = fs.readFileSync(path.join(__dirname, '../../sample/special-shape-multi-item.txt'), 'utf8');
const VOID_SHAPE_TXT = fs.readFileSync(path.join(__dirname, '../../sample/shape-with-voids.txt'), 'utf8');
const ctx = openPage('pour.html', { syncCheck: true });
const { w, d } = ctx;
const $ = id => d.getElementById(id);

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

console.log('== 铜皮检查：三栏 EDA 壳层、五项规则、对象汇总与规律分析测试 ==');

test('三栏 EDA 壳层完整、悬浮 Tips 正常、静态标题/标签无括号解释', () => {
  if (!d.title.includes('铜皮检查')) throw new Error('标题不包含铜皮检查');
  if (!d.body.classList.contains('eda-workbench')) throw new Error('缺少 body.eda-workbench');
  if (!d.querySelector('aside.eda-left-rail nav#tabs')) throw new Error('工序条不在左列导轨');
  if (!d.querySelector('aside.eda-right-dock .global-display-ctrl')) throw new Error('显示控制区不在右工具栏');
  const tabs = d.querySelectorAll('nav#tabs button');
  if (tabs.length !== 5) throw new Error('页签数量应为 5，实际 ' + tabs.length);
  ['btnToggleVias', 'btnToggleTraces', 'btnTogglePorts'].forEach(id => {
    if ($(id)) throw new Error('几何工具栏仍显示已移除的选项：' + id);
  });
  if (!w.State.canvas.showVias || !w.State.canvas.showTraces) {
    throw new Error('过孔和走线未保持默认显示');
  }
  if ('showPorts' in w.State.canvas) throw new Error('几何视口仍保留 P1/P2/P3/P4 端口标注状态');
  if (!$('btnToggleNetLabels') || !w.State.canvas.showNetLabels) throw new Error('几何工具栏缺少默认开启的网络名显示开关');
  if (!$('btnToggleObjectIds') || !w.State.canvas.showObjectIds) throw new Error('几何工具栏缺少默认开启的对象编号显示开关');
  ['btnCanvasDefectCov', 'btnCanvasDefectSpecial', 'btnCanvasDefectMargin', 'btnCanvasDefectSmall', 'btnCanvasDefectArc'].forEach(id => {
    if (!$(id)) throw new Error('几何工具栏缺少五类异常按钮：' + id);
  });

  [...d.querySelectorAll('h1, h2, h3, nav#tabs button, .form-item label, th')].forEach(el => {
    if (/[（(].+[)）]/.test(el.textContent)) {
      throw new Error('静态文案仍含括号解释：' + el.textContent.trim());
    }
  });

  const tipCarrier = d.querySelector('[data-tip]');
  w.EdaTooltip.show(tipCarrier);
  if ($('edaFloatingTooltip').style.display !== 'block') throw new Error('悬浮气泡未显示');
  w.EdaTooltip.hide();
});

test('几何视口可独立取消并恢复网络名与目标对象编号', () => {
  const netButton = $('btnToggleNetLabels');
  const idButton = $('btnToggleObjectIds');
  netButton.click();
  if (w.State.canvas.showNetLabels || !w.State.canvas.showObjectIds || netButton.classList.contains('active') || !idButton.classList.contains('active')) {
    throw new Error('网络名开关影响了目标对象编号');
  }
  netButton.click();
  idButton.click();
  if (!w.State.canvas.showNetLabels || w.State.canvas.showObjectIds || !netButton.classList.contains('active') || idButton.classList.contains('active')) {
    throw new Error('目标对象编号开关影响了网络名');
  }
  idButton.click();
  if (!w.State.canvas.showNetLabels || !w.State.canvas.showObjectIds) throw new Error('网络名或目标对象编号未恢复显示');
});

test('几何视口的六个异常筛选按钮均可再次点击取消选中', () => {
  const buttons = [
    ['all', 'btnCanvasDefectAll'],
    ['via_coverage', 'btnCanvasDefectCov'],
    ['special_shape', 'btnCanvasDefectSpecial'],
    ['trace_ref_margin', 'btnCanvasDefectMargin'],
    ['isolated_copper', 'btnCanvasDefectSmall'],
    ['arc_radius', 'btnCanvasDefectArc']
  ];

  buttons.forEach(([category, buttonId]) => {
    w.State.canvas.defectFilter = category;
    w.State.canvas.showDefects = true;
    w.refreshCanvasDefectButtons();
    const button = $(buttonId);
    if (!button.classList.contains('active') || button.getAttribute('aria-pressed') !== 'true') {
      throw new Error('异常筛选按钮未进入选中状态：' + buttonId);
    }

    button.click();
    if (w.State.canvas.showDefects || button.classList.contains('active') || button.getAttribute('aria-pressed') !== 'false') {
      throw new Error('再次点击后未取消异常筛选：' + buttonId);
    }

    button.click();
    if (!w.State.canvas.showDefects || w.State.canvas.defectFilter !== category || !button.classList.contains('active')) {
      throw new Error('取消后未能重新选中异常筛选：' + buttonId);
    }
  });

  w.State.canvas.defectFilter = 'all';
  w.State.canvas.showDefects = true;
  w.refreshCanvasDefectButtons();
});

test('孔层铺铜按结果问题点动态生成子级并筛选对应标记', () => {
  const previous = {
    rawResults: w.State.rawResults,
    defectFilter: w.State.canvas.defectFilter,
    defectSubFilter: w.State.canvas.defectSubFilter,
    showDefects: w.State.canvas.showDefects,
    renderCanvas: w.renderCanvas
  };
  w.renderCanvas = () => {};
  w.State.rawResults = [
    { checkCategory: 'via_coverage', pass: false, layer: '05G02P', viaId: 11, viaCoord: [10, 10] },
    { checkCategory: 'via_coverage', pass: false, layer: '05G02P', viaId: 12, viaCoord: [20, 20] },
    { checkCategory: 'via_coverage', pass: false, layer: '10G07P', viaId: 13, viaCoord: [30, 30] },
    { checkCategory: 'via_coverage', pass: true, layer: 'L4', viaId: 14, viaCoord: [40, 40] },
    { checkCategory: 'special_shape', pass: false, layer: '05G02P', viaId: 15, viaCoord: [50, 50] }
  ];
  w.State.canvas.defectFilter = 'all';
  w.State.canvas.defectSubFilter = '';
  w.State.canvas.showDefects = true;
  w.refreshCanvasDefectButtons();

  const types = w.getViaCoverageProblemTypes();
  if (types.length !== 2 || types[0].label !== '05G02P 层缺铜皮' || types[0].count !== 2 || types[1].label !== '10G07P 层缺铜皮' || types[1].count !== 1) {
    throw new Error('未按检查结果明细统计孔层铺铜问题点类型与数量');
  }

  $('btnCanvasDefectCov').click();
  const menu = $('canvasViaCoverageSubfilters');
  const childButtons = [...menu.querySelectorAll('[data-via-coverage-problem]')];
  if (menu.hidden || $('btnCanvasDefectCov').getAttribute('aria-expanded') !== 'true' || childButtons.length !== 2) {
    throw new Error('孔层铺铜子级未随父级展开');
  }
  if (!childButtons[0].textContent.includes('05G02P 层缺铜皮') || !childButtons[0].textContent.includes('2')) {
    throw new Error('孔层铺铜子级未显示问题点名称与数量');
  }

  childButtons[0].click();
  if (w.State.canvas.defectFilter !== 'via_coverage' || w.State.canvas.defectSubFilter !== '05G02P 层缺铜皮') {
    throw new Error('点击孔层铺铜问题点子级后未保存筛选状态');
  }
  const markerPositions = [];
  const markerContext = {
    save() {}, restore() {}, beginPath() {}, arc() {}, stroke() {}, setLineDash() {},
    moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillText() {}
  };
  w.drawPourDefectMarkers(markerContext, (x, y) => {
    markerPositions.push([x, y]);
    return { x, y };
  });
  if (JSON.stringify(markerPositions) !== '[[10,10],[20,20]]') {
    throw new Error('孔层铺铜问题点子级未只显示对应异常标记：' + JSON.stringify(markerPositions));
  }

  [...menu.querySelectorAll('[data-via-coverage-problem]')][0].click();
  if (w.State.canvas.defectSubFilter) throw new Error('再次点击孔层铺铜问题点子级后未返回父级全部异常');

  w.State.rawResults = previous.rawResults;
  w.State.canvas.defectFilter = previous.defectFilter;
  w.State.canvas.defectSubFilter = previous.defectSubFilter;
  w.State.canvas.showDefects = previous.showDefects;
  w.renderCanvas = previous.renderCanvas;
  w.refreshCanvasDefectButtons();
});

test('规则 1/2/3 多规则配置表格与历史快捷标签初始化正常', () => {
  if (!$('tblRule1Body') || !$('tblRule2Body') || !$('tblRule3Body')) throw new Error('缺少规则表格体');
  if (w.State.viaCoverageRules.length < 2) throw new Error('Rule 1 初始规则应至少有 2 条');
  if (w.State.specialShapeTemplates.length < 6) throw new Error('Rule 2 初始模板应包含 BGA 与四种 PTH-SIG L5/L10 模板');
  if (w.State.specialShapeTemplates.filter(rule => rule.padstack === 'PTH-SIG-150drill-ring0_L5_L10').length !== 4) {
    throw new Error('Rule 2 未完整内置 PTH-SIG L5/L10 的四种 HDI 偏移模板');
  }
  if (w.State.traceMarginRules.length < 2) throw new Error('Rule 3 初始规则应至少有 2 条');
  const rule2Headers = [...$('tblRule2Body').parentElement.querySelectorAll('th')].map(th => th.textContent.trim());
  const viaTypeIndex = rule2Headers.indexOf('过孔类型');
  if (viaTypeIndex < 0 || rule2Headers[viaTypeIndex + 1] !== '差分孔中心距') {
    throw new Error('规则 2 的“差分孔中心距”未紧邻“过孔类型”右侧');
  }
  if (!rule2Headers.includes('HDI 搜索距离 mm')) throw new Error('规则 2 缺少可修改的 HDI 搜索距离');

  const chipBars = [
    'chipsModalR1Padstack', 'chipsModalR1Layers', 'chipsModalR1Dist',
    'chipsModalR2Name', 'chipsModalR2Padstack', 'chipsModalR2DiffDist', 'chipsModalR2HdiRadius', 'chipsModalR2Layer', 'chipsModalR2Tol',
    'chipsModalR3TraceLayer', 'chipsModalR3UpperRef', 'chipsModalR3LowerRef', 'chipsModalR3Margin',
    'chipsRule4Area', 'chipsRule5Radius'
  ];
  chipBars.forEach(id => {
    const el = $(id);
    if (!el || !el.querySelector('.chip')) throw new Error(`历史选项栏异常: ${id}`);
  });

  const chip = d.querySelector('#chipsRule4Area .chip');
  const chipText = chip.textContent.replace(' sq mil', '').trim();
  chip.click();
  if ($('rule4InpArea').value !== chipText) {
    throw new Error(`回填失败: 预期 ${chipText}, 实际 ${$('rule4InpArea').value}`);
  }
});

test('异型铜皮预览按离散轮廓绘制，不把圆弧画成整圆', () => {
  const shape = w.PourChecker.parsePcbElements(SPECIAL_SHAPE_TXT).shapes[0];
  const calls = { lineTo: 0, arc: 0 };
  const context = {
    clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, closePath() {}, fill() {}, stroke() {},
    lineTo() { calls.lineTo++; },
    arc() { calls.arc++; }
  };
  const drawn = w.drawShapePreviewCanvas({ width: 110, height: 110, getContext: () => context }, shape);
  if (!drawn || calls.lineTo !== shape._ring.length - 1) throw new Error('预览未按完整离散轮廓连续绘制');
  if (calls.arc !== 1) throw new Error('预览仍把扫掠圆弧错误绘制为整圆');
});

test('异型铜皮模板读取并预览全部 Shape Item，而非只取第一个', () => {
  const parsed = w.PourChecker.parsePcbElements(MULTI_SHAPE_TXT);
  const shape = w.PourChecker.composeShapeItems(parsed.shapes);
  if (!shape || shape.itemCount !== 2 || shape.itemIds.join(',') !== '1,2' || Math.abs(shape.area - 118.27433) > 1e-6) {
    throw new Error('多个 Shape Item 未正确组合为异型铜皮模板');
  }
  const calls = { moveTo: 0, evenoddFills: 0 };
  const context = {
    clearRect() {}, fillRect() {}, beginPath() {}, lineTo() {}, closePath() {}, stroke() {}, arc() {},
    moveTo() { calls.moveTo++; },
    fill(rule) { if (rule === 'evenodd') calls.evenoddFills++; }
  };
  if (!w.drawShapePreviewCanvas({ width: 120, height: 160, getContext: () => context }, shape)) {
    throw new Error('多 Item 异型铜皮预览未绘制');
  }
  if (calls.moveTo !== 2 || calls.evenoddFills !== 2) {
    throw new Error(`预览没有分别绘制圆形与矩形 Item: ${JSON.stringify(calls)}`);
  }
  $('modalR2TxtShape').value = MULTI_SHAPE_TXT;
  w.previewModalShape();
  if (w.State.modalShapeParsed.itemCount !== 2 || !$('modalR2PreviewTitle').textContent.includes('2 个 Shape Item') ||
      !$('modalR2PreviewDesc').textContent.includes('118.27 sq mil')) {
    throw new Error('弹窗未显示多 Item 数量与合计面积');
  }
  const resolved = w.resolveShapePreview({ rawShapeText: MULTI_SHAPE_TXT });
  if (!resolved || resolved.itemCount !== 2) throw new Error('规则表缩略图仍只解析第一个 Shape Item');
  w.openAddRule2Modal();
  $('modalR2InpName').value = '多 Item 模板';
  $('modalR2InpPadstack').value = 'MULTI_TARGET';
  $('modalR2InpDiffDist').value = '1';
  $('modalR2InpLayer').value = '02G01P';
  $('modalR2InpTol').value = '0.1';
  $('modalR2TxtShape').value = MULTI_SHAPE_TXT;
  w.saveRule2FromModal();
  const savedIndex = w.State.specialShapeTemplates.findIndex(template => template.name === '多 Item 模板');
  const saved = w.State.specialShapeTemplates[savedIndex];
  if (!saved || saved.shapeItemCount !== 2 || saved.shape.itemCount !== 2 || Math.abs(saved.expectedArea - 118.27433) > 1e-6) {
    throw new Error('多 Item 数量、组合几何或合计面积未保存到规则 2');
  }
  w.deleteRule2(savedIndex);
});

test('铜皮主画布与缩略图以 evenodd 复合路径镂空全部 Void', () => {
  const shape = w.PourChecker.parsePcbElements(VOID_SHAPE_TXT).shapes[0];
  const previewCalls = { moveTo: 0, closePath: 0, fillRules: [] };
  const previewContext = {
    clearRect() {}, fillRect() {}, beginPath() {}, lineTo() {}, stroke() {}, arc() {},
    moveTo() { previewCalls.moveTo++; },
    closePath() { previewCalls.closePath++; },
    fill(rule) { previewCalls.fillRules.push(rule); }
  };
  if (!w.drawShapePreviewCanvas({ width: 120, height: 120, getContext: () => previewContext }, shape)) {
    throw new Error('含 Void 的缩略图未绘制');
  }
  if (previewCalls.moveTo !== 3 || previewCalls.closePath !== 3 || !previewCalls.fillRules.includes('evenodd')) {
    throw new Error(`缩略图未形成 exterior + 2 Void 复合路径: ${JSON.stringify(previewCalls)}`);
  }

  const mainCalls = { moveTo: 0, closePath: 0, fillRules: [] };
  const mainContext = {
    clearRect() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, lineTo() {}, stroke() {},
    fillText() {}, setLineDash() {}, arc() {}, measureText() { return { width: 0 }; },
    moveTo() { mainCalls.moveTo++; },
    closePath() { mainCalls.closePath++; },
    fill(rule) { mainCalls.fillRules.push(rule); }
  };
  const canvas = $('mainCanvas');
  const oldGetContext = canvas.getContext;
  const oldShapes = w.State.shapes;
  const oldCanvas = Object.assign({}, w.State.canvas);
  const oldSummary = w.State.summary;
  canvas.getContext = () => mainContext;
  w.State.shapes = [shape];
  Object.assign(w.State.canvas, {
    zoom: 1, panX: 0, panY: 0,
    showShapes: true, showVias: false, showTraces: false, showDefects: false,
    measurePoints: []
  });
  w.State.summary = null;
  w.renderCanvas();
  canvas.getContext = oldGetContext;
  w.State.shapes = oldShapes;
  w.State.canvas = oldCanvas;
  w.State.summary = oldSummary;
  if (mainCalls.moveTo !== 3 || mainCalls.closePath !== 3 || !mainCalls.fillRules.includes('evenodd')) {
    throw new Error(`主画布未形成 exterior + 2 Void 复合路径: ${JSON.stringify(mainCalls)}`);
  }
});

test('弹窗新增规则 1/2/3 与异型铜皮 Shape TXT 几何解析保存', () => {
  w.openAddRule1Modal();
  if (!$('modalRule1').classList.contains('open')) throw new Error('Modal 1 未打开');
  $('modalR1InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR1InpLayers').value = '02G01P, 19IS08';
  $('modalR1InpDist').value = '45.0';
  w.saveRule1FromModal();
  if ($('modalRule1').classList.contains('open')) throw new Error('Modal 1 未关闭');
  if (!w.State.viaCoverageRules.some(r => r.padstack === 'BGA_GND_pad1mil_0902' && r.coverageRadius === 45.0)) {
    throw new Error('规则 1 未保存');
  }

  w.openAddRule2Modal();
  if (!$('modalRule2').classList.contains('open')) throw new Error('Modal 2 未打开');
  if ($('modalR2InpDiffDist').value !== '' || $('modalR2InpHdiRadius').value !== '') throw new Error('规则 2 新增弹窗的可选字段不应预填默认值');
  $('modalR2InpPadstack').value = 'BGA_GND_pad1mil_0902';
  $('modalR2InpDiffDist').value = '19.68';
  $('modalR2InpHdiRadius').value = '0.175';
  $('modalR2InpLayer').value = '05G02P';
  $('modalR2TxtShape').value = SPECIAL_SHAPE_TXT;
  w.previewModalShape();
  const parsedShape = w.State.modalShapeParsed;
  if (!parsedShape || Math.abs(parsedShape.area - 97.38256) > 0.001 || parsedShape.boundary.length !== 11 || parsedShape.arcs.length !== 6) {
    throw new Error('异型 Shape 的 Seg 与 Arc seg 真实轮廓解析异常');
  }
  w.saveRule2FromModal();
  if ($('modalRule2').classList.contains('open')) throw new Error('Modal 2 未关闭');
  const savedTemplateIndex = w.State.specialShapeTemplates.findIndex(t => Math.abs(t.expectedArea - 97.38256) < 0.1 && t.differentialCenterDistance === 19.68);
  if (savedTemplateIndex < 0) throw new Error('规则 2 模板与差分孔中心距未保存');
  const originalDrawPreview = w.drawShapePreviewCanvas;
  const originalRAF = w.requestAnimationFrame;
  let thumbnailShape = null;
  w.requestAnimationFrame = callback => callback();
  w.drawShapePreviewCanvas = (canvas, shape) => {
    if (canvas && canvas.id === `r2Thumb_${savedTemplateIndex}`) thumbnailShape = shape;
    return true;
  };
  w.renderRule2Table();
  w.drawShapePreviewCanvas = originalDrawPreview;
  w.requestAnimationFrame = originalRAF;
  if (!thumbnailShape || thumbnailShape.boundary.length !== 11 || thumbnailShape.arcs.length !== 6) {
    throw new Error('规则表缩略图未使用导入的异型铜皮真实轮廓');
  }
  w.openEditRule2Modal(savedTemplateIndex);
  if ($('modalR2InpDiffDist').value !== '19.68') throw new Error('规则 2 编辑弹窗未回填差分孔中心距');
  ['modalR2InpPadstack', 'modalR2InpDiffDist', 'modalR2InpHdiRadius', 'modalR2InpLayer', 'modalR2TxtShape'].forEach(id => {
    if ($(id).disabled) throw new Error('规则 2 编辑弹窗字段不可手动输入：' + id);
  });
  const editedShapeTxt = `Item 1  < Shape >\n  Subset: 19IS08\n  Area: 321.12345 (sq mil)\nExterior Boundary:\n  Arc seg: xy [21208.94, 35522.46]  xy [21208.94, 35522.46]\n    Center-xy: [21220.94, 35522.46] Radius (12.0000) CCW`;
  $('modalR2InpPadstack').value = 'BGA_EDITABLE';
  $('modalR2InpDiffDist').value = '23.62';
  $('modalR2InpHdiRadius').value = '0.125';
  $('modalR2InpLayer').value = '19IS08, L5';
  $('modalR2TxtShape').value = editedShapeTxt;
  w.saveRule2FromModal();
  const editedTemplate = w.State.specialShapeTemplates[savedTemplateIndex];
  if (editedTemplate.padstack !== 'BGA_EDITABLE' || editedTemplate.differentialCenterDistance !== 23.62 || editedTemplate.hdiSearchRadiusMm !== 0.125 || editedTemplate.layer !== '19IS08, L5') {
    throw new Error('规则 2 编辑弹窗未保存过孔、中心距、HDI 搜索距离与目标层');
  }
  if (editedTemplate.rawShapeText !== editedShapeTxt || Math.abs(editedTemplate.expectedArea - 321.12345) > 0.001 || !editedTemplate.shape) {
    throw new Error('规则 2 编辑弹窗未保存修改后的 Shape TXT 数据');
  }
  w.openEditRule2Modal(savedTemplateIndex);
  if ($('modalR2TxtShape').value !== editedShapeTxt) throw new Error('规则 2 编辑弹窗未回填修改后的 Shape TXT 数据');
  $('modalR2InpDiffDist').value = '';
  $('modalR2InpHdiRadius').value = '';
  $('modalR2TxtShape').value = '';
  w.previewModalShape();
  w.saveRule2FromModal();
  const clearedTemplate = w.State.specialShapeTemplates[savedTemplateIndex];
  if (clearedTemplate.rawShapeText !== '' || clearedTemplate.expectedArea !== 0 || clearedTemplate.shape !== null) {
    throw new Error('规则 2 编辑弹窗未删除已清空的 Shape TXT 数据');
  }
  if (clearedTemplate.differentialCenterDistance !== null || clearedTemplate.hdiSearchRadiusMm !== null) {
    throw new Error('规则 2 编辑弹窗未将两个可选字段保持为空');
  }
  w.openEditRule2Modal(savedTemplateIndex);
  if ($('modalR2TxtShape').value !== '' || $('modalR2TxtShape').disabled) throw new Error('清空后的 Shape TXT 数据未保持可编辑空值');
  if ($('modalR2InpDiffDist').value !== '' || $('modalR2InpHdiRadius').value !== '') throw new Error('规则 2 编辑重开后恢复了可选字段默认值');
  w.closeModal('modalRule2');
  if (!$('tblRule2Body').textContent.includes('19IS08, L5')) throw new Error('规则 2 表格未显示多个目标层');
  if (!$('tblRule2Body').textContent.includes('未启用')) throw new Error('规则 2 表格未显示可选约束为空');

  w.openAddRule3Modal();
  if (!$('modalRule3').classList.contains('open')) throw new Error('Modal 3 未打开');
  $('modalR3InpTraceLayer').value = '19IS08';
  $('modalR3InpUpperRef').value = '02G01P';
  $('modalR3InpLowerRef').value = 'Bottom';
  $('modalR3InpMargin').value = '42.0';
  w.saveRule3FromModal();
  if ($('modalRule3').classList.contains('open')) throw new Error('Modal 3 未关闭');
  if (!w.State.traceMarginRules.some(r => r.traceLayer === '19IS08' && r.minMargin === 42.0)) {
    throw new Error('规则 3 未保存');
  }
});

test('规则 JSON 快照导出、本地恢复与导出复制兜底验证', () => {
  const origExport = w.showExportBox;
  let exportCaptured = null;
  w.showExportBox = function (filename, text, hint) {
    exportCaptured = { filename, text, hint };
  };

  w.exportRulesToLocalFile();
  if (!exportCaptured || !exportCaptured.filename.includes('.json')) throw new Error('未导出 JSON 规则文件');
  const json = JSON.parse(exportCaptured.text);
  if (!json.viaCoverageRules.length || !json.specialShapeTemplates.length || !json.traceMarginRules.length) {
    throw new Error('导出 JSON 内容不完整');
  }
  if (!json.specialShapeTemplates.some(t => t.differentialCenterDistance === null && t.hdiSearchRadiusMm === null)) {
    throw new Error('导出 JSON 未保留规则 2 的可选字段空值');
  }
  if ($('lblRuleFileStatus').style.display === 'none') throw new Error('状态提示未显示');

  w.applyRuleSnapshot({
    version: '1.0',
    tool: 'pcb_pour_checker',
    viaCoverageRules: [{ id: 'custom_cov_1', padstack: 'TEST_CUSTOM_VIA_STACK', layers: 'L1-L12', coverageRadius: 60.0 }],
    specialShapeTemplates: [{ id: 'custom_tmpl_1', name: '测试专用异型铜皮模板', padstack: 'TEST_CUSTOM_VIA_STACK', differentialCenterDistance: 23.62, hdiSearchRadiusMm: 0.15, layer: '19IS08', expectedArea: 320.0, areaTolerance: 15.0, rawShapeText: '' }],
    traceMarginRules: [{ id: 'custom_margin_1', traceLayer: '08IS03', upperRefLayer: 'Top', lowerRefLayer: 'Bottom', minMargin: 55.0 }],
    smallCopperAreaThreshold: 350.0,
    minArcRadius: 8.5,
    history: { r1_padstack: ['TEST_CUSTOM_VIA_STACK'] }
  }, true);

  if (w.State.viaCoverageRules[0].padstack !== 'TEST_CUSTOM_VIA_STACK') throw new Error('规则 1 恢复失败');
  if (w.State.specialShapeTemplates[0].name !== '测试专用异型铜皮模板' || w.State.specialShapeTemplates[0].differentialCenterDistance !== 23.62 || w.State.specialShapeTemplates[0].hdiSearchRadiusMm !== 0.15) throw new Error('规则 2 的中心距与 HDI 搜索距离恢复失败');
  const restoredTemplates = w.State.specialShapeTemplates;
  w.applyRuleSnapshot({ specialShapeTemplates: [{ id: 'legacy', name: '旧规则', padstack: 'BGA', differentialCenterDistance: 10, layer: 'L2' }] }, false);
  if (w.State.specialShapeTemplates[0].differentialCenterDistance !== 10 || w.State.specialShapeTemplates[0].hdiSearchRadiusMm !== null) throw new Error('导入缺失的 HDI 搜索距离未保持为空');
  w.State.specialShapeTemplates = restoredTemplates;
  w.renderRule2Table();
  if (w.State.traceMarginRules[0].minMargin !== 55.0) throw new Error('规则 3 恢复失败');
  if ($('rule4InpArea').value !== '350' || $('rule5InpRadius').value !== '8.5') throw new Error('阈值输入框未同步');

  $('exportModalText').value = 'TEST_EXPORT_CONTENT_CLIPBOARD';
  w.copyExportContent();
  if ($('copySuccessTip').style.display !== 'inline-flex') throw new Error('复制成功提示未显示');
  w.showExportBox = origExport;
});

test('同一目标对象多层问题自动汇总聚合、子行展开与 XSS 防护', () => {
  w.State.viaCoverageRules = [
    { id: 'cov_hdi', padstack: 'HDI_045drill', layers: 'L1, L3-L5', coverageRadius: 50.0 }
  ];
  const evil = '<img src=x onerror="window.__pwn=1">';
  const sampleMultiLayerTxt = `
Total 3 Items
Item 53  < Via >
  Padstack Name: HDI_045drill_ring3_1_4
  Layer: 02G01P
  Net: 21_N${evil}
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

  if (w.State.rawResults.length !== 12) throw new Error(`逐层原始记录应为 12 条，实际 ${w.State.rawResults.length}`);
  if (w.State.groupedResults.length !== 3) throw new Error(`汇总后应为 3 个孔对象，实际 ${w.State.groupedResults.length}`);
  if (d.querySelectorAll('img[src="x"]').length) throw new Error('检测到未转义 HTML 注入');

  const via53Group = w.State.groupedResults.find(g => String(g.viaId) === '53');
  if (!via53Group || via53Group.failCount !== 4) throw new Error('孔 #53 应汇总 4 层超标');
  if (via53Group.layerListStr !== 'L1, L3, L4, L5' || via53Group.subRecords.map(record => record.layer).join(',') !== 'L1,L3,L4,L5') {
    throw new Error('L1, L3-L5 未展开为 L1、L3、L4、L5');
  }

  w.setViewMode('grouped');
  if (d.querySelectorAll('#tblResultsBody tr').length !== 3) throw new Error('汇总视图行数应为 3');
  const headers = [...d.querySelectorAll('#tabResults thead .result-filter-label')].map(el => el.textContent.trim());
  if (!headers.includes('Padstack / 网络 / 目标对象')) throw new Error('结果表目标列标题未按新顺序显示');
  const firstTarget = d.querySelector('#tblResultsBody tr td:nth-child(3)').textContent;
  if (!firstTarget.includes('HDI_045drill_ring3_1_4') || !firstTarget.includes('21_N') || !firstTarget.includes('孔 #53')) {
    throw new Error('目标列未按 Padstack / 网络 / 目标对象显示：' + firstTarget);
  }
  if (headers.includes('实测值与规则阈值') || !headers.includes('问题点')) throw new Error('结果表未删除实测阈值列或缺少问题点列');
  const firstProblem = d.querySelector('#tblResultsBody tr td:nth-child(6)').textContent;
  if (firstProblem.trim() !== 'L1、L3、L4、L5 层缺铜皮') throw new Error('孔铺铜问题点未按实际层别精简：' + firstProblem);
  w.toggleRowExpand(via53Group.groupKey);
  if (d.querySelectorAll('#tblResultsBody tr.subrow').length !== 1) throw new Error('展开后应出现 1 个子表行');
});

test('铜皮可按层显示，结果定位仅绘制问题层并在返回时恢复原条目', () => {
  const locateTxt = `
Total 3 Items
Item 1 < Shape >
  Set: Etch
  Subset: Top
  Area: 100
Exterior Boundary:
  Seg: xy [56, -5] xy [66, -5]
  Seg: xy [66, -5] xy [66, 5]
  Seg: xy [66, 5] xy [56, 5]
  Seg: xy [56, 5] xy [56, -5]
Item 2 < Shape >
  Set: Etch
  Subset: L2
  Area: 100
Exterior Boundary:
  Seg: xy [56, 10] xy [66, 10]
  Seg: xy [66, 10] xy [66, 20]
  Seg: xy [66, 20] xy [56, 20]
  Seg: xy [56, 20] xy [56, 10]
Item 3 < Via >
  Origin-xy: [0, 0]
  Net: TEST_N
  Padstack Name: PROBE_STACK
`;
  w.State.viaCoverageRules = [{ id: 'cov_probe', padstack: 'PROBE_STACK', layers: 'L1', coverageRadius: 55 }];
  w.State.specialShapeTemplates = [];
  w.State.traceMarginRules = [];
  w.State.smallCopperAreaThreshold = 0;
  $('txtDataInput').value = locateTxt;
  w.executeCopperChecks();
  w.setViewMode('grouped');
  const result = w.State.groupedResults.find(r => r.checkCategory === 'via_coverage');
  if (!result || result.pass) throw new Error('定位夹具应产生 56mil > 55mil 的孔铺铜问题');

  const layerOptions = [...$('selCanvasShapeLayer').options].map(option => option.textContent);
  if (!layerOptions.includes('铜皮层：Top') || !layerOptions.includes('铜皮层：L2')) {
    throw new Error('铜皮按层显示选项未列出全部 Shape 层');
  }
  w.setCanvasShapeLayer('L2');
  if (w.State.canvas.shapeLayerMode !== 'layer' || w.State.canvas.visibleShapeLayers.join(',') !== 'L2') {
    throw new Error('手动选择铜皮层后未保存单层过滤状态');
  }

  const oldRAF = w.requestAnimationFrame;
  w.requestAnimationFrame = callback => callback();
  w.locateElementInCanvas('via_coverage', '3', result.groupKey);
  if (w.State.activeTab !== 'tabCanvas') throw new Error('定位后未切换到几何视口');
  if (JSON.stringify(w.State.canvas.highlightShapeIds) !== '["1"]') {
    throw new Error('未将最近的问题铜皮 Shape #1 设置为红色突出对象');
  }
  if (!w.State.canvas.activeProblem || w.State.canvas.activeProblem.requiredDist !== 55) {
    throw new Error('几何视口未保存 55mil 孔心搜索范围');
  }
  if (w.State.canvas.shapeLayerMode !== 'problem' || w.State.canvas.visibleShapeLayers.join(',') !== 'Top') {
    throw new Error('从 L1 规则结果定位后未映射为仅显示 Top 问题层铜皮');
  }
  if ($('selCanvasShapeLayer').value !== '__PROBLEM__' || !$('pourCanvasRevBody').textContent.includes('当前仅显示问题层铜皮：Top')) {
    throw new Error('问题层选择状态或定位提示未同步');
  }
  w.setCanvasDefectFilter('via_coverage');
  if (w.State.canvas.defectFilter !== 'via_coverage' || !$('btnCanvasDefectCov').classList.contains('active')) {
    throw new Error('几何视图未切换到孔层铺铜异常结果');
  }
  const originalShapeRings = w.PourChecker.shapeRings;
  const renderedShapeLayers = [];
  const markerTexts = [];
  const canvas = $('mainCanvas');
  const originalGetContext = canvas.getContext;
  canvas.getContext = () => ({
    clearRect() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() {}, fill() {}, stroke() {}, arc() {}, setLineDash() {},
    fillText(text) { markerTexts.push(String(text)); },
    measureText() { return { width: 0 }; }
  });
  w.PourChecker.shapeRings = shape => {
    renderedShapeLayers.push(shape.layer);
    return originalShapeRings(shape);
  };
  w.renderCanvas();
  if (!markerTexts.includes('#3') || !markerTexts.some(text => text.includes('Shape #1'))) {
    throw new Error('几何视口默认未显示网络名或目标对象编号');
  }
  markerTexts.length = 0;
  $('btnToggleObjectIds').click();
  if (markerTexts.includes('#3') || markerTexts.some(text => text.includes('Shape #')) || !w.State.canvas.showNetLabels) {
    throw new Error('关闭对象编号后影响了网络名状态，或仍绘制对象编号');
  }
  $('btnToggleObjectIds').click();
  markerTexts.length = 0;
  $('btnToggleNetLabels').click();
  if (markerTexts.includes('GND') || !markerTexts.includes('#3') || !markerTexts.some(text => text.includes('Shape #1'))) {
    throw new Error('关闭网络名后未保留目标对象编号，或仍绘制网络名');
  }
  $('btnToggleNetLabels').click();
  w.PourChecker.shapeRings = originalShapeRings;
  canvas.getContext = originalGetContext;
  if (!renderedShapeLayers.length || renderedShapeLayers.some(layer => layer !== 'Top')) {
    throw new Error('定位画布仍绘制了非问题层铜皮：' + renderedShapeLayers.join(','));
  }
  if (!markerTexts.includes('1')) throw new Error('孔所在位置未绘制第 1 类特殊异常标记');
  if ($('btnReturnPourResults').style.display === 'none') throw new Error('定位后未显示返回结果明细按钮');

  w.returnToPourResults();
  w.requestAnimationFrame = oldRAF;
  if (w.State.activeTab !== 'tabResults') throw new Error('返回后未切回检查结果明细');
  const returnedRow = [...d.querySelectorAll('#tblResultsBody tr[data-result-key]')]
    .find(row => row.getAttribute('data-result-key') === result.groupKey);
  if (!returnedRow || !returnedRow.classList.contains('pour-located-flash')) {
    throw new Error('返回后未恢复并框选原定位条目');
  }

  w.switchTab('tabAnalysis');
  const summaryTable = d.querySelector('.pour-defect-summary-table');
  const summaryHeads = [...summaryTable.querySelectorAll('th')].map(th => th.textContent.trim());
  if (summaryHeads.join('/') !== '孔 Padstack/网络/异常类型/如何修改/板上位置') {
    throw new Error('缺陷总结表列异常：' + summaryHeads.join('/'));
  }
  const summaryText = summaryTable.textContent;
  if (!summaryText.includes('PROBE_STACK') || !summaryText.includes('TEST_N') ||
      !summaryText.includes('孔层铺铜缺失') || !summaryText.includes('在异常层补铺铜') ||
      !summaryText.includes('Via #3')) {
    throw new Error('缺陷总结表未完整显示 Padstack、网络、异常类型、修改建议与板上位置');
  }
  const boardCanvas = summaryTable.querySelector('.pour-defect-board-canvas');
  const boardButton = summaryTable.querySelector('.pour-defect-board-open');
  if (!boardCanvas || boardCanvas.getAttribute('data-all-via-count') !== '1' || !boardButton.textContent.includes('放大查看')) {
    throw new Error('板上位置图未包含全部孔或缺少放大功能');
  }
  boardButton.click();
  const boardZoom = $('pourDefectBoardZoom');
  if (!boardZoom || boardZoom.hidden) throw new Error('板上位置图未打开高清放大视图');
  boardZoom.querySelector('.pour-board-zoom-close').click();
});

test('走线导入、参考层超宽判定、2D 画布视口定位复核、规律分析与 CSV 导出', () => {
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

  if (w.State.traces.length !== 1 || w.State.traces[0].segments.length !== 3) {
    throw new Error('走线直线+圆弧段解析数量异常');
  }
  const marginResults = w.State.rawResults.filter(r => r.checkCategory === 'trace_ref_margin');
  const upperRes = marginResults.find(r => r.refLayer.toUpperCase() === '02G01P');
  const lowerRes = marginResults.find(r => r.refLayer.toUpperCase() === 'BOTTOM');
  if (!upperRes || !upperRes.pass || !lowerRes || lowerRes.pass) {
    throw new Error('走线上下参考层超宽判定结果异常');
  }

  w.switchTab('tabCanvas');
  const portLabelTexts = [];
  const mainCanvas = $('mainCanvas');
  const originalGetContext = mainCanvas.getContext;
  mainCanvas.getContext = () => ({
    clearRect() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() {}, fill() {}, stroke() {}, arc() {}, setLineDash() {},
    fillText(text) { portLabelTexts.push(String(text)); },
    measureText() { return { width: 0 }; }
  });
  w.renderCanvas();
  mainCanvas.getContext = originalGetContext;
  if (portLabelTexts.some(text => /^P[1-4]$/.test(text))) {
    throw new Error('几何视口仍绘制自动生成的端口字符：' + portLabelTexts.join(' / '));
  }

  w.switchTab('tabAnalysis');
  const text = $('pnlAnalysisContainer').textContent;
  [
    '① 孔经过层铺铜覆盖检查 — 缺陷规律与工程分析',
    '② 特定异型铜皮比对检查 — 缺陷规律与工程分析',
    '③ 走线参考层铺铜覆盖与单侧超宽 — 缺陷规律与工程分析',
    '④ 孤立小铜皮检查 — 缺陷规律与工程分析',
    '⑤ 铜皮最小圆弧半径检查 — 缺陷规律与工程分析'
  ].forEach(heading => {
    if (!text.includes(heading)) throw new Error('分析页缺少段落：' + heading);
  });

  let reportCaptured = null;
  let csvCaptured = null;
  w.showExportBox = function (filename, content) {
    if (filename.includes('分析报告')) reportCaptured = { filename, content };
    if (filename.includes('copper_pour')) csvCaptured = { filename, content };
  };
  w.exportAnalysisReport();
  if (!reportCaptured) throw new Error('未能导出分析报告');

  w.setCategoryFilter('via_coverage');
  if (w.State.filteredResults.some(r => r.checkCategory !== 'via_coverage')) throw new Error('分类筛选异常');
  w.setCategoryFilter('all');

  w.toggleReviewItem('via_coverage_3_1', true);
  if (!w.State.reviewedItems.has('via_coverage_3_1')) throw new Error('复核勾选未记录');
  w.toggleReviewItem('via_coverage_3_1', false);

  w.exportResultsCSV();
  if (!csvCaptured || !csvCaptured.content.includes('检查分类')) throw new Error('CSV 导出内容异常');
});

test('大文件仅在文本框显示截断预览，并通过 Web Worker 后台执行几何检查', () => {
  const input = $('txtDataInput');
  const originalText = input.value;
  const largeText = 'Total 36781 Items\n' + 'Shape data\n'.repeat(30000);
  w.setPourImportedText(largeText, 'large-board.txt', 25905 * 1024);
  if (w.State.importedText !== largeText) throw new Error('大文件完整内容未保留在检查状态中');
  if (input.value.length >= largeText.length || input.dataset.largeFilePreview !== '1') throw new Error('文本框未使用大文件截断预览');
  input.dispatchEvent(new w.Event('beforeinput', { bubbles: true }));
  if (w.State.importedText || input.value) throw new Error('编辑大文件预览前未切回文本输入模式');
  input.value = originalText;

  const workerSource = fs.readFileSync(path.join(__dirname, '../../packages/pages/pour/pour-check-worker.js'), 'utf8');
  if (!workerSource.includes('importScripts') || !workerSource.includes('runAllCopperChecks')) throw new Error('后台检查线程未加载铜皮引擎');
  const OriginalWorker = w.Worker;
  let workerUrl = '', postedText = '', terminated = false;
  function FakeWorker(url) { workerUrl = url; }
  FakeWorker.prototype.postMessage = function (payload) {
    postedText = payload.text;
    const result = w.PourChecker.runAllCopperChecks(payload.text, payload.config);
    this.onmessage({ data: { type: 'result', runId: payload.runId, result } });
  };
  FakeWorker.prototype.terminate = function () { terminated = true; };
  w.Worker = FakeWorker;
  w.__SYNC_CHECK__ = false;
  try {
    w.executeCopperChecks();
    if (!workerUrl.includes('pour-check-worker.js') || postedText !== originalText) throw new Error('检查数据未交给后台线程');
    if (!terminated || w.State.checkWorker !== null) throw new Error('后台线程完成后未释放');
    if ($('btnRunCheck').disabled || !$('btnRunCheck').textContent.includes('运行铜皮五项检查')) throw new Error('检查按钮未恢复');
  } finally {
    w.__SYNC_CHECK__ = true;
    if (OriginalWorker) w.Worker = OriginalWorker;
    else delete w.Worker;
  }
});

test('页面运行期零脚本错误', () => {
  if (ctx.errors.length) throw new Error(ctx.errors.join(' | '));
});

ctx.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
