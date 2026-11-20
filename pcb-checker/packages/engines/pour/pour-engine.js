/* ============================================================================
 * pour-engine.js —— 铜皮五大项检查引擎与按目标对象聚合器
 * ========================================================================== */
(function (root, factory) {
var geom = (typeof module === "object" && module.exports) ? require("./pour-geom.js") : root.PourChecker;
  var parser = (typeof module === "object" && module.exports) ? require("./pour-parser.js") : root.PourChecker;
  var traceMargin = (typeof module === "object" && module.exports) ? require("./pour-trace-margin.js") : root.PourChecker;
  var api = factory(geom, parser, traceMargin);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PourChecker = Object.assign(root.PourChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (geom, parser, traceMargin) {
  "use strict";
  var MM_PER_MIL = geom.MM_PER_MIL, MIL_PER_MM = geom.MIL_PER_MM;
  var dist2D = geom.dist2D, roundN = geom.roundN;
  var pointToShapeDistance = geom.pointToShapeDistance;
  var shapeRing = geom.shapeRing, pointInShape = geom.pointInShape;
  var checkTraceReferenceMargin = traceMargin.checkTraceReferenceMargin;
  var buildPointGrid = geom.buildPointGrid, queryPointGrid = geom.queryPointGrid;
  var buildBBoxGrid = geom.buildBBoxGrid, queryBBoxGrid = geom.queryBBoxGrid, physicalLayerAlias = geom.physicalLayerAlias;
  var expandLayerRange = parser.expandLayerRange, parsePcbElements = parser.parsePcbElements;
  var parseShapeBlock = parser.parseShapeBlock, findAssociatedShapeItems = parser.findAssociatedShapeItems, buildShapePointIndexes = parser.buildShapePointIndexes;
  var SPECIAL_SHAPE_CENTER_DISTANCE_TOLERANCE = 0.01;
  function checkViaLayerCoverage(vias, shapes, rules = [], availableLayers = []) {
    const results = [];
    const shapesByLayer = new Map();
    shapes.forEach(s => {
      const actualLayer = String(s.layer || '').trim().toUpperCase();
      const lookupKeys = new Set([actualLayer, physicalLayerAlias(actualLayer)]);
      lookupKeys.forEach(l => {
        if (!l) return;
        if (!shapesByLayer.has(l)) shapesByLayer.set(l, []);
        shapesByLayer.get(l).push(s);
      });
    });
    const shapeIndexes = new Map();
    shapesByLayer.forEach((layerShapes, layer) => shapeIndexes.set(layer, buildBBoxGrid(layerShapes, 100)));
    for (let rIdx = 0; rIdx < rules.length; rIdx++) {
      const rule = rules[rIdx];
      const padPattern = (rule.padstack || '').trim().toLowerCase();
      const radiusThresh = rule.coverageRadius != null ? parseFloat(rule.coverageRadius) : 50.0;
      const targetLayers = expandLayerRange(rule.layers, availableLayers);
      const matchedVias = vias.filter(v => {
        if (!padPattern || padPattern === '*') return true;
        return v.padstack.toLowerCase().includes(padPattern);
      });
      for (const via of matchedVias) {
        for (const layer of targetLayers) {
          const lKey = layer.trim().toUpperCase();
          const shapeIndex = shapeIndexes.get(lKey) || shapeIndexes.get(physicalLayerAlias(lKey));
          const nearbyRadius = Math.max(radiusThresh * 2, radiusThresh + 10);
          const layerShapes = queryBBoxGrid(shapeIndex, via.x - nearbyRadius, via.y - nearbyRadius, via.x + nearbyRadius, via.y + nearbyRadius);
          let minCopperDist = Infinity;
          let nearestShape = null;
          for (const shape of layerShapes) {
            const d = pointToShapeDistance(via.x, via.y, shape);
            if (d < minCopperDist) {
              minCopperDist = d;
              nearestShape = shape;
            }
          }
          const hasCopper = minCopperDist <= radiusThresh;
          const distStr = minCopperDist === Infinity ? '无铜皮' : `${roundN(minCopperDist, 2)} mil`;
          results.push({
            checkCategory: 'via_coverage', checkCategoryName: '① 孔经过层铺铜覆盖检查',
            ruleIndex: rIdx + 1, ruleId: rule.id || `rule_via_cov_${rIdx + 1}`,
            ruleDesc: `孔【${rule.padstack || '所有孔'}】在【${layer}】距离孔心 ≤ ${radiusThresh} mil 存在铜皮`,
            viaId: via.id, viaPadstack: via.padstack, viaNet: via.net, viaCoord: [via.x, via.y],
            layer, requiredDist: radiusThresh,
            actualDist: minCopperDist === Infinity ? 999999 : minCopperDist, actualDistStr: distStr,
            nearestShapeId: nearestShape ? nearestShape.id : null,
            nearestShapeLayer: nearestShape ? nearestShape.layer : null, pass: hasCopper,
            message: hasCopper
              ? `✅ 符合：孔 #${via.id} 在 ${layer} 层孔心 ${radiusThresh} mil 搜索范围内检测到铜皮（最近距离 ${distStr}）`
              : `❌ 不符合：孔 #${via.id} 在 ${layer} 层孔心 ${radiusThresh} mil 搜索范围内未检测到铜皮（最近距离 ${distStr}）`
          });
        }
      }
    }
    return results;
  }
  function findNearbySameNetHdi(via, hdiIndex, maxDistanceMil) {
    let nearest = null;
    let nearestDistance = Infinity;
    if (!hdiIndex || !(maxDistanceMil > 0)) return null;
    queryPointGrid(hdiIndex, via.x - maxDistanceMil, via.y - maxDistanceMil, via.x + maxDistanceMil, via.y + maxDistanceMil).forEach(candidate => {
      if (candidate === via) return;
      const distance = dist2D(via.x, via.y, candidate.x, candidate.y);
      const isNearer = distance < nearestDistance - 1e-9;
      const isStableTie = Math.abs(distance - nearestDistance) <= 1e-9 && (!nearest ||
        String(candidate.id).localeCompare(String(nearest.id), undefined, { numeric: true }) < 0);
      if (distance <= maxDistanceMil + 1e-9 && (isNearer || isStableTie)) {
        nearest = candidate; nearestDistance = distance;
      }
    });
    return nearest ? { via: nearest, distance: nearestDistance } : null;
  }
  function differentialMateNetName(net) {
    const value = String(net || '');
    const pairs = [
      [/_P$/i, '_N'], [/_N$/i, '_P'], [/_\+$/i, '_-'], [/_-$/i, '_+'],
      [/\.P$/i, '.N'], [/\.N$/i, '.P'], [/\+$/i, '-'], [/-$/i, '+'], [/P$/i, 'N'], [/N$/i, 'P']
    ];
    for (const pair of pairs) if (pair[0].test(value)) return value.replace(pair[0], pair[1]);
    return '';
  }
  function nearestHdiCandidate(via, candidates) {
    let nearest = null;
    let distance = Infinity;
    (candidates || []).forEach(candidate => {
      const candidateDistance = dist2D(via.x, via.y, candidate.x, candidate.y);
      const stableTie = Math.abs(candidateDistance - distance) <= 1e-9 && (!nearest ||
        String(candidate.id).localeCompare(String(nearest.id), undefined, { numeric: true }) < 0);
      if (candidateDistance < distance - 1e-9 || stableTie) {
        nearest = candidate; distance = candidateDistance;
      }
    });
    return nearest ? { via: nearest, distance } : null;
  }
  function findDifferentialHdiPair(hdi, hdiByNet) {
    if (!hdi) return null;
    const mateNet = differentialMateNetName(hdi.net);
    return mateNet ? nearestHdiCandidate(hdi, hdiByNet.get(mateNet.toLowerCase())) : null;
  }
  function unmatchedAssociationSummary(via, templates, nearestHdi, pairedHdi) {
    const radii = [...new Set(templates.map(template => parseFloat(template.hdiSearchRadiusMm))
      .filter(value => value > 0).map(value => roundN(value, 4)))].sort((a, b) => a - b);
    const searchLimit = templates.some(template => !(parseFloat(template.hdiSearchRadiusMm) > 0)) ? '未限制' : `${radii.join(' / ')} mm`;
    const inRangeTemplates = templates.filter(template => {
      const radius = parseFloat(template.hdiSearchRadiusMm);
      return !(radius > 0) || (nearestHdi && nearestHdi.distance <= radius * MIL_PER_MM + 1e-9);
    });
    if (!nearestHdi || !inRangeTemplates.length) {
      const nearest = nearestHdi ? `；最近同网络 HDI 孔 #${nearestHdi.via.id} 关联距离 ${roundN(nearestHdi.distance, 3)} mil` : '';
      return `孔 #${via.id} 在 HDI 搜索范围（${searchLimit}）内未找到同网络且 Padstack 名含 HDI 的孔${nearest}`;
    }
    if (!pairedHdi) {
      return `孔 #${via.id} 已关联同网络 HDI 孔 #${nearestHdi.via.id}，但未找到对应差分网络的 HDI 孔`;
    }
    const centers = [...new Set(inRangeTemplates.map(template => parseFloat(template.differentialCenterDistance))
      .filter(value => value > 0).map(value => roundN(value, 4)))].sort((a, b) => a - b);
    return `孔 #${via.id} 已在 ${roundN(nearestHdi.distance, 3)} mil 内关联同网络 HDI 孔 #${nearestHdi.via.id}，` +
      `该 HDI 与差分 HDI 孔 #${pairedHdi.via.id} 的实测中心距 ${roundN(pairedHdi.distance, 3)} mil 不满足规则 ${centers.join(' / ')} mil`;
  }
  function buildUnmatchedAssociationResults(candidates, matchedVias, hdiByNet) {
    const results = [];
    candidates.forEach((info, via) => {
      if (matchedVias.has(via)) return;
      const netKey = String(via.net || '').trim().toLowerCase();
      const nearestHdi = nearestHdiCandidate(via, hdiByNet.get(netKey));
      const pairedHdi = findDifferentialHdiPair(nearestHdi && nearestHdi.via, hdiByNet);
      const associationSummary = unmatchedAssociationSummary(via, info.templates, nearestHdi, pairedHdi);
      info.layers.forEach(layer => results.push({
        checkCategory: 'special_shape', checkCategoryName: '② 特定异型铜皮比对检查',
        templateIndex: null, templateId: 'special_shape_unmatched', templateName: '未匹配到适用异型铜皮模板',
        viaId: via.id, viaPadstack: via.padstack, viaNet: via.net, viaCoord: [via.x, via.y],
        actualHdiViaId: nearestHdi ? nearestHdi.via.id : null,
        actualHdiViaPadstack: nearestHdi ? nearestHdi.via.padstack : null,
        hdiAssociationDistance: nearestHdi ? nearestHdi.distance : null,
        pairedHdiViaId: pairedHdi ? pairedHdi.via.id : null,
        pairedHdiViaPadstack: pairedHdi ? pairedHdi.via.padstack : null,
        actualDifferentialCenterDistance: pairedHdi ? pairedHdi.distance : null,
        expectedDifferentialCenterDistance: null, hdiSearchRadiusMm: null,
        layer, targetShapeId: null, targetShapeIds: [], actualShapeItemCount: 0,
        expectedShapeItemCount: null, actualArea: null, expectedArea: null, areaTolerance: null,
        associationFailed: true, associationSummary, pass: false,
        message: `❌ 不符合：${associationSummary}`
      }));
    });
    return results;
  }
  function checkSpecialShapedCopper(vias, shapes, templates = []) {
    const results = [];
    const shapesByLayer = new Map();
    shapes.forEach(shape => {
      const layer = shape.layer.toUpperCase();
      if (!shapesByLayer.has(layer)) shapesByLayer.set(layer, []);
      shapesByLayer.get(layer).push(shape);
    });
    const shapeIndexes = buildShapePointIndexes(shapes);
    const hdiByNet = new Map();
    vias.forEach(via => {
      if (!String(via.padstack || '').toLowerCase().includes('hdi')) return;
      const net = String(via.net || '').trim().toLowerCase();
      if (!hdiByNet.has(net)) hdiByNet.set(net, []); hdiByNet.get(net).push(via);
    });
    const hdiIndexes = new Map();
    hdiByNet.forEach((netVias, net) => hdiIndexes.set(net, buildPointGrid(netVias, 20)));
    const associationCandidates = new Map();
    const matchedAssociationVias = new Set();
    templates.forEach((tmpl, tIdx) => {
      const padPattern = (tmpl.padstack || '').trim().toLowerCase();
      const targetLayers = [...new Set(expandLayerRange(tmpl.layer, [...shapesByLayer.keys()])
        .map(layer => layer.trim().toUpperCase()))];
      const centerValue = parseFloat(tmpl.differentialCenterDistance);
      const radiusValue = parseFloat(tmpl.hdiSearchRadiusMm);
      const expectedCenterDistance = centerValue > 0 ? centerValue : null;
      const hdiSearchRadiusMm = radiusValue > 0 ? radiusValue : null;
      const hdiSearchRadiusMil = hdiSearchRadiusMm == null ? null : hdiSearchRadiusMm * MIL_PER_MM;
      if (!targetLayers.length) return;
      const tmplName = tmpl.name || `异型铜皮模板_${tIdx + 1}`;
      const expectedArea = tmpl.expectedArea || (tmpl.shape ? tmpl.shape.area : 0);
      const expectedItemCount = tmpl.shapeItemCount || (tmpl.shape && tmpl.shape.itemCount) || 1;
      const tolArea = tmpl.areaTolerance != null ? parseFloat(tmpl.areaTolerance) : 30.0;
      const matchedVias = vias.filter(via => !padPattern || padPattern === '*' ||
        via.padstack.toLowerCase().includes(padPattern));
      if (padPattern && padPattern !== '*') matchedVias.forEach(via => {
        let info = associationCandidates.get(via);
        if (!info) {
          info = { templates: [], layers: new Set() };
          associationCandidates.set(via, info);
        }
        info.templates.push(tmpl);
        targetLayers.forEach(layer => info.layers.add(layer));
      });
      matchedVias.forEach(via => {
        const netKey = String(via.net || '').trim().toLowerCase();
        const needsHdi = expectedCenterDistance != null || hdiSearchRadiusMm != null;
        const nearbyHdi = !needsHdi ? null : (hdiSearchRadiusMil == null
          ? nearestHdiCandidate(via, hdiByNet.get(netKey))
          : findNearbySameNetHdi(via, hdiIndexes.get(netKey), hdiSearchRadiusMil));
        const pairedHdi = expectedCenterDistance != null && nearbyHdi
          ? findDifferentialHdiPair(nearbyHdi.via, hdiByNet) : null;
        if (needsHdi && !nearbyHdi) return;
        if (expectedCenterDistance != null && (!pairedHdi ||
          Math.abs(pairedHdi.distance - expectedCenterDistance) > SPECIAL_SHAPE_CENTER_DISTANCE_TOLERANCE)) return;
        matchedAssociationVias.add(via);
        targetLayers.forEach(targetLayer => {
          const bestShape = findAssociatedShapeItems(via, shapeIndexes.get(targetLayer), expectedItemCount);
          const bestShapeIds = bestShape ? (bestShape.itemIds || [bestShape.id]) : [];
          let targetDesc = nearbyHdi
            ? `孔 #${via.id} 在 ${roundN(nearbyHdi.distance, 3)} mil 内关联同网络 HDI 孔 #${nearbyHdi.via.id}` : `孔 #${via.id}`;
          if (pairedHdi) targetDesc += `，HDI 孔 #${nearbyHdi.via.id} 与差分 HDI 孔 #${pairedHdi.via.id} 中心距 ${roundN(pairedHdi.distance, 3)} mil`;
          let isMatch = false;
          let failReason = '';
          if (!bestShape) {
            failReason = `在 ${targetLayer} 层未找到与孔 #${via.id} 关联的铜皮`;
          } else if (!(expectedArea > 0)) {
            isMatch = true;
          } else {
            const areaDiff = Math.abs(bestShape.area - expectedArea);
            isMatch = areaDiff <= tolArea;
            if (!isMatch) {
              failReason = `铜皮 Shape #${bestShapeIds.join(' + #')} 合计面积为 ${roundN(bestShape.area, 1)} sq mil，与模板期望面积 ${roundN(expectedArea, 1)} sq mil 偏差 ${roundN(areaDiff, 1)} sq mil (超出容差 ±${tolArea})`;
            }
          }
          results.push({
            checkCategory: 'special_shape', checkCategoryName: '② 特定异型铜皮比对检查',
            templateIndex: tIdx + 1, templateId: tmpl.id || `special_shape_${tIdx + 1}`, templateName: tmplName,
            viaId: via.id, viaPadstack: via.padstack, viaNet: via.net, viaCoord: [via.x, via.y],
            actualHdiViaId: nearbyHdi ? nearbyHdi.via.id : null, actualHdiViaPadstack: nearbyHdi ? nearbyHdi.via.padstack : null,
            hdiAssociationDistance: nearbyHdi ? nearbyHdi.distance : null,
            pairedHdiViaId: pairedHdi ? pairedHdi.via.id : null,
            pairedHdiViaPadstack: pairedHdi ? pairedHdi.via.padstack : null,
            hdiSearchRadiusMm,
            actualDifferentialCenterDistance: pairedHdi ? pairedHdi.distance : null,
            expectedDifferentialCenterDistance: expectedCenterDistance,
            layer: targetLayer, targetShapeId: bestShape ? bestShape.id : null, targetShapeIds: bestShapeIds, actualShapeItemCount: bestShapeIds.length, expectedShapeItemCount: expectedItemCount,
            actualArea: bestShape ? bestShape.area : 0, expectedArea, areaTolerance: tolArea, pass: isMatch,
            message: isMatch
              ? `✅ 符合：${targetDesc}，在 ${targetLayer} 层的铜皮与异型模板【${tmplName}】匹配 (${bestShapeIds.length} 个 Shape Item 合计面积 ${bestShape ? roundN(bestShape.area, 1) : '-'} sq mil)`
              : `❌ 不符合：${targetDesc}，在 ${targetLayer} 层与异型模板【${tmplName}】不匹配 (${failReason})`
          });
        });
      });
    });
    results.push(...buildUnmatchedAssociationResults(associationCandidates, matchedAssociationVias, hdiByNet));
    return results;
  }
  function checkIsolatedSmallCopper(shapes, vias, maxAreaThreshold = 500.0) {
    const results = [];
    const viaIndex = buildPointGrid(vias, 100);
    for (const shape of shapes) {
      if (shape.area > 0 && shape.area < maxAreaThreshold) {
        const ring = shapeRing(shape);
        const hasRing = ring.length >= 3;
        const b = hasRing && shape.bbox ? shape.bbox : {
          minX: shape.centroid.x - 30, minY: shape.centroid.y - 30,
          maxX: shape.centroid.x + 30, maxY: shape.centroid.y + 30
        };
        const layerVias = queryPointGrid(viaIndex, b.minX, b.minY, b.maxX, b.maxY)
          .filter(v => !v.layer || !shape.layer || v.layer === shape.layer);
        let containsVia = false;
        let viaInsideId = null;
        for (const via of layerVias) {
          let hit;
          if (hasRing) {
            hit = pointInShape(via.x, via.y, shape);
          } else {
            hit = dist2D(via.x, via.y, shape.centroid.x, shape.centroid.y) <= 30.0;
          }
          if (hit) { containsVia = true; viaInsideId = via.id; break; }
        }
        results.push({
          checkCategory: 'isolated_copper',
          checkCategoryName: '④ 孤立小铜皮检查',
          shapeId: shape.id,
          layer: shape.layer,
          set: shape.set,
          area: shape.area,
          areaMm2: shape.areaMm2,
          areaThreshold: maxAreaThreshold,
          centroid: shape.centroid,
          containsVia,
          viaInsideId,
          containsViaBy: hasRing ? 'outline' : 'centroid-proximity',
          pass: false,
          message: `❌ 发现孤立小铜皮：Shape #${shape.id} (${shape.layer}层) 面积仅 ${roundN(shape.area, 1)} sq mil (${roundN(shape.areaMm2, 4)} mm² < 阈值 ${maxAreaThreshold} sq mil)，中心坐标 [${roundN(shape.centroid.x, 1)}, ${roundN(shape.centroid.y, 1)}]`
        });
      }
    }
    return results;
  }
  function checkCopperArcRadius(shapes, minArcRadius = 10.0) {
    const results = [];
    for (const shape of shapes) {
      if (shape.arcs && shape.arcs.length > 0) {
        for (let i = 0; i < shape.arcs.length; i++) {
          const arc = shape.arcs[i];
          const isPass = arc.radius >= minArcRadius;
          if (!isPass) {
            results.push({
              checkCategory: 'arc_radius',
              checkCategoryName: '⑤ 铜皮圆弧半径检查',
              shapeId: shape.id,
              layer: shape.layer,
              arcIndex: i + 1,
              actualRadius: arc.radius,
              requiredRadius: minArcRadius,
              centerCoord: [arc.cx, arc.cy],
              pass: false,
              message: `❌ 铜皮圆弧半径过小：Shape #${shape.id} (${shape.layer}层) 第 ${i + 1} 段圆弧实测半径 ${roundN(arc.radius, 2)} mil (< 最小允许值 ${minArcRadius} mil)，圆心坐标 [${roundN(arc.cx, 1)}, ${roundN(arc.cy, 1)}]`
            });
          }
        }
      }
    }
    return results;
  }
  function groupResultsByTargetObject(records) {
    const groups = [];
    const map = new Map();
    for (const r of records) {
      let key = '';
      let targetType = '';
      let targetLabel = '';
      if (r.checkCategory === 'via_coverage') {
        key = `via_coverage_${r.viaId}_${r.ruleIndex || 1}`;
        targetType = 'via';
        targetLabel = `${r.viaPadstack || '-'} / ${r.viaNet || 'GND'} / 孔 #${r.viaId}`;
      } else if (r.checkCategory === 'special_shape') {
        key = `special_shape_${r.viaId}`;
        targetType = 'via';
        targetLabel = `${r.viaPadstack || '-'} / ${r.viaNet || 'GND'} / 孔 #${r.viaId}`;
      } else if (r.checkCategory === 'trace_ref_margin') {
        key = `trace_ref_margin_${r.traceId}_${r.ruleIndex || 1}`;
        targetType = 'trace';
        targetLabel = `- / ${r.traceNet || '-'} / 走线 #${r.traceId}`;
      } else if (r.checkCategory === 'isolated_copper') {
        key = `isolated_copper_${r.shapeId}`;
        targetType = 'shape';
        targetLabel = `- / - / 铜皮 Shape #${r.shapeId}`;
      } else if (r.checkCategory === 'arc_radius') {
        key = `arc_radius_${r.shapeId}`;
        targetType = 'shape';
        targetLabel = `- / - / 铜皮 Shape #${r.shapeId}`;
      } else {
        key = `misc_${Math.random()}`;
        targetLabel = '未知目标';
      }
      if (!map.has(key)) {
        const item = {
          groupKey: key,
          checkCategory: r.checkCategory,
          checkCategoryName: r.checkCategoryName,
          targetType,
          targetLabel,
          viaId: r.viaId,
          viaNet: r.viaNet,
          viaPadstack: r.viaPadstack,
          viaCoord: r.viaCoord,
          traceId: r.traceId,
          traceNet: r.traceNet,
          traceLayer: r.traceLayer,
          shapeId: r.shapeId,
          layer: r.layer,
          centroid: r.centroid,
          subRecords: []
        };
        map.set(key, item);
        groups.push(item);
      }
      map.get(key).subRecords.push(r);
    }
    for (const g of groups) {
      const subs = g.subRecords;
      const allPass = subs.every(s => s.pass);
      g.pass = allPass;
      if (g.checkCategory === 'via_coverage') {
        const failedSubs = subs.filter(s => !s.pass);
        const passedSubs = subs.filter(s => s.pass);
        const layersChecked = subs.map(s => s.layer);
        g.layerListStr = layersChecked.join(', ');
        g.layer = g.layerListStr;
        g.layerCount = layersChecked.length;
        g.failCount = failedSubs.length;
        g.passCount = passedSubs.length;
        g.requiredDist = subs[0].requiredDist || 50.0;
        const layerDistances = subs.map(s => `${s.layer}: ${s.actualDistStr}`).join('；');
        if (allPass) {
          g.actualDistStr = '全部目标层在搜索范围内检出铜皮';
          g.metricsStr = `${layerDistances}（每层孔心 ≤ ${g.requiredDist} mil 检出任意铜皮即达标）`;
          g.message = `✅ 符合：孔 #${g.viaId} (${g.viaNet || 'GND'}) 在全部 ${g.layerCount} 个目标层【${g.layerListStr}】的孔心 ${g.requiredDist} mil 搜索范围内均检测到铜皮`;
        } else {
          const failLayers = failedSubs.map(s => s.layer).join(', ');
          g.actualDistStr = `${failLayers} 等 ${g.failCount} 层在搜索范围内未检出铜皮`;
          g.metricsStr = `${layerDistances}（每层孔心 ≤ ${g.requiredDist} mil 检出任意铜皮即达标）`;
          g.message = `❌ 不符合：孔 #${g.viaId} (${g.viaNet || 'GND'}) 在 ${g.failCount} 个目标层【${failLayers}】的孔心 ${g.requiredDist} mil 搜索范围内未检测到铜皮`;
        }
      } else if (g.checkCategory === 'special_shape') {
        const s0 = subs[0];
        const failedSubs = subs.filter(s => !s.pass);
        const layersChecked = [...new Set(subs.map(s => s.layer))];
        const templateNames = [...new Set(subs.map(s => s.templateName).filter(Boolean))];
        g.layer = layersChecked.join(', ');
        g.layerListStr = g.layer;
        g.templateNames = templateNames;
        g.expectedArea = templateNames.length === 1 ? s0.expectedArea : null;
        g.actualArea = templateNames.length === 1 ? s0.actualArea : null;
        g.failCount = failedSubs.length;
        g.passCount = subs.length - failedSubs.length;
        const hdiMetrics = [];
        if (s0.actualHdiViaId != null) hdiMetrics.push(`目标孔 #${s0.viaId} → 同网络 HDI #${s0.actualHdiViaId}，关联距离 ${roundN(s0.hdiAssociationDistance, 3)} mil`);
        if (s0.pairedHdiViaId != null) hdiMetrics.push(`HDI #${s0.actualHdiViaId} ↔ 差分 HDI #${s0.pairedHdiViaId}，实测中心距 ${roundN(s0.actualDifferentialCenterDistance, 3)} mil`);
        if (s0.expectedDifferentialCenterDistance != null) hdiMetrics.push(`HDI 中心距规则 ${s0.expectedDifferentialCenterDistance} mil`);
        if (s0.hdiSearchRadiusMm != null) hdiMetrics.push(`搜索距离 ≤ ${s0.hdiSearchRadiusMm} mm`);
        g.metricsStr = s0.associationFailed ? s0.associationSummary :
          (hdiMetrics.length ? hdiMetrics.join('；') + '；' : '') + subs.map(s => `${s.layer}【${s.templateName}】实测 ${roundN(s.actualArea, 1)} / 要求 ${roundN(s.expectedArea, 1)} ±${s.areaTolerance} sq mil`).join('；');
        g.message = s0.associationFailed ? s0.message : (allPass
          ? `✅ 符合：孔 #${g.viaId} 在目标层【${g.layerListStr}】的 ${subs.length} 项异型铜皮要求均匹配【${templateNames.join('、')}】`
          : failedSubs.map(s => s.message).join('；'));
      } else if (g.checkCategory === 'trace_ref_margin') {
        const failedSubs = subs.filter(s => !s.pass);
        const s0 = subs[0];
        const endpointViaIds = [...new Set(subs.flatMap(s => s.endpointAntipadViaIds || []))];
        const firstMissing = failedSubs.find(s => s.missingPoint);
        const issueText = s => {
          const issues = [];
          const missingAt = s.missingPoint ? `（首个缺铜点 [${roundN(s.missingPoint.x, 1)}, ${roundN(s.missingPoint.y, 1)}]）` : '';
          if (s.footprintCovered === false) issues.push(`完整走线投影缺铜${missingAt}${s.missingReason ? `；原因：${s.missingReason}` : ''}`);
          if (s.leftSideCopper === false) issues.push(`走线左侧 ${s.minMargin} mil 内无铜`);
          if (s.rightSideCopper === false) issues.push(`走线右侧 ${s.minMargin} mil 内无铜`);
          return issues.join('、') || '参考铜不符合要求';
        };
        g.traceLayer = s0.traceLayer;
        g.layer = s0.traceLayer;
        g.layerListStr = `信号层: ${s0.traceLayer} (${subs.map(s => `${s.refType}:${s.refLayer}`).join(', ')})`;
        g.minMargin = s0.minMargin;
        g.missingPoint = firstMissing ? firstMissing.missingPoint : null;
        g.missingReason = firstMissing ? firstMissing.missingReason : '';
        g.endpointAntipadChecks = subs.flatMap(s => s.endpointAntipadChecks || []);
        g.endpointAntipadViaIds = endpointViaIds;
        g.endpointAntipadExemptionCount = endpointViaIds.length;
        const exemptionText = endpointViaIds.length ? `；已按规则豁免首尾端所有被检查层中 Via #${endpointViaIds.join('、#')} 对应的反焊盘` : '';
        if (allPass) {
          g.actualMargin = s0.minMargin;
          g.metricsStr = `各参考层除首尾端所有层反焊盘豁免区外均完整覆盖走线投影，且走线左右两侧边缘外 ${s0.minMargin} mil 内各存在铜皮${exemptionText}`;
          g.message = `✅ 符合：走线【${s0.traceNet}】在上下参考层除首尾端所有层反焊盘豁免区外的完整投影均有铜，且左右两侧规则距离内均有铜${exemptionText}`;
        } else {
          const failDesc = failedSubs.map(s => `${s.refType}【${s.refLayer}】：${issueText(s)}`).join('；');
          g.actualMargin = 0;
          g.metricsStr = failDesc + exemptionText;
          g.message = `❌ 不符合：走线【${s0.traceNet}】${failDesc}${exemptionText}`;
        }
      } else if (g.checkCategory === 'isolated_copper') {
        const s0 = subs[0];
        g.layer = s0.layer;
        g.layerListStr = s0.layer;
        g.area = s0.area;
        g.areaThreshold = s0.areaThreshold;
        g.metricsStr = `铜皮面积: ${roundN(s0.area, 1)} sq mil (阈值 < ${s0.areaThreshold})`;
        g.message = s0.message;
      } else if (g.checkCategory === 'arc_radius') {
        const s0 = subs[0];
        const minR = Math.min(...subs.map(s => s.actualRadius));
        g.layer = s0.layer;
        g.layerListStr = s0.layer;
        g.actualRadius = minR;
        g.requiredRadius = s0.requiredRadius;
        g.smallArcCount = subs.length;
        g.metricsStr = `最小半径: ${roundN(minR, 2)} mil (共 ${subs.length} 处圆弧 < ${s0.requiredRadius} mil)`;
        g.message = `❌ 不符合：铜皮 Shape #${g.shapeId} 在【${s0.layer}】层存在 ${subs.length} 处过小圆弧，最小半径仅 ${roundN(minR, 2)} mil (< 阈值 ${s0.requiredRadius} mil)，易引起蚀刻酸角缺陷`;
      }
    }
    return groups;
  }
  function getDefaultSpecialShapeTemplates() {
    return [
      { id: 'tmpl_1', name: 'L2特定异型泪滴铜皮', padstack: 'BGA_3510', differentialCenterDistance: 10.0, hdiSearchRadiusMm: 0.175, layer: '02G01P', expectedArea: 452.38, areaTolerance: 30.0, rawShapeText: '' },
      { id: 'tmpl_2', name: 'L19特定异型铜皮', padstack: 'BGA_3510', differentialCenterDistance: 10.0, hdiSearchRadiusMm: 0.175, layer: '19IS08', expectedArea: 113.10, areaTolerance: 20.0, rawShapeText: '' },
      { id: 'pth_l5_l10_050', name: 'PTH-SIG L5/L10 · HDI 孔距 0.5 mm', padstack: 'PTH-SIG-150drill-ring0_L5_L10', differentialCenterDistance: 19.685, hdiSearchRadiusMm: 0.175, layer: '05G02P, 10G07P', expectedArea: 113.09734, areaTolerance: 1.0, rawShapeText: '' },
      { id: 'pth_l5_l10_060', name: 'PTH-SIG L5/L10 · HDI 孔距 0.6 mm', padstack: 'PTH-SIG-150drill-ring0_L5_L10', differentialCenterDistance: 23.62, hdiSearchRadiusMm: 0.175, layer: '05G02P, 10G07P', expectedArea: 50.26548, areaTolerance: 1.0, rawShapeText: '' },
      { id: 'pth_l5_l10_070', name: 'PTH-SIG L5/L10 · HDI 孔距 0.7 mm', padstack: 'PTH-SIG-150drill-ring0_L5_L10', differentialCenterDistance: 27.56, hdiSearchRadiusMm: 0.175, layer: '05G02P, 10G07P', expectedArea: 97.38257, areaTolerance: 1.0, rawShapeText: '' },
      { id: 'pth_l5_l10_080', name: 'PTH-SIG L5/L10 · HDI 孔距 0.8 mm', padstack: 'PTH-SIG-150drill-ring0_L5_L10', differentialCenterDistance: 31.496, hdiSearchRadiusMm: 0.175, layer: '05G02P, 10G07P', expectedArea: 101.16052, areaTolerance: 1.0, rawShapeText: '' }
    ];
  }
  function runAllCopperChecks(inputText, config = {}) {
    const startTime = Date.now();
    const parsed = parsePcbElements(inputText);
    const { shapes, vias, traces, layers } = parsed;
    const viaCovRules = config.viaCoverageRules || [
      { id: 'cov_1', padstack: 'HDI_045drill_ring3_1_4', layers: 'L1-L5', coverageRadius: 50.0 },
      { id: 'cov_2', padstack: 'BGA_GND_pad1mil_0902', layers: '02G01P, 19IS08', coverageRadius: 50.0 }
    ];
    const specialShapeTemplates = config.specialShapeTemplates || getDefaultSpecialShapeTemplates();
    const traceMarginRules = config.traceMarginRules || [
      { id: 'margin_1', traceLayer: '19IS08', upperRefLayer: '08IS03', lowerRefLayer: 'Bottom', minMargin: 50.0 },
      { id: 'margin_2', traceLayer: '08IS03', upperRefLayer: '02G01P', lowerRefLayer: '19IS08', minMargin: 50.0 }
    ];
    const smallCopperAreaThreshold = config.smallCopperAreaThreshold != null ? config.smallCopperAreaThreshold : 500.0;
    const minArcRadius = config.minArcRadius != null ? config.minArcRadius : 10.0;
    const res1 = checkViaLayerCoverage(vias, shapes, viaCovRules, layers);
    const res2 = checkSpecialShapedCopper(vias, shapes, specialShapeTemplates);
    const res3 = checkTraceReferenceMargin(traces, shapes, traceMarginRules, vias);
    const res4 = checkIsolatedSmallCopper(shapes, vias, smallCopperAreaThreshold);
    const res5 = checkCopperArcRadius(shapes, minArcRadius);
    const allDefects = [
      ...res1.filter(r => !r.pass),
      ...res2.filter(r => !r.pass),
      ...res3.filter(r => !r.pass),
      ...res4.filter(r => !r.pass),
      ...res5.filter(r => !r.pass)
    ];
    const allRecords = [
      ...res1,
      ...res2,
      ...res3,
      ...res4,
      ...res5
    ];
    const groupedRecords = groupResultsByTargetObject(allRecords);
    const groupedDefects = groupedRecords.filter(g => !g.pass);
    const elapsedMs = Date.now() - startTime;
    const summary = {
      totalShapes: shapes.length,
      totalVias: vias.length,
      totalTraces: traces.length,
      totalLayers: layers.length,
      totalChecks: allRecords.length,
      totalDefects: allDefects.length,
      totalGroupedChecks: groupedRecords.length,
      totalGroupedDefects: groupedDefects.length,
      passCount: allRecords.length - allDefects.length,
      failCount: allDefects.length,
      breakdown: {
        viaCoverageDefects: res1.filter(r => !r.pass).length,
        specialShapeDefects: res2.filter(r => !r.pass).length,
        traceMarginDefects: res3.filter(r => !r.pass).length,
        smallCopperDefects: res4.filter(r => !r.pass).length,
        arcRadiusDefects: res5.filter(r => !r.pass).length
      },
      elapsedMs
    };
    return {
      success: true,
      shapes,
      vias,
      traces,
      layers,
      summary,
      results: {
        all: allRecords,
        defects: allDefects,
        grouped: groupedRecords,
        groupedDefects: groupedDefects,
        viaCoverage: res1,
        specialShape: res2,
        traceMargin: res3,
        isolatedCopper: res4,
        arcRadius: res5
      }
    };
  }
  return {
    physicalLayerAlias: physicalLayerAlias,
    checkViaLayerCoverage: checkViaLayerCoverage,
    checkSpecialShapedCopper: checkSpecialShapedCopper,
    getDefaultSpecialShapeTemplates: getDefaultSpecialShapeTemplates,
    checkTraceReferenceMargin: checkTraceReferenceMargin,
    checkIsolatedSmallCopper: checkIsolatedSmallCopper,
    checkCopperArcRadius: checkCopperArcRadius,
    groupResultsByTargetObject: groupResultsByTargetObject,
    runAllCopperChecks: runAllCopperChecks
  };
});
