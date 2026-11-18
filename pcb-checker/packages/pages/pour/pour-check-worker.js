/* 铜皮五项检查后台线程：大文件解析与几何计算不占用页面主线程。 */
'use strict';

importScripts(
  '../../engines/pour/pour-geom.js?v=45',
  '../../engines/pour/pour-parser.js?v=45',
  '../../engines/pour/pour-engine.js?v=45'
);

self.onmessage = function (event) {
  var data = event.data || {};
  var runId = data.runId;
  try {
    var result = self.PourChecker.runAllCopperChecks(String(data.text || ''), data.config || {});
    self.postMessage({ type: 'result', runId: runId, result: result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      runId: runId,
      message: error && error.message ? error.message : String(error || '未知错误')
    });
  }
};
