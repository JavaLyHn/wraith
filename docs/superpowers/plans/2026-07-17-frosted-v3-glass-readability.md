# 磨砂 v3:alpha 根修 + 玻璃可读性 + 微动效 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 tailwind alpha 根因(135 处 `/N` 死类复活);磨砂侧栏加纱+加墨可读、白线全灭(墨线/sticky 真底/无框盒);折叠双向滑动 + 四 chrome 按钮按压回弹。

**Architecture:** T1 地基(RGB 三元组 vars + `<alpha-value>` 配置 + 动态 accent 三元组);T2 玻璃视觉(纯 CSS/类替换,依赖 T1 的 `bg-fg/N`);T3 动效(dockInnerClass 恒绝对定位 + 按压类)。已批准 spec:`docs/superpowers/specs/2026-07-17-frosted-v3-glass-readability-design.md`(commit 184876f)。

**Tech Stack:** React/TS + Tailwind v3.4(颜色走 CSS vars)。纯 renderer,无 main 改动。

## Global Constraints

- 行为/数据/testid 零变更(样式与动效类;sticky 仅换背景类名)。
- 防漏光不变式:纱是"加底"非"去底";`html.is-mac body { background: transparent }` 保留不动;内容列不动。
- desktop typecheck 0;vitest 全绿(675 基线 + T1 新增 hexToRgbTriplet 测试;T3 更新 sidebarDock 断言,数量不减)。
- tokens.css 中 hex 变量与新 RGB 三元组必须数值一致(并排放置+注释注明同步义务)。
- push 需用户单独点头(不在本计划内)。

**工作目录**:命令在 `desktop/` 下执行。typecheck:`npm run typecheck`;测试:`npx vitest run`。git add/commit 用 `desktop/` 前缀路径、在仓库根跑。眼验:重启 `npm run dev`(tailwind.config 变更不走 HMR),无需整 app 退出。

---

## File Structure

- T1 Modify:`desktop/tailwind.config.js`、`desktop/src/renderer/styles/tokens.css`、`desktop/src/renderer/settings/theme.ts`、`desktop/test/theme.test.ts`
- T2 Modify:`desktop/src/renderer/styles/tokens.css`、`desktop/src/renderer/components/Sidebar.tsx`、`desktop/src/renderer/components/ProjectSwitcher.tsx`
- T3 Modify:`desktop/src/renderer/lib/sidebarDock.ts`、`desktop/test/sidebarDock.test.ts`、`desktop/src/renderer/components/Sidebar.tsx`、`desktop/src/renderer/App.tsx`

---

## Task 1: alpha 根修(RGB 三元组 + `<alpha-value>`)

**Files:** `desktop/tailwind.config.js`、`desktop/src/renderer/styles/tokens.css`、`desktop/src/renderer/settings/theme.ts`、`desktop/test/theme.test.ts`

**Interfaces:** Produces——Tailwind 颜色透明度修饰(`bg-fg/5` 等)可用;`hexToRgbTriplet` 导出;`--accent-rgb` 随主题动态下发。T2 依赖。

- [ ] **Step 1: tokens.css 增设 RGB 三元组** — `:root` 内(hex 变量之后、`--font-sans` 之前)插入:

```css
  /* RGB 三元组(供 Tailwind rgb(var(--x-rgb)/<alpha-value>) 用;与上方 hex 必须同步改) */
  --bg-rgb: 247 248 250;
  --bg-elevated-rgb: 255 255 255;
  --fg-rgb: 28 36 48;
  --fg-muted-rgb: 91 102 117;
  --fg-subtle-rgb: 152 162 179;
  --border-rgb: 226 230 236;
  --accent-fg-rgb: 255 255 255;
  --danger-rgb: 192 57 43;
  --warn-rgb: 230 126 34;
  --ok-rgb: 31 157 99;
```

`[data-theme="dark"]` 内(hex 之后)插入:

```css
  /* RGB 三元组(与上方 hex 同步) */
  --bg-rgb: 15 20 25;
  --bg-elevated-rgb: 22 27 34;
  --fg-rgb: 230 237 243;
  --fg-muted-rgb: 154 167 180;
  --fg-subtle-rgb: 107 118 132;
  --border-rgb: 43 49 56;
  --accent-fg-rgb: 255 255 255;
  --danger-rgb: 240 100 90;
  --warn-rgb: 232 161 60;
  --ok-rgb: 63 185 132;
```

(`--accent-rgb` 不在 CSS 写死——由 applyTheme 动态下发,见 Step 3。)

- [ ] **Step 2: tailwind.config.js 颜色改 alpha 模板** — colors 块整体替换为:

```js
      colors: {
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
        fg: 'rgb(var(--fg-rgb) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted-rgb) / <alpha-value>)',
        'fg-subtle': 'rgb(var(--fg-subtle-rgb) / <alpha-value>)',
        border: 'rgb(var(--border-rgb) / <alpha-value>)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        ok: 'rgb(var(--ok-rgb) / <alpha-value>)',
      },
```

- [ ] **Step 3: theme.ts 动态 accent 三元组** — 新增导出纯函数(放 ACCENTS 之后):

```ts
/** '#0ea5b7' → '14 165 183':Tailwind rgb(var(--accent-rgb)/<alpha>) 需要的空格三元组。 */
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
```

`resolveThemeVars` 的 vars 对象增一项:`'--accent-rgb': hexToRgbTriplet(ACCENTS[ui.accent].value),`。

- [ ] **Step 4: theme.test.ts 补测** — 新增:①`hexToRgbTriplet('#0ea5b7')==='14 165 183'`、`hexToRgbTriplet('#fff')==='255 255 255'`;②`resolveThemeVars({...base, accent:'rose'}, false).vars['--accent-rgb'] === hexToRgbTriplet(ACCENTS.rose.value)`。

- [ ] **Step 5: 编译探针验证 alpha 生效**(一次性,不入库):

```bash
printf '<div class="bg-surface/60 bg-fg/5"></div>' > /tmp/tw-probe.html && npx tailwindcss --content /tmp/tw-probe.html --config tailwind.config.js 2>/dev/null | grep -c "bg-surface\\\\/60\|bg-fg\\\\/5"
```

Expected: 2(两类均产出)。

- [ ] **Step 6: typecheck 0** — `cd desktop && npm run typecheck`
- [ ] **Step 7: vitest 全绿** — `npx vitest run`,Expected: 675+新增,0 fail。
- [ ] **Step 8: 提交**

```bash
git add desktop/tailwind.config.js desktop/src/renderer/styles/tokens.css desktop/src/renderer/settings/theme.ts desktop/test/theme.test.ts
git commit -m "fix(desktop): tailwind 颜色补 <alpha-value>(RGB 三元组 vars)——135 处 /N 透明度死类复活"
```

---

## Task 2: 玻璃可读性(纱/墨字/墨线/sticky 真底/无框盒)

**Files:** `desktop/src/renderer/styles/tokens.css`、`desktop/src/renderer/components/Sidebar.tsx`、`desktop/src/renderer/components/ProjectSwitcher.tsx`

**Interfaces:** Consumes T1 的 `bg-fg/N`。

- [ ] **Step 1: tokens.css 磨砂皮肤 v3** — 把现有两行:

```css
html.is-mac body { background: transparent; }
html.is-mac .sidebar-gradient { background: transparent; }
```

替换为(body 行保留原样,侧栏透明改为纱+墨覆盖组):

```css
html.is-mac body { background: transparent; }

/* ── mac 玻璃皮肤:纱(压壁纸饱和度)+ 墨字(可读)+ 墨线(蚀刻不发光) ── */
html.is-mac .sidebar-gradient { background: linear-gradient(180deg, rgba(255,255,255,.42), rgba(255,255,255,.30)); }
html.is-mac[data-theme="dark"] .sidebar-gradient { background: linear-gradient(180deg, rgba(15,20,25,.50), rgba(13,17,23,.42)); }

/* 玻璃上次级文字各深/亮一档(hex 与 rgb 同步) */
html.is-mac [data-testid="sidebar"] {
  --fg-muted: #38424f; --fg-muted-rgb: 56 66 79;
  --fg-subtle: #5b6675; --fg-subtle-rgb: 91 102 117;
}
html.is-mac[data-theme="dark"] [data-testid="sidebar"] {
  --fg-muted: #b6c2cf; --fg-muted-rgb: 182 194 207;
  --fg-subtle: #8b98a5; --fg-subtle-rgb: 139 152 165;
}

/* 玻璃上发丝线换半透明墨(覆盖 aside 自身 border-r、footer border-t、菜单分隔线)。
   耦合 Tailwind 类名 .border-border:局部两条,替代方案是 JSX 全改,churn 更大。 */
html.is-mac :is([data-testid="sidebar"], [data-testid="sidebar"] *).border-border { border-color: rgba(28,36,48,.16); }
html.is-mac[data-theme="dark"] :is([data-testid="sidebar"], [data-testid="sidebar"] *).border-border { border-color: rgba(230,237,243,.14); }

/* 会话列表 sticky 表头真底(滚动内容不透叠);mac 上与纱同族 */
.sidebar-sticky { background: rgb(var(--bg-rgb) / .92); }
html.is-mac .sidebar-sticky { background: rgba(255,255,255,.55); }
html.is-mac[data-theme="dark"] .sidebar-sticky { background: rgba(22,27,34,.55); }
```

- [ ] **Step 2: Sidebar sticky 换语义类** — `Sidebar.tsx` 两处(约 :406-407):`headerCls` 与 `groupLabelCls` 字符串里的 `bg-bg/90` 均替换为 `sidebar-sticky`(其余 token 含 `backdrop-blur-sm` 不动)。

- [ ] **Step 3: 新对话盒去边框** — `Sidebar.tsx`(约 :232)按钮 className:

```
w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg hover:border-accent hover:text-accent
```

改为:

```
w-full rounded-lg bg-fg/5 px-3 py-2 text-left text-xs text-fg hover:bg-fg/10 hover:text-accent
```

- [ ] **Step 4: 项目选择器触发钮去边框** — `ProjectSwitcher.tsx`(约 :46):

```
mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg hover:border-accent
```

改为:

```
mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg bg-fg/5 px-3 py-2 text-left text-xs text-fg hover:bg-fg/10
```

- [ ] **Step 5: typecheck 0** — `cd desktop && npm run typecheck`
- [ ] **Step 6: vitest 全绿** — `npx vitest run`(数量同 T1 后)。
- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/styles/tokens.css desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/components/ProjectSwitcher.tsx
git commit -m "feat(desktop): 玻璃可读性——纱+墨字+墨线+sticky真底+盒子去框墨感填充(白线全灭)"
```

---

## Task 3: 微动效(折叠双向滑 + 按压回弹)

**Files:** `desktop/src/renderer/lib/sidebarDock.ts`、`desktop/test/sidebarDock.test.ts`、`desktop/src/renderer/components/Sidebar.tsx`、`desktop/src/renderer/App.tsx`

- [ ] **Step 1: dockInnerClass 恒绝对定位** — `sidebarDock.ts` 函数整体替换(docstring 一并更新):

```ts
/** 承 <Sidebar/> 的内层 wrapper 的定位/动画类,编码三态(恒绝对定位,展开/收起双向滑动):
 *  展开 → translate-x-0(占位 240 推挤内容,视觉与流内等价);
 *  折叠 → 浮层滑出;peek 控制丝滑滑入/滑出。 */
export function dockInnerClass(collapsed: boolean, peek: boolean): string {
  const base = 'absolute left-0 top-0 h-full w-60 transition-transform duration-200 ease-out motion-reduce:transition-none'
  if (!collapsed) return base + ' translate-x-0'
  const overlay = base + ' z-50 rounded-r-xl shadow-2xl'
  return peek ? overlay + ' translate-x-0' : overlay + ' -translate-x-full pointer-events-none'
}
```

- [ ] **Step 2: 更新 sidebarDock.test.ts** — 展开态断言改为:含 `absolute left-0 top-0`、`translate-x-0`、`transition-transform`,不含 `z-50`/`shadow-2xl`/`-translate-x-full`(忽略 peek 两分支同断言);折叠两分支断言维持原语义(peek: translate-x-0 无隐藏;非 peek: -translate-x-full + pointer-events-none),可加"均含 transition-transform"。

- [ ] **Step 3: 按压回弹(四按钮)** —
  - `Sidebar.tsx` sidebar-collapse 按钮:className 中 `transition-colors` 改为 `transition duration-150 active:scale-90 motion-reduce:transform-none`(其余 token 不动);
  - `App.tsx` sidebar-expand 按钮:同样把 `transition-colors` 改为 `transition duration-150 active:scale-90 motion-reduce:transform-none`;
  - `App.tsx` terminal-toggle 与 rightdock-toggle 两按钮:className 追加 `transition duration-150 active:scale-90 motion-reduce:transform-none`。

- [ ] **Step 4: typecheck 0** — `cd desktop && npm run typecheck`
- [ ] **Step 5: vitest 全绿** — `npx vitest run`(sidebarDock 断言已更新,0 fail)。
- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/lib/sidebarDock.ts desktop/test/sidebarDock.test.ts desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 微动效——侧栏折叠双向 200ms 滑动(dock 恒绝对定位)+ 四 chrome 按钮 150ms 按压回弹"
```

---

## 收尾:门禁 + opus 终审 + 眼验

- 全量 `npm run typecheck`(0)+ `npx vitest run`(全绿)。
- opus 读全 diff(base..HEAD 三提交)终审:alpha 模板正确性(11 色全换、三元组数值与 hex 一致、accent 动态下发)、is-mac 作用域(非 mac 零影响)、防漏光不变式、dock 三态语义与测试、按压类不破 no-drag/hover、YAGNI。
- 眼验清单(spec)交用户:白线全灭/文字可读/纱浓度/双向滑动/按压/135 复活类全 app 扫一眼/暗色。
- **push 需用户单独点头**。

## 执行说明

- T1 → T2 → T3 严格串行(T2 依赖 T1;T3 与 T2 同文件 Sidebar.tsx,避免冲突)。
- 实现者模型:T1 sonnet、T2 sonnet、T3 sonnet;reviewer sonnet;终审 opus。
