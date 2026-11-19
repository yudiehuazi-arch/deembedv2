/* fanout-topology.js —— Trace 锚点、盲埋孔堆叠扩展、逻辑信号孔折叠与审计 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FanoutChecker = Object.assign(root.FanoutChecker || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict"; function buildSignalTopology(signalVias) {
    const list = Array.isArray(signalVias) ? signalVias : [], byId = new Map(), neighbors = new Map(), coordinateGroups = new Map();
    const normalizedNet = via => String(via && via.net || '').trim().toUpperCase();
    const connect = (leftId, rightId) => {
      if (leftId === rightId || !neighbors.has(leftId) || !neighbors.has(rightId)) return;
      neighbors.get(leftId).add(rightId); neighbors.get(rightId).add(leftId);
    };
    list.forEach(via => {
      const id = String(via.id), net = normalizedNet(via);
      via.isFanoutEligible = false; delete via.fanoutStackId; delete via.fanoutStackViaIds;
      byId.set(id, via); neighbors.set(id, new Set());
      if (!via.hasConnections || !net || net === 'UNNAMED_NET') return;
      const key = `${net}\u0000${Number(via.x).toFixed(3)}\u0000${Number(via.y).toFixed(3)}`;
      if (!coordinateGroups.has(key)) coordinateGroups.set(key, []);
      coordinateGroups.get(key).push(via);
    });
    list.forEach(via => {
      if (!via.hasConnections) return;
      const sourceId = String(via.id), sourceNet = normalizedNet(via);
      (via.connectedViaIds || []).forEach(targetId => {
        const target = byId.get(String(targetId));
        if (target && target.hasConnections && sourceNet && sourceNet !== 'UNNAMED_NET' && sourceNet === normalizedNet(target)) connect(sourceId, String(target.id));
      });
    });
    coordinateGroups.forEach(group => {
      if (group.length < 2 || !group.some(via => (via.connectedViaIds || []).length > 0)) return;
      for (let i = 1; i < group.length; i++) connect(String(group[0].id), String(group[i].id));
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
  function selectTraceConnectedSignalVias(signalVias) {
    const topology = buildSignalTopology(signalVias), activeIds = new Set();
    const queue = topology.list.filter(via => via.hasConnections && via.hasTraceConnections);
    while (queue.length) {
      const via = queue.shift(), id = String(via.id);
      if (activeIds.has(id)) continue;
      activeIds.add(id); via.isFanoutEligible = true;
      (topology.neighbors.get(id) || []).forEach(nextId => { if (!activeIds.has(nextId)) queue.push(topology.byId.get(nextId)); });
    }
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
      const anchor = physicalVias.find(via => via.hasTraceConnections) || physicalVias[0];
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
  return { selectTraceConnectedSignalVias, collapseSignalStacks, signalStackAudit };
});
