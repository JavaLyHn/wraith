# 桌面端「项目」面板 + 归档聊天（桌面 & CLI）—— 设计说明

- 日期：2026-08-05
- 状态：设计确认，待实现
- 分支：`feat/windows-parity-block1`
- 触发：用户给出 Codex 的项目面板截图（项目列表 / 行内展开会话 / `···` 菜单 / 会话行归档），要求「当前就仅仅是一个下拉框，请你重新设计一下，参照 codex」；后续追加「请你为 wraith 设计一下归档聊天的功能，然后归档以后去设置中找」
- 相关：`docs/superpowers/specs/2026-08-05-*`（顶栏 Git pill 由另一个 session 负责，本设计不写任何 git 代码）

---

## 0. 一句话

把侧栏那个 131 行的项目下拉框拆成两件东西：一个**独立的「项目」面板**（搜索 + 双列排序 + 重点分区 + 行内展开近期会话 + 行内动作），和一个**瘦身后的侧栏快切下拉**；同时新增**会话归档**——归档的会话从侧栏消失、收进「设置 › 归档」，让归档取代侧栏上的删除，并让 CLI 的 `/archive` 命令族走同一套存储。

---

## 1. 需求边界

### 1.1 做什么

| 能力 | 落点 |
|---|---|
| 项目面板：搜索（名称 + 路径） | 新面板 |
| 项目面板：名称 / 已更新 双列可点排序 | 新面板 |
| 项目面板：☆ 重点分区置顶 | 新面板 + settings 新字段 |
| 项目面板：行内展开该项目近期会话（懒加载） | 新面板 + 新 RPC |
| 项目面板：行内「新建对话」 | 新面板 |
| 项目面板：`···` → 编辑项目 / 归档聊天 / 移除 | 新面板 |
| 侧栏：轻量快切下拉（重点 + 最近 5 + 全部项目… + 添加项目…） | 改造 `ProjectSwitcher` |
| 会话归档 / 取消归档 / 永久删除 | `SessionMeta` 新字段 + 新 RPC + 设置新分区 |
| 设置 › 归档：跨项目归档列表 + 搜索 + 项目筛选 | 新组件 |
| CLI `/archive` 命令族（6 个子命令）接上派发 | 补齐工作区里已有的解析层（见 §2.8） |

### 1.2 明确不做（这一版）

- **不做 Composer 上方的 chip 行**（`📁 项目 · 💻 本地 · ⑂ 分支`）。用户另一个 session 正在做「环境信息」面板，**git 分支 / 变更数的数据通路所有权归那个 session**。本设计一行 git 代码都不写，避免两条 git 通路打架。
- **不做「本地 / 云端」概念**。wraith 只有本地执行形态，一个恒真的 chip 不携带信息。
- **不做项目级的 AGENTS/WRAITH.md 编辑**。`···` → 编辑项目只改别名。
- **不做会话跨项目移动**。
- **不做 Codex 那个「要在 X 内开发什么？」的建议卡首页**（图6）。本设计里「新建对话」复用现有 `onNewConversation` 落到现有首页。
- **不给 agent 加 `projects_*` / `archive_*` 工具**。这一版只做 UI；`open_panel` 白名单要登记（见 §6.1），但没有读写项目/归档的工具。

### 1.3 三个「置顶/收起」概念的划界

图7 里 Codex 的会话行是 `📌 + 🗄`。wraith 已经有 `⭐ 重点`（`Sidebar.tsx:76` 的 `session-star`），**它就是 Codex 那个 📌**。用户明确要求「收藏就是现在的重点，保持这样就行」，所以：

| 概念 | 粒度 | 图标 | 状态 |
|---|---|---|---|
| 重点 | 会话 | ☆ / ★ | **已有**，行为与视觉都不动 |
| 重点 | 项目 | ☆ / ★ | 本设计新增，**沿用同一个词、同一个图标、同一种分区形态** |
| 归档 | 会话 | 🗄 | 本设计新增 |

不引入「收藏」「置顶」等第二个词指同一件事。

---

## 2. 现状盘点（读码确认，非推测）

### 2.1 项目下拉框

`desktop/src/renderer/components/ProjectSwitcher.tsx`（131 行）：一个宽 `calc(100% - 1.5rem)` 的 Popover，触发器显示 `📁 <名称> ▾`，内容是项目列表（每行：名称按钮 + `✎` 重命名 + `✕` 移出）+ 分割线 + `＋ 添加项目…`。挂在 `Sidebar.tsx:296`。

数据契约：

```ts
// desktop/src/shared/types.ts:173
export interface ProjectView {
  path: string
  name?: string
  lastUsedAt: number
  exists: boolean
}
```

```ts
// desktop/src/main/settings.ts:14
export interface ProjectEntry {
  path: string        // 绝对路径,唯一键(去重依据)
  name?: string       // 显示别名;缺省 UI 用目录名
  lastUsedAt: number  // epoch ms,最近使用排序
}
```

现有处理函数全在 `App.tsx`：`switchToProject`（切项目 → 自动恢复最近会话 → 刷 context/mcp → `fetchProjects` 让 `lastUsedAt` 浮顶）、`handleAddProject`（`App.tsx:849`）、`handleRemoveProject`、`handleRenameProject`。`turn === 'running'` 时禁激活/添加（读 `turnRef.current` 即时快照，不依赖闭包），重命名与移出不受限。

### 2.2 会话存储是**按项目分目录**的

```java
// src/main/java/com/lyhn/wraith/session/SessionStore.java:67
public static SessionStore open(Path home, String projectPath, String provider, String model) {
    String key = projectPath == null || projectPath.isBlank() ? "default" : projectPath;
    Path dir = home.resolve(".wraith").resolve("sessions").resolve(hash(key));
    return new SessionStore(dir, key, provider, model);
}
```

`hash` 是 SHA-256 前 8 字节的 hex（`SessionStore.java:460`）。`session.list` 走 `Main.java:1485` → `sessionStore.list(50)`，而那个 `sessionStore` 绑死在**当前活跃项目**上。

**结论：「展开项目 X 看它的会话」拿不到数据，图2 必须加后端 RPC。** 前端按 `SessionMeta.cwd` 分组是行不通的——一次 `session.list` 里所有条目的 `cwd` 都相同。

两个关键性质（决定新 RPC 安全性）：

- `SessionStore.open` **纯拼路径、无副作用**，不 `mkdir`。给「加进列表但从没跑过」的项目调用它不会污染磁盘。
- `list()` 在目录不存在时直接 `return List.of()`（`SessionStore.java:316`）。

不考虑「Electron main 自己去读那些 jsonl」这条路：得在 TS 里重写一遍 SHA-256 截断哈希，Java 侧一改哈希就静默失效。

### 2.3 `list()` 已有的过滤与排序

```java
// SessionStore.java:329-333
// 过滤掉自动化无头运行的会话:它们只属于「运行历史」,不进主对话列表
if (m != null && !ORIGIN_AUTOMATION.equals(m.origin())) { metas.add(m); }
```

之后按 `updatedAt` 倒序（`:338`），再按 `limit` 截断。**归档过滤加在同一处**，语义一致：都是「不进主对话列表，但仍可按 id resume/peek」。

### 2.4 `SessionMeta` 与 `rewriteMeta`

`SessionMeta` 是 11 元 record（`session/SessionMeta.java`）。改字段的机械成本已核实：**全仓库 `new SessionMeta(` 只有 7 处、3 个文件** —— `SessionStore.java`、`tui/history/ConversationSnapshot.java`、`test/.../AppServerSessionTest.java`。

单字段改写有现成机制，`setStarred` 就是范本：

```java
// SessionStore.java:212
public synchronized boolean setStarred(String id, boolean starredFlag) {
    return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
            m.provider(), m.model(), m.title(), m.turns(), starredFlag, m.name(), m.origin()));
}
```

`rewriteMeta` 走 `write()`（`:401`），临时文件 + `AtomicFileMove.moveIntoPlace`，整文件原子重写首行 meta。

### 2.5 AppServer 的扩展点

`AppServer.SessionRunner`（`AppServer.java:25`）是一个全 default 方法的接口，实现在 `Main.java:1394` 起的匿名类里。已有 `setSessionStarred` / `renameSession` / `deleteSession` 三个同形方法，新方法照抄这个形状即可。app-server 路径的 `home` 是 `Path.of(System.getProperty("user.home"))`（`Main.java:1396`）。

所有 handler 都有 `if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }` 守卫。新 RPC 沿用——面板只在 `session.start` 之后才可能打开。

### 2.6 设置面板

`SettingsPanel.tsx:9` 一个二级导航，五项：我 / 界面 / 宠物 / 计价 / 关于。加一项只动这个文件 + 新组件，**不碰 §6.1 的六处注册表**。

### 2.7 可复用的现成件

| 件 | 位置 | 用途 |
|---|---|---|
| `partitionStarred` | `lib/sessionView.ts:11` | 重点/其余两段式分区，项目面板照抄形状 |
| `sessionDisplayName` | `lib/sessionView.ts:4` | `name ?? title` 回落 |
| `baseName` | `lib/paths.ts` | 路径 → 目录名 |
| Popover | `components/ui/popover` | 侧栏快切下拉、`···` 菜单 |
| `confirmDel` 二步确认 | `Sidebar.tsx:86` | 逻辑搬进归档区的永久删除 |

**不复用** `contextPanelView.ts:48` 的 `relativeTime`：它封顶在「N 小时前」且带「前」字，而 Codex 的形态是无后缀短式（`2 分` / `1 小时` / `3 天`）且需要天/月档。另写一个，不动老的（老的在上下文面板里语义正确）。

### 2.8 工作区里躺着的半成品 `/archive`（已处置）

设计期间在工作区发现一套**未跟踪的、三层缺一层**的归档实现：

| 层 | 状态 |
|---|---|
| 解析层 `CliCommandParser.java` | **完整**。`ARCHIVE` / `ARCHIVE_LIST` / `ARCHIVE_SHOW` / `ARCHIVE_RESTORE` / `ARCHIVE_DELETE` / `ARCHIVE_CLEAR` 六个 `CommandType` + 匹配（子命令先于裸 `/archive`，避免 `"/archive list"` 被当参数）。`/archive <标题>` 把余下文本当自定义标题 |
| 提示层 `Main.java:3429` | **完整**。六条 `SlashCommandHint` |
| 存储层 `archive/ArchiveStore.java` + `ArchiveMeta.java` | 写完了，但**零引用**（Main 里没有派发层，六个命令解析完没人执行） |

存储层走的是**另一套模型**：跨项目集中存 `~/.wraith/archives/`，`archive(List<Message>, ...)` 把内存里的对话**拷一份冻结**为独立 `ArchiveMeta`（含 `messageCount`、可改 title）。

**已删除存储层两个文件**（用户确认；未跟踪代码，删前已备份到会话 scratchpad）。**解析层与提示层全部保留** —— CLI 侧本来就该有这套命令。

删的理由不是「不好」，而是**两者的数据源头不同**：

- `/archive` 冻结的是**内存里的活动对话**（可能还没落盘），源头只有 `List<Message>` → 只能拷，`archive(history, ...)` 这个签名对它是对的
- 桌面 🗄 归档的是**磁盘上一条完整的会话文件** → 拷贝它是**退化**：`ArchiveMeta` 没有 `starred` 的位，也不搬 `.cards.jsonl` 那个 sidecar（工具调用卡片，`SessionStore.java:226` 的 `appendCard`，桌面 `resumeSession` 会回传 `cards` 用于回放）。归档再恢复，动作卡就没了

统一到会话文件上，两个形态都无损（见 §4.6）。唯一代价是设置里的归档列表要扫 N 个项目目录而不是 1 个。

---

## 3. 项目面板

### 3.1 布局

```
项目
┌──────────────────────────────────────────────┐
│ 🔍 搜索项目                                    │
└──────────────────────────────────────────────┘
名称                            已更新 ↓
────────────────────────────────────────────────
☆ 重点
▏ 🗀 ⌄ wraith        · 12 会话     1 小时  ··· ★ ✎     ← 当前项目：左侧 accent 竖条
     ├ 接上一轮 Skill 优化工作，当前进度：已完成…  1 小时
     ├ https://github.com/mattpocock/skills 请…  4 小时
     └ 你好                                     4 小时
────────────────────────────────────────────────
  🗀 ⌄ wraith_test   · 3 会话      8 小时  ··· ☆ ✎
  🗀 ⌄ scratch       · 无会话         —    ··· ☆ ✎
  🗀   old-demo      目录不存在            ···
```

- **搜索**：名称 + **路径**双字段子串，不区分大小写。同名不同路径的项目（用户截图里三个 `wraith`）靠路径能筛开。
- **表头两列都可点排序**（名称 A→Z / Z→A，已更新 新→旧 / 旧→新），默认 `已更新 ↓`。
- **`☆ 重点` 是独立分区**，带小标题，不参与排序 —— 形态与图8 的侧栏 `☆ 重点` / `对话` 两段式一致。理由：表头写着「已更新 ↓」但前几行时间不单调，看着像 bug。重点分区为空时整个分区（含标题）不渲染。
- **`· N 会话`** 副标保留（用户确认）。`N === 0` 时显示「无会话」，`已更新` 列显示 `—`。
- **展开**（`⌄`）懒加载，只在首次点击时请求该项目最近 **5** 条会话；折叠不清缓存。会话行显示 `sessionDisplayName` 单行截断 + 短相对时间。该项目有超过 5 条时，末尾一行「在此项目中查看全部 →」= 切项目 + 回聊天页（侧栏就是全量列表）。
- **`exists === false`**：整行灰显（`opacity-50`）、`已更新` 位置改显「目录不存在」、去掉 `⌄` `★` `✎`，只留 `···`（其中「归档聊天」也禁用，只剩编辑项目/移除）。
- **空态**（一个项目都没有）：居中提示 + 一个「添加项目」按钮。

### 3.2 行为矩阵

| 触发 | 效果 | `turn === 'running'` |
|---|---|---|
| 点行主体 | `switchToProject(path)` → 自动恢复最近会话 → 回聊天页 | **禁**（按钮 disabled + title 说明） |
| ↑ 该项目全部会话都已归档时 | `list()` 过滤后为空 → 现有 `switchToProject` 的 `sessions.length > 0` 分支自然不进 → 落到一个干净的新会话。**这是正确行为，不需要特判**，但要写进测试 | — |
| `✎` | `switchToProject` → 新会话 → 回聊天页 | **禁** |
| 点 `⌄` | 只展开/折叠，不切项目 | 允许（只读） |
| 点展开里的会话行 | `switchToProject` → `resume(id)` → 回聊天页（复用 `handleOpenAutomationSession` 那条已验证的链路形状） | **禁** |
| 点「查看全部 →」 | `switchToProject` → 回聊天页 | **禁** |
| `☆` / `★` | 切重点，写 settings，立即影响侧栏快切下拉的排序 | 允许 |
| `···` → 编辑项目 | 小弹窗：别名（可改，空=回落目录名）+ 路径（只读、可复制） | 允许 |
| `···` → 归档聊天 | 批量归档该项目全部会话，带确认（见 §4.4） | 允许 |
| `···` → 移除 | 移出列表不删磁盘。**当前活跃项目禁用**（沿用 `ProjectSwitcher.tsx:107` 的现有约束） | 允许 |

`✎` 是「在此项目新建对话」而不是重命名 —— 用户确认了 Codex 那个图标点下去是「直接开一个新会话，在当前文件夹下」。重命名收进 `···` → 编辑项目。

### 3.3 侧栏快切下拉（`ProjectSwitcher` 瘦身）

从 131 行降到 ~60 行。行内 `✎` `✕` 全部删除（搬进面板）——同一个操作不该有两套 UI 和两套代码路径。

```
📁 wraith ▾
  ┌────────────────────┐
  │ ★ wraith        ✓ │   ← 重点的先列
  │ ★ api-server      │
  │ wraith_test       │   ← 其余按 lastUsedAt
  │ demo-app          │
  │ scratch           │
  │ ────────────────  │
  │ 全部项目…          │   ← setView('projects')
  │ ＋ 添加项目…        │
  └────────────────────┘
```

「最近 5 个」的 5 是**重点之外**的配额（重点全列）。这样切项目仍是 2 步、不离开聊天页；面板只在真要搜索/整理/看会话时才进。

排序用 `lastUsedAt`（现有字段）而非 `lastSessionAt` —— 这个下拉答的是「我刚才在哪儿」，`lastUsedAt` 正是这个语义，且不需要等新 RPC 回来。

---

## 4. 归档聊天

### 4.1 语义（用户原话）

> 归档就是取消在左侧会话中的显示，然后将这次聊天归类到设置中的归档中。

即：**从侧栏列表隐藏 + 收进「设置 › 归档」**。不删数据，按 id 仍可 resume/peek。

### 4.2 落盘

`SessionMeta` 加第 12 个字段 `archivedAt`（ISO-8601 字符串，`null` = 未归档）。

**不用 boolean**：设置里的归档列表要按「什么时候收起来的」排序并显示「归档于 3 小时前」，布尔值给不了。成本相同（7 处构造点都要改）。

`metaJson`（`SessionStore.java:420` 起）与读取端（`:362` 附近）同步加字段。**读取端必须容忍字段缺失**（老会话文件没有这个 key）→ 缺失即 `null` 即未归档，这是向后兼容的天然默认。

新增/改动：

```java
// 新增，与 setStarred 同形
public synchronized boolean setArchived(String id, boolean archived)   // archived=true 写当前时刻，false 写 null

// 改：与 ORIGIN_AUTOMATION 同一处过滤（SessionStore.java:331）
list(int limit)                    // 追加 m.archivedAt() == null 条件

// 新增
listArchived(int limit)            // 只返回 archivedAt != null，按 archivedAt 倒序
```

### 4.3 侧栏：归档取代删除

`SessionRow`（`Sidebar.tsx:19`）的 hover 按钮从 `⭐ ✎ 🗑` 变成 `⭐ ✎ 🗄`：

- `🗄 归档`：单击生效，**无二步确认**（可逆，且设置里能 `↩`）
- `🗑 删除` 从侧栏移除。永久删除只在「设置 › 归档」里做，带二步确认
- `running` 的会话不可归档（沿用 `session-delete` 现有的 `running` 守卫）
- `Sidebar.tsx:86` 那套 `confirmDel` 二步确认逻辑整块搬到 `SettingsArchive`

这条路径是有意的「邮箱 / 废纸篓」形态：手滑不会丢掉跟了三小时的会话。代价是真想删的人要两步，且现有 e2e 的 `session-delete` 用例要改。

**归档当前正在看的会话**时：归档后该会话从侧栏消失，但主区**保持当前回放不动**（不强行跳走——用户可能正读着它）。侧栏无高亮项。用户下一步点任何会话或「新对话」自然离开。

### 4.4 项目行 `···` → 归档聊天（批量）

> ⚠ **这一条是设计判断，不是用户原话。** 用户描述的是单个会话的归档语义；项目行上那一项作用在整个项目上，本设计按「批量归档该项目全部会话」实现。Review 时请重点确认。

- 弹确认框，写明数量：「归档 wraith 的 12 个聊天？归档后它们从侧栏隐藏，可在设置 › 归档中找回。」
- `sessionCount === 0` 或 `exists === false` 时该菜单项 disabled
- 实现：一条 RPC `session.archiveProject { path }`，后端在该项目的 store 上遍历未归档会话逐个 `setArchived(id, true)`，返回归档条数
- 它紧邻「移除」，两者都是批量/破坏性动作，所以确认框是必须的，且菜单里两项之间加分隔线

### 4.5 设置 › 归档

`SettingsPanel.tsx:10` 的 `NAV` 加 `{ key: 'archive', label: '归档', Icon: Archive }`，新组件 `SettingsArchive.tsx`。

```
┌──────┬────────────────────────────────────────────┐
│ 我    │ 归档的聊天                                  │
│ 界面  │ ┌────────────────────────┐  项目：全部 ▾    │
│ 宠物  │ │ 🔍 搜索                 │                │
│ 计价  │ └────────────────────────┘                │
│ 归档 ●│ 当前代码有多少分支                          │
│ 关于  │   wraith · 2 轮 · 归档于 3 小时前     ↩ 🗑   │
│      │ 你好                                       │
│      │   wraith_test · 1 轮 · 归档于 2 天前   ↩ 🗑  │
└──────┴────────────────────────────────────────────┘
```

- **跨项目**：设置是全局的，列出**所有已知项目**（`settings.projects` 的全部 path）的归档会话，每条带项目名标签 + 一个项目筛选下拉
- `↩` 取消归档 → 回到该项目的侧栏列表（若正看着那个项目，侧栏立即刷新）
- `🗑` 永久删除 → 二步确认 → 走现有 `session.delete`
- 搜索：按 `sessionDisplayName` 子串
- 空态：「还没有归档的聊天。在侧栏的会话上点 🗄 即可归档。」

### 4.6 CLI `/archive` 命令族（补齐派发层）

解析层与提示层已在工作区里写好（§2.8），本设计补上派发，实现改走 `SessionStore` 而非独立存储。六个命令与桌面共用同一个归档区 —— 在 CLI 里 `/archive` 的东西，桌面「设置 › 归档」里能看见，反之亦然。

| 命令 | 实现 |
|---|---|
| `/archive` | `persistTurn()` 落盘当前对话拿到 id → `setArchived(id, true)` → 走 `/clear` 那条已有的清空路径。**对用户的观感与「归档并清空」完全一致** |
| `/archive <标题>` | 同上，中间多一步 `rename(id, 标题)` —— 复用 `SessionStore.rename`（`SessionStore.java:218`），落到 `SessionMeta.name`（显示优先于 `title`），语义正好是「自定义标题」 |
| `/archive list` | `listArchived(limit)`，输出 id / 标题 / 项目 / 轮数 / 归档时间 |
| `/archive show <id>` | 复用现有 `peekSession(id)` 只读预览，不切活跃会话 |
| `/archive restore <id>` | `setArchived(id, false)` → `resume(id)`。归档取消后它回到侧栏，同时载回当前对话 |
| `/archive delete <id>` | 现有 `deleteSession(id)` |
| `/archive clear` | 遍历 `listArchived(0)` 逐条删。**带二次确认**（`/clear` 那套确认形状） |

空对话时 `/archive` 的行为：`persistTurn()` 对空对话返回 `null`（`AppServer.java:56` 的契约），此时打印「当前没有可归档的对话」并 no-op，不产生空归档。

**一处有意的不对称**：`/archive list` 只列**当前项目**的归档（CLI 的 `sessionStore` 就绑在当前项目上，`Main.java:438`），而桌面「设置 › 归档」列**全部项目**。这是对的 —— CLI 天生是项目内的工作台，设置天生是全局的。`/archive list` 的输出末尾加一行提示：「只显示当前项目；全部归档见桌面端 设置 › 归档」。

---

## 5. 数据通路

### 5.1 新 RPC（五条新增 + 一条扩参）

| 方法 | 入参 | 出参 | 用在哪 |
|---|---|---|---|
| `session.projectSummary` | `{ paths: string[] }` | `{ summaries: [{ path, sessionCount, lastSessionAt }] }` | 面板打开时批量拉一次，喂「已更新」列 + `· N 会话` |
| `session.listForProject` | `{ path, limit }` | `{ sessions: SessionMeta[] }` | 点 `⌄` 展开时按需拉单个项目 |
| `session.setArchived` | `{ sessionId, archived, path? }` | `{ ok }` | 侧栏 🗄 / 归档区 ↩ |
| `session.listArchived` | `{ paths: string[], limit? }` | `{ sessions: SessionMeta[] }`（每条含 `cwd`，前端据此打项目标签） | 设置 › 归档 |
| `session.archiveProject` | `{ path }` | `{ archived: number }` | 项目行 `···` → 归档聊天 |
| `session.delete`（**已有，扩参**） | `{ sessionId, path? }` | `{ ok }` | 归档区 🗑 永久删除 |

`archiveProject` 是 §4.4 那个待确认项的配套，若批量语义被否掉就一并去掉。

### 5.2 跨项目操作的 `path?` 参数（易漏点）

「设置 › 归档」是**跨项目**列表，`↩` 和 `🗑` 会作用在**非当前活跃项目**的会话上。而现有 `deleteSession(sessionId)`（`AppServer.java` 的 `session.delete`）跑在**活跃项目的 store** 上 —— 直接拿它删别的项目的归档会话会**静默失败**（`rewriteMeta` 找不到文件返回 false，UI 却已乐观移除了那一行）。

所以：

- `session.setArchived` 与 `session.delete` 都接一个**可选** `path`。给了就 `SessionStore.open(home, path, "", "")` 现开现用；没给就走活跃 store（**向后兼容，现有调用方零改动**）
- 侧栏的 🗄 不传 `path`（就是当前项目）；归档区的 `↩` / `🗑` **必须**传 `path`（取自那条 `SessionMeta.cwd`）
- 两处都要断言失败路径：RPC 回 `{ ok: false }` 时 UI 要回滚乐观更新并提示，不能装作成功

六条都**只读或只改指定项目的 store**，不碰 agent 历史。唯一例外：`setArchived` / `delete` 命中的正好是**活跃会话**时，活跃 store 的内存快照（`SessionStore` 的 `starred` / `name` 等字段缓存在实例上）可能与磁盘不同步 —— 归档不改这些字段，故无冲突；但删活跃会话本就是现有 `session.delete` 的既有行为，不在本设计变更范围内。

`projectSummary` / `listArchived` 对 N 个项目各扫一次目录，N = 项目数（个位数），只在面板/设置打开时触发。

落点：`AppServer.SessionRunner`（`AppServer.java:25`）加五个 default 方法 + 给 `deleteSession` 加一个带 `path` 的重载 → `AppServer.handle` 加五个 `case` 并给 `session.delete` 读可选 `path` → `Main.java:1484` 附近的匿名实现里接上。

### 5.3 settings / 类型改动

| 文件 | 改动 |
|---|---|
| `main/settings.ts:14` | `ProjectEntry` 加 `starred?: boolean`；`normalize` 里读取（缺失=false） |
| `shared/types.ts:173` | `ProjectView` 加 `starred?: boolean` |
| `shared/types.ts:123` | `SessionMeta` 加 `archivedAt?: string \| null` |
| `main/index.ts` + `preload/index.ts` | 新 IPC：`setProjectStarred(path, starred)`；转发五条新 RPC |
| `session/SessionMeta.java` | 加 `archivedAt` |

---

## 6. 注册与接线

### 6.1 六处注册表（`docs/development.md:280`）

新面板 id：`projects`。前三处漏了立刻报错，**后三处漏了不报错**，只静默破坏「聊天 ↔ 面板对等」：

1. 面板组件本身 → `components/ProjectsPanel.tsx`
2. 左侧栏导航 → **本设计不进 `TOOL_GROUPS`**，入口是快切下拉里的「全部项目…」。`Sidebar.tsx:170` 的 `activeNav` 联合类型仍要加 `'projects'`（用于高亮态）
3. App 路由/状态 → `App.tsx:188` 的 `view` 联合类型 + 渲染分支 + `lib/panelActions.ts:9,23`（`PanelId` + `PANEL_LABELS`）
4. `lib/commandPalette.ts:31` 的 `NAV_ITEMS` → `{ view: 'projects', label: '项目' }`
5. `ToolRegistry.open_panel` 白名单 → `ToolRegistry.java:1409` 的 `panels` List **以及 `:1415` 和 `:1418` 两段描述字符串**（三处都要加 `projects`，否则模型不知道这个 id 合法）
6. `prompts/capabilities.md` + `prompts/base.md:27` 的面板清单

后两处改完要**同步 jar** 才生效（`mvn package` + `cp` 到 `~/.wraith/wraith.jar` + 重启 App）。

「设置 › 归档」**不是**独立面板（它是 `settings` 视图下的二级分区），不需要走这六处。

### 6.2 「快照 vs 活对象」（`docs/development.md:296`）

本设计有两处「写了配置要本次会话立刻生效」：

- **项目重点**写 settings 后，侧栏快切下拉与面板列表都要重拉 `listProjects()`（沿用 `fetchProjects` 那条已有链路）
- **会话归档**后，若归档的是当前项目的会话，侧栏会话列表要重拉 `listSessions()`；归档区的 ↩ 同理

---

## 7. 文件划分

| 文件 | 职责 | 新/改 |
|---|---|---|
| `renderer/lib/projectsView.ts` | **纯函数**：搜索过滤（名称+路径）、双列排序、重点分区、短相对时间分档 | 新 |
| `renderer/components/ProjectsPanel.tsx` | 面板外壳：搜索框、表头排序、分区、空态 | 新 |
| `renderer/components/ProjectRow.tsx` | 单行 + 展开区 + `···` 菜单 + 编辑弹窗 | 新 |
| `renderer/components/SettingsArchive.tsx` | 归档列表：搜索、项目筛选、↩、🗑（二步确认） | 新 |
| `renderer/lib/archiveView.ts` | **纯函数**：归档列表过滤 + 分组 + 排序 | 新 |
| `renderer/components/ProjectSwitcher.tsx` | 瘦身到快切下拉 | 改 |
| `renderer/components/Sidebar.tsx` | `SessionRow` 的 🗑 → 🗄；`activeNav` 加 `projects` | 改 |
| `renderer/components/SettingsPanel.tsx` | `NAV` 加「归档」 | 改 |
| `renderer/App.tsx` | `view` 加 `projects`；新 handler（重点/归档/批量归档/新会话于项目） | 改 |
| `session/SessionStore.java` | `archivedAt` 字段、`setArchived`、`list` 过滤、`listArchived`、`archiveAll` | 改 |
| `session/SessionMeta.java` | 加 `archivedAt` | 改 |
| `runtime/appserver/AppServer.java` | `SessionRunner` 五个 default 方法 + `deleteSession` 带 `path` 重载 + 五个 `case` + `session.delete` 读可选 `path` | 改 |
| `cli/Main.java` | ① app-server 匿名实现接上五个方法（`:1484` 附近）②交互 REPL 补 `/archive` 六个命令的派发（`:3429` 的 hint 已在工作区里写好） | 改 |
| `cli/CliCommandParser.java` | **工作区里已写好**，本设计不再改（六个 `CommandType` + 匹配） | 已有（未提交） |

逻辑尽量压进 `projectsView.ts` / `archiveView.ts` 两个纯函数模块——组件只做渲染和事件转发，这样测试打在纯函数上，不依赖 DOM。

---

## 8. 测试

### 8.1 Java

| 用例 | 断言 |
|---|---|
| 跨项目只读 list | 对一个从未写过的项目 path 调 `open` + `list`，返回空表，**且磁盘上没有新建目录** |
| `setArchived(true)` → `list` 不含它，`listArchived` 含它 | 双向 |
| `setArchived(false)` 回滚 | `list` 重新含它 |
| 归档后仍可 `resume` / `peek` | 按 id 拿到完整消息 |
| 老会话文件（meta 无 `archivedAt` key） | 读出来 `archivedAt == null`，进 `list` |
| `archiveAll` | 返回条数，且再调一次返回 0（幂等） |
| **跨项目 `setArchived(id, false, path)`** | 在**非活跃**项目的会话上生效（这是 §5.2 那个洞的回归测试） |
| **跨项目 `delete(id, path)`** | 同上；且不传 `path` 时仍走活跃 store（向后兼容） |
| 五条新 RPC | `session == null` 时回 `-32000`；参数缺失回 `-32602` |
| `CliCommandParser` 的 `/archive` 匹配 | `"/archive list"` → `ARCHIVE_LIST`（**不是** `ARCHIVE` 带参数 `"list"`）；`"/archive 修一下登录"` → `ARCHIVE` payload=`"修一下登录"`；`"/archived"` **不**匹配任何 archive 命令 |
| `/archive` 空对话 | `persistTurn()` 回 null → 不产生归档文件，`listArchived` 仍为空 |
| `/archive <标题>` | 归档后 `SessionMeta.name` == 该标题，`listArchived` 里显示的是它而不是首条消息摘要 |
| `/archive restore <id>` | `archivedAt` 清空 + `list()` 重新含它 + agent 历史被载回 |

### 8.2 Vitest（渲染层）

| 用例 | 断言 |
|---|---|
| `projectsView` 搜索 | 名称命中、路径命中、大小写无关、都不命中回空 |
| `projectsView` 排序 | 四种方向；`lastSessionAt` 为 null 的项目恒排末尾 |
| `projectsView` 重点分区 | 重点不参与排序；重点为空时不产生分区 |
| 短相对时间分档 | `<1 分` / `59 分` / `60 分→1 小时` / `23 小时` / `24 小时→1 天` 五个边界 |
| `ProjectsPanel` 懒加载 | 连点两次 `⌄` 展开-折叠-展开，`listSessionsForProject` 只被调用 **1** 次 |
| `ProjectsPanel` running 守卫 | `running` 时点行主体 / `✎` 无效，`⌄` 仍可展开 |
| `ProjectRow` exists=false | 无 `⌄` / `★` / `✎`，`···` 里归档聊天 disabled |
| `SessionRow` 归档 | 点 🗄 调 `setArchived(id, true)`；`running` 时禁用；无 `session-delete` 按钮 |
| `SettingsArchive` | ↩ 调 `setArchived(id, false, cwd)` —— **断言第三个参数传了该条的 `cwd`**；🗑 需二步确认才调 `deleteSession(id, cwd)` |
| `SettingsArchive` 失败回滚 | RPC 回 `{ ok: false }` 时那一行**回到列表**并提示，不留在「已移除」的乐观状态 |
| `archiveView` 项目筛选 | 选定项目只剩该项目条目；「全部」回全量 |

### 8.3 e2e

- 打开项目面板（经快切下拉的「全部项目…」）→ 搜索 → 切项目 → 落到聊天页
- 归档一个会话 → 侧栏不再有它 → 设置 › 归档里有它 → ↩ → 侧栏又有它
- 现有 `session-delete` 的 e2e 用例**需改写**为「归档 → 设置里永久删除」

### 8.4 基线

改动前先 `git stash` 跑两次基线记数（`docs` 里已记录过桌面 `shell.e2e` 有一小簇负载相关抖动，快跑全绿、慢跑掉 1-2 条审批族用例）。Java 侧基线为 1655/0F/0E（自我认知那轮之后）。

---

## 9. 风险与已知取舍

| 项 | 说明 |
|---|---|
| **删除路径变长** | 真想删的人从「侧栏两步」变成「归档 → 进设置 → 两步」。这是有意的安全取舍，但是行为回归，要在 release note 里写明 |
| **`SessionMeta` 加字段** | 7 处构造点 + 读写两端 + 3 个文件。机械但要一次改齐，漏一处编译就报错（record 的好处） |
| **`projectSummary` 的 N 次目录扫描** | N = 项目数。个位数时无感；如果谁囤了 50 个项目，面板首屏会有可感延迟。**先不优化**，但要给列表加骨架态而不是空白 |
| **批量归档语义未经用户确认** | §4.4 已标注。若被否，改成「跳转到设置 › 归档并预筛该项目」，去掉 `archiveProject` RPC |
| **Composer chip 行归属另一个 session** | 本设计不写任何 git 代码。若那个 session 先落地，本面板的行内可加分支显示——**留作后续，不进本 spec** |
| **`✎` 语义与旧下拉冲突** | 旧 `ProjectSwitcher` 里 `✎` 是重命名，新面板里 `✎` 是新建对话。现有 e2e 的 `project-rename` / `project-rename-input` 选择器会失效，要一并改到新的编辑弹窗上 |
| **跨项目写操作的静默失败** | 见 §5.2。这是本设计里最容易写漏的一处：`↩` / `🗑` 忘传 `path` 时 UI 表现是「点了没反应」或「列表少了一行但刷新后又回来」，编译和类型都拦不住（`path` 是可选参数）。已在 §8.1 / §8.2 各留一条回归测试 |
| **同一工作区有并行 session** | 设计期间 HEAD 从 `51fe2d3` 被推进到 `cff3485`（另一个 session 在同分支提交了「顶栏 Git pill」spec+plan 与「快照能关了」）。实现前先 `git log` 确认基点，改 `Main.java` / `Sidebar.tsx` 这类热文件时先 `git diff` 看有没有别人的未提交改动 |
| **`/archive` 派发层要动 REPL 主循环** | `Main.java` 的交互 REPL 是本仓库最长的方法体之一。六个命令的派发要照 `/export` / `/resume` 现有分支的形状插入，不重构周边 |
| **归档区列表与 `/archive list` 范围不同** | 有意的（§4.6 末）。但这是个会被当成 bug 报回来的差异，CLI 输出里必须带那行提示 |
