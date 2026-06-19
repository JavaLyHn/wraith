# Spec:会话续接 `/resume`(项目内会话持久化 + 恢复)

- 日期:2026-06-19
- 状态:已实现(2026-06-19)
- 关联:对标 Claude Code 的 `--continue` / `--resume`
- 背景:当前 ReAct 对话历史(`Agent.conversationHistory`)只在内存,进程退出即丢。本 spec 给会话加持久化,并提供续接入口。

## 1. 目标 / 非目标

**目标**
- 每次交互式会话的对话历史自动落盘,按**项目(cwd)**隔离。
- 三个续接入口:
  - `wraith --continue`:直接接上**当前项目最近一次**会话。
  - `wraith --resume [id]`:给了 id 直接接;没给则列出本项目会话供选择。
  - 会话内 `/resume`:弹 `SlashPalette` 选本项目历史会话,把它灌回当前 agent。
- 恢复后,LLM 能看到之前的完整上下文(messages),屏幕上给出简短回放提示。

**非目标(本期不做)**
- 跨项目/全局会话列表(已确认按项目隔离)。
- 会话分支/合并、多会话并发。
- 把短期记忆(`MemoryManager` 短期摘要)精确还原 —— 只还原 `conversationHistory`(见 §7 局限)。
- 图片二进制还原(见 §4)。

## 2. 会话模型与身份

- **项目身份**:`toolRegistry.getProjectPath()` 的绝对路径,取其稳定 hash(复用快照的 `<project_hash>` 算法,见 `SideGitManager`)。
- **会话 = 一次进程交互**:程序启动(且进入交互 REPL)时新建一个会话;`--continue/--resume` 启动时则**继续写入被恢复的那个会话**(不新建)。
- **会话 ID**:`yyyyMMdd-HHmmss-<4位随机>`,人可读、可排序。
- **标题**:首条用户消息截断到 ~50 字符(给 `/resume` 列表展示用)。

## 3. 存储格式与位置

- 位置:`~/.wraith-cli/sessions/<project_hash>/<session_id>.jsonl`
  - 与 `snapshots/<project_hash>/`、`audit/`、`history/` 一致的"按项目分目录"风格。
- 格式:**JSONL**,首行 meta,后续每行一条消息。
  - 第 1 行(meta):
    ```json
    {"v":1,"id":"20260619-163245-a1b2","cwd":"/abs/path","createdAt":"...","updatedAt":"...","provider":"deepseek","model":"...","title":"帮我重构…","turns":3}
    ```
  - 第 2 行起(每条 message):
    ```json
    {"role":"user","content":"…","reasoningContent":null,"toolCallId":null,"toolCalls":null}
    {"role":"assistant","content":"…","reasoningContent":"…","toolCalls":[{"id":"call_1","name":"read_file","arguments":"{…}"}]}
    {"role":"tool","content":"…","toolCallId":"call_1"}
    ```
- **不持久化 system 消息**(role=system)的内容会随版本/项目记忆变化 —— 恢复时由新进程重建 system[0],只灌回 user/assistant/tool。
- JSONL 选型理由:可追加(每轮 append,无需重写整文件)、可 grep、坏一行不毁全文件。

## 4. 持久化哪些内容 / 何时写

- **写哪些**:`conversationHistory` 里 role ∈ {user, assistant, tool} 的消息,落盘前对每条调用 `Message.withoutImageContent()` 剥掉图片二进制(`contentParts` 里的 base64),只留文本占位 —— 避免会话文件膨胀。reasoningContent / toolCalls / toolCallId 原样保留。
- **何时写**:每轮结束后(REPL 中一轮 agent 交互完成、`response` 拿到后)**增量 append 本轮新增的消息**,并更新 meta 行的 `updatedAt` / `turns`。
  - 实现上以"上次已落盘的消息数"为游标,只写新增部分。
- **`/clear`**:开新会话文件(旧的留存),meta `title` 重置。

## 5. 入口与 UX

### 5.1 `wraith --continue`
- 启动参数解析仿 `isRuntimeServeCommand`(`Main.main`)。命中后:选本项目 `updatedAt` 最新的会话,标记为"待恢复会话",进入正常 REPL 前灌回历史。
- 无历史会话 → 提示"本项目无可续接会话,开新会话"并正常启动。

### 5.2 `wraith --resume [id]`
- 带 id:直接定位该会话文件(找不到→报错并正常启动)。
- 不带 id:终端初始化后弹 `SlashPalette`,列出本项目会话(标题 + 相对时间 + 轮数),选中即恢复;Esc 取消 → 开新会话。

### 5.3 会话内 `/resume`
- 新增 `CliCommandParser.CommandType.RESUME`,在 Main switch 里处理。
- 弹 `SlashPalette.openPalette("续接会话", items)`,选中后:`agent.clearHistory()` → `agent.restoreHistory(loaded)` → 屏幕打印"已恢复会话 <title>(N 轮)" + 回放最近 1~2 轮摘要。
- 当前会话文件切换为被恢复的那个(后续 append 写它)。

### 5.4 列表项展示
`<title>   ·   <相对时间,如 2小时前>   ·   <N 轮>   ·   <model>`,按 `updatedAt` 倒序,最多列最近 ~20 个。

## 6. 代码触点(实现清单,评审后再动)

1. **新增 `session/SessionStore.java`**:
   - `SessionMeta`(record)、`SessionRecord`(meta + messages)。
   - `create(projectPath, provider, model)` / `appendMessages(List<Message> newMsgs)` / `list(projectPath, limit)` / `load(projectPath, id)` / `latest(projectPath)`。
   - JSONL 读写(复用项目已有的 Jackson)。
2. **新增 `session/SessionMessageCodec`**:`Message ↔ JSON`(只认 §3 字段,反序列化重建 `LlmClient.Message`)。
3. **`Agent`**:加 `restoreHistory(List<Message> restored)` —— 保留 system[0],清掉其余,append restored;不触发压缩(留给下一轮)。可顺带 `getConversationHistory()` 已有。
4. **`Main`**:
   - `main` 里加 `--continue` / `--resume [id]` 解析(在 serve 检查之后)。
   - 交互入口在建好 `Agent` 后:若有"待恢复会话"→ 读取 → `restoreHistory` → 回放提示。
   - REPL 每轮结束后 `sessionStore.appendMessages(...)`。
   - `/resume` 命令分支 + 列表面板。
5. **`CliCommandParser`**:加 `RESUME`;**`slashCommandHints()`** 加 `/resume` 提示。
6. **README / AGENTS.md**:补一句续接用法(实现后)。

## 7. 边界与局限

- **短期记忆不还原**:`MemoryManager` 的短期摘要不持久化;恢复后 `conversationHistory` 是 LLM 上下文的真相源,够用。短期记忆从空开始(下一轮自然重建)。**在 spec 标注,接受。**
- **图片**:恢复的会话里图片只剩文本占位,不重新加载二进制。
- **token 重计**:恢复后历史可能很长,靠既有 `ConversationHistoryCompactor` 在下一轮按 window 自动压缩兜底。
- **坏文件**:某行 JSON 解析失败→跳过该行并告警,不崩。
- **保留策略**:本期不自动清理(可后续加 `WRAITH_SESSION_MAX`);先无上限,仅 `/resume` 列表截断展示数量。
- **并发**:同一项目同时跑两个 wraith → 各写各的会话文件(ID 不同),不冲突。

## 8. 验证计划

- 用 Python pty 驱动(本会话已验证该手段可靠):
  1. 启动 → 发一条消息 → 退出;断言 `~/.wraith-cli/sessions/<hash>/*.jsonl` 生成且含该消息。
  2. `wraith --continue` 启动 → 断言屏幕回放提示出现、`conversationHistory` 恢复(可加一条"刚才我说了什么"验证模型能看到)。
  3. `/resume` 面板选择 → 断言切换并回放。
- 纯函数单测:`SessionMessageCodec` 往返(Message→JSON→Message)、`SessionStore.list` 排序/截断、坏行跳过。

## 9. 开放问题(评审请定)

1. `--continue` 无历史时:静默开新会话 vs 明确提示?(草案:提示一行)
2. `/resume` 恢复后回放几轮?(草案:最近 1~2 轮的简摘要,避免刷屏)
3. 会话保留上限是否本期就加?(草案:本期不加,留 env 口子)

   评审结论:三条均按草案落地。

## 10. 交付说明(实现后补)

- 新增:`session/SessionStore`、`session/SessionMeta`、`session/SessionMessageCodec`;
  `Agent.restoreHistory`;`CliCommandParser` 加 `RESUME`;`Main` 加 `--continue`/`--resume [id]`
  解析、`/resume` 命令、每轮 `sessionStore.persist(...)`、`/clear` 开新会话。
- 与 spec 的偏差:持久化用**每轮整文件重写**而非增量 append(on-disk JSONL 格式不变,
  实现更简单且 meta 始终最新;会话文件不大,重写代价可忽略)。
- 验证:57 个单测通过(codec 往返 / store 持久化·续接·项目隔离·坏行跳过 / `/resume` 解析);
  Python pty 驱动端到端验证 `--continue`、`--resume <id>`、真实轮次落盘(免网络的 restore +
  一次真实 LLM 轮次确认写盘)。
