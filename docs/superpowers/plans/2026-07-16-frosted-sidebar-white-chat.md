# 磨砂透明侧栏 + 聊天纯白/面板灰卡 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS 上顶条+侧栏半透明磨砂(vibrancy)、聊天内容区纯白浮起、工具面板保持灰底+软白卡;非 macOS 自动平面两色。

**Architecture:** 分两层——T1 内容区按视图铺实底(聊天 `bg-surface` 白 / 面板 `bg-bg` 灰),平台无关、无漏光风险;T2 叠加"磨砂 chrome"(主窗 macOS `vibrancy` + `<html>.is-mac` 标记 + body/侧栏/根/顶条在 mac 透明露磨砂),依赖 T1 的内容实底不漏桌面。磨砂是可插拔质感层,去掉即回平面。

**Tech Stack:** Electron(main vibrancy)+ React/TS + Tailwind + tokens.css。已批准 spec:`docs/superpowers/specs/2026-07-16-frosted-sidebar-white-chat-design.md`(commit fc8efdd)。

## Global Constraints

- 纯视觉:不改行为/数据/props/testid;仅样式类 + 一处平台标记 + 一处 view 条件 bg。
- desktop typecheck 0;全量 vitest 基线不降(675;无可测纯函数,验证靠 typecheck + 眼验)。
- **仅 macOS 磨砂**:`process.platform === 'darwin'` 守卫(main)+ `<html>.is-mac` 类(renderer);非 darwin 走实色不透。
- **防漏光不变式**:内容区永远铺实底(`bg-surface` 白 / `bg-bg` 灰),磨砂只在顶条/侧栏露;内容区不得透出桌面。
- 软卡片语言(面板灰底+白卡)**不动**。
- 复用现成 token:聊天白 = `bg-surface`(`--bg-elevated` #fff / 暗 #161b22);面板灰 = `bg-bg`(`--bg`)。
- push 需用户单独点头(不在本计划内)。

**工作目录**:命令在 `desktop/` 下执行。typecheck:`npm run typecheck`;测试:`npx vitest run`。git add/commit 用 `desktop/` 前缀路径、在仓库根跑。**改了 main 进程(T2)须完整重启 dev 眼验**(HMR 不重建 BrowserWindow)。

---

## File Structure

- Modify `desktop/src/renderer/App.tsx` — 内容列按视图铺 bg(T1);根去 `bg-bg`(T2)。
- Modify `desktop/src/main/index.ts` — 主窗 darwin 分支加 vibrancy(T2)。
- Modify `desktop/src/renderer/main.tsx` — 加 `<html>.is-mac` 标记(T2)。
- Modify `desktop/src/renderer/styles/tokens.css` — `.is-mac` body/侧栏透明覆盖(T2)。
- Modify `desktop/src/renderer/components/TopBar.tsx` — mac 顶条透明(T2)。

无新文件、无新测试(纯视觉;验证靠 typecheck 0 + vitest 基线 + 眼验)。

---

## Task 1: 内容区按视图铺实底(聊天白 / 面板灰)

**Files:**
- Modify: `desktop/src/renderer/App.tsx`(内容列,约 :898)

**Interfaces:**
- Produces: 内容列携带 `view === 'chat' ? 'bg-surface' : 'bg-bg'` 实底(T2 依赖此实底防漏光)。

- [ ] **Step 1: 内容列按视图铺色** — `desktop/src/renderer/App.tsx`

按**内容**匹配(行号约 :898,可能因上游改动漂移)这一行:

```tsx
      <div className="relative flex min-w-0 flex-1 flex-col">
```

改为:

```tsx
      <div className={'relative flex min-w-0 flex-1 flex-col ' + (view === 'chat' ? 'bg-surface' : 'bg-bg')}>
```

- 聊天视图 → `bg-surface`(`--bg-elevated`:浅色纯白 #fff / 暗色 #161b22)= 纯白内容岛;
- 其它视图(工具面板)→ `bg-bg`(灰)+ 软白卡不变。
- 该列内含全部 view 分支(plugins/automations/…/chat),一处条件即覆盖聊天与面板。

- [ ] **Step 2: typecheck 0**

Run: `cd desktop && npm run typecheck`
Expected: 0 errors。

- [ ] **Step 3: 全量 vitest 基线不降**

Run: `cd desktop && npx vitest run`
Expected: 81 files / 675 passing(无新增/删除测试)。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 内容区按视图铺色(聊天纯白 bg-surface / 面板灰 bg-bg)"
```

- [ ] **Step 5: 眼验(不阻塞)**

`npm run dev`(纯 renderer,HMR 即可):聊天内容区变纯白;工具面板仍灰底+软白卡。

---

## Task 2: 磨砂 chrome(macOS vibrancy + 透明)

**Files:**
- Modify: `desktop/src/main/index.ts`(主窗 darwin 分支,:250-252)
- Modify: `desktop/src/renderer/main.tsx`(加 is-mac 标记)
- Modify: `desktop/src/renderer/styles/tokens.css`(`.is-mac` 覆盖)
- Modify: `desktop/src/renderer/App.tsx`(根去 bg-bg,:840)
- Modify: `desktop/src/renderer/components/TopBar.tsx`(mac 透明)

**Interfaces:**
- Consumes: T1 内容列实底(`bg-surface`/`bg-bg`)——磨砂透明后靠它防漏光。

- [ ] **Step 1: 主窗加 vibrancy(仅 darwin)** — `desktop/src/main/index.ts`

按内容匹配(:250-252):

```ts
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 11 } }
      : {}),
```

改为:

```ts
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 12, y: 11 },
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
        }
      : {}),
```

- `vibrancy: 'sidebar'`:macOS 侧栏材质磨砂;`visualEffectState: 'active'`:失焦不变暗;`backgroundColor: '#00000000'`:透明窗底让磨砂透出。
- `as const` 保证 `vibrancy`/`visualEffectState` 满足 Electron 联合字面量类型。

- [ ] **Step 2: renderer 入口加 `<html>.is-mac`** — `desktop/src/renderer/main.tsx`

在 `applyTheme(loadPrefs().ui, prefersDark())`(:10)之后、`const rootElement = ...`(:12)之前,插入:

```ts
// macOS:标记 <html> 以启用磨砂透明皮肤(非 mac 走实色不透)
if (window.wraith.platform === 'darwin') document.documentElement.classList.add('is-mac')
```

- [ ] **Step 3: tokens.css 加 `.is-mac` 透明覆盖** — `desktop/src/renderer/styles/tokens.css`

在 `.sidebar-gradient { ... }` 规则(约 :62,现为 `background: linear-gradient(...)`)之后,新增:

```css
/* macOS 磨砂皮肤:body 与侧栏透明,露出窗口 vibrancy(非 mac 无 .is-mac,走上面实色) */
html.is-mac body { background: transparent; }
html.is-mac .sidebar-gradient { background: transparent; }
```

(不改原 `body { background: var(--bg) }` 与 `.sidebar-gradient` 实色规则——它们是非 mac 的底。)

- [ ] **Step 4: App 根去掉 `bg-bg`** — `desktop/src/renderer/App.tsx`

按内容匹配(:840):

```tsx
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-fg">
```

改为(去 `bg-bg`,交给 body:mac 透明露磨砂 / 非 mac body 灰):

```tsx
    <div className="flex h-screen flex-col overflow-hidden text-fg">
```

- [ ] **Step 5: TopBar mac 透明** — `desktop/src/renderer/components/TopBar.tsx`

在 `const pad = topBarLeftPad(window.wraith.platform)` 之后加一行:

```tsx
  const isMac = window.wraith.platform === 'darwin'
```

把容器 div(现 `className={'flex h-[38px] shrink-0 items-center border-b border-border bg-bg [-webkit-app-region:drag] ' + pad}`)改为去掉字面量 `bg-bg`、按平台补:

```tsx
    <div className={'flex h-[38px] shrink-0 items-center border-b border-border [-webkit-app-region:drag] ' + (isMac ? '' : 'bg-bg ') + pad}>
```

- mac:顶条透明露磨砂(与侧栏连成「⌐」形磨砂);非 mac:`bg-bg` 实色。折叠键/right 插槽/drag 不变。

- [ ] **Step 6: typecheck 0**

Run: `cd desktop && npm run typecheck`
Expected: 0 errors(`vibrancy`/`visualEffectState` 字面量类型 OK;is-mac 语句 `window.wraith.platform` 已类型化;无未用变量)。

- [ ] **Step 7: 全量 vitest 基线不降**

Run: `cd desktop && npx vitest run`
Expected: 81 files / 675 passing。

- [ ] **Step 8: 提交**

```bash
git add desktop/src/main/index.ts desktop/src/renderer/main.tsx desktop/src/renderer/styles/tokens.css desktop/src/renderer/App.tsx desktop/src/renderer/components/TopBar.tsx
git commit -m "feat(desktop): macOS 磨砂 chrome(vibrancy 顶条+侧栏透明,内容实底防漏光)"
```

- [ ] **Step 9: 眼验(定案点,必须完整重启 dev —— 改了 main vibrancy)**

完全退出 `npm run dev` 重开,核:
1. macOS 顶条+侧栏磨砂(透壁纸模糊),观感 OK;
2. 聊天纯白内容岛 / 面板灰底+软白卡;
3. 磨砂上侧栏文字可读(不够→加极淡 tint,见 spec 风险);
4. **内容区不漏桌面**(白/灰实底铺满,无透明缝);
5. 暗色:磨砂变深、聊天 #161b22、协调;
6. 交通灯仍垂直居中、拖拽仍可。

---

## 收尾:门禁 + opus 终审

- 全量 `npm run typecheck`(0)+ `npx vitest run`(675)。
- opus 读全 diff(base..HEAD 两提交)终审:darwin 守卫正确性、防漏光不变式(内容实底)、is-mac 覆盖只影响 mac、`as const` 类型、TopBar/根透明无回归、YAGNI、软卡片未受影响。
- 眼验清单(T1 Step5 / T2 Step9)交用户定案;磨砂材质/可读性/回退按眼验议。
- **push 需用户单独点头**。

---

## 执行说明

- T1 → T2 **串行**(T2 的透明依赖 T1 的内容实底防漏光)。
- 无并行;controller 串行提交。
