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

// 8b. 只有 Trace Connections 触发检查；Shape-only 与空 Connections 独立信号孔排除
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
    '只有明确 Trace 或同行层列表才具有扇出检查触发资格');
  assert.deepStrictEqual(parsed[0].connectedTraceLayers, ['Top']);
  assert.deepStrictEqual(parsed[1].connectedTraceLayers, ['Top'], '同行 Connections 格式仍应兼容');
  assert.strictEqual(parsed[6].hasShapeConnections, true);
  assert.deepStrictEqual(parsed[6].connectedShapeLayers, ['03G02P']);
  assert.strictEqual(parsed[6].hasTopShapeConnection, false, '内层 Shape 不能冒充伴随顶层 Pin');

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
  assert.strictEqual(res.summary.totalSignalVias, 2, '仅两颗 Trace Connections 信号孔具备检查资格');
  assert.strictEqual(res.summary.excludedSignalVias, 3, '无连接、空连接与 Shape-only 独立信号孔都应排除');
  assert.strictEqual(res.clusters.length, 1, '远处 Shape-only 信号孔不得自行创建检查组');
  const routedCluster = res.clusters.find(cluster => cluster.signalVias.some(v => v.id === 1));
  assert.deepStrictEqual(routedCluster.signalVias.map(v => v.id).sort((a, b) => a - b), [1, 2]);
  assert.deepStrictEqual(routedCluster.vias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4],
    '附近 GND 仍应作为 Trace 连接信号组的伴随地孔');
  assert.strictEqual(routedCluster.matchResult.pass, true);
  assert.strictEqual(res.vias.find(via => via.id === 7).isFanoutEligible, false);
  console.log('  PASS  只有 Trace Connections 触发检查，Shape-only 独立信号孔被排除');
}

// 8c. 所有逻辑信号孔均无 Trace Connections 时保持零检查组，不回退检查全部信号孔
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
  console.log('  PASS  全部信号孔均无 Trace Connections 时零组返回且不执行旧版回退');
}

// 8d. 显式 Via 链中的非 Trace 孔段随 Trace 锚点合并；Shape/Via-only 独立孔群排除
{
  const stackSpan = id => ({ 3: 'L2_L5', 4: 'L5_L10', 5: 'L10_L12', 6: 'L2_L5', 7: 'L5_L10', 8: 'L10_L12' }[id] || 'TOP');
  const viaBlock = (id, x, y, net, connection) => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: STACK_SEG_${stackSpan(id)}_${id}\n  Connections:\n    ${connection}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
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
  assert.strictEqual(res.summary.totalSignalVias, 2, '两个三段堆叠折叠为两个逻辑孔，上方非 Trace 孔排除');
  assert.strictEqual(res.summary.totalEligibleSignalViaItems, 6, 'Trace 锚点及同一多段孔中的 Via/Shape 孔段应纳入');
  assert.strictEqual(res.summary.excludedSignalVias, 2);
  assert.strictEqual(res.clusters.length, 1, '只有包含 Trace Connections 的下方孔群创建检查组');
  const cluster = res.clusters[0];
  assert.deepStrictEqual(cluster.signalVias.map(v => v.id).sort((a, b) => a - b), [3, 6]);
  assert.deepStrictEqual(cluster.signalVias.map(v => v.physicalViaIds), [[3, 4, 5], [6, 7, 8]]);
  assert.deepStrictEqual(cluster.physicalSignalVias.map(v => v.id).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8]);
  assert.ok(cluster.vias.every(v => ![1, 2, 9].includes(v.id)), '上方孔群及其地孔不得污染下方检查组');
  assert.deepStrictEqual(cluster.matchResult.signalStackAudit.map(a => a.physicalViaIds), [[3, 4, 5], [6, 7, 8]],
    '检查审计应保留每个逻辑孔对应的全部物理盲埋孔段');
  assert.ok(res.vias.filter(v => v.id === 1 || v.id === 2).every(v => !v.isFanoutEligible));
  console.log('  PASS  Trace 锚点带入显式 Via 链完整孔段，Shape/Via-only 独立孔群排除');
}

// 8e. 同网络 Shape-only 顶层 Pin 纳入完整信号拓扑，Via-only 独立对象排除
{
  const blocks = [
    ['1', 0, 0, 'PAIR_P', 'HDI_SIG', 'Trace: 1 (04G01P)'],
    ['2', 20, 0, 'PAIR_N', 'HDI_SIG', 'Trace: 1 (04G01P)'],
    ['3', 0, 20, 'PAIR_P', 'TOP_PIN', 'Shape: 1 (Top)'],
    ['4', 20, 20, 'PAIR_N', 'TOP_PIN', 'Shape: 1 (Top)'],
    ['5', 200, 200, 'PAIR_N', 'UNANCHORED_VIA', 'Via: 99 (05G02P)']
  ].map(v => `Item ${v[0]} < Via >\n  Origin-xy: [${v[1]}, ${v[2]}]\n  Net: ${v[3]}\n  Padstack Name: ${v[4]}\n  Usage: ${/Shape:.*\(Top\)/.test(v[5]) ? 'SMD Pin' : 'BBVia'}\n  Connections:\n    ${v[5]}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`).join('\n');
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'l2_l4_pair', name: 'L2-L4-DIFF',
    vias: [
      { id: 1, x: 0, y: 0, net: 'PAIR_P', padstack: 'HDI_SIG' },
      { id: 2, x: 20, y: 0, net: 'PAIR_N', padstack: 'HDI_SIG' }
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
  assert.strictEqual(res.summary.totalSignalVias, 2, '两颗 Trace Connections 信号孔负责触发建组');
  assert.strictEqual(res.summary.totalEligibleSignalViaItems, 4);
  assert.strictEqual(res.summary.totalCompanionSignalVias, 2);
  assert.strictEqual(res.summary.excludedSignalVias, 1);
  assert.strictEqual(res.clusters.length, 1);
  const pairCluster = res.clusters[0];
  assert.deepStrictEqual(pairCluster.signalVias.map(v => v.id).sort((a, b) => a - b), [1, 2]);
  assert.deepStrictEqual(pairCluster.matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4],
    '与完整方案 Padstack 和位置唯一对应的 Shape-only 顶层 Pin 应进入信号拓扑');
  assert.strictEqual(pairCluster.matchResult.pass, true);
  assert.strictEqual(pairCluster.matchResult.schemeName, 'TOP-PIN+HDI-DIFF');
  assert.ok(res.vias.filter(v => [3, 4].includes(v.id)).every(v => v.isFanoutEligible && v.isFanoutCompanion));
  assert.strictEqual(res.vias.find(v => v.id === 5).isFanoutEligible, false);
  console.log('  PASS  同网络 Shape-only 顶层 Pin 补齐方案信号对象，Via-only 独立对象保持排除');
}

// 8f. Shape-only 顶层 Pin 不触发建组，仅按完整方案位置补入并保留唯一异网恢复
{
  const viaBlock = (id, x, y, net, padstack, connection) => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: ${padstack}\n  Usage: ${padstack === 'TOP_PIN' ? 'SMD Pin' : 'BBVia'}${padstack === 'TOP_PIN' ? '\n  Padstack Defined only on Top' : ''}${connection ? `\n  Connections:\n    ${connection}` : ''}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
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
    // 同一区域另一个同网 Pin 不对应任何方案位置，不能只凭同网关系激活。
    [9, 30, 30, 'PAIR_N', 'TOP_PIN', 'Shape: 1 (Top)']
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
  assert.strictEqual(res.clusters.length, 1, '只有两颗 Trace Connections 孔建立检查组');
  assert.strictEqual(pairCluster.matchResult.status, 'SIGNAL_NET_MISMATCH',
    '异网顶层 Pin 可按唯一位置补齐方案拓扑，但必须作为 Net/P/N 错误报错');
  assert.strictEqual(pairCluster.matchResult.pass, false);
  assert.deepStrictEqual(pairCluster.matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8],
    '合法多段孔和方案唯一命中的两个顶层 Pin 都应参与信号匹配');
  assert.deepStrictEqual(pairCluster.matchResult.signalNetRecoveries || [], [{
    viaId: 8, sourceNet: 'OTHER_N', expectedNet: 'PAIR_P', x: 9.846, y: 0, padstack: 'TOP_PIN'
  }]);
  assert.strictEqual(res.vias.find(v => v.id === 8).net, 'OTHER_N');
  assert.strictEqual(res.summary.totalCompanionSignalVias, 2);
  assert.strictEqual(res.summary.signalNetFailCount, 1);
  assert.strictEqual(res.summary.failCount, 1);
  assert.strictEqual(res.summary.excludedSignalVias, 1, '同网络但未命中方案位置的 Shape-only 顶层 Pin 仍应排除');
  assert.strictEqual(res.vias.find(v => v.id === 9).isFanoutEligible, false);

  // 用户 33_N/33_P 数据中 N 侧顶层 Pin 被导出成 33_P，且整段没有 Connections；
  // 它不能触发检查，但 Padstack 与方案位置唯一命中时仍应作为伴随对象补齐。
  const connectionlessRows = signalRows.map(row => {
    if (row[0] === 3) return [3, 0, 0, 'PAIR_P', 'TOP_PIN', ''];
    if (row[0] === 8) return [8, 9.846, 0, 'PAIR_P', 'TOP_PIN', 'Shape: 1 (Top)'];
    return row;
  });
  const connectionless = FanoutChecker.runFanoutInspection(
    connectionlessRows.map(row => viaBlock(...row)).join('\n'), library, { distanceTolerance: 2 });
  const connectionlessPair = connectionless.clusters.find(cluster => cluster.physicalSignalVias.some(v => v.id === 1));
  assert.strictEqual(connectionlessPair.matchResult.status, 'SIGNAL_NET_MISMATCH',
    '无 Connections 的零钻 SMD Pin 应按唯一方案位置补入，但 P/N 极性错标必须报错');
  assert.strictEqual(connectionlessPair.matchResult.pass, false);
  assert.strictEqual(connectionlessPair.matchResult.schemeName, '八信号对象顶层Pin方案');
  assert.deepStrictEqual(connectionlessPair.matchingSignalVias.map(v => v.id).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(connectionless.vias.find(v => v.id === 3).isFanoutCompanion,
    '无 Connections 顶层 Pin 只能作为伴随对象，不能成为建组锚点');
  assert.deepStrictEqual(connectionlessPair.matchResult.signalNetRecoveries || [], [{
    viaId: 3, sourceNet: 'PAIR_P', expectedNet: 'PAIR_N', x: 0, y: 0, padstack: 'TOP_PIN'
  }], '顶层 Pin 的 P/N 极性错标应保留审计提示');
  assert.strictEqual(connectionless.summary.totalCompanionSignalVias, 2);
  assert.strictEqual(connectionless.summary.signalNetFailCount, 1);
  assert.strictEqual(connectionless.summary.failCount, 1);
  assert.strictEqual(connectionless.summary.excludedSignalVias, 1);

  const ambiguousInput = input + '\n' + viaBlock(10, 9.846, 0, 'ANOTHER_P', 'TOP_PIN', 'Shape: 1 (Top)');
  const ambiguous = FanoutChecker.runFanoutInspection(ambiguousInput, library, { distanceTolerance: 2 });
  const ambiguousPair = ambiguous.clusters.find(cluster => cluster.physicalSignalVias.some(v => v.id === 1));
  assert.strictEqual(ambiguousPair.matchResult.status, 'NO_MATCH_TOPOLOGY',
    '同一缺失位置存在多个异网候选时不得猜测归属');
  assert.deepStrictEqual(ambiguousPair.matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 4, 5, 6, 7],
    '合法多段孔保留；完整方案因异网候选歧义失败时，同网络顶层 Pin 也不得单独激活');
  console.log('  PASS  顶层 Pin 按完整方案位置补入，Net/P/N 错标报错并拒绝歧义候选');
}

// 8g. 用户 18 对象回归：Item 15/17 作为同网络 Shape-only 顶层 Pin 补入 Top-L4 方案
{
  const rows = [
    [1, 21056.5886, 33459.1457, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [2, 21005.4075, 33459.1457, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [3, 21053.7406, 33468.1784, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [4, 21008.2555, 33468.1784, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [5, 21053.7406, 33450.1130, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [6, 21046.2267, 33444.3474, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [7, 21036.7647, 33443.9343, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [8, 21008.2555, 33450.1130, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [9, 21015.7694, 33444.3474, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [10, 21025.2314, 33443.9343, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [11, 21015.7694, 33473.9440, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [12, 21025.2314, 33474.3571, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [13, 21046.2267, 33473.9440, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [14, 21036.7647, 33474.3571, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [15, 21026.0751, 33477.0457, '25_N', 'via2_8-top'],
    [16, 21021.1555, 33459.1457, '25_N', 'BGA-HDI-SIG-045drill-ring3_L1_L4'],
    [17, 21035.9211, 33477.0457, '25_P', 'via2_8-top'],
    [18, 21040.8406, 33459.1457, '25_P', 'BGA-HDI-SIG-045drill-ring3_L1_L4']
  ];
  const schemeCoords = [[30.514, -17.9], [-20.668, -17.9], [27.666, -8.867], [-17.82, -8.867],
    [27.666, -26.933], [20.152, -32.698], [10.69, -33.111], [-17.82, -26.933],
    [-10.306, -32.698], [-0.844, -33.111], [-10.306, -3.102], [-0.844, -2.689],
    [20.152, -3.102], [10.69, -2.689], [0, 0], [-4.92, -17.9], [9.846, 0], [14.766, -17.9]];
  const block = row => `Item ${row[0]} < Via >\n  Origin-xy: [${row[1]}, ${row[2]}]\n  Net: ${row[3]}\n  Padstack Name: ${row[4]}\n  Usage: ${row[0] === 15 || row[0] === 17 ? 'SMD Pin' : 'BBVia'}\n  Connections:\n    ${row[0] === 16 || row[0] === 18 ? 'Trace: 1 (04G01P)' : 'Shape: 1 (Top)'}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'user_top_l4_18', name: 'BGA_2对_P0.25/0.5mm_Top-L4_GND轴对称',
    vias: rows.map((row, index) => ({ id: row[0], x: schemeCoords[index][0], y: schemeCoords[index][1],
      net: row[3], padstack: row[4], drill: [15, 17].includes(row[0]) ? 0 : 4.5 }))
  }));
  const result = FanoutChecker.runFanoutInspection(rows.map(block).join('\n'), library, { distanceTolerance: 2 });
  const cluster = result.clusters[0];
  assert.strictEqual(cluster.matchResult.status, 'MATCH_PASS');
  assert.strictEqual(cluster.matchResult.schemeName, 'BGA_2对_P0.25/0.5mm_Top-L4_GND轴对称');
  assert.deepStrictEqual(cluster.matchingSignalVias.map(v => v.id), [16, 18, 15, 17]);
  assert.strictEqual(cluster.matchResult.matchedViaCount, 18);
  assert.strictEqual(cluster.matchResult.viaAudit.length, 14);
  assert.strictEqual(result.summary.totalEligibleSignalViaItems, 4);
  assert.strictEqual(result.summary.totalCompanionSignalVias, 2);
  assert.strictEqual(result.summary.excludedSignalVias, 0);
  assert.deepStrictEqual(cluster.matchResult.signalNetRecoveries, []);
  assert.ok(Math.hypot(rows[14][1] - rows[15][1], rows[14][2] - rows[15][2]) * 0.0254 > 0.175,
    '顶层 Pin 到 Trace Via 的总距离超过多段孔合并档位，仍应由完整方案位置确认');
  console.log('  PASS  用户 18 对象孔群完整匹配 Top-L4 方案，Item 15/17 作为伴随顶层 Pin 纳入');
}

// 8h. 用户 20 对象回归：0.66 mm Top-L4 方案按方案位置补入超过 0.175 mm 投影的顶层 Pin
{
  const rows = [
    [19103, 28764.4625, 33059.8381, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [19109, 28705.4075, 33059.8381, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [19115, 28761.4549, 33069.0945, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [19121, 28753.5809, 33074.8153, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [19127, 28743.8481, 33074.8153, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [19133, 28734.9350, 33069.0945, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [19139, 28708.4151, 33069.0945, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [19145, 28716.2891, 33074.8153, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [19151, 28726.0219, 33074.8153, 'GND', 'BGA-HDI-GND-045drill-ring3_L2_L5'],
    [19157, 28761.4549, 33050.5817, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [19163, 28753.5809, 33044.8609, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [19169, 28743.8481, 33044.8609, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [19175, 28734.9350, 33050.5817, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [19181, 28708.4151, 33050.5817, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L5'],
    [19187, 28716.2891, 33044.8609, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [19193, 28726.0219, 33044.8609, 'GND', 'BGA-HDI-GND-045drill-ring3_L1_L3'],
    [27991, 28730.0100, 33077.7381, '27_N', 'via2_8-top'],
    [27973, 28721.1555, 33059.8381, '27_N', 'BGA-HDI-SIG-045drill-ring3_L1_L4'],
    [28052, 28739.8600, 33077.7381, '27_P', 'via2_8-top'],
    [28034, 28748.7145, 33059.8381, '27_P', 'BGA-HDI-SIG-045drill-ring3_L1_L4']
  ];
  const schemeCoords = [[34.453, -17.9], [-24.602, -17.9], [31.445, -8.644], [23.571, -2.923],
    [13.838, -2.923], [4.925, -8.644], [-21.595, -8.644], [-13.721, -2.923],
    [-3.988, -2.923], [31.445, -27.156], [23.571, -32.877], [13.838, -32.877],
    [4.925, -27.156], [-21.595, -27.156], [-13.721, -32.877], [-3.988, -32.877],
    [0, 0], [-8.854, -17.9], [9.85, 0], [18.704, -17.9]];
  const block = row => `Item ${row[0]} < Via >\n  Origin-xy: [${row[1]}, ${row[2]}]\n  Net: ${row[3]}\n  Padstack Name: ${row[4]}\n  Usage: ${row[4] === 'via2_8-top' ? 'SMD Pin' : 'BBVia'}\n  Connections:\n    ${[27973, 28034].includes(row[0]) ? 'Trace: 1 (04G01P)' : 'Shape: 1 (Top)'}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'user_top_l4_066_20', name: 'BGA_2对_P0.25/0.66mm_Top-L4_GND轴对称',
    vias: rows.map((row, index) => ({ id: row[0], x: schemeCoords[index][0], y: schemeCoords[index][1],
      net: row[3], padstack: row[4], drill: row[4] === 'via2_8-top' ? 0 : 4.5 }))
  }));
  const result = FanoutChecker.runFanoutInspection(rows.map(block).join('\n'), library, { distanceTolerance: 2 });
  const cluster = result.clusters[0];
  assert.strictEqual(cluster.matchResult.status, 'MATCH_PASS');
  assert.strictEqual(cluster.matchResult.schemeName, 'BGA_2对_P0.25/0.66mm_Top-L4_GND轴对称');
  assert.deepStrictEqual(cluster.matchingSignalVias.map(v => v.id), [27973, 28034, 27991, 28052]);
  assert.strictEqual(cluster.matchResult.viaAudit.length, 16);
  assert.strictEqual(cluster.matchResult.matchedViaCount, 20);
  assert.strictEqual(result.summary.totalEligibleSignalViaItems, 4);
  assert.strictEqual(result.summary.totalCompanionSignalVias, 2);
  assert.strictEqual(result.summary.excludedSignalVias, 0);
  assert.ok(Math.abs(rows[16][1] - rows[17][1]) * 0.0254 > 0.175,
    'Item 27991 到 Trace 孔的差分节距轴投影约 0.225 mm，应由方案位置确认而非 0.175 mm 硬门槛排除');
  console.log('  PASS  用户 20 对象孔群完整匹配 0.66 mm Top-L4 方案，16 个 GND 全部一对一命中');
}

// 8i. 无显式 Via 引用时，以 Trace 孔为锚按 0.175 mm 与连续层跨合并完整孔
{
  const segment = (id, x, y, net, padstack, connection) => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: ${padstack}\n${connection ? `  Connections:\n    ${connection}\n` : ''}~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const rows = [
    [1, 0, 0, 'STACK_P', 'SIG_L1_L6', ''],
    [2, 0.984252, 0, 'STACK_P', 'SIG_L5_L10', 'Trace: 1 (L5)'],
    [3, 0, 0, 'STACK_P', 'SIG_L10_L12', ''],
    [4, 20, 0, 'STACK_N', 'SIG_L1_L5', ''],
    [5, 20.984252, 0, 'STACK_N', 'SIG_L5_L10', ''],
    [6, 20, 0, 'STACK_N', 'SIG_L10_L12', 'Trace: 1 (L12)'],
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
  assert.strictEqual(res.summary.totalEligibleSignalViaItems, 6, '每个堆叠由 Trace 孔触发，0.175 mm 内全部合规物理段都应纳入');
  assert.strictEqual(res.summary.totalSignalVias, 2, '六段物理 Via 应折叠为两个逻辑信号孔');
  assert.strictEqual(res.clusters.length, 1);
  assert.deepStrictEqual(res.clusters[0].signalVias.map(v => v.physicalViaIds), [[1, 2, 3], [4, 5, 6]]);
  assert.deepStrictEqual(res.clusters[0].matchingSignalVias.map(v => v.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6],
    '锁定方案时必须展开并匹配逻辑孔的全部物理段');
  assert.strictEqual(res.clusters[0].matchResult.pass, true);
  assert.strictEqual(res.clusters[0].matchResult.schemeName, '几何连续三段孔方案',
    '不得把完整三段堆叠压成两个代表孔后误选较小方案');

  const shapeOnly = rows.map(row => segment(row[0], row[1], row[2], row[3], row[4],
    String(row[5] || '').replace('Trace:', 'Shape:'))).join('\n');
  const shapeOnlyResult = FanoutChecker.runFanoutInspection(shapeOnly, library, { distanceTolerance: 0.1 });
  assert.strictEqual(shapeOnlyResult.summary.totalEligibleSignalViaItems, 0);
  assert.strictEqual(shapeOnlyResult.summary.totalClusters, 0, '整栈只有 Shape Connections 时不得触发检查');

  const allUnconnected = rows.map(row => segment(row[0], row[1], row[2], row[3], row[4], '')).join('\n');
  const excluded = FanoutChecker.runFanoutInspection(allUnconnected, library, { distanceTolerance: 0.1 });
  assert.strictEqual(excluded.summary.totalEligibleSignalViaItems, 0);
  assert.strictEqual(excluded.summary.totalClusters, 0, '整栈无 Trace Connections 时必须排除');

  const transitiveInput = [
    segment(11, 0, 0, 'CHAIN_P', 'SIG_L1_L5', 'Trace: 1 (L1)\n    Via: 12 (05G02P)\n    Via: 14 (20G19P)\n    Via: 15 (05G02P)'),
    segment(12, 4.92126, 0, 'CHAIN_P', 'SIG_L5_L10', 'Via: 13 (10G07P)'),
    segment(13, 9.84252, 0, 'CHAIN_P', 'SIG_L10_L12', ''),
    segment(14, 0, 0, 'CHAIN_P', 'SIG_L19_L20', ''),
    segment(15, 20, 0, 'CHAIN_P', 'SIG_L5_L10', '')
  ].join('\n');
  const transitive = FanoutChecker.runFanoutInspection(transitiveInput, new FanoutChecker.FanoutLibrary());
  assert.deepStrictEqual(transitive.vias.filter(v => v.isFanoutEligible).map(v => v.id), [11, 12],
    '距 Trace 锚点 0.25 mm 的传递孔段、层跨不连续孔与超距显式引用孔均不得借用资格');
  assert.strictEqual(transitive.vias.find(v => v.id === 13).hasConnections, false);
  console.log('  PASS  Trace 锚点按 0.175 mm 与连续层跨合并，Shape-only 整栈和传递污染均排除');
}

// 8i. 实际问题回归：两个三段堆叠只有中段 Shape Connections 时不得创建 sig_unit
{
  const segment = (id, x, net, padstack, connection) => `Item ${id} < Via >\n  Origin-xy: [${x}, 0]\n  Net: ${net}\n  Padstack Name: ${padstack}\n${connection ? `  Connections:\n    ${connection}\n` : ''}~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const input = [
    segment(27165, 0, '21_N', 'HDI_L2_L5', ''),
    segment(27135, 4.9212, '21_N', 'PTH_L5_L10', 'Shape: 2 (05G02P 10G07P)'),
    segment(27166, 0, '21_N', 'HDI_L10_L12', ''),
    segment(27361, 20, '21_P', 'HDI_L2_L5', ''),
    segment(27380, 24.9212, '21_P', 'PTH_L5_L10', 'Shape: 2 (05G02P 10G07P)'),
    segment(27362, 20, '21_P', 'HDI_L10_L12', '')
  ].join('\n');
  const res = FanoutChecker.runFanoutInspection(input, new FanoutChecker.FanoutLibrary());
  assert.strictEqual(res.summary.totalParsedSignalVias, 6, '六个物理孔段均应完整解析');
  assert.strictEqual(res.summary.totalEligibleSignalViaItems, 0, 'Shape-only 中段不得成为 Trace 触发孔');
  assert.strictEqual(res.summary.totalSignalVias, 0);
  assert.strictEqual(res.summary.excludedSignalVias, 6);
  assert.strictEqual(res.summary.totalClusters, 0);
  assert.deepStrictEqual(res.clusters, [], '两个 Shape-only 三段堆叠不得创建 sig_unit_41 或任何检查组');
  console.log('  PASS  supplied sig_unit_41 Shape-only 三段堆叠回归：零检查组');
}

// 8j. 信号拓扑先锁定镜像/旋转姿态，再严格核验 GND 数量、Padstack 与位置容差
{
  const block = (id, x, y, net, padstack, connection = '') => `Item ${id} < Via >\n  Origin-xy: [${x}, ${y}]\n  Net: ${net}\n  Padstack Name: ${padstack}\n${connection ? `  Connections:\n    ${connection}\n` : ''}~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  const makeInput = ({ extra = false, wrongPad = false, shifted = false } = {}) => [
    block(1, 100, 100, 'POSE_P', 'SIG_A', 'Trace: 1 (Top)'),
    block(2, 100, 80, 'POSE_N', 'SIG_B', 'Trace: 1 (Top)'),
    block(3, 85, 100, 'POSE_P', 'SIG_C', 'Trace: 1 (Top)'),
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

  const coincidentPads = FanoutChecker.matchCompanionGnd(
    [{ id: 1, x: 0, y: 0, net: 'GND', padstack: 'GND_A' }, { id: 2, x: 0, y: 0, net: 'GND', padstack: 'GND_B' }],
    [{ id: 21, x: 0, y: 0, net: 'GND', padstack: 'GND_A' }, { id: 22, x: 0, y: 0, net: 'GND', padstack: 'GND_C' }],
    [0, 1], { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 0, false, 2);
  assert.deepStrictEqual(coincidentPads.audit.map(item => [item.viaId, item.isMatch]), [[21, true], [22, false]],
    '同坐标多段 GND 应先保留 Padstack 精确配对，只把真正不同的孔段报错');
  assert.strictEqual(coincidentPads.padMismatchList.length, 1);
  console.log('  PASS  信号优先姿态匹配后，GND 数量、Padstack、中心位置执行一对一严格核验');
}

// 8k. 用户 34_N/34_P 50 对象回归：完整 Via+Segment 导出应命中 0.52 mm Top-L12 方案
{
  const pads = {
    g15: 'BGA-HDI-GND-045drill-ring3_L1_L5',
    g25: 'BGA-HDI-GND-045drill-ring3_L2_L5',
    g510: 'PTH-GND-150drill-ring0_L5_L10',
    g1011: 'BGA-HDI-GND-045drill-ring3_L10_L11',
    g1013: 'BGA-HDI-GND-045drill-ring3_L10_L13',
    top: 'via2_8-top',
    s15: 'BGA-HDI-SIG-045drill-ring3_L1_L5',
    s510: 'PTH-SIG-150drill-ring0_L5_L10',
    s1012: 'BGA-HDI-SIG-045drill-ring3_L10_L12'
  };
  const schemeRows = [
    [1, 29.477, -27.156, 'GND', 'g15', 4.5], [2, 21.603, -32.877, 'GND', 'g15', 4.5],
    [3, 11.871, -32.877, 'GND', 'g15', 4.5], [4, -19.625, -27.156, 'GND', 'g15', 4.5],
    [5, -11.751, -32.877, 'GND', 'g15', 4.5], [6, -2.019, -32.877, 'GND', 'g15', 4.5],
    [7, 4.926, -28.156, 'GND', 'g15', 4.5], [8, -22.633, -17.9, 'GND', 'g15', 4.5],
    [9, -19.625, -8.644, 'GND', 'g15', 4.5], [10, 29.477, -8.644, 'GND', 'g15', 4.5],
    [11, 21.603, -2.923, 'GND', 'g25', 4.5], [12, 11.871, -2.923, 'GND', 'g25', 4.5],
    [13, -11.751, -2.923, 'GND', 'g25', 4.5], [14, -2.019, -2.923, 'GND', 'g25', 4.5],
    [15, 4.926, -7.644, 'GND', 'g25', 4.5], [16, 32.484, -17.9, 'GND', 'g15', 4.5],
    [17, -3.933, -35.617, 'GND', 'g510', 6], [18, -3.933, -0.183, 'GND', 'g510', 6],
    [19, -16.461, -5.373, 'GND', 'g510', 6], [20, -22.136, -17.9, 'GND', 'g510', 6],
    [21, -16.461, -30.428, 'GND', 'g510', 6], [22, 13.783, -35.617, 'GND', 'g510', 6],
    [23, 26.311, -30.428, 'GND', 'g510', 6], [24, 31.986, -17.9, 'GND', 'g510', 6],
    [25, 26.311, -5.373, 'GND', 'g510', 6], [26, 13.783, -0.183, 'GND', 'g510', 6],
    [27, 29.477, -27.156, 'GND', 'g1013', 4.5], [28, 21.603, -32.877, 'GND', 'g1011', 4.5],
    [29, 11.871, -32.877, 'GND', 'g1011', 4.5], [30, -19.625, -27.156, 'GND', 'g1013', 4.5],
    [31, -11.751, -32.877, 'GND', 'g1011', 4.5], [32, -2.019, -32.877, 'GND', 'g1011', 4.5],
    [33, 4.926, -28.156, 'GND', 'g1011', 4.5], [34, -22.633, -17.9, 'GND', 'g1013', 4.5],
    [35, -19.625, -8.644, 'GND', 'g1013', 4.5], [36, 29.476, -8.644, 'GND', 'g1013', 4.5],
    [37, 21.602, -2.923, 'GND', 'g1013', 4.5], [38, 11.87, -2.923, 'GND', 'g1013', 4.5],
    [39, -11.752, -2.923, 'GND', 'g1013', 4.5], [40, -2.02, -2.923, 'GND', 'g1013', 4.5],
    [41, 4.925, -7.644, 'GND', 'g1013', 4.5], [42, 32.484, -17.9, 'GND', 'g1013', 4.5],
    [43, 0, 0, '34_N', 'top', 0], [44, -6.886, -17.9, '34_N', 's1012', 4.5],
    [45, -3.932, -17.9, '34_N', 's510', 6], [46, -6.886, -17.9, '34_N', 's15', 4.5],
    [47, 9.85, 0, '34_P', 'top', 0], [48, 16.736, -17.9, '34_P', 's1012', 4.5],
    [49, 13.783, -17.9, '34_P', 's510', 6], [50, 16.736, -17.9, '34_P', 's15', 4.5]
  ];
  const schemeVias = schemeRows.map(row => ({
    id: row[0], x: row[1], y: row[2], net: row[3], padstack: pads[row[4]], drill: row[5]
  }));
  // 实板孔群相对方案做 X 镜像后旋转 270°，平移到用户给出的 34_N 顶层 Pin。
  const boardOrigin = { x: 30039.4939, y: 28847.9865 };
  const boardRows = schemeVias.map(via => ({
    ...via,
    x: Number((boardOrigin.x + via.y).toFixed(4)),
    y: Number((boardOrigin.y + via.x).toFixed(4))
  }));
  const toBlock = (via, forceShapeOnly = false) => {
    const isTopPin = via.padstack === pads.top;
    const hasTrace = !forceShapeOnly && (via.id === 44 || via.id === 48);
    const connection = hasTrace ? 'Trace: 1 (12IS02)' : `Shape: 1 (${isTopPin ? 'Top' : '05G02P'})`;
    const usage = isTopPin ? 'SMD Pin' : (via.padstack === pads.s510 ? 'Thru Pin' : 'BBVia');
    return `Item ${via.id} < Via >\n  Origin-xy: [${via.x}, ${via.y}]\n  Net: ${via.net}\n  Padstack Name: ${via.padstack}\n  Usage: ${usage}\n  Circle Drill: ${via.drill}\n  Connections:\n    ${connection}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;
  };
  const library = new FanoutChecker.FanoutLibrary();
  library.addScheme(new FanoutChecker.FanoutScheme({
    id: 'user_34_top_l12_50', name: 'BGA_4对_P0.25/0.52mm_Top-L12_GND轴对称', vias: schemeVias
  }));
  const input = boardRows.map(via => toBlock(via)).join('\n');
  const result = FanoutChecker.runFanoutInspection(input, library, {
    distanceTolerance: 0.1, allowRotation: true, allowMirror: true
  });
  assert.strictEqual(result.vias.length, 50);
  assert.strictEqual(result.summary.totalSignalVias, 2, '六个堆叠孔段应折叠为 34_N/34_P 两个逻辑信号孔');
  assert.strictEqual(result.summary.totalEligibleSignalViaItems, 8, '六个物理孔段与两个顶层 Pin 均应参与完整方案匹配');
  assert.strictEqual(result.summary.totalClusters, 1);
  assert.strictEqual(result.summary.passCount, 1);
  const cluster = result.clusters[0];
  assert.strictEqual(cluster.viaCount, 50);
  assert.strictEqual(cluster.matchResult.status, 'MATCH_PASS');
  assert.strictEqual(cluster.matchResult.schemeName, 'BGA_4对_P0.25/0.52mm_Top-L12_GND轴对称');
  assert.strictEqual(cluster.matchResult.matchedViaCount, 50);
  assert.strictEqual(cluster.matchResult.viaAudit.length, 42, '42 个伴随 GND 物理孔段必须全部一对一匹配');
  assert.strictEqual(cluster.matchResult.missingVias.length, 0);
  assert.strictEqual(cluster.matchResult.padMismatchList.length, 0);
  assert.deepStrictEqual(cluster.matchingSignalVias.map(via => via.id).sort((a, b) => a - b),
    [43, 44, 45, 46, 47, 48, 49, 50]);
  assert.deepStrictEqual(boardRows.filter(via => via.id === 44 || via.id === 48).map(via => [via.x, via.y]),
    [[30021.5939, 28841.1005], [30021.5939, 28864.7225]], '回归坐标必须对应用户给出的差分信号中心');

  // Route Keepout 版数据在同一区域只有 11 个 L1-L5 GND、两个 L1-L5 信号孔和两个顶层 Pin，
  // 且全部只有 Shape Connections；这类 15 对象片段不是“匹配失败”，而是缺少 Trace 锚点所以不建立检查组。
  const partialRows = boardRows.filter(via =>
    (via.net === 'GND' && via.padstack === pads.g15) ||
    (via.net !== 'GND' && (via.padstack === pads.s15 || via.padstack === pads.top)));
  const partial = FanoutChecker.runFanoutInspection(partialRows.map(via => toBlock(via, true)).join('\n'), library);
  assert.strictEqual(partial.vias.length, 15);
  assert.strictEqual(partial.summary.totalParsedSignalVias, 4);
  assert.strictEqual(partial.summary.totalEligibleSignalViaItems, 0);
  assert.strictEqual(partial.summary.totalClusters, 0,
    '缺少 L5-L10/L10-L12 孔段和 Trace Connections 的 Route Keepout 片段不得伪装成完整 50 孔方案');
  console.log('  PASS  用户 34_N/34_P 50 对象孔群命中 0.52 mm Top-L12 方案，15 对象不完整导出保持未检查');
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

