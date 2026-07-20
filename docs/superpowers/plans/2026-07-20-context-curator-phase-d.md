# ContextCurator Phase D 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(或 executing-plans)逐任务实现。步骤用 checkbox(`- [ ]`)跟踪。

**Goal:** curator 价值验收(最后一期)。用**确定性回放 bench** + **真实小样本新旧 A/B** 量化证明 curator 到底省多少 token、cache 命中改善多少、鬼打墙减少多少;顺带收敛 Phase C 三处留档(tier 阈值单一来源 / e2e 补跑 / ContextPanel render 测试)。验收通过后可删 legacy `ConversationHistoryCompactor` + `wraith.context.curator.enabled` 开关(本期不删,列为验收结论后的收尾动作)。

**Architecture:**
- **bench 复用现有装配**:`ContextCurator(windowSupplier, modelSupplier, clientSupplier, policy, sink, eventOut, [summarizer])` + `curate(history)`(调 LLM 前原地治理)+ `onUsage(input,output,cached,history)`(响应后记 metrics/watermark)。bench = `ContextCuratorTest` 的脚本加强版:确定性假 LlmClient/假摘要器 + 脚本化长会话把估算推过窗口 150%,curator on/off 同一脚本各跑一遍。
- **metrics 单一格式**(§9.1,已在):usage 行 `{ts,step,inputTokens,outputTokens,cachedInputTokens,ratio,tier,[cost,currency]}` + compaction 行 `{ts,compaction,tier,beforeTokens,afterTokens,snipped,pruned,summarized,durationMs}`。bench 与真实 A/B 与面板共用;analyzer 读它算净收益。
- **A/B 开关即对照**(§9.2):`Agent.java:550` `-Dwraith.context.curator.enabled=false` 走 legacy;同 jar 双策略。
- **cache 命中代理(离线)**:相邻 step 序列化 history 的公共前缀长度——DeepSeek 前缀缓存按最长公共前缀命中,前缀单调不滑窗 ⇒ 前缀长度随轮次单调增,离线即可证明「单调边界」价值。

**Tech Stack:** Java 17/Maven/JUnit5(`-DskipTests=false`);Electron+React+TS(vitest;reducer/组件纯函数或轻 render 测)。DeepSeek 计价经 `PricingTable`。

**Spec:** `docs/superpowers/specs/2026-07-17-context-curator-design.md` §8/§9/§10。

## Global Constraints

- **测试红线**:Java 一律 `@TempDir`,**绝不写真实 `~/.wraith`**;桌面测试纯内存。bench 输出写 `target/curator-bench/`(非 `~/.wraith`)。
- **真实 A/B 红线**:6 个真实 DeepSeek 会话须**用户先批准 3 个任务**再跑(花真钱);跑前确认 key 已配、会话结束清理临时 userData 不污染真实数据。
- **诚实红线(本 feature 事故留痕):不得编造评审/测试/bench 结果**。所有数字来自真跑;bench 报告里估算量标注「估算」,真实 A/B 数字标注来源会话。
- **红线保护(spec §5)**:bench/验收不改压缩语义;若发现 curator 行为 bug,单独 fix + 复审,不在 bench 里迁就。
- **基线不降**:Java 全量 **1538/0F/0E**、desktop `tsc --noEmit` 0、vitest **707**(`cd desktop && npx tsc --noEmit && npx vitest run`)。
- 跑 Java 测试:`mvn test -DskipTests=false [-Dtest=XxxTest]`。
- 提交信息尾部两行:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01E6qtyEJFHAxiMsCSKsjpQh`。
- **push 需用户单独点头**,任务只 commit 不 push。

---

### Task 1: 确定性回放 bench(ContextCuratorBench)

**Files:**
- Add: `src/test/java/com/lyhn/wraith/context/curator/ContextCuratorBench.java`(JUnit 可跑 + 可 main 触发)
- 复用:`ContextCurator`、`Message.*`、`ToolTierPolicy`、`CurationSink`(bench 用捕获式 sink 收 JSONL 到内存/`target/curator-bench/`)、`FakeSummarizer` 惯用法。

**Interfaces:**
- 脚本:`scriptedSession(int rounds, int toolOutChars)` 造 system + rounds×(user/assistant+toolCall/tool 大输出),估算过窗口 150%。
- 跑法:同一脚本步进,每 step 先 `curate(history)`(on 组)或跳过(off 对照),再模拟 LLM usage → `onUsage(...)`,再 append 新一轮。
- 量:每 step estInput 曲线 / 相邻 step 公共前缀长度(序列化 history)/ 触发水位(tier)分布 / Tier3 摘要输入长度(全量 vs delta,经 FakeSummarizer 记录入参长度)。
- 产出:`target/curator-bench/bench-{on,off}.jsonl` + `docs/.../reports/phase-d-bench.md`(曲线数值表 + 结论)。

**Acceptance:** bench 可复现(确定性,无 `Date/random` 依赖顺序);on 组累计 estInput < off 组;on 组相邻前缀长度单调不降(证单调边界);报告落盘。

- [ ] 写 bench harness + 捕获 sink
- [ ] 脚本化长会话(推过 150%)
- [ ] on/off 双跑 + 四项度量
- [ ] 生成 markdown 报告 + 断言（回归护栏）

### Task 2: 净收益 analyzer + DeepSeek 计价

**Files:**
- Add: `src/test/java/com/lyhn/wraith/context/curator/CurationMetricsAnalyzer.java`(读两条 metrics JSONL → 汇总）
- 复用:`PricingTable`(DeepSeek 分价 cache 命中/未命中/output）。

**Interfaces:**
- 读 usage+compaction 行 → 累计 input/output/cached、compaction 次数、摘要开销（summarized 的 LLM 调用 input/output）、按 PricingTable 折算费用。
- 净收益（§9.5）：`净省 = 对照累计成本 −(新路径累计成本 + 摘要调用成本)`；摘要自己花的钱计入，不报虚数。
- 产 markdown 对比表骨架（bench 与真实 A/B 共用同一 analyzer）。

**Acceptance:** analyzer 纯函数化可单测；对 Task 1 的两条流产出对比表；费用口径含摘要开销。

- [ ] JSONL 解析 + 汇总
- [ ] PricingTable 折算 + 净收益口径
- [ ] 对比表生成 + 单测

### Task 3: 真实小样本 A/B runner + 跑 + 报告（⚠ 用户批 3 任务后执行）

**Files:**
- Add: `scripts/curator-ab-run.sh`（headless 跑 wraith：同 jar，`-Dwraith.context.curator.enabled=true/false`，隔离临时 userData，收 `context-metrics.jsonl`）
- Add: `docs/.../reports/phase-d-ab.md`（真实对比表 + 净收益 + 结论）

**Interfaces:**
- 3 个真实任务（**先给用户过目批准**）× {on, off} = 6 会话；每会话隔离 userData → 收各自 metrics JSONL → 喂 Task 2 analyzer。
- 表列（§9.4）：累计 input / cache 命中率 / 摘要开销 / DeepSeek 费用 / 触发水位（估算 vs 真实偏差）/ 重复工具调用次数（相同 tool+args≥2）/ 可回取率（旧 0% vs 新 100%）。

**Acceptance:** 用户批准任务后真跑；报告数字全部可溯到会话；不编造。

- [ ] runner 脚本（隔离 userData + 双策略）
- [ ] 提 3 任务给用户过目 → 批准
- [ ] 跑 6 会话 + analyzer + 报告

### Task 4: Phase C 收敛 — tier 阈值单一来源

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/inline/BottomStatusBar.java`（`tierOfPercent` 引用 `WatermarkGauge.TIER1/2/3`×100，不再硬编 60/80/95）
- Modify: `desktop/src/shared/contextTier.ts`（阈值抽为具名常量 + 注释锚定后端；加一致性守卫思路）
- 核实：`ContextStateAggregator`（若有硬编则一并引用 gauge；无则免动）
- Test: 断言 tierOfPercent 与 WatermarkGauge 阈值一致。

**Acceptance:** Java 侧 tier 判定唯一来源 = WatermarkGauge；TS 侧集中一处 + 与后端值一致（测试或注释锚定）。基线不降。

- [ ] BottomStatusBar 引用 gauge 常量
- [ ] contextTier.ts 常量收敛
- [ ] 一致性测试

### Task 5: Phase C 收敛 — ContextPanel render 测试 + e2e 补跑

**Files:**
- Add: `desktop/test/contextPanel.test.tsx`（组件级 render：水位条/累计/历史/手动压缩守卫）
- 跑：desktop e2e 套件一次（合并后回归；勿与其他 Electron E2E 并发）。

**Acceptance:** ContextPanel render 测试通过并纳入 vitest；e2e 套件补跑一次记录结果。

- [ ] ContextPanel render 测试
- [ ] e2e 套件补跑 + 记录

### Task 6:（验收结论后，单独确认再做）删 legacy + 开关

- 真实 A/B 通过后：删 `ConversationHistoryCompactor` 自动路径与 `wraith.context.curator.enabled` 开关（`compactIfNeededProtecting` 代位一并处理）。**本期先出结论，删除动作单独经用户点头。**

---

## 交付顺序

1(bench)→ 2(analyzer)→ 4/5(Phase C 收敛，独立可并)→ 3(真实 A/B，卡用户批任务)→ 6（结论后）。
