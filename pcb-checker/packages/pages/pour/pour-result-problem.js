/* 铜皮结果“问题点”文案：区分 HDI 网络不一致、关联失败、缺失、Set 不符与面积超差。 */
(function (root) {
  'use strict';
  function cleanMessage(value) {
    var clean = root.PourCleanMsg;
    return typeof clean === 'function' ? clean(value) : String(value == null ? '' : value).replace(/^[\s✅❌⚠️]+/u, '').trim();
  }
  function formatNetworkMismatch(record) {
    var layer = record.hdiConnectionLayer || '接触层';
    var shapeNets = record.hdiConnectionShapeNets && record.hdiConnectionShapeNets.length
      ? record.hdiConnectionShapeNets.join(' / ') : (record.viaNet || '-');
    var shapeIds = record.hdiConnectionShapeIds && record.hdiConnectionShapeIds.length
      ? ' #' + record.hdiConnectionShapeIds.join(' + #') : '';
    return '网络不一致：' + layer + ' 铜皮' + shapeIds + ' 为 ' + shapeNets +
      '，HDI #' + (record.actualHdiViaId == null ? '-' : record.actualHdiViaId) + ' 为 ' + (record.actualHdiViaNet || '-');
  }
  function networkMismatchKey(record) {
    return [record.hdiConnectionLayer || '', (record.hdiConnectionShapeIds || []).join(','),
      (record.hdiConnectionShapeNets || []).join(','), record.actualHdiViaId, record.actualHdiViaNet].join('|');
  }
  function formatSpecialShapeIssue(record, skipNetworkMismatch) {
    var prefix = (record.layer || '目标') + ' 层【' + (record.templateName || '异型模板') + '】';
    if (record.pass) return prefix + '异型铜皮匹配';
    if (record.associationFailed) return prefix + '模板关联条件未命中：' + record.associationSummary;
    var issues = [];
    if (record.hdiNetMismatch && !skipNetworkMismatch) issues.push(formatNetworkMismatch(record));
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
    if (issues.length) return prefix + issues.join('；');
    if (skipNetworkMismatch && record.hdiNetMismatch) return '';
    return prefix + '异型铜皮不匹配：' + cleanMessage(record.message);
  }
  function formatSpecialShapeIssues(records) {
    var list = records || [], networkIssues = [], details = [], seenNetworks = Object.create(null);
    list.forEach(function (record) {
      if (record.hdiNetMismatch) {
        var key = networkMismatchKey(record);
        if (!seenNetworks[key]) {
          seenNetworks[key] = true;
          networkIssues.push(formatNetworkMismatch(record));
        }
      }
      var detail = formatSpecialShapeIssue(record, !!record.hdiNetMismatch);
      if (detail && details.indexOf(detail) < 0) details.push(detail);
    });
    return networkIssues.concat(details).join('；');
  }
  root.formatPourSpecialShapeIssue = formatSpecialShapeIssue;
  root.formatPourSpecialShapeIssues = formatSpecialShapeIssues;
})(typeof window !== 'undefined' ? window : globalThis);
