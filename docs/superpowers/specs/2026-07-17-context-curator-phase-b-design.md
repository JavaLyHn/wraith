# ContextCurator Phase B 设计:Tier3 增量活摘要 + 计量计价 + 状态快照

日期:2026-07-17
状态:设计已与用户逐节确认,待用户审阅 spec
上游:总 spec `2026-07-17-context-curator-design.md`(§4/§8 Phase B 行);Phase A 已合入 origin/main(至 fd97bbc,含审后加固)。
调研输入:桌面 md《横向拆解六大 Agent…》;web 2026 共识(LCM 三级升级/确定性兜底、Governance Decay"绝不静默"、summarizer context trap、DeepSeek/GLM 官方 usage 与计价)。

## 0. 范围

Phase B 在总 spec 基础上做四件事,并纳入本次 brainstorming 增补的两件:

1. `IncrementalSummarizer`:Tier3 换真正的增量活摘要,替掉 legacy 代位。
2. Tier3 失败处理:防—兜—报三层(总 spec §4"失败即放弃"的升级)。
3. 计量计价:事前校准估算 + 事后精确 usage + PricingTable(替掉硬编码价格)。
4. 手动压缩按钮换语义:force 跑完整流水线 1+2+3。
5. (增补)per-model 键控与模型切换刷新:多 provider 现实(8 分支 + generic 开放端点)。
6. (增补)状态快照 `context.state.get` RPC 后端 + 桌面最小接线(从 Phase C 提前,修"重启后空白/换模型不刷新"两个既有显示 bug)。

## 1. 活摘要(IncrementalSummarizer)

- **驻留形态**:`[system] + [user "[活摘要]"+summary] + [assistant "好的…请继续"] + [中段(已被 1/2 压过)] + [保护区]`(总 spec §4 原样)。
- **标识**:活摘要 user 消息内容嵌 `⟦wraith:summary⟧` 标记(CurationMarks 新增常量)。复用 Phase A 单调 mark 机制:SnipPass/PrunePass 见标跳过(红线:活摘要不动);summarizer 扫标定位替换。不依赖位置、会话持久化后依然认得。
- **delta** = (活摘要消息之后, protectedFrom) 区间全部消息;无活摘要时 = (systemEnd, protectedFrom),等价首次普通摘要。
- **合并**:LLM 输入 = 摘要 prompt + 旧活摘要 + delta → 新活摘要;替换旧摘要消息、删除 delta。分割点必落 user 边界、tool_call/result 对不拆、空摘要/异常即放弃(继承 legacy 正确行为,边界逻辑吸收进 summarizer)。
- **结构化四段**:进展 / 文件与代码 / 待办 / 约束与偏好;中文。
- **输出预算**:`min(window × 3%, 8k token)`,`-Dwraith.context.summary.outputBudget` 可配。理由:2k 定值是小窗口时代产物,1M 窗口下 0.2% 过紧,而"全量摘要丢细节"正是要逃的痛点。
- **LlmClient 注入式**(总 spec §6),测试用假实现。

## 2. Tier3 失败处理:防—兜—报

### 2.1 防 — 输入预算与 delta 分批(治 summarizer context trap)

- 摘要输入预算 `summaryInputBudget = min(window × 0.4, 128k token)`,`-Dwraith.context.summary.inputRatio` / `...inputCap` 可配。
  - ratio 0.4:输入要装下 prompt+旧活摘要+delta+输出,且给估算误差留边际(校准收敛后 plan 期可上调)。
  - hardCap 128k:1M 窗口下不设顶单次摘要输入可达 40 万 token——摘要任务自身也吃 context rot,且单次调用成本失控。
- `旧活摘要 + delta` 超预算 → 只取 **delta 最老的一段**塞满预算做本次合并,剩余留在 history 下轮再吞。增量语义天然支持分批,零额外机制。
- 单位统一 token(校准估算值),废除 legacy 的 60k **chars** 口径。

### 2.2 兜 — 应急 Prune(确定性,零 LLM)

关键认知:tier3 触发意味着常规 Snip/Prune 已跑过且不达标,同力度重跑零收益。兜底 = `PrunePass` 参数化加一档 **EMERGENCY 力度**(不是新类):

| | 常规 Prune | 应急 Prune |
|---|---|---|
| 工具输出 | 只压已 snip 的(≥1500 chars 才 snip) | 一切非保护工具输出→占位符(小输出积少成多,真实增量空间) |
| assistant | >1200 chars 才裁 | 阈值降至 ~200 chars |
| 红线(保护区/用户纯文本/保护名单/活摘要) | 守 | **一字不差,照守** |
| 单调 | `⟦wraith:prune⟧` 见标跳过 | 同一机制 |

占位符保留落盘指针——被压 ≠ 丢。对齐 LCM"最终兜底不需要 LLM 推理"共识。

### 2.3 报 — 节流与信号(绝不静默)

- 失败后 `summaryCooldown`(默认 3 个 curate 周期,`-Dwraith.context.summary.cooldown` 可配):冷却期内 tier3 只跑应急 Prune,不再调 LLM。
- 每次失败:`context.compaction` 事件带 `summarized:false, fallback:"emergency"` + metrics JSONL 一行 + `log.warn` 异常类名(密钥红线:只报类名)。失败留痕在事件流与 metrics,**不往 history 插标记消息**(95% 水位再塞 token 是自伤)。
- 应急压完仍 ≥95%(保护区+用户内容本身顶满窗口)→ Renderer 一次性提示:"上下文已满,零成本手段用尽,建议开新会话或收窄任务"。每次跨入该状态只提示一次。守总 spec §5 红线:不破保护区,宁可爆。

## 3. 计量:事前校准估算 + 事后精确

三个用途精度分层:水位触发判断(已精确:真实 usage 锚点,Phase A)/ 事前量(切批预算、释放目标、差分)/ 内部排序(相对量,估算够)。

物理边界:事前 100% 精确不存在——即便本地官方 tokenizer 也只精确到文本片段,请求总 input 还含 chat template/tools schema/系统注入,只有 API usage 知道。"真实锚点+本地差分"架构不可替代,Phase B 改进的是**差分怎么算**:

- **`TokenCounter` 抽象接口**,默认实现 = **校准估算**:每次真实 usage 到来,`真实 input ÷ 当时估算值` 做 EMA 校准系数,修正静态估算(中文/1.5+其他/4)的 30-50% 系统性偏差。
- 本地精确 tokenizer(DJL HF tokenizers,JNI)**不做**,接口留位将来可插。
- 事后:usage 三元组(input/output/cachedInput)已解析(`AbstractOpenAiCompatibleClient` 兼容 `prompt_cache_hit_tokens`/`prompt_tokens_details.cached_tokens`/`cached_tokens` 三方言),已喂 metrics JSONL,零新工作。

## 4. 计价:PricingTable

- **公式**:`cost = cache_hit×P_hit + (input−cache_hit)×P_miss + output×P_out`(每百万 token)。
- **数据源优先级**:config `pricing` 数组(用户自配,任意 provider/币种)> 内置种子(仅 deepseek/glm 等核过官方页的牌价;落码前对 api-docs.deepseek.com 与 bigmodel.cn/pricing 核准)> **缺席**。
- **未知模型**:metrics JSONL cost 字段整个缺席(不写 0——0=免费=错误信息);面板成本位显示 `—` + 一次性提示可在 config 配。token 显示不受影响。
- **不自动搜价**(定案):①聚合站数字不可靠不新鲜,虚数不进账本;②官方牌价 ≠ 用户实付(套餐 0.1 倍价/企业折扣/自建端点),用户自配是唯一正确口径;③CLI 联网搜价不值。
- 配了价但 API 不回传 cache 拆分 → 按全 cache-miss 算(保守偏高),面板标注口径。
- config 形态(plan 期定细节):`pricing: [{modelPrefix, cacheHitPerM, cacheMissPerM, outputPerM, currency}]`。
- **退役**:`TokenUsageFormatter` 硬编码单价路径由 PricingTable 收口替代。

## 5. per-model 键控与模型切换

多 provider 现实:factory 8 分支(glm/deepseek/step/kimi/freellmapi/xfyun/anthropic 协议/generic-openai),generic 端点模型名开放,穷举不可能。键 = `LlmClient.getModelName()`:

| 对象 | 键控 |
|---|---|
| 价目表 | modelName 前缀匹配 |
| 校准系数 | `Map<modelName, EMA>`——tokenizer 密度各异,跨模型污染;切回旧模型系数还在 |
| 水位锚点 | 锚点记录所属 modelName,切模型判失效→退回校准估算,新真实 usage 重锚(修 Phase A 隐患:现状切模型后一轮内拿旧锚算新模型水位) |
| 窗口/预算 | 已是 `maxContextWindow()` 动态,零新工作 |

**`Agent.setLlmClient()` 补三件**:同步 `IncrementalSummarizer`(否则摘要打旧模型)、gauge 锚点标失效、立即推一帧 status(见 §6)。

## 6. 状态快照与实时刷新(从 Phase C 提前)

既有 bug 根因:状态显示仅有"轮次内推送"一条腿(`Agent.pushStatus` 只在 ReAct run 内触发)→ 重启后发消息前空白;换模型不发消息则显示停在旧模型最后一帧(pushStatus 数据本是活的,缺触发)。

- **`context.state.get` RPC(后端)**,快照口径:

| 字段 | 来源 |
|---|---|
| model / window | llmClient 活取 |
| 水位 usedTokens/ratio/tier | metrics JSONL 尾行恢复(Phase A 已落盘)+ 按当前 window 重算 ratio;无真实锚点标注"估算,待首轮校准" |
| 累计 输入/输出/缓存命中 | 会话 metrics JSONL 聚合(会话累计,非进程累计) |
| 成本 | PricingTable,未知缺席 |
| 活摘要预览 | 本期新产物 |

- **桌面最小接线**:启动/切会话时拉一次快照填充 `StatusChip`;接收换模型触发的 status 推送。**范围边界**:水位条四色 UI、压缩面板大件仍留 Phase C。

## 7. 手动压缩换语义

- `Agent.compactHistoryNow()` 从 legacy `compactNow`(force 全量摘要保 1 轮)改为 `curator.compactNow(history)`:force 跑完整流水线 1+2+3,保护区仍不动;busy 互斥保留(Phase A 已做)。
- 摘要失败走 §2 同一套防-兜-报;结果如实回报前端(压了多少/是否摘要/是否兜底)。

## 8. 退役与回退

- legacy `ConversationHistoryCompactor` 从默认 tier3 代位退役:`curate` 的 `IntConsumer tier3Fallback` 接线由 summarizer 内化替代(签名回归无回调)。
- `wraith.context.curator.enabled=false` 回退路径保留,legacy 类保留——Phase D bench 对照组,验收后连开关一起删(总 spec §6 原计划)。
- `compactIfNeededProtecting`(fd97bbc)转为仅回退/对照用途;summarizer 在 curator 内天然拿 protectedFrom,是治本。

## 9. 测试策略

- **Summarizer**(假 LlmClient 注入):成功合并替换/失败放弃原样/空摘要放弃/delta 分批(超预算取最老段,剩余留下)/user 边界与 tool 对不拆/活摘要 mark 定位与二次合并。
- **应急 Prune**:红线一字不差(保护区/用户纯文本/保护名单/活摘要)、单调二遍零变更、相对常规档的真实增量收益。
- **校准估算**:EMA 收敛、per-model 隔离、切模型锚点失效→重锚。
- **PricingTable**:精确命中/前缀命中/缺席不写/币种/全 miss 保守口径。
- **state.get**:JSONL 尾行恢复、会话累计聚合、无 metrics 时估算标注。
- 红线:@TempDir,不写真实 config/会话目录;全量基线 1492 不降。

## 10. 不做(YAGNI)

- 不自动联网搜价;不上 tokenizer JNI(接口留位);不做换会话自动化(只提示);不做可逆隐藏/回放最后用户消息(总 spec §11 沿袭);桌面大 UI(水位条四色/压缩面板)留 Phase C。
