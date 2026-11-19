/* ============================================================================
 * check-guide.js —— 五个检查模块共用的检查说明、操作流程与验证标准
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var GUIDES = {
    trace: {
      code: 'TRC · CHECK GUIDE', name: '走线检查说明',
      intro: '从 EDA 走线报告提取网络、出线层、线宽变化、线长和圆弧数据，先按层执行规则核对，再对差分对执行逐层与跨层总长差检查。',
      meta: [['输入数据', 'Trace / Trace Seg / Arc Seg'], ['检查对象', '网络 × 出线层'], ['结果输出', '分层结论、问题段、差分对结论']],
      flow: [['导入解析', '读取层、网络、长度、线宽与圆弧'], ['形成记录', '按网络和出线层汇总实际值'], ['应用规则', '层规则优先，默认规则兜底'], ['执行判定', '仅核对已启用的规则项目'], ['定位复验', '从结果定位几何并导出整改表']],
      schemes: [
        { title: '分层线宽组合与总线长', caption: '核对宽度变化顺序和网络在该层的累计长度',
          steps: [['匹配层规则', '按出线层选取启用的专用规则；没有专用规则时使用已启用的默认规则。'], ['提取实测值', '沿走线顺序合并连续同线宽段，形成线宽变化序列，并汇总网络在当前层的总长度。'], ['对照允许值', '线宽序列与任一允许组合正向或反向一致；总长按列表目标或包含边界的范围比较。']],
          pass: '所有已启用项目都命中允许组合或允许长度，数值差不超过全局容差。', fail: '任一已启用项目未命中，整条网络在该层判为不符合，并指出具体线宽或线长原因。', note: '没有适用规则的网络显示为未检查，不会被当作符合；关闭总开关或行内开关后对应项目不参与结论。' },
        { title: '指定线宽段长与圆弧半径', caption: '核对特殊线宽对应长度和圆弧制造约束',
          steps: [['筛选目标段', '按规则中的指定线宽提取对应直线或圆弧段，并保留实际段长与半径。'], ['解析规则表达式', '段长支持目标列表、范围及上下限；圆弧支持半径列表、范围或最小半径。'], ['逐项比较', '使用全局数值容差比较实际值，输出不满足的线宽、段长或圆弧半径。']],
          pass: '每个被规则命中的指定线宽段长和圆弧半径均满足已配置的允许值。', fail: '存在目标线宽段长超出允许条件，或任一圆弧半径未达到规则要求。', note: '只有数据中实际出现且对应开关开启的项目才参与；直线段不会进入圆弧半径检查。' },
        { title: '差分对逐层与总长差', caption: '独立核对 P/N 每层长度差和所有层合计差',
          steps: [['建立差分对', '按启用的网络后缀自动配对，也可使用手动 P 网络、N 网络列表覆盖自动结果。'], ['计算两类差值', '分别计算每个共同层的绝对线长差，以及 P/N 跨全部层合计后的绝对总长差。'], ['检查层分布', '同时保留 P/N 出现层集合，层分布不一致时在差分结果中明确标记。']],
          pass: '启用的逐层差值和总长差值均小于或等于各自上限，且配对数据完整。', fail: '任一层超差、跨层合计超差或 P/N 层分布不一致。', note: '逐层检查与总长检查是两个独立开关；关闭其中一项不会影响另一项的判定。' }
      ],
      review: ['先看不符合网络与原因', '再用定位按钮复核实际走线', '最后检查差分层分布与总长差']
    },
    copper: {
      code: 'CON · CHECK GUIDE', name: '约束检查说明',
      intro: '把约束 TXT 展开成逐层反焊盘、焊盘和非功能焊盘标准，再从板级 Item 数据识别完整信号孔、推算适用约束并逐孔逐层核对。',
      meta: [['输入数据', '约束 TXT + Shape / Via / Trace'], ['检查对象', '完整信号孔 × 经过层'], ['结果输出', '约束匹配、逐层尺寸、命名结论']],
      flow: [['导入约束', '解析参数行或三列表格规则'], ['展开矩阵', '按总层数生成逐层标准'], ['识别完整孔', '合并同网络盲埋孔段并确定层跨'], ['推算方案', '按封装、层跨与差分孔距选约束'], ['逐层复核', '核对尺寸、命名并定位异常孔']],
      schemes: [
        { title: '完整信号孔识别与约束推算', caption: '先形成实际完整孔，再选择唯一适用约束',
          steps: [['筛选信号孔', '仅含 SIG 特征的信号 Via 进入约束推算，GND 与普通孔保留显示但不推算。'], ['合并孔段', '依据同网络、连接关系、层跨与允许坐标偏移，把盲孔、埋孔和通孔段组合为完整孔。'], ['选择约束', '根据封装特征、完整层跨、出线方向和差分孔中心距，从已生成的约束中选择最接近方案。']],
          pass: '完整孔能够稳定匹配一条约束，并进入该约束覆盖层的后续尺寸核对。', fail: '孔段信息不足、层跨无法形成，或没有约束满足封装、层跨与孔距条件时显示未匹配。', note: '未匹配属于未检查状态，不会伪装成符合；完整孔的所有孔段和 Route Keepout 都保留在同一对象下。' },
        { title: '反焊盘、焊盘与非功能焊盘尺寸', caption: '按完整孔经过层逐层比较实际半径与约束值',
          steps: [['空间配对', '按孔坐标和位置容差关联同位置的 Route Keepout、Regular Pad 与其他圆形 Shape。'], ['读取层标准', '从已匹配约束矩阵取当前层的反焊盘、焊盘及非功能焊盘要求；标记为无的层按无铜要求处理。'], ['比较尺寸', '把实际圆形 Shape 半径与规则值比较，并记录缺失、尺寸不足、尺寸过大或额外铜皮。']],
          pass: '所有启用类别在每个受检层均存在正确对象，且实际半径与规则值的绝对偏差不超过数值容差。', fail: '受检层对象缺失、应无却存在，或实际尺寸与标准值偏差超过容差。', note: '位置容差只决定 Shape 与孔是否配对；数值容差只决定尺寸是否符合，两者不能互相替代。' },
        { title: 'Padstack 层名与连接层一致性', caption: '核对名称表达的层号是否覆盖真实 Connections',
          steps: [['提取连接层', '读取 Via Connections 中的 Trace 或 Shape 层，并结合 Padstack Defined 的实际层跨。'], ['解析名称层号', '从 Padstack Name 中识别起止层、单层或顶底面信息，并映射逻辑层与物理层名。'], ['逐项核对', '检查名称表达的层号是否包含全部真实连接层，并把缺少或冲突层直接列出。']],
          pass: 'Padstack 名称表达的层范围覆盖全部真实连接层，且与孔段物理层跨一致。', fail: '名称缺少实际连接层、起止层冲突，或单层命名与实际跨层不一致。', note: '该项由检查开关独立控制；关闭后不会影响反焊盘和焊盘尺寸检查。' }
      ],
      review: ['先确认完整孔是否匹配正确约束', '再展开逐层尺寸原因', '最后在几何视口核对 Shape 与孔的空间配对']
    },
    dfm: {
      code: 'DFM · CHECK GUIDE', name: '加工能力检查说明',
      intro: '依据真实焊盘形状、钻孔尺寸、走线直线与圆弧几何计算最小净距，并按层规则分别检查线到 GND 孔、线到信号孔及 GND 孔盘到信号孔盘。',
      meta: [['输入数据', 'Via / Trace Seg / Arc Seg'], ['检查对象', '线到孔对偶 + 异网孔盘对偶'], ['结果输出', '实测间距、阈值、亏欠量与坐标']],
      flow: [['配置规则', '设置口径、尺寸与分层阈值'], ['解析层跨', '识别通孔、盲孔、埋孔和单层焊盘'], ['生成对偶', '按网络、层重叠与空间索引筛选'], ['精确求距', '按真实焊盘和走线几何计算净距'], ['判定复核', '比较阈值并定位最危险位置']],
      schemes: [
        { title: '走线到 GND 孔与信号孔间距', caption: '两类过孔使用独立阈值和可选求距口径',
          steps: [['筛选有效对偶', '按网络范围、走线所在层及 Via 物理层跨筛选；明确不穿过该层的 Via 不参与。'], ['选择几何口径', '根据配置计算焊盘边缘、一钻孔壁或孔中心到走线边缘或中心的距离。'], ['应用分层阈值', '走线按自身层命中首条分层规则，GND 孔与信号孔分别使用对应阈值。']],
          pass: '实测最小距离大于或等于当前层、当前孔类别的规则阈值。', fail: '实测距离小于阈值，结果记录差值、最近几何位置、过孔与走线对象。', note: '仅检查异网络时同网络对偶跳过；层名无法确定时采用保守检查并显示提示，避免静默漏检。' },
        { title: 'GND 孔盘到信号孔盘间距', caption: '只在两孔物理层跨重叠时核对焊盘边缘净距',
          steps: [['建立孔对', '组合 GND Via 与信号 Via，排除网络范围不符或物理层跨没有重叠的孔对。'], ['计算真实净距', '按双方实际焊盘形状、长宽、圆角与旋转角计算 Pad to Pad Airgap。'], ['选择最严规则', '若多个重叠层命中不同阈值，使用重叠层中的最严格值。']],
          pass: '孔盘边缘最小净距大于或等于重叠层采用的阈值。', fail: '孔盘边缘净距小于阈值，或几何发生重叠导致实测值小于等于 0。', note: '孔盘到孔盘阈值填 0 时关闭该项；孔中心距不是最终判定值。' },
        { title: '非圆焊盘与圆弧精确几何', caption: '矩形、长圆、圆角矩形和圆弧均按真实轮廓求距',
          steps: [['建立焊盘模型', '圆形、长圆、圆角矩形和旋转矩形使用各自尺寸与方向构建真实边界。'], ['限定圆弧扫掠', '走线圆弧按起止点及 CW 或 CCW 方向限制有效弧段，不把缺口方向当成弧面。'], ['求最近点', '在线段、弧段与焊盘轮廓之间求最小距离，并把最近位置用于视口标记。']],
          pass: '精确几何得到的最小净距满足对应规则阈值。', fail: '真实轮廓求得的净距超标，即使包围盒或外接圆近似看似符合仍判不符合。', note: 'Padstack 单独尺寸优先于默认 GND 或信号尺寸；未启用单独尺寸时才回退默认值。' }
      ],
      review: ['先按亏欠量查看最危险对偶', '再在 2D 视口确认最近位置', '最后按重复模式评估批量整改范围']
    },
    fanout: {
      code: 'FAN · CHECK GUIDE', name: '扇出方案检查说明',
      intro: '以连接 breakout Trace 的信号孔为检查锚点，保留盲埋孔堆叠拓扑，关联附近伴随 GND，并与方案库执行旋转、镜像和 Padstack 匹配。',
      meta: [['输入数据', 'Via + Connections + Trace'], ['检查对象', '逻辑信号孔组 + 伴随 GND'], ['结果输出', '方案命中、缺孔、Padstack 与定位标记']],
      flow: [['准备方案', '确认标准信号孔和伴随地孔布局'], ['解析连接', '区分 Trace、Via 与 Shape Connections'], ['形成孔组', '沿 Via 拓扑折叠物理堆叠并关联 GND'], ['匹配方案', '尝试允许的旋转、镜像与距离容差'], ['定位复验', '标出具体问题点并返回原结果行']],
      schemes: [
        { title: '信号孔检查资格与堆叠拓扑', caption: '只有 breakout Trace 锚点能够启动检查组',
          steps: [['识别锚点', '仅 Connections 中明确含 Trace，或兼容同行走线层格式的信号 Via 可作为检查锚点。'], ['扩展孔堆叠', '从锚点沿同网络 Via Connections 纳入盲孔、埋孔和端部 Shape 孔段。'], ['折叠逻辑孔', '完整物理孔段保留在几何和审计中，但同一堆叠只按一个逻辑信号孔参与计数与匹配。']],
          pass: '孔组至少含一个合资格 Trace 锚点；关联堆叠成员均有 Connections 且属于同网络拓扑。', fail: '无 Trace 锚点的 Shape-only、Via-only 或空 Connections 孔群不创建检查组。', note: '附近 GND 只作为已建立信号孔组的伴随地孔，不能单独触发方案检查。' },
        { title: '方案几何与 Padstack 匹配', caption: '逻辑信号孔锁定方案，伴随地孔决定最终结论',
          steps: [['锁定信号布局', '比较逻辑信号孔数量、相对中心距与信号 Padstack，筛出可用方案。'], ['尝试刚体变换', '按配置尝试正交旋转、可选镜像以及任意角度候选，坐标偏差必须在容差内。'], ['核对伴随地孔', '逐个检查期望 GND 位置与 Padstack，并统计缺失孔、错误 Padstack 和允许的冗余地孔。']],
          pass: '信号布局与方案一致，所有必需伴随地孔均在容差内且 Padstack 正确。', fail: '没有方案满足信号拓扑，或方案已锁定但存在缺失地孔、位置偏差或 Padstack 不符。', note: '物理三段盲埋孔不会把一个逻辑信号孔重复计数；保存新方案时同样按逻辑孔折叠。' },
        { title: '结果定位与空间复核', caption: '从不符合原因直接落到几何问题点并可原路返回',
          steps: [['生成问题点', 'Padstack 不符标在实际孔位；缺失孔标在期望坐标；无精确项时标在异常逻辑信号孔。'], ['打开几何视口', '定位动作保留来源分页、结果区滚动位置和窗口滚动位置。'], ['返回来源行', '从工具栏或详情返回结果页，恢复原位置并对来源条目显示临时边框。']],
          pass: '复核人员可看到问题点、对应方案要求与完整孔堆叠，并完成复核标记。', fail: '定位标记与结果原因不一致时应返回规则和方案库核查，不应直接确认通过。', note: '编号标记用于区分同一孔组内多个问题点；缺失孔使用不同颜色的虚线定位环。' }
      ],
      review: ['先确认 Trace 锚点和逻辑孔数量', '再核对方案姿态与伴随地孔', '最后用定位往返完成空间复核']
    },
    pour: {
      code: 'POR · CHECK GUIDE', name: '铜皮检查说明',
      intro: '从 Shape、Via 与 Trace 数据执行五类铜皮检查，覆盖孔层铺铜、异型模板、走线参考层、孤立小铜皮和圆弧半径，并支持逐项空间定位。',
      meta: [['输入数据', 'Shape / Via / Trace'], ['检查对象', '孔、走线、铜皮 Shape'], ['结果输出', '五类逐层明细、对象汇总与整改分析']],
      flow: [['配置规则', '设置五类阈值与异型模板'], ['导入解析', '保留外轮廓、Void、Via 和走线'], ['执行几何', '按层索引并运行五类判定'], ['汇总结果', '按对象聚合或逐层平铺'], ['定位整改', '筛选问题、打开视口并复核']],
      schemes: [
        { title: '孔经过层铺铜覆盖', caption: '逐孔逐层测量孔心到最近真实铜面的距离',
          steps: [['筛选孔与层', 'Padstack 按子串匹配，星号匹配全部；层范围包含首尾并兼容逻辑层与物理层名。'], ['测量最近铜皮', '在每个目标层计算孔心到真实铜面的最短距离，孔心位于实铜内时距离为 0，Void 不算铜。'], ['逐层汇总', '记录最近 Shape 与距离，再把同一目标孔的缺铜层合并展示。']],
          pass: '每一个目标层的最近铜皮距离都小于或等于配置半径。', fail: '任一目标层无铜皮，或最近铜皮距离大于配置半径。', note: '判定半径内任意铜皮即可，不限制形状、面积或网络。' },
        { title: '特定异型铜皮模板', caption: '先关联 HDI 和差分孔距，再核对目标层 Shape 面积',
          steps: [['关联同网络 HDI', '启用搜索距离时，从目标 Via 查找范围内最近的同网络 HDI。'], ['选择孔距模板', '启用中心距时找到差分网络 HDI，以两颗 HDI 的中心距匹配模板，容差为 0.01 mil。'], ['组合 Shape 比对', '在目标层孔周 120 mil 内优先合并同层、同网且相接的 Shape，并比较合计面积。']],
          pass: '所有启用的关联条件命中，且每个目标层面积绝对偏差不超过模板容差。', fail: 'HDI 或差分 HDI 缺失、孔距未命中、目标层无 Shape，或面积偏差超限。', note: '目标孔到 HDI 的关联距离与两颗 HDI 的中心距是独立条件，留空即关闭对应限制。' },
        { title: '走线参考层投影与邻近铜', caption: '完整线宽投影和左右两侧邻近铜必须同时符合',
          steps: [['匹配信号层', '按规则找到整条 Trace，并分别检查已配置的上参考层和下参考层。'], ['检查完整投影', '沿直线与圆弧的完整路径核查整条线宽足迹，记录首个真实缺铜点。'], ['检查两侧与豁免', '整条走线左右两侧各查找一处规则距离内的铜；仅豁免同网络、端点且跨参考层 Via 的实际反焊盘。']],
          pass: '每个参考层完整覆盖豁免区外的走线足迹，且左侧、右侧各至少存在一处邻近铜。', fail: '任一参考层投影缺铜，或任意一侧在规则距离内完全没有铜。', note: '两侧不要求连续铺满走廊；中途反焊盘、异网络端点孔和不跨参考层端点孔不豁免。' },
        { title: '孤立小铜皮面积', caption: '按 Shape 面积筛选并记录同层 Via 连接性证据',
          steps: [['筛选面积', '读取 Shape 有效面积，只让面积大于 0 且小于配置阈值的对象进入。'], ['核实过孔', '在 Shape 范围内查找同层 Via，并判断孔心是否落在实铜轮廓；落在 Void 中不算。'], ['输出复核项', '记录层、面积、质心坐标和轮廓内 Via 编号，供结果与视口复核。']],
          pass: '面积大于或等于阈值，或面积无效的 Shape 不进入该类异常清单。', fail: '满足 0 < Shape 面积 < 配置阈值时，按一处小铜皮记录。', note: '轮廓内同层 Via 是连接性复核证据；面积阈值是当前自动判定条件。' },
        { title: '铜皮最小圆弧半径', caption: '逐段核对外轮廓和 Void 轮廓中的 Arc 半径',
          steps: [['提取 Arc 段', '遍历每个 Shape 外轮廓和 Void 轮廓，普通直线段不参与。'], ['读取真实半径', '按圆心、起终点和 CW 或 CCW 方向保留真实扫掠弧及实测半径。'], ['逐段输出', '对低于阈值的圆弧分别记录 Shape、层、段号、半径与圆心坐标。']],
          pass: '全部 Arc 段半径都大于或等于配置的最小半径。', fail: '任意 Arc 段半径小于配置值，每个过小圆弧分别计为一处。', note: '单位为 mil；等于阈值时符合，没有 Arc 段的 Shape 不产生本类记录。' }
      ],
      review: ['先按五类筛选不符合对象', '再定位真实孔位、缺铜点或 Shape', '最后结合规律分析安排批量整改']
    }
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderFlow(items) {
    return items.map(function (item, index) {
      return '<div class="module-guide-flow-step"><span class="module-guide-flow-no">' + (index + 1) + '</span>' +
        '<strong>' + esc(item[0]) + '</strong><p>' + esc(item[1]) + '</p></div>';
    }).join('');
  }
  function renderScheme(scheme, index) {
    var steps = scheme.steps.map(function (step, stepIndex) {
      return '<div class="module-guide-detail-step"><span>' + (stepIndex + 1) + '</span><div><strong>' + esc(step[0]) +
        '</strong><p>' + esc(step[1]) + '</p></div></div>';
    }).join('');
    return '<details class="module-guide-scheme"><summary><span class="module-guide-scheme-no">' + String(index + 1).padStart(2, '0') +
      '</span><span class="module-guide-scheme-title"><strong>' + esc(scheme.title) + '</strong><small>' + esc(scheme.caption) +
      '</small></span><span class="module-guide-chevron" aria-hidden="true"></span></summary><div class="module-guide-scheme-body">' +
      '<div class="module-guide-step-list">' + steps + '</div><div class="module-guide-verdicts">' +
      '<div class="module-guide-verdict pass"><strong>符合标准</strong><p>' + esc(scheme.pass) + '</p></div>' +
      '<div class="module-guide-verdict fail"><strong>不符合标准</strong><p>' + esc(scheme.fail) + '</p></div>' +
      '<div class="module-guide-verdict note"><strong>边界与例外</strong><p>' + esc(scheme.note) + '</p></div></div></div></details>';
  }
  function renderCheckGuidePage(host, guide) {
    var meta = guide.meta.map(function (item) {
      return '<div class="module-guide-meta-item"><b>' + esc(item[0]) + '</b><span>' + esc(item[1]) + '</span></div>';
    }).join('');
    var schemes = guide.schemes.map(renderScheme).join('');
    var review = guide.review.map(function (item, index) {
      return '<span><b>' + (index + 1) + '</b>' + esc(item) + '</span>';
    }).join('');
    host.innerHTML = '<div class="module-guide-page"><div class="module-guide-hero"><div><span class="module-guide-code">' + esc(guide.code) +
      '</span><h2>' + esc(guide.name) + '</h2><p>' + esc(guide.intro) + '</p></div><div class="module-guide-meta">' + meta +
      '</div></div><div class="module-guide-block"><div class="module-guide-block-head"><h3>一次检查怎么走</h3><span>从输入到复核的完整工序</span></div>' +
      '<div class="module-guide-flow">' + renderFlow(guide.flow) + '</div></div><div class="module-guide-block"><div class="module-guide-block-head">' +
      '<h3>检查方案与验证标准</h3><span>点击方案展开详细步骤</span></div><div class="module-guide-schemes">' + schemes + '</div></div>' +
      '<div class="module-guide-block"><div class="module-guide-block-head"><h3>建议复核顺序</h3><span>先看结论，再回到几何对象</span></div>' +
      '<div class="module-guide-review">' + review + '</div></div></div>';
  }
  function initCheckGuidePages() {
    document.querySelectorAll('[data-check-guide-module]').forEach(function (host) {
      var key = host.getAttribute('data-check-guide-module');
      if (GUIDES[key]) renderCheckGuidePage(host, GUIDES[key]);
    });
  }

  initCheckGuidePages();
  root.renderCheckGuidePage = renderCheckGuidePage;
  root.CHECK_GUIDE_DEFINITIONS = GUIDES;
})(typeof window !== 'undefined' ? window : globalThis);
