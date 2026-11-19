/* ============================================================================
 * pour-check-guides.js —— 铜皮五类检查的折叠式操作流程与验证标准说明
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var GUIDES = {
    via_coverage: {
      scope: 'Padstack 命中的 Via × 展开后的每个目标层',
      output: '每孔每层记录，按目标孔汇总',
      summary: '逐孔逐层测量最近铜皮距离',
      steps: [
        ['筛选对象', 'Padstack 按子串匹配，填写星号代表全部 Via；层范围按包含首尾的方式展开，并兼容 Lx 与物理层名。'],
        ['计算距离', '在每个目标层查找真实铜面，测量孔心到铜皮的最短距离；孔心落在实铜内时距离为 0，Void 区域不算铜。'],
        ['逐层归并', '记录最近 Shape、实测距离和缺铜层，再把同一目标孔的全部层结果汇总到一条检查对象中。']
      ],
      standards: [
        ['pass', '符合', '每一个目标层的最近铜皮距离都小于或等于规则半径。'],
        ['fail', '不符合', '任一目标层没有铜皮，或最近铜皮距离大于规则半径。'],
        ['note', '检查口径', '判定半径内任意铜皮即可，不限制铜皮形状、面积或网络。']
      ]
    },
    special_shape: {
      scope: '目标 Padstack Via × 适用模板 × 目标层 Shape',
      output: '关联链路、Shape 清单与面积偏差',
      summary: '先关联 HDI，再选择模板并核对面积',
      steps: [
        ['锁定目标孔', '先按 Padstack 找到目标 Via；启用 HDI 搜索距离时，从目标孔向外查找范围内最近的同网络 HDI 孔。'],
        ['选择模板', '启用差分孔中心距时，再找到该 HDI 的差分网络 HDI，并以两颗 HDI 的中心距匹配模板，允许偏差 0.01 mil。'],
        ['比对铜皮', '在每个目标层的孔周 120 mil 内查找 Shape，按模板 Item 数优先合并同层、同网且相接的 Shape，再比较合计面积。']
      ],
      standards: [
        ['pass', '符合', '所有已启用的关联条件均命中，且每个目标层的面积绝对偏差不超过模板容差。'],
        ['fail', '不符合', 'HDI 缺失、差分 HDI 缺失、中心距未命中、目标层无关联 Shape，或面积偏差超限。'],
        ['note', '检查口径', '目标孔到同网络 HDI 的关联距离，与两颗 HDI 的差分中心距是两个独立条件；留空即关闭对应限制。']
      ]
    },
    trace_ref_margin: {
      scope: '指定信号层 Trace × 上下参考层',
      output: '每条走线每个参考层一条覆盖记录',
      summary: '完整投影覆盖与左右两侧邻近铜同时判定',
      steps: [
        ['匹配走线与层', '按信号层筛选整条 Trace，并分别对已配置的上参考层、下参考层执行检查；逻辑层与物理层别名可互相匹配。'],
        ['检查完整投影', '沿直线和圆弧的整条路径核查完整线宽足迹是否有铜；发现缺口时记录首个真实缺铜点。'],
        ['检查两侧与豁免', '整条走线左、右两侧各查找一次规则距离内的邻近铜；仅豁免同网络、位于端点且跨越当前参考层 Via 的实际反焊盘。']
      ],
      standards: [
        ['pass', '符合', '每个参考层都完整覆盖端点豁免区以外的走线足迹，并且左侧、右侧各至少检出一处邻近铜。'],
        ['fail', '不符合', '任一参考层存在投影缺铜，或任意一侧在规则距离内完全没有铜。'],
        ['note', '检查口径', '两侧不要求连续铺满整个搜索走廊；中途反焊盘、异网络端点孔和不跨参考层的端点孔不豁免。']
      ]
    },
    isolated_copper: {
      scope: '全板所有 Shape Item',
      output: '小面积 Shape 与连接性复核证据',
      summary: '先按面积筛选，再核实轮廓内过孔',
      steps: [
        ['筛选小铜皮', '读取每个 Shape 的有效面积，只让面积大于 0 且小于配置阈值的对象进入小铜皮检查。'],
        ['核实过孔位置', '在 Shape 包围范围内查找同层 Via，并用真实实铜轮廓判断孔心是否位于铜内；落在 Void 中不算连接。'],
        ['生成复核项', '按 Shape 输出所在层、面积、质心坐标，以及轮廓内 Via 编号，供结果页与几何视口定位复核。']
      ],
      standards: [
        ['pass', '不列异常', '面积大于或等于阈值，或面积无效的 Shape 不进入该类异常清单。'],
        ['fail', '列为异常', '满足 0 < Shape 面积 < 配置阈值时，按一处小铜皮记录。'],
        ['note', '复核口径', '轮廓内同层 Via 是连接性证据并单独记录；面积阈值是当前自动判定条件。']
      ]
    },
    arc_radius: {
      scope: '所有 Shape 外轮廓与 Void 轮廓中的 Arc 段',
      output: '每个过小圆弧的半径与圆心坐标',
      summary: '逐段比较实测圆弧半径与最小值',
      steps: [
        ['提取圆弧', '遍历每个 Shape 的外轮廓和 Void 轮廓，仅提取 Arc seg；普通直线段不参与本项。'],
        ['测量半径', '使用报告中的圆心、起终点和方向保留真实扫掠弧，并读取每一段圆弧的实测半径。'],
        ['输出缺陷', '对低于阈值的圆弧逐段生成记录，保留 Shape 编号、层别、段序号、最小半径和圆心位置。']
      ],
      standards: [
        ['pass', '符合', '全部 Arc 段的半径都大于或等于配置的最小圆弧半径。'],
        ['fail', '不符合', '任意 Arc 段的半径小于配置值，每个过小圆弧分别计为一处。'],
        ['note', '检查口径', '单位为 mil；等于阈值时符合，没有 Arc 段的 Shape 不产生本类记录。']
      ]
    }
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function guideHtml(key, guide) {
    var steps = guide.steps.map(function (step, index) {
      return '<div class="pour-guide-step"><span class="pour-guide-step-no">' + (index + 1) + '</span>' +
        '<div><strong>' + esc(step[0]) + '</strong><p>' + esc(step[1]) + '</p></div></div>' +
        (index < guide.steps.length - 1 ? '<span class="pour-guide-arrow" aria-hidden="true"></span>' : '');
    }).join('');
    var standards = guide.standards.map(function (item) {
      return '<div class="pour-guide-standard ' + esc(item[0]) + '"><span>' + esc(item[1]) + '</span><p>' + esc(item[2]) + '</p></div>';
    }).join('');
    return '<details class="pour-check-guide" data-guide-key="' + esc(key) + '">' +
      '<summary><span class="pour-guide-badge">检查说明</span><span class="pour-guide-summary"><strong>' + esc(guide.summary) +
      '</strong><small>操作步骤 · 验证标准 · 输出结果</small></span><span class="pour-guide-toggle" aria-hidden="true"></span></summary>' +
      '<div class="pour-guide-body"><div class="pour-guide-meta"><span><b>检查对象</b>' + esc(guide.scope) +
      '</span><span><b>结果输出</b>' + esc(guide.output) + '</span></div>' +
      '<div class="pour-guide-section-title">操作步骤</div><div class="pour-guide-flow">' + steps + '</div>' +
      '<div class="pour-guide-section-title">验证标准</div><div class="pour-guide-standards">' + standards + '</div></div></details>';
  }

  function renderPourCheckGuides() {
    document.querySelectorAll('[data-pour-check-guide]').forEach(function (host) {
      var key = host.getAttribute('data-pour-check-guide');
      if (GUIDES[key]) host.innerHTML = guideHtml(key, GUIDES[key]);
    });
  }

  renderPourCheckGuides();
  root.renderPourCheckGuides = renderPourCheckGuides;
  root.POUR_CHECK_GUIDES = GUIDES;
})(typeof window !== 'undefined' ? window : globalThis);
