# 聊天消息重设计 + 设置面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端非对称说话人区分的聊天消息 + 左下角「设置」面板(我/界面/关于),含全套界面主题与轻量 GitHub 更新检查。

**Architecture:** 偏好中枢 = 纯逻辑 `prefs.ts` + 纯 `theme.ts`(resolveThemeVars/applyTheme)+ React `SettingsProvider`(持 prefs、变更即持久化+applyTheme);主题写 `<html data-theme>` + 内联 CSS 变量(强调色/字号/字体与深浅主题解耦);更新检查在 Electron 主进程纯函数 `computeUpdate` + GitHub Releases API;全部 UI 偏好走 `localStorage`,不碰后端。

**Tech Stack:** Electron + React + TypeScript + Tailwind(CSS 变量 token)+ vitest;Electron 主进程 Node 20(全局 `fetch`)。

## Global Constraints

- 纯 UI 偏好一律走 `localStorage`(单键 `wraith.prefs` 存整个 Prefs JSON),不改后端 config.json;沿用既有 `wraith.sidebar.*` 持久化风格。
- 强调色不写进深/浅主题调色板,由 `applyTheme` 单独注入 `--accent`(主题与强调色解耦)。
- 更新只做轻量检查 + 手动下载:主进程 fetch GitHub Releases、semver 比对、返回结果;**不引入 electron-updater**、不自动下载/安装。
- 聊天方向 = A 非对称(用户右气泡+小头像 / Agent 左「👻 Wraith」头像名字 + 全宽正文);设置布局 = A(左分区导航 + 右内容)。Agent 侧头像/名字本期固定,不做可配。
- 仓库根新增 `LICENSE`(MIT,`Copyright (c) 2026 LyHn`);关于页展示「MIT License」。
- GitHub 仓库固定 `https://github.com/JavaLyHn/wraith`;Releases API `https://api.github.com/repos/JavaLyHn/wraith/releases`。
- 门禁:桌面 `npm run typecheck` + `npx vitest run` + `npm run build` 全绿;Java 不涉改动。红线扫描 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"` 仅应命中字段名/自指。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 分支:`feat/settings-ui`。preload 有改动,落地后眼验需**整重启桌面 app**(不热更)。

## File Structure

| 文件 | 职责 |
|---|---|
| `desktop/src/renderer/settings/prefs.ts`(新) | Prefs 类型/默认/loadPrefs/savePrefs(纯,可注入 read/write) |
| `desktop/src/renderer/settings/theme.ts`(新) | ACCENTS/resolveThemeVars(纯)/applyTheme/prefersDark |
| `desktop/src/renderer/settings/SettingsContext.tsx`(新) | SettingsProvider + useSettings |
| `desktop/src/renderer/styles/tokens.css`(改) | `[data-theme=dark]` 深色调色板 + `--font-scale` |
| `desktop/src/renderer/main.tsx`(改) | 早期 applyTheme 防闪 + 包 SettingsProvider |
| `desktop/src/renderer/lib/chatIdentity.ts`(新) | userAvatarGlyph(纯) |
| `desktop/src/renderer/components/AgentMessage.tsx`(新) | Agent 左头像+名字+全宽正文 |
| `desktop/src/renderer/components/UserMessage.tsx`(改) | 右气泡加 profile 头像 |
| `desktop/src/renderer/components/Transcript.tsx`(改) | message 分支改用 AgentMessage |
| `desktop/src/main/updateCheck.ts`(新) | computeUpdate/semverCompare(纯) |
| `desktop/src/main/index.ts`(改) | appInfo/checkUpdate/openExternal/openPath 四 IPC |
| `desktop/src/preload/index.ts`(改) | 四桥方法 |
| `desktop/src/shared/types.ts`(改) | AppInfo/UpdateResult |
| `desktop/src/renderer/components/SettingsPanel.tsx`(新) | 头部 + 左分区导航 + 右内容路由 |
| `desktop/src/renderer/components/SettingsInterface.tsx`(新) | 主题/强调色/字号/字体 |
| `desktop/src/renderer/components/SettingsMe.tsx`(新) | 昵称/头像 + 配置速览 |
| `desktop/src/renderer/components/SettingsAbout.tsx`(新) | 版本/许可证/GitHub/更新开关+检查 |
| `desktop/src/renderer/App.tsx`(改) | view 'settings' + 更新提示条 |
| `desktop/src/renderer/components/Sidebar.tsx`(改) | footer ⚙ 设置入口 + onOpenSettings |
| `LICENSE`(新,仓库根) | MIT |

---

### Task 1: 偏好中枢 prefs.ts

**Files:**
- Create: `desktop/src/renderer/settings/prefs.ts`
- Test: `desktop/test/prefs.test.ts`

**Interfaces:**
- Produces: `ThemeMode`/`AccentKey`/`FontSize`/`FontFamily`/`UiPrefs`/`ProfilePrefs`/`UpdatePrefs`/`Prefs` 类型;`DEFAULT_PREFS`;`loadPrefs(read?)`;`savePrefs(prefs, write?)`。

- [ ] **Step 1: 写失败测试**

`desktop/test/prefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadPrefs, savePrefs, DEFAULT_PREFS } from '../src/renderer/settings/prefs'

describe('loadPrefs', () => {
  it('无存储 → 全默认', () => {
    expect(loadPrefs(() => null)).toEqual(DEFAULT_PREFS)
  })
  it('非法 JSON → 全默认', () => {
    expect(loadPrefs(() => '{not json')).toEqual(DEFAULT_PREFS)
  })
  it('部分字段 + 非法枚举 → 逐字段回落默认', () => {
    const raw = JSON.stringify({ ui: { theme: 'dark', accent: 'bogus', fontSize: 'lg' }, profile: { name: '阿豪' } })
    const p = loadPrefs(() => raw)
    expect(p.ui.theme).toBe('dark')            // 合法保留
    expect(p.ui.accent).toBe('teal')           // 非法回落
    expect(p.ui.fontSize).toBe('lg')
    expect(p.ui.fontFamily).toBe('system')     // 缺失回落
    expect(p.profile.name).toBe('阿豪')
    expect(p.profile.avatar).toBe('')
    expect(p.update).toEqual(DEFAULT_PREFS.update)
  })
  it('空昵称回落默认名', () => {
    expect(loadPrefs(() => JSON.stringify({ profile: { name: '   ' } })).profile.name).toBe('我')
  })
})

describe('savePrefs', () => {
  it('写整个 JSON 到 wraith.prefs,可被 loadPrefs 读回', () => {
    const store: Record<string, string> = {}
    const next = { ...DEFAULT_PREFS, ui: { ...DEFAULT_PREFS.ui, theme: 'dark' as const } }
    savePrefs(next, (k, v) => { store[k] = v })
    expect(store['wraith.prefs']).toBeTruthy()
    expect(loadPrefs((k) => store[k] ?? null)).toEqual(next)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run prefs`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 prefs.ts**

`desktop/src/renderer/settings/prefs.ts`:

```ts
export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentKey = 'teal' | 'indigo' | 'emerald' | 'rose' | 'amber'
export type FontSize = 'sm' | 'md' | 'lg'
export type FontFamily = 'system' | 'sans' | 'mono'

export interface UiPrefs { theme: ThemeMode; accent: AccentKey; fontSize: FontSize; fontFamily: FontFamily }
export interface ProfilePrefs { name: string; avatar: string }
export interface UpdatePrefs { autoCheck: boolean; beta: boolean }
export interface Prefs { profile: ProfilePrefs; ui: UiPrefs; update: UpdatePrefs }

export const DEFAULT_PREFS: Prefs = {
  profile: { name: '我', avatar: '' },
  ui: { theme: 'system', accent: 'teal', fontSize: 'md', fontFamily: 'system' },
  update: { autoCheck: true, beta: false },
}

const KEY = 'wraith.prefs'
const THEMES: ThemeMode[] = ['system', 'light', 'dark']
const ACCENT_KEYS: AccentKey[] = ['teal', 'indigo', 'emerald', 'rose', 'amber']
const SIZES: FontSize[] = ['sm', 'md', 'lg']
const FAMILIES: FontFamily[] = ['system', 'sans', 'mono']

function oneOf<T>(v: unknown, allowed: T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt
}

export function loadPrefs(read: (k: string) => string | null = (k) => localStorage.getItem(k)): Prefs {
  let raw: unknown = {}
  try { const s = read(KEY); if (s) raw = JSON.parse(s) } catch { raw = {} }
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const prof = (p.profile && typeof p.profile === 'object' ? p.profile : {}) as Record<string, unknown>
  const ui = (p.ui && typeof p.ui === 'object' ? p.ui : {}) as Record<string, unknown>
  const upd = (p.update && typeof p.update === 'object' ? p.update : {}) as Record<string, unknown>
  return {
    profile: {
      name: typeof prof.name === 'string' && prof.name.trim() ? (prof.name as string) : DEFAULT_PREFS.profile.name,
      avatar: typeof prof.avatar === 'string' ? (prof.avatar as string) : '',
    },
    ui: {
      theme: oneOf(ui.theme, THEMES, DEFAULT_PREFS.ui.theme),
      accent: oneOf(ui.accent, ACCENT_KEYS, DEFAULT_PREFS.ui.accent),
      fontSize: oneOf(ui.fontSize, SIZES, DEFAULT_PREFS.ui.fontSize),
      fontFamily: oneOf(ui.fontFamily, FAMILIES, DEFAULT_PREFS.ui.fontFamily),
    },
    update: {
      autoCheck: typeof upd.autoCheck === 'boolean' ? (upd.autoCheck as boolean) : DEFAULT_PREFS.update.autoCheck,
      beta: typeof upd.beta === 'boolean' ? (upd.beta as boolean) : DEFAULT_PREFS.update.beta,
    },
  }
}

export function savePrefs(prefs: Prefs, write: (k: string, v: string) => void = (k, v) => localStorage.setItem(k, v)): void {
  try { write(KEY, JSON.stringify(prefs)) } catch { /* 忽略配额/序列化失败 */ }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run prefs`
Expected: PASS(全部用例)。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/settings/prefs.ts desktop/test/prefs.test.ts
git commit -m "feat(desktop): 偏好中枢 prefs(类型/默认/容错读写)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 2: 主题引擎 theme.ts + 深色调色板

**Files:**
- Create: `desktop/src/renderer/settings/theme.ts`
- Modify: `desktop/src/renderer/styles/tokens.css`
- Test: `desktop/test/theme.test.ts`

**Interfaces:**
- Consumes: `UiPrefs`/`AccentKey`(Task 1)。
- Produces: `ACCENTS: Record<AccentKey,{label:string;value:string}>`;`ResolvedTheme {dataTheme:'light'|'dark'; vars:Record<string,string>}`;`resolveThemeVars(ui, systemDark): ResolvedTheme`;`applyTheme(ui, systemDark): void`;`prefersDark(): boolean`。

- [ ] **Step 1: 写失败测试**

`desktop/test/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveThemeVars, ACCENTS } from '../src/renderer/settings/theme'
import type { UiPrefs } from '../src/renderer/settings/prefs'

const base: UiPrefs = { theme: 'system', accent: 'teal', fontSize: 'md', fontFamily: 'system' }

describe('resolveThemeVars', () => {
  it('system 跟随 systemDark', () => {
    expect(resolveThemeVars(base, true).dataTheme).toBe('dark')
    expect(resolveThemeVars(base, false).dataTheme).toBe('light')
  })
  it('显式 light/dark 忽略 systemDark', () => {
    expect(resolveThemeVars({ ...base, theme: 'light' }, true).dataTheme).toBe('light')
    expect(resolveThemeVars({ ...base, theme: 'dark' }, false).dataTheme).toBe('dark')
  })
  it('强调色映射为 hex', () => {
    expect(resolveThemeVars({ ...base, accent: 'rose' }, false).vars['--accent']).toBe(ACCENTS.rose.value)
  })
  it('字号映射为 scale', () => {
    expect(resolveThemeVars({ ...base, fontSize: 'sm' }, false).vars['--font-scale']).toBe('0.925')
    expect(resolveThemeVars({ ...base, fontSize: 'lg' }, false).vars['--font-scale']).toBe('1.075')
  })
  it('字体映射为字体栈(mono 含 JetBrains Mono)', () => {
    expect(resolveThemeVars({ ...base, fontFamily: 'mono' }, false).vars['--font-sans']).toContain('JetBrains Mono')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run theme`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 theme.ts**

`desktop/src/renderer/settings/theme.ts`:

```ts
import type { UiPrefs, AccentKey } from './prefs'

export const ACCENTS: Record<AccentKey, { label: string; value: string }> = {
  teal: { label: '青', value: '#0ea5b7' },
  indigo: { label: '靛', value: '#6366f1' },
  emerald: { label: '绿', value: '#10b981' },
  rose: { label: '玫红', value: '#f43f5e' },
  amber: { label: '琥珀', value: '#f59e0b' },
}

const FONT_SCALE: Record<UiPrefs['fontSize'], string> = { sm: '0.925', md: '1', lg: '1.075' }
const FONT_SANS: Record<UiPrefs['fontFamily'], string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  sans: 'Inter, "Helvetica Neue", Arial, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
}

export interface ResolvedTheme { dataTheme: 'light' | 'dark'; vars: Record<string, string> }

export function resolveThemeVars(ui: UiPrefs, systemDark: boolean): ResolvedTheme {
  const dataTheme = ui.theme === 'system' ? (systemDark ? 'dark' : 'light') : ui.theme
  return {
    dataTheme,
    vars: {
      '--accent': ACCENTS[ui.accent].value,
      '--font-scale': FONT_SCALE[ui.fontSize],
      '--font-sans': FONT_SANS[ui.fontFamily],
    },
  }
}

export function applyTheme(ui: UiPrefs, systemDark: boolean): void {
  const { dataTheme, vars } = resolveThemeVars(ui, systemDark)
  const root = document.documentElement
  root.dataset.theme = dataTheme
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}
```

- [ ] **Step 4: 改 tokens.css(加深色调色板 + 字号缩放)**

在 `desktop/src/renderer/styles/tokens.css` 的 `:root { ... }` 块内末尾(`--font-mono` 行之后、`}` 之前)加一行:

```css
  --font-scale: 1;
```

在 `:root { ... }` 闭合 `}` 之后、`html, body, #root { height: 100%; }` 之前,插入深色调色板:

```css
[data-theme="dark"] {
  --bg: #0f1419;
  --bg-elevated: #161b22;
  --bg-sidebar-from: #12171e;
  --bg-sidebar-to: #0d1117;
  --fg: #e6edf3;
  --fg-muted: #9aa7b4;
  --fg-subtle: #6b7684;
  --border: #2b3138;
  --accent-fg: #ffffff;
  --danger: #f0645a;
  --warn: #e8a13c;
  --ok: #3fb984;
}
```

把 `html, body, #root { height: 100%; }` 这行改为(加根字号缩放):

```css
html, body, #root { height: 100%; }
html { font-size: calc(16px * var(--font-scale, 1)); }
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run theme`
Expected: PASS(全部用例)。

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: 0 error。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/settings/theme.ts desktop/src/renderer/styles/tokens.css desktop/test/theme.test.ts
git commit -m "feat(desktop): 主题引擎(resolveThemeVars/applyTheme)+ 深色调色板 + 字号缩放

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 3: SettingsContext + main.tsx 接线

**Files:**
- Create: `desktop/src/renderer/settings/SettingsContext.tsx`
- Modify: `desktop/src/renderer/main.tsx`

**Interfaces:**
- Consumes: `Prefs`/`ProfilePrefs`/`UiPrefs`/`UpdatePrefs`/`loadPrefs`/`savePrefs`(Task 1);`applyTheme`/`prefersDark`(Task 2)。
- Produces: `SettingsProvider`(组件);`useSettings(): { prefs: Prefs; setProfile(patch); setUi(patch); setUpdate(patch) }`。

- [ ] **Step 1: 实现 SettingsContext.tsx**

`desktop/src/renderer/settings/SettingsContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { type Prefs, type ProfilePrefs, type UiPrefs, type UpdatePrefs, loadPrefs, savePrefs } from './prefs'
import { applyTheme, prefersDark } from './theme'

interface SettingsCtx {
  prefs: Prefs
  setProfile: (patch: Partial<ProfilePrefs>) => void
  setUi: (patch: Partial<UiPrefs>) => void
  setUpdate: (patch: Partial<UpdatePrefs>) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const systemDark = useRef(prefersDark())
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  // 挂载即按当前偏好上主题(与 main.tsx 早期 apply 幂等)
  useEffect(() => { applyTheme(prefsRef.current.ui, systemDark.current) }, [])

  // theme=system 时跟随系统深浅色切换
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => { systemDark.current = mq.matches; applyTheme(prefsRef.current.ui, systemDark.current) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const persist = (next: Prefs): void => { setPrefs(next); savePrefs(next); applyTheme(next.ui, systemDark.current) }
  const setProfile = (patch: Partial<ProfilePrefs>): void => persist({ ...prefsRef.current, profile: { ...prefsRef.current.profile, ...patch } })
  const setUi = (patch: Partial<UiPrefs>): void => persist({ ...prefsRef.current, ui: { ...prefsRef.current.ui, ...patch } })
  const setUpdate = (patch: Partial<UpdatePrefs>): void => persist({ ...prefsRef.current, update: { ...prefsRef.current.update, ...patch } })

  return <Ctx.Provider value={{ prefs, setProfile, setUi, setUpdate }}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSettings must be used within SettingsProvider')
  return c
}
```

- [ ] **Step 2: 改 main.tsx(早期 applyTheme 防闪 + 包 Provider)**

`desktop/src/renderer/main.tsx` 整文件替换为:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import App from './App'
import { SettingsProvider } from './settings/SettingsContext'
import { loadPrefs } from './settings/prefs'
import { applyTheme, prefersDark } from './settings/theme'

// FOUC 防闪:渲染前按已存偏好先上主题
applyTheme(loadPrefs().ui, prefersDark())

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>
)
```

- [ ] **Step 3: typecheck**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck`
Expected: 0 error。

- [ ] **Step 4: build(确认 app 仍能构建渲染)**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/settings/SettingsContext.tsx desktop/src/renderer/main.tsx
git commit -m "feat(desktop): SettingsProvider 状态中枢 + 首屏防闪接线

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 4: 聊天消息重设计(chatIdentity + AgentMessage + UserMessage + Transcript)

**Files:**
- Create: `desktop/src/renderer/lib/chatIdentity.ts`
- Create: `desktop/src/renderer/components/AgentMessage.tsx`
- Modify: `desktop/src/renderer/components/UserMessage.tsx`
- Modify: `desktop/src/renderer/components/Transcript.tsx`
- Test: `desktop/test/chatIdentity.test.ts`

**Interfaces:**
- Consumes: `ProfilePrefs`(Task 1);`useSettings`(Task 3)。
- Produces: `userAvatarGlyph(profile: ProfilePrefs): string`;`<AgentMessage text={string} />`。

- [ ] **Step 1: 写失败测试**

`desktop/test/chatIdentity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { userAvatarGlyph } from '../src/renderer/lib/chatIdentity'

describe('userAvatarGlyph', () => {
  it('有 avatar(emoji)优先取首个 code point', () => {
    expect(userAvatarGlyph({ name: '阿豪', avatar: '🦊' })).toBe('🦊')
  })
  it('avatar 空则取昵称首字符', () => {
    expect(userAvatarGlyph({ name: 'Lyhn', avatar: '' })).toBe('L')
  })
  it('avatar 与昵称皆空 → 我', () => {
    expect(userAvatarGlyph({ name: '   ', avatar: '  ' })).toBe('我')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run chatIdentity`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 chatIdentity.ts**

`desktop/src/renderer/lib/chatIdentity.ts`:

```ts
import type { ProfilePrefs } from '../settings/prefs'

/** 用户头像字形:优先 avatar(emoji/字符)首个 code point,否则昵称首字符,再否则 '我'。 */
export function userAvatarGlyph(profile: ProfilePrefs): string {
  const a = profile.avatar.trim()
  if (a) return [...a][0]
  const n = profile.name.trim()
  if (n) return [...n][0]
  return '我'
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run chatIdentity`
Expected: PASS。

- [ ] **Step 5: 新建 AgentMessage.tsx**

`desktop/src/renderer/components/AgentMessage.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'

/** Agent 消息:左侧固定「👻 Wraith」头像+名字,右侧全宽 markdown 正文。 */
export default function AgentMessage({ text }: { text: string }): JSX.Element {
  return (
    <div data-testid="agent-msg" className="flex gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent text-[13px] text-accent-fg" aria-hidden>👻</div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] font-semibold text-fg-muted">Wraith</div>
        <div className="text-sm leading-7 text-fg [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface [&_pre]:p-3">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
```

> 注:pre 代码块背景从原来的 `bg-black/[0.04]`(深色主题下几乎不可见)改为 `bg-surface + border-border`,浅/深两主题都清晰。

- [ ] **Step 6: 改 UserMessage.tsx(右气泡加 profile 头像)**

在 `desktop/src/renderer/components/UserMessage.tsx` 顶部 `import { useState } from 'react'` 之后加两行 import:

```tsx
import { useSettings } from '../settings/SettingsContext'
import { userAvatarGlyph } from '../lib/chatIdentity'
```

在函数体开头(`const [editing, setEditing] = useState(false)` 之前)加:

```tsx
  const { prefs } = useSettings()
  const glyph = userAvatarGlyph(prefs.profile)
```

把非编辑态 return 的最外层(现为 `<div className="group flex items-center justify-end gap-1.5 self-end max-w-[85%]">`)内、气泡 `<div data-testid="user-msg" ...>{text}</div>` **之后**追加一个头像块(作为该 flex 行的最后一个子元素):

```tsx
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-[12px] font-medium text-fg" aria-hidden>{glyph}</div>
```

(编辑态分支不变;`bg-accent/15` 与既有 `bg-accent/10` 同为 token 透明度修饰,已验可用。)

- [ ] **Step 7: 改 Transcript.tsx(message 分支改用 AgentMessage)**

在 `desktop/src/renderer/components/Transcript.tsx` 顶部 import 区,`import UserMessage from './UserMessage'` 之后加:

```tsx
import AgentMessage from './AgentMessage'
```

把 `item.type === 'message'` 分支(现为):

```tsx
        if (item.type === 'message') {
          return (
            <div key={idx} className="text-sm leading-7 text-fg [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/[0.04] [&_pre]:p-3">
              <ReactMarkdown>{item.text}</ReactMarkdown>
            </div>
          )
        }
```

替换为:

```tsx
        if (item.type === 'message') {
          return <AgentMessage key={idx} text={item.text} />
        }
```

若替换后 `ReactMarkdown` 在 Transcript 内不再被引用,删除其 `import ReactMarkdown from 'react-markdown'` 顶部导入(typecheck 的 `noUnusedLocals` 会报)。

- [ ] **Step 8: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 error;build 成功。

- [ ] **Step 9: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/lib/chatIdentity.ts desktop/src/renderer/components/AgentMessage.tsx desktop/src/renderer/components/UserMessage.tsx desktop/src/renderer/components/Transcript.tsx desktop/test/chatIdentity.test.ts
git commit -m "feat(desktop): 聊天消息非对称重设计(Agent 头像名字 + 用户头像)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 5: 更新检查后端(updateCheck + IPC + 桥 + 类型)

**Files:**
- Create: `desktop/src/main/updateCheck.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/shared/types.ts`
- Test: `desktop/test/updateCheck.test.ts`

**Interfaces:**
- Produces(main):`GhRelease {tag_name;html_url;draft;prerelease}`;`semverCompare(a,b): number`;`computeUpdate(current, releases, includeBeta): UpdateResult`。
- Produces(types/桥):`AppInfo {version:string; repoUrl:string; dataDir:string}`;`UpdateResult {current:string; latest:string|null; hasUpdate:boolean; url:string|null; isPrerelease:boolean; error?:string}`;`WraithApi.appInfo()/checkUpdate(beta)/openExternal(url)/openPath(path)`。

- [ ] **Step 1: 写失败测试**

`desktop/test/updateCheck.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeUpdate, semverCompare } from '../src/main/updateCheck'

const rel = (tag: string, prerelease = false, draft = false) =>
  ({ tag_name: tag, html_url: `https://x/${tag}`, prerelease, draft })

describe('semverCompare', () => {
  it('数值比较,忽略 v 前缀', () => {
    expect(semverCompare('v1.2.0', '1.1.9')).toBe(1)
    expect(semverCompare('1.0.0', '1.0.0')).toBe(0)
    expect(semverCompare('0.9.0', '0.10.0')).toBe(-1)
  })
})

describe('computeUpdate', () => {
  it('有更高稳定版 → hasUpdate + url', () => {
    const r = computeUpdate('0.1.0', [rel('v0.1.0'), rel('v0.2.0')], false)
    expect(r.latest).toBe('0.2.0'); expect(r.hasUpdate).toBe(true); expect(r.url).toBe('https://x/v0.2.0')
  })
  it('仅 prerelease 且 beta 关 → 无更新', () => {
    const r = computeUpdate('0.1.0', [rel('v0.2.0', true)], false)
    expect(r.latest).toBeNull(); expect(r.hasUpdate).toBe(false)
  })
  it('beta 开 → 纳入 prerelease', () => {
    const r = computeUpdate('0.1.0', [rel('v0.2.0-beta.1', true)], true)
    expect(r.latest).toBe('0.2.0'); expect(r.hasUpdate).toBe(true); expect(r.isPrerelease).toBe(true)
  })
  it('draft 恒过滤', () => {
    const r = computeUpdate('0.1.0', [rel('v9.9.9', false, true)], true)
    expect(r.latest).toBeNull()
  })
  it('已是最新 → 无更新', () => {
    expect(computeUpdate('0.2.0', [rel('v0.2.0')], false).hasUpdate).toBe(false)
  })
  it('空列表 → latest null', () => {
    expect(computeUpdate('0.1.0', [], false).latest).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run updateCheck`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 updateCheck.ts**

`desktop/src/main/updateCheck.ts`:

```ts
export interface GhRelease { tag_name: string; html_url: string; draft: boolean; prerelease: boolean }
export interface UpdateResult {
  current: string
  latest: string | null
  hasUpdate: boolean
  url: string | null
  isPrerelease: boolean
  error?: string
}

/** 极简 semver 比较:a>b→1,a<b→-1,相等→0。去 v 前缀、按 x.y.z 数值,忽略预发标记的细粒度排序。 */
export function semverCompare(a: string, b: string): number {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d !== 0) return d > 0 ? 1 : -1 }
  return 0
}

export function computeUpdate(current: string, releases: GhRelease[], includeBeta: boolean): UpdateResult {
  const usable = (releases || []).filter(
    (r) => r && !r.draft && (includeBeta || !r.prerelease) && typeof r.tag_name === 'string',
  )
  let best: GhRelease | null = null
  for (const r of usable) if (!best || semverCompare(r.tag_name, best.tag_name) > 0) best = r
  const latest = best ? best.tag_name.replace(/^v/, '') : null
  const hasUpdate = !!latest && semverCompare(latest, current) > 0
  return { current, latest, hasUpdate, url: best ? best.html_url : null, isPrerelease: !!best && best.prerelease }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run updateCheck`
Expected: PASS。

- [ ] **Step 5: 加类型(shared/types.ts)**

在 `desktop/src/shared/types.ts` 末尾追加:

```ts
export interface AppInfo { version: string; repoUrl: string; dataDir: string }
export interface UpdateResult {
  current: string
  latest: string | null
  hasUpdate: boolean
  url: string | null
  isPrerelease: boolean
  error?: string
}
```

- [ ] **Step 6: 加 IPC(main/index.ts)**

在 `desktop/src/main/index.ts` 顶部 import 区,`import { resolveBackendCommand, defaultJarPath } from './backend'` 之后加:

```ts
import { computeUpdate, type GhRelease } from './updateCheck'
```

在文件中任一 `ipcMain.handle(...)` 群组附近(与其它 `wraith:*` handler 同级)追加 4 个 handler:

```ts
ipcMain.handle('wraith:appInfo', () => ({
  version: app.getVersion(),
  repoUrl: 'https://github.com/JavaLyHn/wraith',
  dataDir: path.join(os.homedir(), '.wraith'),
}))

ipcMain.handle('wraith:checkUpdate', async (_e, beta: boolean) => {
  const current = app.getVersion()
  try {
    const res = await fetch('https://api.github.com/repos/JavaLyHn/wraith/releases', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wraith-desktop' },
    })
    if (!res.ok) return { current, latest: null, hasUpdate: false, url: null, isPrerelease: false, error: `HTTP ${res.status}` }
    const releases = (await res.json()) as GhRelease[]
    return computeUpdate(current, releases, !!beta)
  } catch (e) {
    return { current, latest: null, hasUpdate: false, url: null, isPrerelease: false, error: (e as Error).message }
  }
})

ipcMain.handle('wraith:openExternal', (_e, url: string) => { void shell.openExternal(url) })
ipcMain.handle('wraith:openPath', (_e, p: string) => shell.openPath(p))
```

(`app`/`shell`/`os`/`path` 均已在 main/index.ts 顶部 import;主进程为 Node 20,`fetch` 为全局。)

- [ ] **Step 7: 加桥(preload/index.ts)**

`desktop/src/preload/index.ts` 顶部第 2 行的 `import type { ... } from '../shared/types'` 末尾追加 `AppInfo, UpdateResult`。

WraithApi 接口内追加(与既有方法同级):

```ts
  appInfo(): Promise<AppInfo>
  checkUpdate(beta: boolean): Promise<UpdateResult>
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
```

暴露对象内追加:

```ts
  appInfo() {
    return ipcRenderer.invoke('wraith:appInfo') as Promise<AppInfo>
  },
  checkUpdate(beta) {
    return ipcRenderer.invoke('wraith:checkUpdate', beta) as Promise<UpdateResult>
  },
  openExternal(url) {
    return ipcRenderer.invoke('wraith:openExternal', url) as Promise<void>
  },
  openPath(path) {
    return ipcRenderer.invoke('wraith:openPath', path) as Promise<void>
  },
```

- [ ] **Step 8: typecheck**

Run: `npm run typecheck`
Expected: 0 error。

- [ ] **Step 9: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/updateCheck.ts desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/shared/types.ts desktop/test/updateCheck.test.ts
git commit -m "feat(desktop): 更新检查后端(computeUpdate + appInfo/checkUpdate/openExternal/openPath 桥)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 6: 设置面板外壳 + 侧栏入口 + 界面分区

**Files:**
- Create: `desktop/src/renderer/components/SettingsPanel.tsx`
- Create: `desktop/src/renderer/components/SettingsInterface.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `useSettings`(Task 3);`ACCENTS`(Task 2);`UiPrefs` 字段值(Task 1)。
- Produces: `<SettingsPanel onBack={()=>void} onOpenProviders={()=>void} />`;`SettingsInterface`;`Sidebar` 新增 prop `onOpenSettings: () => void`;`App` view union 加 `'settings'`。
- 注:`SettingsMe`(Task 7)/`SettingsAbout`(Task 8)本任务内先以极简占位(仅标题),Task 7/8 再填实现——`SettingsPanel` 的 `active` 路由三分区都要能切。

- [ ] **Step 1: 新建 SettingsInterface.tsx**

`desktop/src/renderer/components/SettingsInterface.tsx`:

```tsx
import { useSettings } from '../settings/SettingsContext'
import { ACCENTS } from '../settings/theme'
import type { AccentKey, FontSize, FontFamily, ThemeMode } from '../settings/prefs'

const THEME_OPTS: { key: ThemeMode; label: string; prev: string }[] = [
  { key: 'system', label: '系统', prev: 'linear-gradient(90deg,#f7f8fa 50%,#0f1419 50%)' },
  { key: 'light', label: '浅色', prev: '#f7f8fa' },
  { key: 'dark', label: '深色', prev: '#0f1419' },
]
const SIZE_OPTS: { key: FontSize; label: string }[] = [{ key: 'sm', label: '小' }, { key: 'md', label: '中' }, { key: 'lg', label: '大' }]
const FAMILY_OPTS: { key: FontFamily; label: string }[] = [{ key: 'system', label: '系统' }, { key: 'sans', label: '无衬线' }, { key: 'mono', label: '等宽' }]

export default function SettingsInterface(): JSX.Element {
  const { prefs, setUi } = useSettings()
  const ui = prefs.ui
  const lbl = 'mb-2 text-[10px] uppercase tracking-wider text-fg-subtle'
  const seg = 'inline-flex overflow-hidden rounded-lg border border-border'
  const segItem = (on: boolean): string =>
    'px-3 py-1.5 text-xs ' + (on ? 'bg-accent/15 font-semibold text-accent' : 'text-fg-muted hover:bg-surface')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className={lbl}>主题</div>
        <div className="flex gap-2">
          {THEME_OPTS.map((t) => (
            <button key={t.key} data-testid={`theme-${t.key}`} onClick={() => setUi({ theme: t.key })}
              className={'w-24 overflow-hidden rounded-lg border text-center ' + (ui.theme === t.key ? 'border-accent' : 'border-border')}>
              <div style={{ height: 34, background: t.prev }} />
              <div className="py-1 text-[11px] text-fg-muted">{t.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={lbl}>强调色</div>
        <div className="flex gap-2.5">
          {(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
            <button key={k} data-testid={`accent-${k}`} title={ACCENTS[k].label} onClick={() => setUi({ accent: k })}
              aria-label={ACCENTS[k].label}
              className={'h-6 w-6 rounded-full ' + (ui.accent === k ? 'ring-2 ring-offset-2 ring-offset-bg' : '')}
              style={{ background: ACCENTS[k].value, boxShadow: ui.accent === k ? `0 0 0 2px ${ACCENTS[k].value}` : 'inset 0 0 0 1px var(--border)' }} />
          ))}
        </div>
      </div>

      <div>
        <div className={lbl}>字号</div>
        <div className={seg}>
          {SIZE_OPTS.map((s) => (
            <button key={s.key} data-testid={`size-${s.key}`} onClick={() => setUi({ fontSize: s.key })}
              className={segItem(ui.fontSize === s.key) + ' border-r border-border last:border-r-0'}>{s.label}</button>
          ))}
        </div>
      </div>

      <div>
        <div className={lbl}>字体</div>
        <div className={seg}>
          {FAMILY_OPTS.map((f) => (
            <button key={f.key} data-testid={`family-${f.key}`} onClick={() => setUi({ fontFamily: f.key })}
              className={segItem(ui.fontFamily === f.key) + ' border-r border-border last:border-r-0'}>{f.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 新建 SettingsPanel.tsx(外壳 + 左导航 + 路由;我/关于 先占位)**

`desktop/src/renderer/components/SettingsPanel.tsx`:

```tsx
import { useState } from 'react'
import SettingsInterface from './SettingsInterface'

type Section = 'me' | 'interface' | 'about'
const NAV: { key: Section; label: string }[] = [
  { key: 'me', label: '👤 我' },
  { key: 'interface', label: '🎨 界面' },
  { key: 'about', label: 'ℹ️ 关于' },
]

export default function SettingsPanel({ onBack, onOpenProviders }: { onBack: () => void; onOpenProviders: () => void }): JSX.Element {
  const [active, setActive] = useState<Section>('interface')
  void onOpenProviders // Task 7 (SettingsMe) 使用

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="settings-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">设置</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-36 shrink-0 border-r border-border p-2">
          {NAV.map((n) => (
            <button key={n.key} data-testid={`settings-nav-${n.key}`} onClick={() => setActive(n.key)}
              className={'mb-1 block w-full rounded-lg px-3 py-2 text-left text-xs ' +
                (active === n.key ? 'bg-accent/12 font-semibold text-accent' : 'text-fg-muted hover:bg-surface')}>
              {n.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {active === 'interface' && <SettingsInterface />}
          {active === 'me' && <div className="text-xs text-fg-subtle">(我 — Task 7)</div>}
          {active === 'about' && <div className="text-xs text-fg-subtle">(关于 — Task 8)</div>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 改 Sidebar.tsx(footer 加 ⚙ 设置入口)**

在 `SidebarProps` 的 `onOpenSkills: () => void` 之后加:

```tsx
  onOpenSettings: () => void
```

在 `export default function Sidebar({ ... onOpenSkills,` 解构参数中,`onOpenSkills,` 之后加:

```tsx
  onOpenSettings,
```

在 footer 区(`{/* footer: sandbox badge */}` 那个 `<div className="border-t border-border px-3 py-3">` 内、sandbox 徽标 `<div data-testid="sandbox-badge" ...>` **之前**)插入设置按钮:

```tsx
          <button
            data-testid="nav-settings"
            onClick={onOpenSettings}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-muted hover:bg-surface hover:text-accent"
          >
            <span aria-hidden>⚙</span><span>设置</span>
          </button>
```

- [ ] **Step 4: 改 App.tsx(view 'settings' + Sidebar prop + 面板分支)**

`desktop/src/renderer/App.tsx` 第 129 行 view union 加 `'settings'`:

```tsx
  const [view, setView] = useState<'chat' | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'settings'>('chat')
```

`<Sidebar>` 用法中 `onOpenSkills={() => setView('skills')}` 之后加:

```tsx
        onOpenSettings={() => setView('settings')}
```

面板分支链中,`) : view === 'skills' ? (\n  <SkillsPanel onBack={() => setView('chat')} />` 之后加一个分支:

```tsx
        ) : view === 'settings' ? (
          <SettingsPanel onBack={() => setView('chat')} onOpenProviders={() => setView('providers')} />
```

并在 App.tsx 顶部 import 区加:

```tsx
import SettingsPanel from './components/SettingsPanel'
```

- [ ] **Step 5: typecheck + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build`
Expected: 0 error;build 成功。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/SettingsPanel.tsx desktop/src/renderer/components/SettingsInterface.tsx desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(desktop): 设置面板外壳 + 侧栏 ⚙ 入口 + 界面分区(主题/强调色/字号/字体)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 7: 我 分区(SettingsMe)

**Files:**
- Create: `desktop/src/renderer/components/SettingsMe.tsx`
- Modify: `desktop/src/renderer/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `useSettings`(Task 3);`userAvatarGlyph`(Task 4);`window.wraith.appInfo`/`openPath`(Task 5);既有 `window.wraith.modelList()`(返回 `ModelListResult`);`SettingsPanel` 的 `onOpenProviders`(Task 6)。
- Produces: `<SettingsMe onOpenProviders={()=>void} />`。

- [ ] **Step 1: 新建 SettingsMe.tsx**

`desktop/src/renderer/components/SettingsMe.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useSettings } from '../settings/SettingsContext'
import { userAvatarGlyph } from '../lib/chatIdentity'

export default function SettingsMe({ onOpenProviders }: { onOpenProviders: () => void }): JSX.Element {
  const { prefs, setProfile } = useSettings()
  const [dataDir, setDataDir] = useState('~/.wraith')
  const [model, setModel] = useState<string>('—')

  useEffect(() => {
    void window.wraith.appInfo().then((i) => setDataDir(i.dataDir)).catch(() => {})
    void window.wraith.modelList().then((r) => setModel(r.current || r.models?.[0]?.id || '—')).catch(() => {})
  }, [])

  const lbl = 'mb-2 text-[10px] uppercase tracking-wider text-fg-subtle'
  const input = 'w-full rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent'
  const row = 'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs'

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-xl text-fg">{userAvatarGlyph(prefs.profile)}</div>
        <div className="flex-1">
          <div className={lbl}>昵称(聊天里"我"的显示名)</div>
          <input data-testid="me-name" className={input} value={prefs.profile.name}
            onChange={(e) => setProfile({ name: e.target.value })} placeholder="我" />
        </div>
      </div>

      <div>
        <div className={lbl}>头像(一个 emoji 或字符;留空则用昵称首字)</div>
        <input data-testid="me-avatar" className={input + ' max-w-[120px]'} value={prefs.profile.avatar}
          onChange={(e) => setProfile({ avatar: e.target.value })} placeholder="🦊" />
      </div>

      <div>
        <div className={lbl}>配置速览</div>
        <div className="flex flex-col gap-2">
          <div className={row}><span className="text-fg-muted">当前模型</span><span className="truncate text-fg">{model}</span></div>
          <div className={row}>
            <span className="text-fg-muted">数据目录</span>
            <span className="flex items-center gap-2">
              <span className="truncate text-fg-subtle">{dataDir}</span>
              <button data-testid="me-open-dir" onClick={() => void window.wraith.openPath(dataDir)}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-accent">打开</button>
            </span>
          </div>
          <button data-testid="me-manage-providers" onClick={onOpenProviders}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent">管理 Provider →</button>
        </div>
      </div>
    </div>
  )
}
```

> `window.wraith.modelList()` 返回的 `ModelListResult`:实现时按其真实字段取"当前模型"名——若无 `current` 字段,取 `models[0]?.id` 或结果里表示当前的字段。实现前先在 `desktop/src/shared/types.ts` 查 `ModelListResult` 定义,用其真实字段名(上面的 `r.current || r.models?.[0]?.id` 为示意,以真实结构为准;取不到用 '—')。

- [ ] **Step 2: 接进 SettingsPanel(替换 me 占位)**

`desktop/src/renderer/components/SettingsPanel.tsx`:顶部 import 加 `import SettingsMe from './SettingsMe'`;删除 `void onOpenProviders` 那行;把 `{active === 'me' && <div className="text-xs text-fg-subtle">(我 — Task 7)</div>}` 换成:

```tsx
          {active === 'me' && <SettingsMe onOpenProviders={onOpenProviders} />}
```

- [ ] **Step 3: typecheck + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build`
Expected: 0 error;build 成功。

- [ ] **Step 4: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/SettingsMe.tsx desktop/src/renderer/components/SettingsPanel.tsx
git commit -m "feat(desktop): 设置-我 分区(昵称/头像 + 配置速览)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 8: 关于 分区 + 更新提示条 + LICENSE

**Files:**
- Create: `desktop/src/renderer/components/SettingsAbout.tsx`
- Create: `LICENSE`(仓库根)
- Modify: `desktop/src/renderer/components/SettingsPanel.tsx`
- Modify: `desktop/src/renderer/App.tsx`

**Interfaces:**
- Consumes: `useSettings`(update prefs,Task 3);`window.wraith.appInfo/checkUpdate/openExternal`(Task 5);`UpdateResult`/`AppInfo`(Task 5 类型)。
- Produces: `<SettingsAbout />`;App 顶部更新提示条(autoCheck 命中时)。

- [ ] **Step 1: 新建 LICENSE(仓库根)**

`LICENSE`(标准 MIT,版权行如下):

```
MIT License

Copyright (c) 2026 LyHn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: 新建 SettingsAbout.tsx**

`desktop/src/renderer/components/SettingsAbout.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useSettings } from '../settings/SettingsContext'
import type { AppInfo, UpdateResult } from '../../shared/types'

export default function SettingsAbout(): JSX.Element {
  const { prefs, setUpdate } = useSettings()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateResult | null>(null)

  useEffect(() => { void window.wraith.appInfo().then(setInfo).catch(() => {}) }, [])

  const check = async (): Promise<void> => {
    setChecking(true)
    try { setResult(await window.wraith.checkUpdate(prefs.update.beta)) }
    catch (e) { setResult({ current: info?.version ?? '', latest: null, hasUpdate: false, url: null, isPrerelease: false, error: (e as Error).message }) }
    finally { setChecking(false) }
  }

  const lbl = 'mb-2 text-[10px] uppercase tracking-wider text-fg-subtle'
  const row = 'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs'
  const toggle = (on: boolean): string =>
    'relative h-5 w-9 rounded-full transition-colors ' + (on ? 'bg-accent' : 'bg-border')
  const knob = (on: boolean): string =>
    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ' + (on ? 'translate-x-4' : 'translate-x-0.5')

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-2xl text-accent-fg" aria-hidden>👻</div>
        <div>
          <div className="text-sm font-bold text-fg">Wraith</div>
          <div className="text-xs text-fg-subtle">版本 {info?.version ?? '—'} · MIT License</div>
        </div>
      </div>

      <div>
        <div className={lbl}>信息</div>
        <div className="flex flex-col gap-2">
          <div className={row}><span className="text-fg-muted">版权</span><span className="text-fg">© 2026 LyHn</span></div>
          <div className={row}><span className="text-fg-muted">许可证</span><span className="text-fg">MIT License</span></div>
          <button data-testid="about-github" onClick={() => info && void window.wraith.openExternal(info.repoUrl)}
            className={row + ' hover:border-accent'}><span className="text-fg-muted">GitHub</span><span className="text-accent">↗ 打开仓库</span></button>
        </div>
      </div>

      <div>
        <div className={lbl}>更新</div>
        <div className="flex flex-col gap-2">
          <div className={row}>
            <span className="text-fg-muted">启动时自动检查更新</span>
            <button data-testid="about-autocheck" aria-label="自动检查更新" onClick={() => setUpdate({ autoCheck: !prefs.update.autoCheck })}
              className={toggle(prefs.update.autoCheck)}><span className={knob(prefs.update.autoCheck)} /></button>
          </div>
          <div className={row}>
            <span className="text-fg-muted">接受测试版更新</span>
            <button data-testid="about-beta" aria-label="接受测试版更新" onClick={() => setUpdate({ beta: !prefs.update.beta })}
              className={toggle(prefs.update.beta)}><span className={knob(prefs.update.beta)} /></button>
          </div>
          <div className="flex items-center gap-3">
            <button data-testid="about-check" onClick={() => void check()} disabled={checking}
              className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50">
              {checking ? '检查中…' : '检查更新'}
            </button>
            {result && (
              <span className="text-xs">
                {result.error ? <span className="text-danger">检查失败:{result.error}</span>
                  : result.hasUpdate
                    ? <button className="text-accent" onClick={() => result.url && void window.wraith.openExternal(result.url)}>有新版 v{result.latest} · 打开下载 ↗</button>
                    : <span className="text-fg-subtle">已是最新(v{result.current})</span>}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 接进 SettingsPanel(替换 about 占位)**

`SettingsPanel.tsx`:顶部 import 加 `import SettingsAbout from './SettingsAbout'`;把 `{active === 'about' && <div className="text-xs text-fg-subtle">(关于 — Task 8)</div>}` 换成:

```tsx
          {active === 'about' && <SettingsAbout />}
```

- [ ] **Step 4: App.tsx 顶部更新提示条(autoCheck 命中时)**

在 `desktop/src/renderer/App.tsx`:
- 顶部 import 加:`import { useSettings } from './settings/SettingsContext'`。
- 组件体内(其它 useState 附近)加更新提示状态:

```tsx
  const { prefs: appPrefs } = useSettings()
  const [updateNotice, setUpdateNotice] = useState<{ latest: string; url: string } | null>(null)
```

- 加启动自动检查 effect(与其它 useEffect 同级):

```tsx
  useEffect(() => {
    if (!appPrefs.update.autoCheck) return
    void window.wraith.checkUpdate(appPrefs.update.beta)
      .then((r) => { if (r.hasUpdate && r.latest && r.url) setUpdateNotice({ latest: r.latest, url: r.url }) })
      .catch(() => {})
  }, [])  // 仅启动一次
```

- 在主区顶部 banner 群(`{submitError && (...)}` 之后)加提示条:

```tsx
        {updateNotice && (
          <div data-testid="update-banner" className="flex items-center gap-3 border-b border-border bg-accent/10 px-4 py-2 text-xs text-fg">
            <span>有新版 v{updateNotice.latest}</span>
            <button className="text-accent" onClick={() => void window.wraith.openExternal(updateNotice.url)}>打开下载 ↗</button>
            <button className="ml-auto text-fg-subtle hover:text-fg" onClick={() => setUpdateNotice(null)}>✕</button>
          </div>
        )}
```

- [ ] **Step 5: typecheck + vitest 全量 + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npx vitest run && npm run build`
Expected: 0 error;vitest 全绿(含 prefs/theme/chatIdentity/updateCheck 新测 + 既有);build 成功。

- [ ] **Step 6: 红线扫描 + 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add LICENSE desktop/src/renderer/components/SettingsAbout.tsx desktop/src/renderer/components/SettingsPanel.tsx desktop/src/renderer/App.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "红线:无命中"
git commit -m "feat(desktop): 设置-关于 分区 + 更新提示条 + MIT LICENSE

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

## 落地后手动验证(合并前,整重启桌面 app)

1. 全量重启桌面 app(preload 改动不热更)。
2. 眼验清单:
   - **聊天**:用户消息右侧气泡 + 右侧头像(昵称首字/emoji);Agent 消息左侧「👻 Wraith」头像+名字 + 全宽正文;代码块在深/浅两主题都清晰。
   - **设置入口**:侧栏左下角「⚙ 设置」→ 打开面板,左导航 我/界面/关于 可切。
   - **界面**:主题切浅/深/系统即时生效、无明显闪烁;强调色切换即时反映到气泡/按钮;字号小/中/大整体缩放;字体切换生效。刷新后保持(localStorage)。
   - **我**:改昵称/头像 → 立即反映到聊天"我"头像;当前模型显示;数据目录「打开」弹 Finder;「管理 Provider」跳转。
   - **关于**:版本号正确;GitHub「打开仓库」;两个开关持久;「检查更新」真连 GitHub(0.1.0 若无 release → 已是最新/检查失败均属正常);测试版开关影响结果。

## Self-Review

**1. Spec coverage** — spec 各节 → 任务:聊天重设计(§5)=T4;设置外壳+入口(§6)=T6;我(§3/§6)=T7;界面全套(§4/§6)=T2(引擎+深色)+T6(控件);关于+更新(§5/§6/§7)=T5(后端)+T8(UI+banner+LICENSE §9);状态中枢(§3)=T1+T3;测试(§10)分散各任务 TDD;触点(§11)全覆盖。无遗漏。

**2. Placeholder scan** — 无 TBD/TODO;每个改码步骤含完整代码;测试步骤含完整断言与预期输出。T7 对 `ModelListResult` 字段有"以真实结构为准"的指示(因该类型未在本计划定义),已给回落 '—' 兜底,非占位符而是显式的接口对齐要求。

**3. Type consistency** — `Prefs`/`UiPrefs`/`ProfilePrefs`/`AccentKey`/`ThemeMode`/`FontSize`/`FontFamily`(T1)→ T2/T3/T4/T6 一致引用;`resolveThemeVars/applyTheme/prefersDark/ACCENTS`(T2)→ T3/T6 一致;`useSettings`(prefs/setProfile/setUi/setUpdate)(T3)→ T4/T6/T7/T8 一致;`AppInfo`(version/repoUrl/dataDir)/`UpdateResult`(current/latest/hasUpdate/url/isPrerelease/error)(T5)→ T7/T8 一致;桥方法名 `appInfo/checkUpdate/openExternal/openPath` + IPC channel `wraith:appInfo` 等三处一致;`onOpenSettings`(Sidebar)/view `'settings'`(App)一致。通过。
