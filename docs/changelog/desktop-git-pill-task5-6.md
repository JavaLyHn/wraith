# 桌面顶栏 Git pill — Task 5 / Task 6 更新

- **分支**：`codex/desktop-git-pill-baseline`
- **提交**：`fb489306`（Task 5）→ `6ba7c49e`（Task 6），已推送
- **前提**：Task 1~4（`GitStatus` / `PorcelainV2Parser` / `GitStatusReader` / `git.status` RPC / TS 类型与 IPC 桥）此前已完成并审查通过，本次不重做。

## 新增

- **Git pill 文案纯函数** `desktop/src/renderer/lib/gitPill.ts`：把 `GitStatusView` 折成 pill 要显示的内容——分支名、`+N −M`（用 U+2212 减号）、未跟踪数、游离 / 无提交 / 领先落后 / 刷新失败标记。`repo=false` 或还没拉回数据时返回 `visible:false`，整块不渲染、不显示占位。
- **`GitPill.tsx` 组件**：顶栏常驻只读 pill + 点击弹出层。弹出层展示分支、ahead/behind、变更文件列表（截断时显示总数）、remote（点击复制 URL）、取数失败提示，并固定带一行「真实 `.git`（只读）与快照面板互不影响」的对照说明，防止用户把两套「版本」搞混导致误回滚。

## 接入

- **TopBar**（`desktop/src/renderer/components/TopBar.tsx`）：新增两个**可选** prop `gitStatus` / `onRefreshGit`，pill 渲染在沙箱盾之前；不传时顶栏其余功能照常工作，不产生依赖。
- **App.tsx 取数与刷新**（`desktop/src/renderer/App.tsx`）：
  - 首取挂在 startup / reconnect effect 里、`startSession` 之后（同 `refreshSandbox`），保证 pill 在首条消息前就出现。
  - `turn.completed` / `turn.failed` 后自动刷新——Agent 刚改完文件正是最该刷的点，失败 turn 也可能已改文件；刻意不轮询，空闲零开销。
  - 取数失败时**保留上一次成功的值并把 `error` 显式显示出来**，不静默拿旧数据当新的（与「绝不静默」同一条规矩）。

## 测试

- 桌面 vitest：**191 文件 / 1797 passed**，0 failed；`tsc --noEmit` 0 错误。
- TDD 全程：每个行为改动先 RED 再 GREEN；Task 5 做了 RED 证明（变异打开时刷新逻辑，精确 2 条用例变红）。
- Git pill Java 后端（Task 1~3）回归：19 tests 全绿。
- `mvn -DskipTests=false test` 全量有 4 个失败，**均与环境无关、非本次改动引起**（本次零 Java 改动）：2 个 `SeatbeltSandboxTest`（macOS 专属 + Trae 沙箱拦截临时文件）、1 个 `ExecuteCommandSandboxIntegrationTest`（同因）、1 个 `ToolRegistryTest`（Windows 路径分隔符 `\` vs `/`）。

## 待办

- 计划 Task 6 Step 7 的真机眼验（`npm run dev` 核对 pill 数字与 `git diff --shortstat HEAD` 一致等 6 项）需在能跑 Electron 的环境验收。
