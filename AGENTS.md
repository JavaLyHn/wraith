# AGENTS.md

仓库给 Agent / 新线程使用的首读入口。详细行为描述见 `docs/agents-reference.md`。

## 信息优先级

1. 代码实际行为 > 2. `AGENTS.md` > 3. `WRAITH.md` > 4. `README.md` > 5. `ROADMAP.md` > 6. `CLAUDE.md`

`ROADMAP.md` 代表演进方向，不代表已交付。

## 项目快照

- 项目名：`Wraith`
- 定位：面向商业使用的 Java Agent 产品(CLI / 桌面 / IM 三种形态)，对标 Claude Code
- 已交付 23 期（ReAct → Plan+DAG → Memory → RAG → Multi-Agent → HITL → 并行工具 → 多模型 → 联网 → MCP 核心 → MCP 高级 → 长上下文 → Chrome DevTools → CDP 会话复用 → Skill → TUI → LSP 诊断 → Side-Git 快照 → Prompt 分层 → Runtime API → 图片输入 → 微信 iLink 通道文本 MVP）
- `WRAITH.md` 是 Wraith 的项目级记忆文件：启动时自动注入 system prompt，适合团队共享的长期稳定规则；个人/会变化的经验继续用 `/save` 长期记忆。
- 下一步：OAuth / sampling / recovery 作为后续 MCP 增强
- Banner 版本：`v16.1.0`，Maven 产物：`wraith-1.0-SNAPSHOT.jar`（两者不一致是正常状态）

## 运行前提

- Java 17+ / Maven
- 可选：`ripgrep`（`grep_code` 会优先使用；未安装时自动回退 Java 扫描）
- 至少一个 API Key：任意 `<NAME>_API_KEY`（小写 `NAME` = provider 名）。端点内置、只给 key 就能跑的八家：`GLM_API_KEY` / `DEEPSEEK_API_KEY` / `STEP_API_KEY` / `KIMI_API_KEY` / `FREELLMAPI_API_KEY` / `XFYUN_MAAS_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`；其它 provider 须同时给 `<NAME>_BASE_URL`。详见下方「改 provider 选择逻辑」与 `.env.example`。

## 常用命令

```bash
cp .env.example .env
mvn clean package        # 默认跳过测试，优先产出可手工验收 jar
java -jar target/wraith-1.0-SNAPSHOT.jar
java -jar target/wraith-1.0-SNAPSHOT.jar wechat setup   # 主动绑定微信 iLink 通道，默认不开启
java -jar target/wraith-1.0-SNAPSHOT.jar wechat start   # 前台启动微信通道
/wechat                   # 交互式 CLI 内扫码绑定并后台启动微信通道
mvn test -Pquick          # 常规回归
mvn test -Pphase16-smoke  # TUI 相关
mvn test -Dtest=XxxTest -DskipTests=false   # 针对性
mvn test -DskipTests=false                  # 全量回归
/init                    # 生成精简项目级记忆 WRAITH.md；已有文件不覆盖，/init --force 可重写
/export                  # 导出当前 ReAct 会话为 Markdown，包含完整 system prompt
```

## 架构概览

三条主执行路径，共享 ToolRegistry / MemoryManager / SnapshotService：

| 路径 | 入口 | 触发 |
|------|------|------|
| ReAct | `Agent.java` | 默认模式 |
| Plan-and-Execute | `PlanExecuteAgent.java` | `/plan` |
| Multi-Agent | `AgentOrchestrator.java` | `/team` |

核心内置工具 11 个：`read_file` / `write_file` / `list_dir` / `glob_files` / `grep_code` / `execute_command` / `create_project` / `search_code` / `web_search` / `web_fetch` / `revert_turn`

代码库理解默认走 Claude Code 式实时探索：`glob_files` 找候选文件、`grep_code` 精确定位符号或字符串、`read_file` 按需读取具体行段。`grep_code` 优先使用本机 `ripgrep`，不可用时回退到 Java 扫描；结果受 `max_results` / `head_limit` / `max_chars` 预算约束，返回 `partial: true` 或 `suggested_reads` 时应继续缩小搜索范围或按建议读取行段。`search_code` 是 RAG 语义辅助，适合模糊自然语言、关键词不明确、常规搜索无果、巨型/跨知识检索场景，不作为精确代码定位的首选。

MCP 动态工具：`mcp__{server}__{tool}`（+ resources 虚拟工具）

MCP 配置会合并用户级 `~/.wraith/mcp.json` 与项目级 `.wraith/mcp.json`；`${VAR}` 支持系统环境变量、系统属性、项目 `.env`、用户 `~/.env`。检测到 `STEP_API_KEY` 时会自动内置 `step_search` 远程 MCP（显式同名配置优先）。

DeepSeek V4 / Kimi thinking 模式下，assistant tool-call 消息的 `reasoning_content` 必须随下一轮请求历史带回；其他 provider 默认只把 reasoning 写日志 / 展示。
DeepSeek SSE 调用默认强制 HTTP/1.1，避免部分网络/网关下 HTTP/2 长流被远端重置成 `stream was reset: INTERNAL_ERROR`。

讯飞星辰 MaaS provider 名为 `xfyun`，默认 Base URL 为 `https://maas-api.cn-huabei-1.xf-yun.com/v2`。`model` 必须使用服务管控页展示的 `modelId`；公开模型名 / Hugging Face 仓库名不一定可直接调用。微调模型用 `/config provider xfyun --lora-id <resourceId>` 配置服务卡片上的 resourceId，Wraith 会作为 HTTP header `lora_id` 发出。`xfyun` 当前按 MaaS 文档走纯对话请求，不向上游发送 Wraith 内置工具列表。

## 仓库结构

```
src/main/java/com/lyhn/wraith/
├── agent/       Agent.java, PlanExecuteAgent.java, SubAgent.java, AgentOrchestrator.java
├── cli/         Main.java, CliCommandParser.java, PlanReviewInputParser.java
├── browser/     BrowserSession, BrowserGuard, SensitivePagePolicy
├── llm/         GLMClient, DeepSeekClient, StepClient, KimiClient, FreeLlmApiClient
├── context/     ContextProfile, ContextMode, TokenUsageFormatter
├── memory/      MemoryManager, ConversationHistoryCompactor, LongTermMemory
├── plan/        Planner, ExecutionPlan, Task
├── rag/         CodeIndex, CodeRetriever, VectorStore, CodeChunker
├── lsp/         LspManager, LspDiagnosticFormatter
├── prompt/      PromptAssembler, PromptContext, PromptRepository
├── image/       ImageReferenceParser
├── runtime/     api/ (RuntimeApiServer) + task/ (DurableTaskManager)
├── snapshot/    SideGitManager, SnapshotService
├── tool/        ToolRegistry
├── wechat/      iLink client, account store, message loop, non-interactive policy
├── mcp/         McpClient, McpServerManager, transport/, resources/, mention/
├── hitl/        HitlToolRegistry, ApprovalPolicy, TerminalHitlHandler
├── web/         SearchProvider, WebFetcher, HtmlExtractor, NetworkPolicy
├── policy/      PathGuard, CommandGuard, AuditLog, sandbox/(CommandSandbox, SandboxKind,
│               ShellCommand, SeatbeltProfile, AppContainer*, SandboxDoctor)
├── skill/       SkillRegistry, SkillContextBuffer, SkillIndexFormatter
└── render/      Renderer, InlineRenderer, PlainRenderer, RendererFactory
```

启动与 inline 渲染当前约定：

- 开屏 Banner 使用无右边框的简洁布局，避免 CJK/ANSI 字宽导致右侧竖线错位；Phase 22 后默认是 π 主题彩色 logo + Qoder 风格首屏，只展示模型、MCP、Skill、ReAct 状态和三条 getting-started tips，不再把 MCP server 明细刷成启动日志。
- inline 模式使用 JLine 4 的 LineReader 编辑能力，默认提示符是 `* `，右提示显示 `message / @path / @image`。
- 默认 CLI 启动路径应先 `Renderer.start()` 并初始化底部 dock；inline 首屏不要在 `readLine` 前裸写 stdout，而是通过 `InlineRenderer.installStartupScreen(...)` 挂到 `LineReader.CALLBACK_INIT`，首次进入输入时用 `printAbove` 一次性显示完整 Banner + tips，避免 logo 被 LineReader 首次重绘滚出可视区域。
- `BottomStatusBar` 现在是 JLine `Status` 托管的底部 dock：由 JLine 维护滚动区域和状态行位置，不再手写 `\n` / `moveUp` / `CLEAR_TO_EOS` 清屏。输入期会把 LineReader 光标定位到 dock 上方一行，让 `*` 输入行和 Status 同处底部区域；dock 保留两类信息：上层模式 + MCP/Skill 摘要，下层 Auto Model / model / phase / ctx 百分比与 token / cost / elapsed / cwd。关键字段可用克制的 JLine `AttributedString` 彩色样式突出，但纯文本格式和宽度裁剪逻辑要保持稳定。`ctx` 表示当前仍会带入下一轮请求的上下文估算；`in/out/cache` 表示最近任务的 LLM 调用统计，二者不要混用。
- 普通任务和斜杠命令提交后，`Main` 会把本轮原始输入以暗色整行块写回 transcript：输入态左提示仍是 `* `，提交回显左提示改为 `>`；单行输入只占一行，不额外追加空白行。普通任务随后再展开 MCP resource / 本地 `@path` 并进入 Agent；不要只依赖 JLine 提交行残留，否则 activity 重绘或 dock 刷新可能让用户输入从可见历史里消失。`/clear` 清空 conversationHistory、shortTermMemory、待注入 Skill buffer，并重建不含上一轮检索记忆的 system prompt；长期记忆保留。`/compact` 会手动压缩当前 ReAct conversationHistory，不等待上下文阈值触发，保留最近 1 个 user 轮次和 tool_call/tool_result 边界。
- ReAct LLM 调用期间，inline renderer 使用固定高度 live thinking 区动态显示 `Thinking...` 和灰色竖线 reasoning 预览；该区域只能清理自己刚打印的几行，不能用独立 JLine `Display.update()` / `CLEAR_TO_EOS` 向上覆盖 transcript。content 或 tool call 开始前先清掉 live 区，再把完整 reasoning 引用块落到正文区，正文回答用低调标记起始，不再刷强标题。
- 交互期输出应优先走 `Renderer.stream()`；`Main`、`PlanExecuteAgent`、`Planner`、`AgentOrchestrator` 都支持把输出流接到 inline renderer，避免直接争抢 stdout。`CodeIndex` 的索引进度通过 `ProgressListener` 注入，`/index` 应绑定到当前 renderer 输出流。
- Phase 22 开始，`InlineRenderer` 可绑定当前 `LineReader`；当 `LineReader.isReading()` 为 true 时，`Renderer.stream()` 的完整行输出优先通过 `LineReader#printAbove` 显示在输入行上方，未绑定 / 非读取态 / 测试路径回退到原 `PrintStream`。
- Markdown 表格渲染要按当前终端列宽分配列宽；长内容在单元格内部换行，不能依赖终端自动折行把整行表格打散。
- ReAct 正常结束后不再把 `📊 Token: ...` 打进正文区；token/cost/elapsed 会保留在底部强状态行，phase 回到 `idle`。
- 默认 CLI 启动路径应尽早建立 `Terminal -> LineReader -> Renderer`，启动 Banner、模型加载、MCP 启动、Skill summary、ReAct 提示和退出提示都应走 `Renderer.stream()`；除 fatal bootstrap / runtime API / legacy TUI 降级外，不要在交互主路径新增裸 `System.out.println`。
- 启动期 MCP 不得阻塞首屏：CLI 默认最多等待 8 秒（`WRAITH_MCP_STARTUP_WAIT_SECONDS` / `-Dwraith.mcp.startup.wait.seconds` 可调），超时后保留未完成 server 为 `STARTING` 并后台继续初始化；`/mcp` 查看最新状态。
- `LineReader` 使用 `WraithHighlighter` 做输入实时高亮：slash 命令、`@` 引用、`@image:`、`@clipboard`、敏感词和明显危险 shell 片段会在编辑阶段被标记；不要把这类视觉提示混入最终提交文本。
- `LineReader` 使用 `WraithCompleter` 做上下文补全：`/model` provider、`/mcp` 子命令与 server、`/skill` 子命令与 skill name、`/task` / `/browser` / `/snapshot` 子命令、`@image:` 本地路径、本地 `@path` 和 MCP resource `@server:uri` 引用都应从同一个 completer 出口维护。
- 普通用户输入进入 Agent 前会先展开 MCP resource mention，再由 `LocalPathMentionExpander` 展开本地 `@path`：文件会内联为 `<file>` 块，目录会内联为 `<directory>` 列表；绝对路径或符号链接逃逸项目根时保持原文不展开。
- `LineReader` 使用 `WraithHistory` 持久化输入历史到 `~/.wraith/history/input.history`；如果 `wraith.history.file` / `WRAITH_HISTORY_FILE` 指向目录，也会自动使用该目录下的 `input.history`，避免把目录当文件读；默认忽略空白、重复、明显密钥/Bearer、base64 图片和超长输入，用户可用 `/history clear` 清空本机输入历史。
- 启动期会加载 `~/.wraith/WRAITH.md`、项目根 `WRAITH.md`、项目根 `.wraith/WRAITH.md`、`WRAITH.local.md`、`.wraith/WRAITH.local.md`，按此顺序注入 Project Context；`@relative/path.md` 可导入项目根内文件，总注入内容有字符预算，避免项目记忆变成 token 噪音。
- `/init` 会根据当前项目生成短 `WRAITH.md`，只放 commands / project positioning / architecture / pitfalls / don'ts；默认不覆盖已有文件。
- `/export` 导出当前 ReAct `conversationHistory` 为 Markdown 到 `~/.wraith/exports/session-*.md`；只支持无参数命令，包含完整 system prompt，便于检查 LLM 实际接收前的指令。
- JLine 交互升级计划记录在 `docs/phase-22-jline-interaction-upgrade.md`。

## 关键行为约束（Agent 必读）

### Memory

- 长期记忆只通过 `/save` 或用户明确要求保存；不要自动提取事实
- `WRAITH.md` 管团队共享的项目规则，长期记忆管个人或项目作用域的稳定事实；不要把一次性协作经验写进 `WRAITH.md`
- 长期记忆只保存跨会话稳定事实，不保存临时指令；默认项目级作用域，跨项目通用偏好才用 global
- 长期记忆必须可审计和可删除：`/memory list` / `/memory search <关键词>` / `/memory delete <id>` / `/memory clear`
- 两道压缩不要混淆：shortTermMemory 压缩 vs conversationHistory 压缩（后者是防 window 超限的关键）
- 自动压缩阈值按 Claude Code 风格预留摘要输出和安全缓冲：大窗口使用 `window - 20k - 13k`，例如 200k 窗口约 167k 触发、1M 窗口约 967k 触发；小窗口按比例缩小预留。

### HITL + 策略层

- 拦截顺序：HitlToolRegistry → ToolRegistry → PathGuard/CommandGuard → CommandSandbox（OS 进程沙箱）
- 用户无法批准策略拒绝的请求
- PathGuard 强制路径限定在项目根内
- CommandGuard 是辅助黑名单，不是主防线。**规则分 POSIX 与 Windows 两套，全平台都跑**——命令文本里出现 `format C:` 在 mac 上也没有放行的理由，而且按平台分叉会让「这条规则在哪儿生效」变成一件要推理的事
- CommandSandbox 只在 app-server / gateway / automation 注入，**交互式 CLI 不用**（ToolRegistry 的 sandbox 为 null）。macOS 走 Seatbelt、Windows 走 AppContainer、其余为 `NONE`；不可用时 **fail-open**（裸跑 + warning 带到 UI），不阻断用户
- 改沙箱前先读 `docs/specs/2026-08-02-windows-sandbox-design.md` §5「我验不了什么」——Windows 那条链路无 Windows 机器时原理性无法验证，只能靠 `wraith sandbox doctor` 在真机验
- **平台判定统一用 `ShellCommand.isWindows`**（前缀 `windows`，不是 `contains("win")`——**"Darwin" 里含 "win"**）
- 微信 iLink 通道没有人工审批面板，必须走非交互式默认拒绝策略：只读工具默认允许，`execute_command` 必须精确命中命令白名单，`mcp__*` 必须命中 MCP 白名单，`revert_turn` 和浏览器会话切换默认拒绝，文件写入仍由 PathGuard 限定在绑定 workspace 内。

### Plan 审阅交互

- 已迁移到 `Renderer.promptChoice` 交互式选择器：选项 `[执行计划, 展开/折叠详情, 取消, 补充指令重新规划]`，方向键/数字键 + Enter 确认，ESC 降级到 `PlanReviewInputParser` 文本输入路径
- 旧的 raw-mode 单字符读取（`Enter`/`Ctrl+O`/`ESC`/`I`）已废弃；`readSingleKeyFromTerminal` 保留为 private static 死代码，勿删（`readInputBurst`/`classifyEscapeSequence` 仍被其它方法使用）
- 涉及改动要连 `createPlanReviewHandler` 签名、`createPlanAgent` 调用链和 `PlanReviewInputParser` 降级路径一起看

### 并行工具

- 三条路径都走 `executeTools()`，不手写 for-loop
- 默认最多 4 个并发，结果保持原始顺序

### Web + Browser

- 每轮 system prompt 会注入当前日期/时区，用于相对日期理解；联网搜索不再由 prompt 的 Freshness Policy 强制，是否调用 `web_search` 交给模型基于工具 schema 和用户目标自主决定。
- “当前项目/当前 README/当前文件/当前代码”等表达属于本地上下文任务，通常应由模型选择 `glob_files` / `grep_code` / `read_file`，而不是联网工具。
- 当前模型为 `step-3.7-flash*` 且自动/显式 `step_search` MCP 的 `web_search` / `web_fetch` 已就绪时，内置 `web_search` / `web_fetch` 会优先转调 StepSearch MCP；未就绪或调用失败时回退到原 SearchProvider / WebFetcher。
- 已知 URL 先 `web_fetch`，SPA/防爬墙 fallback 到 Chrome DevTools MCP
- 浏览器读取优先 `take_snapshot`，不默认 `take_screenshot`
- 公开页面不要提前切 shared 模式

### Skill

- system prompt 索引段注入三处提示词，上限 32 个 / 8KB
- `load_skill` → SkillContextBuffer → 下一轮 user message 前置注入
- 内置 skill 当前 23 个：web-access + 16 个流程/方法论/领域(brainstorming / writing-plans / systematic-debugging / test-driven-development / verification-before-completion / receiving-code-review / requesting-code-review / mcp-builder / skill-creator / github-ai-daily / code-refactoring / git-workflow / typescript-patterns / performance-optimization / documentation-writing / security-review) + 6 个改写自 Matt Pocock skills(codebase-design / domain-modeling / prototype / grilling / research / handoff)
- Matt Pocock 的 `disable-model-invocation` / `argument-hint` 语义在 Wraith **不实现**：Wraith 的 `load_skill` 本就是模型按触发场景自主调用，`Skill` 记录不消费这两个字段；改写时把触发范围写进 description，避免误触发即可。重叠 skill(tdd/code-review/resolving-merge-conflicts/writing-great-skills/diagnosing-bugs) 不重复引入——diagnosing-bugs 的 feedback-loop 技法已合并进 `systematic-debugging/references/feedback-loop.md`。

### 桌面宠物（Pets）

- 展示表面（2026-07-19 起）：独立于主窗口的全局桌宠 `BrowserWindow`（无边框/透明/置顶/跨 Space），不再是聊天内 overlay（旧 `PetAvatar.tsx` 已删，渲染逻辑迁到 `PetSprite.tsx`）。
- 文件：`desktop/src/shared/pets.ts`（类型）、`desktop/src/shared/petState.ts` + `desktop/src/renderer/lib/petMotion.ts`（状态到动效映射）、`desktop/src/shared/petWindow.ts`（命中测试 / 缩放 / 夹屏 / 菜单模板等纯函数）、`desktop/src/main/petStore.ts`（fs / 校验 / 落盘）、`desktop/src/main/petWindow.ts`（桌宠窗生命周期：建窗 / 销毁 / 拖动落点 / 缩放 resize / 菜单落地 / 三路 IPC 推送）、`desktop/src/main/settings.ts` 的 `PetConfig`（enabled/selectedId/motion/scale/position，主进程单一配置源）、`desktop/src/preload/pet.ts`（`window.wraithPet` 桥）、`desktop/src/renderer/pet.html` + `pet.tsx` + `components/PetWindowApp.tsx`（独立轻量 renderer 入口 / 根组件）、`components/PetSprite.tsx`（纯展示精灵渲染）、`components/PetsSettings.tsx`（设置页，经 `usePetConfig` 走 IPC）
- IPC 边界：主窗侧只开 5 个窄方法：`petsList` / `petsImportImage` / `petsImportPackage` / `petsRemove` / `petsPreview`；文件系统访问只在 main 的 `petStore.ts`。桌宠窗另有一条独立的 `pet:*` 频道（`pet:ready` / `pet:getConfig` / `pet:setConfig` / `pet:config` / `pet:preview` / `pet:signal` / `pet:setIgnoreMouse` / `pet:moveTo` / `pet:setScale` / `pet:contextMenu`），经专属 preload（`preload/pet.ts`）暴露为 `window.wraithPet`，与主窗 `window.wraith` 互不越界；两个 preload 都只做类型约束桥，renderer 不直接碰 fs
- **no-auto-download / no-third-party-code**：Wraith 不自动下载 Petdex 资源、不运行 `npx`、不执行任意第三方代码；`Noir Webling` 等 Petdex 目录条目只做本地检测（`~/.codex/pets/`）或读取用户已导入的包，缺资源时提示未安装，不联网获取；此红线随本次展示表面迁移逐字节不变（`petStore.ts` 与导入校验未改动）
- 导入需先过 MIME/签名、大小、像素尺寸与解压包边界（文件数/总大小）校验，并做 Zip Slip / 符号链接防护，通过后才把副本写入应用数据目录；删除只清理该副本，不改动用户原始目录

## 修改时的硬规则

### 1. 改行为 → 同步文档

`AGENTS.md` / `README.md` / `ROADMAP.md`（仅状态变化时）

> **2026-08-05 起文档分了工，别再往 README 里堆。** README 只放
> 「这是什么 / 怎么上手 / 产品形态截图 / 常用命令速查 / 常见问题」；
> 开发流程进 `docs/development.md`、开发史进 `docs/evolution.md`、
> **CLI 全部命令进 `docs/cli-manual.md`**、Windows 首次上手进 `docs/windows-quickstart.md`。
> 判断放哪的标准很简单：**第一次来的人需要，就进 README；只有改代码的人需要，就进 docs/**。

### 2. 改命令入口 → 联动

`Main.java`（`slashCommandHints` 提示表）+ `CliCommandParser.java`（真实 dispatch）
+ 测试 + **`docs/cli-manual.md`**（全部命令的家）+ `README.md`（只有进了速查表才要动）+ `AGENTS.md`

未识别的 `/xxx` 在 CLI 层直接报"未知命令"，不回退给 Agent。

> **提示表漏一条 = 这个功能不存在。** 命令敲得动但 Tab 补不出来、`/` 菜单里也没有，
> 用户不可能发现它 —— `/memory pending`（自动记忆提取的**唯一** CLI 入口）就这么隐身过一段时间。
> `SlashCommandDiscoverabilityTest` 现在守着这条：它按**严格字面量**比对 parser 认的命令与提示表，
> 漏一条就变红。豁免名单只收纯别名（`/mem*` / `/ctx`），不收「暂时懒得写」。
> （第一版判据写成「首个词相同就算覆盖」，结果 `/memory pending` 被 `/memory` 顶掉 ——
> 那正是要抓的漏项却被自己的宽松判据放过了。别再改回族覆盖。）

### 3. 改 Plan 审阅交互 → 联动

`Main.java` + `PlanReviewInputParser.java` + 测试 + 手工验证

### 4. 改工具集 → 联动

`ToolRegistry.java` + Agent/PlanExecuteAgent/SubAgent 提示词 + 可能 Planner 提示词 + 文档

### 5. 改模型/接口 → 联动

对应 Client + `LlmClientFactory.java` + `.env.example` + 文档

- 改 provider 选择逻辑时连带：`ProviderResolver`（唯一的候选排序）+ `LlmClientFactory.createFromConfig`（`anthropic` 在 switch 里显式派发到 `AnthropicClient`，不能只靠 default 分支的 protocol 判断，见下方 C1）+ `ModelCatalog.providers/result` + `ProviderDefaults.healDefault` + `Main.knownProviderIds`（`/model` 空参帮助与 `WraithCompleter` 补全共用的合并函数：config 项 ∪ `ProviderResolver.candidates`，两处都要，谁都不能替代谁）+ `Main.slashCommandHints` + `Main.parseProviderConfigUpdate`（那道白名单闸已删，别加回去；`--protocol` 只认 `openai`/`anthropic`，非法值要报人话错误）+ `Main.resolveModelSelection`（**内部还有一张「模型名前缀 → provider」的表**：`case` 标签那行的六个规范名是载荷性的不能删，但 `default` 分支不该再加 `claude-`/`gpt-` 之类的新前缀——白名单外的具体模型名走 `matchConfiguredProvider`：查已配置的 provider id 前缀或 model 字段完全相等，不需要第十份名单，见 I4）+ `Main.normalizeProviderName`（已委托 `ProviderNames`）+ `/model` 空参的帮助文案 + `main()` 找不到可用 client 时的错误提示（`:238` 附近，不点名具体 provider）。**不要新增第十份 provider 名单** —— 那 6 家曾被硬编码九处且互不一致，其中一处是可达 bug（只配 anthropic 拿不到 client）、一处是功能性硬拒绝（`/config provider anthropic` 被 CLI 拒掉而桌面能配），详见 `docs/superpowers/specs/2026-08-03-provider-agnostic-registry-design.md`。别名表的单一来源是 `config/ProviderNames.java`：`LlmClientFactory.normalizeProvider` 与 `Main.normalizeProviderName` 都是委托它，不是各自维护一份。`ProviderResolver.ENDPOINT_KNOWN` 是 env-only 发现的护栏表（记录哪个 client 类烧死了哪个端点），**不是**偏好白名单。

### 5.1 改 Embedding → `EmbeddingClient` + `VectorStore` + `.env.example` + 文档

> 改**桌面「代码检索」面板的 embedding 后端**连带六层：`EmbeddingProbe`（「测试连接」的逻辑；`effectiveKey` 的「空=保留旧 key」**必须与 `embeddingSet` 同义** —— 面板的 KEY 框从不回填已存 key，不继承就会「测出 401 但保存是好的」）+ `config.testEmbedding` RPC（**必须 `dispatchAsync`**：ollama 首次请求要把模型载进内存，同步执行会冻住整个 app-server，`config.testProvider` 已经踩过一次）+ `shared/types.ts:EmbeddingTestResult` + `preload/index.ts` + `main/index.ts` + `renderer/lib/embeddingTestView.ts`（三态：通了 / **通了但与现有索引不兼容** / 没通 —— 第二态混进第一态就等于没做）+ `RagPanel.tsx`。
>
> 探测超时走 `wraith.embed.probe.timeout.seconds`（默认 60s），**刻意宽于** LLM 探测的 20s：冷加载大模型是 LLM ping 没有的成本，宁可让人多等也不要对一个好后端报「没有响应」。失败话术的家在 `EmbeddingErrorHint`，纪律是**只在能确定的形态上说话**（连不上 / 404 模型没拉 / 404 路径不存在），其余返回空串；**原文一律保留**，诊断另放一个字段。设计与取舍详见 `docs/superpowers/specs/2026-08-04-embedding-test-connection-design.md`。

### 5.2 改 Web/搜索 → `web/` 相关 + ToolRegistry + `.env.example` + 文档 + 测试

> 改**搜索后端**另需连带：`WraithConfig.SearchConfig`（config.json 的 `search` 节）+ `UnconfiguredSearchProvider`（「未配置」话术的载体，**不是** Zhipu provider —— 占位 provider 曾是 zhipu，于是那句中立的三路指引由智谱代言，模型张口就说 GLM）+ `DuckDuckGoSearchProvider`（显式可选，**自动选择链永不返回它**，由 `SearchProviderAutoSelectionTest` 穷举 8 种组合守门）+ `SearchDetection`（docker/端口检测，纯函数入口注入，端口常量的家在这里）+ `/config search` 写入口 + `ToolRegistry.invalidateSearchProvider()`（不调则本次会话仍用旧 provider，第五次 snapshot-vs-live）+ `src/main/resources/skills/web-access/SKILL.md` 的工具选择表（搜索那行的 fallback 列不能是 `—`，否则 `web_search` 不可用时模型没有降级指令）+ 桌面 `pluginShowcase.ts` 的 `requires` 文案。

### 5.3 改 Memory → `MemoryManager` + `LongTermMemory` + `TokenBudget` + 测试 + 文档

### 5.4 改 HITL/策略 → `policy/` + ToolRegistry + HitlToolRegistry + 提示词 + `.env.example` + 文档 + 测试

改沙箱另需连带：`sandbox.get/set` RPC 回包 + `initialize` 的 `capabilities.sandbox` + 桌面 `topBar.ts:sandboxChipView` / `sandboxPanel.ts` / `shared/types.ts:SandboxKindWire` + `docs/windows-usage.md` §6.5 + `docs/windows-dev.md` §5.1 验收项。

> 顶栏那枚盾的**唯一真相源是 App 的 `state.sandbox` + `state.sandboxNet`**，由 `App.refreshSandbox()`（startSession 之后）与 `PolicyPanel` 的 `onSandboxChange` 回填。面板**不许**自己持有一份沙箱状态 —— 分叉的那一半正好是用户看得见的那半（2026-08-02 修的就是这个）。E2E mock 里 `sandbox.get/set` 也要跟着实现，否则前端走的是 -32601 的 catch 分支，测不到真实路径。

### 5.5 改 MCP → `mcp/` + ToolRegistry + HITL + AuditLog + 提示词 + 文档 + 测试

> **内建 server 写在 `McpConfigLoader.load()` 里**（`step_search` 看 key 有无、`chrome-devtools` 恒补），不是「启动时往 `~/.wraith/mcp.json` 写模板」。写文件那条路只挂得住一个入口 —— 它原先只在交互式 CLI 上，于是桌面 / gateway / automation 三个入口的用户永远没有浏览器能力。加内建项时三条铁律：**用户/项目配置同名即整段让位**（含 `disabled: true`）、**绝不改用户文件**、**给一个持久的退订开关**（内建项在插件面板里 scope=builtin，那一档没有删除键，面板上的「停用」又只在内存里）。

### 5.6 改计价 → `PricingTable` + `Agent.reloadPricingTable` + `/config pricing` + 两条 RPC + 桌面「设置 → 模型计价」 + 测试

> 七层链路缺一层就是「填了没反应」：`PricingTable.view()`（只读视图，`seeded` 标不可写）→ `Main.validatePricingEntry` / `applyPricingEntries`（**校验规则 CLI 与 RPC 共用一份**，否则用户在一边被拒、在另一边写进去）→ `config.getPricing` / `config.setPricing`（**整表替换**，不是逐条 CRUD：`PricingEntry` 无 id 而 `modelPrefix` 会被用户改，「把 glm 改成 glm-4.7」在逐条 API 里有歧义）→ 桌面 `shared/types.ts` + `preload/index.ts` + `main/index.ts` → `renderer/lib/pricingView.ts`（`matchedModels` 是 Java 侧 `pricingMatchedModels` 的**双端重复实现，改一边必须改另一边**）→ `SettingsPricing.tsx`。
>
> **`reloadPricingTable` 不调则写了等于没写** —— `setPricingTable` 只在构造 Agent 时注入（`Main.java:348` 交互 CLI、`:1326` app-server 会话），这是本仓库第六次 snapshot-vs-live（前五次：沙箱护盾、动作卡、pet 窗口、补全、`web_search` 的 provider 缓存）。CLI 侧由 `handleConfigCommand` 的 `ConfigReloadHook` 带（同一个 hook 也负责失效搜索缓存 —— 别再往那个签名上加参数）。
>
> **`SEEDS` 一条不加不改不可写**：门槛是「两个独立可信来源对得上」，中转站实付价没有公开来源（`PricingTable` 的核对记录里连 `glm-5.1`——本仓库自己的默认模型——都因多源矛盾而缺席）。用户条目同长度时已优先于种子，想覆盖填一条同名的即可。
>
> **config 条目是前缀匹配、种子要求精确相等** —— 这个差异是静默的（填 `glm` 会让 `glm-4.7` 与 `glm-5v-turbo` 套同一个价），所以两个写入口都必须显示「这条会命中哪几个已配置模型」。币种只收 `CNY` / `USD`：`formatCost` 只认 `USD` → `$`，其余一律渲染 `¥`，允许 `EUR` 会骗人。

### 6. 不提交 `.env` / 真实 API Key / `target/` 产物

### 7. 保持代码可读性，不过度抽象

## 验证路径

| 场景 | 命令 |
|------|------|
| 代码搜索工具 | `mvn test -Dtest=ToolRegistryTest,CodeSearchGoldenSetTest,ApprovalPolicyTest` |
| 命令解析 | `mvn test -Dtest=CliCommandParserTest,PlanReviewInputParserTest,MainInputNormalizationTest` |
| DAG/Plan | `mvn test -Dtest=ExecutionPlanTest` |
| Multi-Agent | `mvn test -Dtest=AgentRoleTest,AgentMessageTest,AgentOrchestratorTest` |
| TUI/终端 | `mvn test -Pphase16-smoke` |
| RAG | `mvn test -Dtest=CodeChunkerTest,CodeAnalyzerTest,VectorStoreTest,CodeIndexTest` |
| **检索质量**（改分块/打分/embedding 模型后必跑） | `scripts/rag-eval/run-eval.sh --save-baseline` → 改动 → `--vs-baseline`；量 R@k / MRR@10 + 逐条升降，见 `scripts/rag-eval/README.md` |
| 常规回归 | `mvn test -Pquick` |

## 给新线程的导航

1. 先看本文件 → 2. `README.md` → 3. `Main.java` → 4. 按任务进入对应模块

| 任务类型 | 先看 |
|----------|------|
| CLI 命令 | Main.java + CliCommandParser.java |
| 规划/DAG | PlanExecuteAgent.java + Planner.java + ExecutionPlan.java |
| 工具调用 | ToolRegistry.java + Agent.java |
| 代码搜索 | ToolRegistry.java (`glob_files` / `grep_code` / `read_file`) |
| 模型/API | llm/*Client.java + LlmClientFactory.java |
| RAG 语义辅助 | CodeRetriever.java + CodeIndex.java + VectorStore.java |
| Multi-Agent | AgentOrchestrator.java + SubAgent.java |
| MCP | McpServerManager.java + McpClient.java |
| TUI/渲染 | render/Renderer.java + RendererFactory.java |
| 桌面宠物（Pets） | desktop/src/shared/pets.ts + petState.ts + petWindow.ts + desktop/src/main/petStore.ts + petWindow.ts + settings.ts(PetConfig) + desktop/src/preload/pet.ts + desktop/src/renderer/lib/petMotion.ts + desktop/src/renderer/pet.html/pet.tsx + components/PetWindowApp.tsx + PetSprite.tsx + PetsSettings.tsx |

## 当前已知边界

以下在路线图但未交付：容器/VM 沙箱（现有的是**操作系统进程级**沙箱 Seatbelt / AppContainer，不是容器或 microVM）/ Linux 命令沙箱（bubblewrap 未做）/ MCP OAuth + sampling + server 自动重启

不要把 `ROADMAP.md` 中"将来要做"误读成"现在已有"。

## 持续维护约定

形成稳定协作规则时直接补进本文件，不要只留在聊天记录里。详细实现细节补到 `docs/agents-reference.md`。
