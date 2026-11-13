/* ============================================================================
 * via-constraint-inference.js —— SIG 盲埋孔段分组、差分孔距与约束名称推算
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CopperViaInference = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MM_PER_MIL = 0.0254;
  var SEGMENT_DISTANCES_MM = [0, 0.025, 0.075, 0.125, 0.175];
  var SEGMENT_DISTANCE_TOL_MM = 0.005;

  function uniq(list) {
    var seen = {};
    return (list || []).filter(function (x) {
      var k = String(x);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  function isSignalPadstack(name) {
    return /SIG/i.test(String(name || ''));
  }

  function layerNum(token, n) {
    var s = String(token || '').replace(/[<>]/g, '').trim();
    if (/^(top|表层|顶层)$/i.test(s)) return 1;
    if (/^(bot|bottom|底层)$/i.test(s)) return 14;
    var lm = s.match(/^L\s*0*(\d{1,2})$/i);
    if (lm) return +lm[1];
    var sm = s.match(/^0*(\d{1,2})[A-Za-z]/);
    return sm ? +sm[1] : 0;
  }

  function layerTokens(text, n) {
    var s = String(text || ''), out = [], re = /(^|[^A-Za-z0-9])(TOP|BOT(?:TOM)?|L\s*0*\d{1,2})(?![A-Za-z0-9])/gi, m;
    while ((m = re.exec(s))) {
      var num = layerNum(m[2], n);
      if (num > 0) out.push(num);
    }
    return uniq(out);
  }

  function spanOfVia(via, n) {
    var nums = layerTokens(via && via.padstack, n);
    if (nums.length < 2 && via) {
      var a = layerNum(via.padstackStart, n), b = layerNum(via.padstackEnd, n);
      if (a) nums.push(a);
      if (b) nums.push(b);
      nums = uniq(nums);
    }
    nums.sort(function (a, b) { return a - b; });
    return {
      start: nums.length ? nums[0] : 0,
      end: nums.length ? nums[nums.length - 1] : 0,
      layers: nums
    };
  }

  function familyOf(padstacks) {
    var blob = (padstacks || []).join(' ');
    if (/BGA/i.test(blob)) return 'BGA';
    if (/SMA/i.test(blob)) return 'SMA';
    return '';
  }

  function distMil(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function isSegmentDistance(a, b) {
    var mm = distMil(a, b) * MM_PER_MIL;
    return SEGMENT_DISTANCES_MM.some(function (target) {
      return Math.abs(mm - target) <= SEGMENT_DISTANCE_TOL_MM + 1e-9;
    });
  }

  function buildUnit(members, n, signal, order) {
    var xs = 0, ys = 0, layers = [], traces = [], conns = [];
    var ids = members.map(function (v) { return v.id; });
    var pads = uniq(members.map(function (v) { return v.padstack || ''; }).filter(Boolean));
    members.forEach(function (v) {
      xs += v.origin[0]; ys += v.origin[1];
      var sp = spanOfVia(v, n);
      layers = layers.concat(sp.layers);
      traces = traces.concat(v.traceLayers || []);
      if (v.connections) conns.push(v.connections);
    });
    layers = uniq(layers).sort(function (a, b) { return a - b; });
    traces = uniq(traces);
    var center = [xs / members.length, ys / members.length];
    var display = Object.assign({}, members[0], {
      id: ids.join('/'),
      origin: center,
      padstack: pads.join(' + '),
      traceLayers: traces,
      connections: uniq(conns).join(' | ')
    });
    return {
      order: order,
      signal: signal,
      via: display,
      vias: members,
      memberIds: ids,
      padstacks: pads,
      center: center,
      kind: familyOf(pads),
      startLayer: layers.length ? layers[0] : 0,
      endLayer: layers.length ? layers[layers.length - 1] : 0,
      segmentLayers: layers,
      mateNet: '',
      mateGroupId: '',
      pitchMm: null
    };
  }

  function connectedUnits(list, n, firstOrder) {
    var parent = list.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function join(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (isSegmentDistance(list[i].origin, list[j].origin)) join(i, j);
      }
    }
    var comps = {};
    list.forEach(function (v, idx) {
      var r = find(idx);
      (comps[r] || (comps[r] = [])).push(v);
    });
    return Object.keys(comps).map(function (k) {
      var members = comps[k];
      var order = Math.min.apply(null, members.map(function (v) { return firstOrder[v.id]; }));
      return buildUnit(members, n, true, order);
    });
  }

  function groupVias(vias, n) {
    var byNet = {}, out = [], order = {};
    (vias || []).forEach(function (v, i) {
      order[v.id] = i;
      if (!isSignalPadstack(v.padstack)) { out.push(buildUnit([v], n, false, i)); return; }
      var key = String(v.net || '');
      (byNet[key] || (byNet[key] = [])).push(v);
    });
    Object.keys(byNet).forEach(function (net) {
      out = out.concat(connectedUnits(byNet[net], n, order));
    });
    return out.sort(function (a, b) { return a.order - b.order; });
  }

  function mateName(net) {
    var s = String(net || ''), pairs = [
      [/_P$/i, '_N'], [/_N$/i, '_P'], [/_\+$/i, '_-'], [/_-$/i, '_+'],
      [/\.P$/i, '.N'], [/\.N$/i, '.P'], [/\+$/i, '-'], [/-$/i, '+'], [/P$/i, 'N'], [/N$/i, 'P']
    ];
    for (var i = 0; i < pairs.length; i++) if (pairs[i][0].test(s)) return s.replace(pairs[i][0], pairs[i][1]);
    return '';
  }

  function attachDifferentialPitch(units) {
    var byNet = {};
    (units || []).forEach(function (u) {
      if (!u.signal) return;
      var key = String(u.via.net || '').toLowerCase();
      (byNet[key] || (byNet[key] = [])).push(u);
    });
    (units || []).forEach(function (u) {
      if (!u.signal) return;
      var mate = mateName(u.via.net);
      if (!mate) return;
      var cands = byNet[mate.toLowerCase()] || [];
      var sameSpan = cands.filter(function (x) { return x.startLayer === u.startLayer && x.endLayer === u.endLayer; });
      if (sameSpan.length) cands = sameSpan;
      var best = null, bestD = Infinity;
      cands.forEach(function (x) {
        var d = distMil(u.center, x.center);
        if (d < bestD) { best = x; bestD = d; }
      });
      if (!best) return;
      u.mateNet = best.via.net || mate;
      u.mateGroupId = best.via.id;
      u.pitchMm = bestD * MM_PER_MIL;
    });
    return units;
  }

  function ruleMeta(set, n) {
    var title = String(set && set.title || '');
    var layers = layerTokens(title, n).sort(function (a, b) { return a - b; });
    var pm = title.match(/([0-9]+(?:\.[0-9]+)?)\s*mm/i);
    return {
      kind: (set && set.kind) || familyOf([title]),
      startLayer: layers.length ? layers[0] : 0,
      endLayer: layers.length ? layers[layers.length - 1] : 0,
      pitchMm: pm ? parseFloat(pm[1]) : null
    };
  }

  function selectConstraint(sets, unit, n) {
    if (!unit || !unit.signal || !unit.kind || !unit.startLayer || !unit.endLayer) return { rule: null, candidates: [] };
    var sameKind = [], exact = [];
    (sets || []).forEach(function (set) {
      var meta = ruleMeta(set, n);
      if (meta.kind !== unit.kind) return;
      var item = { set: set, meta: meta };
      sameKind.push(item);
      if (meta.startLayer === unit.startLayer && meta.endLayer === unit.endLayer) exact.push(item);
    });
    var picked = null;
    if (unit.pitchMm != null) {
      var pitched = exact.filter(function (x) { return x.meta.pitchMm != null; });
      var pool = pitched.length ? pitched : exact.filter(function (x) { return x.meta.pitchMm == null; });
      pool.forEach(function (x) {
        var delta = x.meta.pitchMm == null ? 0 : Math.abs(x.meta.pitchMm - unit.pitchMm);
        if (!picked || delta < picked.delta) picked = { set: x.set, delta: delta };
      });
    } else {
      var noPitch = exact.filter(function (x) { return x.meta.pitchMm == null; });
      if (noPitch.length) picked = { set: noPitch[0].set, delta: 0 };
    }
    var candPool = exact.length ? exact : sameKind;
    return {
      rule: picked ? picked.set : null,
      pitchDeltaMm: picked ? picked.delta : null,
      candidates: candPool.slice(0, 5).map(function (x) { return x.set.title; })
    };
  }

  return {
    MM_PER_MIL: MM_PER_MIL,
    SEGMENT_DISTANCES_MM: SEGMENT_DISTANCES_MM,
    SEGMENT_DISTANCE_TOL_MM: SEGMENT_DISTANCE_TOL_MM,
    isSignalPadstack: isSignalPadstack,
    layerTokens: layerTokens,
    spanOfVia: spanOfVia,
    isSegmentDistance: isSegmentDistance,
    groupVias: groupVias,
    mateName: mateName,
    attachDifferentialPitch: attachDifferentialPitch,
    ruleMeta: ruleMeta,
    selectConstraint: selectConstraint
  };
});
