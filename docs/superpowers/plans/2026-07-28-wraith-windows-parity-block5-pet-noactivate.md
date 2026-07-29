# Windows 对等 块5:桌宠 WS_EX_NOACTIVATE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows 桌宠窗经 koffi FFI 加 `WS_EX_NOACTIVATE`,精确实现点击不抢焦;mac/Linux 不变;跨虚拟桌面为文档化限制。

**Architecture:** 新纯模块 `winPetStyle.ts` = 纯函数 `withNoActivate`(mac 可单测)+ `applyNoActivate(win)`(仅 win32、lazy `require('koffi')` 调 user32、全程 try/catch 降级)。`petWindow.ts` 建窗后调 `applyNoActivate`。koffi 免 node-gyp。

**Tech Stack:** Electron 32 主进程(TS)、koffi(FFI,预编译)、vitest。

## Global Constraints

- 语言:注释/文档中文;代码/命令/路径原样。
- 分支 `feat/windows-parity-block1`(已 checkout,直接提交)。工作目录 /Users/aa00945/Desktop/wraith;桌面命令在 desktop/ 下跑。
- **不改 Java 后端;不改 mac/Linux 桌宠行为**(darwin NSPanel 路径、`petWindowOptions` 的 `focusable:false` 兜底不动)。
- `winPetStyle.ts` **纯模块只 `import type` electron**(便于 vitest 直接 import);`require('koffi')` 只在 win32 分支内(测试宿主 darwin 不触达)。
- 每个代码任务结束:`cd desktop && npm run typecheck`(tsc 0)+ `npm run test`(vitest 全绿、不回归,尤其 pet 相关)。
- `git add` 只加本任务涉及文件,禁止 `git add .`/`-A`;**绝不碰** WIP 文件(README.md、demo/pom.xml、.claude/settings.json、demo/src/Hello.java、progress.md、.superpowers/)。
- 提交信息中文,结尾逐字附:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- 诚实边界:koffi FFI + Win32 在 mac 上编不了跑不了;koffi 类型串/HWND 读法/ABI 兼容为最佳努力、未实测。**try/catch 降级是安全网**(最坏=没精确不抢焦、退回 focusable:false,不崩)。Windows 实机验证归用户。

## 文件结构

- `desktop/src/main/winPetStyle.ts`(新):纯函数 + win32-only FFI 胶水。
- `desktop/test/winPetStyle.test.ts`(新):`withNoActivate` 纯测 + `applyNoActivate` 非 win32 no-op 测。
- `desktop/package.json` + `desktop/package-lock.json`(改):加 koffi 到 dependencies。
- `desktop/src/main/petWindow.ts`(改):建窗后调 `applyNoActivate(win)`。
- `docs/windows-dev.md`(改):桌宠降级更新 + 验收条目。

---

### Task 1: koffi 依赖 + winPetStyle.ts + 单测

**Files:**
- Modify: `desktop/package.json` + `desktop/package-lock.json`(加 koffi)
- Create: `desktop/src/main/winPetStyle.ts`
- Test: `desktop/test/winPetStyle.test.ts`

**Interfaces:**
- Produces:`WS_EX_NOACTIVATE`(0x08000000)、`GWL_EXSTYLE`(-20)、`withNoActivate(exStyle: number): number`、`applyNoActivate(win: BrowserWindow): void`(win32-only、try/catch 降级)。

- [ ] **Step 1: 加 koffi 依赖**

Run: `cd desktop && npm install --save --legacy-peer-deps koffi`
(koffi 进 `dependencies`;`--legacy-peer-deps` 绕仓库既有 @lobehub peer 冲突;更新 package.json + package-lock.json。)

- [ ] **Step 2: 写失败测试**

Create `desktop/test/winPetStyle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { withNoActivate, applyNoActivate, WS_EX_NOACTIVATE } from '../src/main/winPetStyle'

describe('withNoActivate', () => {
  it('0 → WS_EX_NOACTIVATE', () => {
    expect(withNoActivate(0)).toBe(0x08000000)
  })
  it('置位并保留既有位(如 WS_EX_LAYERED 0x80000)', () => {
    expect(withNoActivate(0x00080000)).toBe(0x00080000 | 0x08000000)
  })
  it('幂等:已置位再置仍相等', () => {
    expect(withNoActivate(WS_EX_NOACTIVATE)).toBe(WS_EX_NOACTIVATE)
  })
  it('归一为无符号 32 位整数', () => {
    const r = withNoActivate(0x12345678)
    expect(Number.isInteger(r)).toBe(true)
    expect(r).toBeGreaterThanOrEqual(0)
  })
})

describe('applyNoActivate 非 win32', () => {
  it('darwin/linux 上 no-op、不抛、不触碰 win 句柄', () => {
    // 测试宿主非 win32 → 应提前 return;若误入 win32 分支会调 getNativeWindowHandle 抛错
    const fakeWin = {
      getNativeWindowHandle() { throw new Error('不应在非 win32 被调用') },
    } as unknown as import('electron').BrowserWindow
    expect(() => applyNoActivate(fakeWin)).not.toThrow()
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/winPetStyle.test.ts`
Expected: FAIL —— 找不到 `../src/main/winPetStyle`。

- [ ] **Step 4: 写实现**

Create `desktop/src/main/winPetStyle.ts`(**只 type-only 导入 electron**):

```ts
import type { BrowserWindow } from 'electron'

/** WS_EX_NOACTIVATE:窗口不因点击而被激活(不抢焦)。GWL_EXSTYLE:扩展样式索引。 */
export const WS_EX_NOACTIVATE = 0x08000000
export const GWL_EXSTYLE = -20

/** 在既有扩展样式上置 WS_EX_NOACTIVATE(幂等、保留其它位;>>>0 归一为无符号 32 位)。纯函数。 */
export function withNoActivate(exStyle: number): number {
  return (exStyle | WS_EX_NOACTIVATE) >>> 0
}

/**
 * Windows:给桌宠窗 HWND 加 WS_EX_NOACTIVATE,精确实现"点击不抢焦"。
 * 仅 win32;非 win32 直接 no-op。全程 try/catch:koffi 缺失/加载失败/FFI 出错都静默降级
 * (退回 petWindowOptions 的 focusable:false 兜底),绝不抛、不阻塞桌宠。
 * ⚠ koffi 类型声明/HWND 读法为最佳努力、未在 Windows 实测;实机若不符按 koffi 当前 API 微调。
 */
export function applyNoActivate(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  try {
    // lazy:只在 win32 加载,避免 mac 加载 + 缺失时被 catch。electron-vite main 默认 CJS,require 可用。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    // LONG_PTR/HWND 在 x64 为 64 位;用 uintptr_t/intptr_t 承载,BigInt 传递。
    const GetWindowLongPtrW = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', ['uintptr_t', 'int'])
    const SetWindowLongPtrW = user32.func('__stdcall', 'SetWindowLongPtrW', 'intptr_t', ['uintptr_t', 'int', 'intptr_t'])
    const buf = win.getNativeWindowHandle()
    const hwnd = buf.readBigUInt64LE(0) // x64:Buffer 的 8 字节即 HWND 指针值
    const cur = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, BigInt(withNoActivate(cur)))
  } catch (e) {
    // 降级:保留 focusable:false 兜底,不抛。
    console.warn('[pet] applyNoActivate 失败,降级 focusable:false:', (e as Error)?.message)
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/winPetStyle.test.ts`
Expected: PASS(withNoActivate 4 用例 + applyNoActivate 非 win32 no-op)。

- [ ] **Step 6: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0;vitest 全绿(不回归)。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/package.json desktop/package-lock.json desktop/src/main/winPetStyle.ts desktop/test/winPetStyle.test.ts
git commit -m "feat(windows): winPetStyle(WS_EX_NOACTIVATE via koffi)+ koffi 依赖

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 2: petWindow.ts 接线 applyNoActivate

**Files:**
- Modify: `desktop/src/main/petWindow.ts`

**Interfaces:**
- Consumes: Task 1 的 `applyNoActivate`。

- [ ] **Step 1: 接线**

在 `desktop/src/main/petWindow.ts` 顶部加 `import { applyNoActivate } from './winPetStyle'`。在 `createPetWindow` 里 `win.setIgnoreMouseEvents(true, { forward: true })` 那一行**之后**加:

```ts
    applyNoActivate(win) // Windows:精确不抢焦(win32-only,失败自降级到 focusable:false)
```

(位置在 `new BrowserWindow(...)` 之后——`getNativeWindowHandle` 要求窗口已构造;仍在既有 try/catch 内。darwin 的 `setVisibleOnAllWorkspaces`/`setActivationPolicy` 分支与 `focusable:false` 兜底不动。)

- [ ] **Step 2: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0;vitest 全绿(pet 相关不回归——applyNoActivate 在测试宿主 darwin 是 no-op)。

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/petWindow.ts
git commit -m "feat(windows): 桌宠建窗后调 applyNoActivate(win32 精确不抢焦)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 3: docs/windows-dev.md 桌宠降级更新

**Files:**
- Modify: `docs/windows-dev.md`

- [ ] **Step 1: 更新桌宠"已知降级" + 补验收**

先读 `docs/windows-dev.md`。把"已知降级"里关于桌宠(点击可能抢焦 / 不跨虚拟桌面 → 块5)那条,改写为:

```markdown
- (块 5 已完成)桌宠"点击不抢焦"在 Windows 已由 WS_EX_NOACTIVATE(koffi FFI)精确实现;**跨虚拟桌面常驻仍为已知限制**(Windows 无官方 API,不做)。
```

在"验收清单"补:

```markdown
- [ ] 开启桌宠后,单击/拖动桌宠**不打断**你在其它应用里的操作(不抢焦)
```

其余降级条(若有)不动。

- [ ] **Step 2: 校对**

肉眼确认:与块 5 实际交付一致(不抢焦精确 / 跨桌面仍限制)、无占位、全文无自相矛盾。

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add docs/windows-dev.md
git commit -m "docs(windows): 桌宠不抢焦精确(块5)+ 跨虚拟桌面为已知限制

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

## 完成判据(块 5)

- `withNoActivate` 纯函数单测绿(0→0x08000000、保位、幂等、无符号 32 位);`applyNoActivate` 非 win32 no-op 不抛。
- `applyNoActivate` 接进 `createPetWindow`(win32 守卫 + try/catch 降级);`koffi` 在 dependencies。
- macOS/Linux 桌宠行为不变(darwin 分支、focusable:false 兜底未动)。
- `tsc` 净、既有 vitest 不回归。
- `docs/windows-dev.md` 反映:点击不抢焦已精确、跨虚拟桌面为已知限制。
- **Windows 实机**(不抢焦生效 + 桌宠未被 koffi 破坏)= 用户负责;koffi FFI 具体是"最佳努力 + 降级安全网",本环境不冒领。
