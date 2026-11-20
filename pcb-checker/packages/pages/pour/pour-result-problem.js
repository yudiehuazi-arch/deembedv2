/* 铜皮结果“问题点”文案：区分异型铜皮关联失败、缺失、Set 不符与面积超差。 */
(function (root) {
  'use strict';
  function cleanMessage(value) {
    var clean = root.PourCleanMsg;
    return typeof clean === 'function' ? clean(value) : String(value == null ? '' : value).replace(/^[\s✅❌⚠️]+/u, '').trim();
  }
  function formatSpecialShapeIssue(record) {
    var prefix = (record.layer || '目标') + ' 层【' + (record.templateName || '异型模板') + '】';
    if (record.pass) return prefix + '异型铜皮匹配';
    if (record.associationFailed) return prefix + '模板关联条件未命中：' + record.associationSummary;
    if (record.targetShapeId == null) {
      var expectedSet = record.expectedSet ? 'Set=' + record.expectedSet + ' 的 ' : '';
      var alternateSet = record.actualSet ? '；同位置仅有 Set=' + record.actualSet : '';
      return prefix + '缺失异型铜皮：未找到关联的 ' + expectedSet + 'Shape Item' + alternateSet;
    }
    var actual = Number(record.actualArea), expected = Number(record.expectedArea), tolerance = Number(record.areaTolerance);
    if (isFinite(actual) && isFinite(expected) && isFinite(tolerance)) {
      var difference = Math.abs(actual - expected);
      var shapeIds = record.targetShapeIds && record.targetShapeIds.length ? record.targetShapeIds : [record.targetShapeId];
      var shapeText = 'Shape #' + shapeIds.join(' + #') + ' ';
      return prefix + '面积不符：' + shapeText + '实测 ' + (Math.round(actual * 10) / 10) + ' sq mil，要求 ' +
        (Math.round(expected * 10) / 10) + ' ±' + tolerance + ' sq mil，偏差 ' + (Math.round(difference * 10) / 10) + ' sq mil';
    }
    return prefix + '异型铜皮不匹配：' + cleanMessage(record.message);
  }
  root.formatPourSpecialShapeIssue = formatSpecialShapeIssue;
})(typeof window !== 'undefined' ? window : globalThis);
