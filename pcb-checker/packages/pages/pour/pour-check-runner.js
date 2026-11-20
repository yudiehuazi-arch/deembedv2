/* ============================================================================
 * pour-check-runner.js —— 铜皮大文件导入、后台 Worker 调度与检查结果落库
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var State = root.State;
  var WORKER_URL = 'packages/pages/pour/pour-check-worker.js?v=74';
  var LARGE_FILE_LIMIT = 2 * 1024 * 1024;
  var PREVIEW_CHARS = 200000;
  var IDLE_BUTTON_TEXT = '▶ 运行铜皮五项检查';

  function runButton() { return document.getElementById('btnRunCheck'); }

  function setRunStatus(text, disabled) {
    var btn = runButton();
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = !!disabled;
  }

  function clearCheckTimer() {
    if (State.checkTimer) root.clearInterval(State.checkTimer);
    State.checkTimer = null;
  }

  function resetRunStatus() {
    clearCheckTimer();
    setRunStatus(IDLE_BUTTON_TEXT, false);
  }

  function terminateWorker() {
    if (State.checkWorker && typeof State.checkWorker.terminate === 'function') State.checkWorker.terminate();
    State.checkWorker = null;
    clearCheckTimer();
  }

  function startElapsedStatus(runId) {
    State.checkStartedAt = Date.now();
    clearCheckTimer();
    State.checkTimer = root.setInterval(function () {
      if (!State.checkWorker || runId !== State.checkRunId) return;
      var elapsed = Math.max(1, Math.floor((Date.now() - State.checkStartedAt) / 1000));
      setRunStatus('取消后台检查 · 已运行 ' + elapsed + ' 秒', false);
    }, 1000);
  }

  function setImportedText(text, fileName, fileSize) {
    var input = document.getElementById('txtDataInput');
    text = String(text || '');
    State.importedText = text;
    State.hasImportedText = true;
    State.importedFileName = fileName || '';
    if (!input) return;
    if ((fileSize || text.length) > LARGE_FILE_LIMIT) {
      var sizeMb = ((fileSize || text.length) / 1024 / 1024).toFixed(1);
      input.value = text.slice(0, PREVIEW_CHARS) + '\n\n--- 大文件仅预览前 ' +
        PREVIEW_CHARS.toLocaleString() + ' 个字符；已载入完整文件 ' + (fileName || '') + ' · ' + sizeMb + ' MB，检查使用完整内容 ---';
      input.dataset.largeFilePreview = '1';
    } else {
      input.value = text;
      delete input.dataset.largeFilePreview;
    }
  }

  function bindImportedTextEditor() {
    var input = document.getElementById('txtDataInput');
    if (!input || input.__pourImportBound) return;
    input.__pourImportBound = true;
    input.addEventListener('beforeinput', function () {
      if (input.dataset.largeFilePreview === '1') {
        input.value = '';
        delete input.dataset.largeFilePreview;
        State.importedText = '';
        State.hasImportedText = false;
        State.importedFileName = '';
      }
    });
    input.addEventListener('input', function () {
      if (input.dataset.largeFilePreview !== '1') {
        State.importedText = '';
        State.hasImportedText = false;
        State.importedFileName = '';
      }
    });
  }

  function failCheck(error, runId) {
    if (runId != null && runId !== State.checkRunId) return;
    terminateWorker();
    resetRunStatus();
    var message = error && error.message ? error.message : String(error || '未知错误');
    root.alert('铜皮检查未完成：' + message);
  }

  function handleFileUpload(event) {
    var file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    setRunStatus('正在读取 ' + file.name + ' · ' + (file.size / 1024 / 1024).toFixed(1) + ' MB', true);
    var reader = new root.FileReader();
    reader.onload = function (e) {
      try {
        var decoded = root.decodeTxt ? root.decodeTxt(e.target.result) : String(e.target.result || '');
        setImportedText(decoded, file.name, file.size);
        executeCopperChecks();
      } catch (error) {
        failCheck(error);
      }
    };
    reader.onerror = function () { failCheck(new Error('无法读取文件 ' + file.name)); };
    if (reader.readAsArrayBuffer && root.decodeTxt) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  function loadSampleShapes() {
    root.fetch('sample/铜皮数据示例.txt')
      .then(function (response) { return response.text(); })
      .then(function (text) {
        setImportedText(text, '铜皮数据示例.txt', text.length);
        executeCopperChecks();
      })
      .catch(function (error) { failCheck(error || new Error('无法载入示例文件')); });
  }

  function readCheckConfig() {
    State.smallCopperAreaThreshold = parseFloat(document.getElementById('rule4InpArea').value) || 500.0;
    State.minArcRadius = parseFloat(document.getElementById('rule5InpRadius').value) || 10.0;
    return {
      viaCoverageRules: State.viaCoverageRules,
      specialShapeTemplates: State.specialShapeTemplates,
      traceMarginRules: State.traceMarginRules,
      smallCopperAreaThreshold: State.smallCopperAreaThreshold,
      minArcRadius: State.minArcRadius
    };
  }

  function applyCheckResult(result) {
    State.shapes = result.shapes;
    State.vias = result.vias;
    State.traces = result.traces;
    State.layers = result.layers;
    State.rawResults = result.results.all;
    State.groupedResults = result.results.grouped || root.PourChecker.groupResultsByTargetObject(result.results.all);
    State.results = State.groupedResults;
    State.summary = result.summary;
    State.page = 1;
    State.expandedRows.clear();
    State.canvas.hasInitialFit = false;
    State.canvas.highlightShapeIds = [];
    State.canvas.activeProblem = null;
    State.canvas.showDefects = true;
    State.canvas.defectFilter = 'all';
    State.canvas.defectSubFilter = '';
    State.canvas.shapeLayerMode = 'all';
    State.canvas.visibleShapeLayers = [];
    State.canvas.problemShapeLayers = [];
    State.canvas.returnPosition = null;
    if (typeof root.refreshCanvasShapeLayerOptions === 'function') root.refreshCanvasShapeLayerOptions();
    if (typeof root.refreshCanvasDefectButtons === 'function') root.refreshCanvasDefectButtons();
    var returnButton = document.getElementById('btnReturnPourResults');
    if (returnButton) returnButton.style.display = 'none';
    if (typeof root.updateTopKPIs === 'function') root.updateTopKPIs();
    if (typeof root.applyFilters === 'function') root.applyFilters();
    root.switchTab('tabResults');
    if (root.EdaShell && typeof root.EdaShell.syncTelemetry === 'function') root.EdaShell.syncTelemetry();
  }

  function completeCheck(result, runId) {
    if (runId != null && runId !== State.checkRunId) return;
    terminateWorker();
    resetRunStatus();
    applyCheckResult(result);
  }

  function runOnMainThread(text, config) {
    setRunStatus('正在执行五项几何检查...', true);
    root.setTimeout(function () {
      try {
        completeCheck(root.PourChecker.runAllCopperChecks(text, config));
      } catch (error) {
        failCheck(error);
      }
    }, 30);
  }

  function startWorkerCheck(text, config) {
    var runId = ++State.checkRunId;
    var worker = new root.Worker(WORKER_URL);
    State.checkWorker = worker;
    setRunStatus('取消后台检查 · 已运行 0 秒', false);
    startElapsedStatus(runId);
    worker.onmessage = function (event) {
      var data = event.data || {};
      if (data.runId !== runId) return;
      if (data.type === 'result') completeCheck(data.result, runId);
      else if (data.type === 'error') failCheck(new Error(data.message || '后台检查异常'), runId);
    };
    worker.onerror = function (event) {
      if (event && event.preventDefault) event.preventDefault();
      failCheck(new Error((event && event.message) || '后台检查线程加载失败'), runId);
    };
    worker.postMessage({ runId: runId, text: text, config: config });
  }

  function cancelCopperChecks() {
    if (!State.checkWorker) return false;
    State.checkRunId++;
    terminateWorker();
    resetRunStatus();
    return true;
  }

  function executeCopperChecks() {
    if (State.checkWorker) { cancelCopperChecks(); return; }
    var input = document.getElementById('txtDataInput');
    var text = State.hasImportedText ? State.importedText : (input ? input.value : '');
    if (!text || !/\S/.test(text)) {
      root.switchTab('tabImport');
      root.alert('请先上传或粘贴包含 Shape / Via / Trace 的 TXT 数据。');
      return;
    }
    var config = readCheckConfig();
    if (root.__SYNC_CHECK__) {
      setRunStatus('正在执行五项几何检查...', true);
      try { completeCheck(root.PourChecker.runAllCopperChecks(text, config)); }
      catch (error) { failCheck(error); }
      return;
    }
    if (typeof root.Worker === 'function') {
      try { startWorkerCheck(text, config); }
      catch (error) { failCheck(error); }
    } else {
      runOnMainThread(text, config);
    }
  }

  root.handleFileUpload = handleFileUpload;
  root.loadSampleShapes = loadSampleShapes;
  root.executeCopperChecks = executeCopperChecks;
  root.cancelCopperChecks = cancelCopperChecks;
  root.setPourImportedText = setImportedText;
  bindImportedTextEditor();
})(typeof window !== 'undefined' ? window : globalThis);
