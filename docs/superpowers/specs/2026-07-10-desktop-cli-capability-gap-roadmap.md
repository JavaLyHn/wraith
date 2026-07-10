# 桌面版 vs CLI 能力差集 —— 补齐路线图(roadmap)

**日期:** 2026-07-10 **状态:** 差集已审计(三路探查 + 代码核验),本文固化差距与补齐优先级
**背景:** v1.1.0 已发布四平台 IM 网关 + 桌面图标精修。此文回答「CLI 实现了但桌面没有」并规划补齐。

## 方法与事实基线

对齐三个面并逐点核验代码:
- **CLI 能力面**:`src/main/java/com/lyhn/wraith/cli/Main.java`(49 类斜杠命令 + 子命令)、`tool/ToolRegistry.java`(19 工具)。
- **桌面能力面**:`desktop/src/main/index.ts`(79 个 `ipcMain.handle('wraith:*')`)、renderer 7 个主视图。
- **AppServer 桥**:`runtime/appserver/AppServer.java` dispatch = **48 个 RPC**(权威 `case` 列表)。

关键事实:
- 桌面 spawn `java -jar wraith.jar app-server`(`desktop/src/main/backend.ts:15/41`),**不传任何 `-D`**。
- 默认 `ToolRegistry` 构造(`ToolRegistry.java:130-144`)全量注册 file/shell/code/**rag**/**web**/**browser**/**memory**/skill/**snapshot**/todo → 桌面回合内 agent **仍能把这些当工具用**;缺的是**用户可操作的入口/界面**。
- 沙箱默认断网:`buildAppServerSandbox()` 读 `-Dwraith.sandbox.network`(默认 `off`,`Main.java:1674-1678`),桌面无从开启。

## 一、真正的功能缺口(无 AppServer RPC + 桌面无界面)

| # | 功能 | CLI 入口 | 桌面现状 | 根因 | 层级 |
|---|---|---|---|---|---|
| 1 | 长期记忆管理 | `/memory list/search/delete/clear`、`/save` | agent 能调 `save_memory` 工具写,无查看/搜索/删除/手动保存 UI | 无 `memory.*` RPC | 工具在、入口缺 |
| 2 | RAG 索引 + 语义检索 | `/index`、`/search` | agent 有 `search_code` 工具,无建索引入口(无库可搜)、无搜索界面 | 无 RPC | 工具在、入口缺 |
| 3 | 代码知识图谱 | `/graph <类>` | 完全没有 | 无 RPC | 彻底无 |
| 4 | 快照浏览 + 任意回滚 | `/snapshot`、`/restore N` | 仅 `session.rewind`(按消息)+ `revert_turn` 工具,无多快照时间线 + 任意恢复 UI | 无 `snapshot.*` RPC | 部分覆盖 |
| 5 | 浏览器/CDP 会话控制 | `/browser status/connect/disconnect/tabs` | agent 有 `browser_*` 工具,无会话管理面板、不能选 shared/isolated/端口 | 无 RPC | 工具在、入口缺 |
| 6 | 安全策略 + 审计查看 | `/policy`、`/audit N` | HITL 走 `approval.respond`,无策略状态展示、无审计查看 | 无 RPC | 彻底无 |
| 7 | 对话导出 | `/export` → Markdown | 无(renderer 无「导出」入口) | 无 RPC(但**纯客户端即可**) | 彻底无 |
| 8 | 项目记忆初始化 | `/init` 生成 `WRAITH.md` | 无 | 无 RPC | 彻底无 |
| 9 | 沙箱网络开关 | `-Dwraith.sandbox.network=on` | 恒断网,🛡️徽标只读 | 桌面硬编码 spawn 参数 | 彻底无 |

## 二、CLI 专属通道/形态 —— 非能力缺口(桌面用别的方式覆盖或不适用)

- **`/wechat` 进程内微信** → 桌面用**网关 weixin provider** 覆盖(bind-weixin + 单聊 + HITL);同游标不可同跑,仅入口不同。
- **无头/基础设施**:`serve --http`、`app-server`(桌面即其消费者)、`gateway`(桌面用 `gatewayManager` 驱动)、`wechat daemon` —— 底层,桌面已复用。
- **TUI 渲染**(inline/lanterna/plain)—— 终端概念,GUI 不适用。
- **终端交互**:单键 HITL、`Ctrl+V` 贴图、斜杠 Tab 补全、字标冻结 —— 桌面有 GUI 等价(计划审查卡片/附件选择器/输入区)。
- **`--continue`/`--resume`** → 桌面会话列表。
- **多 Provider env/`-D` 配置** → 桌面 Provider 管理 GUI。
- **`/plan`、`/team`** → 桌面 ModeSwitcher(React/Plan/Team)**已有**。

## 三、桌面反超 CLI(完整性记录)

原生文件选择、多项目/工作区持久化、消息编辑重发、会话只读预览、OS 通知 + 红点、自动更新检查、语音输入(STT)、主题切换。

## 补齐优先级

- **高价值/低成本**:#7 对话导出(纯客户端,零后端)、#1 记忆查看(加 `memory.*` RPC + 面板)。
- **中**:#2 RAG 索引+检索(加 `rag.*` RPC + 索引按钮 + 搜索框)、#4 快照时间线+restore(加 `snapshot.*` RPC + 可视化时间线)。
- **低/可选**:#5 浏览器面板、#3 代码图谱、#6 策略+审计查看、#9 沙箱网络开关。

---

## 首个切片(本次实现):#7 对话导出

**目标:** 桌面聊天区一个按钮,把**当前会话的完整 transcript** 导出为 Markdown 文件。对齐 CLI `/export`。零 Java 后端改动。

**数据源:** renderer 的 `Item[]`(`desktop/src/shared/transcriptReducer.ts:89-97`),变体:
`user` / `message`(助手) / `thinking` / `tool`(ToolCard) / `diff` / `plan` / `planReview` / `team`。

**架构(沿用 updateCheck 的「纯函数 + 单测」范式):**
1. **纯函数** `transcriptToMarkdown(items, meta)` → `string`,放 `desktop/src/renderer/lib/transcriptMarkdown.ts`;`meta = { title, model?, workspace?, exportedAt }`(时间由调用方传入,保持可测)。配 `desktop/test/transcriptMarkdown.test.ts` 覆盖每种 Item + 空会话。
2. **保存通道**(Electron 主进程,非 Java 后端):新增 `ipcMain.handle('wraith:saveTextFile', (defaultName, content) => dialog.showSaveDialog + fs.writeFile)`,preload 暴露 `saveTextFile(defaultName, content)`。
3. **UI**:聊天区头部加「导出」按钮(lucide `Download`,1.5px 单色,对齐图标克制化);点它 → `transcriptToMarkdown(items, {...})` → `saveTextFile('<会话名>-<日期>.md', md)`。会话为空时禁用。

**Markdown 形态(约定):**
- 文件头:`# <会话标题>` + 元信息行(模型 / 工作目录 / 导出时间)。
- `user` → `## 👤 用户` + 正文。
- `message` → `## 🤖 助手` + 正文。
- `thinking` → `> 💭 思考:…`(blockquote,done 才含完整;折叠意味)。
- `tool` → `### 🔧 <name>` + `参数`(```json 代码块)+ `输出`(``` 代码块;空则省略)。
- `diff` → `### 📝 <filePath>` + ```diff 代码块(before/after 以 -/+ 行呈现,超长可截断并标注)。
- `plan` → `## 📋 计划:<goal>` + 步骤清单(`- [x]/[ ]` 按 status)。
- `planReview` → 同 plan,标注「复审」。
- `team` → `## 👥 团队:<goal>` + agents 列表 + 步骤清单。

**边界:** 只导出 renderer 当前持有的 transcript(与 CLI `/export` 同语义——导当前对话);不回后端拉历史。长工具输出可截断并标注「…(已截断 N 字)」防文件过大。

**验证:** vitest 纯函数全绿 + typecheck + build;手动:导出后 Markdown 在编辑器渲染正常。
