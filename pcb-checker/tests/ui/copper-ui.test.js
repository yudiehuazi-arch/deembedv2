/* ============================================================================
 * copper-ui.test.js —— 约束检查模块全流程 UI 回归测试（基于三栏渐进式 EDA 工作台）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { openPage, CHECKER_DIR } = require('../helpers/open-page');

const ctx = openPage('copper.html');
const { w, d } = ctx;
const $ = id => d.getElementById(id);

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}
function activeTab() {
  const s = d.querySelector('section.tab.active');
  return s ? s.id : '(none)';
}

setTimeout(() => {
  console.log('== 约束检查模块：三栏 EDA 壳层与页签流转 ==');

  t('三栏 EDA 壳层完整（左导轨 + 中视口工序条 + 右遥测与工具区）且无静态括号解释', () => {
    if (!d.body.classList.contains('eda-workbench')) throw new Error('缺少 body.eda-workbench');
    if (!d.querySelector('aside.eda-left-rail nav#tabs')) throw new Error('工序条不在左导轨');
    if (!d.querySelector('aside.eda-right-dock .global-display-ctrl')) throw new Error('显示控制不在右工具栏');
    const tipEl = d.querySelector('[data-tip]');
    if (!tipEl) throw new Error('缺少 data-tip 悬浮提示');
    w.EdaTooltip.show(tipEl);
    if (d.getElementById('edaFloatingTooltip').style.display !== 'block') throw new Error('气泡未弹出');
    w.EdaTooltip.hide();
    // 静态标题与标签不应含括号补充说明
    const headings = [...d.querySelectorAll('h1, h2, label.fld, label.chk')].map(el => el.textContent);
    headings.forEach(txt => {
      if (/[（(].+[)）]/.test(txt)) throw new Error('静态标题/标签仍含括号解释：' + txt);
    });
  });

  t('初始在 ① 规则约束，六个工序与检查说明页签完整且可切换', () => {
    if (activeTab() !== 'tab-rules') throw new Error(activeTab());
    const b = [...d.querySelectorAll('#tabs button')].map(x => x.textContent.trim());
    if (b.length !== 7) throw new Error('页签数 ' + b.length);
    ['① 规则约束', '② 生成的约束', '③ 导入数据', '④ 检查结果', '⑤ 空间几何视口与测量', '⑥ 规律分析', '⑦ 检查说明'].forEach((x, i) => {
      if (!b[i].startsWith(x)) throw new Error('第' + (i + 1) + '个页签为 ' + b[i]);
    });
    $('tabs').querySelector('[data-tab="sets"]').click();
    if (activeTab() !== 'tab-sets') throw new Error(activeTab());
    if (!$('jumpNav') || !$('rulesBody') || !$('sets')) throw new Error('② 页缺核心容器');
    $('tabs').querySelector('[data-tab="guide"]').click();
    if (activeTab() !== 'tab-guide') throw new Error('检查说明未切换：' + activeTab());
    $('tabs').querySelector('[data-tab="rules"]').click();
  });

  t('规则约束页可在两套命名方案间筛选，生成约束与执行规则相互隔离', () => {
    const select = $('selConstraintScheme');
    const labels = [...select.options].map(option => option.textContent);
    if (labels.join('/') !== 'PCB/HDI/SLP预研板检查/产品板检查') throw new Error(labels.join('/'));
    w.eval("S.sets=[{kind:'BGA',title:'BGA-L1-L19',constraints:[]},{kind:'其他',title:'L7-L33',matchMode:'connections-trace-layers',constraints:[]}]; render();");
    if (w.eval('activeSets().map(s=>s.title).join()') !== 'BGA-L1-L19') throw new Error('第一套筛选错误');
    if (!$('ckNfp').disabled || $('ckPadstack').disabled) throw new Error('预研板开关状态错误');
    select.value = 'product'; select.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (w.eval('activeSets().map(s=>s.title).join()') !== 'L7-L33' || !$('constraintSchemeHint').textContent.includes('产品板检查')) throw new Error('第二套筛选错误');
    if ($('ckNfp').disabled || !$('ckPadstack').disabled || !w.eval("CopperApp.checkEnabled()['非功能焊盘尺寸']") || w.eval("CopperApp.checkEnabled()['Padstack层名']")) throw new Error('产品板开关状态错误');
    select.value = 'research'; select.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (!$('ckNfp').disabled || $('ckPadstack').disabled || w.eval("CopperApp.checkEnabled()['非功能焊盘尺寸']")) throw new Error('切回预研板后开关状态错误');
  });

  t('产品板 UI 使用 Set=Shape 与焊盘尺寸生成非功能焊盘结果，预研板方案保持忽略', () => {
    const productRule = [{ kind: '其他', title: 'L7-L33', matchMode: 'connections-trace-layers', constraints: [
      { cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L7: '17' } },
      { cat: '焊盘尺寸', name: '焊盘半径', unit: 'mil', values: { L7: '5', L8: '6' } }
    ] }];
    w.__productRule = productRule;
    const state = w.eval(`(function(){
      S.scheme='product'; S.sets=window.__productRule; render();
      UI.items=[
        {id:90,type:'via',origin:[500,500],net:'CHANGE_90',padstack:'VIAOR40DOR15F_D6MIL',traceConnected:true,traceLayers:['07IS03','33IS10']},
        {id:901,type:'shape',circle:true,center:[500,500],radius:17,arcRadii:[17],shapeKind:'圆形',matchingCenters:[[500,500]],set:'Route Keepout',subset:'07IS03'},
        {id:902,type:'shape',circle:true,center:[500,500],radius:5,arcRadii:[5],shapeKind:'圆形',matchingCenters:[[500,500]],set:'Shape',subset:'07IS03'}
      ];
      UI.resFilter='bad'; UI.resBadType=''; UI.resLimit=100; UI.matchLimit=100;
      runCheck(true); renderMatch(); renderResults(); renderLegend(true);
      var group=UI.result.groups[0];
      var pad=group.rows.find(function(row){return row.shapeId===902;});
      var missing=group.rows.find(function(row){return row.layer===8&&row.checkType==='非功能焊盘尺寸';});
      return {pad:pad,missing:missing,nfp:UI.result.nonFunctionalPadCount,route:UI.result.routeKeepoutCount,padstack:group.rows.some(function(row){return row.isPadstackCheck;})};
    })()`);
    if (!state.pad || state.pad.expect !== '5' || state.pad.status !== '符合' || state.pad.checkType !== '非功能焊盘尺寸') throw new Error(JSON.stringify(state.pad));
    if (!state.missing || !state.missing.missing || state.missing.actual !== '无非功能焊盘') throw new Error(JSON.stringify(state.missing));
    if (state.nfp !== 1 || state.route !== 1 || state.padstack) throw new Error(JSON.stringify(state));
    if (!$('checkHint').textContent.includes('Set=Shape 非功能焊盘 1') || !$('matchOut').textContent.includes('可检查圆弧Shape')) throw new Error('产品板统计未同步');
    if (!$('badTypeFilters').textContent.includes('非功能焊盘尺寸不符合') || !$('legendOut').textContent.includes('焊盘尺寸')) throw new Error('产品板筛选或帮助文案未同步');
    if (!$('copperBadSummary').textContent.includes('缺非功能焊盘半径')) throw new Error('缺失非功能焊盘未进入不符合归纳');

    const research = w.eval(`(function(){ S.scheme='research'; render(); runCheck(true); return {nfp:UI.result.nonFunctionalPadCount,circle:UI.result.circleCount,has:UI.result.groups.some(function(g){return g.rows.some(function(row){return row.shapeId===902;});})}; })()`);
    if (research.nfp !== 0 || research.circle !== 1 || research.has) throw new Error('预研板不应读取 Set=Shape：' + JSON.stringify(research));
  });

  console.log('== 铜皮 × 过孔 配对、推算与筛选复核 ==');
  const sampleTxt = fs.readFileSync(path.join(CHECKER_DIR, 'sample/铜皮数据示例.txt'), 'utf8')
    .replace('BGA_3510_L19', 'BGA_SIG_L1_L19_3510');
  const rules = [
    {
      kind: 'BGA', title: 'BGA-L1-L19', fanLayer: 19,
      constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '17', L2: '12', L19: '5' } }]
    },
    { kind: 'BGA', title: 'BGA-L17', fanLayer: 17, constraints: [] }
  ];

  t('注入规则并执行检查：匹配 BGA-L1-L19 并检出 L19 反焊盘 6/5 不符合', () => {
    w.__sampleTxt = sampleTxt;
    const r = w.eval(`(function(){
      S.sets = ${JSON.stringify(rules)};
      UI.items = CopperCheck.parseBoardItems(window.__sampleTxt);
      runCheck(true);
      return {
        rule: UI.result.groups[0].rule && UI.result.groups[0].rule.title,
        rows: UI.result.groups[0].rows.map(r => 'L' + r.layer + ':' + r.checkType + ':' + r.actual + '/' + r.expect + ':' + r.status).join(' | ')
      };
    })()`);
    if (r.rule !== 'BGA-L1-L19') throw new Error(r.rule);
    if (!r.rows.includes('L19:反焊盘尺寸:6/5:不符合')) throw new Error(r.rows);
  });

  t('同层同心 Route Keepout 在结果页合并显示并取最大半径', () => {
    w.__sampleTxt = sampleTxt;
    const merged = w.eval(`(function(){
      S.sets = ${JSON.stringify(rules)};
      UI.items = CopperCheck.parseBoardItems(window.__sampleTxt);
      var outer = UI.items.find(function(item){ return item.id === 1; });
      UI.items.push(Object.assign({}, outer, { id: 99, radius: 13, arcRadii: [13] }));
      UI.resLimit = 1000; UI.matchLimit = 1000; runCheck(true); renderMatch(); renderResults();
      var rows = UI.result.groups[0].rows.filter(function(row){ return row.layer === 1 && !row.missing; });
      return { count: rows.length, row: rows[0] };
    })()`);
    if (merged.count !== 1 || merged.row.actual !== 17 || merged.row.status !== '符合') throw new Error(JSON.stringify(merged));
    if (merged.row.mergedShapeIds.join('/') !== '1/99') throw new Error(JSON.stringify(merged.row));
    if (!$('matchOut').textContent.includes('1 + 99') || !$('checkOut').textContent.includes('同层同心合并 2 个 Route Keepout，取最大半径')) {
      throw new Error('合并编号或最大半径说明未显示');
    }
  });

  t('③ 导入数据页统计方块点击筛选正常', () => {
    const mix = [
      'Total 6 Items', '',
      'Item 1                < Shape >', '  Set: Route Keepout', '  Subset: Top', '  Type: Shape(Static)',
      'Exterior Boundary:', '  Arc seg: xy [83.0, 100.0]  xy [83.0, 100.0] Width (0.0)', '    Center-xy: [100.0, 100.0] Radius (17.0) CCW',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      'Item 2                < Shape >', '  Set: Route Keepout', '  Subset: 02G01P', '  Type: Shape(Static)',
      'Exterior Boundary:', '  Arc seg: xy [88.0, 100.0]  xy [88.0, 100.0] Width (0.0)', '    Center-xy: [100.0, 100.0] Radius (12.0) CCW',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      'Item 3                < Shape >', '  Set: Route Keepout', '  Subset: 07IS03', '  Type: Shape(Static)',
      'Exterior Boundary:', '  Arc seg: xy [291.0, 300.0]  xy [291.0, 300.0] Width (0.0)', '    Center-xy: [300.0, 300.0] Radius (9.0) CCW',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      'Item 4                < Via >', '  Origin-xy: [100.0, 100.0]', '  Net: 63_N', '  Padstack Name: BGA_SIG_L1_L19_3510_ring3mil_L2pad_0907',
      '  Connections:', '    Trace: 2 (Top 02G01P)', '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      'Item 5                < Via >', '  Origin-xy: [200.0, 200.0]', '  Net: GND', '  Padstack Name: BGA_3510_L17_ring3mil_0902',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'
    ].join('\n');
    $('tabs').querySelector('[data-tab="data"]').click();
    w.__mixTxt = mix;
    w.eval("S.sets=" + JSON.stringify([{ kind: 'BGA', title: 'BGA-L1-L19', fanLayer: 19, constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '17', L2: '12', L7: '9' } }] }]) + "; UI.items=CopperCheck.parseBoardItems(window.__mixTxt); UI.matchFilter=''; runCheck(true);");
    const rowCount = () => d.querySelectorAll('#matchOut tbody tr').length;
    if (rowCount() !== 4) throw new Error('全部行数=' + rowCount());
    d.querySelector('#matchOut .stat.click[data-f="matched"]').click();
    if (rowCount() !== 2) throw new Error('已配对行数=' + rowCount());
    d.querySelector('#matchOut .stat.click[data-f="unmatched"]').click();
    if (rowCount() !== 1) throw new Error('未配对行数=' + rowCount());
    d.querySelector('#matchOut .stat.click[data-f="unmatched"]').click();
    if (rowCount() !== 4) throw new Error('取消筛选未恢复=' + rowCount());
  });

  t('④ 检查结果页：复核勾选、总复核半选、约束 chip 筛选、过孔快速搜索定位与 CSV 导出', () => {
    $('tabs').querySelector('[data-tab="result"]').click();
    const allFailRule = [{ kind: 'BGA', title: 'BGA-L1-L19', fanLayer: 19, constraints: [{ cat: '反焊盘尺寸', name: '反焊盘半径', unit: 'mil', values: { L1: '1', L2: '1', L19: '1' } }] }];
    w.eval("S.sets=" + JSON.stringify(allFailRule) + "; UI.items=CopperCheck.parseBoardItems(window.__sampleTxt); UI.reviewed={}; UI.resFilter=''; UI.resRule=''; UI.resSearch=''; UI.resLimit=1000; runCheck(true); renderResults();");
    const one = d.querySelector('#checkOut .rvwBox');
    one.checked = true;
    one.dispatchEvent(new w.Event('change', { bubbles: true }));
    const master = d.querySelector('#checkOut .set .grpBox');
    if (!master.indeterminate) throw new Error('单条勾选后总复核未呈半选状态');
    $('btnReviewAll').click();
    if (d.querySelectorAll('#checkOut .rvwBox:not(:checked)').length !== 0) throw new Error('全部复核未全选');
    $('btnClearReview').click();

    // 搜索定位
    const inp = $('inpResSearch');
    inp.value = '63_N';
    $('btnSearchGo').click();
    if (!d.querySelector('#checkOut .set.pulse-target')) throw new Error('定位未触发脉冲高亮');
    $('btnClearSearch').click();

    // CSV 导出
    $('btnCsv').click();
    const csv = d.querySelector('#expMask textarea').value;
    if (!csv.includes('BGA-L1-L19')) throw new Error('CSV 缺少约束名');
    $('expMask').style.display = 'none';
  });

  t('检查规则配置的全部层，并保持 Padstack 来源层跨与连接层检测', () => {
    const padTxtFail = [
      'Item 1 < Via >',
      '  Origin-xy: [100.0, 100.0]',
      '  Net: TEST_NET_FAIL',
      '  Padstack Name: test BGA SIG 3510 L2 ring3mil',
      '  Connections:',
      '    Trace: 2 (02G01P 08IS03)',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'
    ].join('\n');
    w.__padTxtFail = padTxtFail;
    $('inpN').value = '8';
    w.eval("S.sets=[{kind:'BGA',title:'BGA-L2',fanLayer:2,constraints:[{cat:'反焊盘尺寸',name:'反焊盘半径',unit:'mil',values:{L1:'12',L2:'10'}}]}]; UI.items=CopperCheck.parseBoardItems(window.__padTxtFail); runCheck(true); renderResults();");
    const g = w.eval('UI.result.groups[0]');
    $('inpN').value = '';
    const padRow = g.rows.find(r => r.checkType === 'Padstack层名');
    if (!padRow || padRow.status !== '不符合' || !padRow.reason.includes('缺少连接层 L8')) {
      throw new Error('Padstack 连接层核对异常：' + JSON.stringify(padRow));
    }
    const missL1 = g.rows.find(r => r.layer === 1 && r.missing);
    if (!missL1 || missL1.actual !== '无铜皮' || missL1.status !== '不符合' || missL1.sourceViaIds.length || missL1.sourcePadstack !== '无覆盖 Padstack') {
      throw new Error('规则 L1 未检查，或错误借用了 L2 Padstack');
    }
    const missL2 = g.rows.find(r => r.layer === 2 && r.missing);
    if (!missL2 || missL2.actual !== '无铜皮' || missL2.status !== '不符合' || missL2.sourcePadstack !== 'test BGA SIG 3510 L2 ring3mil') {
      throw new Error('L2 缺失层未补齐并标明来源：' + JSON.stringify(missL2));
    }
  });

  t('⑥ 规律分析页与手动叠层数切换同步更新', () => {
    const botSrc = fs.readFileSync(path.join(CHECKER_DIR, 'sample/L19层扇出SMA_bot_D2M5.txt'), 'utf8');
    w.__botSrc = botSrc;
    w.eval("S.queue=[{id:1,name:'L19层扇出SMA_bot_D2M5.txt',text:window.__botSrc,enc:'UTF-8',status:''}]; S.sets=[]; document.getElementById('inpN').value=''; rebuild();");
    if (activeTab() !== 'tab-sets') throw new Error('导入约束后未自动切至 ② 生成的约束');
    if (w.eval('layerCount()') !== 21) throw new Error('自动叠层应为 21');
    const inpN = $('inpN');
    inpN.value = '24';
    inpN.onchange();
    if (w.eval("S.sets[0].constraints[0].values.L24") !== '13') throw new Error('手动改 24 层后 bottom 未移至 L24');
    $('btnAutoN').click();
    if (w.eval('layerCount()') !== 21) throw new Error('恢复自动层数失败');

    $('tabs').querySelector('[data-tab="legend"]').click();
    w.eval('renderLegend(true)');
    const h = $('legendOut').innerHTML;
    if (!h.includes('各约束下不符合的具体原因展开明细') || !h.includes('圆弧 Shape × 完整信号孔怎么配对')) {
      throw new Error('⑥ 规律分析页核心小节缺失');
    }
  });

  t('页面运行期零脚本错误', () => {
    if (ctx.errors.length) throw new Error(ctx.errors.join(' | '));
  });

  ctx.close();
  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
}, 100);
