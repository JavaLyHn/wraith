# 桌面 UI 两处调整 + Windows 同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Team 卡片完成即折叠(+ 一键总开关)、输入框聚焦改轻阴影(去彩色 ring),并把 Windows 分支同步齐(main 合入 + policy 修复带入),①② 建其上,真机验后由用户合回 main。

**Architecture:** ①② 是跨平台渲染层(React/TS/Tailwind)改动,一套代码两端通用。折叠逻辑抽成纯函数 `teamCardCollapse.ts`(可单测),`TeamCard` 持状态并把行改为受控 + 加卡片级总开关;`Composer` 只改容器 className。Windows 同步走 Option A:在 `feat/windows-parity-block1` 上 merge main + cherry-pick policy 修复,再实现 ①②,mac 侧全绿;真机验证与合回 main 由用户执行,全程不碰 main。

**Tech Stack:** Electron 渲染层 React 18 + TypeScript + Tailwind;vitest(`npm test` = `vitest run`;聚焦 `npx vitest run test/<file>`);类型检查 `npm run typecheck`(`tsc --noEmit -p tsconfig.json`)。测试文件在 `desktop/test/`,import 自 `../src/renderer/...`。

## Global Constraints

- 全部工作在分支 `feat/windows-parity-block1` 上(Task 0 完成集成后);**不改动 `main`**(Option A 红线:一切经真机验证后随一次合回落入 main)。
- `git add` 只加本任务涉及文件;禁止 `git add .`/`-A`;禁止碰 WIP:`README.md`、`demo/pom.xml`、`.claude/settings.json`、`demo/src/Hello.java`、`progress.md`。
- 提交信息结尾两行(逐字):
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- ① 只改**显示折叠**,不改 worker/reviewer 的执行隔离语义;运行中步骤的实时 `output` **永远可见**,不进折叠体系、不受总开关影响。
- ② 只改聚焦视觉;`dragOver` 拖放高亮(`border-accent ring-2 ring-accent/40`)保留不动。
- 桌面依赖装配需 `npm install --legacy-peer-deps`(仓库 @lobehub peer 冲突)。
- 诚实边界:纯 className(②)与组件接线(TeamCard 折叠视觉/总开关)无有效单测,靠真机眼验,禁止编造通过的假测试;Windows 真机行为归用户验。

---

### Task 0: Windows 分支集成(merge main + 带入 policy 修复)

**Files:**
- Merge/cherry-pick 到分支 `feat/windows-parity-block1`(无手写文件;冲突解决限 `desktop/package.json` + `desktop/package-lock.json`)

**Interfaces:**
- Produces:一个同时拥有「Windows 平台 shim(既有 38 commit)+ main 全部跨平台特性(v1.3.0/跨模式/记忆)+ policy 修复」的分支,作为 Task 1–3 的基。

- [ ] **Step 1: 切到分支并确认干净**

```bash
git checkout feat/windows-parity-block1
git status --porcelain   # 仅允许既有 WIP(demo/pom.xml 等),不得有其它未提交改动
```

- [ ] **Step 2: merge main**

```bash
git merge main
```
预期冲突仅 `desktop/package.json` 与 `desktop/package-lock.json`(两分支各改过:main 升版本 1.3.0;windows 加 koffi 依赖 + `dist:win` 脚本)。其余(Java 层 cross-mode/记忆等)为 main 单方新增,自动并入。

- [ ] **Step 3: 解决 package.json 冲突(手动取并集)**

`desktop/package.json`:`version` 取 main 的 `1.3.0`;`dependencies` 保留 windows 的 `koffi`;`scripts` 保留 windows 的 `dist:win`;其余按 main。保存后:
```bash
git checkout --theirs desktop/package-lock.json 2>/dev/null || true   # 占位,实际见下步重生
```

- [ ] **Step 4: 重生 lockfile 并装依赖**

```bash
cd desktop
npm install --legacy-peer-deps     # 依据合并后的 package.json 重生 package-lock.json,消解 lock 冲突
cd ..
git add desktop/package.json desktop/package-lock.json
```

- [ ] **Step 5: 完成 merge 提交**

```bash
git commit --no-edit   # 或补一句说明;若模板缺 trailer 则改用带 trailer 的 -m
```
若需手写信息,结尾必须带两行 trailer(见 Global Constraints)。

- [ ] **Step 6: cherry-pick policy 修复**

```bash
git cherry-pick 2f56ea6   # CommandGuard find 收紧 + PathGuard 越界指引 + base.md + 测试
```
预期干净应用(该 diff 触及的 `CommandGuard.java`/`PathGuard.java`/`base.md`/两测试在 windows 分支上与 main 同版,无冲突)。

- [ ] **Step 7: mac 侧全绿验证**

```bash
mvn -q clean test -DskipTests=false        # Java 全绿(含 cross-mode + policy 新测)
cd desktop && npm test && npm run typecheck # vitest 全绿 + tsc 0
```
Expected:mvn BUILD SUCCESS;vitest 全通过;tsc 无错。若失败,定位为合并引入还是既有,修到绿再进 Task 1。

---

### Task 1: `teamCardCollapse.ts` 折叠决策纯函数 + 单测

**Files:**
- Create: `desktop/src/renderer/lib/teamCardCollapse.ts`
- Test: `desktop/test/teamCardCollapse.test.ts`

**Interfaces:**
- Produces(Task 2 依赖):
  - `export type GlobalMode = 'auto' | 'expanded' | 'collapsed'`
  - `resolveExpanded(key: string, autoDefault: boolean, overrides: Record<string, boolean>, globalMode: GlobalMode): boolean`
  - `nextGlobalMode(current: GlobalMode): 'expanded' | 'collapsed'`
  - `globalToggleLabel(current: GlobalMode): string`

- [ ] **Step 1: 写失败测试**

`desktop/test/teamCardCollapse.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { resolveExpanded, nextGlobalMode, globalToggleLabel } from '../src/renderer/lib/teamCardCollapse'

describe('resolveExpanded', () => {
  it('单块 override 赢过全局与 auto', () => {
    expect(resolveExpanded('k', false, { k: true }, 'collapsed')).toBe(true)
    expect(resolveExpanded('k', true, { k: false }, 'expanded')).toBe(false)
  })
  it('无 override 时全局 expanded/collapsed 生效', () => {
    expect(resolveExpanded('k', false, {}, 'expanded')).toBe(true)
    expect(resolveExpanded('k', true, {}, 'collapsed')).toBe(false)
  })
  it('auto 用 autoDefault', () => {
    expect(resolveExpanded('k', true, {}, 'auto')).toBe(true)
    expect(resolveExpanded('k', false, {}, 'auto')).toBe(false)
  })
  it('override=false 被尊重,不与"无 override"混淆', () => {
    expect(resolveExpanded('k', true, { k: false }, 'auto')).toBe(false)
  })
})

describe('nextGlobalMode', () => {
  it('expanded → collapsed', () => expect(nextGlobalMode('expanded')).toBe('collapsed'))
  it('collapsed → expanded', () => expect(nextGlobalMode('collapsed')).toBe('expanded'))
  it('auto → expanded(首次点即展开全部)', () => expect(nextGlobalMode('auto')).toBe('expanded'))
})

describe('globalToggleLabel', () => {
  it('expanded 显示折叠全部', () => expect(globalToggleLabel('expanded')).toBe('▾ 折叠全部'))
  it('auto/collapsed 显示展开全部', () => {
    expect(globalToggleLabel('auto')).toBe('▸ 展开全部')
    expect(globalToggleLabel('collapsed')).toBe('▸ 展开全部')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/teamCardCollapse.test.ts`
Expected:失败(模块不存在)。

- [ ] **Step 3: 实现纯函数**

`desktop/src/renderer/lib/teamCardCollapse.ts`:
```ts
export type GlobalMode = 'auto' | 'expanded' | 'collapsed'

/** 解析某可折叠块是否展开。优先级:单块 override > 全局 mode > auto 默认。 */
export function resolveExpanded(
  key: string,
  autoDefault: boolean,
  overrides: Record<string, boolean>,
  globalMode: GlobalMode,
): boolean {
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key]
  if (globalMode === 'expanded') return true
  if (globalMode === 'collapsed') return false
  return autoDefault
}

/** 点总开关后的下一模式:expanded ↔ collapsed;auto 首次点视为 expanded(展开全部)。 */
export function nextGlobalMode(current: GlobalMode): 'expanded' | 'collapsed' {
  return current === 'expanded' ? 'collapsed' : 'expanded'
}

/** 总开关按钮文案。 */
export function globalToggleLabel(current: GlobalMode): string {
  return current === 'expanded' ? '▾ 折叠全部' : '▸ 展开全部'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/teamCardCollapse.test.ts`
Expected:PASS(10 个)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/teamCardCollapse.ts desktop/test/teamCardCollapse.test.ts
git commit -m "feat(desktop): teamCardCollapse 折叠决策纯函数(override>global>auto)+单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 2: `TeamCard.tsx` 受控折叠 + 卡片级总开关

**Files:**
- Modify: `desktop/src/renderer/components/TeamCard.tsx`

**Interfaces:**
- Consumes: `resolveExpanded` / `nextGlobalMode` / `globalToggleLabel` / `GlobalMode`(Task 1)。

**背景:** 现 `TeamStepRow`(:101)自持 `expanded`/`reviewExpanded` useState(默认 true);`PlannerRow`(:183)自持 `expanded`(默认 true)。改为受控,状态上移到 `TeamCard`(:280)。运行中 `hasLiveOutput` 块(:144)保持无条件显示,**不改**。

- [ ] **Step 1: 顶部 import**

在文件顶部 import 处加:
```tsx
import { resolveExpanded, nextGlobalMode, globalToggleLabel, type GlobalMode } from '../lib/teamCardCollapse'
```
并把 `import { useState } from 'react'` 保留(TeamCard 仍用 useState)。

- [ ] **Step 2: `TeamStepRow` 改受控**

签名改为:
```tsx
function TeamStepRow({ step, roleColorClass, resultExpanded, reviewExpanded, onToggleResult, onToggleReview }: {
  step: TeamStep; roleColorClass: string;
  resultExpanded: boolean; reviewExpanded: boolean;
  onToggleResult: () => void; onToggleReview: () => void;
}): JSX.Element {
```
删除内部两处 `useState`。函数体内:`expanded` → `resultExpanded`;`setExpanded(v => !v)` → `onToggleResult`;`reviewExpanded`(原 state)→ 形参 `reviewExpanded`;`setReviewExpanded(v => !v)` → `onToggleReview`。其余渲染逻辑不变。

- [ ] **Step 3: `PlannerRow` 改受控**

签名改为:
```tsx
function PlannerRow({ item, expanded, onToggle }: { item: TeamItem; expanded: boolean; onToggle: () => void }): JSX.Element {
```
删除内部 `useState`;`setExpanded(v => !v)` → `onToggle`。

- [ ] **Step 4: `TeamCard` 持状态 + 计算 + 接线**

在 `TeamCard`(:280)体内、`return` 前加:
```tsx
const [overrides, setOverrides] = useState<Record<string, boolean>>({})
const [globalMode, setGlobalMode] = useState<GlobalMode>('auto')
const toggleBlock = (key: string, currentEffective: boolean) =>
  setOverrides(prev => ({ ...prev, [key]: !currentEffective }))
const toggleAll = () => { setGlobalMode(m => nextGlobalMode(m)); setOverrides({}) }
```
Planner 渲染(:311)改为:
```tsx
<PlannerRow
  item={item}
  expanded={resolveExpanded('planner', item.steps.length === 0, overrides, globalMode)}
  onToggle={() => toggleBlock('planner', resolveExpanded('planner', item.steps.length === 0, overrides, globalMode))}
/>
```
两处 `<TeamStepRow .../>`(:318 与 :326)均改为传受控 props(以 solo 处为例,parallel 处同理):
```tsx
<TeamStepRow
  key={group.step.id}
  step={group.step}
  roleColorClass={stepRoleColor(group.step)}
  resultExpanded={resolveExpanded(group.step.id, false, overrides, globalMode)}
  reviewExpanded={resolveExpanded(`${group.step.id}:review`, group.step.status === 'running', overrides, globalMode)}
  onToggleResult={() => toggleBlock(group.step.id, resolveExpanded(group.step.id, false, overrides, globalMode))}
  onToggleReview={() => toggleBlock(`${group.step.id}:review`, resolveExpanded(`${group.step.id}:review`, group.step.status === 'running', overrides, globalMode))}
/>
```

- [ ] **Step 5: 头部加卡片级总开关**

在 header 行(:290 的 `<div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">`)最后、role chips 之后,加:
```tsx
<button
  className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:text-fg-muted hover:bg-bg"
  onClick={toggleAll}
  aria-label={globalMode === 'expanded' ? '折叠全部输出' : '展开全部输出'}
>
  {globalToggleLabel(globalMode)}
</button>
```
（`ml-auto` 把它推到 header 右端。）

- [ ] **Step 6: 类型检查 + 回归 + 眼验说明**

Run: `cd desktop && npm run typecheck && npm test`
Expected:tsc 0;vitest 全绿(既有测试不破;本任务无新单测——组件接线,逻辑真源在 Task 1 已测)。
诚实边界:折叠视觉、总开关的实际行为需**真机运行**眼验(仓库无该组件的 RTL 测);在报告里标注为"待真机眼验",不得声称视觉已验证。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/TeamCard.tsx
git commit -m "feat(desktop): Team 卡片完成即折叠 + 卡片级一键展开/折叠(受控,运行中实时输出不折)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 3: `Composer.tsx` 聚焦轻阴影(去彩色 ring)

**Files:**
- Modify: `desktop/src/renderer/components/Composer.tsx:372-374`

- [ ] **Step 1: 改容器 className**

把(:373-374):
```tsx
'relative w-full rounded-2xl border bg-surface shadow-md transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 ' +
(dragOver ? 'border-accent ring-2 ring-accent/40 ' : 'border-fg-subtle/40 ') +
```
改为:
```tsx
'relative w-full rounded-2xl border bg-surface shadow-sm transition-shadow focus-within:shadow-lg focus-within:border-fg-subtle/50 ' +
(dragOver ? 'border-accent ring-2 ring-accent/40 ' : 'border-fg-subtle/40 ') +
```
即:去掉 `focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25`;`shadow-md`→`shadow-sm`;`transition-colors`→`transition-shadow`;加 `focus-within:shadow-lg focus-within:border-fg-subtle/50`。`dragOver` 分支不动。

- [ ] **Step 2: 类型检查 + 回归**

Run: `cd desktop && npm run typecheck && npm test`
Expected:tsc 0;vitest 全绿(纯样式改动,不影响逻辑测试)。
诚实边界:聚焦阴影视觉需**真机运行**眼验;报告标注"待真机眼验"。

- [ ] **Step 3: 提交**

```bash
git add desktop/src/renderer/components/Composer.tsx
git commit -m "feat(desktop): Composer 聚焦改轻阴影抬升(去彩色 ring,类 claude.ai)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

## Self-Review

**1. Spec coverage:**
- Spec ① 状态模型/纯函数/交互 → Task 1(纯函数+测)+ Task 2(受控+总开关)✅
- Spec ② 聚焦阴影 → Task 3 ✅
- Spec「Windows 同步序列」步骤 1–4(merge/cherry-pick/实现/mac 绿)→ Task 0 + Task 1–3 ✅;步骤 5–6(真机验证/合回 main)= 用户动作,计划外(已在 Global Constraints/收尾注明)✅
- Spec 测试节 → Task 1 单测 + Task 2/3 typecheck+回归+眼验诚实边界 ✅

**2. Placeholder scan:** 各步含实际代码/命令;唯 Task 0 Step 3 的 `git checkout --theirs ... || true` 标注为占位,紧接 Step 4 用 `npm install` 重生 lockfile 消解——非留白,是"lock 冲突用重装解决"的明确做法。无 TBD。

**3. Type consistency:** `resolveExpanded`/`nextGlobalMode`/`globalToggleLabel`/`GlobalMode` 在 Task 1 定义、Task 2 消费,签名一致;键约定 `step.id` / `${step.id}:review` / `'planner'` 全程统一;`autoDefault`(结果 false / 审查 running / planner steps 空)与 spec 一致。
