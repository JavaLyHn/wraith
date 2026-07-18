# ContextCurator Phase C 设计:桌面可观测 UI + TUI 徽标 + Phase B 留档收口

日期:2026-07-18
状态:设计已与用户逐节确认,待用户审阅 spec
上游:总 spec `2026-07-17-context-curator-design.md`(§7 可观测/§8 Phase C 行);Phase B 已合入并 push(origin/main 至 19147dd,终审 Ready to merge: YES);Phase B 终审留档 6 项全部纳入本期(用户定)。

## 0. 范围

1. 桌面数据层:reducer 接住已在飞的 `context.watermark`/`context.compaction` 事件(现状:EventStreamRenderer.java:355 已外发,transcriptReducer 无 case 即丢弃)。
2. 水位显示:StatusChip 升级四档色 + 真实锚点口径;ContextPanel 头部水位条。
3. ContextPanel:RightDock 新面板(用户已选定落位),点 StatusChip 打开。
4. compactNow 防-兜-报收口 + CompactionResult 回报字段(留档①,spec §7 偏差)。
5. 后端小件:快照 ratio 按当前 window 重算(留档②)、reconnect/项目切换入口拉快照(留档④)、headless 装配点接 pricingTable(留档⑤)、Main JSONL 聚合抽方法补测(留档⑥)。
6. TUI:BottomStatusBar tier 徽标。

不做(YAGNI):tier3 savedTokens 真实回填(Phase D bench 一并)、压缩历史持久化跨会话回放(本会话内存即可,重启后由 metrics JSONL 聚合恢复累计数字而非逐条历史)、水位条动画。

## 1. 桌面数据层(transcriptReducer 新增 context 切片)

`state.context`(新):

```ts
interface ContextObservability {
  watermark: { usedTokens: number; window: number; ratio: number; tier: number } | null
  compactions: CompactionEntry[]      // 本会话,内存,追加式
  liveSummary: string | null
  totalsFromSnapshot: { inputTokens: number; outputTokens: number; cachedInputTokens: number;
                        estimatedCost?: string; estimated: boolean } | null
}
interface CompactionEntry {
  ts: number                          // 前端收到时间戳
  tier: number; beforeTokens: number; afterTokens: number
  snipped: number; pruned: number; summarized: boolean
  fallback?: 'cooldown' | 'emergency'
  manual?: boolean
  savedTokens: number
  items?: { index: number; tool?: string; releasedEstTokens: number; logPath?: string }[]
}
```

三来源合并规则:
- `context.watermark` 通知 → 覆盖 `watermark`(真实锚点口径,最高优先)。
- `context.compaction` 通知 → push 进 `compactions`(上限 200 条,超出丢最老)。
- `context.state.get` 快照(启动/切会话已在拉)→ 初始化 `watermark`(快照的 usedTokens/ratio/tier,`estimated` 标注)、`liveSummary`、`totalsFromSnapshot`;**不**伪造历史条目。
- 切会话/新会话 → 整个切片重置(与后端 `resetConversationState` 语义对齐)。

StatusChip 百分比口径:`watermark.ratio` 存在时优先(`Math.round(ratio*100)`),否则回退现状 `totalTokens/contextWindow` 估算——消除"徽标估算、事件真实"双口径。

## 2. 水位显示与四档色

- 色阶(单一来源,常量导出供 chip/条/TUI 文档对齐):tier0 绿 / tier1 黄 / tier2 橙 / tier3 红。
- StatusChip:边框+文本色随 tier;`estimated` 时百分比后缀 `~`(如 `◓ 62%~`);点击打开 ContextPanel(RightDock)。
- ContextPanel 头部水位条:横向进度条 + 百分比 + tier 标签("宽裕/整理/释压/兜底"),同色阶。
- `savedTokens` 显示一律标注"估算"(总 spec §7:Tier1/2 节省是估算值;tier3 真实回填留 Phase D)。

## 3. ContextPanel(RightDock 新面板)

布局自上而下(用户已确认 ASCII 稿):
1. **水位区**:水位条 + `usedTokens/window` + tier 标签。
2. **累计区**:累计节省 tokens(estimated 标注;来源=compactions 的 savedTokens 求和)、cache 命中率(累计 cachedInputTokens ÷ inputTokens,分母 0 显 `—`)、成本。**累计口径**:输入/输出/缓存/成本优先取 `state.status`(status 通知,轮次内实时更新);status 尚无数据(重启恢复未发消息)时用 `totalsFromSnapshot`。成本(有值显示;**未配价显 `—` + 一次性提示**"该模型未配置价格,在 config.json 的 pricing 里加一条即可显示成本"——每会话至多提示一次,留档③)。
3. **压缩历史**:每 CompactionEntry 一行——tier 徽标(四档色)+ 动作摘要(`snip×N`/`prune×N`/`已摘要`/`兜底`/`冷却`)+ `before→after`(formatTokens)+ 相对时间;行可展开 items 明细(tool 名 + 释放量 + logPath 可复制);`manual` 行加"手动"标。
4. **活摘要预览**:`liveSummary`(SUMMARY_MARK 已在后端剥离)等宽字体、可滚动、最大高度约束;null 显示"尚未生成活摘要"。
5. **手动压缩按钮**:面板底部;现有 composer 侧按钮保留不动(总 spec §7"收敛到面板或工具条"→ 双入口共存,行为一致)。

打开路径:点 StatusChip;RightDock 面板注册方式照 MemoryPanel/AutomationsPanel 既有模式。

## 4. compactNow 防-兜-报收口(留档①,spec §7 偏差)

- `ContextCurator.compactNow`:摘要失败 → 与 curate 同一套语义:EMERGENCY prune 兜底 + 进入 cooldown + `fallback` 标记;事件 payload 已有 `manual:true`,补 `fallback` 键。
- 返回值:`boolean` → `record ManualCompaction(boolean any, boolean summarized, String fallback)`(fallback null=未走兜底)。
- `Agent.CompactionResult` 加字段 `summarized`/`fallback`(既有 4 字段不动,兼容序列化);busy 互斥不变。
- RPC `session.compact` 结果随 record 自然多两键;`compactView.ts` 文案升级:
  - 已摘要:`✅ 已压缩上下文:X → Y tokens(含增量摘要)`
  - 零成本兜底:`⚠️ 摘要暂不可用,已零成本压缩:X → Y tokens`
  - 无变化:`上下文未超阈值,无需压缩`;失败:现状保留。

## 5. 后端小件(留档②⑤⑥ + ④)

- **② ratio 重算**:Main 聚合尾行时不再直取尾行 ratio,改 `usedTokens(尾行) ÷ 当前 llmClient.maxContextWindow()` 重算,`tier` 按重算 ratio 对照阈值判档(总 spec §6 原文"按当前 window 重算");usedTokens 从尾行恢复进快照。
- **④ 入口拉快照**:reconnect 效果(App.tsx ~L399)与 switchToProject(~L678)成功路径补 `contextState()` 拉取 + 信封包裹 dispatch(与既有两处同款,共四入口全覆盖)。
- **⑤ headless pricingTable**:`Main.runHeadlessTaskAt`(~L2112)Agent 装配点补 `agent.setPricingTable(new PricingTable(<该处可得的 config>.getPricing()))`;该处无 config 变量则按该函数实际参数/闭包取,取不到再报设计问题。
- **⑥ 聚合抽方法**:Main 匿名 runner 里的 JSONL 聚合逻辑抽成 `com.lyhn.wraith.runtime.appserver.ContextStateAggregator`(静态方法 `merge(Map<String,Object> core, Path metricsFile, long currentWindow)`,含 ratio 重算),Main 调用变薄;@TempDir 单测覆盖:usage 行求和/compaction 行跳过/坏行跳过/cost 单币聚合/混币缺席/尾行 ratio 重算/estimated 翻转/文件缺失原样返回。

## 6. TUI 徽标

`BottomStatusBar` 已有 token 显示旁加 tier 徽标:`●` + tier 标签,ANSI 四档色,**tier≥1 才显示**(tier0 不加噪音);数据源 StatusInfo 现有字段推导(ratio = totalTokens/contextWindow)——TUI 无 watermark 事件通道,估算口径即可,不为此加通道(YAGNI)。

## 7. 测试与验收

- reducer 纯函数测:三来源合并、compaction 追加与 200 上限、切会话重置、watermark 优先于估算。
- ContextPanel 轻组件测(vitest):空态/有数据/未配价 `—`/活摘要 null。
- compactView 文案新分支测。
- Java:compactNow 新语义(FakeSummarizer:失败→fallback+cooldown;顺带补终审留档的 cooldown 到期重试 e2e 与成功路径 fallback 缺席断言);ContextStateAggregator @TempDir 全分支;CompactionResult 新字段。
- 红线不变:测试不写真实 ~/.wraith;密钥不进快照/日志;异常只报类名。
- 基线:Java 1527 不降、desktop tsc 0、vitest 678 不降;真机眼验(用户):水位条变色、面板打开有历史、手动压缩文案区分兜底。
