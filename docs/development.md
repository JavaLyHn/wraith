# 开发者文档

> 这份文档是**给要改这个仓库的人**看的：怎么构建、怎么测、代码放在哪、技术栈是什么、
> 改动时要联动什么、怎么发版。
>
> 它从 README 里搬出来 —— README 该先回答「这是什么、怎么用」。
>
> **与 [`AGENTS.md`](../AGENTS.md) 的分工**：`AGENTS.md` 是**协作契约**（架构约束、
> 每处改动的联动清单、踩过的坑与不许回退的决定），细到具体函数名。本文是**上手入口**：
> 装什么、跑什么命令、目录长什么样。要动某个子系统之前，先读 `AGENTS.md` 里对应那节。
>
> 其它：[README](../README.md) · [终端手册](cli-manual.md) ·
> [演进历程](evolution.md) · [规划](ROADMAP.md) ·
> [Windows 快速上手](windows-quickstart.md)

## 目录

- [1. 环境要求](#1-环境要求)
- [2. 构建与运行](#2-构建与运行)
- [3. 测试策略](#3-测试策略)
- [4. 项目结构](#4-项目结构)
- [5. 技术栈](#5-技术栈)
- [6. 三套版本号是解耦的](#6-三套版本号是解耦的)
- [7. 改动时的联动](#7-改动时的联动)
- [8. 截图与演示环境](#8-截图与演示环境)
- [9. 发版](#9-发版)

---

## 1. 环境要求

| 软件 | 版本 | 谁需要 |
|---|---|---|
| **JDK** | **17**（仓库按 17 编译） | 全部 |
| **Maven** | 任意近版 | 全部 |
| **Node** | ≥ 18 | 只有桌面端需要 |
| Git | 任意近版 | 全部 |

可选（各自只服务一小块功能，缺了不影响构建）：

| 命令 | 服务什么 | 不装的后果 |
|---|---|---|
| `ollama` | 本机 embedding（`/index`、`/search`、`search_code` 工具、代码图谱） | 那几项报连不上 `11434`；可改用云端 embedding |
| `ripgrep` | `grep_code` 的加速路径 | 自动回退到 Java 实现，功能不变 |
| `uvx`（属于 [uv](https://docs.astral.sh/uv/)，**不属于 Node**） | 起 Python 生态的 MCP server | 那几个 MCP 起不来 |

---

## 2. 构建与运行

### Java 后端

```bash
mvn clean package -DskipTests        # 出 jar（默认跳过测试）
java -jar target/wraith-1.0-SNAPSHOT.jar
```

> ⚠️ **`mvn package` 默认跳过测试。** 这是刻意的（优先产出可手工验收的 jar），
> 但它意味着**你必须显式写 `-DskipTests=false` 才会真的跑测试** —— 见 [第 3 节](#3-测试策略)。

### 桌面端（`desktop/` 子工程）

```bash
mvn clean package -DskipTests                       # 先出后端 jar
cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar   # ← 关键一步，见下
cd desktop
npm install --legacy-peer-deps                      # --legacy-peer-deps 不能省
npm run dev
```

首次 checkout 或切换到新的 worktree 后，`desktop/node_modules` 可能不存在；此时 `npm run dev` 会自动执行 `npm install --legacy-peer-deps` 补齐桌面依赖。依赖已存在时不会重复安装。若网络或 npm 安装失败，命令会保留原始错误并停止启动，可手动执行同一安装命令后重试。

> ⚠️ **桌面 dev 态 spawn 的是 `~/.wraith/wraith.jar`，不是 `target/`。**
> 改了 Java 后端只跑 `mvn package` **等于没改，而且不报错** —— 表现是调新 RPC 报
> `method not found`，或者改动毫无效果。必须把 jar 拷到 `~/.wraith/wraith.jar` 再重启 App。
> Windows 上 `desktop/scripts/dev-win.ps1` 会替你做这一步。

改动生效范围：

| 改了什么 | 要做什么 |
|---|---|
| Java 后端 | 重新 package + 拷 jar + **重启 App** |
| 渲染层（`.tsx` / `.css`） | 热更新，什么都不用做 |
| preload / 主进程 | **完全重启** App（否则报 `window.wraith.X is not a function`）|

### 出安装包

```bash
cd desktop
npm run dist:mac      # macOS：dmg + zip（未签名）
npm run dist:win      # Windows：NSIS 安装包（必须在 Windows 上跑）
```

`dist:win` **不能交叉出包** —— 捆绑 JRE 由宿主 `jlink` 产出、`node-pty` 是原生模块，
构建脚本会硬拦下来。详见 [windows-release.md](windows-release.md)。

### 其它形态

```bash
java -jar target/wraith-1.0-SNAPSHOT.jar app-server        # stdio NDJSON 后端（桌面用）
java -jar target/wraith-1.0-SNAPSHOT.jar gateway           # 常驻 IM 网关
java -jar target/wraith-1.0-SNAPSHOT.jar serve --http      # Runtime HTTP API
java -jar target/wraith-1.0-SNAPSHOT.jar terminal doctor    # 终端诊断
java -jar target/wraith-1.0-SNAPSHOT.jar sandbox doctor     # 沙箱体检
```

---

## 3. 测试策略

### Java

**测试默认跳过。** 不写 `-DskipTests=false` 的话 `mvn test` 也不会跑 —— 这是本仓库最容易
造成「假绿」的一处，务必记住：

```bash
# 发版或大范围重构前跑全量（当前约 2340 条）
mvn test -DskipTests=false

# 只跑某几个类（逗号分隔；**不能用 +**）
mvn test -DskipTests=false -Dtest=SnapshotStaleLockTest,SearchConfigRulesTest

# 第 16 期终端 / TUI / inline renderer 冒烟
mvn test -Pphase16-smoke

# 常规快速回归，跳过外部进程 / 网络超时 / 命令超时类慢测试
mvn test -Pquick

# 代码搜索 deterministic golden set
mvn test -Dtest=CodeSearchGoldenSetTest -DskipTests=false
```

> **`set -o pipefail`**：`mvn ... | tail && echo 绿` 里的 `&&` 看的是 `tail` 的退出码，
> 测试失败也会打「绿」。要么加 `set -o pipefail`，要么别把 mvn 的输出接进管道再判成败。

### 桌面端

```bash
cd desktop
npx tsc --noEmit      # 类型检查（应当 0 错）
npx vitest run        # 单测（当前约 1774 条 / 186 个文件）
npm run e2e           # Playwright E2E（会先 build）
```

> **E2E 有一小簇真·负载相关抖动**（审批族：快跑全绿、慢跑偶掉 1–2 条）。
> 怀疑自己改出了回归时**先 stash 跑两次基线**再对比 —— 否则分不清是你的改动还是抖动。

### 写测试的纪律

这个仓库对测试有几条硬要求，来自反复踩坑：

- **测试不许断言「即将被改掉的契约」**。改行为时如果有测试变红，先判断它守的是
  「一个真实意图」还是「当时的实现细节」。前者要保留意图、只改期望；后者才该删。
- **突变验证**：新加的测试要能证明自己有咬合力 —— 把被测逻辑改坏，它必须变红。
  这不是形式，本仓库有多条测试在写成之初其实抓不住目标（判据太宽）。
- **别让判据自己咬自己**：例如「凡输出含 `?` 就算漏映射」会把合法的 `[?]` 也判成漏。

---

## 4. 项目结构

<!-- 结构树见下；每层的职责与联动规则在 AGENTS.md 「仓库结构」与「修改时的硬规则」 -->

```
src/main/java/com/lyhn/wraith
├── agent/
│   ├── Agent.java              # ReAct Agent
│   ├── PlanExecuteAgent.java   # Plan-and-Execute Agent
│   ├── AgentRole.java          # Agent 角色枚举
│   ├── AgentMessage.java       # Agent 间通信消息
│   ├── SubAgent.java           # 可配置子代理
│   └── AgentOrchestrator.java  # Multi-Agent 编排器
├── cli/
│   ├── Main.java               # CLI 入口
│   ├── CliCommandParser.java   # 命令解析
│   └── PlanReviewInputParser.java  # 计划审核输入
├── llm/
│   ├── LlmClient.java          # provider 抽象接口（能力声明：window / prompt cache）
│   ├── AbstractOpenAiCompatibleClient.java  # OpenAI 兼容模板基类（Authorization: Bearer）
│   ├── LlmClientFactory.java   # provider 名 → 具体 Client 的工厂
│   ├── GLMClient.java          # GLM；glm-5.1 走 Coding endpoint，glm-5v-turbo 走多模态 endpoint
│   ├── DeepSeekClient.java     # DeepSeek V4 客户端
│   ├── StepClient.java         # 阶跃星辰 StepFun 客户端
│   ├── KimiClient.java         # Kimi / Moonshot 客户端
│   ├── FreeLlmApiClient.java   # 通用 OpenAI 兼容网关客户端（自定义模型接入入口）
│   └── XfyunMaaSClient.java    # 讯飞星辰 MaaS 客户端
├── context/
│   ├── ContextMode.java        # short / balanced / long 模式
│   ├── ContextProfile.java     # 模型窗口与上下文策略
│   └── TokenUsageFormatter.java # Token / cache / 成本展示
├── memory/
│   ├── MemoryEntry.java        # 记忆条目
│   ├── ConversationMemory.java # 短期记忆
│   ├── LongTermMemory.java     # 长期记忆
│   ├── ContextCompressor.java  # 上下文压缩
│   ├── TokenBudget.java        # Token 预算管理
│   ├── MemoryRetriever.java    # 记忆检索
│   └── MemoryManager.java      # 记忆门面类
├── plan/
│   ├── Task.java               # 任务定义
│   ├── ExecutionPlan.java      # 执行计划
│   └── Planner.java            # 规划器
├── rag/
│   ├── EmbeddingClient.java    # Embedding API 客户端
│   ├── VectorStore.java        # SQLite 向量存储
│   ├── CodeChunk.java          # 代码块模型
│   ├── CodeChunker.java        # 代码分块器
│   ├── CodeAnalyzer.java       # AST 关系分析
│   ├── CodeRelation.java       # 代码关系模型
│   ├── CodeIndex.java          # 索引管理器
│   └── CodeRetriever.java      # 检索入口
├── tool/
│   └── ToolRegistry.java       # 工具注册表（11 个内置工具）
├── config/                     # WraithConfig：provider / api key / model / base_url（读写 ~/.wraith/config.json）
├── mcp/                        # MCP 客户端：stdio + Streamable HTTP、resources、step_search、@mention 展开
├── web/                        # web_search（智谱/SerpAPI/SearXNG）、web_fetch（Jsoup readability）、网络安全策略
├── browser/                    # Chrome DevTools MCP 会话、CDP 复用、敏感页面策略、/browser 命令
├── skill/                      # Skill 系统：SKILL.md 加载、load_skill、内置 web-access
├── hitl/                       # Human-in-the-Loop 审批流（Renderer / Terminal 两种 handler）
├── policy/                     # PathGuard 路径围栏、CommandGuard 命令黑名单、AuditLog 审计
├── prompt/                     # PromptAssembler 分层 prompt 组装（resources/prompts/ + 用户/项目级覆盖）
├── lsp/                        # 第17期 LSP 诊断注入（JavaParser 语法诊断）
├── snapshot/                   # 第18期 Side-Git 快照与回滚（JGit）
├── runtime/                    # 第20期 异步后台任务（SQLite 队列）+ Runtime HTTP API
├── image/                      # 第21期 图片输入：读取 / 压缩 / 缩放、@image: 解析
├── wechat/                     # 第23期 微信 iLink 通道（文本 MVP）
├── gateway/                    # 第24期 IM 网关 daemon：ImProvider SPI（spi/）+ QQ（qq/）+ 飞书（feishu/）+ openclaw 绑定（bind/）+ 会话路由 / 驱动 / 鉴权
├── automation/                 # 定时任务调度（Scheduler：interval/daily/weekly）+ Deliverer / DeliveryAdapter 投递（delivery/：desktop / QQ / 飞书）
├── render/                     # Renderer 接口 + inline 流式 / plain 实现、行内 diff、底部状态栏
├── tui/                        # lanterna 全屏 TUI、代码高亮、对话历史快照
└── util/                       # AnsiStyle、Markdown 渲染等公共工具
```

> 桌面 App（Electron + React + TypeScript）在独立子工程 `desktop/`：renderer 组件（会话 / 计划 / MCP / IM 网关 / 自动化面板）、preload `window.wraith` 桥、main 进程（Java app-server sidecar + 网关进程管理），经 JSON-RPC 复用同一套 Java 内核（`~/.wraith/wraith.jar`）。

---

## 5. 技术栈

- Java 17
- Maven
- 多 LLM Provider（GLM / DeepSeek / StepFun / Kimi / FreeLLMAPI / 讯飞星辰，均 OpenAI 兼容）
- OkHttp
- Jackson
- JLine 4（终端交互、Status、输入 widgets）
- SQLite（向量与图谱持久化）
- JavaParser（AST 分析）
- Ollama（本地 Embedding）
- 飞书开放平台 Java SDK（`com.larksuite.oapi:oapi-sdk`，IM 网关飞书长连接 + 卡片回调）
- Electron + React + TypeScript（桌面 App，独立子工程 `desktop/`）
- koffi（FFI，Windows 桌宠 `WS_EX_NOACTIVATE` 调 user32；带各平台预编译二进制，免 node-gyp）
- electron-builder（打包：macOS dmg/zip + Windows NSIS，均未签名）

---

## 6. 三套版本号是解耦的

这是最容易改错的地方 —— 仓库里有**三个互不相干的版本号**：

| 在哪 | 是什么 | 发版时要不要改 |
|---|---|---|
| `desktop/package.json` + `package-lock.json` + git tag | **产品版本**（semver，用户看到的那个） | ✅ **只改这里** |
| `pom.xml` 的 `1.0-SNAPSHOT` | **固定产物名**。约 30 处引用它（脚本、文档、桌面打包脚本里的 jar 路径） | ❌ **别动**，改了会同时断掉那 30 处 |
| `Main.java` 里的 `v16.1.0` | 启动横幅上的**开发期编号**（第几期） | 只在推进期数时改 |

改错的症状：动了 `pom.xml` 的版本 → 桌面打包找不到 jar、所有文档里的 `java -jar target/wraith-1.0-SNAPSHOT.jar` 全部失效，而且**报的是「文件不存在」而不是「版本不对」**。

---

## 7. 改动时的联动

细清单在 [`AGENTS.md`](../AGENTS.md) 的「修改时的硬规则」，那里按子系统列到函数名。这里只放
**最容易漏、且漏了不报错**的三条：

### ① 改命令入口 → 四处联动

`Main.java`（提示表）+ `CliCommandParser.java`（真实 dispatch）+ 测试 + 文档（[终端手册](cli-manual.md)）。

漏了提示表的后果不是「少点便利」：命令敲得动但 Tab 补不出来、`/` 菜单里也没有，
**等于这个功能不存在**。仓库里有一条 `SlashCommandDiscoverabilityTest` 守着这件事 ——
它比对 parser 认的字面量与提示表，漏一条就变红。

### ② 新增一个桌面面板 → **六处注册表**

前三处漏了会立刻报错，**后三处漏了不报错**，只会静默破坏「聊天 ↔ 面板对等」：

1. 面板组件本身
2. 左侧栏导航项
3. App 的路由/状态
4. `commandPalette.NAV_ITEMS` ← 漏了命令面板里搜不到
5. `ToolRegistry.open_panel` 的白名单 ← 漏了 agent 打不开它
6. `capabilities.md` ← 漏了 agent 不知道有这个面板

后两处改完还要**同步 jar** 才生效（见 [第 2 节](#2-构建与运行)）。

### ③ 「快照 vs 活对象」—— 本仓库已经踩过七次

凡是「配置改了但要本次会话立刻生效」的地方，写完配置必须**失效缓存/重载**，否则表现是
「存成功了但没反应」。已经踩过的七处：沙箱护盾、动作卡、pet 窗口、补全、`web_search` 的
provider 缓存、计价表、搜索后端。新增同类配置时先问一句：**谁持有它的快照？**

---

## 8. 截图与演示环境

README 里的截图有一条纪律：**不消耗 API 额度、不暴露任何个人数据**。所以对话内容全部由
脚本化的演示后端驱动。

终端截图的环境在仓库里：

```bash
bash scripts/screenshots/cli-demo.sh            # 起交互式 CLI（演示环境）
bash scripts/screenshots/cli-demo.sh approval   # 同上，但这一轮会触发 HITL 审批卡
bash scripts/screenshots/cli-demo.sh doctor     # 只跑 wraith terminal doctor
bash scripts/screenshots/cli-demo.sh clean      # 收拾（停端点 + 删演示 HOME）
```

它做三件事：起一个本机**假 LLM 端点**（说 OpenAI 兼容的 SSE，按轮次回预先编好的内容）、
造一个隔离的 `HOME` 与演示项目、在那个 HOME 下起 wraith。因此**不会读写你真实的
`~/.wraith/config.json`，也读不到仓库根的 `.env`**，状态栏里的路径也是中性的 `~/acme-service`。

要换演示内容改 `scripts/screenshots/mock_llm.py` 里的 `EDIT_TURNS` / `APPROVAL_TURNS`。

> 拍审批卡那张要**先在 REPL 里敲 `/hitl on`** —— 交互式 CLI 的 HITL 默认是关的。

---

## 9. 发版

macOS 的发版流程与 Windows 出包分别在：

- [windows-release.md](windows-release.md) —— Windows 出包与发布 runbook
- 版本号只改 `desktop/package.json` + lock + git tag（见 [第 6 节](#6-三套版本号是解耦的)）

已知的三个坑：

| 坑 | 表现 | 怎么办 |
|---|---|---|
| GitHub 资产上传 `i/o timeout` | 大文件（dmg 上百 MB）上传中断 | 重试即可，不是构建问题 |
| 后台脚本的退出码被 echo 掩掉 | 脚本失败了却打「成功」 | 脚本末尾显式 `exit $rc`；判成败别接管道（同 [第 3 节](#3-测试策略)的 `pipefail`） |
| macOS Gatekeeper 报「已损坏」 | 未签名 + 被隔离属性标记；右键「打开」**无效** | `sudo xattr -cr /Applications/Wraith.app`（必须 `sudo`，内置 JRE 含只读文件） |
