# 全 app 软卡片视觉语言 + 自动化面板窄宽自适应 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全 app panel/form 统一为「软卡片」语言(灰底浮白卡、卡内灰填充控件、按钮三档,消灭框中框),并修复 AutomationsPanel 窄宽下表单被裁的布局 bug(窄态改任务芯片条 + 表单全宽)。

**Architecture:** 新建 `lib/formStyles.ts` 常量模块作为唯一样式真源;按规则 R1–R7 逐组件把 `border border-border` 盒模式换成软卡 + 填充控件 + 三档按钮。AutomationsPanel 用 `ResizeObserver` 在 <640px 时切单栏 + 顶部任务芯片条。纯视觉,零行为/数据/props/testid 变更。

**Tech Stack:** Electron + React/TS + Tailwind(tokens.css theme-aware CSS 变量,`surface=var(--bg-elevated)`)+ vitest。

## Global Constraints

- **纯视觉**:不改任何行为、数据流、props、`data-testid`;JSX 结构只做样式类变更,必要包裹层增删最小化。
- typecheck 0(`cd desktop && npm run typecheck`);vitest 基线不降(`npm test`),Task 1 新增 `isNarrowLayout` 单测。
- 暗色主题两态都核:`shadow-sm` 在暗色不可见靠 bg 对比承担(预期,非缺陷);若样板阶段眼验发现暗色卡对比不足,统一给 CARD 补 `dark:ring-1 dark:ring-white/5`,rollout 各组件继承同一 CARD 常量自动获得。
- focus 可见性不降(填充控件保留 `focus:border-accent`)。
- **不改**:聊天视图(UserMessage/TeamCard/PlanCard/ToolCard/ToolGroup/ThinkingBlock/DiffCard/Composer/WelcomeEmptyState)、浮层(CommandPalette/ApprovalModal/`ui/`:dialog·popover·select·switch·tooltip)、结构 chrome(Sidebar/RightDock/TerminalPane/TerminalDrawer/BrowserPane/ProjectSwitcher/ModeSwitcher/ModelSwitcher/StatusChip)。
- 芯片/徽标/胶囊(投递芯片、QQ 待发徽标、网关胶囊)已是新语言,**不动**(R5)。
- push 需用户单独点头。

## 改造规则 R1–R7(rollout 每组件套用;下为 before→after 具体样例)

- **R1 卡片**:`<section className="… rounded-lg border border-border … p-4">` → `className={CARD}`(去边框、`bg-surface shadow-sm`、rounded-xl)。
  - before: `className="flex flex-col gap-3 rounded-lg border border-border p-4"` → after: `className={CARD}`
- **R2 填充控件**:input/textarea/select 的 `border border-border bg-*` → `border border-transparent` + 填充色比所在底差一档(**卡内**用 `bg-bg` 灰;**裸灰底上**用 `bg-surface` 白)。
  - before: `className="… rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent"`
  - after(卡内): `className="… rounded-lg border border-transparent bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent"`(= 用 `INPUT`,或对非全宽的保留自有宽度只改 `border-border`→`border-transparent`)
- **R3 按钮三档**:实心 accent 主操作用 `BTN_PRIMARY`;次操作(带 `border border-border` 的普通按钮)用 `BTN_GHOST`;删除/危险用 `BTN_DANGER_GHOST`。语义色按钮(如启用=success)去边框改文字色 + `hover:bg-surface`。
  - before: `className="rounded-lg border border-border px-4 py-2 text-xs text-fg hover:border-accent"` → after: `className={BTN_GHOST}`
- **R4 去盒交互件**:折叠条外壳 `rounded-lg border border-border` → `rounded-xl bg-surface shadow-sm`(软卡);展开区顶部保留 `border-t border-border` 作分隔(R6 合法)。行内带边框小按钮(如「＋ 添加」)去边框改 ghost。
- **R5**:`rounded-full` 家族(芯片/徽标/胶囊)一律不动。
- **R6 分隔线**:`border-t border-border` / 单边 `border-b` 作卡内小节或列表行分隔的**保留**;仅当 `border`(四边)包裹成盒时才按 R1 去除。判据:是"线"就留,是"框"就换。
- **R7 防裁剪**:横排按钮/表单行/工具条容器加 `flex-wrap`(若尚无);任何宽度不横向溢出。

**通用**:每个被改组件顶部若有本地重复的 CARD/INPUT/SECTION_TITLE 字面量常量,删掉改 `import { CARD, INPUT, … } from '../lib/formStyles'`。改动只碰 className / 常量 import,不碰逻辑、state、props、testid。

---

### Task 1: 样板组 — formStyles + AutomationForm 换肤 + AutomationsPanel 窄宽自适应

> **完成后暂停**:controller 提交后请用户 `npm run dev` 眼验定案(明暗两主题 + 拖窄窗口),确认新脸与窄宽芯片条后再放行 rollout。

**Files:**
- Create: `desktop/src/renderer/lib/formStyles.ts`
- Create: `desktop/test/formStyles.test.ts`(isNarrowLayout 纯函数测)
- Modify: `desktop/src/renderer/components/AutomationForm.tsx`
- Modify: `desktop/src/renderer/components/AutomationsPanel.tsx`

**Interfaces:**
- Produces(rollout 全依赖):`formStyles.ts` 导出 `CARD` `SECTION_TITLE` `INPUT` `INPUT_ON_BG` `BTN_PRIMARY` `BTN_GHOST` `BTN_DANGER_GHOST`(均 `string`);`isNarrowLayout(width: number): boolean` + `NARROW_LAYOUT_PX = 640`。
- Consumes:既有 `taskStatusLabel`(`lib/gatewayGate.ts`)、`AutomationForm` 现有 props/state(不改)。

- [ ] **Step 1: 写 isNarrowLayout 失败测试**(`desktop/test/formStyles.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { isNarrowLayout, NARROW_LAYOUT_PX } from '../src/renderer/lib/formStyles'

describe('isNarrowLayout', () => {
  it('阈值 640', () => { expect(NARROW_LAYOUT_PX).toBe(640) })
  it('< 640 → 窄', () => { expect(isNarrowLayout(500)).toBe(true); expect(isNarrowLayout(639)).toBe(true) })
  it('>= 640 → 宽', () => { expect(isNarrowLayout(640)).toBe(false); expect(isNarrowLayout(900)).toBe(false) })
  it('0/负(未测量)→ 宽(不误切窄,避免初帧闪单栏)', () => { expect(isNarrowLayout(0)).toBe(false) })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/formStyles.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 建 formStyles.ts**:

```ts
// 软卡片视觉语言(2026-07-16 spec):层次靠深浅不靠描边。全 app panel/form 共享。
export const CARD = 'flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-sm'
export const SECTION_TITLE = 'text-2xs font-semibold uppercase tracking-wider text-fg-subtle'
/** 卡内控件:灰填充无边框,focus 亮 accent;透明边框防聚焦时尺寸跳动。 */
export const INPUT = 'mt-1 w-full rounded-lg border border-transparent bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent'
/** 裸在灰底上(无卡片包裹)的控件:反相用白填充。 */
export const INPUT_ON_BG = 'mt-1 w-full rounded-lg border border-transparent bg-surface px-3 py-2 text-xs text-fg outline-none focus:border-accent'
export const BTN_PRIMARY = 'rounded-lg bg-accent px-4 py-2 text-xs text-accent-fg hover:opacity-90 disabled:opacity-60'
export const BTN_GHOST = 'rounded-lg px-4 py-2 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-40'
export const BTN_DANGER_GHOST = 'rounded-lg px-4 py-2 text-xs text-danger hover:bg-danger/10 disabled:opacity-40'

/** 面板内容区窄于此(px)切单栏 + 任务芯片条。 */
export const NARROW_LAYOUT_PX = 640
/** width 为 0/未测量时返回 false(宽),避免初帧闪单栏。 */
export function isNarrowLayout(width: number): boolean {
  return width > 0 && width < NARROW_LAYOUT_PX
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/formStyles.test.ts`
Expected: PASS 4/4

- [ ] **Step 5: 改 AutomationForm.tsx — 换肤(R1–R7)**

5a. 顶部:删除本地 `const CARD/SECTION_TITLE/INPUT`(:13-15),改 import:
```tsx
import { CARD, SECTION_TITLE, INPUT, BTN_PRIMARY, BTN_GHOST, BTN_DANGER_GHOST } from '../lib/formStyles'
```
(保留其余 import。)

5b. 内联输入框(schedule minutes :231、cron minute/everyn/monthday/time :264/271/278/284、tool-override-name :364、ask-timeout :392、cron-raw :293)统一把 `border border-border` → `border border-transparent`(其余保留,含各自宽度 w-20/w-28 等)。cron 预览框(:300)`rounded-lg border border-border bg-surface/40` → `rounded-lg bg-bg`(去框,readout 用卡内灰底)。

5c. 高级折叠 section(:335)`<section className="rounded-lg border border-border">` → `<section className="rounded-xl bg-surface shadow-sm">`;展开区(:344)`border-t border-border` 保留(R6 分隔);「＋ 添加工具覆盖」按钮(:380)`className="w-fit rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"` → `className={'w-fit ' + BTN_GHOST + ' !py-1 !px-2'}`(ghost,压小 padding)。

5d. 按钮区(:402-423):
- 保存(:404)`className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60"` → `className={BTN_PRIMARY}`。
- 立即运行(:407)→ `className={BTN_GHOST}`。
- 暂停/启用(:413)保留 `ml-auto` + 语义:`className={'ml-auto ' + BTN_GHOST + (initial.enabled ? '' : ' text-success hover:text-success')}`。
- 删除(:420)→ `className={BTN_DANGER_GHOST + (removeConfirming ? ' bg-danger/10' : '')}`。
- 按钮行容器(:402)已有 `flex-wrap`(R7 满足)。

- [ ] **Step 6: 改 AutomationsPanel.tsx — Part L 窄宽自适应**

6a. import:`import { isNarrowLayout } from '../lib/formStyles'`;`import { taskStatusLabel } from '../lib/gatewayGate'`(若未引)。

6b. 量宽 state + ResizeObserver(加在组件内,ref 挂到 panel-content 容器):
```tsx
  const layoutRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = layoutRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0
      setNarrow(isNarrowLayout(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
```

6c. panel-content 容器(现 `<div className="flex min-h-0 flex-1 panel-content">`)挂 `ref={layoutRef}`。

6d. 左侧任务列表列(`<div className="flex w-60 shrink-0 flex-col border-r border-border">`):`className={'flex w-60 shrink-0 flex-col border-r border-border ' + (narrow ? 'hidden' : '')}`(窄态隐藏;`border-r` 是分隔线 R6 保留)。

6e. 表单列(`<div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">`)内、在现有 `{runNowBusy && …}` 之前插入**窄态任务芯片条**:
```tsx
          {narrow && (
            <div data-testid="automation-chipbar" className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {tasks.map(t => {
                const sel = current?.id === t.id && !creating
                const dot = !t.enabled ? 'bg-fg-subtle' : gatewayStatus.state === 'running' ? 'bg-success' : 'bg-fg-muted'
                return (
                  <button key={t.id} data-testid="automation-chip" onClick={() => { setCreating(false); setSelectedId(t.id) }}
                    className={'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ' +
                      (sel ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:border-fg-subtle hover:text-fg')}>
                    <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + dot} />
                    <span className="max-w-[8rem] truncate">{t.name}</span>
                  </button>
                )
              })}
              <button data-testid="automation-chip-add" onClick={() => { setCreating(true); setSelectedId(null) }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent">
                ＋ 新建
              </button>
            </div>
          )}
```
(依赖组件内已有的 `tasks`/`current`/`creating`/`setCreating`/`setSelectedId`/`gatewayStatus`——均 T5 已在;`gatewayStatus.state` 供状态点取色,与任务卡 `taskStatusLabel` 三态口径一致。)

- [ ] **Step 7: 门禁**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck 0;vitest 全绿(基线 + formStyles 4 新)

- [ ] **Step 8: Commit**

```bash
git add desktop/src/renderer/lib/formStyles.ts desktop/test/formStyles.test.ts desktop/src/renderer/components/AutomationForm.tsx desktop/src/renderer/components/AutomationsPanel.tsx
git commit -m "feat(desktop): 软卡片视觉语言基件 + AutomationForm 换肤 + 自动化面板窄宽自适应(样板)"
```

> **控制器**:提交后停下,请用户眼验定案。用户认可 → 继续 Task 2;要调整 → 改样板(formStyles/AutomationForm)后再放行。

---

### Task 2: rollout — IM 网关 / 插件 / MCP 表单

**Files:** Modify `desktop/src/renderer/components/ImGatewayPanel.tsx`、`PluginsPanel.tsx`、`McpServerForm.tsx`

**Interfaces:** Consumes Task 1 的 formStyles 常量。

- [ ] **Step 1: 逐文件套 R1–R7 + import formStyles**。对每个文件:读文件 → 按 R1(section 盒→CARD)、R2(输入→填充式)、R3(按钮三档)、R4(折叠条/行内小盒去框)、R6(线保留、框去除)、R7(横排 flex-wrap)改 className;删本地重复常量改 import。**不碰逻辑/state/props/testid**。ImGatewayPanel 的绑定卡/密钥输入/日志区若结构特殊,按"深浅分层、零盒边框"精神就地裁量并在报告注明。

- [ ] **Step 2: 门禁**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck 0;vitest 基线不降(这些组件无渲染快照测试;若某测试断言 class 需同步)

- [ ] **Step 3: Commit**

```bash
git add desktop/src/renderer/components/ImGatewayPanel.tsx desktop/src/renderer/components/PluginsPanel.tsx desktop/src/renderer/components/McpServerForm.tsx
git commit -m "polish(desktop): 软卡片 rollout — IM 网关/插件/MCP 表单"
```

---

### Task 3: rollout — 记忆 / Provider / RAG

**Files:** Modify `MemoryPanel.tsx`、`ProvidersPanel.tsx`、`RagPanel.tsx`

- [ ] **Step 1: 逐文件套 R1–R7 + import formStyles**(方法同 Task 2 Step 1)。
- [ ] **Step 2: 门禁** — `cd desktop && npm run typecheck && npm test`(typecheck 0 / 基线不降)。
- [ ] **Step 3: Commit**
```bash
git add desktop/src/renderer/components/MemoryPanel.tsx desktop/src/renderer/components/ProvidersPanel.tsx desktop/src/renderer/components/RagPanel.tsx
git commit -m "polish(desktop): 软卡片 rollout — 记忆/Provider/RAG"
```

---

### Task 4: rollout — 技能三件 / 安全

**Files:** Modify `SkillsPanel.tsx`、`SkillEditor.tsx`、`SkillViewer.tsx`、`PolicyPanel.tsx`

- [ ] **Step 1: 逐文件套 R1–R7 + import formStyles**(方法同 Task 2 Step 1)。
- [ ] **Step 2: 门禁** — `cd desktop && npm run typecheck && npm test`(typecheck 0 / 基线不降)。
- [ ] **Step 3: Commit**
```bash
git add desktop/src/renderer/components/SkillsPanel.tsx desktop/src/renderer/components/SkillEditor.tsx desktop/src/renderer/components/SkillViewer.tsx desktop/src/renderer/components/PolicyPanel.tsx
git commit -m "polish(desktop): 软卡片 rollout — 技能/编辑/查看/安全"
```

---

### Task 5: rollout — 后台任务 / 浏览器 / 快照 / 自动化余件

**Files:** Modify `TaskPanel.tsx`、`BrowserPanel.tsx`、`SnapshotPanel.tsx`、`AutomationRuns.tsx`、`QqPendingBlock.tsx`

- [ ] **Step 1: 逐文件套 R1–R7 + import formStyles**(方法同 Task 2 Step 1)。QqPendingBlock 已是新语言主体(R5 芯片),仅把其外层 `rounded-lg border border-border`(:数据行容器)按 R1 归一为软卡/去框;`AutomationRuns` 的运行行按 R6(行分隔线保留)。
- [ ] **Step 2: 门禁** — `cd desktop && npm run typecheck && npm test`(typecheck 0 / 基线不降;`qqPendingView` 等既有纯函数测试不受影响)。
- [ ] **Step 3: Commit**
```bash
git add desktop/src/renderer/components/TaskPanel.tsx desktop/src/renderer/components/BrowserPanel.tsx desktop/src/renderer/components/SnapshotPanel.tsx desktop/src/renderer/components/AutomationRuns.tsx desktop/src/renderer/components/QqPendingBlock.tsx
git commit -m "polish(desktop): 软卡片 rollout — 后台任务/浏览器/快照/自动化余件"
```

---

### Task 6: rollout — 设置四件

**Files:** Modify `SettingsMe.tsx`、`SettingsInterface.tsx`、`SettingsPanel.tsx`、`SettingsAbout.tsx`

- [ ] **Step 1: 逐文件套 R1–R7 + import formStyles**(方法同 Task 2 Step 1)。设置面板多为合法分隔线(R6 保留),预期改动少——只把真正的盒(section 卡、带边框输入/按钮)按规则换,线不动。
- [ ] **Step 2: 门禁** — `cd desktop && npm run typecheck && npm test`(typecheck 0 / 基线不降)。
- [ ] **Step 3: Commit**
```bash
git add desktop/src/renderer/components/SettingsMe.tsx desktop/src/renderer/components/SettingsInterface.tsx desktop/src/renderer/components/SettingsPanel.tsx desktop/src/renderer/components/SettingsAbout.tsx
git commit -m "polish(desktop): 软卡片 rollout — 设置四件"
```

---

### Task 7: 汇合门禁 + 终审

**Files:** 无新改动(跑门禁;问题回对应任务修)。

- [ ] **Step 1: 全量门禁**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck 0;vitest 全绿(基线 + formStyles 4)

- [ ] **Step 2: 排除面清单核对**:`grep -rl "border-border" desktop/src/renderer/components` 结果里,聊天视图/浮层/chrome(见 Global Constraints 排除清单)应仍保留其 `border-border`(未被误改);已改组件的残留 `border-border` 应只剩合法分隔线(R6)。用 `git diff <feature-base>..HEAD -- <排除文件>` 确认排除文件零改动。

- [ ] **Step 3: 眼验路径**(告知用户):`npm run dev` → 逐面板(IM 网关/插件/MCP 表单/记忆/Provider/RAG/技能/安全/后台任务/浏览器/快照/设置)明暗两主题过目;拖窄窗口验自动化面板芯片条 + 无横向裁剪。纯前端,**不用重装 jar**。

- [ ] **Step 4: 不 push**(等用户点头)。

## Self-Review

**Spec 覆盖:** formStyles 六常量 + isNarrowLayout(Task 1)✓;R1–R7(Recipe + 各 rollout 任务)✓;Part L 窄宽芯片条(Task 1 Step 6)✓;21 改造文件全覆盖(Task 1-6)✓;排除清单(Global + Task 7 Step 2 核对)✓;暗色微环兜底(Global Constraints)✓;样板检查点(Task 1 结尾停顿)✓。无遗漏。

**占位符扫描:** Task 1 含完整代码(formStyles / test / AutomationForm 逐处 className / Part L JSX)。rollout 任务(2-6)是**规则应用型**:R1–R7 recipe 带 before→after 具体样例即完整指令(机械 class 替换,非"加适当样式"的含糊),实现者读文件按规则改——这是大范围同构重构的恰当粒度,不预写 16 份 diff(会不准)。

**类型/命名一致:** formStyles 导出名(CARD/SECTION_TITLE/INPUT/INPUT_ON_BG/BTN_PRIMARY/BTN_GHOST/BTN_DANGER_GHOST/isNarrowLayout/NARROW_LAYOUT_PX)在 Task 1 定义、rollout 任务 import 一致;isNarrowLayout 签名与测试一致;芯片条状态点取色与 taskStatusLabel 三态口径一致(enabled+running→绿、enabled+非running→muted、!enabled→subtle)。
