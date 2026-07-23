# wraith 自动记忆提取(候选待批式)设计

**日期**:2026-07-23
**状态**:设计待用户审阅
**范围**:跨栈单特性——Java 后端(抽取管线 + 候选队列 + 软超请 + 触发接线 + RPC)+ CLI(`/memory pending` 复核)+ 桌面(`MemoryPanel` 待确认区)。**不引 embedding/向量库/图库**,复用现有 JSON 存储 + 关键词检索 + HITL。

## 背景

wraith 长期记忆(`~/.wraith/memory/long_term_memory.json`)目前**只在显式意图下写入**(`/save`、`save_memory` 工具的"记住"触发、`ExplicitMemoryHints` 浏览器登录态特例),干活本身不沉淀。用户要补"从对话自动抽稳定事实"的缺口。

**核心张力=去噪**:自动沉淀一旦无门,长期记忆会被一次性任务/临时文件名/模型猜测/敏感信息撑满。业界调研(Mem0/Letta/Zep/ChatGPT/Claude memory tool/LangMem/grok-build/Generative Agents)的共识答案是:**LLM 抽取判据 + 重要度 + 去重 + 用户兜底**;且产品级越火越倾向**轻量文件 + 强 LLM**、而非重图库。wraith 独有 HITL + `MemoryPanel`,天然能把"候选待批"做成最硬的去噪门。

**已存在的建材(死代码)**:`ContextCompressor.extractFacts(entries, longTermMemory)`(`ContextCompressor.java:148`)+ `EXTRACT_FACTS_PROMPT`(:45)+ 规则过滤 `isPersistentFactCandidate`(:284,含 EPHEMERAL_FACT_PREFIXES / SPECULATION_CUES / DURABLE_FACT_HINTS)是一套**完整但从未接线**的自动抽取实现——`grep extractFacts` 零调用者、零测试引用,`source=fact_extractor` 仅出现在定义处。故"运行时无自动写入"成立,但抽取+去噪判据的建材已在。**本特性复用这套抽取资产**(重构出"只产候选、不落库"的纯方法),不另造抽取器;但把落库改成"候选待批"、并加软超请/scope/触发接线。

## 已敲定决策(用户确认)

1. **触发时机 = 会话边界**:`/clear`、退出、上下文压缩事件时**异步**跑一次抽取,不拖热路径。
2. **落库策略 = 候选待批**:抽取结果进「待确认」队列,`MemoryPanel`/CLI 人工批准/编辑/驳回才入正式库。
3. **巩固 = 追加 + 软超请**:新事实追加;与旧矛盾时给旧条打 `superseded` 标记,**不硬删**;检索跳过 superseded。

**替用户拍的默认(可否)**:存储/检索维持 JSON+关键词不上 embedding(DeepSeek 无 embedding 接口,YAGNI);抽取用当前会话 LLM;切片=上次抽取以来的对话历史;开关 `-Dwraith.memory.autoExtract` **默认开**(候选待批非破坏,开着不污染正式库);软超请**不自动判定**:入队仅挂"最相似既有条"提示,批准时人来选 ADD 还是替换旧条(更贴候选待批哲学)。

## 架构

```
会话边界(/clear 前、退出、压缩事件)
   │  异步(不阻塞回合)
   ▼
MemoryExtractionService
   ├─ 取对话切片(短期记忆 getShortTermMemory().getAll(),在 /clear 清空前)
   ├─ 复用 ContextCompressor 抽取(EXTRACT_FACTS_PROMPT + isPersistentFactCandidate)→ 候选事实串[]
   ├─ 敏感信息正则兜底丢弃(凭证/密钥等)
   ├─ 每条候选:MemoryRetriever 召回最相似既有条 → 近重则丢 / 否则挂 nearestExistingId 提示
   └─ 非重复候选 → PendingMemoryStore(pending_facts.json,op=ADD)
                                   │
             用户复核(MemoryPanel「待确认」/ CLI /memory pending)
                                   │ approve
                                   ▼
             MemoryManager.storeFact(ADD) 或 storeFact + 旧条 markSuperseded(SUPERSEDE)
                                   │
                          long_term_memory.json(检索时跳 superseded)
```

## 组件设计

### 后端(`com.lyhn.wraith.memory`)

**`MemoryExtractionService`(新)** —— 编排抽取全流程。
- 入口 `int extractFromSession(List<MemoryEntry> slice, String sessionId, String projectKey)`,返回入队候选数。
- 异步执行(单线程 executor 或在会话边界回调里 fire-and-forget),失败只记 log 不影响主流程。
- **抽取:复用 `ContextCompressor` 的资产**——把其 `extractFacts` 重构出纯方法 `List<String> extractFactCandidates(List<MemoryEntry>)`(用现有 `EXTRACT_FACTS_PROMPT` + `isPersistentFactCandidate` 规则过滤,**只产候选事实串、不落库**);service 调它拿候选串。不另写抽取 prompt。
- **去重 + 软超请提示**:对每条候选 `MemoryRetriever.retrieveLongTerm(fact, k, projectKey)` 拿最相似既有条。近乎重复(`LongTermMemory.store` 的精确内容去重之外,再按 token 重叠阈值)→ 直接丢弃不入队;否则把"最相似既有条 id"作为 `nearestExistingId` 提示挂到候选上(**不在此判定 supersede,交批准时人来定**)。
- 敏感信息正则兜底:命中凭证类模式的候选丢弃。
- 入队 `PendingMemoryStore.add(candidate)`,`op` 一律先记 `ADD`、带 `nearestExistingId?`。

**`PendingMemoryStore`(新)** —— 候选队列,JSON `~/.wraith/memory/pending_facts.json`(同 `-Dwraith.memory.dir`)。
- 条目:`{id, fact, type(默认 FACT), scope(默认 project), op(默认 ADD), nearestExistingId?, sourceSessionId, project, createdAt}`。(importance 本期不产出,见 YAGNI。)
- 方法:`add`、`list(project)`、`get(id)`、`remove(id)`、`clear(project)`。project 作用域隔离,同 `LongTermMemory` 的 currentProject 口径。

**`MemoryManager` 增补**:
- `approvePending(id)`:取候选 → `storeFact(fact, scope)`(ADD);从 pending 移除。
- `approvePendingReplacing(id, oldId)`:`storeFact(新)` + `longTermMemory.markSuperseded(oldId)`;从 pending 移除。(批准者看到 `nearestExistingId` 提示后选 ADD 还是替换。)
- `rejectPending(id)` / `listPending()` / `clearPending()`。
- 持有 `PendingMemoryStore` + `MemoryExtractionService`(构造注入或 setter,沿现有 `setLlmClient` 模式)。

**`LongTermMemory` 增补**:`markSuperseded(id)`(给 `MemoryEntry` metadata 加 `superseded=true` + `supersededAt`),`getAll()`/`search()` 默认过滤 superseded(留一个 `includeSuperseded` 重载供审计)。`MemoryEntry` 复用 metadata Map,不改构造签名。

**`MemoryRetriever` 增补**:检索结果过滤 `superseded=true`(不注入 system prompt)。

**触发接线**:
- `/clear`:`Agent.java:388` `memoryManager.clearShortTerm()` **之前**插一次 `extractFromSession(当前短期记忆/历史切片)`(抽完再清)。
- 压缩事件:`MemoryManager.compressIfNeeded()`(`MemoryManager.java:190`)触发压缩成功时,对被压切片抽一次。
- 退出:进程正常退出钩子跑一次(尽力而为,失败不阻塞退出)。
- 全程受 `-Dwraith.memory.autoExtract`(默认 true)门控;关则整条链跳过。

### 抽取与去噪门(复用 ContextCompressor 资产)

- **抽取判据复用现有 `EXTRACT_FACTS_PROMPT`**(`ContextCompressor.java:45`):只抽跨会话稳定的偏好/项目信息/决策约定,明确排除一次性任务/临时文件名/猜测/请求句——与业界判据一致、已调过。
- **规则过滤复用 `isPersistentFactCandidate`**(:284):EPHEMERAL_FACT_PREFIXES / SPECULATION_CUES / DURABLE_FACT_HINTS 三档兜底。
- 输出保持**行式**(每行一条事实),不引 JSON;candidate 的 `scope` 默认 project、`type=FACT`。
- 叠一道廉价正则兜底:命中凭证类模式(`sk-`、`token`、`password=` 等)的候选入队前直接丢(敏感信息不入队)。

### CLI(Phase B)

`CliCommandParser.java:138` 一带扩:
- `/memory pending`(列待确认)、`/memory approve <id>`、`/memory approve <id> replace <oldId>`、`/memory reject <id>`、`/memory pending clear`。
- `Main.java`(:542 附近的 /memory 帮助 + 分派)加对应处理,调 `MemoryManager.listPending/approvePending/approvePendingReplacing/rejectPending`。

### RPC(Phase B)

`AppServer.java:588` 的 `memory.*` 分派加:`memory.pendingList`、`memory.pendingApprove`、`memory.pendingApproveReplacing`、`memory.pendingReject`、`memory.pendingClear`(沿现有 `memory.initProject` camelCase 命名)。

### 桌面(Phase C)

`MemoryPanel.tsx` 顶部加「待确认(N)」区:列候选(fact + type/scope + 若有 `nearestExistingId` 则显最相似的旧条供对照),每条 **批准(ADD)/ 批准并替换该旧条(SUPERSEDE)/ 编辑后批准 / 驳回**;可选侧栏入口小红点提示 N>0。preload/IPC 加 `memory.pending*` 通道,沿现有 memory 面板既有模式。

## 数据流与作用域

- project 作用域按 `MemoryManager.currentProject`(真实路径归一)隔离;global 候选跨项目。
- 待确认队列与正式库同目录、分文件;批准是唯一入正式库路径(agent 仍可走原 `save_memory`/`/save`,不受影响)。

## 安全/隐私

- 抽取 prompt 明令不抽敏感信息 + 正则兜底丢弃;
- 候选待批本身即"用户兜底门"——任何自动抽取都不静默进正式库(对齐 ChatGPT/Claude 的用户控制门)。

## 测试策略

- `PendingMemoryStore`:增删列清 + project 隔离 + 落盘往返(单测)。
- `MemoryExtractionService`:mock `LlmClient` 返回构造事实行 → 断言候选正确入队、被规则过滤/空行不入队、敏感正则被丢、近重丢弃、`nearestExistingId` 正确挂载(单测)。
- `MemoryManager.approvePending`/`approvePendingReplacing`:ADD 入库 / 替换时新条入库且旧条标 superseded / reject 丢弃(单测)。
- `MemoryRetriever`/`LongTermMemory`:superseded 条不被检索/`getAll` 过滤(单测)。
- 触发接线:`/clear` 前确有一次抽取调用(mock service 验证被调)。
- CLI/RPC:命令解析 + 分派单测。
- 桌面:`MemoryPanel` 待确认区渲染 + 批准/驳回回调(vitest,断 data-testid,不断脆弱实现)。
- 基线保持:Java 测试基线现 1490/11F/0E(见记忆),不新增失败。

## 分期(供 plan)

- **Phase A 后端核心**:`PendingMemoryStore` + `MemoryExtractionService` + 抽取 prompt + `LongTermMemory.markSuperseded`/检索过滤 + `MemoryManager` 增补 + 触发接线 + `autoExtract` 开关 + 全部后端单测。**无 UI**,靠测试/CLI 验。
- **Phase B CLI + RPC**:`/memory pending|approve|reject` + `memory.pending*` RPC + 单测。
- **Phase C 桌面**:`MemoryPanel` 待确认区 + preload/IPC + vitest。

顺序 A→B→C(后端立住 → CLI 可验 → 桌面 UI)。

## 明确不做(YAGNI)

- 不引 embedding / 向量库 / 知识图谱(维持 JSON + 关键词;DeepSeek 无 embedding 接口)。
- 不做热路径实时抽取(只会话边界异步;避免拖交互)。
- 不做 LLM 全自主 ADD/UPDATE/DELETE 破坏性写(只追加 + 软超请)。
- 不做重要度打分/重排(本期候选不带 importance;先存不排,学 Generative Agents 的 salience 门留待后续)。
- 不重写抽取 prompt/规则(复用 `ContextCompressor` 现成资产)。
- 不改短期记忆 / `ContextCompressor` / `ContextCurator` 既有行为(只在其边界挂一次抽取)。
- 不动 agent 原有 `save_memory`/`/save`/`ExplicitMemoryHints` 路径(自动抽取是并行新增,非替换)。
- 不做跨设备/多用户同步。
