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
  var selectTraceConnectedSignalVias = topologyMod.selectTraceConnectedSignalVias,
    collapseSignalStacks = topologyMod.collapseSignalStacks, signalStackAudit = topologyMod.signalStackAudit,
    resolveSignalNetAlias = topologyMod.resolveSignalNetAlias;
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
          subsetPassCount: 0,
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
    // Trace 连接孔段是检查锚点；同网络 Via Connections 可带入完整堆叠，但不能让无 Trace 孔群自行建组。
    allSignalVias.forEach(via => { via.isFanoutCompanion = false; });
    const activePhysicalSignalVias = selectTraceConnectedSignalVias(allSignalVias);
    const activeSignalVias = collapseSignalStacks(activePhysicalSignalVias);
    const activeSignalIds = new Set(activePhysicalSignalVias.map(via => String(via.id)));
    const availableCompanionSignals = allSignalVias.filter(via => via.hasConnections && !via.hasTraceConnections &&
      !(via.connectedViaIds || []).length && !activeSignalIds.has(String(via.id)));
    const gndIndex = buildGndSpatialIndex(gndVias, 35);
    const companionIndex = buildGndSpatialIndex(availableCompanionSignals, 35);
    const signalUnits = groupSignalUnits(activeSignalVias, 35.0);
    let passCount = 0;
    let exactPassCount = 0;
    let subsetPassCount = 0;
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
      const stackAudit = signalStackAudit(unitSigVias);
      const unitNets = new Set(unitSigVias.map(via => String(via.net || '').toUpperCase()));
      const nearbyCompanionCandidates = companionIndex.findGndNear(unit.centroid.x, unit.centroid.y, 80.0)
        .map(item => item.via);
      const companionSignals = nearbyCompanionCandidates
        .filter(via => unitNets.has(String(via.net || '').toUpperCase()));
      // 原始 EDA 导出偶尔会把一个 Shape-only 顶层 Pin 写到其他差分网络。它不能按“附近信号孔”
      // 直接吸收；只有完整方案恰好少 1 个零钻孔对象，且 Padstack/位置唯一吻合时才允许恢复归属。
      const netAliasCandidates = nearbyCompanionCandidates.filter(via =>
        !unitNets.has(String(via.net || '').toUpperCase()) &&
        !usedCompanionSignalIds.has(String(via.id)) && Number(via.drill || 0) === 0);
      companionSignals.forEach(via => { via.isFanoutCompanion = true; usedCompanionSignalIds.add(String(via.id)); });
      let matchingSignalVias = [...unitSigVias, ...companionSignals];
      const nearbyGnd = gndIndex.findGndNear(unit.centroid.x, unit.centroid.y, 80.0).map(item => item.via);
      let candidateVias = [...physicalSignalVias, ...companionSignals, ...nearbyGnd];
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
        const allowNetAliasRecovery = missingSignalCount === 1 && netAliasCandidates.length > 0 &&
          unit.type === 'DIFF_PAIR' && unit.pCount > 0 && unit.nCount > 0;
        if (missingSignalCount !== 0 && !allowNetAliasRecovery) continue;
        const angles = candidateRotations(matchingSignalVias, schemeSigVias, distTol, allowRotation, allowArbitraryRotation);
        const mirrors = allowMirror ? [false, true] : [false];
        const s0 = schemeSigVias[0];
        for (const mirror of mirrors) {
          for (const deg of angles) {
            const rad = (deg * Math.PI) / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);
            const relSig = schemeSigVias.map(sv => {
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
              // 跨 Net 恢复仅限方案中那个唯一缺失的零钻孔 Pin；若目标位置不唯一则保持不匹配。
              const signalResolution = resolveSignalNetAlias(matchingSignalVias, netAliasCandidates, relSig, u0,
                distTol, allowNetAliasRecovery, missingSignalCount);
              if (signalResolution) {
                const usedGndIndices = new Set();
                const padMismatchList = [];
                const missingVias = [];
                let matchedGndCount = 0;
                const audit = [];
                for (let j = 0; j < schemeGndVias.length; j++) {
                  const sv = schemeGndVias[j];
                  let dx = sv.x - s0.x;
                  let dy = sv.y - s0.y;
                  if (mirror) dx = -dx;
                  const rx = dx * cosA - dy * sinA;
                  const ry = dx * sinA + dy * cosA;
                  const expX = u0.x + rx;
                  const expY = u0.y + ry;
                  let bestGndIdx = -1;
                  let minDist = distTol;
                  for (let k = 0; k < nearbyGnd.length; k++) {
                    if (usedGndIndices.has(k)) continue;
                    const gv = nearbyGnd[k];
                    const d = Math.hypot(gv.x - expX, gv.y - expY);
                    if (d <= minDist) {
                      if ((gv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase()) {
                        minDist = d;
                        bestGndIdx = k;
                        break;
                      } else if (bestGndIdx === -1 || d < minDist) {
                        minDist = d;
                        bestGndIdx = k;
                      }
                    }
                  }
                  if (bestGndIdx !== -1) {
                    usedGndIndices.add(bestGndIdx);
                    const gv = nearbyGnd[bestGndIdx];
                    matchedGndCount++;
                    const isPadMatch = (gv.padstack || '').trim().toLowerCase() === (sv.padstack || '').trim().toLowerCase();
                    if (!isPadMatch) {
                      padMismatchList.push({
                        viaId: gv.id,
                        net: gv.net,
                        actualPadstack: gv.padstack,
                        expectedPadstack: sv.padstack,
                        role: sv.role || (`伴随地孔${sv.id}`)
                      });
                    }
                    audit.push({
                      viaIndex: j + 1,
                      viaId: gv.id,
                      net: gv.net,
                      x: gv.x,
                      y: gv.y,
                      actualPadstack: gv.padstack,
                      expectedPadstack: sv.padstack,
                      role: sv.role || (`伴随地孔${sv.id}`),
                      isMatch: isPadMatch,
                      deviation: minDist
                    });
                  } else {
                    missingVias.push({
                      expectedX: expX,
                      expectedY: expY,
                      expectedPadstack: sv.padstack,
                      role: sv.role || (`伴随地孔${sv.id}`),
                      net: sv.net || 'GND'
                    });
                  }
                }
                const isPass = (padMismatchList.length === 0 && missingVias.length === 0);
                const redundantGndCount = nearbyGnd.length - matchedGndCount;
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
      let bestEval = candidateEvaluations.find(e => e.pass);
      if (!bestEval) {
        candidateEvaluations.sort((a, b) => {
          if (b.matchedGndCount !== a.matchedGndCount) return b.matchedGndCount - a.matchedGndCount;
          const defectsA = a.padMismatchList.length + a.missingVias.length;
          const defectsB = b.padMismatchList.length + b.missingVias.length;
          return defectsA - defectsB;
        });
        bestEval = candidateEvaluations[0];
      }
      matchingSignalVias = bestEval.resolvedSignalVias || matchingSignalVias;
      (bestEval.recoveredSignalVias || []).forEach(via => {
        const recovery = (bestEval.signalNetRecoveries || []).find(item => String(item.viaId) === String(via.id));
        via.isFanoutCompanion = true;
        via.isFanoutNetRecovered = true;
        via.fanoutSourceNet = via.net;
        via.fanoutExpectedNet = recovery ? recovery.expectedNet : '';
        usedCompanionSignalIds.add(String(via.id));
      });
      candidateVias = [...physicalSignalVias, ...matchingSignalVias.slice(unitSigVias.length), ...nearbyGnd];
      updateCandidateBounds();
      const s = bestEval.scheme;
      const isPass = bestEval.pass;
      if (isPass) {
        passCount++;
        if (bestEval.redundantGndCount > 0) subsetPassCount++;
        else exactPassCount++;
        schemeCoverage[s.name] = (schemeCoverage[s.name] || 0) + 1;
        const redundantStr = bestEval.redundantGndCount > 0 ? ` (含 ${bestEval.redundantGndCount} 个冗余地孔)` : '';
        const rotStr = bestEval.angle !== 0 ? ` [旋转 ${bestEval.angle}°]` : '';
        const mirStr = bestEval.mirror ? ` [镜像翻转]` : '';
        const recoveryCount = (bestEval.signalNetRecoveries || []).length;
        const recoveryStr = recoveryCount > 0 ? `；${recoveryCount} 个顶层信号 Pin 按完整方案几何恢复归属` : '';
        const matchRes = {
          status: 'MATCH_PASS',
          statusText: bestEval.redundantGndCount > 0 ? `匹配通过 (含${bestEval.redundantGndCount}冗余孔)` : '完全匹配通过',
          pass: true,
          isSubsetMatch: bestEval.redundantGndCount > 0,
          schemeName: s.name,
          schemeId: s.id,
          matchedViaCount: matchingSignalVias.length + bestEval.matchedGndCount,
          redundantViaCount: bestEval.redundantGndCount,
          maxDeviation: 0,
          maxDeviationMm: 0,
          rotationAngle: bestEval.angle,
          isMirrored: bestEval.mirror,
          message: `✅ 对照方案【${s.name}】匹配通过${rotStr}${mirStr} (信号网络: ${unit.net}${redundantStr}，Padstack 与地孔完全符合${recoveryStr})`,
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
        if (padMismatchList.length > 0 && missingVias.length === 0) {
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
    const passRate = signalUnits.length > 0 ? (passCount / signalUnits.length) * 100 : 0;
    const summary = {
      totalVias: vias.length,
      totalSignalVias: activeSignalVias.length,
      totalEligibleSignalViaItems: activePhysicalSignalVias.length,
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
      totalClusters: signalUnits.length,
      passCount,
      exactPassCount,
      subsetPassCount,
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
