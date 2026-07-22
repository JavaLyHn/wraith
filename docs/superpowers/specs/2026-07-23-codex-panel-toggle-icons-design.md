# Codex 式面板切换键设计(顶栏三键自绘 glyph + 滑线动画)

**日期**:2026-07-23
**状态**:设计待用户审阅
**范围**:桌面端 renderer(新建 1 个纯展示组件 + 改 TopBar + 测试),**不改 Java / 不重打 jar / 不动布局结构**。

## 背景

顶栏三个切换键(侧栏 / 终端 / 右栏)现用 lucide 描边图标(`PanelLeft` / `SquareTerminal` / `PanelRight`),开态仅上 `text-accent` 青、按下 `active:scale-90`,无状态可读的 glyph、无分隔线动画、无悬浮底。用户给了 Codex 参考图(#69–#72),要求换成 Codex 那种「窗口轮廓 + 分隔线 + 某一格填实」的 glyph,切换时**分隔线丝滑滑动、对应格随之填实**,并配柔和 squircle 悬浮底。

## 已敲定决策(用户确认)

1. **动画模型 = 线滑动 + 填充**:关=分隔线停在外边框、对应格收没;开=分隔线滑入、该格同步填实、正好在线处收边。
2. **悬浮底 = hover 显 + 开着时常驻**;静息无底。
3. **激活色 = 单色墨(忠实 Codex)**:用 `fg` / `fg-muted`,开=深墨、关/静息=浅墨,**不上 accent 青**。
4. **悬浮底克制版**:贴合 glyph 的圆角柔底、**不加投影**(顶栏仅 38px,参考图的大胖底+投影是放大产品渲染,按比例收敛)。真机眼验后若要浮起感再加一档极轻 shadow。

## 组件设计

### 新建 `desktop/src/renderer/components/PanelToggleIcon.tsx`

纯展示 SVG glyph,无副作用、无 hooks 依赖外部状态。

**Props**
```ts
export type PanelSide = 'left' | 'right' | 'bottom'
export default function PanelToggleIcon({ side, open, className }: {
  side: PanelSide
  open: boolean
  className?: string   // 传给 <svg>,默认调用方给 'h-4 w-4'
}): JSX.Element
```

**SVG 结构**(viewBox `0 0 24 24`,`fill="none"` `stroke="currentColor"` `strokeWidth={1.6}`):

1. **窗口轮廓**(静态):`<rect x=3 y=3 width=18 height=18 rx=3>`,仅描边。
2. **填充块**(`data-testid="panel-fill"` `data-open={open}` `data-side={side}`):一个 `<rect>` 覆盖「分隔线 → 外侧边」那一格,`fill="currentColor"` `stroke="none"`。用 CSS `transform: scale(...)` 收展,`transform-box: fill-box`,原点贴外边框侧:
   - `left`:格 = 左边框到分隔线,`transform-origin: left center`,关 `scaleX(0)` → 开 `scaleX(1)`
   - `right`:格 = 分隔线到右边框,`transform-origin: right center`,关 `scaleX(0)` → 开 `scaleX(1)`
   - `bottom`:格 = 分隔线到底边框,`transform-origin: center bottom`,关 `scaleY(0)` → 开 `scaleY(1)`
3. **分隔线**(`data-testid="panel-divider"` `data-open={open}` `data-side={side}`):细 `<rect>`(粗 ~1.4),`transform: translate(...)` 从「贴外边框(关)」滑到「格内侧位置(开)」:
   - `left`:竖线,关贴左边框(x≈4)→ 开滑到 ~36%(x≈9.5),`translateX` 关 `0` → 开 `+5.5`
   - `right`:竖线,关贴右边框(x≈20)→ 开滑到 ~64%(x≈14.5),`translateX` 关 `0` → 开 `-5.5`
   - `bottom`:横线,关贴底边框(y≈20)→ 开滑到下 1/3(y≈14.5),`translateY` 关 `0` → 开 `-5.5`

几何常量在组件内以 `side` 查表定义(单一 source),填充块与分隔线开态位置**必须对齐**(填充的内侧边 = 分隔线开态位置),否则视觉错位。

**动画**:填充块与分隔线均 `transition: transform 200ms var(--ease-smooth)`(复用现有令牌)。开/关切换即 `open` prop 变 → transform 变 → 平滑过渡。`transform` 值用内联 `style` 表达(随 `open` 计算);`transition`/`transform-box`/`transform-origin` 用类或内联样式。`prefers-reduced-motion: reduce` → 关过渡(`motion-reduce:transition-none`),终态仍立即生效。

**配色**:glyph 全 `currentColor`,颜色由外层按钮的 `text-*` 决定(见下)。填充块开态即 `currentColor` 实心;关态被 `scale(0)` 收没,不显。

## TopBar 接线(改 `desktop/src/renderer/components/TopBar.tsx`)

三处 lucide 图标替换为 `<PanelToggleIcon>`,**testid 与 onClick 全部保留**:

| 键 | testid(不变) | side | open |
|---|---|---|---|
| 侧栏 | `sidebar-toggle` | `left` | `!sidebarCollapsed` |
| 终端 | `terminal-toggle` | `bottom` | `terminalOpen` |
| 右栏 | `rightdock-toggle` | `right` | `rightDockOpen` |

**注意语义变化**:侧栏键此前恒 `btn(false)`(恒浅墨);现起 `open = !sidebarCollapsed`,glyph 会反映折叠态(展开=深墨填实、折叠=浅墨空)。这是刻意改进。

**按钮样式(squircle 柔底 + 单色墨)**:重写 `btn()`,按 `open` 给三档:
- 基:`flex items-center rounded-[10px] p-1.5 transition-colors duration-150 active:scale-90 motion-reduce:transform-none [-webkit-app-region:no-drag]`
- 静息(`!open`):`text-fg-muted hover:bg-fg/[0.06] hover:text-fg`
- 开(`open`):`text-fg bg-fg/[0.08]`(柔底常驻 + 深墨)

无投影(决策 4)。`rounded-[10px]` = squircle 观感的近似(顶栏尺度下与真 superellipse 肉眼难辨)。

其余结构(`[-webkit-app-region:drag]` 顶栏、`topBarLeftPad`、`showChat` 门控右簇、中段 flex-1)**完全不变**。

## 测试

### 新建 `desktop/test/panelToggleIcon.test.tsx`(@vitest-environment jsdom)
- `side='left' open` → `panel-fill` 与 `panel-divider` 的 `data-open==='true'`;`open=false` → `'false'`。
- 三个 `side` 值 → `data-side` 对应(`left`/`right`/`bottom`),且渲染出窗口轮廓 `<rect>`。
- `className` 透传到 `<svg>`。
- **不**断言具体 transform 字符串(脆弱);只断言 `data-open`/`data-side` 语义属性。

### 扩 `desktop/test/topBarComponent.test.tsx`
- `sidebarCollapsed=false` → `sidebar-toggle` 内 glyph `data-open==='true'`;`=true` → `'false'`(补上此前 TopBar 无组件级 open 态覆盖的缺口)。
- `terminalOpen`/`rightDockOpen` 分别翻转 `terminal-toggle`/`rightdock-toggle` 内 glyph `data-open`。
- 现有 testid/点击回调断言保留。

### e2e
testid 与点击逻辑不变、布局结构不动 → shell.e2e 预期不受影响。Task 2 收尾跑一遍 toggle 相关用例(侧栏折叠/展开、终端、右栏)作 sanity,不承担 Task D 那种全布局回归风险。

## 任务切分(供 plan)

- **Task 1**:`PanelToggleIcon` 组件 + `panelToggleIcon.test.tsx`(TDD:先写失败测试,再实现 glyph/三向几何/滑线动画/单色墨/reduced-motion)。可独立测试交付。
- **Task 2**:接进 `TopBar`(glyph 替换 + squircle 柔底 + open 接线)+ 扩 `topBarComponent.test.tsx` + 跑 toggle 相关 e2e sanity。

顺序:Task 1 → Task 2(组件先立、再接线)。

## 明确不做(YAGNI)

- 不引入动画库(纯 CSS transform transition)。
- 不改顶栏布局结构 / drag 区 / `topBarLeftPad` / `showChat` 门控。
- 不给悬浮底加投影(除非真机眼验后用户要)。
- 不改这三键的开合触发逻辑(仍是现有 `onToggle*` 回调)。
- 不动其它面板动效(上一轮已做)。
- 不做 glyph 主题色随 accent(本轮明确单色墨)。
```
