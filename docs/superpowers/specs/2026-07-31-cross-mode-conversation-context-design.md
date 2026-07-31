# 跨模式对话上下文注入 —— 设计 Spec

> 日期:2026-07-31 · 分支:`fix/cross-mode-conversation-context`(基点 `main`)

## 1. 问题

三种 Agent 模式(ReAct / Plan / Team)不共享同一份对话记录。权威的多轮 transcript 只存在于长驻的 ReAct `Agent.conversationHistory`(`agent/Agent.java:51`);Plan / Team 每轮现造,构造时只拿到共享的 `ToolRegistry` 和 `MemoryManager`,**从不拿 `getConversationHistory()`**;Team 的 planner(`SubAgent`)连 `MemoryManager` 都没有,被调用时只喂 `"请为以下任务制定执行计划：\n" + userInput`(`agent/AgentOrchestrator.java:169-170`)。

后果:在 ReAct 里做了一轮(如 `git clone`),切到 Team 打「继续」,planner 看不到任何前文,「继续」无指代 → 输出"我当前没有之前对话的上下文" → 产不出合法计划 → 团队回合失败。

### 丢失矩阵(判定:切入的目标模式有没有读到承载源模式轮次的通道)

| 切换(A 后切到 B 打「继续」) | 现状 | 修复后 |
|---|---|---|
| ReAct → Team / Plan → Team | 丢 | 修 |
| ReAct → Plan / Team → Plan | 规划时丢(执行阶段靠 MemoryManager 部分找回) | 修(规划时也有上下文) |
| Plan → ReAct / Team → ReAct | 不丢 | 不变 |

另有 **CLI 比桌面更差**:桌面跑完 Plan/Team 会 `agent.recordExternalTurn(...)` 把该轮写回 ReAct transcript(`cli/Main.java:2030/2125`),CLI 主循环**没调**(`cli/Main.java:909/918` 直接 return,`:938` 只 persist reactAgent 历史,而该历史从未记入 Plan/Team 轮次)→ CLI 里 Plan/Team 轮次连 ReAct 都进不去。

## 2. 目标 / 非目标

**目标**
- 切入 Plan / Team 的「决策入口」(计划生成 / planner)能看到主线近期对话,正确解析「继续/它/上面」等指代。
- CLI 与桌面行为对称(补 `recordExternalTurn`)。
- digest 为空时,Plan/Team 的出站提示词**与现状逐字节一致**(零回归红线)。

**非目标**
- 不改 worker / reviewer 的每步 `clearHistory()` 隔离(刻意设计,保留)。
- 不做统一 transcript 大重构(方向 C,已否)。
- 不引入每轮额外 LLM 调用。
- 不改 ReAct 自身行为。

## 3. 方案总览

新增纯函数摘要器 `ConversationDigest`,在每轮进入 Plan/Team 前,从 `agent.getConversationHistory()` 生成一段有界的"近期对话"文本,注入到**计划生成**(`Planner.createPlan`)和 **Team planner** 两个入口;并补齐 CLI 的 `recordExternalTurn`。

## 4. 组件设计

### 4.1 `ConversationDigest`(新增,纯函数,可单测)
包:`com.lyhn.wraith.agent`。无状态,静态方法:

```java
public final class ConversationDigest {
    public static final int DEFAULT_MAX_ROUNDS = 4;
    public static final int DEFAULT_MAX_CHARS  = 2500;
    public static final int TOOL_RESULT_PREVIEW_CHARS = 200;
    public static final int TOOL_ARGS_PREVIEW_CHARS   = 120;

    /** 供注入的完整块;历史为空/仅 system → 返回 ""。 */
    public static String of(List<LlmClient.Message> history);
    public static String of(List<LlmClient.Message> history, int maxRounds, int maxChars);
}
```

**算法**
1. 跳过开头的 system 消息。
2. 从尾部向前,按「user 消息 → 其后到下一条 user 前的 assistant/tool 消息」聚成一轮,收集至多 `maxRounds` 轮。
3. 按时间正序(旧→新)渲染,便于 planner 顺读:
   - user → `用户: <trim 后正文>`
   - assistant 正文 → `助手: <正文>`
   - assistant 的 tool_calls → 每个 `[工具 <name>: <args 摘要 ≤120 字>]`
   - tool 结果消息 → `  ↳ 结果: <前 200 字>…`(超长加省略号)
4. 总长超 `maxChars`:从最旧一轮起整轮丢弃,直到不超;若发生丢弃,顶部加一行 `(仅显示最近若干轮)`。
5. 全空 → `""`。
6. 输出**不含**"对话上下文…"这层前缀(前缀由注入点统一加,见 4.4)——digest 只负责内容主体。

**确定性**:不调 LLM、不依赖时间/随机;同输入同输出(可精确断言)。

### 4.2 `AgentOrchestrator`(Team 注入)
- 新增字段 `private String conversationContext = ""` + `public void setConversationContext(String)`(null → `""`)。
- `run()` 内组装 planner 任务处(`AgentOrchestrator.java:169-170`)改为:

```java
String planTaskBody = "请为以下任务制定执行计划：\n" + userInput;
if (!conversationContext.isBlank()) {
    planTaskBody = INJECT_PREFIX + conversationContext + "\n\n" + planTaskBody;
}
AgentMessage planMessage = AgentMessage.task("orchestrator", planTaskBody);
```

- `INJECT_PREFIX`(共享常量,见 4.4)。worker(`:537`)/reviewer 任务拼装**不动**。

### 4.3 `Planner` + `PlanExecuteAgent`(Plan 注入)
- `Planner`:仿 `setProjectMemorySupplier` 增 `private Supplier<String> conversationContextSupplier = () -> ""` + `setConversationContextSupplier(...)`。`createPlan(goal, extra)` 里拼 user 消息处(`Planner.java:72-73`)改为:

```java
String userBody = "请为以下任务制定执行计划：\n" + goal;
String convo = safeGet(conversationContextSupplier);   // 异常吞掉返回 ""
if (!convo.isBlank()) {
    userBody = INJECT_PREFIX + convo + "\n\n" + userBody;
}
... LlmClient.Message.user(userBody) ...
```

  `isSimpleGoal(goal)` 早返回分支(`createMinimalPlan`)不注入(简单任务不走 LLM 规划,无需上下文)。
- `PlanExecuteAgent`:仿 `externalContextSupplier` 增 `private String conversationContext = ""` + `public void setConversationContext(String)`;构造里(`PlanExecuteAgent.java:170` 附近,已 `planner.setProjectMemorySupplier(...)`)追加 `this.planner.setConversationContextSupplier(() -> this.conversationContext)`。

### 4.4 共享常量 `INJECT_PREFIX`
```
"对话上下文(来自主线会话,供理解『继续/它/上面』等指代):\n"
```
放在 `ConversationDigest` 里作 `public static final String INJECT_PREFIX`,Team/Plan 两处引用同一常量(避免措辞漂移)。

### 4.5 接线(快照取自 `agent.getConversationHistory()`)
每轮进入前生成 `String digest = ConversationDigest.of(agent.getConversationHistory())`,再 setter 注入:
- **桌面 Team**:`cli/Main.java` 在 `orchestrator.run(goal)`(`:2015`)前 `orchestrator.setConversationContext(digest)`。
- **桌面 Plan**:在 `planAgent.run(goal)`(`:2111`)前 `planAgent.setConversationContext(digest)`。
- **CLI Team**:`createTeamAgent(...)` 返回后(lambda 内,`:915-918`),已持 `reactAgent`,`orchestrator.setConversationContext(ConversationDigest.of(reactAgent.getConversationHistory()))`。
- **CLI Plan**:`:905-909` 同理注入 `planAgent`。

> 桌面的 `agent.getConversationHistory()` 因既有 `recordExternalTurn` 已含跨模式轮次;CLI 在 4.6 补齐后同样完整。

### 4.6 CLI 对称(补 `recordExternalTurn`)
`cli/Main.java` 主循环(`:930-938` 附近),拿到 `response` 后、`sessionStore.persist(...)` 前:

```java
if (!"react".equals(snapshotMode) && response != null && !response.isBlank()) {
    reactAgent.recordExternalTurn(taskInput, response);
}
sessionStore.persist(reactAgent.getConversationHistory());
```

镜像桌面 `:2030/2125`。这样 CLI 的 `getConversationHistory()` 完整,4.5 的 digest 才拿得到跨模式历史,且 `/resume` 续接也含 Plan/Team 轮次。

## 5. 零回归红线

- digest 为空(全新会话首轮即 Plan/Team,或历史仅 system):INJECT 分支不触发,`Planner` / `AgentOrchestrator` 出站的 system + user 消息**与现状逐字节一致**。必须有测试锁定。
- worker / reviewer 的任务拼装、每步 `clearHistory()`、`buildStepContext` 一律不动。
- ReAct 路径完全不碰。
- `createPlan(goal)`(无 supplier 时)行为不变。

## 6. 测试(TDD)

**`ConversationDigestTest`(纯单测,主力)**
- 空 list / 仅 system → `""`。
- 单轮 user+assistant → 含 `用户:` / `助手:`,不含 INJECT_PREFIX(前缀不在 digest 内)。
- 多轮超 `maxRounds` → 只保留最近 N 轮,更早被丢,顶部有 `(仅显示最近若干轮)`。
- assistant tool_calls + tool 结果 → 渲染 `[工具 …]` 与 `↳ 结果:`,结果超 200 字截断加省略号。
- 总长超 `maxChars` → 整轮丢弃直到不超。
- 时间正序(旧→新)。

**注入单测(用 recording 假 `LlmClient` 捕获出站 messages,仿 `AgentWebSearchDecisionTest` / `SubAgentReviewStreamTest` 的替身模式)**
- `Planner`:设非空 conversationContextSupplier → 捕获的 user 消息以 `INJECT_PREFIX` 开头且含 digest;设空 → user 消息 == `"请为以下任务制定执行计划：\n" + goal`(逐字节)。
- `AgentOrchestrator`:`setConversationContext(非空)` → planner 收到的任务体含 INJECT_PREFIX + digest;`setConversationContext("")` 或未设 → 任务体 == 现状。worker/reviewer 任务体断言不含注入块。

**CLI 对称单测**
- 若主循环可测:构造一次非 react 轮,断言之后 `reactAgent.getConversationHistory()` 比之前多了该轮(user+assistant)。若主循环不便直接测,则以 `Agent.recordExternalTurn` 既有行为 + 桌面路径已测为据,单测覆盖到 `recordExternalTurn` 语义即可,并在计划里记明该缺口由桌面对等路径背书。

**回归**:`mvn -DskipTests=false test` 相关包全绿;既有 `AgentClearHistoryTest` / `SubAgentReviewStreamTest` 等不破。

## 7. 影响文件

- 新增:`src/main/java/com/lyhn/wraith/agent/ConversationDigest.java`
- 改:`agent/AgentOrchestrator.java`(setter + planner 任务注入)
- 改:`plan/Planner.java`(supplier + user 消息注入)
- 改:`agent/PlanExecuteAgent.java`(setter + 转发给 planner)
- 改:`cli/Main.java`(桌面/CLI 四处注入接线 + CLI `recordExternalTurn` 对称)
- 新增测试:`ConversationDigestTest` + Planner/Orchestrator 注入测试(具体文件在实现计划里定)

## 8. 取舍记录

- **确定性摘录 vs LLM 摘要**:选确定性(无延迟/成本,「继续」指代通常在最近一两轮,摘录足够)。现有 `ConversationHistoryCompactor.summarize` 是主线超限压缩用,不适合每轮 Plan/Team 调。
- **只注入决策入口 vs 全量灌 worker**:只注入 planner / 计划生成;worker 每步隔离是刻意设计,保留。
- **方向 A vs B(共享 MemoryManager)/ C(统一 transcript)**:A 直击指代问题、改动小、零回归可锁;B 存的是提炼事实非逐字记录,取不到「继续」的具体指代;C 大重构、破坏 worker 隔离,已否。
