# 全 app「软卡片」视觉语言重设计 设计稿

日期:2026-07-16
状态:设计已与用户确认(方向 B 软卡片 + 一次全改 + 样板检查点),待用户审阅
背景:用户嫌自动化表单"方框套方框"丑(截图);grep 证实 `border border-border` 盒模式遍布 40+ 组件,panel/form 类无共享基件、各自手写。刚上线的投递芯片(淡青选中)已获认可,是新语言起点。

## 目标

消灭"框中框"双重描边,全 app panel/form 统一为**软卡片语言**:层次靠深浅(灰底浮白卡、卡内灰填充控件),不靠灰描边;按钮分主次;纯视觉改造,零行为/数据/testid 变更。

## 确认的决策(用户)

- 方向 **B 软卡片**(否决 A 全平去卡、C 行式)。
- 范围 **一次全改**(panel/form 类全部),含**样板检查点**:AutomationForm 先改完给用户过目定案,再铺开其余组件(防 16+ 组件按错方向铺完返工;不是分两期)。

## 设计前提(已核)

- app 壳 `bg-bg`(浅灰 #f7f8fa / 暗 #0f1419),面板继承 → `bg-surface`(白 / #161b22)卡片两主题都能浮起。
- tailwind 无自定义 shadow,用默认 `shadow-sm`(暗色下不可见,靠 bg 对比,可接受)。
- `surface` = `var(--bg-elevated)`;全部颜色走 theme-aware tokens,暗色自动成立。

## 1. 共享基件 — 新建 `desktop/src/renderer/lib/formStyles.ts`

把 AutomationForm 的局部常量升级为全 app 共享(纯常量模块,无组件抽象——沿用现有 className 常量惯例):

```ts
/** 软卡片视觉语言(2026-07-16 spec):层次靠深浅不靠描边。 */
export const CARD = 'flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-sm'
export const SECTION_TITLE = 'text-2xs font-semibold uppercase tracking-wider text-fg-subtle'
/** 卡内控件:灰填充无边框,focus 亮 accent;透明边框防聚焦跳动。 */
export const INPUT = 'mt-1 w-full rounded-lg border border-transparent bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent'
/** 裸在灰底上(无卡片包裹)的控件用反相填充。 */
export const INPUT_ON_BG = 'mt-1 w-full rounded-lg border border-transparent bg-surface px-3 py-2 text-xs text-fg outline-none focus:border-accent'
export const BTN_PRIMARY = 'rounded-lg bg-accent px-4 py-2 text-xs text-accent-fg hover:opacity-90 disabled:opacity-60'
export const BTN_GHOST = 'rounded-lg px-4 py-2 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-40'
export const BTN_DANGER_GHOST = 'rounded-lg px-4 py-2 text-xs text-danger hover:bg-danger/10 disabled:opacity-40'
```

(常量值为基准;样板任务落地时如需微调 padding/radius,以样板定案值回写本 spec 精神,不改语义。)

## 2. 机械化改造规则(rollout 每组件套用)

- **R1 卡片**:section 盒 `rounded-lg border border-border p-4` → `CARD`(去边框、`bg-surface shadow-sm`、rounded-xl)。
- **R2 控件填充**:input/textarea/select 的 `border border-border bg-*` → 填充式;**填充色始终与所在底形成一档深浅差**(卡内 `bg-bg` 灰,裸灰底上 `bg-surface` 白 = `INPUT_ON_BG`)。
- **R3 按钮三档**:实心 accent(主)/ ghost(次)/ danger-ghost(危险);已实心的保持;灰描边按钮按语义归档。
- **R4 去盒交互件**:折叠条(如「高级·工具调用审批」)、行内小盒去边框,交互靠 hover 底色;列表 hover 行保持现有 `hover:bg-surface` 语义。
- **R5 已达标件不动**:芯片(投递)、徽标(QQ 待发)、胶囊(网关状态)、`rounded-full` 家族已是新语言。
- **R6 分隔线**:发丝线(`border-t border-border`)仅用于卡内小节或列表行分隔,**不再作为盒的四边**。合法分隔线保留——rollout 是按规则改,不是盲删所有 `border-border`。
- **R7 防裁剪**:可能超 ~300px 的横排(按钮行/调度行/工具条)一律 `flex-wrap`;任何容器宽度下内容不得被窗口裁剪(宁可换行/换布局,不横向溢出)。

## 3. 范围

### 改(panel/form 类,按 grep 清单)
- **样板**:`AutomationForm.tsx`(21 处,含建 formStyles + 迁移本地常量)。
- **自动化域**:`AutomationsPanel.tsx`、`AutomationRuns.tsx`、`QqPendingBlock.tsx`。
- **面板**:`ImGatewayPanel.tsx`(13)、`PluginsPanel.tsx`(12)、`MemoryPanel.tsx`(10)、`ProvidersPanel.tsx`(9)、`SkillsPanel.tsx`(8)、`McpServerForm.tsx`(7)、`TaskPanel.tsx`(6)、`RagPanel.tsx`(6)、`SkillEditor.tsx`(5)、`PolicyPanel.tsx`(5)、`BrowserPanel.tsx`(5)、`SnapshotPanel.tsx`(4)、`SkillViewer.tsx`(4)。
- **设置四件**:`SettingsMe/SettingsInterface/SettingsPanel/SettingsAbout`——按规则扫,多为合法分隔线,预期改动少。

### 不改
- **聊天视图**(已验收的另一套语言):UserMessage、TeamCard、PlanCard、ToolCard、ToolGroup、ThinkingBlock、DiffCard、Composer、WelcomeEmptyState。
- **浮层**(需要边界感):CommandPalette、ApprovalModal、`ui/`(dialog/popover/select/switch/tooltip)。
- **结构 chrome**(布局分界,非盒):Sidebar、RightDock、TerminalPane/TerminalDrawer、BrowserPane、ProjectSwitcher/ModeSwitcher/ModelSwitcher、StatusChip。

## 3b. Part L — AutomationsPanel 窄宽自适应(用户追加,已确认「顶部任务芯片条」)

**根因(已诊断)**:面板是固定 240px 任务列表 + 表单的双栏;表单内在最小宽度 ~450-500px(按钮行/调度行/路径输入)。侧栏展开且窗口较窄时内容区仅 ~480px → 表单列装不下 → 横向溢出;macOS 悬浮滚动条不可见,视觉上=右侧被窗口硬裁(用户截图)。与折叠无关,是无窄宽策略。

**设计**:
- **宽态**(面板内容区宽 ≥ 640px):保持现有双栏(列表 `w-60` + 表单),仅按 R1-R7 换视觉皮肤。
- **窄态**(< 640px):侧列表隐藏;表单顶部出现**任务芯片条**——一排可横滑(`overflow-x-auto`)芯片,每片 = 状态点 + 任务名 truncate(状态点取色沿 `taskStatusLabel` 三态:运行中绿 / 网关未运行灰 / 暂停 subtle),选中 = 淡青(`border-accent bg-accent/10`,同投递芯片);末尾追加「+ 新建」芯片(= 现有 新建任务 动作)。表单全宽软卡。启停/删除等动作不进芯片(表单底部已有)。
- **机制**:面板内 `ResizeObserver` 量容器宽 → `narrow` 布尔切换两种 JSX(阈值常量 `NARROW_LAYOUT_PX = 640`,判断抽纯函数可单测);不引 Tailwind container-query 插件。
- QqPendingBlock/flush toast/网关胶囊不受影响(始终在表单列)。

## 4. 执行方式(计划要求)

1. **任务 1 = 样板**:建 `formStyles.ts` + 改 AutomationForm 全量套新语言 + AutomationsPanel 落 Part L 窄宽自适应(自动化域一体成为样板)。**此任务(组)完成后暂停,用户 dev 眼验定案**(样板检查点);用户若调整,改样板后再铺开。
2. **rollout**:其余组件按域分任务,文件不重叠可**并行子代理**,每任务 = 按 R1-R6 机械套用 + import formStyles 去局部重复常量。
3. 全量门禁 + opus 终审。

## 5. 门禁与约束

- **纯视觉**:不改任何行为/数据流/props/testid;JSX 结构仅样式类变更(必要的包裹层增删除外,须最小)。
- typecheck 0;vitest 基线不降(无行为断言受影响;若有快照类测试按新类名更新)。
- **暗色主题**:两态都核。若暗色下卡片对比不足,统一补极淡微环(如 `dark:ring-1 dark:ring-white/5`)——由样板阶段定案,rollout 统一继承。
- 可访问性:focus 可见性不降(填充式控件 focus:border-accent 保证)。

## 风险

- 个别面板结构特殊(如 ImGatewayPanel 的绑定卡/日志区),机械规则套不上时由实现者按"深浅分层、零盒边框"精神就地裁量,并在报告注明。
- `shadow-sm` 在暗色不可见:预期行为(bg 对比承担),非缺陷。
- 大范围类名变更可能与进行中的其他分支冲突:当前仓库无并行分支,风险低。

## 不做(YAGNI)

- 不建 React 组件级抽象(Input/Card 组件)——常量模块足够,符合现有惯例;
- 不动聊天视图/浮层/chrome;不改 tokens.css 颜色值;不引入新依赖。
