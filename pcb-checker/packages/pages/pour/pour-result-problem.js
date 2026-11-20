/* 铜皮结果“问题点”文案：区分 HDI 网络不一致、关联失败、缺失、Set 不符与面积超差。 */
(function (root) {
  'use strict';
  function cleanMessage(value) {
    var clean = root.PourCleanMsg;
    return typeof clean === 'function' ? clean(value) : String(value == null ? '' : value).replace(/^[\s✅❌⚠️]+/u, '').trim();
  }
  function formatNetworkMismatch(record) {
    var layer = record.hdiConnectionLayer || '接触';
    var shapeNets = record.hdiConnectionShapeNets && record.hdiConnectionShapeNets.length
      ? record.hdiConnectionShapeNets.join(' / ') : (record.viaNet || '-');
    var shapeIds = record.hdiConnectionShapeIds && record.hdiConnectionShapeIds.length
      ? ' Shape #' + record.hdiConnectionShapeIds.join(' + #') : '';
    return '网络不一致：实际接触的 ' + layer + ' 层铜皮' + shapeIds + ' Net=' + shapeNets +
      '，但 HDI 孔 #' + (record.actualHdiViaId == null ? '-' : record.actualHdiViaId) +
      ' Net=' + (record.actualHdiViaNet || '-') + '，按异常处理';
  }
  function formatSpecialShapeIssue(record) {
    var prefix = (record.layer || '目标') + ' 层【' + (record.templateName || '异型模板') + '】';
    if (record.pass) return prefix + '异型铜皮匹配';
    if (record.associationFailed) return prefix + '模板关联条件未命中：' + record.associationSummary;
    var issues = [];
    if (record.hdiNetMismatch) issues.push(formatNetworkMismatch(record));
    if (record.targetShapeId == null) {
      var expectedSet = record.expectedSet ? 'Set=' + record.expectedSet + ' 的 ' : '';
      var alternateSet = record.actualSet ? '；同位置仅有 Set=' + record.actualSet : '';
      issues.push('缺失异型铜皮：未找到关联的 ' + expectedSet + 'Shape Item' + alternateSet);
    } else {
      var actual = Number(record.actualArea), expected = Number(record.expectedArea), tolerance = Number(record.areaTolerance);
      if (isFinite(actual) && isFinite(expected) && isFinite(tolerance)) {
        var difference = Math.abs(actual - expected);
        if (difference > tolerance + 1e-9) {
          var shapeIds = record.targetShapeIds && record.targetShapeIds.length ? record.targetShapeIds : [record.targetShapeId];
          var shapeText = 'Shape #' + shapeIds.join(' + #') + ' ';
          issues.push('面积不符：' + shapeText + '实测 ' + (Math.round(actual * 10) / 10) + ' sq mil，要求 ' +
            (Math.round(expected * 10) / 10) + ' ±' + tolerance + ' sq mil，偏差 ' + (Math.round(difference * 10) / 10) + ' sq mil');
        }
      }
    }
    return issues.length ? prefix + issues.join('；') : prefix + '异型铜皮不匹配：' + cleanMessage(record.message);
  }
  root.formatPourSpecialShapeIssue = formatSpecialShapeIssue;
})(typeof window !== 'undefined' ? window : globalThis);
