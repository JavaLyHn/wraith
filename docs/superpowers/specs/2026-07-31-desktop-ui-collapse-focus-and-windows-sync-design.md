# 桌面 UI 两处调整 + Windows 同步 —— 设计 Spec

> 日期:2026-07-31 · 集成方式:Option A(main 合进 `feat/windows-parity-block1`,①② 建其上,真机验后再合回 main,不碰 main 红线)

## 背景

两个桌面渲染层 UI 调整(均为跨平台 React,一套代码两端通用):
- **①** Team 卡片:完成的步骤/planner/reviewer 输出默认占满屏,改为**完成即折叠**,并加**卡片级一键展开/折叠**总开关。
- **②** 输入框(Composer)聚焦时是青色描边环,改为**轻微阴影抬升(类 claude.ai)**,去掉彩色 ring。

同时把 Windows 平台工作(已在 `feat/windows-parity-block1` 做完 5 块但未合并、且落后 main 缺跨平台新特性)同步齐:把 main 合进该分支,①② 也建其上,附带把仅在 `fix/policy-find-fence-guidance` 上的 policy 修复带入。真机验证后再由用户合回 main。

## ① Team 卡片完成即折叠 + 一键总开关

现状(`desktop/src/renderer/components/TeamCard.tsx`):done 步骤 `result`、`plannerOutput`、`reviewOutput` 均 `useState(true)` 默认展开;各自 `max-h-48` 滚动块;运行中步骤实时 `output` 无条件显示。

### 状态模型(上移到 `TeamCard`,因全局开关要统管所有块)
- `overrides: Record<string, boolean>` —— 用户对单个块的显式选择。键:`step.id`(结果块)/ `${step.id}:review`(审查块)/ `'planner'`。
- `globalMode: 'auto' | 'expanded' | 'collapsed'` —— 卡片级模式,初始 `auto`。

### 纯函数 `resolveExpanded(key, autoDefault, overrides, globalMode): boolean`(抽到 `teamCardCollapse.ts`,可单测)
优先级:**单块 override > 全局 mode > auto 默认**。
```
if (key in overrides) return overrides[key]
if (globalMode === 'expanded') return true
if (globalMode === 'collapsed') return false
return autoDefault            // globalMode === 'auto'
```
各块的 `autoDefault`(=「完成即折叠,只留运行中展开」):
- 结果块:`false`(done 才有结果块,默认折叠)。
- 审查块:`step.status === 'running'`(审查流式中展开,done 折叠)。
- planner:`item.steps.length === 0`(规划中展开,出步骤后折叠)。

### 交互
- 运行中步骤的实时 `output`:**永远可见**,不进折叠体系、不受总开关影响。
- 单块 `▶/▼ 输出`:点击 → `setOverrides({...prev, [key]: !当前生效值})`;此后该块固定用户选择。
- 卡片右上角总开关:文字随态(`▸ 展开全部` / `▾ 折叠全部`)。点击 → 设 `globalMode`(在 `expanded`/`collapsed` 间切,从 `auto` 首次点为 `expanded`)并**清空 `overrides`**(干净一扫);之后新完成的块跟随 mode,用户再点单块可局部覆盖。只作用于可折叠块,不碰运行中实时 output。

### 组件改造
- `TeamStepRow` / `PlannerRow` 从「各自 useState」改为「受控」:由 `TeamCard` 传入 `expanded` 与 `onToggle`。
- `TeamCard` 头部行右端新增总开关按钮;需要统计当前是否「大多展开」以决定按钮文案/下一步动作 —— 由 `globalMode` 直接决定(非 auto 时按 mode;auto 时按钮显示「展开全部」)。

## ② Composer 聚焦轻阴影

现状(`desktop/src/renderer/components/Composer.tsx:372-374`):
```
'relative w-full rounded-2xl border bg-surface shadow-md transition-colors
 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 ' +
(dragOver ? 'border-accent ring-2 ring-accent/40 ' : 'border-fg-subtle/40 ')
```

改为:
- **去掉** `focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25`(全部彩色聚焦类)。
- 静止:`border border-fg-subtle/40 bg-surface shadow-sm`。
- 聚焦:`focus-within:shadow-lg focus-within:border-fg-subtle/50`(轻微阴影抬升 + 中性描边略深,无颜色)。
- 过渡:`transition-shadow`(替代/并入 `transition-colors`,让阴影柔和)。
- **`dragOver` 的 `border-accent ring-2 ring-accent/40` 保留**(拖放高亮是有意义反馈,与聚焦无关)。

## 测试

- `desktop/src/renderer/lib/teamCardCollapse.test.ts`(vitest):`resolveExpanded` 优先级各分支(override 赢过 global 赢过 auto;true/false 都测);`autoDefault` 三类取值(结果/审查随 running/planner 随 steps 空)正确。
- ② 为纯 className 改动,无有效单测;**真机眼验**(诚实边界,不编假测试)。
- 组件接线(TeamCard 折叠视觉、总开关)为薄层,真机眼验;逻辑真源在 `teamCardCollapse.ts` 已单测。
- 回归:`npm run test`(vitest 全绿)+ `npx tsc --noEmit` 0 + `mvn test -DskipTests=false` 全绿。

## Windows 同步(集成序列,Option A)

1. **切到 `feat/windows-parity-block1`,merge `main`**:冲突预期仅 `desktop/package.json`(取 main 的 version 1.3.0 + 保留 windows 的 koffi 依赖/`dist:win` 脚本)与 `desktop/package-lock.json`(以 `npm install --legacy-peer-deps` 重生或手并)。Java 层为 main 单方新增,干净并入。
2. **带入 policy 修复**:cherry-pick `2f56ea6`(CommandGuard find 规则收紧 + PathGuard 越界指引 + base.md + 测试)到该分支——让 Windows 也有;它随后续「真机验证后 parity→main」一并回到 main。
3. **在该分支实现 ①②**(TeamCard/Composer,两分支本就一致,零冲突)。
4. **验证(mac 侧)**:vitest/tsc/mvn 全绿;字节级确认 mac 行为零回归。
5. **真机验证(用户)**:在真 Windows 上跑 dev + 打包冒烟(见 `docs/windows-dev.md` 验收清单)。
6. **合回 main(用户决定)**:验证通过后 `feat/windows-parity-block1` → main,平台 shim + policy 修复 + ①② 一次性、经验证地进入 main。

**红线**:整个过程 main 不被改动;所有新东西经真机验证后随一次合回落入 main。

## YAGNI / 取舍

- ① 只做「完成即折叠 + 一键总开关」;不做每角色独立记忆、不做持久化折叠偏好(会话内 state 即可)。
- ② 只改聚焦视觉;`dragOver` 高亮不动。
- policy 修复走 cherry-pick 而非合进 main(守 Option A「不碰 main」);若用户想让 mac 早点拿到,可另行单独合 main(本 spec 不默认这么做)。
