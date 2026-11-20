/* ============================================================================
 * check-guide.test.js —— 五个检查模块的独立检查说明页回归
 * ========================================================================== */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { openPage, CHECKER_DIR } = require('../helpers/open-page');

const CASES = [
  { page: 'index.html', module: 'trace', tab: 'guide', section: 'tab-guide', schemes: 3, sequence: '⑦', keyword: '差分对逐层与总长差' },
  { page: 'copper.html', module: 'copper', tab: 'guide', section: 'tab-guide', schemes: 3, sequence: '⑦', keyword: '反焊盘、焊盘与非功能焊盘尺寸' },
  { page: 'dfm.html', module: 'dfm', tab: 'guide', section: 'tab-guide', schemes: 3, sequence: '⑥', keyword: 'GND 孔盘到信号孔盘间距' },
  { page: 'fanout.html', module: 'fanout', tab: 'tabGuide', section: 'tabGuide', schemes: 3, sequence: '⑥', keyword: '信号孔资格与多段孔合并' },
  { page: 'pour.html', module: 'pour', tab: 'tabGuide', section: 'tabGuide', schemes: 5, sequence: '⑥', keyword: '走线参考层投影与邻近铜' }
];

test('五个检查模块均提供独立、可切换且默认收起的检查说明页', () => {
  CASES.forEach(item => {
    const source = fs.readFileSync(path.join(CHECKER_DIR, item.page), 'utf8');
    assert.match(source, /assets\/styles\/check-guide\.css\?v=63/, item.page + ' 未加载检查说明样式');
    assert.match(source, /packages\/shared\/check-guide\.js\?v=63/, item.page + ' 未加载检查说明脚本');

    const ctx = openPage(item.page, { syncCheck: true });
    const { d } = ctx;
    try {
      const button = d.querySelector('nav#tabs button[data-tab="' + item.tab + '"]');
      const section = d.getElementById(item.section);
      const host = d.querySelector('[data-check-guide-module="' + item.module + '"]');
      assert(button, item.page + ' 缺少检查说明导航');
      assert(button.textContent.trim().startsWith(item.sequence + ' 检查说明'), item.page + ' 检查说明序号未按工序顺延');
      assert(section && host, item.page + ' 缺少检查说明页容器');
      assert.strictEqual(host.querySelectorAll('.module-guide-flow-step').length, 5, item.page + ' 应展示五步总流程');
      const schemes = [...host.querySelectorAll('.module-guide-scheme')];
      assert.strictEqual(schemes.length, item.schemes, item.page + ' 检查方案数量错误');
      assert(schemes.every(el => !el.open), item.page + ' 检查方案默认应收起');
      assert(schemes.every(el => el.querySelectorAll('.module-guide-basis-item').length >= 4), item.page + ' 每个方案应清楚列出至少四条判断依据');
      assert.strictEqual(host.querySelectorAll('.module-guide-verdict.pass').length, item.schemes, item.page + ' 缺少符合标准');
      assert.strictEqual(host.querySelectorAll('.module-guide-verdict.fail').length, item.schemes, item.page + ' 缺少不符合标准');
      assert.strictEqual(host.querySelectorAll('.module-guide-verdict.note').length, item.schemes, item.page + ' 缺少边界说明');
      assert(host.textContent.includes(item.keyword), item.page + ' 缺少关键检查方案：' + item.keyword);

      button.click();
      assert(section.classList.contains('active'), item.page + ' 点击后未进入检查说明页');
      assert(button.classList.contains('active'), item.page + ' 检查说明导航未激活');
      assert.strictEqual(ctx.errors.length, 0, item.page + ' 运行期错误：' + ctx.errors.join(' | '));
    } finally {
      ctx.close();
    }
  });
});

test('共享检查说明用白话写清操作步骤、判断依据与验证标准', () => {
  const js = fs.readFileSync(path.join(CHECKER_DIR, 'packages/shared/check-guide.js'), 'utf8');
  ['符合标准', '不符合标准', '边界与例外', '系统按什么判断', '位置容差', '数值容差', 'Void', '0.01 mil'].forEach(keyword => {
    assert(js.includes(keyword), '检查说明缺少关键语义：' + keyword);
  });
  ['0、0.025、0.075、0.125、0.175 mm', '每个档位允许 ±0.005 mm', '合并可以连续传递', '当前归组不使用 Connections', '0°、90°、180°、270°',
    '双方案对比使用同一画布比例和中心原点', '手动粘贴的 TXT 只在本次对比中使用', '空内容或解析失败时会保留上次成功的对比方案',
    '会先应用当前约束和搜索条件', '数量为 0 表示当前组合没有可显示的完整孔',
    '每个整合孔只放在一张检查表里', '当前叠层为 14 层时，匹配约束后的结果表固定显示 L1-L14', '读取每个原始孔段同心位置的全部 Shape',
    '没有孔段覆盖时，只在同心孔段中选择层跨端点最近的一段作为来源',
    '不会仅因存在缺孔就被猜成位置不对或多出孔', '同网络顶层 Pin 都只能在 Trace 锚点孔组建立后加入方案比对',
    '先只比较信号对象总数相同的方案', '同数量方案先选信号 Padstack 不符最少者',
    '走线首端和尾端在所有被检查参考层上的反焊盘都豁免',
    '不要求 Padstack 层跨经过该层'].forEach(keyword => {
    assert(js.includes(keyword), '检查说明未写清关键判断依据：' + keyword);
  });
  ['正交旋转', '刚体变换', '方案姿态', '连通分量'].forEach(jargon => {
    assert(!js.includes(jargon), '检查说明仍使用难懂术语：' + jargon);
  });
});
