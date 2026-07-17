# wraith 下一代上下文压缩:ContextCurator 四级水位线 设计稿

日期:2026-07-17
状态:设计已与用户逐节确认(方案 A + 完整四级 + 完整面板 + 落盘回取 + 效益度量),待用户审阅 spec
参考:《横向拆解 Claude Code、Codex 等六大 Agent 上下文压缩策略后,我们做了第 7 个》(mervynyang)七条共识;wraith 现状勘察(2026-07-17)。

## 0. 现状与动机(勘察结论)

wraith 现为"第 1.5 代":`ConversationHistoryCompactor` 单层全量 LLM 摘要(自动 ≥ ~74% 触发保 3 user 轮 / 手动 force 保 1 轮),token 用字符估算(中文/1.5+其他/4,中英混合低估 30-50%),无零成本层、无增量摘要、无工具分级、cache 不感知(`ChatResponse.cachedInputTokens` 已回传但无人用)。做对的底子:user 边界切割、tool_call/result 成对保护、LLM 失败即放弃、手动+自动双模式、工具入口截断(execute_command 8k/grep 24k/fetch 8k)、`pruneHistoricalImagePayloads` 图片裁剪雏形。另有与真实 LLM input 脱钩的 `ContextCompressor`(短期记忆,本设计不动)。

三刀最痛:**没有零成本层、全量非增量、假 token**。

## 1. 水位线与 Tier 行为

`ratio = 上一次 ChatResponse 真实 inputTokens ÷ contextWindow`。首轮/重启后无 usage 时退回字符估算,真实值一到永久接管("真实优先,估算兜底";估算继续用于内部排序——先压哪条)。

| Tier | 水位 | 动作 | LLM 成本 |
|---|---|---|---|
| 0 | <60% | 不动 | 0 |
| 1 Snip | ≥60% | 保护区外、非保护名单工具输出截短(头部若干行 + `…[原 N 字符,完整日志 {path}]`);用户消息超大 markdown 代码块截短(fence 头+前几行+总行数),**用户纯文本一字不动** | 0 |
| 2 Prune | ≥80% | 已 snip 的换占位符(仍带日志路径);老 assistant 长回复裁前两句+`[truncated]` | 0 |
| 3 Summarize | ≥95% | 先补跑 1+2,再增量摘要(§4) | 1 次调用,输入=活摘要+delta |

- Tier 累积:高档先执行低档 pass。
- 阈值 60/80/95、目标线 50、保护区预算等全部为 WraithConfig 可覆盖常量;任一阈值调到 1.0 即禁用对应 Tier。
- **手动压缩按钮**:语义从"force 全量摘要保 1 轮"变为"force 跑完整流水线 1+2+3"(保护区仍不动)。

## 2. 批量大跳 + 滞回(单调边界,防滑窗缓存病)

- 不做"保留最近 N 条"的相对窗口。触发 ≥60% 时 SnipPass 从最老端开始**一次性批量**压到 50% 目标线以下;下次触发须等真实水位再涨 ~10%。
- snip/prune 是**破坏性原地改写**:content 直接变截断版,带机器可读尾标(如 `⟦wraith:snip⟧`)标识"已处理",pass 见标即跳过——单调性不靠账本防重,天然免费;会话持久化恢复的就是已压内容,重启后依然单调。
- 收益:批量之间消息前缀字节稳定,DeepSeek 自动前缀缓存持续命中,只在每次批量点后失效一次;绝不出现"每 step 滑一格、每步 cache_write 重写"的第二代实施陷阱。

## 3. 落盘回取(存储分离本地版)

- 时机:工具执行完、入口截断**之前**。原始输出超过入口截断阈值 → 全量写 `~/.wraith/sessions/{sessionId}/tool-logs/{seq}-{tool}.log`(实际目录随 SessionStore 现有布局,plan 期勘察定)。
- 截断版、snip 版、prune 占位符尾部都带该路径:模型可自行 `read_file` 回取,桌面面板可点开。**被压 ≠ 丢**。
- 单文件上限 2MB(超出截尾并标注);写盘失败只 log、不影响主流程;日志随会话删除。

## 4. 增量摘要(Tier 3)

- history 驻留一条**活摘要**消息:`[system] + [user "[活摘要]"+summary] + [assistant "好的…请继续"] + [中段(已被 1/2 压过)] + [保护区]`。
- 触发时:delta = (上次摘要点, 保护区起点) 的全部消息;LLM 输入 = 旧活摘要 + delta → 合并出新活摘要,替换旧摘要、删除 delta。首次触发旧摘要为空,等价普通摘要。
- 摘要结构化四段:**进展 / 文件与代码 / 待办 / 约束与偏好**,中文,目标上限 ~2k token。
- 分割点必落 user 边界、tool 对不拆、LLM 失败或空摘要即放弃原样保留——全部继承现有正确行为。
- 不做 Codex 式"近 20k 用户原文"(保护区已保近端,YAGNI)。

## 5. 保护区与红线

- 保护区 = 尾部累计 min(12k, window×25%) token(可配)外扩到 user 消息边界,且至少最近 2 个完整 user 轮(小窗口模型下钳制,防保护区吞掉整个窗口)。
- 红线(任何 Tier 不动,不存在"救场破例";压不动就让上下文爆,不硬删):

| 内容 | 原因 |
|---|---|
| 保护区内一切 | 短期连贯性命脉 |
| 用户消息纯文本(仅代码块可 snip) | 用户意图即任务来源 |
| system prompt | 行为契约 |
| 保护名单工具输出:`load_skill` / `save_memory` / `revert_turn` | 技能正文=工作知识;记忆写入极小;状态回滚凭据 |
| 活摘要消息本身 | 唯一的历史载体 |

- 其余工具(read_file / grep_code / search_code / glob_files / list_dir / execute_command / create_project / web_search / web_fetch / browser_*)默认可压;新工具默认可压,保护靠名单显式声明。

## 6. 架构落位(方案 A)

新包 `com.lyhn.wraith.context.curator`:

| 单元 | 职责 | 依赖 |
|---|---|---|
| `ContextCurator` | 编排:水位判档→依次跑 pass→发事件 | 下面全部 |
| `WatermarkGauge` | 真实 usage 记账 + 估算兜底 + 档位/滞回判定 | ChatResponse usage |
| `SnipPass` / `PrunePass` | 零成本改写(纯函数:history+预算→变更集) | ToolTierPolicy |
| `IncrementalSummarizer` | 活摘要 delta 合并 | LlmClient(可注入假实现) |
| `ToolTierPolicy` | 保护名单/可压名单/代码块规则 | 配置 |
| `CurationStats` | 面板统计 + metrics JSONL 落盘(§9);不承担单调性 | — |

- 接线:`Agent.maybeCompactHistory()` → `curator.curate(history, lastUsage)`(每 step 调 LLM 前);`Agent.compactHistoryNow()` → `curator.compactNow(history)`。
- 退役:`ConversationHistoryCompactor`(边界切割逻辑吸收进 `IncrementalSummarizer`);`ContextCompressor`(短期记忆)与 `pruneHistoricalImagePayloads` 不动(图片裁剪后续可折入 SnipPass,本期不并)。
- 回退开关:`wraith.context.curator.enabled=false` 走旧路径(旧类保留至 Phase D bench 验收——它同时是 A/B 对照组;之后连开关一起删)。

## 7. 可观测:事件 + 桌面完整面板 + TUI

- 事件(走 AppServer 现有事件通道,新增两类):
  - `context.watermark`:每次 LLM 响应后 `{usedTokens, window, ratio, tier}`;
  - `context.compaction`:每次治理后 `{tier, beforeTokens, afterTokens, snipped, pruned, summarized, savedTokens, durationMs, items:[{tool, chars, logPath}]}`。
- 桌面:状态区**水位条**(百分比+四档色:绿/黄/橙/红);点击展开**压缩面板**——本会话压缩历史(每事件一行可展开明细 items)、累计节省 tokens、cache 命中率、**当前活摘要预览**(用户可见模型"还记得什么")。手动压缩按钮保留(收敛到面板或工具条,plan 期定)。
- TUI:BottomStatusBar 加 tier 徽标(已有 token 显示)。

## 8. 分期

| Phase | 内容 | 验收 |
|---|---|---|
| A 后端核心 | curator 包 + 真实 token + Tier1/2 + 落盘 + 滞回单调 + 事件发射 + metrics JSONL + 旧自动路径切开关 | Java 测试全绿(基线 4F/38E 噪声外零新增);确定性单测覆盖 §10 |
| B Tier3 增量摘要 | IncrementalSummarizer + 手动按钮换语义 + 旧 compactor 从默认路径退役(类与开关保留——它是 Phase D bench 的对照组,验收后删) | 同上 + 假 LlmClient 单测 |
| C 可观测 | 桌面水位条 + 压缩面板 + TUI 徽标 | desktop typecheck 0 + vitest 基线不降 |
| D 效益收尾 | 确定性回放 bench + 真实小样本对比报告 | §9 报告产出 |

每期独立可合;push 需用户单独点头。

## 9. 效益度量(设计验收物)

1. **metrics 流水**:`CurationStats` 每次 LLM 调用记一行 JSONL 至 `~/.wraith/sessions/{id}/context-metrics.jsonl`:`{step, inputTokens, outputTokens, cachedInputTokens, ratio, tier, compaction?}`——面板与 bench 共用。
2. **旧路径开关即 A/B**:`curator.enabled=false` 为对照组,同 jar 双策略。
3. **确定性回放 bench**(免费可复现):录制/回放 mock LlmClient + 脚本化长会话(把上下文推过窗口 150%),测 token 力学——每 step input 曲线、**相邻 step 公共前缀长度**(cache 命中代理,离线证明单调边界)、触发水位分布、Tier3 输入长度(全量 vs delta)。
4. **真实小样本报告**:3 个真实任务会话 × 新旧各一遍,产 markdown 对比表:累计 input tokens / cache 命中率 / 摘要开销 / DeepSeek 分价折算费用 / 触发水位(估算 vs 真实偏差)/ 重复工具调用次数(鬼打墙代理:相同 tool+args ≥2 次)/ 可回取率(旧 0% vs 新 100%)。
5. **净收益口径**:`净省 = 对照累计成本 −(新路径累计成本 + 摘要调用成本)`——Tier3 自己花的钱计入,不报虚数。
6. 日常层:压缩面板常驻"本会话累计节省 X tokens / cache 命中率 Y%"。

预期假设(待实测,不承诺):旧路径字符估算低估致实际触发常在 90%+ 悬崖;新路径 60% 起零成本释放 + delta 摘要 + 前缀单调,累计 input 与 cache 命中两头改善。

## 10. 测试策略

- pass 纯函数化单测:tool 对不拆、user 边界、豁免表、滞回目标(压到 <50%)、**单调性(同一 history 跑两遍 pass,第二遍零变更)**、估算 fallback→真实接管、代码块截短不动纯文本。
- IncrementalSummarizer:假 LlmClient(注入式),摘要失败原样保留、delta 边界、活摘要替换。
- 落盘:@TempDir,单文件上限、写失败降级。**测试不得写真实 config/会话目录**(既有红线)。
- 桌面:watermark/compaction 事件 reducer 纯函数测 + 面板轻测;vitest 基线不降。
- Java 基线:`-DskipTests=false`,既有 ~4F/38E 为 JDK26+Mockito 噪声,不算新增失败。

## 11. 不做(YAGNI)

- 不做可逆隐藏(落盘已满足回取/审计);不做摘要后回放最后一条用户消息;不做 Codex 式用户原文 20k 硬保;不做跨会话长期记忆(MemGPT 向);不做服务端 context_management(DeepSeek 无此 API);不动 `ContextCompressor` 与短期记忆体系;不做多用户/跨进程一致性(单机单用户);图片裁剪本期不折入 curator。
