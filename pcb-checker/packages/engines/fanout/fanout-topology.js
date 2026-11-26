/* fanout-topology.js —— Connections 信号孔资格、多段孔合并、逻辑信号孔折叠与审计 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const STACK_OFFSETS_MM = [0, 0.025, 0.075, 0.125, 0.175], STACK_OFFSET_TOL_MM = 0.005, MM_PER_MIL = 0.0254;
  function normalizedNet(via) { return String(via && via.net || '').trim().toUpperCase(); }
  function signalLayerSpan(via) {
    const layers = [], text = String(via && via.padstack || ''), re = /(?:^|[^A-Za-z0-9])L\s*0*(\d{1,2})(?![A-Za-z0-9])/gi;
    let match; while ((match = re.exec(text))) layers.push(parseInt(match[1], 10));
    if (!layers.length && /(?:^|[-_])TOP(?:$|[-_])/i.test(text)) layers.push(1);
    return layers.length ? { start: Math.min(...layers), end: Math.max(...layers) } : null;
  }
  function stackBoundarySide(left, right) {
    const a = signalLayerSpan(left), b = signalLayerSpan(right);
    if (!a || !b || (a.start === b.start && a.end === b.end)) return '';
    if (a.end === b.start) return `end:${a.end}`;
    if (a.start === b.end) return `start:${a.start}`;
    if (a.start < b.start && b.start < a.end && a.end < b.end) return `end-overlap:${b.start}-${a.end}`;
    if (b.start < a.start && a.start < b.end && b.end < a.end) return `start-overlap:${a.start}-${b.end}`;
    return '';
  }
  function isStackOffset(left, right) {
    const distanceMm = Math.hypot(left.x - right.x, left.y - right.y) * MM_PER_MIL;
    return STACK_OFFSETS_MM.some(offset => Math.abs(distanceMm - offset) <= STACK_OFFSET_TOL_MM + 1e-9);
  }
  function isNearTraceAnchor(via, anchors) {
    return anchors.some(anchor => isStackOffset(via, anchor));
  }
  function buildSignalTopology(signalVias) {
    const list = Array.isArray(signalVias) ? signalVias : [], byId = new Map(), neighbors = new Map();
    const connect = (leftId, rightId) => {
      if (leftId === rightId || !neighbors.has(leftId) || !neighbors.has(rightId)) return;
      neighbors.get(leftId).add(rightId); neighbors.get(rightId).add(leftId);
    };
    list.forEach(via => {
      const id = String(via.id); via.isFanoutEligible = false; delete via.fanoutStackId; delete via.fanoutStackViaIds;
      byId.set(id, via); neighbors.set(id, new Set());
    });
    list.forEach(via => {
      const sourceId = String(via.id), sourceNet = normalizedNet(via);
      (via.connectedViaIds || []).forEach(targetId => {
        const target = byId.get(String(targetId));
        if (target && sourceNet && sourceNet !== 'UNNAMED_NET' && sourceNet === normalizedNet(target) &&
          isStackOffset(via, target) && stackBoundarySide(via, target)) connect(sourceId, String(target.id));
      });
    });
    list.forEach(left => {
      const bestByBoundary = new Map(), net = normalizedNet(left);
      if (!net || net === 'UNNAMED_NET') return;
      list.forEach(right => {
        if (left === right || net !== normalizedNet(right) || !isStackOffset(left, right)) return;
        const side = stackBoundarySide(left, right); if (!side) return;
        const distance = Math.hypot(left.x - right.x, left.y - right.y), current = bestByBoundary.get(side);
        if (!current || distance < current.distance - 1e-9 || (Math.abs(distance - current.distance) <= 1e-9 && String(right.id).localeCompare(String(current.via.id)) < 0)) bestByBoundary.set(side, { via: right, distance });
      });
      bestByBoundary.forEach(item => connect(String(left.id), String(item.via.id)));
    });
    return { list, byId, neighbors }; }
  function labelActiveStacks(topology, activeIds) {
    const assigned = new Set();
    activeIds.forEach(startId => {
      if (assigned.has(startId)) return;
      const component = [], pending = [startId];
      while (pending.length) {
        const id = pending.pop();
        if (assigned.has(id) || !activeIds.has(id)) continue;
        assigned.add(id); component.push(topology.byId.get(id));
        (topology.neighbors.get(id) || []).forEach(nextId => pending.push(nextId));
      }
      const ids = component.map(via => via.id).sort((a, b) => Number(a) - Number(b));
      const stackId = `signal_stack_${ids.join('_')}`;
      component.forEach(via => { via.fanoutStackId = stackId; via.fanoutStackViaIds = ids.slice(); });
    }); }
  function selectConnectedSignalVias(signalVias) {
    const topology = buildSignalTopology(signalVias), activeIds = new Set(), visited = new Set();
    topology.list.forEach(via => {
      const startId = String(via.id); if (visited.has(startId)) return;
      const component = [], queue = [startId]; visited.add(startId);
      while (queue.length) {
        const id = queue.shift(), member = topology.byId.get(id); if (member) component.push(member);
        (topology.neighbors.get(id) || []).forEach(nextId => { if (!visited.has(nextId)) { visited.add(nextId); queue.push(nextId); } });
      }
      const traceAnchors = component.filter(member => member.hasTraceConnections);
      if (traceAnchors.length) component.filter(member => member.hasTraceConnections || isNearTraceAnchor(member, traceAnchors))
        .forEach(member => { member.isFanoutEligible = true; activeIds.add(String(member.id)); });
    });
    labelActiveStacks(topology, activeIds);
    return topology.list.filter(via => activeIds.has(String(via.id))); }
  function collapseSignalStacks(activeSignalVias) {
    const groups = new Map();
    (activeSignalVias || []).forEach(via => {
      const key = via.fanoutStackId || `signal_stack_${via.id}`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(via);
    });
    return Array.from(groups, ([stackId, physicalVias]) => {
      physicalVias.sort((a, b) => Number(a.id) - Number(b.id));
      const anchor = physicalVias.find(via => via.hasTraceConnections) || physicalVias.find(via => via.hasConnections) || physicalVias[0];
      const x = physicalVias.reduce((sum, via) => sum + via.x, 0) / physicalVias.length;
      const y = physicalVias.reduce((sum, via) => sum + via.y, 0) / physicalVias.length;
      const connectedTraceLayers = Array.from(new Set(physicalVias.flatMap(via => via.connectedTraceLayers || [])));
      return { ...anchor, x, y, hasConnections: true, hasTraceConnections: physicalVias.some(via => via.hasTraceConnections),
        connectedTraceLayers, fanoutStackId: stackId, physicalVias, physicalViaIds: physicalVias.map(via => via.id), stackSize: physicalVias.length };
    });
  }
  function signalStackAudit(logicalVias) {
    return (logicalVias || []).map(via => ({ logicalViaId: via.id, stackId: via.fanoutStackId, net: via.net, x: via.x, y: via.y,
      physicalViaIds: (via.physicalViaIds || [via.id]).slice(), segments: (via.physicalVias || [via]).map(segment => ({
        viaId: segment.id, padstack: segment.padstack, x: segment.x, y: segment.y,
        hasTraceConnections: Boolean(segment.hasTraceConnections), connectedViaIds: (segment.connectedViaIds || []).slice() })) }));
  }
  function selectGndWithinSchemeFootprint(schemeVias, nearbyGnd, originVia, schemeOrigin, cosA, sinA, mirror, tolerance) {
    const footprint = schemeVias.reduce((bounds, via) => ({
      minX: Math.min(bounds.minX, via.x), maxX: Math.max(bounds.maxX, via.x),
      minY: Math.min(bounds.minY, via.y), maxY: Math.max(bounds.maxY, via.y)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const indices = [];
    nearbyGnd.forEach((via, index) => {
      const worldX = via.x - originVia.x, worldY = via.y - originVia.y;
      let localX = worldX * cosA + worldY * sinA;
      const localY = -worldX * sinA + worldY * cosA;
      if (mirror) localX = -localX;
      const schemeX = schemeOrigin.x + localX, schemeY = schemeOrigin.y + localY;
      if (schemeX >= footprint.minX - tolerance && schemeX <= footprint.maxX + tolerance &&
        schemeY >= footprint.minY - tolerance && schemeY <= footprint.maxY + tolerance) indices.push(index);
    });
    return indices;
  }
  function maximumGndMapping(expected, nearbyGnd, actualIndices, tolerance, requirePadstack) {
    const candidates = expected.map(item => actualIndices.map(index => {
      const via = nearbyGnd[index], distance = Math.hypot(via.x - item.expectedX, via.y - item.expectedY);
      const padMatch = String(via.padstack || '').trim().toLowerCase() === String(item.via.padstack || '').trim().toLowerCase();
      return { index, distance, padMatch };
    }).filter(item => item.distance <= tolerance && (!requirePadstack || item.padMatch))
      .sort((a, b) => Number(b.padMatch) - Number(a.padMatch) || a.distance - b.distance));
    const owner = new Map(), mapping = new Map();
    function assign(expectedIndex, visited) {
      for (const candidate of candidates[expectedIndex]) {
        if (visited.has(candidate.index)) continue;
        visited.add(candidate.index);
        const previous = owner.get(candidate.index);
        if (previous == null || assign(previous, visited)) {
          owner.set(candidate.index, expectedIndex); mapping.set(expectedIndex, candidate); return true;
        }
      }
      return false;
    }
    expected.map((_, index) => index).sort((a, b) => candidates[a].length - candidates[b].length)
      .forEach(index => assign(index, new Set()));
    return mapping;
  }
  function matchCompanionGnd(schemeGndVias, nearbyGnd, footprintIndices, schemeOrigin, originVia, cosA, sinA, mirror, tolerance) {
    const expected = schemeGndVias.map((via, index) => {
      let dx = via.x - schemeOrigin.x, dy = via.y - schemeOrigin.y;
      if (mirror) dx = -dx;
      return { via, index, expectedX: originVia.x + dx * cosA - dy * sinA,
        expectedY: originVia.y + dx * sinA + dy * cosA };
    });
    const exact = maximumGndMapping(expected, nearbyGnd, footprintIndices, tolerance, true);
    const mapping = new Map(exact);
    if (mapping.size < expected.length) {
      const exactExpected = new Set(mapping.keys()), exactActual = new Set(Array.from(mapping.values(), item => item.index));
      const remainingExpectedIndices = expected.map((_, index) => index).filter(index => !exactExpected.has(index));
      const remainingActualIndices = footprintIndices.filter(index => !exactActual.has(index));
      const fallback = maximumGndMapping(remainingExpectedIndices.map(index => expected[index]), nearbyGnd,
        remainingActualIndices, tolerance, false);
      fallback.forEach((candidate, index) => mapping.set(remainingExpectedIndices[index], candidate));
    }
    const usedGndIndices = new Set(), padMismatchList = [], missingVias = [], audit = [];
    expected.forEach((item, index) => {
      const chosen = mapping.get(index), role = item.via.role || (`伴随地孔${item.via.id}`);
      if (!chosen) {
        missingVias.push({ expectedX: item.expectedX, expectedY: item.expectedY,
          expectedPadstack: item.via.padstack, role, net: item.via.net || 'GND' });
        return;
      }
      const actual = nearbyGnd[chosen.index]; usedGndIndices.add(chosen.index);
      if (!chosen.padMatch) padMismatchList.push({ viaId: actual.id, net: actual.net,
        actualPadstack: actual.padstack, expectedPadstack: item.via.padstack, role });
      audit.push({ viaIndex: index + 1, viaId: actual.id, net: actual.net, x: actual.x, y: actual.y,
        actualPadstack: actual.padstack, expectedPadstack: item.via.padstack, role,
        isMatch: chosen.padMatch, deviation: chosen.distance });
    });
    return { usedGndIndices, padMismatchList, missingVias, audit, matchedGndCount: usedGndIndices.size };
  }
  function resolveSignalNetAlias(matchingVias, aliasCandidates, relativeSchemeVias, originVia, distanceTolerance, allowRecovery, missingCount) {
    const usedSignalIndices = new Set(), usedAliasIndices = new Set(), recoveries = [];
    const normalizedPadstack = via => String(via && via.padstack || '').trim().toLowerCase();
    const polarity = via => ((String(via && via.net || '').trim().match(/_([PN])$/i) || [])[1] || '').toUpperCase();
    for (const item of relativeSchemeVias) {
      const expectedX = originVia.x + item.relX, expectedY = originVia.y + item.relY;
      let foundSignalIndex = -1;
      for (let index = 0; index < matchingVias.length; index++) {
        const via = matchingVias[index];
        const actualPolarity = polarity(via), expectedPolarity = polarity(item.sv);
        if (!usedSignalIndices.has(index) && normalizedPadstack(via) === normalizedPadstack(item.sv) &&
          (!actualPolarity || !expectedPolarity || actualPolarity === expectedPolarity) &&
          Math.hypot(via.x - expectedX, via.y - expectedY) <= distanceTolerance) {
          foundSignalIndex = index; break;
        }
      }
      if (foundSignalIndex !== -1) { usedSignalIndices.add(foundSignalIndex); continue; }
      if (!allowRecovery || Number(item.sv.drill || 0) !== 0) return null;
      const aliasMatches = [];
      for (let index = 0; index < aliasCandidates.length; index++) {
        const via = aliasCandidates[index];
        if (!usedAliasIndices.has(index) && normalizedPadstack(via) === normalizedPadstack(item.sv) &&
          Math.hypot(via.x - expectedX, via.y - expectedY) <= distanceTolerance) aliasMatches.push(index);
      }
      if (aliasMatches.length !== 1) return null;
      const aliasIndex = aliasMatches[0], aliasVia = aliasCandidates[aliasIndex];
      usedAliasIndices.add(aliasIndex);
      recoveries.push({ viaId: aliasVia.id, sourceNet: aliasVia.net, expectedNet: item.sv.net,
        x: aliasVia.x, y: aliasVia.y, padstack: aliasVia.padstack });
    }
    if (usedSignalIndices.size !== matchingVias.length || usedAliasIndices.size !== missingCount) return null;
    const recoveredSignalVias = Array.from(usedAliasIndices, index => aliasCandidates[index]);
    return { resolvedSignalVias: matchingVias.concat(recoveredSignalVias), recoveredSignalVias, signalNetRecoveries: recoveries };
  }
  return { selectConnectedSignalVias, selectTraceConnectedSignalVias: selectConnectedSignalVias,
    collapseSignalStacks, signalStackAudit, selectGndWithinSchemeFootprint, matchCompanionGnd, resolveSignalNetAlias };
});
