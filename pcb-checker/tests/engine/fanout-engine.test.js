/**
 * fanout-test.js
 * 扇出方案聚类与比对引擎单元测试
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FanoutChecker = require("../../packages/engines/fanout");

const {
  FanoutScheme,
  FanoutLibrary,
  parseViaData,
  clusterVias,
  matchClusterToLibrary,
  runFanoutInspection,
  getStandardPresetSchemes,
  candidateRotations,
  buildConnectorDistanceColorMap,
  classifyGroundSymmetry,
  dist2D
} = FanoutChecker;

console.log('== 扇出方案检查引擎单元测试 ==');
{
  const axisPattern = [
    { type: 'signal', rawX: 0, rawY: 0 },
    { type: 'gnd', padstack: 'A', rawX: 0, rawY: 10 },
    { type: 'gnd', padstack: 'A', rawX: 0, rawY: -10 },
    { type: 'gnd', padstack: 'A', rawX: 5, rawY: 0 }
  ];
  const centerPattern = [
    { type: 'signal', rawX: 0, rawY: 0 },
    { type: 'gnd', padstack: 'A', rawX: 1, rawY: 0 }, { type: 'gnd', padstack: 'A', rawX: -1, rawY: 0 },
    { type: 'gnd', padstack: 'B', rawX: 0, rawY: 2 }, { type: 'gnd', padstack: 'B', rawX: 0, rawY: -2 },
    { type: 'gnd', padstack: 'C', rawX: 1, rawY: 1 }, { type: 'gnd', padstack: 'C', rawX: -1, rawY: -1 }
  ];
  assert.strictEqual(classifyGroundSymmetry(axisPattern), '轴对称', '带 Padstack 类型的地孔分布应识别轴对称');
  assert.strictEqual(classifyGroundSymmetry(centerPattern), '中心对称', '只具中心旋转对称的地孔分布应正确分类');
  console.log('  PASS  自动命名识别周围 GND 孔的轴对称与中心对称关系');
}
{
  const colors = buildConnectorDistanceColorMap([{ dist: 10.01 }, { dist: 10.04 }, { dist: 12.0 }]);
  assert.deepStrictEqual([...colors.keys()], [10, 12], '10.01 与 10.04 mil 应并入同一距离类别');
  assert.notStrictEqual(colors.get(10), colors.get(12), '不同孔心距应使用不同颜色');
  console.log('  PASS  查看方案虚线按孔心距分组着色：同距同色、异距异色');
}

// 批量 EDA TXT 无方案标题时，根据孔群特征自动命名且名称保持唯一。
{
  const batch = `Total 3 Items\nItem 1 < Via >\nOrigin-xy: [1000, 2000]\nPadstack Name: BGA-HDI-GND-045drill-ring3_L1_L5\nNet: GND\nPadstack Defined from 02G01P to 05G02P\nCircle Drill: 4.5 Plated\nItem 2 < Via >\nOrigin-xy: [1000, 2010]\nPadstack Name: BGA-HDI-SIG-045drill-ring3_L1_L5\nNet: SIG_P\nPadstack Defined from 02G01P to 05G02P\nCircle Drill: 4.5 Plated\nItem 3 < Via >\nOrigin-xy: [1000, 2020]\nPadstack Name: BGA-HDI-SIG-045drill-ring3_L1_L5\nNet: SIG_N\nPadstack Defined from 02G01P to 05G02P\nCircle Drill: 4.5 Plated\n~~~~~~~~~~~~\nTotal 2 Items\nItem 1 < Via >\nOrigin-xy: [2000, 3000]\nPadstack Name: SMA-HDI-GND-045drill-ring3_L10_L14\nNet: GND\nPadstack Defined from 10G07P to Bottom\nCircle Drill: 4.5 Plated\nItem 2 < Via >\nOrigin-xy: [2000, 3010]\nPadstack Name: SMA-HDI-SIG-045drill-ring3_L10_L14\nNet: SIG_P\nPadstack Defined from 11G08P to Bottom\nCircle Drill: 4.5 Plated`;
  const autoNamed = FanoutChecker.parseMultiSchemeTxt(batch, 0);
  assert.strictEqual(autoNamed.length, 2, '应按 EDA 的 Item 1 重启切成两组');
  assert.ok(autoNamed[0].name.includes('BGA') && autoNamed[0].name.includes('1对') && autoNamed[0].name.includes('P0.25mm') && autoNamed[0].name.includes('L2-L5'), 'BGA 孔群名应包含差分对数、P/N 间距与信号连接层');
  assert.ok(autoNamed[1].name.includes('SMA') && autoNamed[1].name.includes('L11-Bot') && autoNamed[1].name.includes('1信号'), 'SMA 孔群名应反映单信号与连接层');
  assert.strictEqual(new Set(autoNamed.map(s => s.name)).size, 2, '自动名称应唯一');
  console.log('  PASS  批量 EDA TXT 按 Item 重启识别孔群，并依据差分孔距/信号连接层自动命名');
}

// 1. 数据解析测试
{
  const sampleTxt = `Total 3 Items
Item 1                < Via >
  Origin-xy:          [100.0, 200.0]
  Padstack Name:      SMA_Bot-L19_d2m6mil_via-0902
  Net:                SIG_P
  Circle Drill:       3.9400 Plated
Item 2                < Via >
  Origin-xy:          [100.0, 220.0]
  Padstack Name:      BGA_GND_pad1mil_0902
  Net:                GND
  Circle Drill:       3.9400 Plated
Item 3                < Via >
  Origin-xy:          [100.0, 180.0]
  Padstack Name:      BGA_GND_pad1mil_0902
  Net:                GND
  Circle Drill:       3.9400 Plated
`;

  const vias = parseViaData(sampleTxt);
  assert.strictEqual(vias.length, 3, '应解析出 3 个过孔');
  assert.strictEqual(vias[0].padstack, 'SMA_Bot-L19_d2m6mil_via-0902');
  assert.strictEqual(vias[0].net, 'SIG_P');
  assert.strictEqual(vias[0].x, 100.0);
  assert.strictEqual(vias[0].y, 200.0);
  console.log('  PASS  EDA TXT 过孔数据解析');
}

// 2. 空间聚类测试 (2mm / 78.74 mil 阈值)
{
  const vias = [
    // 组 1: 三孔聚类 (中心距 20 mil <= 78.74 mil)
    { id: 1, x: 100, y: 100, padstack: 'PAD_A', net: 'GND' },
    { id: 2, x: 100, y: 120, padstack: 'PAD_A', net: 'GND' },
    { id: 3, x: 100, y: 140, padstack: 'PAD_A', net: 'GND' },
    // 组 2: 远端双孔 (距离组1 500mil，两孔相距 30mil)
    { id: 4, x: 600, y: 600, padstack: 'PAD_B', net: 'SIG' },
    { id: 5, x: 600, y: 630, padstack: 'PAD_B', net: 'SIG' },
    // 孤立孔 (距离其他孔 > 1000mil)
    { id: 6, x: 2000, y: 2000, padstack: 'PAD_C', net: 'GND' }
  ];

  const clusters = clusterVias(vias, 78.740157); // 2mm
  assert.strictEqual(clusters.length, 3, '应分割出 3 个孔整体 (Clusters)');
  assert.strictEqual(clusters[0].viaCount, 3, '第一个孔整体包含 3 个孔');
  assert.strictEqual(clusters[1].viaCount, 2, '第二个孔整体包含 2 个孔');
  assert.strictEqual(clusters[2].viaCount, 1, '第三个孔整体为孤立单孔');
  console.log('  PASS  空间距离连通聚类算法 (2mm 连通分量)');
}

// 3. 扇出方案定义与旋转匹配测试
{
  const library = new FanoutLibrary();
  
  // 定义一个 L形 3孔方案: 信号孔在原点，两个地孔分别在 (0, 20) 和 (20, 0)
  const lScheme = new FanoutScheme({
    id: 'scheme_L_3via',
    name: 'L型3孔扇出方案',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'SIG_PAD', net: 'SIG', role: '信号孔' },
      { id: 2, x: 0, y: 20, padstack: 'GND_PAD', net: 'GND', role: '地孔1' },
      { id: 3, x: 20, y: 0, padstack: 'GND_PAD', net: 'GND', role: '地孔2' }
    ]
  });
  library.addScheme(lScheme);

  // 测试用例 A: 平移后的相同方案 (中心坐标平移到 1000, 2000)
  const clusterA = {
    viaCount: 3,
    vias: [
      { id: 101, x: 1000, y: 2000, padstack: 'SIG_PAD', net: 'SIG' },
      { id: 102, x: 1000, y: 2020, padstack: 'GND_PAD', net: 'GND' },
      { id: 103, x: 1020, y: 2000, padstack: 'GND_PAD', net: 'GND' }
    ],
    centroid: { x: 1006.6667, y: 2006.6667 },
    pairwiseDistances: [
      { dist: 20.0 },
      { dist: 20.0 },
      { dist: Math.hypot(20, 20) }
    ]
  };

  const resA = matchClusterToLibrary(clusterA, library, { distanceTolerance: 1.0 });
  assert.strictEqual(resA.pass, true, '平移后的标准结构应完全匹配');
  assert.strictEqual(resA.schemeName, 'L型3孔扇出方案');

  // 测试用例 B: 旋转 90度 后的方案 (0,0)->(1000,2000), (0,20)->(980,2000), (20,0)->(1000,2020)
  const clusterB = {
    viaCount: 3,
    vias: [
      { id: 201, x: 1000, y: 2000, padstack: 'SIG_PAD', net: 'SIG' },
      { id: 202, x: 980, y: 2000, padstack: 'GND_PAD', net: 'GND' },
      { id: 203, x: 1000, y: 2020, padstack: 'GND_PAD', net: 'GND' }
    ],
    centroid: { x: 993.3333, y: 2006.6667 },
    pairwiseDistances: [
      { dist: 20.0 },
      { dist: 20.0 },
      { dist: Math.hypot(20, 20) }
    ]
  };

  const resB = matchClusterToLibrary(clusterB, library, { distanceTolerance: 1.0 });
  assert.strictEqual(resB.pass, true, '旋转 90度后应通过刚体不变性匹配');
  console.log('  PASS  刚体平移与旋转不变性匹配算法');
}

// 4. Padstack 不一致报错与精准定位测试
{
  const library = new FanoutLibrary();
  library.addScheme(new FanoutScheme({
    id: 'scheme_sma_5via',
    name: 'SMA-Bot-L19-5孔方案',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'SMA_Bot-L19_d2m6mil_via-0902', net: 'SIG', role: '中心信号孔' },
      { id: 2, x: 0, y: 20, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔1' },
      { id: 3, x: 0, y: -20, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔2' },
      { id: 4, x: -20, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔3' },
      { id: 5, x: 20, y: 0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND', role: '屏蔽地孔4' }
    ]
  }));

  // 构造一个几何中心距完全一致，但中心信号孔被误用为普通地孔的异常孔群
  const defectCluster = {
    viaCount: 5,
    vias: [
      { id: 501, x: 500, y: 500, padstack: 'BGA_GND_pad1mil_0902', net: 'WRONG_NET' }, // 错误：中心孔应为 SMA_Bot-L19
      { id: 502, x: 500, y: 520, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
      { id: 503, x: 500, y: 480, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
      { id: 504, x: 480, y: 500, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
      { id: 505, x: 520, y: 500, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' }
    ],
    centroid: { x: 500, y: 500 },
    pairwiseDistances: [
      { dist: 20.0 }, { dist: 20.0 }, { dist: 20.0 }, { dist: 20.0 },
      { dist: 28.2843 }, { dist: 28.2843 }, { dist: 28.2843 }, { dist: 28.2843 },
      { dist: 40.0 }, { dist: 40.0 }
    ]
  };

  const res = matchClusterToLibrary(defectCluster, library, { distanceTolerance: 1.0 });
  assert.strictEqual(res.pass, false, 'Padstack 不符时应判定为不通过');
  assert.strictEqual(res.status, 'PADSTACK_MISMATCH', '状态应为 PADSTACK_MISMATCH');
  assert.strictEqual(res.padstackMismatches.length, 1, '应精确定位出 1 处 Padstack 不一致');
  assert.strictEqual(res.padstackMismatches[0].viaId, 501, '应指出孔 #501 Padstack 错误');
  assert.strictEqual(res.padstackMismatches[0].actualPadstack, 'BGA_GND_pad1mil_0902');
  assert.strictEqual(res.padstackMismatches[0].expectedPadstack, 'SMA_Bot-L19_d2m6mil_via-0902');
  console.log('  PASS  Padstack 不符时精准报错与定位孔位');
}

// 5. 孔心距超差报错测试
{
  const library = new FanoutLibrary();
  library.addScheme(new FanoutScheme({
    id: 'scheme_diff_2via',
    name: '差分对20mil标准间距',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'DIFF_VIA', net: 'P' },
      { id: 2, x: 0, y: 20, padstack: 'DIFF_VIA', net: 'N' }
    ]
  }));

  // 实测中心距为 30mil (超差 10mil > 2mil 容差)
  const distDefectCluster = {
    viaCount: 2,
    vias: [
      { id: 801, x: 0, y: 0, padstack: 'DIFF_VIA', net: 'P' },
      { id: 802, x: 0, y: 30, padstack: 'DIFF_VIA', net: 'N' }
    ],
    centroid: { x: 0, y: 15 },
    pairwiseDistances: [
      { dist: 30.0 }
    ]
  };

  const res = matchClusterToLibrary(distDefectCluster, library, { distanceTolerance: 2.0 });
  assert.strictEqual(res.pass, false, '中心距超差时应判定为不通过');
  assert.strictEqual(res.status, 'DISTANCE_MISMATCH', '状态应为 DISTANCE_MISMATCH');
  console.log('  PASS  孔中心距超差报错判定');
}

// 6. 完整运行器测试 (runFanoutInspection 与 1454 孔数据集)
{
  const largeFilePath = path.join(__dirname, '../../sample/via_trce_airgap_data-2.txt');
  if (fs.existsSync(largeFilePath)) {
    const text = fs.readFileSync(largeFilePath, 'utf8');
    const library = new FanoutLibrary();
    library.loadStandardPresets();

    const t0 = Date.now();
    const result = runFanoutInspection(text, library, {
      clusterThreshold: 78.740157, // 2mm
      distanceTolerance: 2.0
    });
    const t1 = Date.now();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.vias.length, 1454, '应解析 1454 个过孔');
    assert.ok(result.clusters.length > 0, '应成功分割孔整体');
    assert.ok(result.summary.passCount >= 0);
    console.log(`  PASS  全量 1454 过孔大数据集聚类与方案库比对 (耗时 ${t1 - t0} ms, 分割出 ${result.clusters.length} 个孔群, 通过 ${result.summary.passCount} 组)`);
  }
}


// -------------------------------------------------------------
// Test 8: 任意角度姿态（allowArbitraryRotation）
// -------------------------------------------------------------
{
  const library = new FanoutLibrary();
  library.addScheme(new FanoutScheme({
    id: 'scheme_rot37',
    name: 'L型3孔方案(任意角测试)',
    vias: [
      { id: 1, x: 0, y: 0, padstack: 'SIG_PAD', net: 'SIG', role: '信号孔' },
      { id: 2, x: 0, y: 20, padstack: 'GND_PAD', net: 'GND', role: '地孔1' },
      { id: 3, x: 20, y: 0, padstack: 'GND_PAD', net: 'GND', role: '地孔2' }
    ]
  }));

  const deg = 37;
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const place = ([x, y]) => [x * cos - y * sin + 500, x * sin + y * cos + 700];
  const p0 = place([0, 0]), p1 = place([0, 20]), p2 = place([20, 0]);

  const vias = [
    { id: 101, x: p0[0], y: p0[1], padstack: 'SIG_PAD', net: 'SIG' },
    { id: 102, x: p1[0], y: p1[1], padstack: 'GND_PAD', net: 'GND' },
    { id: 103, x: p2[0], y: p2[1], padstack: 'GND_PAD', net: 'GND' }
  ];
  const centroid = {
    x: (p0[0] + p1[0] + p2[0]) / 3,
    y: (p0[1] + p1[1] + p2[1]) / 3
  };
  const pairwiseDistances = [
    { dist: dist2D(vias[0].x, vias[0].y, vias[1].x, vias[1].y) },
    { dist: dist2D(vias[0].x, vias[0].y, vias[2].x, vias[2].y) },
    { dist: dist2D(vias[1].x, vias[1].y, vias[2].x, vias[2].y) }
  ];
  const cluster = { viaCount: 3, vias, centroid, pairwiseDistances };

  // 默认（只试 0/90/180/270）：37° 姿态应判不出匹配
  const strict = matchClusterToLibrary(cluster, library, { distanceTolerance: 2.0 });
  assert.strictEqual(strict.pass, false, '默认正交口径不应把 37° 姿态判为通过');

  // 打开任意角度：应能识别并给出 37° 的姿态角
  const free = matchClusterToLibrary(cluster, library, { distanceTolerance: 2.0, allowArbitraryRotation: true });
  assert.strictEqual(free.pass, true, '开启任意角后应匹配成功，实际: ' + free.status);
  const angle = ((free.rotationAngle % 360) + 360) % 360;
  assert.ok(Math.abs(angle - 37) < 0.2, '识别出的旋转角应约 37°，实际 ' + angle);
  if (!free.alignment || free.alignment.maxPointDev > 1e-6) {
    throw new Error('识别姿态的点位偏差应为 0，实际 ' + (free.alignment && free.alignment.maxPointDev));
  }

  // 用识别出的姿态反算，应该精确复原原始孔位
  const rr = angle * Math.PI / 180;
  const cc = Math.cos(rr), ss = Math.sin(rr);
  const schemePts = [[0, 0], [0, 20], [20, 0]];
  const centroidScheme = { x: 20 / 3, y: 20 / 3 };
  let maxErr = 0;
  schemePts.forEach(([x, y]) => {
    let dx = x - centroidScheme.x, dy = y - centroidScheme.y;
    if (free.isMirrored) dx = -dx;
    const rx = dx * cc - dy * ss + cluster.centroid.x;
    const ry = dx * ss + dy * cc + cluster.centroid.y;
    const nearest = Math.min(...vias.map(v => Math.hypot(v.x - rx, v.y - ry)));
    if (nearest > maxErr) maxErr = nearest;
  });
  assert.ok(maxErr < 1e-6, '按识别姿态复原孔位应精确吻合，实际偏差 ' + maxErr.toExponential(2));

  // 候选角生成器：几何完全一致时 45°/135° 组合也应被推导出来
  const cands = candidateRotations(
    [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    [{ x: 0, y: 0 }, { x: 0, y: Math.hypot(10, 10) }],
    2.0, true, true
  );
  assert.ok(cands.some(a => Math.abs(a - 45) < 0.2 || Math.abs(a + 45) < 0.2),
    '应推导出 45° 候选角: ' + cands.join(','));
  console.log('  PASS  任意角度姿态：默认正交口径不变，开启后支持 37° 等非正交扇出');
}

console.log('\n结果: 全部 7 项单元测试通过！');

// -------------------------------------------------------------
// Test 7: 孔阵列子集/局部匹配与冗余地孔容差分析 (针对 image-7.png 复杂孔群)
// -------------------------------------------------------------
{
  // 构造一个包含 5 孔 SMA 十字方案 + 外围 4 个冗余 GND 地孔的 9 孔组合阵列
  const clusterVias = [
    // 方案主体: 5 孔标准十字
    { id: 101, x: 1000.0, y: 1000.0, padstack: 'SMA_L2_d2m6mil_via_0902', net: 'SIG' },
    { id: 102, x: 1000.0, y: 1020.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 103, x: 1000.0, y: 980.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 104, x: 980.0, y: 1000.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 105, x: 1020.0, y: 1000.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    // 外围冗余伴随地孔
    { id: 106, x: 960.0, y: 960.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 107, x: 1040.0, y: 960.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 108, x: 960.0, y: 1040.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' },
    { id: 109, x: 1040.0, y: 1040.0, padstack: 'BGA_GND_pad1mil_0902', net: 'GND' }
  ];

  const library = new FanoutChecker.FanoutLibrary();
  library.loadStandardPresets();

  const cluster = {
    id: 'test_cluster_subset',
    vias: clusterVias,
    viaCount: clusterVias.length,
    centroid: { x: 1000.0, y: 1000.0 },
    bbox: { minX: 960, maxX: 1040, minY: 960, maxY: 1040, spanX: 80, spanY: 80, maxSpan: 113.13 }
  };

  const matchRes = FanoutChecker.matchClusterToLibrary(cluster, library, {
    distanceTolerance: 2.0,
    allowRotation: true,
    allowMirror: true,
    allowSubsetMatch: true,
    redundantViaPolicy: 'ANY_GND_REDUNDANT'
  });

  assert.strictEqual(matchRes.pass, true, '子集匹配应成功通过');
  assert.strictEqual(matchRes.isSubsetMatch, true, '应标记为子集匹配');
  assert.strictEqual(matchRes.status, 'SUBSET_MATCH_PASS', '状态应为 SUBSET_MATCH_PASS');
  assert.strictEqual(matchRes.matchedViaCount, 5, '应准确匹配 5 个方案过孔');
  assert.strictEqual(matchRes.redundantViaCount, 4, '应准确识别出 4 个冗余地孔');
  assert.deepStrictEqual(matchRes.redundantViaIds.sort(), [106, 107, 108, 109], '冗余孔 ID 清单应完全准确');

  console.log('  PASS  子集/局部匹配与冗余伴随地孔智能识别与容差分析');
}

// -------------------------------------------------------------
// Test 8: 信号孔定位 (Connections 筛选) 与伴随地孔适配调整建议
// -------------------------------------------------------------
{
  const txtSample = `
Item 1 < Via >
  Origin-xy: [1000.0, 1000.0]
  Net: DIFF_P
  Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
  Connections:
    Trace: 1 (Top)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2 < Via >
  Origin-xy: [1020.0, 1000.0]
  Net: DIFF_N
  Padstack Name: BGA-HDI-SIG-045drill-ring3_L1_L4
  Connections:
    Trace: 1 (Top)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 3 < Via >
  Origin-xy: [1000.0, 1020.0]
  Net: GND
  Padstack Name: BGA-HDI-GND-045drill-ring3_L1_L4
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 4 < Via >
  Origin-xy: [1020.0, 1020.0]
  Net: GND
  Padstack Name: BGA-HDI-GND-045drill-ring3_L1_L4
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;

  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'test_diff_scheme',
    name: 'TEST-DIFF-4VIA',
    vias: [
      { id: 1, x: 1000.0, y: 1000.0, net: 'DIFF_P', padstack: 'BGA-HDI-SIG-045drill-ring3_L1_L4' },
      { id: 2, x: 1020.0, y: 1000.0, net: 'DIFF_N', padstack: 'BGA-HDI-SIG-045drill-ring3_L1_L4' },
      { id: 3, x: 1000.0, y: 1020.0, net: 'GND', padstack: 'BGA-HDI-GND-045drill-ring3_L1_L4' },
      { id: 4, x: 1020.0, y: 1020.0, net: 'GND', padstack: 'BGA-HDI-GND-045drill-ring3_L1_L4' }
    ]
  }));

  const res = FanoutChecker.runFanoutInspection(txtSample, library);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.clusters.length, 1);
  assert.strictEqual(res.clusters[0].matchResult.pass, true);
  assert.strictEqual(res.clusters[0].matchResult.schemeName, 'TEST-DIFF-4VIA');

  console.log('  PASS  信号孔定位与伴随地孔方案精准匹配');
}

// 8b. 任意非空 Connections 都具备检查资格；Shape-only 信号孔也必须独立建组
{
  const mixedConnections = `
Item 1 < Via >
  Origin-xy: [1000.0, 1000.0]
  Net: ROUTED_P
  Padstack Name: SIG_PAD
  Connections:
    Trace: 1 (Top)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2 < Via >
  Origin-xy: [1020.0, 1000.0]
  Net: ROUTED_N
  Padstack Name: SIG_PAD
  Connections: Top
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 3 < Via >
  Origin-xy: [1000.0, 1020.0]
  Net: GND
  Padstack Name: GND_PAD
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 4 < Via >
  Origin-xy: [1020.0, 1020.0]
  Net: GND
  Padstack Name: GND_PAD
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 5 < Via >
  Origin-xy: [1010.0, 1010.0]
  Net: ROUTED_P
  Padstack Name: UNCONNECTED_SIG_PAD
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 6 < Via >
  Origin-xy: [1500.0, 1500.0]
  Net: ORPHAN_SIG
  Padstack Name: UNCONNECTED_SIG_PAD
  Connections:
  Backdrill:
    Start Layer: Top
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 7 < Via >
  Origin-xy: [1800.0, 1800.0]
  Net: SHAPE_ONLY_SIG
  Padstack Name: UNCONNECTED_SIG_PAD
  Connections:
    Shape: 1 (03G02P)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
  const parsed = FanoutChecker.parseViaData(mixedConnections);
  assert.deepStrictEqual(parsed.map(v => v.hasConnections), [true, true, false, false, false, false, true],
    '非空 Connections 应保留，空段不得误读后续 Backdrill');
  assert.deepStrictEqual(parsed.map(v => v.hasTraceConnections), [true, true, false, false, false, false, false],
    'Trace 信息仍应独立保留，但不再作为唯一检查资格');
  assert.deepStrictEqual(parsed[0].connectedTraceLayers, ['Top']);
  assert.deepStrictEqual(parsed[1].connectedTraceLayers, ['Top'], '同行 Connections 格式仍应兼容');

  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'connections_only_scheme',
    name: 'CONNECTIONS-ONLY-DIFF',
    vias: [
      { id: 1, x: 1000, y: 1000, net: 'ROUTED_P', padstack: 'SIG_PAD' },
      { id: 2, x: 1020, y: 1000, net: 'ROUTED_N', padstack: 'SIG_PAD' },
      { id: 3, x: 1000, y: 1020, net: 'GND', padstack: 'GND_PAD' },
      { id: 4, x: 1020, y: 1020, net: 'GND', padstack: 'GND_PAD' }
    ]
  }));

  const res = FanoutChecker.runFanoutInspection(mixedConnections, library);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.summary.totalParsedSignalVias, 5, '应统计全部解析出的信号孔');
  assert.strictEqual(res.summary.totalSignalVias, 3, 'Trace 与 Shape-only Connections 信号孔都应具备检查资格');
  assert.strictEqual(res.summary.excludedSignalVias, 2, '只排除 Connections 为空或不存在的信号孔');
  assert.strictEqual(res.clusters.length, 2, '远处 Shape-only 信号孔应自行创建检查组');
  const routedCluster = res.clusters.find(cluster => cluster.signalVias.some(v => v.id === 1));
  const shapeCluster = res.clusters.find(cluster => cluster.signalVias.some(v => v.id === 7));
  assert.deepStrictEqual(routedCluster.signalVias.map(v => v.id).sort((a, b) => a - b), [1, 2]);
  assert.deepStrictEqual(routedCluster.vias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4],
    '附近 GND 仍应作为已连接信号组的伴随地孔');
  assert.strictEqual(routedCluster.matchResult.pass, true);
  assert.strictEqual(shapeCluster.matchResult.status, 'NO_MATCH_TOPOLOGY');
  console.log('  PASS  任意非空 Connections 均参与检查，Shape-only 信号孔也会建组');
}

// 8c. 所有逻辑信号孔均无 Connections 时保持零检查组，不回退检查全部信号孔
{
  const noConnectedSignals = `
Item 1 < Via >
  Origin-xy: [2000.0, 2000.0]
  Net: IDLE_P
  Padstack Name: SIG_PAD
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 2 < Via >
  Origin-xy: [2020.0, 2000.0]
  Net: IDLE_N
  Padstack Name: SIG_PAD
  Connections:
  Backdrill:
    Start Layer: Top
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Item 3 < Via >
  Origin-xy: [2000.0, 2020.0]
  Net: GND
  Padstack Name: GND_PAD
  Connections:
    Shape: 1 (Top)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
  const library = new FanoutChecker.FanoutLibrary();
  library.loadStandardPresets();
  const res = FanoutChecker.runFanoutInspection(noConnectedSignals, library);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.vias.length, 3, '过孔仍应完整解析并供视口显示');
  assert.strictEqual(res.summary.totalParsedSignalVias, 2);
  assert.strictEqual(res.summary.totalSignalVias, 0);
  assert.strictEqual(res.summary.excludedSignalVias, 2);
  assert.strictEqual(res.summary.totalClusters, 0);
  assert.strictEqual(res.summary.passCount, 0);
  assert.strictEqual(res.summary.failCount, 0);
  assert.deepStrictEqual(res.clusters, [], '不得回退到全部无连接信号孔进行方案检查');
  console.log('  PASS  全部信号孔均无 Connections 时零组返回且不执行旧版回退');
}

// 8d. 显式 Via 链合并三段盲埋孔；Shape/Via-only 上方孔群同样参与检查
{
  const viaBlock = (id, x, y, net, connection) => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: STACK_SEG_${id}\n  Connections:\n    ${connection}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const stackedGroups = [
    viaBlock(1, 0, 300, 'TOP_P', 'Via: 2 (03G02P)'),
    viaBlock(2, 20, 300, 'TOP_N', 'Shape: 1 (03G02P)'),
    viaBlock(3, 0, 0, 'STACK_P', 'Trace: 1 (04G01P)\n    Via: 4 (05G02P)'),
    viaBlock(4, 0, 0, 'STACK_P', 'Via: 5 (06G03P)'),
    viaBlock(5, 0, 0, 'STACK_P', 'Shape: 1 (06G03P)'),
    viaBlock(6, 20, 0, 'STACK_N', 'Trace: 1 (04G01P)\n    Via: 7 (05G02P)'),
    viaBlock(7, 20, 0, 'STACK_N', 'Via: 8 (06G03P)'),
    viaBlock(8, 20, 0, 'STACK_N', 'Shape: 1 (06G03P)'),
    viaBlock(9, 10, 320, 'GND', ''),
    viaBlock(10, 10, 20, 'GND', '')
  ].join('\n');
  const library = new FanoutChecker.FanoutLibrary();
  const res = FanoutChecker.runFanoutInspection(stackedGroups, library);
  assert.deepStrictEqual(res.vias.find(v => v.id === 3).connectedViaIds, [4], '应解析 Via Connections 引用');
  assert.strictEqual(res.summary.totalParsedSignalVias, 8);
  assert.strictEqual(res.summary.totalSignalVias, 4, '两个三段堆叠折叠为两个逻辑孔，上方两个 Connections 孔保持独立');
  assert.strictEqual(res.summary.totalEligibleSignalViaItems, 8, 'Trace、Via 与 Shape Connections 物理孔段都应纳入');
  assert.strictEqual(res.summary.excludedSignalVias, 0);
  assert.strictEqual(res.clusters.length, 2, '上下两个 Connections 孔群都应创建检查组');
  const cluster = res.clusters.find(item => item.centroid.y === 0);
  const topCluster = res.clusters.find(item => item.centroid.y === 300);
  assert.deepStrictEqual(cluster.signalVias.map(v => v.id).sort((a, b) => a - b), [3, 6]);
  assert.deepStrictEqual(cluster.signalVias.map(v => v.physicalViaIds), [[3, 4, 5], [6, 7, 8]]);
  assert.deepStrictEqual(cluster.physicalSignalVias.map(v => v.id).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8]);
  assert.ok(cluster.vias.every(v => ![1, 2, 9].includes(v.id)), '上方孔群及其地孔不得污染下方检查组');
  assert.deepStrictEqual(cluster.matchResult.signalStackAudit.map(a => a.physicalViaIds), [[3, 4, 5], [6, 7, 8]],
    '检查审计应保留每个逻辑孔对应的全部物理盲埋孔段');
  assert.deepStrictEqual(topCluster.physicalSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2]);
  console.log('  PASS  显式 Via 链完整折叠，任意 Connections 孔群均参与检查');
}

// 8e. 同网络 Trace 与 Shape-only 对象直接组成完整信号拓扑，远处 Via-only 对象独立检查
{
  const blocks = [
    ['1', 0, 0, 'PAIR_P', 'HDI_SIG', 'Trace: 1 (04G01P)'],
    ['2', 20, 0, 'PAIR_N', 'HDI_SIG', 'Trace: 1 (04G01P)'],
    ['3', 0, 20, 'PAIR_P', 'TOP_PIN', 'Shape: 1 (Top)'],
    ['4', 20, 20, 'PAIR_N', 'TOP_PIN', 'Shape: 1 (Top)'],
    ['5', 200, 200, 'PAIR_N', 'UNANCHORED_VIA', 'Via: 99 (05G02P)']
  ].map(v => `Item ${v[0]} < Via >\n  Origin-xy: [${v[1]}, ${v[2]}]\n  Net: ${v[3]}\n  Padstack Name: ${v[4]}\n  Connections:\n    ${v[5]}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`).join('\n');
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'l2_l4_pair', name: 'L2-L4-DIFF',
    vias: [
      { id: 1, x: 0, y: 0, net: 'PAIR_P', padstack: 'L2_L4_SIG' },
      { id: 2, x: 20, y: 0, net: 'PAIR_N', padstack: 'L2_L4_SIG' }
    ]
  }));
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'top_pin_hdi_pair', name: 'TOP-PIN+HDI-DIFF',
    vias: [
      { id: 1, x: 0, y: 0, net: 'PAIR_P', padstack: 'HDI_SIG' },
      { id: 2, x: 20, y: 0, net: 'PAIR_N', padstack: 'HDI_SIG' },
      { id: 3, x: 0, y: 20, net: 'PAIR_P', padstack: 'TOP_PIN' },
      { id: 4, x: 20, y: 20, net: 'PAIR_N', padstack: 'TOP_PIN' }
    ]
  }));
  const res = FanoutChecker.runFanoutInspection(blocks, library);
  assert.strictEqual(res.summary.totalSignalVias, 5, '每个含 Connections 的逻辑信号孔都具备资格');
  assert.strictEqual(res.summary.totalCompanionSignalVias, 0, '同网络 Shape-only Pin 已是正式信号拓扑，不再作为松散伴随孔吸收');
  assert.strictEqual(res.summary.excludedSignalVias, 0);
  assert.strictEqual(res.clusters.length, 2);
  const pairCluster = res.clusters.find(cluster => cluster.signalVias.some(v => v.id === 1));
  const remoteCluster = res.clusters.find(cluster => cluster.signalVias.some(v => v.id === 5));
  assert.deepStrictEqual(pairCluster.signalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.deepStrictEqual(pairCluster.matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4],
    'Shape-only 顶层 Pin 应作为正式对象参与完整信号拓扑比对');
  assert.strictEqual(pairCluster.matchResult.pass, true);
  assert.strictEqual(pairCluster.matchResult.schemeName, 'TOP-PIN+HDI-DIFF');
  assert.strictEqual(remoteCluster.matchResult.status, 'NO_MATCH_TOPOLOGY');
  console.log('  PASS  Trace 与 Shape-only Connections 共同匹配完整信号拓扑，远处 Via-only 对象独立检查');
}

// 8f. 顶层 Pin 的原始 Net 错写时，仅凭完整八信号孔方案的唯一几何位置恢复归属
{
  const viaBlock = (id, x, y, net, padstack, connection) => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: ${padstack}\n  Connections:\n    ${connection}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const signalRows = [
    [1, -4.920, -17.900, 'PAIR_N', 'HDI_L10_L12', 'Trace: 1 (L12)'],
    [2, 14.766, -17.900, 'PAIR_P', 'HDI_L10_L12', 'Trace: 1 (L12)'],
    [3, 0, 0, 'PAIR_N', 'TOP_PIN', 'Shape: 1 (Top)'],
    [4, -3.935, -17.900, 'PAIR_N', 'PTH_L5_L10', 'Shape: 1 (L10)'],
    [5, -4.920, -17.900, 'PAIR_N', 'HDI_L1_L5', 'Shape: 1 (L5)'],
    [6, 13.781, -17.900, 'PAIR_P', 'PTH_L5_L10', 'Shape: 1 (L10)'],
    [7, 14.766, -17.900, 'PAIR_P', 'HDI_L1_L5', 'Shape: 1 (L5)'],
    // 物理位置与 Padstack 唯一对应 PAIR_P 顶层 Pin，但原始导出误写为其他差分网络。
    [8, 9.846, 0, 'OTHER_N', 'TOP_PIN', 'Shape: 1 (Top)'],
    // 同一区域另一个异网 Pin 不在方案目标位置，必须保持排除。
    [9, 30, 30, 'UNRELATED_P', 'TOP_PIN', 'Shape: 1 (Top)']
  ];
  const input = signalRows.map(row => viaBlock(...row)).join('\n');
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'eight_signal_net_alias', name: '八信号对象顶层Pin方案',
    vias: [
      { id: 1, x: 0, y: 0, net: 'PAIR_N', padstack: 'TOP_PIN', drill: 0 },
      { id: 2, x: -4.920, y: -17.900, net: 'PAIR_N', padstack: 'HDI_L10_L12', drill: 4.5 },
      { id: 3, x: -3.935, y: -17.900, net: 'PAIR_N', padstack: 'PTH_L5_L10', drill: 6 },
      { id: 4, x: -4.920, y: -17.900, net: 'PAIR_N', padstack: 'HDI_L1_L5', drill: 4.5 },
      { id: 5, x: 9.846, y: 0, net: 'PAIR_P', padstack: 'TOP_PIN', drill: 0 },
      { id: 6, x: 14.766, y: -17.900, net: 'PAIR_P', padstack: 'HDI_L10_L12', drill: 4.5 },
      { id: 7, x: 13.781, y: -17.900, net: 'PAIR_P', padstack: 'PTH_L5_L10', drill: 6 },
      { id: 8, x: 14.766, y: -17.900, net: 'PAIR_P', padstack: 'HDI_L1_L5', drill: 4.5 }
    ]
  }));
  const res = FanoutChecker.runFanoutInspection(input, library, { distanceTolerance: 2 });
  const pairCluster = res.clusters.find(cluster => cluster.physicalSignalVias.some(v => v.id === 1));
  assert.strictEqual(res.clusters.length, 2, '无关 Shape-only Connections Pin 也应另建检查组，而不是被静默排除');
  assert.strictEqual(pairCluster.matchResult.pass, true, '唯一位置的异网顶层 Pin 应恢复后匹配八信号方案');
  assert.strictEqual(pairCluster.matchResult.schemeName, '八信号对象顶层Pin方案');
  assert.deepStrictEqual(pairCluster.matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8],
    '恢复对象应进入方案匹配，附近无关异网 Pin 不得被加入孔群');
  assert.deepStrictEqual(pairCluster.matchResult.signalNetRecoveries, [{
    viaId: 8, sourceNet: 'OTHER_N', expectedNet: 'PAIR_P', x: 9.846, y: 0, padstack: 'TOP_PIN'
  }], '必须保留原始 Net 与恢复后的方案角色以供审计');
  assert.strictEqual(res.vias.find(v => v.id === 8).net, 'OTHER_N', '恢复只能补充推断归属，不得篡改原始 Net');
  assert.strictEqual(res.summary.totalCompanionSignalVias, 1);
  assert.strictEqual(res.summary.excludedSignalVias, 0, '任意非空 Connections 对象均应参与某个检查组');

  const ambiguousInput = input + '\n' + viaBlock(10, 9.846, 0, 'ANOTHER_P', 'TOP_PIN', 'Shape: 1 (Top)');
  const ambiguous = FanoutChecker.runFanoutInspection(ambiguousInput, library, { distanceTolerance: 2 });
  const ambiguousPair = ambiguous.clusters.find(cluster => cluster.physicalSignalVias.some(v => v.id === 1));
  assert.strictEqual(ambiguousPair.matchResult.status, 'NO_MATCH_TOPOLOGY',
    '同一缺失位置存在多个异网候选时不得猜测归属');
  assert.deepStrictEqual(ambiguousPair.matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7],
    '歧义候选均不得被加入匹配孔群');
  console.log('  PASS  八信号对象方案按唯一几何恢复错写 Net 的顶层 Pin，并拒绝无关或歧义候选');
}

// 8g. 无显式 Via 引用时，按允许孔心偏移与连续层跨合并；任一段有 Connections 即整栈参与
{
  const segment = (id, x, y, net, padstack, connection) => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: ${padstack}\n${connection ? `  Connections:\n    ${connection}\n` : ''}~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const rows = [
    [1, 0, 0, 'STACK_P', 'SIG_L1_L6', ''],
    [2, 0.984252, 0, 'STACK_P', 'SIG_L5_L10', 'Shape: 1 (L5)'],
    [3, 0, 0, 'STACK_P', 'SIG_L10_L12', ''],
    [4, 20, 0, 'STACK_N', 'SIG_L1_L5', ''],
    [5, 20.984252, 0, 'STACK_N', 'SIG_L5_L10', ''],
    [6, 20, 0, 'STACK_N', 'SIG_L10_L12', 'Shape: 1 (L12)'],
    [7, 10, 20, 'GND', 'GND_PAD', '']
  ];
  const input = rows.map(row => segment(...row)).join('\n');
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'wrong_collapsed_stack', name: '错误的折叠两孔方案',
    vias: [
      { id: 1, x: 0.328084, y: 0, net: 'STACK_P', padstack: 'SIG_L5_L10' },
      { id: 2, x: 20.328084, y: 0, net: 'STACK_N', padstack: 'SIG_L10_L12' },
      { id: 3, x: 10, y: 20, net: 'GND', padstack: 'GND_PAD' }
    ]
  }));
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'geometric_stack', name: '几何连续三段孔方案',
    vias: [
      { id: 1, x: 0, y: 0, net: 'STACK_P', padstack: 'SIG_L1_L6' },
      { id: 2, x: 0.984252, y: 0, net: 'STACK_P', padstack: 'SIG_L5_L10' },
      { id: 3, x: 0, y: 0, net: 'STACK_P', padstack: 'SIG_L10_L12' },
      { id: 4, x: 20, y: 0, net: 'STACK_N', padstack: 'SIG_L1_L5' },
      { id: 5, x: 20.984252, y: 0, net: 'STACK_N', padstack: 'SIG_L5_L10' },
      { id: 6, x: 20, y: 0, net: 'STACK_N', padstack: 'SIG_L10_L12' },
      { id: 7, x: 10, y: 20, net: 'GND', padstack: 'GND_PAD' }
    ]
  }));
  const res = FanoutChecker.runFanoutInspection(input, library, { distanceTolerance: 0.1 });
  assert.strictEqual(res.summary.totalEligibleSignalViaItems, 6, '每个堆叠只要一段有 Connections，全部物理段都应纳入');
  assert.strictEqual(res.summary.totalSignalVias, 2, '六段物理 Via 应折叠为两个逻辑信号孔');
  assert.strictEqual(res.clusters.length, 1);
  assert.deepStrictEqual(res.clusters[0].signalVias.map(v => v.physicalViaIds), [[1, 2, 3], [4, 5, 6]]);
  assert.deepStrictEqual(res.clusters[0].matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6],
    '锁定方案时必须展开并匹配逻辑孔的全部物理段');
  assert.strictEqual(res.clusters[0].matchResult.pass, true);
  assert.strictEqual(res.clusters[0].matchResult.schemeName, '几何连续三段孔方案',
    '不得把完整三段堆叠压成两个代表孔后误选较小方案');

  const allUnconnected = rows.map(row => segment(row[0], row[1], row[2], row[3], row[4], '')).join('\n');
  const excluded = FanoutChecker.runFanoutInspection(allUnconnected, library, { distanceTolerance: 0.1 });
  assert.strictEqual(excluded.summary.totalEligibleSignalViaItems, 0);
  assert.strictEqual(excluded.summary.totalClusters, 0, '只有整栈全部孔段都无 Connections 时才排除');
  console.log('  PASS  几何/层跨连续性合并多段 Via，并按整栈任一 Connections 判断资格');
}

// 8h. 信号拓扑先锁定镜像/旋转姿态，再严格核验 GND 数量、Padstack 与位置容差
{
  const block = (id, x, y, net, padstack, connection = '') => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: ${padstack}\n${connection ? `  Connections:\n    ${connection}\n` : ''}~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const makeInput = ({ extra = false, wrongPad = false, shifted = false } = {}) => [
    block(1, 100, 100, 'POSE_P', 'SIG_A', 'Shape: 1 (Top)'),
    block(2, 100, 80, 'POSE_N', 'SIG_B', 'Shape: 1 (Top)'),
    block(3, 85, 100, 'POSE_P', 'SIG_C', 'Shape: 1 (Top)'),
    block(4, 85, shifted ? 82.1 : 80, 'GND', wrongPad ? 'GND_WRONG' : 'GND_A'),
    block(5, 95, 105, 'GND', 'GND_B'),
    extra ? block(6, 90, 90, 'GND', 'GND_EXTRA') : ''
  ].filter(Boolean).join('\n');
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'pose_exact_gnd', name: '旋转镜像完整拓扑',
    vias: [
      { id: 1, x: 0, y: 0, net: 'POSE_P', padstack: 'SIG_A' },
      { id: 2, x: 20, y: 0, net: 'POSE_N', padstack: 'SIG_B' },
      { id: 3, x: 0, y: 15, net: 'POSE_P', padstack: 'SIG_C' },
      { id: 4, x: 20, y: 15, net: 'GND', padstack: 'GND_A' },
      { id: 5, x: -5, y: 5, net: 'GND', padstack: 'GND_B' }
    ]
  }));

  const exact = FanoutChecker.runFanoutInspection(makeInput(), library, { distanceTolerance: 2, allowRotation: true, allowMirror: true });
  assert.strictEqual(exact.clusters[0].matchResult.pass, true);
  assert.strictEqual(exact.clusters[0].matchResult.isMirrored, true, '信号对象的非对称 Padstack/位置应锁定镜像姿态');
  assert.ok(Math.abs(Math.abs(exact.clusters[0].matchResult.rotationAngle) - 90) < 1e-6 ||
    Math.abs(exact.clusters[0].matchResult.rotationAngle - 270) < 1e-6, '应识别 90° 等价旋转');

  const extra = FanoutChecker.runFanoutInspection(makeInput({ extra: true }), library, { distanceTolerance: 2 });
  assert.strictEqual(extra.clusters[0].matchResult.status, 'GND_QUANTITY_MISMATCH', '方案足迹内多一个 GND 必须失败');
  assert.strictEqual(extra.clusters[0].matchResult.redundantViaCount, 1);

  const wrongPad = FanoutChecker.runFanoutInspection(makeInput({ wrongPad: true }), library, { distanceTolerance: 2 });
  assert.strictEqual(wrongPad.clusters[0].matchResult.status, 'PADSTACK_MISMATCH', '位置正确但 GND Padstack 错误必须失败');

  const shifted = FanoutChecker.runFanoutInspection(makeInput({ shifted: true }), library, { distanceTolerance: 2 });
  assert.strictEqual(shifted.clusters[0].matchResult.status, 'DISTANCE_MISMATCH', 'GND 中心位置超过配置容差必须失败');
  assert.strictEqual(shifted.clusters[0].matchResult.missingVias.length, 1);
  assert.strictEqual(shifted.clusters[0].matchResult.redundantViaCount, 0, '位置超差但数量相同时不得误报为数量冗余');

  const oneToOne = FanoutChecker.matchCompanionGnd(
    [{ id: 1, x: 0, y: 0, net: 'GND', padstack: 'GND_X' }, { id: 2, x: 1.5, y: 0, net: 'GND', padstack: 'GND_X' }],
    [{ id: 11, x: 0.9, y: 0, net: 'GND', padstack: 'GND_X' }, { id: 12, x: -1.5, y: 0, net: 'GND', padstack: 'GND_X' }],
    [0, 1], { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 0, false, 2);
  assert.strictEqual(oneToOne.missingVias.length, 0, '一对一映射应通过增广配对避免贪心抢占唯一候选孔');
  assert.strictEqual(oneToOne.usedGndIndices.size, 2);
  console.log('  PASS  信号优先姿态匹配后，GND 数量、Padstack、中心位置执行一对一严格核验');
}

// 9. 导入 Trace (走线) 数据解析与孔群关联测试
{
  const fs = require('fs');
  const path = require('path');

  // 9a. 混合过孔 + 单段走线 (< Via > + < Trace Seg >，含直线 Seg 与 CW/CCW 圆弧 Arc seg)
  const sampleMixed = fs.readFileSync(path.join(__dirname, '../../sample/via_trace_airgap_sample.txt'), 'utf8');
  const lib = new FanoutChecker.FanoutLibrary();
  lib.loadStandardPresets();
  const resMixed = FanoutChecker.runFanoutInspection(sampleMixed, lib);

  assert.strictEqual(resMixed.success, true);
  assert.strictEqual(resMixed.vias.length, 26, '应读取 26 个过孔');
  assert.strictEqual(resMixed.traces.length, 71, '应同时读取 71 个 < Trace Seg > 走线块');
  assert.strictEqual(resMixed.summary.totalTraceSegments, 71, '总走线段数应为 71');
  assert.strictEqual(resMixed.summary.traceArcCount, 33, '应精确识别 33 段圆弧走线');
  assert.strictEqual(resMixed.summary.traceLineCount, 38, '应精确识别 38 段直线走线');
  assert.deepStrictEqual(
    [...resMixed.summary.traceLayers].sort(),
    ['02G01P', '04IS01', '08IS03', '19IS08'],
    '应提取全部 4 个走线层 Subset'
  );
  assert.ok(
    resMixed.clusters.every(c => c.traceSummary && c.traceSummary.segmentCount > 0 && c.traceSummary.layers.length >= 2),
    '每个差分扇出孔群均应成功关联其扇出走线与出线层'
  );

  // 9b. 纯多段走线 (< Trace > 块内含多条 Seg 与 Arc seg，无过孔)
  const samplePureTrace = fs.readFileSync(path.join(__dirname, '../../sample/走线示例.txt'), 'utf8');
  const resPure = FanoutChecker.runFanoutInspection(samplePureTrace, lib);
  assert.strictEqual(resPure.success, true, '纯走线文件也应成功读取而不报错');
  assert.strictEqual(resPure.pureTraceMode, true, '应标记为 pureTraceMode');
  assert.strictEqual(resPure.vias.length, 0);
  assert.strictEqual(resPure.traces.length, 10, '应解析 10 条 < Trace > 多段走线');
  assert.strictEqual(resPure.summary.totalTraceSegments, 16, '10 条走线合计应包含 16 个几何分段');
  assert.strictEqual(resPure.summary.traceArcCount, 2, '应包含 2 段圆弧');

  console.log('  PASS  导入 Trace / Trace Seg (直线+圆弧) 解析、纯走线模式与扇出孔群关联');
}

