# 桌面「快照」时间线 + restore(roadmap #4)

**日期:** 2026-07-11 **状态:** 设计定稿,准备实现 **依赖:** roadmap `2026-07-10-desktop-cli-capability-gap-roadmap.md` #4

## 目标

补齐 CLI 的 `/snapshot list` + `/restore N` —— 桌面新增「快照」侧栏视图:**查看** side-git 快照时间线(pre-turn/post-turn/pre-restore),对 pre-turn 快照一键**恢复**工作区。跨栈:Java 加 `snapshot.*` RPC → 桌面 IPC/preload → renderer 面板。**无外部依赖**(纯本地 side-git,仅需 git;区别于 RAG 的 embedding 依赖)。

## 后端事实基线(已核验)

- `SnapshotService`(`snapshot/SnapshotService.java`):`listSnapshots(limit)→List<TurnSnapshot>`、`restorePreTurn(offset)→RestoreResult`、`status()`、`clean()`;经 `agent.getToolRegistry().getSnapshotService()` 取。
- `TurnSnapshot { commitId, phase(PRE_TURN/POST_TURN/PRE_RESTORE), turnId, createdAt(Instant), summary }` + `shortCommitId()`。
- `RestoreResult { ok, commitId, message, restoredFiles[], removedFiles[] }`;`success(...)`/`failure(msg)`。
- 排序:`listSnapshots` = `git.log()` **新→旧**、含全相位;`restorePreTurn(offset)` 在「只数 pre-turn、新→旧」里取第 offset 个(1-based,最近=1)。
- 安全:`restorePreTurn` **先自动存一个 PRE_RESTORE 快照**(恢复可反悔)。
- 快照由每轮 turn 自动产生(`snapshotBeforeTurn`);未跑过 turn 的新库 list 为空。

## RPC 设计(2 个)

| method | params | result |
|---|---|---|
| `snapshot.list` | `{ limit? }` | `{ enabled, snapshots: Entry[] }` |
| `snapshot.restore` | `{ offset }` | `{ ok, message, commitId, restoredCount, removedCount }` |

`Entry = { commitId, shortId, phase, turnId, summary, createdAtMs, preTurnOffset }`
—— `preTurnOffset`:遍历 list(新→旧)对 PRE_TURN 递增计数(1,2,…),非 pre-turn = 0。UI 拿它直接调 restore,避免前端重算 offset 出错。

**实现三处**(仿 memory 切片):
1. `AppServer.Session` 接口:加 `snapshotList(int limit)` / `snapshotRestore(int offset)` 两个 default(抛 UnsupportedOperationException)。
2. `AppServer` dispatch:加 `snapshot.list` / `snapshot.restore` case(session==null 卫;offset 缺→默认 1)。
3. `Main.java` Session 匿名类:override,用 `agent.getToolRegistry().getSnapshotService()`;svc 为 null 或未启用 → `{enabled:false, snapshots:[]}`;序列化 helper。

## 桌面接线

- IPC(`main/index.ts`):`wraith:snapshotList/snapshotRestore` → `client.request('snapshot.*', …)`。
- preload:2 方法。
- shared 类型:`SnapshotEntryView`、`SnapshotListResult`、`SnapshotRestoreResult`。

## UI(renderer)

- 侧栏新增视图 `'snapshots'`,图标 lucide `History`(1.5px 单色)。
- `SnapshotPanel.tsx`:
  - 挂载即 `snapshotList`;顶部:enabled 态 + 「共 N 个快照」+ 刷新。
  - 时间线卡:相位徽标(轮前/轮后/恢复前)+ summary + 相对时间 + shortId。
  - **pre-turn** 条目带「恢复到此」按钮 → `window.confirm`(强提示:会改工作区文件;并告知恢复前会自动存 pre-restore 快照可反悔)→ `snapshotRestore(preTurnOffset)` → 结果 toast(恢复/删除文件数)+ 刷新。
  - 空态:「暂无快照。跑过对话后,每轮开始前会自动存一个可恢复的快照。」
- 相对时间复用 `lib/memoryView.ts` 的 `relativeTime`;新增 `lib/snapshotView.ts` 的 `phaseLabel(phase)`。

## 纯函数 + 测试

`renderer/lib/snapshotView.ts`:`phaseLabel('PRE_TURN'|'POST_TURN'|'PRE_RESTORE'|其它)`。配 `desktop/test/snapshotView.test.ts`。

## 测试隔离铁律

Java RPC 薄委托,**不写触碰真实 side-git 的单测**;靠 `mvn package` + 用户眼验。桌面纯函数走 vitest。

## 验证

`mvn -q clean package -DskipTests` ✓ + 同步 `~/.wraith/wraith.jar`(dev 铁律)· typecheck · vitest 全绿 · build ✓ · 红线 CLEAN。手动:桌面重启 → 侧栏「快照」→ 列表/恢复。
