/* ============================================================================
 * fanout-result-details.js —— 扇出结果逐孔归因、目标值与修改建议
 * ========================================================================== */
(function (root) {
  'use strict';

  var FC = root.FanoutChecker || {};
  var escapeHtml = root.escapeHtml || function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  function fmt(value) {
    var number = Number(value);
    return isFinite(number) ? number.toFixed(2).replace(/\.00$/, '') : '-';
  }

  function point(x, y) {
    return '[' + fmt(x) + ', ' + fmt(y) + ']';
  }

  function isSignalVia(via) {
    if (FC.isSignalVia) return FC.isSignalVia(via);
    return Boolean(via && (!via.net || String(via.net).toUpperCase().indexOf('GND') < 0));
  }

  function signalVias(items) {
    return (items || []).filter(isSignalVia);
  }

  function signalRole(via) {
    var text = String((via && via.net) || '') + ' ' + String((via && via.role) || '');
    var match = text.match(/(?:^|[_\s差分])([PN])(?:$|[_\s孔])/i);
    return match ? match[1].toUpperCase() : '';
  }

  function mapSignalVias(actual, expected) {
    var remaining = expected.map(function (via, index) { return { via: via, index: index }; });
    return actual.slice(0, expected.length).map(function (via) {
      var role = signalRole(via), actualPad = String(via.padstack || '').trim().toLowerCase();
      var found = remaining.findIndex(function (item) {
        return role && signalRole(item.via) === role && actualPad === String(item.via.padstack || '').trim().toLowerCase();
      });
      if (found < 0) found = remaining.findIndex(function (item) { return actualPad && String(item.via.padstack || '').trim().toLowerCase() === actualPad; });
      if (found < 0) found = remaining.findIndex(function (item) { return role && signalRole(item.via) === role; });
      if (found < 0) found = 0;
      var item = remaining.splice(found, 1)[0];
      return { actual: via, expected: item && item.via };
    }).filter(function (pair) { return pair.expected; });
  }

  function distanceSpectrum(vias) {
    var values = [];
    for (var i = 0; i < vias.length; i++) {
      for (var j = i + 1; j < vias.length; j++) values.push(Math.hypot(vias[i].x - vias[j].x, vias[i].y - vias[j].y));
    }
    return values.sort(function (a, b) { return a - b; });
  }

  function closestSignalScheme(cluster, library) {
    var actual = cluster.matchingSignalVias && cluster.matchingSignalVias.length ? cluster.matchingSignalVias :
      (cluster.signalVias && cluster.signalVias.length ? cluster.signalVias : signalVias(cluster.vias));
    var candidates = ((library && library.schemes) || []).map(function (scheme, libraryIndex) {
      var expected = signalVias(scheme.vias);
      if (!expected.length) return null;
      var pairs = mapSignalVias(actual, expected);
      var padMismatchCount = pairs.filter(function (pair) {
        return String(pair.actual.padstack || '').trim().toLowerCase() !== String(pair.expected.padstack || '').trim().toLowerCase();
      }).length;
      var actualDists = distanceSpectrum(actual), expectedDists = distanceSpectrum(expected), compareCount = Math.min(actualDists.length, expectedDists.length);
      var geometryDelta = 0;
      for (var i = 0; i < compareCount; i++) geometryDelta += Math.abs(actualDists[i] - expectedDists[i]);
      geometryDelta = compareCount ? geometryDelta / compareCount : 0;
      var countDelta = Math.abs(actual.length - expected.length);
      var geometryRank = Math.round(geometryDelta * 1000) / 1000;
      return {
        scheme: scheme, actual: actual, expected: expected, pairs: pairs, countDelta: countDelta,
        padMismatchCount: padMismatchCount, geometryDelta: geometryDelta, geometryRank: geometryRank, libraryIndex: libraryIndex,
        score: countDelta * 1000000 + padMismatchCount * 10000 + geometryRank
      };
    }).filter(Boolean);
    var sameCountCandidates = candidates.filter(function (item) { return item.countDelta === 0; });
    var pool = sameCountCandidates.length ? sameCountCandidates : candidates;
    pool.sort(function (a, b) {
      if (a.countDelta !== b.countDelta) return a.countDelta - b.countDelta;
      if (a.padMismatchCount !== b.padMismatchCount) return a.padMismatchCount - b.padMismatchCount;
      if (a.geometryRank !== b.geometryRank) return a.geometryRank - b.geometryRank;
      var nameA = String(a.scheme.name || ''), nameB = String(b.scheme.name || '');
      if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      return a.libraryIndex - b.libraryIndex;
    });
    var closest = pool[0] || null;
    if (closest) closest.sameSignalCountOnly = sameCountCandidates.length > 0;
    return closest;
  }

  function pushUnique(issues, seen, kind, label, text) {
    var key = kind + '|' + text;
    if (seen[key]) return;
    seen[key] = true;
    issues.push({ kind: kind, label: label, text: text });
  }

  function addPadstackIssues(result, issues, seen) {
    var records = [];
    records = records.concat(result.padstackMismatches || [], result.padMismatchList || []);
    (result.viaAudit || []).forEach(function (item) { if (item.isMatch === false) records.push(item); });
    records.forEach(function (item) {
      var location = item.x != null && item.y != null ? '，位置 ' + point(item.x, item.y) : '';
      pushUnique(issues, seen, 'padstack', 'Padstack 不对',
        '孔 #' + item.viaId + location + '：当前「' + (item.actualPadstack || '-') + '」，应改为「' + (item.expectedPadstack || '-') + '」' +
        (item.schemeRole || item.role ? '（' + (item.schemeRole || item.role) + '）' : '') + '。');
    });
  }

  function addMissingAndExtraIssues(cluster, result, issues, seen) {
    (result.positionMismatches || []).forEach(function (item) {
      pushUnique(issues, seen, 'position', '位置不对',
        '孔 #' + item.viaId + '：当前在 ' + point(item.actualX, item.actualY) + '，应移到 ' + point(item.expectedX, item.expectedY) +
        '，偏差 ' + fmt(item.deviation) + ' mil；目标 Padstack 为「' + (item.expectedPadstack || '-') + '」。');
    });
    (result.missingVias || []).forEach(function (item) {
      pushUnique(issues, seen, 'missing', '缺少孔',
        '方案要求在 ' + point(item.expectedX, item.expectedY) + ' 放置 1 个' + (item.role || '伴随地孔') +
        '，Padstack 应为「' + (item.expectedPadstack || '-') + '」；当前该位置没有合格孔。');
    });
    (result.extraVias || []).forEach(function (item) {
      pushUnique(issues, seen, 'extra', '多出孔',
        '孔 #' + (item.viaId != null ? item.viaId : item.id) + ' 位于 ' + point(item.x, item.y) + '，Padstack 为「' +
        (item.padstack || item.actualPadstack || '-') + '」，方案中没有对应位置；若不是其他用途孔，应删除或移出该孔群。');
    });
  }

  function addUnmatchedSignalIssues(cluster, library, tolerance, issues, seen) {
    var closest = closestSignalScheme(cluster, library);
    if (!closest) return { schemeName: '无可用方案', basis: '方案库没有可比较的信号对象', advice: '请先在方案库建立与该信号孔群对应的标准方案。' };
    var actual = closest.actual, expected = closest.expected, scheme = closest.scheme;
    if (actual.length > expected.length) {
      pushUnique(issues, seen, 'extra', '信号孔多出', '实际有 ' + actual.length + ' 个信号孔（' + actual.map(function (v) { return '#' + v.id; }).join('、') +
        '），方案【' + scheme.name + '】只需要 ' + expected.length + ' 个，多出 ' + (actual.length - expected.length) + ' 个；请按方案角色确认要删除或移出的孔。');
    } else if (actual.length < expected.length) {
      var missingExpected = expected.slice(actual.length).map(function (v) { return (v.role || v.net || '信号孔') + '「' + (v.padstack || '-') + '」'; }).join('、');
      pushUnique(issues, seen, 'missing', '信号孔缺少', '实际只有 ' + actual.length + ' 个信号孔，方案【' + scheme.name + '】需要 ' + expected.length +
        ' 个，缺少 ' + (expected.length - actual.length) + ' 个：' + missingExpected + '。');
    }
    closest.pairs.forEach(function (pair) {
      var actualPad = String(pair.actual.padstack || '').trim(), expectedPad = String(pair.expected.padstack || '').trim();
      if (actualPad.toLowerCase() === expectedPad.toLowerCase()) return;
      pushUnique(issues, seen, 'padstack', '信号孔 Padstack 不对', '孔 #' + pair.actual.id + '（' + (pair.actual.net || '信号网络') + '）当前为「' +
        (actualPad || '-') + '」，方案【' + scheme.name + '】要求「' + (expectedPad || '-') + '」' + (pair.expected.role ? '（' + pair.expected.role + '）' : '') + '。');
    });
    if (closest.pairs.length >= 2) {
      var worst = null;
      for (var i = 0; i < closest.pairs.length; i++) {
        for (var j = i + 1; j < closest.pairs.length; j++) {
          var a = closest.pairs[i], b = closest.pairs[j];
          var actualDist = Math.hypot(a.actual.x - b.actual.x, a.actual.y - b.actual.y);
          var expectedDist = Math.hypot(a.expected.x - b.expected.x, a.expected.y - b.expected.y);
          var delta = Math.abs(actualDist - expectedDist);
          if (!worst || delta > worst.delta) worst = { a: a.actual, b: b.actual, actualDist: actualDist, expectedDist: expectedDist, delta: delta };
        }
      }
      if (worst && worst.delta > Number(tolerance || 2)) {
        var dx = worst.b.x - worst.a.x, dy = worst.b.y - worst.a.y, length = Math.hypot(dx, dy) || 1;
        var targetX = worst.a.x + dx / length * worst.expectedDist;
        var targetY = worst.a.y + dy / length * worst.expectedDist;
        pushUnique(issues, seen, 'position', '信号孔位置不对', '孔 #' + worst.a.id + ' 与 #' + worst.b.id + ' 当前中心距 ' + fmt(worst.actualDist) +
          ' mil，方案要求 ' + fmt(worst.expectedDist) + ' mil，超差 ' + fmt(worst.delta) + ' mil；若固定 #' + worst.a.id + '，则 #' + worst.b.id +
          ' 应移到约 ' + point(targetX, targetY) + '。');
      }
    }
    if (!issues.length) {
      pushUnique(issues, seen, 'position', '拓扑对应不清', '实际信号孔为 ' + actual.map(function (v) { return '#' + v.id + ' ' + (v.net || '-') + ' ' + point(v.x, v.y); }).join('；') +
        '；最接近方案要求为 ' + expected.map(function (v) { return (v.role || v.net || '-') + ' ' + point(v.x, v.y); }).join('；') + '。');
    }
    var countBasis = closest.sameSignalCountOnly
      ? '实际与方案均为 ' + actual.length + ' 个信号对象，只在同数量方案中比较'
      : '方案库没有同为 ' + actual.length + ' 个信号对象的方案，使用跨数量兜底比较';
    return {
      schemeName: scheme.name,
      basis: countBasis + '；Padstack 不符 ' + closest.padMismatchCount + ' 个；孔距谱平均差 ' + fmt(closest.geometryDelta) + ' mil',
      advice: '先按上面的孔号修正信号孔 Padstack、数量和中心距，再重新检查伴随地孔。'
    };
  }

  function build(cluster, library, tolerance) {
    var result = cluster.matchResult || {}, issues = [], seen = {};
    addPadstackIssues(result, issues, seen);
    addMissingAndExtraIssues(cluster, result, issues, seen);
    var summary = result.message || result.statusText || '-';
    var advice = result.advice || (result.pass ? '无需调整。' : '按列出的问题逐项修改后重新检查。');
    if (result.status === 'NO_MATCH_TOPOLOGY' || result.status === 'VIA_COUNT_MISMATCH' || (result.status === 'DISTANCE_MISMATCH' && !issues.length)) {
      var unmatched = addUnmatchedSignalIssues(cluster, library, tolerance, issues, seen);
      summary = '未匹配预设方案；最接近【' + unmatched.schemeName + '】。选择依据：' + unmatched.basis + '。';
      advice = unmatched.advice;
    }
    return { summary: summary, issues: issues, advice: advice };
  }

  function render(cluster, library, tolerance) {
    var detail = build(cluster, library, tolerance);
    var issueHtml = detail.issues.length ? '<ul class="fanout-result-issues">' + detail.issues.map(function (issue) {
      return '<li class="' + issue.kind + '"><b>' + escapeHtml(issue.label) + '</b><span>' + escapeHtml(issue.text) + '</span></li>';
    }).join('') + '</ul>' : '';
    return '<div class="fanout-result-summary">' + escapeHtml(detail.summary) + '</div>' + issueHtml +
      '<div class="fanout-result-advice"><b>怎么改：</b>' + escapeHtml(detail.advice) + '</div>';
  }

  function toText(cluster, library, tolerance) {
    var detail = build(cluster, library, tolerance);
    return [detail.summary].concat(detail.issues.map(function (issue) { return issue.label + '：' + issue.text; }), ['怎么改：' + detail.advice]).join('；');
  }

  root.FanoutResultDetails = { build: build, render: render, toText: toText, closestSignalScheme: closestSignalScheme };
})(typeof window !== 'undefined' ? window : globalThis);
