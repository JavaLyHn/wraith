# Wraith 终端使用手册

> 这份文档覆盖 **CLI（终端）形态的全部用法**：怎么启动、界面上每一块是什么、
> 能敲的每一条命令做什么、快捷键、环境变量。
>
> 找别的东西：
> [README](../README.md) 上手与产品形态 ·
> [Windows 快速上手](windows-quickstart.md) ·
> [Windows 详版与排障](windows-usage.md) ·
> [开发者文档](development.md)

## 目录

- [1. 启动与退出](#1-启动与退出)
- [2. 界面上每一块是什么](#2-界面上每一块是什么)
- [3. 你能输入三种东西](#3-你能输入三种东西)
- [4. 快捷键](#4-快捷键)
- [5. 全部命令](#5-全部命令)
  - [5.1 对话与会话](#51-对话与会话)
  - [5.2 三种运行模式](#52-三种运行模式)
  - [5.3 模型与配置](#53-模型与配置)
  - [5.4 危险操作审批（HITL）](#54-危险操作审批hitl)
  - [5.5 长期记忆](#55-长期记忆)
  - [5.6 代码检索（RAG）](#56-代码检索rag)
  - [5.7 快照与回滚](#57-快照与回滚)
  - [5.8 MCP server](#58-mcp-server)
  - [5.9 Skill](#59-skill)
  - [5.10 浏览器接管](#510-浏览器接管)
  - [5.11 后台任务](#511-后台任务)
  - [5.12 微信通道](#512-微信通道)
  - [5.13 安全策略与审计](#513-安全策略与审计)
- [6. 子命令（不进 REPL 的那些）](#6-子命令不进-repl-的那些)
- [7. 环境变量](#7-环境变量)
- [8. 出问题时](#8-出问题时)

---

## 1. 启动与退出

装好短命令后（见 [README](../README.md)）：

```bash
wraith            # 在当前目录起交互式 CLI
```

没装短命令就直接跑 jar：

```bash
java -jar ~/.wraith/wraith.jar
```

**在哪个目录启动很重要** —— Wraith 把「当前工作目录」当作项目根：文件读写的围栏、代码索引、
快照、项目级记忆（`WRAITH.md`）全部以它为界。

退出：`/exit`、`/quit`，或 `Ctrl+D`。

> **交互式 CLI 不套命令沙箱。** 桌面端 / IM 网关 / 定时任务里 `execute_command` 走 AppContainer（Windows）
> 或 Seatbelt（macOS），而你在终端里手动跑的那一轮**不套** —— 因为你就在现场，能看见它要干什么。
> 相应地，终端里更该把 [HITL](#54-危险操作审批hitl) 打开。

---

## 2. 界面上每一块是什么

启动后是这样（真实录屏，对话内容由脚本化的演示后端驱动）：

![Wraith CLI 启动](images/cli-intro.gif)

一轮完整对话长这样：

![Wraith CLI 一轮完整对话](images/cli-turn.png)

从上往下：

| 区域 | 是什么 |
|---|---|
| 字标 + `Wraith v16.1.0` | 启动横幅。那个版本号是**开发期编号**，与发布版本号（`package.json` / git tag）是两套 |
| `Model wraith-demo (demo)` | 当前 provider 与模型 |
| `MCP 1/1 · 29 tools · 23/23 skills · ReAct` | 装配结果：MCP server 就绪数、可用工具总数、skill 启用数、当前运行模式 |
| `Thinking...` + 竖线引文 | **思考面板**。模型的 reasoning 实时流出来（只有思考型模型有）；下一段输出会就地把它换掉 |
| `▶ ReadFile(README.md) (ctrl+o to expand)` | 工具调用块，折叠态。`ctrl+o` 展开看完整参数与结果 |
| 正文 | 模型的最终回答，Markdown 实时渲染 |
| `› ` 那一行 | 输入行。右侧提示 `⏎ send · / commands · @path · @image` |
| 底部两行 | **状态栏**。第一行是 HITL 开关提示；第二行是模型 / 运行状态 / 上下文水位 / 本轮耗时 / 当前目录，右侧是 MCP 与 skill 计数 |

上下文水位那个条（`ctx ▓░░░░ 12% (15.3k/128.0k)`）值得多看一眼：到高水位时
[ContextCurator](development.md) 会分级压缩历史，你也可以手动 `/compact`。

> **终端降级时会少东西**：状态栏需要 scroll region（要准确的行数），拿不到就不显示；
> 思考面板只要终端能写 ANSI 就有。两者的前提不同，所以「没有状态栏」不代表「没有思考面板」。
> 判定结果用 `wraith terminal doctor` 看。

---

## 3. 你能输入三种东西

**① 自然语言** —— 直接说要干什么。这是主路，不需要任何前缀。

```
把 OrderService 的 total 方法加上单价为负数时抛异常
```

**② 斜杠命令** —— 敲 `/` 会弹出命令菜单，方向键选、Tab 补全。全部命令见 [第 5 节](#5-全部命令)。

**③ `@` 引用** —— 把文件或图片塞进这一轮的上下文。

| 写法 | 作用 |
|---|---|
| `@src/main/java/App.java` | 把这个文件的内容附上（Tab 可补全路径） |
| `@image:` | 附一张图片。**只有视觉模型能看图**（`glm-5v*` 一族）；纯文本模型会在发送前被拦住并告诉你原因 |

---

## 4. 快捷键

| 键 | 作用 |
|---|---|
| `Enter` | 发送 |
| `Ctrl+O` | 展开 / 收起工具调用块 |
| `Ctrl+Y` | **切换 HITL**（危险操作审批）。状态栏会显示当前是 `HITL` 还是 `YOLO` |
| `Esc` | 取消正在跑的这一轮（思考面板上会写 `esc to cancel`） |
| `↑` / `↓` | 翻输入历史 |
| `Ctrl+R` | 反向搜索输入历史 |
| `Tab` | 补全命令 / provider 名 / `@` 路径 |
| `Ctrl+D` | 退出 |

> 这些都依赖**原生终端控制**（raw mode）。若终端降级成 `DumbTerminal`，行编辑、补全、历史、方向键
> 会一起失灵 —— 那不是配置问题，是 JLine 拿不到终端。诊断跑 `wraith terminal doctor`，
> Windows 上的成因与修法见 [windows-usage.md](windows-usage.md)。

---

## 5. 全部命令

敲一个 `/` 就会把它们列出来，方向键选、Tab 补全：

![/ 命令菜单](images/cli-commands.png)

<sub>截图在 Windows 上取（列表较长，图里只到 `/quit`）。**下面的表格才是权威清单** ——
截图会随构建落后于代码，而这些表是照 `CliCommandParser` 的真实 dispatch 写的。</sub>

命令**大小写不敏感**。带 `<>` 的是必填参数，带 `[]` 的可省。

### 5.1 对话与会话

| 命令 | 做什么 |
|---|---|
| `/clear` | 清空当前对话历史（不删磁盘上的会话记录） |
| `/cancel` | 取消当前正在跑的一轮（等价于按 `Esc`） |
| `/compact` | 手动压缩对话历史。上下文水位高时自动压缩也会发生 |
| `/resume` | 列出本项目的历史会话并续接 |
| `/resume <会话名>` | 直接按名字续接某个历史会话 |
| `/export` | 把当前会话导出成 Markdown |
| `/init` | 生成项目级记忆 `WRAITH.md`（扫一遍项目，写下约定与坑） |
| `/init --force` | 已有 `WRAITH.md` 时**覆盖重写** |
| `/history clear` | 清空本机的**输入历史**（就是 `↑` 能翻到的那些） |
| `/exit` · `/quit` | 退出 |

### 5.2 三种运行模式

同一套内核，三种编排方式。默认 **ReAct**。

| 命令 | 做什么 |
|---|---|
| `/plan` | **下一条**任务用 Plan-and-Execute（先出计划再逐步执行） |
| `/plan <任务内容>` | 直接用计划模式执行这条任务 |
| `/team` | **下一条**任务用 Multi-Agent 协作 |
| `/team <任务内容>` | 直接用多 Agent 协作执行这条任务 |

不带参数的 `/plan` / `/team` 只影响**紧接着那一条**，之后自动回到 ReAct。
当前模式在启动横幅和状态栏都能看到。

### 5.3 模型与配置

| 命令 | 做什么 |
|---|---|
| `/model` | 看当前 provider 与模型 |
| `/model <provider>` | 切 provider（Tab 从**已配置的**里选） |
| `/model <provider> <model>` | 同时指定模型名 |
| `/config` | 打开配置 palette（只读视图 + 切换提示） |
| `/config provider <name>` | 配置某个 provider（Tab 补全已配置的名字） |

`/config` 还有几个不在补全菜单里的写入形式，因为它们参数多、更适合照文档抄：

```bash
/config provider deepseek --api-key sk-xxx --model deepseek-chat --default
/config provider myrelay  --base-url https://relay.example.com/v1 --api-key sk-xxx --model gpt-4o
/config provider claude   --protocol anthropic --api-key sk-ant-xxx --model claude-sonnet-4-5
/config search   --provider searxng --base-url http://localhost:8888
/config search   --provider serpapi --api-key sk-xxx
/config pricing  --list
```

> **搜索后端现在也能在桌面端配**（能力概览 → 网页搜索与抓取 → 就地填），
> 不必非用 `/config search`。两条路走同一份校验规则。

配置落在 `~/.wraith/config.json`，**CLI 与桌面共用同一份**。

### 5.4 危险操作审批（HITL）

| 命令 | 做什么 |
|---|---|
| `/hitl` | 看当前状态 |
| `/hitl on` | 打开审批 |
| `/hitl off` | 关闭审批 |

**交互式 CLI 里 HITL 默认是关的。** 打开后，写文件 / 执行命令 / 建项目 / 回滚快照 /
删记忆 / 改定时任务 / 任何 MCP 工具调用都会停下来等你点头。审批时可以：
放行这一次、**当场改命令**、对这个工具「本会话放行」、或者拒绝。

危险等级按工具定：`execute_command`、`revert_turn` 是 🔴 高危，
`write_file`、`create_project` 是 🟡 中危，MCP 工具统一 🟡。

### 5.5 长期记忆

`/memory` 可简写成 `/mem`（下表每一条都通用）。

| 命令 | 做什么 |
|---|---|
| `/memory` | 记忆状态总览 |
| `/memory list` | 列出长期记忆 |
| `/memory search <关键词>` | 搜当前项目可见的记忆 |
| `/memory delete <id>` | 删一条 |
| `/memory clear` | 清空 |
| `/save <事实内容>` | 手动存一条**项目级**记忆 |
| `/save --global <事实内容>` | 存成**全局**记忆（跨项目可见） |
| `/context` · `/ctx` | 看上下文与记忆状态 |

**自动提取出来的候选要你批**：Wraith 会从对话里沉淀「值得记住的事实」，但**不直接写进记忆**，
而是放进候选区等你过一眼。

| 命令 | 做什么 |
|---|---|
| `/memory pending` | 看候选列表 |
| `/memory approve <id>` | 采纳一条（写入长期记忆） |
| `/memory reject <id>` | 丢弃一条 |
| `/memory pending clear` | 全部清空 |

> 凭证类内容（API key、token、密码）在**写入候选之前**就被硬拦，不会进入记忆的任何一层。

### 5.6 代码检索（RAG）

| 命令 | 做什么 |
|---|---|
| `/index` | 索引当前代码库 |
| `/index [路径]` | 索引指定路径 |
| `/search <查询>` | 语义检索代码 |
| `/graph <类名>` | 看这个类的关系图谱（谁调它、它调谁） |

> **索引需要一个 embedding 后端**。默认走本机 [ollama](https://ollama.com)（`nomic-embed-text`）；
> 没装会报连不上 `11434`。也可以在桌面「检索设置」里改成云端 embedding，或者干脆不建索引 ——
> 内置工具里只有 `search_code` 依赖它，`grep_code` / `glob_files` 不依赖。

### 5.7 快照与回滚

每轮对话前后各存一张 **Side-Git 快照**：一个**完全独立**的 git 仓库，`gitDir` 在
`~/.wraith/snapshots/<项目哈希>/`，worktree 指向你的项目根。所以它**不碰你自己的 `.git`** ——
不占你的 index、不产生你能看见的 commit、`git status` 里什么都不多。

| 命令 | 做什么 |
|---|---|
| `/snapshot` | 看最近的快照列表 |
| `/snapshot status` | 快照状态（目录、保留数、排除项、最近一张） |
| `/snapshot clean` | 清掉当前项目的整个快照目录 |
| `/restore <N>` | 恢复到**最近第 N 个 pre-turn** 快照 |

`/restore` 之前会先自动存一张 `pre-restore` 快照 —— 所以「撤销这次恢复」也是可能的。

### 5.8 MCP server

| 命令 | 做什么 |
|---|---|
| `/mcp` | 所有 MCP server 的状态 |
| `/mcp restart <name>` | 重启一个 |
| `/mcp logs <name>` | 看它的日志 |
| `/mcp enable <name>` / `/mcp disable <name>` | 启用 / 禁用 |
| `/mcp resources <name>` | 看它暴露的 resources |
| `/mcp prompts <name>` | 看它暴露的 prompts |

新增 MCP server 走桌面端的「推荐 MCP · 一键添加」最省事（命令与路径自动预填）；
也可以直接编辑 `~/.wraith/mcp.json`。

> Windows 上加 MCP 常见两个坑：机器上**没装 Node**（`npx` 不存在），
> 或者 `uvx` 不属于 Node 而属于 [uv](https://docs.astral.sh/uv/)。见 [windows-usage.md](windows-usage.md)。

### 5.9 Skill

| 命令 | 做什么 |
|---|---|
| `/skill` · `/skill list` | 列出所有 skill 及启用状态 |
| `/skill show <name>` | 看 `SKILL.md` 全文 |
| `/skill on <name>` / `/skill off <name>` | 启用 / 禁用 |
| `/skill reload` | 重新扫描 skill 目录 |

### 5.10 浏览器接管

| 命令 | 做什么 |
|---|---|
| `/browser` · `/browser status` | 会话状态 |
| `/browser connect` | 复用**已允许远程调试**的登录态 Chrome（shared 模式） |
| `/browser connect <port>` | 旧式 CDP 端口连接 |
| `/browser tabs` | 看 shared 模式下真实的 Chrome tab |
| `/browser disconnect` | 切回 isolated 模式（干净的临时浏览器） |

### 5.11 后台任务

| 命令 | 做什么 |
|---|---|
| `/task` | 后台任务列表 |
| `/task add <任务内容>` | 提交一个后台任务（不占用当前会话） |
| `/task cancel <task_id>` | 取消 |
| `/task log <task_id>` | 看结果 |

后台任务与桌面端、定时任务共用同一个 `DurableTaskManager`，落盘可跨重启。

### 5.12 微信通道

| 命令 | 做什么 |
|---|---|
| `/wechat` · `/wechat setup` | 扫码绑定并启动微信 iLink 通道 |
| `/wechat status` | 通道状态 |
| `/wechat stop` | 停掉当前进程内的通道 |

> ⚠ 微信通道**不能与 `wraith gateway` 同时跑**（同一个账号只能有一条连接）。
> QQ / 飞书 / 企业微信走的是常驻网关，见 README 的 IM 网关一节。

### 5.13 安全策略与审计

| 命令 | 做什么 |
|---|---|
| `/policy` | 看安全策略状态（路径围栏、命令黑名单、沙箱开关、资源上限） |
| `/audit` | 今日最近 10 条危险工具审计 |
| `/audit [N]` | 今日最近 N 条 |

审计按天落盘（默认 `~/.wraith/audit/`），支持 30 天回溯。

---

## 6. 子命令（不进 REPL 的那些）

这些是 `wraith` 后面直接跟的参数，跑完就退出，不进交互界面。

| 命令 | 做什么 |
|---|---|
| `wraith terminal doctor` | **终端诊断**：JLine 实际拿到什么终端、哪个 provider 失败、为什么、四项能力判定、逃生阀清单 |
| `wraith sandbox doctor` | **沙箱体检**：四条探针真跑，其中两条**期望失败**（工作区外拒写、断网）—— 只有它们被拦住才说明围栏在生效 |
| `wraith app-server` | 起 stdio NDJSON 后端（桌面 App 用它，也可用于无 UI 的自动化验证） |
| `wraith gateway` | 起常驻 IM 网关（QQ / 飞书 / 企业微信 / 微信） |
| `wraith serve --http [--port N]` | 起 Runtime HTTP API |
| `wraith wechat setup` / `status` / `stop` | 微信通道的进程外形式 |

Windows 上短命令还多两个开关（由 `wraith.cmd` 包装）：

| 命令 | 做什么 |
|---|---|
| `wraith -d` | 起桌面开发态 |
| `wraith -h` | 看用法 |
| `wraith-install` | 改完 Java 后重装 jar |

---

## 7. 环境变量

只列会影响终端体验的。全部变量见各自特性的文档。

**渲染与终端**

| 变量 | 作用 |
|---|---|
| `WRAITH_RENDERER=plain` | 关掉 inline 渲染，最朴素最不容易出问题 |
| `WRAITH_FORCE_ANSI=true` | 强制认定终端支持 ANSI。**值必须是 `true`**，写 `1` 不生效 |
| `WRAITH_NO_STATUSBAR=true` | 只关底部状态栏（思考面板仍然保留） |
| `WRAITH_INTRO=off` | 关掉开屏动画 |
| `WRAITH_TERM_THEME` | 终端配色主题 |
| `WRAITH_MOUSE` | 鼠标支持开关 |
| `NO_COLOR` | 通用约定：设了就不上色 |

**快照**

| 变量 | 作用 |
|---|---|
| `WRAITH_SNAPSHOT_ENABLED=false` | 干脆关掉快照 |
| `WRAITH_SNAPSHOT_DIR` | 快照根目录（默认 `~/.wraith/snapshots`） |
| `WRAITH_SNAPSHOT_MAX` | 保留张数（默认 50） |
| `WRAITH_SNAPSHOT_EXCLUDES=a,b` | 追加排除目录（默认已含 `target` / `node_modules` / `dist` / `release` 等） |
| `WRAITH_SNAPSHOT_STALE_LOCK_SECONDS` | 多久算「死锁」，默认 60。实测一次快照最慢约 8 秒，**别调得比它小** |

**目录与日志**

| 变量 | 作用 |
|---|---|
| `WRAITH_MEMORY_DIR` | 长期记忆目录 |
| `WRAITH_TASK_DIR` · `WRAITH_TASK_WORKERS` | 后台任务的落盘目录与并发数 |
| `WRAITH_AUDIT_DIR` | 审计落盘目录 |
| `WRAITH_LOG_DIR` · `WRAITH_LOG_LEVEL` | 日志目录与级别 |
| `WRAITH_HISTORY_FILE` · `WRAITH_HISTORY_SIZE` | 输入历史文件与条数 |

**其它**

| 变量 | 作用 |
|---|---|
| `WRAITH_LSP_ENABLED` | LSP 诊断注入开关 |
| `WRAITH_MCP_STARTUP_WAIT_SECONDS` · `WRAITH_MCP_INITIALIZE_TIMEOUT_SECONDS` | MCP 启动等待与初始化超时 |
| `WRAITH_RUNTIME_API_KEY` | Runtime HTTP API 的鉴权 key |

---

## 8. 出问题时

| 症状 | 先看这里 |
|---|---|
| 方向键 / Tab 补全 / 历史全失灵 | `wraith terminal doctor`。多半是 JLine 降级成 `DumbTerminal`；Windows 上的根因通常是 `jni` provider 被 native access 检查挡住，见 [windows-usage.md](windows-usage.md) |
| 起来第一行是「终端不支持 ANSI」 | 那句话在旧版里是**错判**（DumbTerminal ≠ 终端不解释 ANSI），已修。跑 doctor 看真实判定 |
| emoji 变成 `??` 或 `?` | 中文 Windows 控制台码页是 GBK，表示不了 emoji。已自动降级成 `[!]` 这类 ASCII |
| 中文输入回显成 `???`（英文正常） | 同一个根因：dumb 终端按码页读输入。修好 `jni` 一并解决 |
| 发完消息很久没反应 | 先看有没有 `准备本轮`。若停在那儿，是 pre-turn 快照慢（大仓库），可用 `WRAITH_SNAPSHOT_EXCLUDES` 排掉大目录 |
| 每轮都刷「快照失败」且重启无效 | Side-Git 里留了死锁。新版会自动清理超过 60 秒没人动的锁，跑新 jar 即可 |
| 索引 / 语义检索报连不上 `11434` | 本机 embedding 后端（ollama）没装或没起 |
| 加 MCP 报 `Cannot run program "npx"` / `"uvx"` | 前者要装 Node，后者要装 uv —— 它们**不是同一个东西** |
