# 演进历程

> 这份文档是 Wraith 的**开发史**：从第一期的 `ReAct` 单代理循环，到桌面 App、IM 网关、
> 安全策略层、Windows 对等。每一期都记了**为什么这么做**与**踩到了什么**。
>
> 它从 README 里搬出来 —— README 该先回答「这是什么、怎么用」，
> 而 293 行的分期史对第一次来的人是噪音。
>
> 找别的东西：
> [README](../README.md) 上手与产品形态 ·
> [终端手册](cli-manual.md) ·
> [开发者文档](development.md) ·
> [规划](ROADMAP.md)


### 第一期：ReAct Agent CLI

- 单轮对话驱动的 `ReAct` 循环
- 支持工具调用：读文件、写文件、列目录、文件 glob、代码 grep、执行命令、创建项目、RAG 语义辅助检索、联网搜索、MCP 动态工具
- 更适合简单任务或单步操作

### 第二期：Plan-and-Execute + DAG

- 在保留 `ReAct` 模式的基础上新增复杂任务规划能力
- 支持先拆解任务，再按照依赖顺序执行
- 新增 `/plan` 入口，以一次性计划执行方式增强默认的 `ReAct`
- 计划生成后，会先与用户确认再执行
- 更适合多步骤、带依赖关系的复杂任务

### 第三期：Memory + 上下文工程

- 短期记忆管理当前对话与工具结果
- 长期记忆通过 `/save <事实>` 或用户明确说“记一下 / 记住”时的 `save_memory` 保存关键事实，默认项目级作用域，跨会话复用
- 项目级记忆通过 `WRAITH.md` / `.wraith/WRAITH.md` 启动自动注入，适合提交到仓库的团队共享规则；`WRAITH.local.md` / `.wraith/WRAITH.local.md` 只做本地覆盖
- 注入给模型的相关记忆只使用长期稳定事实，不把当前轮短期对话误当成“历史记忆”
- 对话接近预算时自动做摘要压缩
- 新增 `/memory` 查看状态、`/memory list/search/delete/clear` 管理长期记忆、`/save` 手动保存事实；Agent 在用户明确说“记一下 / 记住”时可调用 `save_memory`
- 自动记忆提取（候选待批）：会话边界或桌面「整理记忆」触发，从对话里抽取稳定事实先入**待确认队列**（不自动进长期记忆），人工批准 / 替换 / 驳回才落库；带质量门（敏感 / 凭证在所有写入路径硬拦、与长期记忆及待确认队列双重去重）。记忆声明只以本轮注入的「相关长期记忆」区块为准，不凭对话历史臆断已存。CLI `/memory pending`、`/memory approve <id>`、`/memory reject <id>`；桌面记忆面板「待确认区」+「整理记忆」按钮

### 第四期：RAG 检索 + 代码库理解

- 代码向量化（Embedding），支持本地 Ollama 和远程 API
- SQLite 持久化 + 余弦相似度语义检索
- 代码分块（文件/类/方法粒度）与 AST 解析
- 代码关系图谱（extends/implements/imports/calls/contains）
- 新增 `/index`、`/search`、`/graph` CLI 命令
- `search_code` 作为语义辅助检索工具；精确代码定位默认走 `glob_files` / `grep_code` / `read_file` 现用现查

### 第五期：Multi-Agent 协作 + 角色分工

- 三个角色：规划者（Planner）、执行者（Worker）、检查者（Reviewer）
- 主从架构：编排器（Orchestrator）协调子代理（SubAgent）
- 规划者拆解任务 -> 执行者执行 -> 检查者审查质量
- 审查未通过时带反馈重试（最多 2 次），冲突自动解决
- 新增 `/team` CLI 命令，进入多 Agent 协作模式

### 第六期：Human-in-the-Loop + 审批流

- 危险操作静态规则识别：`write_file`、`execute_command`、`create_project`、`revert_turn`
- 三级危险等级：高危（`execute_command`）、中危（`write_file` / `create_project`）
- 审批决策：批准 / 全部放行 / 拒绝 / 跳过 / 修改参数后执行
- HITL 默认关闭，通过 `/hitl on` 启用
- 新增 `/hitl` CLI 命令，支持 `/hitl on`、`/hitl off`、`/hitl`（查看状态）

### 第七期：异步执行 + 并行工具调用

- 同一轮 LLM 返回多个 `tool_calls` 时，工具层会并行执行
- ReAct、Plan-and-Execute、Multi-Agent Worker 都复用统一的批量工具执行入口
- 工具结果仍按原始 `tool_call` 顺序回灌，保证消息历史协议稳定
- 批量工具调用有统一超时与取消兜底，单个 `execute_command` 仍保留 60 秒命令级超时
- Plan-and-Execute 与 Multi-Agent 已支持按依赖批次并行执行独立任务

### 第八期：多模型适配 + 运行时切换

- `LlmClient` 接口抽象 + `AbstractOpenAiCompatibleClient` 模板基类
- 内置 `GLMClient`、`DeepSeekClient`、`StepClient`、`KimiClient`、`FreeLlmApiClient`、`XfyunMaaSClient` 六个瘦实现
- `/model glm-5.1` / `/model glm-5v-turbo` 明确切 GLM 模型；`/model deepseek` / `/model step` / `/model kimi` / `/model freellmapi` / `/model xfyun` 切 provider 并读取配置里的具体模型
- `freellmapi` 同时是通用 **OpenAI 兼容**入口：把 `--base-url` 指向任意 OpenAI 兼容端点即可接入自定义模型，无需改代码（例：SophNet 托管的 `DeepSeek-V4-Flash`，base 需带 `/v1`）
- 配置持久化到 `~/.wraith/config.json`，API Key 可从配置、环境变量或 `.env` 读取

### 第九期：联网能力 + Web 工具

- `web_search` 抽象成 `SearchProvider` 接口，内置三个实现：智谱 Web Search（默认，与 GLM 共用 Key，0.01–0.05 元/次）、SerpAPI（国际通用付费）、SearXNG（开源自托管免费）
- `web_fetch` 新工具：URL → OkHttp 抓取 → Jsoup 解析 → 简易 readability → Markdown 正文
- 当当前模型是 `step-3.7-flash*` 且自动/显式 `step_search` 远程 server 已就绪时，内置 `web_search` / `web_fetch` 会优先走 StepSearch MCP；未就绪或调用失败时自动回退到原 provider。
- ReAct 对“最新/当前/今天/今年/2026/趋势/新闻/版本”等时效性问题会先做一次 `web_search` 预检并注入本轮上下文，避免模型在工具可用时误说无法实时搜索；用户明确不要联网时跳过。
- 默认安全策略：屏蔽 `file://` / 内网 / loopback；30 秒超时；5MB 响应上限；每分钟 30 次限流
- 边界明确：SPA / 防爬墙站点会返回空正文 + 已知边界提示，Agent 会 fallback 到浏览器 MCP 路线

### 第十期：MCP 协议核心

- 新增 `com.lyhn.wraith.mcp` 模块，支持 stdio 子进程 server 与 Streamable HTTP 远程 server
- 启动时读取 `~/.wraith/mcp.json` 与 `.wraith/mcp.json`，项目级配置按 server 名覆盖用户级配置
- MCP `${VAR}` 支持系统环境变量、系统属性、项目 `.env`、用户 `~/.env`；检测到 `STEP_API_KEY` 时自动内置 `step_search` 远程 MCP，显式同名配置优先
- MCP 工具自动注册为 `mcp__{server}__{tool}`，参数 schema 会清洗 `$ref` / `anyOf` / 超长 description，降低模型调用失败率
- 所有 MCP 工具默认走 HITL 审批和审计，审计参数会脱敏 token / key / password / Authorization / Bearer 凭证
- 支持 MCP resources：server 声明 `resources` capability 后，自动注册 `mcp__{server}__list_resources` / `mcp__{server}__read_resource` 虚拟工具
- 普通输入支持 `@server:protocol://path` 显式引用 resource，提交给 Agent 前展开为 `<resource>` 内联块
- 被动处理 `notifications/tools/list_changed`、`notifications/resources/list_changed`、`notifications/resources/updated`
- 运行中输入 `/cancel` 并回车可请求取消当前 Agent run
- CLI 命令：`/mcp`、`/mcp restart <name>`、`/mcp logs <name>`、`/mcp disable <name>`、`/mcp enable <name>`、`/mcp resources <name>`、`/mcp prompts <name>`
- `chrome-devtools` 是**内建 server**，不需要任何配置文件即可用；用户级 `~/.wraith/mcp.json` 与项目级 `.wraith/mcp.json` 都可以按 server 名覆盖它（含 `"disabled": true`）

### 第十二期：长上下文工程

- `LlmClient` 声明模型能力：`maxContextWindow()`、`supportsPromptCaching()`、`promptCacheMode()`
- GLM-5.1 默认 200k window，DeepSeek V4 默认 1M window，StepFun 默认 256k window，Kimi K2.6 默认 256k window，FreeLLMAPI 默认按 128k 保守预算
- `AgentBudget` 按当前模型动态计算预算，默认 `80% * maxContextWindow`，仍可用系统属性覆盖
- short / balanced / long 三种上下文模式：长上下文模式跳过摘要压缩，语义检索 topK 可提升到 20
- `search_code` 未显式传 `top_k` 时按上下文模式自适应；默认代码定位仍优先实时 grep/read
- 长上下文模式下自动把 MCP resources 的 URI / 描述索引注入 system prompt，不自动注入正文
- inline 模式下 Token / cached input tokens / 估算成本 / 耗时进入底部状态栏，避免占用正文输出区
- `/context` 会显示当前上下文模式、prompt cache 模式、RAG topK、resources 自动索引状态

### 第十三期：Chrome DevTools MCP

- 默认接入 Google 官方 `chrome-devtools-mcp@latest`，注册为 `mcp__chrome-devtools__navigate_page`、`take_snapshot`、`click`、`fill_form` 等浏览器工具
- 内建默认 `npx -y chrome-devtools-mcp@latest --isolated=true`（临时浏览器 profile）；**不写用户文件**，CLI / 桌面 / IM 网关 / 定时任务四个入口一致
- 用于处理 SPA / JS 渲染 / 防爬墙 / 表单交互页面；微信公众号文章、知乎专栏、推特、小红书等 `web_fetch` 失败站点会引导走浏览器 MCP
- HITL 的“全部放行”支持 MCP server 维度，连续浏览器操作可对 `chrome-devtools` 一次确认
- `image` 类型结果会作为图片输入附加到下一轮；文本 fallback 仍保留，用于日志、人类可读摘要和 API 不接受图片时的上下文
- MCP initialize 默认超时为 60 秒；CLI 首屏默认最多等待 8 秒，超时后先进入交互，未完成的 server 保持 `starting` 并在后台继续启动，可用 `/mcp` 和 `/mcp logs <name>` 追踪

### 第十四期：CDP 会话复用 + 登录态访问

- 新增 `/browser status`、`/browser connect [port]`、`/browser disconnect`、`/browser tabs` 命令组，并给 Agent 暴露内部 `browser_connect` / `browser_disconnect` / `browser_status` 工具
- 默认仍使用 `--isolated=true` 临时浏览器 profile；执行 `/browser connect` 后，运行时把 `chrome-devtools` 切到 `--autoConnect`，复用已在 `chrome://inspect/#remote-debugging` 允许远程调试的登录态 Chrome
- Agent 遇到登录页、权限不足或明确需要登录态页面时，会先调用 `browser_connect` 自动切到 shared；公开页面如微信公众号文章不提前切换
- `/browser connect <port>` 保留旧式 CDP 端口兼容路径：先探活 `127.0.0.1:<port>/json/version`，成功后切到 `--browser-url=http://127.0.0.1:<port>`；失败时不会改 MCP 启动参数，并输出 macOS / Windows / Linux 的 Chrome 启动命令
- 切换 shared / isolated 模式都会清空 `chrome-devtools` 的 server 维度全部放行，避免旧信任跨模式延续
- shared 模式下 `close_page` 只能关闭 Wraith 自己创建的 tab；无法证明是 Wraith 创建的 tab 会被策略层拒绝
- 敏感页面命中规则后，`click` / `fill_form` / `evaluate_script` 等改写型浏览器工具必须单步 HITL 审批，不复用全部放行；读型工具如 `take_snapshot` 仍可继续使用
- 审计日志为 chrome-devtools 工具追加可选浏览器 metadata：`browser_mode`、`sensitive`、`target_url`，旧格式 JSONL 仍可读取

### 第十五期：Skill 系统 + 内置 web-access skill

把"Agent 该怎么思考"从硬编码 system prompt 抽出，沉淀成可复用单元。每个 Skill 是一个目录：`SKILL.md`（决策手册）+ `references/`（按需读取）+ 可选 `scripts/`（可执行依赖）。

- 三层加载位置（按优先级，后者整体覆盖同名 skill）：jar 内置 < 用户级 `~/.wraith/skills/<name>/` < 项目级 `<project>/.wraith/skills/<name>/`
- 启动期把启用 skill 的 `name` + `description` 注入三处 Agent 系统提示词索引段（启用上限 32 个，索引段 ≤ 8KB）
- 内置工具 `load_skill(name)`：LLM 在 system prompt 看到匹配 description 时主动调用，Wraith 把 SKILL.md 正文（5KB 截断）写入 `SkillContextBuffer`，下一轮 user message 自动前置注入
- 内置 web-access skill：决策手册（浏览哲学四步法 + 工具选择表 + 浏览器优先级 + Jina 兜底说明）+ 6 个站点经验文件（mp.weixin / zhuanlan.zhihu / x.com / xiaohongshu / github / juejin）+ cdp-cheatsheet
- frontmatter 走手写 YAML 子集解析，不引 SnakeYAML；解析失败 stderr 警告但不阻塞启动
- CLI 命令：`/skill list` / `/skill show <name>` / `/skill on <name>` / `/skill off <name>` / `/skill reload`
- 启用状态持久化：`~/.wraith/skills.json` 的 `disabled` 列表，默认全启用
- 与 HITL 协同：Skill 内调用 `execute_command` 等危险工具仍走既有 HITL 审批，沿用 `execute_command` 工具维度全放行；不给 Skill 单独审批维度

设计意图：从「写工具」演进到「打包专家手册」。当工具堆成山（Wraith 当前内置 9 个 + MCP 60+ 工具），用 Skill 给 LLM 一份按场景展开的"专家手册"，比往 system prompt 里塞更多规则更可扩展。

### 第十六期：TUI 产品化（v16.1 形态修正后：双形态可切换）

v16.1 抽出 `Renderer` 接口 + 三个实现：

| 形态 | 启用方式 | 视觉风格 |
|---|---|---|
| **inline 流式 TUI**（默认） | 直接运行 / `WRAITH_RENDERER=inline` | Claude Code / Qoder 风格：WRAITH 开场动画 + 常驻左上角 banner、主屏直出、`│ › ` 左下半框输入、JLine `Status` 托管的底部 dock（YOLO/HITL、MCP、Skill、model、ctx、token、cwd 等关键字段带克制彩色高亮；ctx 是当前上下文估算，in/out/cache 是调用统计）、右侧输入提示、行内可折叠工具块（`Read 3 files (ctrl+o to expand)`）、行内 git diff、HITL 单字符 `[y/n/a/s/m]` 提示 |
| **lanterna 全屏 TUI** | `WRAITH_RENDERER=lanterna`（或兼容旧 `WRAITH_TUI=true`） | v16 三栏全屏：文件树 + 对话流 + 状态栏 + 底部输入栏，HITL 模态弹窗 |
| **plain 兜底** | `WRAITH_RENDERER=plain` | 纯 println，无折叠 / 状态栏，等价 v15 行为 |

- 三种形态共享同一套 `Agent` / `ToolRegistry` / `MemoryManager` / MCP server / SkillRegistry / HITL handler，不创建孤立空会话
- 普通输入走 ReAct；`/plan <任务>` 走 Plan-and-Execute；`/team <任务>` 走 Multi-Agent；`/cancel` 可取消运行中任务
- 通用命令：`/clear`、`/context`、`/memory`、`/memory clear`、`/save <事实>`、`/export`、`/hitl`、`/hitl on`、`/hitl off`、`/config`、`/exit`
- 对话历史保存到 `~/.wraith/history/session_*.jsonl`
- 兼容旧设置：`WRAITH_TUI=true` 自动映射为 `WRAITH_RENDERER=lanterna`（已 deprecated）
- `WRAITH_NO_STATUSBAR=true` 在 inline 模式下禁用 JLine 底部 dock（不适合 ANSI 光标控制的终端）
- `NO_COLOR=1` 禁用所有 ANSI 颜色，保留布局
- Smart Tab：输入行展示 fish 风格历史预测（灰色 autosuggestion）时，行尾按 `Tab` 整段补全该建议；否则 `Tab` 仍走 `/` 命令补全
- 开屏先播一段 WRAITH 开场动画；`WRAITH` 字标为 ANSI-Shadow 立体白色，下方 model / MCP / 能力等信息行粗体青色高亮，**常驻冻结在左上角**（对话滚动时保持可见；终端过矮或不支持滚动区时自动降级为随对话滚动）
- 输入框为「左下半框」：行首暗灰竖线 `│` + `› ` 提示符，配下方 dock 自绘的 ` ╰────` 下线（`╰` 与 `│` 同列对齐）
- 多行输入：行尾 `\` + Enter 续行；`Ctrl+J`（及部分终端的 `Alt+Enter`）在光标处插入换行；`Enter` 提交。续行行显示对齐的续行提示符（`│` 竖线在多行间连续），粘贴多行照旧。续行 `\` 提交时被消费（最终文本是干净换行）；**粘贴**内容里的 `\`+换行原样保留（C 宏 / shell 续行不被吞）
- 鼠标点击定位：在输入区点击左键，光标跳到对应位置（多行/续行感知）。默认开启，仅 `readLine` 期间生效（Agent 输出 / 回看滚动时原生鼠标选区照常）；`WRAITH_MOUSE=off` 可关闭（习惯拖拽选区复制的用户，或用 macOS `⌥`-拖 绕过）

### 第十七期：LSP 诊断注入（MVP）

- `write_file` 成功后触发 post-edit 诊断，诊断结果不会阻塞工具主流程
- 当前 MVP 对 Java 文件使用 JavaParser 做轻量语法诊断，不依赖本机安装 JDT LS
- ReAct、Plan-and-Execute、Multi-Agent 三条路径都会在下一轮 LLM 请求前注入 pending 诊断
- 诊断按 error / warning / info、文件、行列号、message 格式化，默认最多注入 20 条
- 配置：`WRAITH_LSP_ENABLED=false` 可关闭，`WRAITH_LSP_MAX_DIAGNOSTICS=20` 可调整注入上限
- 后续增强：接入 JDT LS / rust-analyzer / pyright / gopls 的 stdio JSON-RPC transport

### 第十八期：Git Side-History 快照与回滚（MVP）

- 每个 ReAct / Plan / Team turn 开始前创建 `pre-turn` 快照，结束后异步创建 `post-turn` 快照
- 快照仓库使用 JGit 纯 Java 实现，默认位于 `~/.wraith/snapshots/<project_hash>/<worktree_hash>/.git`，不写用户项目 `.git`
- `/snapshot` 查看最近快照，`/snapshot status` 查看配置与 side-git 目录，`/snapshot clean` 清理当前项目快照目录
- `/restore <N>` 恢复到最近第 N 个 `pre-turn` 快照；恢复前会先创建 `pre-restore` 快照
- Agent 内置 `revert_turn` 工具，纳入 HITL 与 AuditLog 危险工具链
- 配置：`WRAITH_SNAPSHOT_ENABLED=false` 可关闭，`WRAITH_SNAPSHOT_MAX=50`、`WRAITH_SNAPSHOT_EXCLUDES=...`、`WRAITH_SNAPSHOT_DIR=...` 可调整策略

### 第十九期：Prompt 分层架构（MVP）

- ReAct、Plan task executor、Multi-Agent 三角色、Planner 的 system prompt 已从 Java 硬编码抽离到 `src/main/resources/prompts/`
- `PromptAssembler` 按 `base -> personality -> mode -> approval -> runtime_context -> project_context -> skills -> context_mgmt -> handoff` 组装；`runtime_context` 注入当前日期/时区，动态项目上下文靠后注入
- `project_context` 会先注入 `WRAITH.md` 项目记忆，再注入 `/save` 检索到的相关长期记忆和 MCP resource 索引
- 支持用户级覆盖 `~/.wraith/prompts/...`，支持项目级覆盖 `.wraith/prompts/...`，项目级优先级最高
- 覆盖是整文件替换；`base.md` 和最终 prompt 必须包含 `## Language`
- Prompt 改动审计模板见 `docs/prompt-analysis-template.md`

### 第二十期：异步后台任务 + Runtime API（MVP）

- `DurableTaskManager` 使用 SQLite 持久化后台任务队列，默认位置 `~/.wraith/tasks/tasks.db`
- 任务生命周期：`enqueued -> running -> completed / failed / canceled`
- `/task`、`/task add <任务内容>`、`/task cancel <task_id>`、`/task log <task_id>` 提供 CLI 闭环
- Worker Pool 默认 2 个后台 worker，可通过 `WRAITH_TASK_WORKERS` 调整
- `java -jar target/wraith-1.0-SNAPSHOT.jar serve --http --port 8080` 启动 localhost Runtime API
- Runtime API 端点：`POST /v1/threads`、`POST /v1/threads/{id}/turns`、`GET /v1/threads/{id}/events`
- Runtime API 强制要求 `WRAITH_RUNTIME_API_KEY` 或 `-Dwraith.runtime.api.key`
- 详细文档见 `docs/phase-20-runtime-api.md`

### 第二十一期：图片复制粘贴输入（MVP）

- `LlmClient.Message` 支持 `ContentPart`，包括 `text`、`image_base64`、`image_url`
- 请求体在含图片时输出带图片块的 content array，纯文本仍保持 string content
- `LlmClient` 公共接口不做图片能力声明；输入层只负责读取、压缩、附加图片，provider API 负责最终接收或返回错误
- GLM 套餐用户可通过 `/model glm-5v-turbo` 切换到 GLM-5V-Turbo 多模态模型，再用 Ctrl+V 或 `@image:` 输入图片；本地 base64 图片会按智谱格式写入 `image_url.url`
- MCP `image` content 会保留 base64 与 `mimeType`，在 ReAct / Plan / SubAgent 工具结果后作为图片 user message 回灌
- 用户可通过 `@image:file:///abs/path.png`、`@image:/abs/path.png` 或 `@image:relative/path.png` 引用本地图片
- 本地图片和 MCP 图片都会按 Claude Code 同类策略预处理：不是 OCR 成文本，而是压缩 / 缩放后作为图片块发送；带 alpha 的 PNG 会铺白底重编码；额外注入来源、尺寸和坐标映射元信息
- 本地 `@image:` 消息会要求模型优先分析本轮图片；除非用户明确要求结合历史，历史对话和历史工具结果不能替代当前图片内容
- 新一轮 ReAct / SubAgent 任务开始前会省略历史 image payload，仅保留文本元信息，避免旧截图反复进入上下文；模型 `reasoning_content` 默认只写日志 / 展示，DeepSeek V4 / Kimi thinking tool-call 续轮会按 provider 协议带回上一轮 assistant reasoning
- DeepSeek 流式调用默认使用 HTTP/1.1，规避部分 HTTP/2 网关长 SSE 响应被重置导致的 `stream was reset: INTERNAL_ERROR`
- 当前边界：不做视频 / 音频、图像生成、TUI sixel 图片预览

### 第二十三期：微信 iLink 通道（文本 MVP）

- 新增进程级入口：`wraith wechat setup`、`wraith wechat start`、`wraith wechat status`、`wraith wechat daemon start|stop|restart|status|logs`
- 新增交互式入口：在 CLI 主界面输入 `/wechat` 可扫码绑定并在当前进程后台启动微信通道；`/wechat setup` 重新扫码绑定，`/wechat status` 查看状态，`/wechat stop` 停止通道
- 默认不开启微信通道；用户必须主动执行 `setup` 并扫码确认完成绑定
- 支持在 Warp / iTerm2 / WezTerm 等兼容终端内直接显示 260px PNG 二维码；不支持终端图片协议时回退为字符二维码和链接
- 微信侧使用 iLink `getupdates` 长轮询收消息、`sendmessage` 分片回消息，不依赖 SSE；这是独立通道，不是 Skill，也不是 Runtime API
- 运行时只接受绑定用户私聊；普通消息单并发排队，`/help`、`/status`、`/pause`、`/resume`、`/stop` 走队列外控制路径
- 微信侧用户消息会回显到 CLI 终端 transcript；CLI 终端继续显示 thinking / 工具调用过程，微信侧只接收 assistant 正文。iLink 协议层仍是 `text_item.text` 文本消息，没有显式 Markdown parse mode；Wraith 会保留 ClawBot 稳定支持的 Markdown 子集（列表、引用、粗体、行内代码、真实代码块），把标题转成粗体标题、把表格转成移动端更稳的键值/列表，并过滤图片 Markdown / H5-H6 / 中文斜体等兼容性差的标记；非代码类 fenced block（流程说明、长中文箭头链）会解包并换行，避免微信侧出现横向滚动代码块。iLink 不提供真正 SSE 或改单条消息能力。
- 微信通道使用非交互式默认拒绝策略：只读工具默认允许，`write_file` / `create_project` 继续受 workspace PathGuard 限制，`execute_command` 必须精确命中命令白名单，`mcp__*` 必须命中 MCP 白名单，`revert_turn` 和浏览器会话切换默认拒绝
- 当前文本 MVP 会保留图片 / 文件消息的媒体元数据提示，但 CDN 下载解密、图片块输入和 `/send` 文件推送仍待后续媒体链路补齐

### 第二十四期：IM 网关（QQ / 飞书 单聊 bot + 桌面配置面板 + 定时任务投递）

把 Wraith 接成常驻 IM bot：一个本地 Java 守护进程 `wraith gateway` 收发消息、跑 Agent 回合、把 HITL 审批推到 IM 端。全内置工具 + MCP + Skill + 记忆在 IM 形态下同样可用。

- **多平台 provider 架构**（`gateway/spi/ImProvider`）：SPI 定义 `platform / start / stop / deliveryAdapter / surfaceScheduledApproval`；daemon 遍历已配置的 provider，各自跑在守护线程上，主线程阻塞常驻。会话核心（`SessionRouter` / `ImTurnDriver` / `GatewaySession` / `GatewayRenderer` / `Authorizer` / `Dedup`）平台无关、由各 provider 复用；每个 provider 自带独立会话路由，互不串号。加第三个平台是纯增量。
- **QQ 单聊**（`gateway/qq`）：官方个人 bot，`wraith gateway bind` 走 openclaw 扫码绑定拿 appId / 密钥，WS 网关直连 + REST 回发；HITL 走 QQ inline keyboard 三按钮；受 QQ 被动回复窗口约束（60 分钟 / 每 msg_id ≤4 条），投递用「待发队列 + 下次入站冲刷」。
- **飞书 / Lark 单聊**（`gateway/feishu`）：官方 Java SDK（`com.larksuite.oapi:oapi-sdk`）**长连接**收事件——只需出网、免公网 URL，贴合本地 daemon；REST `im.message.create` 回发，统一用 `open_id`（鉴权 / 会话 key / 回发目标一体）；HITL 走飞书**交互式卡片按钮**（`card.action.trigger` 回调经同一条长连接送达）；飞书可随时主动发消息，结果投递与审批卡即时下发（无待发队列）。凭据在飞书开放平台建自建应用后手填；主人身份走 fail-closed + open_id 配对回显（首次私聊 bot 回显你的 open_id，填入桌面即绑定）。飞书 / Lark 双区域可切换。
- **鉴权**：deny-all，仅放行绑定的主人 openid —— 入站消息与按钮回调都按平台认证的真实身份校验。
- **桌面配置面板**：桌面端「IM 网关」屏可视化配置 —— 平台卡片切换、密钥手填（回包只报 `hasSecret`，**绝不回明文**）、启动 / 停止守护进程、结构化状态灯（守护进程输出 `WRAITH_GATEWAY_STATUS`，桌面点灯）、日志查看。后端 `AppServer` 的 `gateway.config.get/set` RPC 带 `platform` 参（默认 QQ，向后兼容），读写 `~/.wraith/config.json`。
- **定时任务投递**（`automation/`）：常驻调度器（interval / daily / weekly）跑无人值守回合，`Deliverer` + `DeliveryAdapter` SPI 把结果投到桌面通知或 IM（`DesktopDeliveryAdapter` / `QqDeliveryAdapter` / `FeishuDeliveryAdapter`）；定时任务的 HITL 审批也能在 IM 端浮出并唤醒挂起回合。cron 独立于 IM——未配置任何 IM 时仅跑定时任务。
- **密钥红线**：appId / clientSecret / appSecret 只落 `~/.wraith/config.json`（仓库外），绝不进日志或 RPC 回包；IM 环境值不出现在任何回传里。

### 第二十五期：安全策略层（第六期 HITL 的后续增强 —— 路径围栏 / 命令快速拒绝 / 操作审计）

`com.lyhn.wraith.policy` 包，在第六期 HITL 之上叠一层策略防线：

- `PathGuard` 路径围栏：文件类工具强制限定在项目根之内，拦截绝对路径外逃 / `..` 穿越 / 符号链接逃逸
- `CommandGuard` 命令快速拒绝：HITL 之前的 fast-fail 黑名单，减少 HITL 弹窗骚扰。两套并存——POSIX 形状（`sudo` / `rm -rf 全盘` / `mkfs` / `dd of=/dev` / fork bomb / `curl|sh` / `find /` / `chmod 777 /` / `shutdown`）与 Windows 形状（`rd`/`del` 打向盘符根 / `format` / `diskpart` / `reg delete` / `takeown` / `icacls … /T` / `vssadmin delete shadows` / `bcdedit` / `Stop-Computer` / `iwr|iex`）
- `policy/sandbox` 命令沙箱：agent 触发的 shell 命令包进操作系统原生沙箱（macOS Seatbelt / Windows AppContainer），默认断网 + 限写 + `.git` 只读；沙箱起不来时 fail-open 降级并把原因带到 UI。**注入范围是 app-server（桌面）/ IM 网关 / 定时任务三条路径——交互式 CLI 不套沙箱**（那里你本就在自己的 shell 上下文里作业），但黑名单、HITL、审计对 CLI 照常生效。详见[第二十七期](#第二十七期windows-命令沙箱与-execute_command-的-posix-假设清算)
- `AuditLog` 结构化审计：危险工具调用按天写 JSONL 到 `~/.wraith/audit/`，含 `outcome (allow|deny|error)` 与 `approver (hitl|policy|none)`；`revert_turn` 也纳入危险工具链
- `write_file` 单文件 5MB 上限；`execute_command` 60 秒超时（超时连同**子孙进程整棵杀掉**）
- CLI 命令：`/policy` 查看安全策略状态、`/audit [N]` 看最近 N 条审计、`wraith sandbox doctor` 体检沙箱

**关于「沙箱」这个词的边界**：Wraith 用的是**操作系统进程级沙箱**（Seatbelt / AppContainer），不是容器或 VM。

多租户、跑不可信代码的场景里，业界的下限是 **microVM 级**隔离（[E2B / Fly.io 用 Firecracker，Modal 用 gVisor](https://modal.com/resources/best-code-execution-sandboxes-coding-agents)）。那一层本项目没有、也不打算做——本地编程 Agent 一旦换进容器就拿不到用户的真实工具链，得不偿失。**威胁模型不同**：本地单用户 Agent 防的是「模型误操作」，多租户平台防的是「恶意用户」，后者才需要 VM 边界。

所以这里的定位是：**HITL 审批为主防线，进程沙箱 + 路径校验 + 命令黑名单 + 审计为纵深**，每层都假设上一层会失守，但都不声称能挡住有意的越狱。

> **与 Claude Code 的对照**（据其[官方沙箱文档](https://code.claude.com/docs/en/sandboxing)，2026-08-02 核）：macOS 同样用 Seatbelt；Linux/WSL2 用 bubblewrap，而 Wraith 在 Linux 上**没有实现**。反过来它**明确不支持原生 Windows**（要求跑在 WSL2 里，且沙箱内跑不了 `cmd.exe` 等 Windows 二进制），Wraith 的 AppContainer 是原生方案。网络围栏两边路子不同：它是本地代理 + 域名白名单（**默认不解 TLS，官方已注明可被 domain fronting 绕过**），粒度细但有缝；Wraith 是 AppContainer 能力位（**内核级拒绝 socket**，无缝但**只有全开/全关，没有域名粒度**）。两边**默认都是 fail-open**。

### 第二十六期：自我认知 + 聊天↔面板能力对等

起因是一个很实在的缺口：问「现在有哪些 IM 已经集成了」，agent 会去 grep **用户的项目代码**，然后回答「本项目没有 IM 集成」——它完全不知道 Wraith 自己就有 IM 网关。顺着查下去发现更大的落差：左侧面板背后约 90 个 RPC 动作，而 agent 手上只有 20 个工具。

分五阶段补齐：

- **自我认知**：新增 `prompts/capabilities.md`（Wraith 自身 11 个面板的能力目录），由 `PromptAssembler` 无条件拼入系统提示词；`base.md` 加元问题判别策略——问「Wraith 有没有 / 怎么用 X」时依目录回答并指路，**不去 grep 用户项目**
- **动作卡**：`open_panel` / `im_connect` 两个「UI 意图」工具（纯参数校验、无副作用、不进审计），渲染层对 `tool.call` **按工具名特判**成可交互卡片。**不新造 AppServer 事件类型**
- **聊天内接入 IM**：微信在卡内直出二维码，QQ 一键打开浏览器授权页，飞书 / 企业微信退化到开面板填密钥；绑定逻辑复用 `ImGatewayPanel` 既有 IPC（抽 `imBind.applyBindEvent` 共享，面板与聊天卡同源）。卡片**点击才启动绑定**——transcript 历史回放会重建卡片，挂载即绑定会在每次 resume 重启绑定进程
- **三模式贯通**（修 bug）：动作卡原先只在 ReAct 出现。Plan / Team 的执行器只把工具调用 `printToolCalls` 到一个 `nullOutputStream`，于是「工具真的跑了、模型照工具返回串说『已为你呈现入口』、而屏幕上什么都没有」。改为给两个执行器加**默认 no-op 的工具调用观察者**（CLI 输出字节不变），桌面接线时**只放行这两个 UI 意图工具**——普通工具在该路径没有 `tool.result`，放行会让工具卡永久停在「运行中」
- **三件套工具**：`task_*`（4）/ `memory_*`（6）/ `automation_*`（5）共 15 个，直调面板同一批 Java 服务；高后果写进 HITL + 全部写操作进审计；自动化目录解析统一到 `AutomationStore.openDefault()`，杜绝「agent 写了、面板读不到」

### 第二十七期：Windows 命令沙箱与 `execute_command` 的 POSIX 假设清算

起因是一句用户反馈：「windows 没有沙箱」。查下去发现**「没沙箱」只是露出水面的部分**——底下压着三个更要命的洞，都源自同一个病根：**把 POSIX 的进程 / shell 假设直接套到 Windows**（与第二十六期后修的 MCP `npx` → `npx.cmd` 同源）。

**先补的三个地基**（与沙箱无关，但沙箱盖在上面）：

| 缺陷 | 现象 | 修法 |
|---|---|---|
| `execute_command` 全平台写死 `bash -c` | Windows 上能否执行完全取决于 `bash.exe` 恰好在 PATH——而 Git for Windows 默认只把 `<install>\cmd` 加进 PATH，`bash.exe` 在 `<install>\bin`，**默认不在** | 抽 `ShellCommand`：Windows → `%ComSpec% /c`，其余 → `bash -c`。此前 `ToolRegistry` 与 `CommandSandbox` **各写死一份**，这也是同一个缺陷能同时存在于两处的原因 |
| `CommandGuard` 九条规则全是 POSIX 词汇 | `rd /s /q C:\`、`format`、`diskpart`、`reg delete`、`vssadmin delete shadows` 一条不拦——而无沙箱时给用户看的文案偏偏写着「仍受命令黑名单保护」，**在 Windows 上那是一句空承诺** | 补 10 条 Windows / PowerShell 形状规则；同时锁死误杀边界（`rd /s /q build`、不带 `/T` 的 `icacls` 必须放行） |
| 超时只杀直接子进程 | Windows 上杀 `cmd.exe` 不连带杀子孙，超时命令留下一地孤儿 | `ProcessHandle.descendants()` 整棵杀。**必须先收集再动手**——杀了父进程这棵树就断了 |
| 子进程输出按 JVM 默认编码解 | JEP 400 之后默认编码恒为 UTF-8，而 Windows 控制台吐的是本地代码页（中文 Windows 是 GBK），**JDK ≥18 上中文必乱码** | 改用 `native.encoding`（Java 17+ 提供，报告的正是 OS 本地编码，不受 JEP 400 影响） |

**沙箱本体**：Windows 用 **AppContainer**——唯一「免管理员 + 内核强制 + 不换工具链」的选项。不给 `internetClient` 能力即内核级断网；写围栏靠把工作区授权给 profile SID，`.git` 显式拒写。语义与 Seatbelt 一一对应。

几个关键取舍：

- **PowerShell 当发射器，不引 JNA**。AppContainer 的难点不是调 Win32，是 **stdio**：走 JNA 得自建管道、把 `HANDLE` 循环 `ReadFile` 桥回 `InputStream`，`ProcessBuilder` 的流处理全部作废。改由 PowerShell 发射（`Add-Type` 就地编译 C# P/Invoke，靠 Windows 自带 .NET 编译器，**不要 MSVC**），它自己的 stdout 就是 Java 给的管道，往下继承即可——**Java 侧一行不用改，零新依赖**
- **两个 profile 而不是一个**：AppContainer 的能力集在**创建时**定死，之后改不了，所以断网 / 联网各建一个，开关只决定用哪个
- **管道必须显式授权给 AppContainer**：其令牌被严格削过，默认 DACL 的匿名管道可能读写被拒。漏掉这步的症状是「命令跑完但一个字都没输出」，极难归因
- **fail-open 而非 fail-closed**：沙箱起不来时裸跑 + 警告。一个「因为没授权 npm 缓存目录就默默掐掉 `npm install`」的沙箱，排查成本远高于它的安全收益。但降级原因这次**一路带到 UI**（此前只进 `log.warn`，桌面用户根本看不到）
- **沙箱状态从 boolean 升为三态**：`macos-seatbelt | windows-appcontainer | none`。此前后端只回布尔，Windows 与「mac 上 sandbox-exec 不见了」拿到同一个 `none`，前端只能靠 `platform` 反推——根因是**后端没把话说清楚**。现在后端直说，前端的 `platform` 判据收窄到只用于区分 Linux（确实没有实现）

**`wraith sandbox doctor`**：四条探针**真跑**，不是看配置。其中两条是**「期望失败」**——工作区外写、联网。前两条绿只说明沙箱没碍事，只有这两条被拦住，才说明它真在拦。这是把验证能力交到用户手里的唯一办法（作者没有 Windows 机器，Win32 调用序列 / 管道 DACL / icacls 授权 / 工具链可读性全部只能在真机验出来）。

> ⚠️ **沙箱会修改工作区的文件 ACL**（授权给 AppContainer SID），**在面板里关掉沙箱不会自动撤销**。撤销方式见 [`windows-usage.md`](windows-usage.md) §6.5。

---

## 附录：分期功能清单

> 这份清单原来在 README 里。它按「第几期加的」组织，对使用者是噪音，
> 但对想知道某个能力什么时候进来的人有用，所以留在这儿。
> 当前的能力清单（按用途组织，不按期数）见 [README](../README.md)。

### 第一期

- 🤖 基于 GLM-5.1 的智能对话
- 🔄 ReAct Agent 循环（思考-行动-观察）
- 🛠️ 工具调用（文件操作、确定性代码搜索、Shell命令、项目创建、RAG 语义检索、联网搜索、MCP 动态工具）
- 💬 交互式命令行界面
- 📝 普通任务和斜杠命令提交后会先把本轮原始输入以 `>` 暗色整行块写回 transcript；输入态仍显示 `* `，单行提交只占一行，不额外追加空白行。普通任务随后再进入 Thinking / 工具调用，避免 dock 刷新或 activity 重绘后用户输入从可见历史里消失
- 🧠 默认通过流式接口获取模型输出；inline ReAct 用固定高度 live thinking 区动态预览 reasoning，content / tool call 开始前清掉 live 区并把完整 reasoning 引用块落到 transcript，回答正文用低调标记起始；web_search / web_fetch 会在折叠头展示 query / URL，并在执行后输出一行结果摘要
- 🖥️ 终端会对常见 Markdown（标题、列表、表格、代码块）做渲染后再显示；表格会按当前窗口宽度分配列宽，并在单元格内部换行，避免长 URL / 中文内容把列打散

### 第二期

- 📋 Plan-and-Execute + DAG 任务拆解与顺序执行
- ⌨️ `/plan` 一次性进入计划执行
- 🧭 更清晰的复杂任务执行顺序与依赖展示
- ⚖️ 简单任务会自动生成最小计划，不再为了凑步数扩展无关步骤

### 第三期

- 🧠 短期记忆、长期记忆与相关记忆检索
- 📦 长对话摘要压缩与 Token 预算管理
- 🧮 长上下文动态预算、prompt cache 可见化与成本估算
- 💾 `/memory` 与 `/save` 记忆管理入口

### 第四期

- 🔍 代码库实时搜索 + RAG 语义辅助（精确定位优先 glob/grep/read，自然语言模糊查询再 search_code）
- 🕸️ 代码关系图谱（类继承、接口实现、方法调用）
- 📡 本地 Ollama Embedding + 远程 API 可配置
- 🗃️ SQLite 向量存储与持久化

### 第五期

- 👥 多 Agent 协作（规划者 + 执行者 + 检查者）
- 🎯 主从架构编排器自动分配任务
- 🔍 检查者审查质量，未通过自动重试
- 🛠️ 执行者共享工具集，支持文件操作与代码检索

### 第六期

- 🔒 危险操作静态规则识别（`write_file` / `execute_command` / `create_project` / `revert_turn`）
- ⚠️ 三级危险等级展示（高危 / 中危 / 安全）
- ✅ 审批决策：批准、全部放行、拒绝、跳过、修改参数后执行
- 🔓 HITL 默认关闭，`/hitl on` 启用、`/hitl off` 关闭

### 第七期

- ⚡ 同一轮多个工具调用会并行执行，适合同时读取多个文件、同时列目录、同时跑独立检查
- 🧵 ReAct、Plan-and-Execute、Multi-Agent Worker 共用同一套并行工具执行机制
- ⏱️ 工具批次有统一超时，超时工具会被取消并把超时结果回灌给模型
- 📋 Plan-and-Execute 与 Multi-Agent 会按 DAG 依赖批次并行推进独立任务

### 第八期

- 🔄 GLM-5.1、GLM-5V-Turbo、DeepSeek V4、阶跃星辰 StepFun、Kimi K2.6、FreeLLMAPI 与讯飞星辰 MaaS（xfyun）多模型，`/model glm-5.1` / `/model glm-5v-turbo` 明确切 GLM 模型，`/model deepseek` / `/model step` / `/model kimi` / `/model freellmapi` / `/model xfyun` 读取配置模型
- 🧱 `LlmClient` 接口 + `AbstractOpenAiCompatibleClient` 模板方法基类，新增 provider 只需 ~20 行
- 🔌 自定义模型接入：任意 OpenAI 兼容端点走 `freellmapi`（`/config provider freellmapi --base-url <url/v1> --api-key <key> --model <id> --default`），无需改代码
- 💾 默认模型持久化到 `~/.wraith/config.json`

### 第九期

- 🌐 `web_search` 工具支持四条路：Step 3.7 Flash + StepSearch MCP 优先、智谱 Web Search（与 GLM 共用 Key默认推荐）、SerpAPI（国际通用付费）、SearXNG（开源自托管免费）
- 📰 `web_fetch` 工具：抓 URL → readability 提取 → 返回 Markdown 正文
- 🛡️ 内置网络访问策略：屏蔽内网、loopback、`file://`；5MB 响应上限；每分钟 30 次限流
- 🚧 边界明确：SPA / 防爬墙返回空正文 + 已知边界提示，不重试

### 第六期 HITL 增强

- 🛡️ 路径围栏：文件类工具强制限定在项目根之内，绝对路径外逃 / `..` 穿越 / 符号链接逃逸全部拦截
- 🧯 命令快速拒绝：HITL 之前的 fast-fail 黑名单，POSIX 与 Windows 两套并存（`sudo` / `rm -rf 全盘` / `mkfs` / `dd of=/dev` / fork bomb / `curl|sh` / `find /` / `chmod 777 /` / `shutdown`；`rd`/`del` 打向盘符根 / `format` / `diskpart` / `reg delete` / `takeown` / `vssadmin delete shadows` / `bcdedit` / `iwr|iex`），减少 HITL 弹窗骚扰
- 🧱 命令沙箱：macOS Seatbelt / Windows AppContainer，默认断网 + 写限工作区 + `.git` 只读；不可用时 fail-open 并在 UI 显示原因
- 📦 资源上限：`write_file` 5MB；`execute_command` 60 秒超时（连同子孙进程整棵杀）+ 8KB 输出截断
- 📋 结构化审计：危险工具调用按天写一行 JSONL 到 `~/.wraith/audit/`，可通过 `/audit [N]` 查看
- 🚧 边界：进程级沙箱，不是容器 / VM；HITL 审批仍是主防线
