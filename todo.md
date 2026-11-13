# TODO —— 重构后最终检查（对比 origin/main）

基线：`origin/main`（d108bd0）与 `refactor/modular-eda-workbench` 各跑全部测试，按用例名逐项比对。
状态：`[ ]` 未处理　`[~]` 处理中　`[x]` 已修复并推送

## A. 测试覆盖对比

main：16 个脚本，通过用例合计 372；分支：27 个脚本，全部通过。
逐名比对后，以下为**真实丢失**（不含仅因去括号改名的用例）。

| # | 来源（main） | 丢失内容 | 状态 |
| --- | --- | --- | --- |
| A1 | copper-rule-import-test.js「页面渲染」组 10 条 | 导入后 22 个约束卡 / 5 个类标题；提示「22 条约束 / 44 列参数」；表头可编辑与来源注记；约束指引分组 BGA 16 / SMA Top 3 / SMA bottom 3；约束指引横排；chip 链接；综合页约束指引同规则；命名说明落页尾；说明卡在约束卡之后；② 页无 emoji | [x] 新增 tests/ui/copper-sets-render.test.js，11 条通过 |
| A2 | nav-unify-test.js「综合一体化同步 DFM 分层规则与扇出预览特征」 | 分层间距规则表、孔盘到孔盘阈值、扇出分色图例、表格型 TXT 在综合页 22 条分 5 组、命名说明位置、叠层数提示、分层规则模板生成 2 行 | [x] 新增 tests/ui/unified-rules-sync.test.js，6 条通过 |
| A3 | nav-unify-test.js 六页「页签条 5 个页签、统一文案、可切换」 | 分支只剩 eda-shell-unify 7 条，未逐页断言页签数与切换 | [x] eda-shell-unify 逐页增加逐工序点击断言（单一 active 页签与面板） |
| A4 | theme-unify-test.js | 正文基准字号 14px；统计卡不填色且标签 12px / 数值 22px；表格正文 13px 且无旧 slate 色；卡片标题 15 / 小节标题 13 | [x] 新增 tests/ui/theme-computed.test.js，7 条通过 |
| A5 | bench-perf.js | 已迁入 tests/bench/copper-grid.bench.js，行为保留，但无耗时断言 | [x] 增加配对数 / 命中数 / 耗时上限 / 加速比 ≥ 10 倍断言 |

已确认**没有丢失**：ui-test 的 5 条（仅去括号改名）、portal 缓存版本号（改名）、GBK 解码 2 条（`decodeTxt` → `decodeBuffer`）。

## B. 重构引入的问题

| # | 问题 | 位置 | 状态 |
| --- | --- | --- | --- |
| B1 | AGENTS.md 自述仍有超标项：`unified.html` 1337 行、`fanout.html` 663、`dfm.html` 635；`unified.css` 892、`eda-shell.css` 755；函数 > 80 行 55 个 | 全仓库 | [ ] |
| B2 | `tests/bench/*.bench.js` 不在 `npm test`，回归时容易漏跑 | tools/run-tests.js | [x] 新增 `npm run check` = engine + ui + bench |
| B3 | 删除了静态说明：dfm `patHint`、fanout `pnlAdvice`、`viewSchemeBottomHint`（缩放 / 拖拽 / 测距操作提示）。操作提示对使用有帮助，应改为 data-tip 保留 | dfm.html / fanout.html | [ ] |
| B4 | 真实浏览器冒烟只在 `tools/browser-smoke.js`，且只点工序页签，不覆盖按钮与 canvas 绘制 | tools | [x] 新增 `npm run smoke:click`（tools/browser-clickall.js），6 页点遍按钮零报错 |

## C. 环境说明

- 浏览器冒烟需 playwright + chromium；沙箱无 root，通过 Debian 镜像解压 .so 并设 `LD_LIBRARY_PATH` 运行，冒烟 7/7 页通过。

## D. 全面代码审计发现的漏洞与回归问题（PR #14 / PR #15）

| # | 问题 | 位置 | 状态 |
| --- | --- | --- | --- |
| D1 | `trace-report.js` 拆分后未从 `trace-rules.js` 导出/导入 `inList` 与 `recordRadii`，导出含列表型特定线宽长度或圆弧违规的汇总报告会抛 `ReferenceError` | `packages/engines/trace/trace-rules.js`、`trace-report.js` | [x] 已导出并注入 `inList` / `recordRadii` |
| D2 | `trace-report.js` 复验状态键名与 UI（`trace-results-ui.js` / `trace-diff-ui.js`）不一致，已复验项在导出报告中全被记为「未复验」 | `packages/engines/trace/trace-report.js` | [x] 兼容 UI 键名与索引键名 |
| D3 | `fanout-layout.js` 拆分后漏从 `fanout-palette.js` 导入 `PADSTACK_PALETTE`，兜底分支会抛 `ReferenceError` | `packages/engines/fanout/fanout-layout.js` | [x] 已补齐 `PADSTACK_PALETTE` 导入 |
| D4 | `unified-runner.js` 的 `runCopperEngine(ctx)` 漏解构 `parsedConstraint`，兜底分支触发时抛 `ReferenceError` | `packages/pages/unified/unified-runner.js` | [x] 已解构 `parsedConstraint` |
| D5 | `unified-canvas-viewer.js` 的 `zoomCanvas()` 调用未定义的 `requestCanvasRender()`，且 `initCanvas()` 缺少测距点击事件监听 | `packages/pages/unified/unified-canvas-viewer.js` | [x] 改为 `renderCanvas()` 并补齐点击测距监听 |
| D6 | `dfm-canvas-viewer.js` 的 `renderDfmSpatialReviewCard` 读取不存在的 `State.checkResult.allPairs`（引擎返回 `.pairs` / `.defectPairs`），导致复核卡不显示对偶详情 | `packages/pages/dfm/dfm-canvas-viewer.js` | [x] 改为读取 `.pairs \|\| .allPairs \|\| .defectPairs` |
| D7 | `dfm-engine.js` 空间哈希半径与网格单元尺寸未计入 `layerRules` 最大阈值及 `padstackRules` / 非圆焊盘实际半径，且默认 `minClearancePadPair === 0` 时直接跳过分层孔盘规则 | `packages/engines/dfm/dfm-engine.js` | [x] 按实际过孔最大半径与分层最大阈值计算网格单元 |
| D8 | `dfm-results-ui.js` 拆分出 `dfm-results-pairs.js` 后遗留未使用的 `padShapeNote`，非圆焊盘标注丢失；空筛选结果提前返回未禁用翻页按钮；`modeLabel` 缺 `center_to_trace` / `center_to_center` | `packages/pages/dfm/dfm-results-ui.js`、`dfm-results-pairs.js` | [x] 迁入 `dfm-results-pairs.js` 并补齐模式标签与空结果翻页禁用 |
| D9 | `dfm-pattern-modes.js` 线到孔模式表直接展示内部英文枚举（`pad_to_trace` 等）；`dfm-pattern-ui.js` 在「孔到孔」视图下导出 CSV 仍导出线到孔数据；`dfm-pattern-filter-popover.js` 未过滤过期选中值导致误清筛选 | `packages/pages/dfm/dfm-pattern-modes.js`、`dfm-pattern-ui.js`、`dfm-pattern-filter-popover.js` | [x] 映射中文模式名、支持孔到孔规律导出、求交集过滤已选集合 |
| D10 | `dfm-padstack-rules.js` 丢弃单字段正数覆盖（仅改焊盘或仅改一钻），且默认尺寸变更重新检查时未同步未勾选行 | `packages/pages/dfm/dfm-padstack-rules.js`、`dfm-config.js` | [x] 支持单字段有效正数覆盖并新增 `syncDefaults()` |
| D11 | `fanout-scheme-viewer.js` 快捷改名检查不存在的 `c.matchResult.bestScheme.id`（实际为 `schemeId`），且与 `fanout-library-ui.js` / `unified-fanout-naming.js` 的 `localStorage` 键名不一致 | `packages/pages/fanout/fanout-scheme-viewer.js`、`fanout-library-ui.js` | [x] 兼容 `schemeId` 并统一 `pcb_fanout_name_keywords_v1` |
| D12 | `unified-fanout-io.js` 的 `importFanoutLibraryJSON` 将 `parseAndRepairFanoutJson` 返回对象当数组判断 `.length` 导致导入永远失败；`clearFanoutLibrary` 与删除末个方案后被 `renderFanoutSchemesGrid` 自动重置回 6 套预设 | `packages/pages/unified/unified-fanout-io.js`、`unified-fanout-library.js`、`unified-fanout-batch.js` | [x] 解析 `res.schemes` 并记录显式清空状态 |
| D13 | `pour-results-ui.js` 平铺视图下 `buildItemKey` 混入不同数组切片下标导致筛选后复核错位；`pour-canvas-viewer.js` 定位忽略 `checkCategory` 导致同 ID 跨类型元素错位；`pour-state.js` 直接裸调 `loadSavedRules` | `packages/pages/pour/pour-results-ui.js`、`pour-canvas-viewer.js`、`pour-state.js` | [x] 固定 `_rawKey`、按类别优先定位、通过 `root.*` 调用 |
| D14 | `trace-results-ui.js` 与 `unified` 多个页面包残留原生 `title="..."` 属性或未对用户输入/TXT 字段做 `escHtml()` 转义；`unified.html` 右侧遥测面板缺 `#edaDockTelemetry` | `packages/pages/trace/trace-results-ui.js`、`packages/pages/unified/*.js`、`unified.html` | [x] 统一改为 `data-tip`、补齐 `escHtml()` 与 `#edaDockTelemetry` |

