/* ============================================================================
 * pour-hdi-association.js —— 规则 2 的 HDI 候选、铜皮连通与差分孔配对
 * ========================================================================== */
(function (root, factory) {
  var geom = (typeof module === "object" && module.exports) ? require("./pour-geom.js") : root.PourChecker;
  var parser = (typeof module === "object" && module.exports) ? require("./pour-parser.js") : root.PourChecker;
  var api = factory(geom, parser);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PourChecker = Object.assign(root.PourChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (geom, parser) {
  "use strict";
  var dist2D = geom.dist2D, physicalLayerAlias = geom.physicalLayerAlias;
  var queryPointGrid = geom.queryPointGrid, pointToShapeDistance = geom.pointToShapeDistance;
  var findAssociatedShapeItems = parser.findAssociatedShapeItems;
  var CENTER_DISTANCE_TOLERANCE = 0.01;

  function layerNumber(layer) {
    const match = String(physicalLayerAlias(layer) || '').match(/^L0*(\d+)$/i);
    return match ? parseInt(match[1], 10) : null;
  }
  function viaCoversLayer(via, layer) {
    const number = layerNumber(layer);
    if (number == null || via.minLayerNum == null || via.maxLayerNum == null) return true;
    return number >= via.minLayerNum && number <= via.maxLayerNum;
  }
  function differentialHdiTopologyCompatible(left, right, connectionLayer) {
    if (connectionLayer && (!viaCoversLayer(left, connectionLayer) || !viaCoversLayer(right, connectionLayer))) return false;
    if (left.minLayerNum == null || left.maxLayerNum == null || right.minLayerNum == null || right.maxLayerNum == null) return true;
    return left.minLayerNum === right.minLayerNum && left.maxLayerNum === right.maxLayerNum;
  }
  function shapeComponents(shape) {
    return shape && Array.isArray(shape.components) && shape.components.length ? shape.components : (shape ? [shape] : []);
  }
  function viaShapeContactTolerance(via) {
    const drillRadius = Number(via && via.drill) > 0 ? Number(via.drill) / 2 : 0;
    const ringMatch = String(via && via.padstack || '').match(/ring\s*([\d.]+)/i);
    const annularRing = ringMatch ? parseFloat(ringMatch[1]) : 0;
    return Math.max(0.05, drillRadius + (annularRing > 0 ? annularRing : 0));
  }
  /**
   * 某些封装内外网络会改名：目标 Pin 的 Shape Net 与落入该铜皮的 HDI Via Net 不一定同名。
   * 仅在目标孔与 HDI 焊盘真实接触同一 Set=Shape 连通铜皮，且 HDI 层跨覆盖该层时补充候选。
   */
  function findCopperConnectedHdiCandidates(via, targetLayers, electricalShapeIndexes, allHdiIndex, maxDistanceMil) {
    if (!electricalShapeIndexes || !allHdiIndex) return [];
    const layerKeys = new Set();
    (targetLayers || []).forEach(layer => layerKeys.add(String(layer || '').trim().toUpperCase()));
    (via.connectedLayers || []).forEach(layer => layerKeys.add(String(layer || '').trim().toUpperCase()));
    if (via.startLayer) layerKeys.add(String(via.startLayer).trim().toUpperCase());
    if (via.endLayer) layerKeys.add(String(via.endLayer).trim().toUpperCase());
    const found = new Map();
    layerKeys.forEach(layerKey => {
      const index = electricalShapeIndexes.get(layerKey) || electricalShapeIndexes.get(physicalLayerAlias(layerKey));
      if (!index) return;
      const connectedShape = findAssociatedShapeItems(via, index);
      // 没有实际边界的旧模板对象只能走同 Net 兼容路径，不能据质心推断物理连通。
      const components = shapeComponents(connectedShape).filter(shape => shape && shape.bbox);
      const targetTolerance = viaShapeContactTolerance(via);
      if (!components.length || !components.some(shape => pointToShapeDistance(via.x, via.y, shape) <= targetTolerance)) return;
      const actualLayer = String(components[0].layer || layerKey).trim();
      const source = maxDistanceMil != null
        ? queryPointGrid(allHdiIndex, via.x - maxDistanceMil, via.y - maxDistanceMil, via.x + maxDistanceMil, via.y + maxDistanceMil)
        : components.flatMap(shape => queryPointGrid(allHdiIndex, shape.bbox.minX - 0.05, shape.bbox.minY - 0.05,
          shape.bbox.maxX + 0.05, shape.bbox.maxY + 0.05));
      source.forEach(candidate => {
        if (candidate === via || !viaCoversLayer(candidate, actualLayer)) return;
        const distance = dist2D(via.x, via.y, candidate.x, candidate.y);
        if (maxDistanceMil != null && distance > maxDistanceMil + 1e-9) return;
        const candidateTolerance = viaShapeContactTolerance(candidate);
        if (!components.some(shape => pointToShapeDistance(candidate.x, candidate.y, shape) <= candidateTolerance)) return;
        const association = {
          via: candidate, distance, associationMode: 'copper_connected', connectionLayer: actualLayer,
          connectionShapeIds: components.map(shape => shape.id)
        };
        const previous = found.get(candidate);
        if (!previous || distance < previous.distance - 1e-9 ||
            (Math.abs(distance - previous.distance) <= 1e-9 && actualLayer.localeCompare(previous.connectionLayer) < 0)) {
          found.set(candidate, association);
        }
      });
    });
    return Array.from(found.values());
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
  function findTemplateHdiAssociation(via, hdiCandidates, hdiIndex, maxDistanceMil, hdiByNet, expectedCenterDistance, copperCandidates) {
    const bounded = maxDistanceMil != null;
    const source = bounded && hdiIndex ? queryPointGrid(hdiIndex, via.x - maxDistanceMil, via.y - maxDistanceMil,
      via.x + maxDistanceMil, via.y + maxDistanceMil) : (hdiCandidates || []);
    const byVia = new Map();
    source.filter(candidate => candidate !== via).forEach(candidate => byVia.set(candidate, {
      via: candidate, distance: dist2D(via.x, via.y, candidate.x, candidate.y), associationMode: 'same_net',
      connectionLayer: '', connectionShapeIds: []
    }));
    (copperCandidates || []).forEach(item => byVia.set(item.via, item));
    const nearby = Array.from(byVia.values())
      .filter(item => !bounded || item.distance <= maxDistanceMil + 1e-9)
      .sort((a, b) => (a.associationMode === 'copper_connected' ? 0 : 1) - (b.associationMode === 'copper_connected' ? 0 : 1) ||
        a.distance - b.distance || String(a.via.id).localeCompare(String(b.via.id), undefined, { numeric: true }));
    if (!nearby.length) return null;
    if (expectedCenterDistance == null) return { nearbyHdi: nearby[0], pairedHdi: null };
    for (const item of nearby) {
      const mateNet = differentialMateNetName(item.via.net);
      const mates = mateNet ? (hdiByNet.get(mateNet.toLowerCase()) || []).map(candidate => ({
        via: candidate, distance: dist2D(item.via.x, item.via.y, candidate.x, candidate.y)
      })).filter(candidate => differentialHdiTopologyCompatible(item.via, candidate.via, item.connectionLayer) &&
        Math.abs(candidate.distance - expectedCenterDistance) <= CENTER_DISTANCE_TOLERANCE)
        .sort((a, b) => Math.abs(a.distance - expectedCenterDistance) - Math.abs(b.distance - expectedCenterDistance) ||
          String(a.via.id).localeCompare(String(b.via.id), undefined, { numeric: true })) : [];
      if (mates.length) return { nearbyHdi: item, pairedHdi: mates[0] };
    }
    return null;
  }
  function nearestHdiCandidate(via, candidates) {
    let nearest = null, distance = Infinity;
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

  return {
    findCopperConnectedHdiCandidates,
    findTemplateHdiAssociation,
    nearestHdiCandidate,
    findDifferentialHdiPair
  };
});
