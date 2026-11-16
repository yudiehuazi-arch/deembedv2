/* ============================================================================
 * unified-rules-pour.js —— 铜皮规则：异型铜皮模板弹窗
 * 综合一体化工作台的页面包，经典脚本，函数与状态挂在全局作用域
 * ========================================================================== */
// =========================================================================
// Copper Pour Rule 2 Shape Template Modal & Edit Mode (Matching image-3.png)
// =========================================================================
let g_editingPourShapeIdx = -1;

function openAddPourShapeModal() {
  g_editingPourShapeIdx = -1;
  const modal = $('modalPourShape');
  if (!modal) return;

  $('modalPourShapeTitle').textContent = '新增异型铜皮模板';
  $('modalPourShapeInpName').value = `L2特定异型铜皮_${(State.rules.specialShapeTemplates || []).length + 1}`;
  $('modalPourShapeInpPadstack').value = 'BGA_3510';
  $('modalPourShapeInpPadstack').disabled = false;
  $('modalPourShapeInpPadstack').style.background = '#ffffff';
  $('modalPourShapeInpDiffDist').value = '10.0';
  $('modalPourShapeInpDiffDist').disabled = false;
  $('modalPourShapeInpDiffDist').style.background = '#ffffff';
  $('modalPourShapeInpLayer').value = '02G01P';
  $('modalPourShapeInpLayer').disabled = false;
  $('modalPourShapeInpLayer').style.background = '#ffffff';
  $('modalPourShapeInpTol').value = '30.0';
  $('modalPourShapeTxt').value = `Item 2  < Shape >\n  Subset: 02G01P\n  Area: 452.38934 (sq mil)\n  Exterior Boundary:\n    Arc seg: xy [23274.13, 27990.27]  xy [23274.13, 27990.27]\n      Center-xy: [23286.13, 27990.27] Radius (12.0000) CCW`;
  $('modalPourShapeTxt').disabled = false;
  $('modalPourShapeTxt').style.background = '#ffffff';

  previewModalPourShape();
  modal.style.display = 'flex';
}

function editPourShapeTemplate(idx) {
  g_editingPourShapeIdx = idx;
  const t = State.rules.specialShapeTemplates && State.rules.specialShapeTemplates[idx];
  if (!t) return;

  const modal = $('modalPourShape');
  if (!modal) return;

  $('modalPourShapeTitle').textContent = '编辑特定异型铜皮模板';
  $('modalPourShapeInpName').value = t.name || '';
  $('modalPourShapeInpName').disabled = false;

  $('modalPourShapeInpPadstack').value = t.padstack || 'BGA_3510';
  $('modalPourShapeInpPadstack').disabled = false;
  $('modalPourShapeInpPadstack').style.background = '#ffffff';

  $('modalPourShapeInpDiffDist').value = t.differentialCenterDistance || 10.0;
  $('modalPourShapeInpDiffDist').disabled = false;
  $('modalPourShapeInpDiffDist').style.background = '#ffffff';

  $('modalPourShapeInpLayer').value = t.layer || '02G01P';
  $('modalPourShapeInpLayer').disabled = false;
  $('modalPourShapeInpLayer').style.background = '#ffffff';

  $('modalPourShapeInpTol').value = t.areaTolerance || 30.0;

  const savedShapeTxt = typeof t.rawTxt === 'string'
    ? t.rawTxt
    : (typeof t.rawShapeText === 'string' ? t.rawShapeText : null);
  $('modalPourShapeTxt').value = savedShapeTxt != null
    ? savedShapeTxt
    : `Item 2  < Shape >\n  Subset: ${t.layer || '02G01P'}\n  Area: ${(t.expectedArea || 452.39).toFixed(5)} (sq mil)\n  Exterior Boundary:\n    Arc seg: xy [23274.13, 27990.27]  xy [23274.13, 27990.27]\n      Center-xy: [23286.13, 27990.27] Radius (12.0000) CCW`;
  $('modalPourShapeTxt').disabled = false;
  $('modalPourShapeTxt').style.background = '#ffffff';

  previewModalPourShape();
  modal.style.display = 'flex';
}

function closePourShapeModal() {
  const modal = $('modalPourShape');
  if (modal) modal.style.display = 'none';
}

function parseModalPourShapeText(txt) {
  if (!String(txt || '').trim()) return null;
  if (typeof PourChecker !== 'undefined' && PourChecker.parsePcbElements) {
    try {
      const parsed = PourChecker.parsePcbElements(txt);
      if (parsed.shapes && parsed.shapes.length) return parsed.shapes[0];
    } catch (_) { /* 非完整文本继续尝试读取面积 */ }
  }
  const mArea = String(txt).match(/Area:\s*([0-9.]+)/i);
  const area = mArea ? parseFloat(mArea[1]) : 0;
  return area > 0 ? { area, boundary: [], arcs: [] } : null;
}

function previewModalPourShape() {
  const txt = $('modalPourShapeTxt').value;
  const layer = $('modalPourShapeInpLayer').value || '02G01P';
  const shape = parseModalPourShapeText(txt);
  const title = $('modalPourShapePreviewTitle');
  const stats = $('modalPourShapePreviewStats');

  if (!shape) {
    if (typeof drawShapePreviewCanvas === 'function') drawShapePreviewCanvas($('modalPourShapeCanvas'), null);
    if (title) title.textContent = txt.trim() ? '未识别到有效 Shape 块' : '未配置 Shape TXT 数据';
    if (stats) stats.textContent = '可粘贴新的 Shape TXT 数据，或保持为空。';
    return;
  }

  const area = shape.area;
  const boundary = shape.boundary || [];
  const arcCount = (shape.arcs || []).length;
  if (typeof drawShapePreviewCanvas === 'function') drawShapePreviewCanvas($('modalPourShapeCanvas'), shape);
  if (title) title.textContent = `已解析 Shape，所在层 ${shape.layer || layer}`;
  if (stats) {
    stats.innerHTML = `实测面积: <b style="color:#ffffff">${area.toFixed(2)} sq mil</b> · ${(area * 0.00064516).toFixed(4)} mm²<br>` +
      `边界：${boundary.length} 段，直线 ${Math.max(0, boundary.length - arcCount)}、圆弧 ${arcCount}`;
  }
}

function savePourShapeFromModal() {
  const name = $('modalPourShapeInpName').value.trim();
  if (!name) {
    alert('请输入模板名称');
    return;
  }

  const padstack = $('modalPourShapeInpPadstack').value.trim() || 'BGA_3510';
  const diffCenterDistance = parseFloat($('modalPourShapeInpDiffDist').value) || 10.0;
  const layer = $('modalPourShapeInpLayer').value.trim() || '02G01P';
  const tol = parseFloat($('modalPourShapeInpTol').value) || 30.0;
  const rawTxt = $('modalPourShapeTxt').value;

  const parsedShape = parseModalPourShapeText(rawTxt);
  const area = parsedShape && parsedShape.area > 0 ? parsedShape.area : 0;

  if (g_editingPourShapeIdx >= 0) {
    const t = State.rules.specialShapeTemplates[g_editingPourShapeIdx];
    t.name = name;
    t.padstack = padstack;
    t.differentialCenterDistance = diffCenterDistance;
    t.layer = layer;
    t.expectedArea = area;
    t.areaTolerance = tol;
    t.rawTxt = rawTxt;
    t.shape = parsedShape;
    if (Object.prototype.hasOwnProperty.call(t, 'rawShapeText')) t.rawShapeText = rawTxt;
    showToast(`已更新异型铜皮模板【${name}】`);
  } else {
    if (!State.rules.specialShapeTemplates) State.rules.specialShapeTemplates = [];
    State.rules.specialShapeTemplates.push({
      id: `tmpl_${Date.now()}`,
      name,
      padstack,
      differentialCenterDistance: diffCenterDistance,
      layer,
      expectedArea: area,
      areaTolerance: tol,
      rawTxt,
      shape: parsedShape
    });
    showToast(`已新增异型铜皮模板【${name}】`);
  }

  closePourShapeModal();
  renderRulesUI();
}

