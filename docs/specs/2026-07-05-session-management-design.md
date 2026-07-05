# 会话管理(新建/改名/删除/star)+ 自动化会话可见性修复 — 设计

日期:2026-07-05
状态:已批准(待写实现计划)

## 1. 背景与现状

会话(session)是一次对话的持久化单元。当前形态:

- **数据模型** `SessionMeta`:字段 `id / cwd / createdAt / updatedAt / provider / model / title / turns`。
  - TS:`desktop/src/shared/types.ts:122-132`;Java:`src/main/java/com/lyhn/wraith/session/SessionMeta.java:15-24`。
  - `title` 由首条用户消息自动派生(≤50 字);**无 starred、无用户自定义名**。
- **持久化** `SessionStore`(`src/main/java/com/lyhn/wraith/session/SessionStore.java`):
  - 每项目一目录 `~/.wraith/sessions/<sha256(projectPath)[:8]>/`(`:63`),每会话一个 JSONL 文件(首行 `SessionMeta`,其余为消息)。
  - 现有操作:`list(limit)`(`:161`,按 updatedAt 倒序)、`resume(id)`(`:136`)、`persist(messages)`(`:84`)、`deleteCurrent()`(`:124`,仅删当前会话)。
  - **无按 id 改名 / 删除 / 加星** 的操作。
- **侧边栏** `Sidebar.tsx`:`window.wraith.listSessions()` → `session.list` RPC → `Main.java listSessions()`(`:1197`,`sessionStore.list(50)`,**仅当前项目**)。选中 → `handleSelectSession(id)`(`App.tsx:242`)→ `resumeSession`。除"查看会话"外**无任何单会话操作 UI**。
- **自动化"查看会话"**:`AutomationRuns.tsx:70-72` 的按钮 → `onOpenSession(projectPath, r.sessionId)` → `App.tsx handleOpenAutomationSession`(`:585-593`):先按需 `switchToProject(projectPath)`,再 `handleSelectSession(sessionId)`。

## 2. 问题(两个 bug)

**症状 1 — 点"查看会话"不跳转。** `AutomationsPanel.tsx:150` 把 `current.projectPath` 传给 `AutomationRuns`。但经 projectPath→workspace 迁移后,daemon/app-server 存储与返回的任务**只有 `workspace`、没有 `projectPath`**(Java `AutomationTask` 丢弃 TS-only 字段)。于是传入 `undefined` → `handleOpenAutomationSession(undefined, …)` → `switchToProject(undefined)` 失败 → 提前 `return`,跳转从未发生。与表单 `projectPath` 回退(`AutomationForm`)属同一类字段迁移遗漏。

**症状 2 — 定时任务触发后左侧不显示新会话。** 自动化跑在独立的 **daemon 进程**(`GatewayDaemon` + `AutomationRunner`),跑完 `store.persist()` 把会话写进 `~/.wraith/sessions/<hash>/`。但**没有任何信号通知桌面刷新会话列表**;侧边栏只在自身事件(turn 变化 / 切项目 / 挂载)时 `fetchSessions()`。后台生成的会话因此不可见,直至偶然刷新。

两者均为**跨进程 / 跨层一致性缺口**,与 ScheduleKind、projectPath 属同族。

## 3. 目标 / 非目标

**目标**
- 修复上述两个 bug(范围:**任务所在项目内**可见 + 可靠跳转)。
- 会话支持:**新建**(显式按钮)、**改名**(自定义名)、**删除**、**star(标重点)**。
- 侧边栏:顶部"⭐ 重点"独立分区置顶 starred 会话。

**非目标(YAGNI)**
- 不做跨项目会话聚合(跨项目会话仍需切到该项目才显示)。
- 不改 `list()` 排序契约(star 分组在 UI 层)。
- 不做批量操作、不做标签/搜索。

## 4. 数据模型变更

`SessionMeta` 新增两字段(TS + Java 同步):

| 字段 | 类型 | 语义 |
|---|---|---|
| `starred` | `boolean`(默认 false) | 是否标为重点 |
| `name` | `string?`(可空) | 用户自定义名;显示用 `name || title` |

**向后兼容**:旧会话文件无这两字段。
- Java:`SessionMeta` 反序列化容忍缺字段(`starred` 缺→false;`name` 缺→null),必要时加 `@JsonIgnoreProperties(ignoreUnknown=true)` 防未来字段。
- TS:`starred?`/`name?` 可选,读取端 `s.starred ?? false`、`s.name || s.title`。

## 5. SessionStore 新增操作(Java,当前项目目录内按 id)

- `setStarred(String id, boolean starred)` — 读该会话 JSONL → 改首行 meta 的 `starred` → 原子写回(temp + `Files.move` ATOMIC_MOVE,与 `AutomationStore` 一致)。
- `rename(String id, String name)` — 同上,写 meta 的 `name`(空串或 null → 清除自定义名,回落 `title`)。
- `deleteById(String id)` — 删除该会话 JSONL 文件(存在才删;不存在幂等返回)。
- 仅在当前 store(即当前项目 hash 目录)内按 id 操作;`list()` 排序不变。

## 6. RPC 面(AppServer + preload + IPC,照现有 `session.*` 模式)

新增三个 JSON-RPC(`AppServer.java` 分发 + `Main.java` SessionRunner 实现):

| 方法 | 参数 | 结果 | 实现 |
|---|---|---|---|
| `session.setStarred` | `{ sessionId, starred }` | `{ ok }` | `sessionStore.setStarred(id, starred)` |
| `session.rename` | `{ sessionId, name }` | `{ ok }` | `sessionStore.rename(id, name)` |
| `session.delete` | `{ sessionId }` | `{ ok }` | `sessionStore.deleteById(id)` |

- preload(`desktop/src/preload/index.ts`):`setSessionStarred / renameSession / deleteSession`。
- IPC(`desktop/src/main/index.ts`):`wraith:setSessionStarred / renameSession / deleteSession` → 转发 `session.*`(照 `wraith:resumeSession` 模式,`!client` 抛 "Backend not connected")。
- **删除当前打开会话**:后端返回后,前端选下一条(或开新会话),再 `fetchSessions()`。

## 7. Bug 修复

**症状 1**:`AutomationsPanel.tsx:150` 改传 `current.workspace ?? current.projectPath`(与 `AutomationForm` 项目回退同源)。view-session 拿到真实项目路径,`switchToProject` 正常;若与当前项目相同则跳过切换、直接 `handleSelectSession(sessionId)`(其 `resumeSession` 从磁盘按 id 读该项目会话文件)。

**症状 2**:桌面 Part D 自动化通知轮询(`main/index.ts:646`,30s)在发现**新终态 run**(已有逻辑)时,除弹系统通知外,再向 renderer 发一个信号触发 `fetchSessions()`。当前项目与任务 workspace 一致时,跑完的会话即自动出现在侧边栏。(跨项目不自动显示 = 范围内取舍。)

## 8. UI(Sidebar 重构)

- 顶部 **`＋ 新建会话`** 按钮:复用现有新会话逻辑(`App.tsx:231` 附近的 `startSession` 新会话路径)。
- **`⭐ 重点`** 分区:`starred===true` 的会话成组置顶(纯函数分组,不改 list 排序);下方"全部"列其余。任一分区为空则不显示其标题。
- **每行**:显示 `name || title`;hover 出三个小动作:
  - `★/☆` 切换 star → `session.setStarred`;
  - `✎` 就地改名(小 input / 弹框)→ `session.rename`;
  - `🗑` 删除(二次确认,复用 `确认删除?` 模式)→ `session.delete`。
- 每个动作成功后 `fetchSessions()` 刷新;删除当前会话则先切走再刷新。

## 9. 单写者 / 并发 / 边界

- **单写者**:会话文件的 star/改名/删除一律经 **app-server** 的 `SessionStore`。daemon 仅在跑自动化时 `startNew()+persist()` 新建会话,`id` 唯一(`yyyyMMdd-HHmmss-xxxx`),不与 app-server 并发写同一 id。
- **原子写**:star/rename 重写 meta 首行走 temp+ATOMIC_MOVE;读端对缺失/损坏文件降级(与现有 store 一致)。
- daemon 跑完写盘 → app-server 之后对该文件的操作(用户去 star/改名)是**时序错开**的(run 已结束),非并发。

## 10. 测试策略

**Java**
- `SessionStore`:`setStarred` / `rename`(含清除)/ `deleteById`(含幂等)单测——临时目录建会话、操作、断言 meta 或文件存在性。
- `SessionMeta` JSON:含新字段 round-trip;**旧文件(无 starred/name)兼容读**(starred→false,name→null)。
- `AppServer`:三新 RPC 端到端(建会话 → setStarred/rename/delete → list 验证)。

**桌面**
- 纯函数:`name || title` 显示、`starred` 分组(重点/其余拆分)。
- 回归:`AutomationsPanel` 传 `workspace ?? projectPath`(症状 1);Part D 触发 `fetchSessions`(症状 2,以可测的信号函数覆盖)。
- e2e(视情):侧边栏 star 置顶、改名、删除、新建。

## 11. 触点清单(便于计划切任务)

| 层 | 文件 | 改动 |
|---|---|---|
| 模型 | `desktop/src/shared/types.ts:122`、`session/SessionMeta.java:15` | +starred +name |
| 存储 | `session/SessionStore.java` | +setStarred/rename/deleteById |
| RPC | `runtime/appserver/AppServer.java`、`cli/Main.java:1197+` | +3 方法 |
| 桥 | `desktop/src/preload/index.ts:133`、`desktop/src/main/index.ts:476` | +3 方法/handler |
| Bug1 | `desktop/src/renderer/components/AutomationsPanel.tsx:150` | workspace 回退 |
| Bug2 | `desktop/src/main/index.ts:646`(Part D) | 新 run → 刷会话信号 |
| UI | `desktop/src/renderer/components/Sidebar.tsx`、`App.tsx` | 分区/动作/新建按钮 |

## 12. 门禁

- Java 全量 0F/0E;桌面 typecheck + vitest 全绿;提交前密钥红线扫描(`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`,只应命中字段名/自指/测试金丝雀)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`。
