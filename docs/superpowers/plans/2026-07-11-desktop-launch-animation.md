# 桌面启动动画(幽灵浮现)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App 启动时弹出独立透明无边框窗,logo 以「幽灵浮现」淡入,覆盖后端初始化,就绪后散去并交接到主窗口。

**Architecture:** 纯函数 `shouldDismissSplash` 决定散去时机;`buildSplashHtml` 产出自包含 HTML(内联 CSS 动画 + base64 logo);`index.ts` 建一个 `transparent+frameless` splash 窗(loadURL data:)、主窗改 `show:false`、按后端 `connected` + 地板/天花板判定后交接。

**Tech Stack:** Electron + electron-vite;主进程 TypeScript(`desktop/src/main/`);vitest 单测纯函数。

## Global Constraints

- 主进程 TS 位于 `desktop/src/main/`;测试位于 `desktop/test/`,用 vitest(`npx vitest run <file>`)。
- 密钥红线:不涉及密钥;不打印敏感信息。
- splash 是 cosmetic,**绝不阻塞启动**:任何失败(创建/加载/logo)都必须回退到"直接显示主窗"。
- 纯 logo,无文字字标。
- 尊重 `prefers-reduced-motion`:降级为纯淡入淡出。
- 常量:地板 `1200ms`、天花板 `4000ms`、散去动画 `450ms`、窗尺寸 `320×320`。
- 改了主进程 TS,dev 下需**重启 `npm run dev`** 才生效(眼验前先重启)。

---

### Task 1: `shouldDismissSplash` 纯函数

**Files:**
- Create: `desktop/src/main/splash.ts`
- Test: `desktop/test/splash.test.ts`

**Interfaces:**
- Produces: `shouldDismissSplash(elapsedMs: number, connected: boolean, floorMs?: number, capMs?: number): boolean`;常量 `SPLASH_FLOOR_MS=1200`、`SPLASH_CAP_MS=4000`、`SPLASH_EXIT_MS=450`、`SPLASH_SIZE=320`。

- [ ] **Step 1: 写失败测试**

```ts
// desktop/test/splash.test.ts
import { describe, it, expect } from 'vitest'
import { shouldDismissSplash, SPLASH_FLOOR_MS, SPLASH_CAP_MS } from '../src/main/splash'

describe('shouldDismissSplash', () => {
  it('未到地板即便已就绪也不散', () => {
    expect(shouldDismissSplash(800, true)).toBe(false)
  })
  it('已就绪且过地板 → 散', () => {
    expect(shouldDismissSplash(SPLASH_FLOOR_MS, true)).toBe(true)
    expect(shouldDismissSplash(1500, true)).toBe(true)
  })
  it('未就绪、未到天花板 → 不散', () => {
    expect(shouldDismissSplash(3000, false)).toBe(false)
  })
  it('到天花板 → 强制散(即便未就绪)', () => {
    expect(shouldDismissSplash(SPLASH_CAP_MS, false)).toBe(true)
    expect(shouldDismissSplash(5000, false)).toBe(true)
  })
  it('自定义 floor/cap 生效', () => {
    expect(shouldDismissSplash(500, true, 400, 2000)).toBe(true)
    expect(shouldDismissSplash(300, true, 400, 2000)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/splash.test.ts`
Expected: FAIL(`shouldDismissSplash` 未定义 / 模块不存在)

- [ ] **Step 3: 写最小实现**

```ts
// desktop/src/main/splash.ts
export const SPLASH_FLOOR_MS = 1200
export const SPLASH_CAP_MS = 4000
export const SPLASH_EXIT_MS = 450
export const SPLASH_SIZE = 320

/** 是否可散去 splash:到天花板强制散;或已就绪且过地板。 */
export function shouldDismissSplash(
  elapsedMs: number,
  connected: boolean,
  floorMs: number = SPLASH_FLOOR_MS,
  capMs: number = SPLASH_CAP_MS,
): boolean {
  return elapsedMs >= capMs || (connected && elapsedMs >= floorMs)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/splash.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 5: 提交**

```bash
git add desktop/src/main/splash.ts desktop/test/splash.test.ts
git commit -m "feat(desktop/splash): shouldDismissSplash 散去时机纯函数 + 单测"
```

---

### Task 2: logo base64 + `buildSplashHtml` 自包含页

**Files:**
- Create: `desktop/src/main/splashLogo.ts`(自动生成的 base64 常量)
- Modify: `desktop/src/main/splash.ts`(追加 `buildSplashHtml`)
- Test: `desktop/test/splash.test.ts`(追加 `buildSplashHtml` 用例)

**Interfaces:**
- Consumes: 无
- Produces: `SPLASH_LOGO_DATA_URI: string`(来自 splashLogo.ts);`buildSplashHtml(logoDataUri: string): string`

- [ ] **Step 1: 生成 logo base64 常量**

Run(从 `desktop/`):
```bash
cd desktop && node -e 'const fs=require("fs");const b=fs.readFileSync("build/icon-512.png").toString("base64");fs.writeFileSync("src/main/splashLogo.ts","// 自动生成:build/icon-512.png → base64 data URI。内联以避免 dev/打包路径与 asar 问题。\nexport const SPLASH_LOGO_DATA_URI = \x27data:image/png;base64,"+b+"\x27\n")'
```
Expected: 生成 `desktop/src/main/splashLogo.ts`,含 `export const SPLASH_LOGO_DATA_URI = 'data:image/png;base64,...'`(单引号包裹,无换行)。
校验:`head -c 60 desktop/src/main/splashLogo.ts` 应见 `export const SPLASH_LOGO_DATA_URI = 'data:image/png;base64,`。

- [ ] **Step 2: 写失败测试(buildSplashHtml)**

追加到 `desktop/test/splash.test.ts`:
```ts
import { buildSplashHtml } from '../src/main/splash'

describe('buildSplashHtml', () => {
  const html = buildSplashHtml('data:image/png;base64,AAAA')
  it('内联传入的 logo data URI', () => {
    expect(html).toContain('src="data:image/png;base64,AAAA"')
  })
  it('含幽灵浮现入场动画关键帧', () => {
    expect(html).toContain('@keyframes ghostIn')
  })
  it('含散去 hook(__dismiss + dismiss class)', () => {
    expect(html).toContain('window.__dismiss')
    expect(html).toContain("classList.add('dismiss')")
  })
  it('含 reduced-motion 降级', () => {
    expect(html).toContain('prefers-reduced-motion')
  })
  it('背景透明', () => {
    expect(html).toContain('background:transparent')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/splash.test.ts`
Expected: FAIL(`buildSplashHtml` 未导出)

- [ ] **Step 4: 实现 buildSplashHtml**

追加到 `desktop/src/main/splash.ts`:
```ts
/** 自包含启动页:透明背景、居中 logo、幽灵浮现入场 + 辉光呼吸 + 散去动画;含 __dismiss 钩子。 */
export function buildSplashHtml(logoDataUri: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100vh;background:transparent;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;-webkit-user-select:none;cursor:default}
  .wrap{animation:ghostIn 900ms cubic-bezier(.22,.61,.36,1) both}
  .wrap img{width:132px;height:132px;display:block;
    filter:drop-shadow(0 0 22px rgba(150,195,255,.55));
    animation:glowPulse 2.6s ease-in-out 900ms infinite}
  body.dismiss .wrap{animation:ghostOut 450ms ease-in both}
  @keyframes ghostIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes ghostOut{from{opacity:1;transform:none}to{opacity:0;transform:scale(1.15)}}
  @keyframes glowPulse{0%,100%{filter:drop-shadow(0 0 18px rgba(150,195,255,.40))}50%{filter:drop-shadow(0 0 30px rgba(150,195,255,.70))}}
  @media (prefers-reduced-motion: reduce){
    .wrap{animation:fadeIn 500ms ease both}
    .wrap img{animation:none}
    body.dismiss .wrap{animation:fadeOut 300ms ease both}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes fadeOut{from{opacity:1}to{opacity:0}}
  }
  </style></head><body>
  <div class="wrap"><img src="${logoDataUri}" alt=""></div>
  <script>window.__dismiss=function(){document.body.classList.add('dismiss')}</script>
  </body></html>`
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/splash.test.ts`
Expected: PASS(全部,含 5 个 buildSplashHtml 用例)

- [ ] **Step 6: 提交**

```bash
git add desktop/src/main/splash.ts desktop/src/main/splashLogo.ts desktop/test/splash.test.ts
git commit -m "feat(desktop/splash): buildSplashHtml 自包含幽灵浮现页 + 内联 logo base64"
```

---

### Task 3: index.ts 编排(splash 窗 + 主窗 show:false + 交接)

**Files:**
- Modify: `desktop/src/main/index.ts`(createWindow 约 227-254;whenReady 约 1015-1056;spawnBackend connected 约 206)

**Interfaces:**
- Consumes: `shouldDismissSplash`, `buildSplashHtml`, `SPLASH_EXIT_MS`, `SPLASH_SIZE`(splash.ts);`SPLASH_LOGO_DATA_URI`(splashLogo.ts)
- Produces: 无(集成层)

- [ ] **Step 1: 导入 + 模块级状态**

在 `index.ts` 顶部 import 区加:
```ts
import { shouldDismissSplash, buildSplashHtml, SPLASH_EXIT_MS, SPLASH_SIZE } from './splash'
import { SPLASH_LOGO_DATA_URI } from './splashLogo'
```
在模块级(其它 `let mainWindow` 附近)加:
```ts
let splashWindow: BrowserWindow | null = null
let backendConnected = false
```

- [ ] **Step 2: createWindow 改为隐藏创建 + 显示函数**

把 `createWindow` 里 `new BrowserWindow({ width:1200, height:800, ... })` 加上 `show: false,`(icon 那行前):
```ts
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon-512.png'),
```
在 `createWindow` 函数**之后**新增:
```ts
/** 显示主窗(幂等):splash 散去后调用。 */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show()
  }
}

/** 创建透明无边框启动窗;失败返回 null(绝不阻塞启动)。 */
function createSplash(): BrowserWindow | null {
  try {
    const win = new BrowserWindow({
      width: SPLASH_SIZE, height: SPLASH_SIZE, center: true,
      transparent: true, frame: false, backgroundColor: '#00000000',
      alwaysOnTop: true, hasShadow: false, resizable: false, movable: false,
      skipTaskbar: true, focusable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildSplashHtml(SPLASH_LOGO_DATA_URI)))
    win.on('closed', () => { splashWindow = null })
    return win
  } catch {
    return null
  }
}

/** 散去 splash(幂等):触发页内淡出 → SPLASH_EXIT_MS 后关窗并显示主窗。 */
let splashDismissed = false
function dismissSplash(): void {
  if (splashDismissed) return
  splashDismissed = true
  const s = splashWindow
  if (s && !s.isDestroyed()) {
    s.webContents.executeJavaScript('window.__dismiss && window.__dismiss()').catch(() => {})
    setTimeout(() => {
      if (s && !s.isDestroyed()) s.close()
      showMainWindow()
    }, SPLASH_EXIT_MS)
  } else {
    showMainWindow()
  }
}
```

- [ ] **Step 3: spawnBackend 里置 connected 标记**

`index.ts` 约 206 现有:
```ts
  // Announce connected.
  sendEvent({ kind: 'connection', state: 'connected' })
```
改为(其后加一行):
```ts
  // Announce connected.
  sendEvent({ kind: 'connection', state: 'connected' })
  backendConnected = true
```

- [ ] **Step 4: whenReady 编排 splash**

`index.ts` 约 1047 现有顺序为 `createWindow(); spawnBackend();`。改为:
```ts
  const splashStartedAt = Date.now()
  splashWindow = createSplash()
  createWindow()
  spawnBackend()

  if (!splashWindow) {
    // 无动画:直接显示主窗,不阻塞
    showMainWindow()
  } else {
    const splashTimer = setInterval(() => {
      if (shouldDismissSplash(Date.now() - splashStartedAt, backendConnected)) {
        clearInterval(splashTimer)
        dismissSplash()
      }
    }, 150)
  }
```
注意:E2E 分支(`WRAITH_E2E==='1'`)如需绕过 splash(避免拖慢/干扰用例),可在此判断:E2E 下不建 splash、直接 `createWindow()` 后 `showMainWindow()`。实现时核对现有 E2E 用例是否依赖窗口立即可见;若依赖则加此绕过。

- [ ] **Step 5: 构建校验(编译不报错)**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0(无类型错误)

- [ ] **Step 6: 全量单测回归**

Run: `cd desktop && npx vitest run`
Expected: 全绿(含新增 splash 测试)

- [ ] **Step 7: 眼验(重启 dev)**

重启 `npm run dev`。观察:
- 启动即见透明窗中 logo 幽灵浮现(淡入+上浮+辉光呼吸),桌面可见于其后。
- 后端就绪(约 1–4s)后 logo 淡出+轻微放大散去,主窗现身。
- 系统"减少动态效果"开启时:仅淡入淡出。
- 冷启动(jar 未热)与热启动都自然;后端异常时 4s 内也会进主窗。

- [ ] **Step 8: 提交**

```bash
git add desktop/src/main/index.ts
git commit -m "feat(desktop/splash): 启动编排——透明 splash 窗 + 主窗延迟显示 + 就绪交接"
```

---

## Self-Review

**Spec coverage:**
- 独立透明无边框置顶窗 → Task 3 createSplash ✓
- logo 幽灵浮现(淡入+上浮+辉光呼吸) → Task 2 buildSplashHtml(ghostIn/glowPulse)✓
- 散去(淡出+放大) → Task 2(ghostOut)+ Task 3(dismissSplash)✓
- 时机(connected + 地板1.2s/天花板4s) → Task 1 shouldDismissSplash + Task 3 timer ✓
- 自包含 data URL、不依赖 dev server/后端 → Task 2 buildSplashHtml + Task 3 loadURL(data:)✓
- logo dev/打包皆可解析 → Task 2 内联 base64 常量 ✓
- splash 失败不阻塞 → Task 3 createSplash 返回 null 分支 + try/catch ✓
- prefers-reduced-motion 降级 → Task 2 媒体查询 ✓
- 纯 logo 无字标 → buildSplashHtml 无文字 ✓
- 主窗 show:false + 就绪后显示 → Task 3 Step 2/4 ✓

**Placeholder scan:** 无 TBD/TODO;E2E 绕过为"核对后按需加"的明确条件,非占位。

**Type consistency:** `shouldDismissSplash`/`buildSplashHtml`/`SPLASH_EXIT_MS`/`SPLASH_SIZE`/`SPLASH_LOGO_DATA_URI` 命名在 Task 1/2 定义、Task 3 消费一致。
