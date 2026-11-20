/* ============================================================================
 * pour-analysis-export.js —— 缺陷规律分析 Markdown 导出
 * ========================================================================== */
(function (root) {
  'use strict';

  function exportAnalysisReport() {
    var State = root.State;
    if (!State.summary) {
      root.alert('暂无分析数据可导出');
      return;
    }

    var stats = typeof root.getPourAnalysisDefectStats === 'function' ? root.getPourAnalysisDefectStats() : null;
    var totalObj = State.groupedResults ? State.groupedResults.length : State.summary.totalChecks;
    var defObj = stats ? stats.totalObjects : (State.groupedResults ? State.groupedResults.filter(function (group) { return !group.pass; }).length : State.summary.totalDefects);
    var rawDefects = stats ? stats.totalRaw : State.summary.totalDefects;
    var objectCounts = stats ? stats.objectCounts : {};
    var rawCounts = stats ? stats.rawCounts : {};
    function categoryStat(key, fallback) {
      return (objectCounts[key] == null ? fallback : objectCounts[key]) + ' 个异常目标对象 / ' +
        (rawCounts[key] == null ? fallback : rawCounts[key]) + ' 条失败明细';
    }

    var report = [
      '# PCB 铜皮五项检查缺陷规律与工程分析报告',
      '生成时间: ' + new Date().toLocaleString(),
      '',
      '## 1. 全板检查统计',
      '- 导入铜皮总数: ' + State.summary.totalShapes + ' 块',
      '- 导入过孔总数: ' + State.summary.totalVias + ' 个',
      '- 导入走线总数: ' + State.summary.totalTraces + ' 条',
      '- 目标对象总数: ' + totalObj + ' 个',
      '- 检出异常目标对象: ' + defObj + ' 个',
      '- 失败模板/层别明细: ' + rawDefects + ' 条（同一对象可有多条）',
      '',
      '## 2. 分类规律与整改措施',
      '### ① 孔经过层铺铜覆盖检查: ' + categoryStat('via_coverage', State.summary.breakdown.viaCoverageDefects),
      '- 整改措施: 在相关内层补充参考铜皮，或周边 30–50 mil 增设 GND 回流孔。',
      '',
      '### ② 特定异型铜皮比对检查: ' + categoryStat('special_shape', State.summary.breakdown.specialShapeDefects),
      '- 整改措施: 核查指定层异型铜皮自动生成规则并修复反焊盘切割区域。',
      '',
      '### ③ 走线参考层投影覆盖与两侧邻近铜检查: ' + categoryStat('trace_ref_margin', State.summary.breakdown.traceMarginDefects),
      '- 整改措施: 补齐首尾端所有被检查层反焊盘豁免区以外的完整走线投影参考铜，并确保整条走线左右两侧各有铜皮位于规则距离内。',
      '',
      '### ④ 孤立小铜皮检查: ' + categoryStat('isolated_copper', State.summary.breakdown.smallCopperDefects),
      '- 整改措施: 开启铺铜孤立死铜自动移除策略。',
      '',
      '### ⑤ 铜皮最小圆弧半径检查: ' + categoryStat('arc_radius', State.summary.breakdown.arcRadiusDefects),
      '- 整改措施: 调整铜皮轮廓避让圆弧平滑半径至阈值以上。'
    ].join('\n');

    root.showExportBox('铜皮检查缺陷规律分析报告.md', report, '已生成 Markdown 分析报告。', 'text/markdown');
  }

  root.exportAnalysisReport = exportAnalysisReport;
})(typeof window !== 'undefined' ? window : globalThis);
