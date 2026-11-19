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
  { page: 'index.html', module: 'trace', tab: 'guide', section: 'tab-guide', schemes: 3, keyword: '差分对逐层与总长差' },
  { page: 'copper.html', module: 'copper', tab: 'guide', section: 'tab-guide', schemes: 3, keyword: '反焊盘、焊盘与非功能焊盘尺寸' },
  { page: 'dfm.html', module: 'dfm', tab: 'guide', section: 'tab-guide', schemes: 3, keyword: 'GND 孔盘到信号孔盘间距' },
  { page: 'fanout.html', module: 'fanout', tab: 'tabGuide', section: 'tabGuide', schemes: 3, keyword: '信号孔检查资格与堆叠拓扑' },
  { page: 'pour.html', module: 'pour', tab: 'tabGuide', section: 'tabGuide', schemes: 5, keyword: '走线参考层投影与邻近铜' }
];

test('五个检查模块均提供独立、可切换且默认收起的检查说明页', () => {
  CASES.forEach(item => {
    const source = fs.readFileSync(path.join(CHECKER_DIR, item.page), 'utf8');
    assert.match(source, /assets\/styles\/check-guide\.css\?v=46/, item.page + ' 未加载检查说明样式');
    assert.match(source, /packages\/shared\/check-guide\.js\?v=46/, item.page + ' 未加载检查说明脚本');

    const ctx = openPage(item.page, { syncCheck: true });
    const { d } = ctx;
    try {
      const button = d.querySelector('nav#tabs button[data-tab="' + item.tab + '"]');
      const section = d.getElementById(item.section);
      const host = d.querySelector('[data-check-guide-module="' + item.module + '"]');
      assert(button, item.page + ' 缺少检查说明导航');
      assert(section && host, item.page + ' 缺少检查说明页容器');
      assert.strictEqual(host.querySelectorAll('.module-guide-flow-step').length, 5, item.page + ' 应展示五步总流程');
      assert.strictEqual(host.querySelectorAll('.module-guide-scheme').length, item.schemes, item.page + ' 检查方案数量错误');
      assert([...host.querySelectorAll('.module-guide-scheme')].every(el => !el.open), item.page + ' 检查方案默认应收起');
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

test('共享检查说明文案覆盖操作步骤、验证标准与边界例外', () => {
  const js = fs.readFileSync(path.join(CHECKER_DIR, 'packages/shared/check-guide.js'), 'utf8');
  ['符合标准', '不符合标准', '边界与例外', '位置容差', '数值容差', 'Void', 'Trace 锚点', '0.01 mil'].forEach(keyword => {
    assert(js.includes(keyword), '检查说明缺少关键语义：' + keyword);
  });
});
