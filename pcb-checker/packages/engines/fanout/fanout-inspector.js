/* ============================================================================
 * fanout-inspector.js —— 信号单元配对、伴随地孔索引与全板扇出方案联检调度
 * ========================================================================== */
(function (root, factory) {
var parser = (typeof module === "object" && module.exports) ? require("./fanout-parser.js") : root.FanoutChecker;
  var schemeMod = (typeof module === "object" && module.exports) ? require("./fanout-scheme.js") : root.FanoutChecker;
  var clusterMod = (typeof module === "object" && module.exports) ? require("./fanout-clustering.js") : root.FanoutChecker;
  var topologyMod = (typeof module === "object" && module.exports) ? require("./fanout-topology.js") : root.FanoutChecker;
  var api = factory(parser, schemeMod, clusterMod, topologyMod);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (parser, schemeMod, clusterMod, topologyMod) {
  "use strict";
  var MM_PER_MIL = parser.MM_PER_MIL;
  var MIL_PER_MM = parser.MIL_PER_MM;
  var dist2D = parser.dist2D;
  var roundN = parser.roundN;
  var candidateRotations = parser.candidateRotations;
  var parseViaData = parser.parseViaData, parseTraceData = parser.parseTraceData,
    isSignalVia = parser.isSignalVia;
  var selectConnectedSignalVias = topologyMod.selectConnectedSignalVias || topologyMod.selectTraceConnectedSignalVias,
    collapseSignalStacks = topologyMod.collapseSignalStacks, signalStackAudit = topologyMod.signalStackAudit,
    selectGndWithinSchemeFootprint = topologyMod.selectGndWithinSchemeFootprint,
    matchCompanionGnd = topologyMod.matchCompanionGnd, resolveSignalNetAlias = topologyMod.resolveSignalNetAlias;
  var parseFanoutInputData = parser.parseFanoutInputData, summarizeTraceData = parser.summarizeTraceData,
    associateTracesWithClusters = parser.associateTracesWithClusters;
  function buildGndSpatialIndex(gndVias, cellSize = 35) {
    const grid = new Map();
    for (let i = 0; i < gndVias.length; i++) {
      const v = gndVias[i];
      const gx = Math.floor(v.x / cellSize);
      const gy = Math.floor(v.y / cellSize);
      const key = (gx << 16) ^ gy;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(v);
    }
    function findGndNear(x, y, maxDist) {
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      const radCells = Math.ceil(maxDist / cellSize);
      const results = [];
      for (let dx = -radCells; dx <= radCells; dx++) {
        for (let dy = -radCells; dy <= radCells; dy++) {
          const key = ((gx + dx) << 16) ^ (gy + dy);
          const list = grid.get(key);
          if (!list) continue;
          for (const v of list) {
            const d = Math.hypot(v.x - x, v.y - y);
            if (d <= maxDist) {
              results.push({ via: v, dist: d });
            }
          }
        }
      }
      return results;
    }
    return { findGndNear };
  }
  function groupSignalUnits(activeSignalVias, maxDiffDistMil = 35.0) {
    const diffGroups = new Map();
    const singleVias = [];
    for (let i = 0; i < activeSignalVias.length; i++) {
      const v = activeSignalVias[i];
      const isDiff = /_[PN]$/i.test(v.net);
      if (isDiff) {
        const baseNet = v.net.replace(/_[PN]$/i, '');
        let list = diffGroups.get(baseNet);
        if (!list) {
          list = [];
          diffGroups.set(baseNet, list);
        }
        list.push(v);
      } else {
        singleVias.push(v);
      }
    }
    const units = [];
    for (const [baseNet, vlist] of diffGroups.entries()) {
      const n = vlist.length;
      const parent = new Int32Array(n);
      for (let i = 0; i < n; i++) parent[i] = i;
      function find(i) {
        let root = i;
        while (root !== parent[root]) root = parent[root];
        let curr = i;
        while (curr !== root) {
          let nxt = parent[curr];
          parent[curr] = root;
          curr = nxt;
        }
        return root;
      }
      function union(i, j) {
        const rootI = find(i);
        const rootJ = find(j);
        if (rootI !== rootJ) parent[rootI] = rootJ;
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(vlist[i].x - vlist[j].x, vlist[i].y - vlist[j].y);
          if (d <= maxDiffDistMil) union(i, j);
        }
      }
      const compMap = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        let list = compMap.get(root);
        if (!list) {
          list = [];
          compMap.set(root, list);
        }
        list.push(vlist[i]);
      }
      for (const compVias of compMap.values()) {
        const pVias = compVias.filter(v => /_P$/i.test(v.net));
        const nVias = compVias.filter(v => /_N$/i.test(v.net));
        const sumX = compVias.reduce((s, v) => s + v.x, 0);
        const sumY = compVias.reduce((s, v) => s + v.y, 0);
        const count = compVias.length;
        units.push({
          id: `sig_unit_${units.length + 1}`,
          type: 'DIFF_PAIR',
          baseNet,
          net: `${baseNet}_P/${baseNet}_N`,
          signalVias: compVias,
          pCount: pVias.length,
          nCount: nVias.length,
          centroid: { x: sumX / count, y: sumY / count }
        });
      }
    }
    for (let i = 0; i < singleVias.length; i++) {
      const v = singleVias[i];
      units.push({
        id: `sig_unit_${units.length + 1}`,
        type: 'SINGLE_SIGNAL',
        baseNet: v.net,
        net: v.net,
        signalVias: [v],
        pCount: 0,
        nCount: 0,
        centroid: { x: v.x, y: v.y }
      });
    }
    return units;
  }
  function runFanoutInspection(inputData, library, options = {}) {
    const startTime = Date.now();
    const allowArbitraryRotation = options.allowArbitraryRotation === true; // 任意角度姿态（默认关闭）
    let vias = [];
    let traces = [];
    if (typeof inputData === 'string') {
      vias = parseViaData(inputData);
      traces = parseTraceData(inputData);
    } else if (Array.isArray(inputData)) {
      vias = inputData;
      traces = Array.isArray(options.traces) ? options.traces : [];
    } else if (inputData && typeof inputData === 'object') {
      vias = Array.isArray(inputData.vias) ? inputData.vias : [];
      traces = Array.isArray(inputData.traces) ? inputData.traces : [];
    }
    const traceSummary = summarizeTraceData(traces);
    if (vias.length === 0 && traces.length === 0) {
      return {
        success: false,
        error: '未解析到任何过孔或走线数据，请检查输入格式。',
        vias: [],
        traces: [],
        clusters: [],
        summary: null
      };
    }
    if (vias.length === 0 && traces.length > 0) {
      const elapsedMs = Date.now() - startTime;
      return {
        success: true,
        pureTraceMode: true,
        vias: [],
        traces,
        traceSummary,
        clusters: [],
        summary: {
          totalVias: 0,
          totalSignalVias: 0,
          totalEligibleSignalViaItems: 0,
          totalCompanionSignalVias: 0,
          totalParsedSignalVias: 0,
          excludedSignalVias: 0,
          totalTraces: traceSummary.totalTraces,
          totalTraceSegments: traceSummary.totalTraceSegments,
          traceLineCount: traceSummary.traceLineCount,
          traceArcCount: traceSummary.traceArcCount,
          totalTraceLength: traceSummary.totalTraceLength,
          traceLayers: traceSummary.layers.map(l => l.layer),
          traceNets: traceSummary.nets.map(n => n.net),
          totalClusters: 0,
          passCount: 0,
          exactPassCount: 0,
          failCount: 0,
          passRate: 0,
          padstackFailCount: 0,
          distFailCount: 0,
          noMatchCount: 0,
          schemeCoverage: {},
          elapsedMs,
          clusterThreshold: 80.0,
          clusterThresholdMm: 80.0 * MM_PER_MIL
        }
      };
    }
    const distTol = options.distanceTolerance != null ? options.distanceTolerance : 2.0;
    const allowRotation = options.allowRotation !== false;
    const allowMirror = options.allowMirror !== false;
    const gndVias = vias.filter(v => v.net && v.net.toUpperCase().includes('GND'));
    const allSignalVias = vias.filter(v => !v.net || !v.net.toUpperCase().includes('GND'));
    // Trace Connections 孔触发检查；合规多段孔直接参与，Shape-only 顶层 Pin 仅作为方案信号伴随对象补入。
    allSignalVias.forEach(via => { via.isFanoutCompanion = false; via.isFanoutNetRecovered = false; });
    const activePhysicalSignalVias = selectConnectedSignalVias(allSignalVias);
    const activeSignalVias = collapseSignalStacks(activePhysicalSignalVias);
    const activeSignalIds = new Set(activePhysicalSignalVias.map(via => String(via.id)));
    const availableCompanionSignals = allSignalVias.filter(via => !activeSignalIds.has(String(via.id)) &&
      via.hasShapeConnections && via.hasTopShapeConnection && /^SMD\s+Pin$/i.test(String(via.usage || '').trim()) &&
      !via.hasTraceConnections && !(via.connectedViaIds || []).length && Number(via.drill || 0) === 0);
    const gndIndex = buildGndSpatialIndex(gndVias, 35);
    const companionIndex = buildGndSpatialIndex(availableCompanionSignals, 35);
    const signalUnits = groupSignalUnits(activeSignalVias, 35.0);
    let passCount = 0;
    let exactPassCount = 0;
    let padstackFailCount = 0;
    let topologyFailCount = 0;
    let noMatchCount = 0;
    const schemeCoverage = {};
    const clusterUnits = [];
    const usedCompanionSignalIds = new Set();
    for (let uIdx = 0; uIdx < signalUnits.length; uIdx++) {
      const unit = signalUnits[uIdx];
      const unitSigVias = unit.signalVias;
      const physicalSignalVias = unitSigVias.flatMap(via => via.physicalVias || [via]);
      if (physicalSignalVias.every(via => usedCompanionSignalIds.has(String(via.id)))) continue;
      const stackAudit = signalStackAudit(unitSigVias);
      const unitNets = new Set(unitSigVias.map(via => String(via.net || '').toUpperCase()));
      // Shape-only 零钻顶层 Pin 不独立触发检查，也不因同网络直接激活；仅作为局部候选，
      // 在 Padstack 与变换后的方案信号位置唯一对应时补入。异网候选仍只允许恢复一个对象。
      const nearbyCompanionSignals = companionIndex.findGndNear(unit.centroid.x, unit.centroid.y, 80.0)
        .map(item => item.via).filter(via => !usedCompanionSignalIds.has(String(via.id)));
      const companionSignalCandidates = nearbyCompanionSignals.filter(via => unitNets.has(String(via.net || '').toUpperCase()));
      const netAliasCandidates = nearbyCompanionSignals.filter(via => !unitNets.has(String(via.net || '').toUpperCase()));
      const netAliasCandidateIds = new Set(netAliasCandidates.map(via => String(via.id)));
      let matchingSignalVias = physicalSignalVias.slice();
      const nearbyGnd = gndIndex.findGndNear(unit.centroid.x, unit.centroid.y, 80.0).map(item => item.via);
      let candidateVias = [...matchingSignalVias, ...nearbyGnd];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let spanX = 0, spanY = 0, maxSpan = 0;
      function updateCandidateBounds() {
        minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
        candidateVias.forEach(v => {
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.y > maxY) maxY = v.y;
        });
        spanX = maxX - minX;
        spanY = maxY - minY;
        maxSpan = Math.hypot(spanX, spanY);
      }
      updateCandidateBounds();
      const candidateEvaluations = [];
      for (const scheme of library.schemes) {
        if (!scheme.vias || scheme.vias.length === 0) continue;
        const schemeSigVias = scheme.vias.filter(v => v.net && !v.net.toUpperCase().includes('GND'));
        const schemeGndVias = scheme.vias.filter(v => !v.net || v.net.toUpperCase().includes('GND') || (v.padstack && v.padstack.toUpperCase().includes('GND')));
        const missingSignalCount = schemeSigVias.length - matchingSignalVias.length;
        const allowNetAliasRecovery = missingSignalCount > 0 &&
          unit.type === 'DIFF_PAIR' && unit.pCount > 0 && unit.nCount > 0;
        const supplementalCandidates = companionSignalCandidates.concat(allowNetAliasRecovery ? netAliasCandidates : []);
        if (missingSignalCount < 0 || (missingSignalCount > 0 && supplementalCandidates.length < missingSignalCount)) continue;
        const anchorIndex = schemeSigVias.findIndex(sv => matchingSignalVias.some(via =>
          String(via.padstack || '').trim().toLowerCase() === String(sv.padstack || '').trim().toLowerCase()));
        if (anchorIndex < 0) continue;
        const orderedSchemeSigVias = [schemeSigVias[anchorIndex], ...schemeSigVias.filter((_, index) => index !== anchorIndex)];
        const angles = candidateRotations(matchingSignalVias, orderedSchemeSigVias, distTol, allowRotation, allowArbitraryRotation);
        const mirrors = allowMirror ? [false, true] : [false];
        const s0 = orderedSchemeSigVias[0];
        for (const mirror of mirrors) {
          for (const deg of angles) {
            const rad = (deg * Math.PI) / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);
            const relSig = orderedSchemeSigVias.map(sv => {
              let dx = sv.x - s0.x;
              let dy = sv.y - s0.y;
              if (mirror) dx = -dx;
              const rx = dx * cosA - dy * sinA;
              const ry = dx * sinA + dy * cosA;
              return { sv, relX: rx, relY: ry };
            });
            for (const u0 of matchingSignalVias) {
              if ((u0.padstack || '').trim().toLowerCase() !== (s0.padstack || '').trim().toLowerCase()) {
                continue;
              }
              // 同网络 Shape-only Pin 按方案位置补入；跨 Net 恢复最多允许一个，位置不唯一时保持不匹配。
              const signalResolution = resolveSignalNetAlias(matchingSignalVias, supplementalCandidates, relSig, u0,
                distTol, missingSignalCount > 0, missingSignalCount);
              if (signalResolution) {
                signalResolution.signalNetRecoveries = (signalResolution.signalNetRecoveries || [])
                  .filter(item => netAliasCandidateIds.has(String(item.viaId)));
                if (signalResolution.signalNetRecoveries.length > 1) continue;
                const footprintGndIndices = selectGndWithinSchemeFootprint(
                  scheme.vias, nearbyGnd, u0, s0, cosA, sinA, mirror, distTol);
                const gndMatch = matchCompanionGnd(
                  schemeGndVias, nearbyGnd, footprintGndIndices, s0, u0, cosA, sinA, mirror, distTol);
                const { usedGndIndices, padMismatchList, missingVias, matchedGndCount, audit } = gndMatch;
                const unmatchedGndVias = footprintGndIndices.filter(index => !usedGndIndices.has(index)).map(index => nearbyGnd[index]);
                const gndQuantityDelta = footprintGndIndices.length - schemeGndVias.length;
                const redundantGndCount = Math.max(0, gndQuantityDelta);
                const redundantGndVias = redundantGndCount > 0 ? unmatchedGndVias.slice(0, redundantGndCount) : [];
                const isPass = (padMismatchList.length === 0 && missingVias.length === 0 && gndQuantityDelta === 0);
                candidateEvaluations.push({
                  scheme,
                  schemeName: scheme.name,
                  schemeId: scheme.id,
                  angle: deg,
                  mirror,
                  pass: isPass,
                  matchedGndCount,
                  schemeGndCount: schemeGndVias.length,
                  redundantGndCount,
                  redundantGndVias,
                  unmatchedGndVias,
                  gndQuantityDelta,
                  padMismatchList,
                  missingVias,
                  audit,
                  resolvedSignalVias: signalResolution.resolvedSignalVias,
                  recoveredSignalVias: signalResolution.recoveredSignalVias,
                  signalNetRecoveries: signalResolution.signalNetRecoveries
                });
                if (isPass) break; // 当前方案该姿态完全匹配通过
              }
            }
          }
        }
      }
      if (candidateEvaluations.length === 0) {
        noMatchCount++;
        const matchRes = {
          status: 'NO_MATCH_TOPOLOGY',
          statusText: '不匹配孔群 (未匹配方案)',
          pass: false,
          isSubsetMatch: false,
          schemeName: '未匹配方案',
          schemeId: null,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: 0,
          isMirrored: false,
          message: `该孔群中信号孔 Padstack 或相对中心距未能与方案库中任何方案匹配`,
          advice: '信号孔未匹配方案库模板，无需进行伴随地孔分析。',
          padMismatchList: [],
          missingVias: [],
          viaAudit: [],
          signalStackAudit: stackAudit
        };
        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          physicalSignalVias,
          matchingSignalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
        continue;
      }
      const passingEvaluations = candidateEvaluations.filter(e => e.pass).sort((a, b) =>
        (b.resolvedSignalVias || []).length - (a.resolvedSignalVias || []).length);
      let bestEval = passingEvaluations[0];
      if (!bestEval) {
        candidateEvaluations.sort((a, b) => {
          if ((b.resolvedSignalVias || []).length !== (a.resolvedSignalVias || []).length) {
            return (b.resolvedSignalVias || []).length - (a.resolvedSignalVias || []).length;
          }
          if (b.matchedGndCount !== a.matchedGndCount) return b.matchedGndCount - a.matchedGndCount;
          const defectsA = a.padMismatchList.length + a.missingVias.length + a.redundantGndCount;
          const defectsB = b.padMismatchList.length + b.missingVias.length + b.redundantGndCount;
          return defectsA - defectsB;
        });
        bestEval = candidateEvaluations[0];
      }
      matchingSignalVias = bestEval.resolvedSignalVias || matchingSignalVias;
      (bestEval.recoveredSignalVias || []).forEach(via => {
        const recovery = (bestEval.signalNetRecoveries || []).find(item => String(item.viaId) === String(via.id));
        via.isFanoutCompanion = true;
        via.isFanoutEligible = true;
        via.isFanoutNetRecovered = Boolean(recovery);
        if (recovery) { via.fanoutSourceNet = via.net; via.fanoutExpectedNet = recovery.expectedNet; }
        usedCompanionSignalIds.add(String(via.id));
      });
      candidateVias = [...physicalSignalVias, ...matchingSignalVias.slice(physicalSignalVias.length), ...nearbyGnd];
      updateCandidateBounds();
      const s = bestEval.scheme;
      const isPass = bestEval.pass;
      if (isPass) {
        passCount++;
        exactPassCount++;
        schemeCoverage[s.name] = (schemeCoverage[s.name] || 0) + 1;
        const rotStr = bestEval.angle !== 0 ? ` [旋转 ${bestEval.angle}°]` : '';
        const mirStr = bestEval.mirror ? ` [镜像翻转]` : '';
        const recoveryCount = (bestEval.signalNetRecoveries || []).length;
        const companionCount = (bestEval.recoveredSignalVias || []).length - recoveryCount;
        const recoveryStr = `${companionCount > 0 ? `；${companionCount} 个同网络 Shape-only 顶层 Pin 作为伴随信号对象` : ''}${recoveryCount > 0 ? `；${recoveryCount} 个顶层信号 Pin 按完整方案几何恢复归属` : ''}`;
        const matchRes = {
          status: 'MATCH_PASS',
          statusText: '完全匹配通过',
          pass: true,
          isSubsetMatch: false,
          schemeName: s.name,
          schemeId: s.id,
          matchedViaCount: matchingSignalVias.length + bestEval.matchedGndCount,
          redundantViaCount: 0,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: bestEval.angle,
          isMirrored: bestEval.mirror,
          message: `✅ 对照方案【${s.name}】完整拓扑匹配通过${rotStr}${mirStr} (信号网络: ${unit.net}，伴随 GND 数量、Padstack 与位置逐一符合${recoveryStr})`,
          advice: recoveryCount > 0 ? '物理孔群符合方案，无需调整；请核对原始导出中被恢复顶层 Pin 的 Net 字段。' : '信号孔与伴随地孔完全符合方案规范，无需调整。',
          padMismatchList: [],
          missingVias: [],
          viaAudit: bestEval.audit,
          signalNetRecoveries: bestEval.signalNetRecoveries || [],
          signalStackAudit: stackAudit
        };
        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          physicalSignalVias,
          matchingSignalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
      } else {
        let adviceText = '';
        let reasonText = '';
        let status = 'DISTANCE_MISMATCH';
        let statusText = '伴随地孔存在异常';
        const padMismatchList = bestEval.padMismatchList;
        const missingVias = bestEval.missingVias;
        if (bestEval.redundantGndCount > 0) {
          topologyFailCount++;
          status = 'GND_QUANTITY_MISMATCH';
          statusText = '伴随地孔数量不符';
          const redundantIds = (bestEval.redundantGndVias || []).map(via => `#${via.id}`).join('、');
          reasonText = `信号孔已锁定方案【${s.name}】，但周围伴随地孔比方案多 ${bestEval.redundantGndCount} 个`;
          adviceText = `完整拓扑不允许子集或冗余孔匹配；请核对多余地孔 ${redundantIds || '的位置与归属'}。`;
        } else if (padMismatchList.length > 0 && missingVias.length === 0) {
          padstackFailCount++;
          status = 'PADSTACK_MISMATCH';
          statusText = '地孔Padstack不符';
          const padAdv = padMismatchList.map(p => `将地孔 #${p.viaId} Padstack 由「${p.actualPadstack}」调整为「${p.expectedPadstack}」`).join('；');
          reasonText = `信号孔已锁定方案【${s.name}】，但存在 ${padMismatchList.length} 处伴随地孔 Padstack 不符`;
          adviceText = `【地孔Padstack调整建议】: ${padAdv}。`;
        } else if (missingVias.length > 0) {
          topologyFailCount++;
          status = 'DISTANCE_MISMATCH';
          statusText = '伴随地孔缺失/位置偏差';
          const missAdv = missingVias.slice(0, 3).map(m => `在坐标 [${m.expectedX.toFixed(1)}, ${m.expectedY.toFixed(1)}] 补齐 1 个伴随地孔 (${m.expectedPadstack})`).join('；');
          const padAdv = padMismatchList.length > 0 ? `；同时修正地孔 #${padMismatchList[0].viaId} Padstack 为「${padMismatchList[0].expectedPadstack}」` : '';
          reasonText = `信号孔已锁定方案【${s.name}】，但缺少 ${missingVias.length} 个伴随地孔`;
          adviceText = `【补地孔建议】: ${missAdv}${padAdv}。`;
        }
        const matchRes = {
          status,
          statusText,
          pass: false,
          isSubsetMatch: false,
          schemeName: s.name,
          schemeId: s.id,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: bestEval.angle,
          isMirrored: bestEval.mirror,
          message: reasonText,
          advice: adviceText,
          padMismatchList,
          missingVias,
          redundantViaCount: bestEval.redundantGndCount,
          redundantViaIds: (bestEval.redundantGndVias || []).map(via => via.id),
          viaAudit: bestEval.audit,
          signalNetRecoveries: bestEval.signalNetRecoveries || [],
          signalStackAudit: stackAudit
        };
        clusterUnits.push({
          id: `sig_unit_${uIdx + 1}`,
          vias: candidateVias,
          viaCount: candidateVias.length,
          signalVias: unit.signalVias,
          physicalSignalVias,
          matchingSignalVias,
          signalNet: unit.net,
          centroid: unit.centroid,
          bbox: { minX, maxX, minY, maxY, spanX, spanY, maxSpan },
          matchResult: matchRes
        });
      }
    }
    associateTracesWithClusters(vias, clusterUnits, traces, 18.0);
    const elapsedMs = Date.now() - startTime;
    const failCount = padstackFailCount + topologyFailCount + noMatchCount;
    const passRate = clusterUnits.length > 0 ? (passCount / clusterUnits.length) * 100 : 0;
    const summary = {
      totalVias: vias.length,
      totalSignalVias: activeSignalVias.length,
      totalEligibleSignalViaItems: activePhysicalSignalVias.length + usedCompanionSignalIds.size,
      totalCompanionSignalVias: usedCompanionSignalIds.size,
      totalParsedSignalVias: allSignalVias.length,
      excludedSignalVias: allSignalVias.length - activePhysicalSignalVias.length - usedCompanionSignalIds.size,
      totalTraces: traceSummary.totalTraces,
      totalTraceSegments: traceSummary.totalTraceSegments,
      traceLineCount: traceSummary.traceLineCount,
      traceArcCount: traceSummary.traceArcCount,
      totalTraceLength: traceSummary.totalTraceLength,
      traceLayers: traceSummary.layers.map(l => l.layer),
      traceNets: traceSummary.nets.map(n => n.net),
      totalClusters: clusterUnits.length,
      passCount,
      exactPassCount,
      failCount,
      passRate: roundN(passRate, 1),
      padstackFailCount,
      distFailCount: topologyFailCount,
      noMatchCount,
      schemeCoverage,
      elapsedMs,
      clusterThreshold: 80.0,
      clusterThresholdMm: 80.0 * MM_PER_MIL
    };
    return {
      success: true,
      vias,
      traces,
      traceSummary,
      clusters: clusterUnits,
      summary
    };
  }
  return {
    buildGndSpatialIndex: buildGndSpatialIndex,
    groupSignalUnits: groupSignalUnits,
    runFanoutInspection: runFanoutInspection
  };
});
