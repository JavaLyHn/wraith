# Windows 对等 块1:可跑 dev + 平台守卫兜底 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 wraith 桌面在 Windows 上能跑 `npm run dev` 且无 macOS 专属调用抛错,把平台分支抽成纯函数在 mac 上单测验证 Windows 路径。

**Architecture:** 只改 Electron 主进程少数几处(不碰 Java 后端、不碰渲染层视觉)。新增纯函数 `resolveOpenWithPlan`(落已有纯模块 `fileOpen.ts`)与 `petWindowOptions`(独立新文件,type-only 导入 electron 以便 vitest 直接 import),各自 TDD;handler / 建窗处改为消费纯函数。另加 `dev-win.ps1` 备后端 jar 与 `docs/windows-dev.md` 上手文档+验收清单。

**Tech Stack:** Electron 32 主进程(TypeScript)、vitest、electron-vite、PowerShell(Windows 脚本)。

## Global Constraints

- 语言:文档与注释用中文;代码/命令/路径原样。
- **不改 Java 后端**(`src/main/java/**`),不改渲染层视觉(块 2 负责)。
- **macOS 行为字节级不变**:所有 darwin 分支保持现状,由单测锁定。
- 纯函数模块**禁止值导入 electron**(只可 `import type`),否则 vitest 直接 import 会在无 electron 运行时环境炸。
- 每个代码任务结束必须:`npm run typecheck`(tsc)净 + `npm run test`(vitest)不回归。
- 提交信息用中文,结尾附:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- `git add` 只加本任务涉及文件,禁止 `git add .`/`-A`;禁止碰 WIP 文件(README.md、demo/pom.xml、.claude/settings.json、demo/src/Hello.java、progress.md、.superpowers/)。
- 诚实边界:本环境 macOS,无法验证 Windows 实机 GUI;交付 = 纯函数单测 + 脚本 + 可打勾清单,运行时冒烟归用户/CI。

## 文件结构

- `desktop/src/main/fileOpen.ts`(改):新增 `OpenWithPlan` 类型 + `resolveOpenWithPlan` 纯函数。
- `desktop/test/fileOpen.test.ts`(改):加 `resolveOpenWithPlan` 用例。
- `desktop/src/main/petWindowOptions.ts`(新):纯函数 `petWindowOptions`,type-only 导入 electron 类型。
- `desktop/test/petWindowOptions.test.ts`(新):平台分支断言。
- `desktop/src/main/index.ts`(改):`wraith:openWithApp` handler 改用 `resolveOpenWithPlan`。
- `desktop/src/main/petWindow.ts`(改):`createPetWindow` 消费 `petWindowOptions` + `setVisibleOnAllWorkspaces` 显式 darwin 守卫。
- `desktop/scripts/dev-win.ps1`(新):Windows 备后端 jar。
- `docs/windows-dev.md`(新):Windows dev 上手文档 + 验收清单。

**注**:`resolveShell` 的 win32 断言已存在于 `desktop/test/ptyHelpers.test.ts`,本计划不重复。

---

### Task 1: resolveOpenWithPlan(编辑器打开的平台守卫)

**Files:**
- Modify: `desktop/src/main/fileOpen.ts`(在文件末尾追加类型与函数)
- Test: `desktop/test/fileOpen.test.ts`
- Modify: `desktop/src/main/index.ts:1404-1407`(`wraith:openWithApp` handler)

**Interfaces:**
- Consumes: 无(纯函数,只依赖入参)。
- Produces:
  - `export type OpenWithPlan = { kind: 'spawn'; cmd: string; args: string[] } | { kind: 'shellOpen'; target: string }`
  - `export function resolveOpenWithPlan(platform: NodeJS.Platform, appPath: string, filePath: string): OpenWithPlan`

- [ ] **Step 1: 写失败测试**

追加到 `desktop/test/fileOpen.test.ts`。**把 `resolveOpenWithPlan` 加进文件顶部已有的那行** `import { detectEditors, uniqueDownloadName, isPathWithinWorkspace, performUndo } from '../src/main/fileOpen'`(不要新开一行 import,避免 no-duplicate-imports),然后追加用例:

```ts
describe('resolveOpenWithPlan', () => {
  it("darwin → spawn open -a", () => {
    expect(resolveOpenWithPlan('darwin', '/Applications/Visual Studio Code.app', '/x/y.txt'))
      .toEqual({ kind: 'spawn', cmd: 'open', args: ['-a', '/Applications/Visual Studio Code.app', '/x/y.txt'] })
  })
  it('win32 → shellOpen(系统默认程序,不 spawn open)', () => {
    expect(resolveOpenWithPlan('win32', 'C:/whatever.exe', 'C:/x/y.txt'))
      .toEqual({ kind: 'shellOpen', target: 'C:/x/y.txt' })
  })
  it('linux → shellOpen', () => {
    expect(resolveOpenWithPlan('linux', '/usr/bin/code', '/x/y.txt'))
      .toEqual({ kind: 'shellOpen', target: '/x/y.txt' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/fileOpen.test.ts`
Expected: FAIL —— `resolveOpenWithPlan is not a function` / 导入不到。

- [ ] **Step 3: 写最小实现**

追加到 `desktop/src/main/fileOpen.ts` 末尾:

```ts
export type OpenWithPlan =
  | { kind: 'spawn'; cmd: string; args: string[] }
  | { kind: 'shellOpen'; target: string }

/**
 * 决定"用某编辑器打开文件"在当前平台怎么执行。
 * darwin 用 `open -a <app> <file>`;其余平台没有等价的"指定 .app"语义,
 * 退回系统默认程序打开(shell.openPath)。完整的 Windows 编辑器探测见块 3。
 */
export function resolveOpenWithPlan(
  platform: NodeJS.Platform,
  appPath: string,
  filePath: string,
): OpenWithPlan {
  if (platform === 'darwin') {
    return { kind: 'spawn', cmd: 'open', args: ['-a', appPath, filePath] }
  }
  return { kind: 'shellOpen', target: filePath }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/fileOpen.test.ts`
Expected: PASS(含既有 detectEditors 等用例)。

- [ ] **Step 5: 接线 handler**

改 `desktop/src/main/index.ts` 的 `wraith:openWithApp`(`shell` 已在顶部 electron import 中,`spawn` 已从 'child_process' 导入;把 `resolveOpenWithPlan` 加入第 51 行 `from './fileOpen'` 的 import):

```ts
ipcMain.handle('wraith:openWithApp', (_e, p: string, appPath: string) => {
  if (!computeEditors().some(ed => ed.appPath === appPath)) throw new Error('无效的应用')
  const plan = resolveOpenWithPlan(process.platform, appPath, p)
  if (plan.kind === 'spawn') {
    spawn(plan.cmd, plan.args, { stdio: 'ignore', detached: true }).unref()
  } else {
    void shell.openPath(plan.target)
  }
})
```

- [ ] **Step 6: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0 error;vitest 全绿(不回归)。

- [ ] **Step 7: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/fileOpen.ts desktop/test/fileOpen.test.ts desktop/src/main/index.ts
git commit -m "feat(windows): resolveOpenWithPlan 守卫 openWithApp,非 mac 退回 shell.openPath

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 2: petWindowOptions(桌宠建窗选项纯函数化 + 平台守卫)

**Files:**
- Create: `desktop/src/main/petWindowOptions.ts`
- Test: `desktop/test/petWindowOptions.test.ts`
- Modify: `desktop/src/main/petWindow.ts`(`createPetWindow` 消费该函数 + `setVisibleOnAllWorkspaces` 补 darwin 守卫)

**Interfaces:**
- Consumes: 无(纯函数)。
- Produces:
  - `export function petWindowOptions(platform: NodeJS.Platform, bounds: { x: number; y: number; width: number; height: number }, preloadPath: string): Electron.BrowserWindowConstructorOptions`
  - 契约:`platform === 'darwin'` 时结果含 `type: 'panel'`;其余平台不含 `type`。其余字段(frame/transparent/backgroundColor/hasShadow/resizable/movable/skipTaskbar/focusable/fullscreenable/show/webPreferences)与平台无关、恒定。

- [ ] **Step 1: 写失败测试**

Create `desktop/test/petWindowOptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { petWindowOptions } from '../src/main/petWindowOptions'

const B = { x: 10, y: 20, width: 200, height: 200 }

describe('petWindowOptions', () => {
  it('darwin 含 type:panel', () => {
    const o = petWindowOptions('darwin', B, '/p/preload.js') as Record<string, unknown>
    expect(o.type).toBe('panel')
  })
  it('win32 不含 type', () => {
    const o = petWindowOptions('win32', B, '/p/preload.js') as Record<string, unknown>
    expect('type' in o).toBe(false)
  })
  it('linux 不含 type', () => {
    const o = petWindowOptions('linux', B, '/p/preload.js') as Record<string, unknown>
    expect('type' in o).toBe(false)
  })
  it('公共字段与 bounds/preload 恒定', () => {
    const o = petWindowOptions('win32', B, '/p/preload.js') as any
    expect(o.x).toBe(10); expect(o.width).toBe(200)
    expect(o.frame).toBe(false)
    expect(o.transparent).toBe(true)
    expect(o.focusable).toBe(false)
    expect(o.skipTaskbar).toBe(true)
    expect(o.show).toBe(false)
    expect(o.webPreferences.preload).toBe('/p/preload.js')
    expect(o.webPreferences.contextIsolation).toBe(true)
    expect(o.webPreferences.nodeIntegration).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/petWindowOptions.test.ts`
Expected: FAIL —— 找不到 `../src/main/petWindowOptions`。

- [ ] **Step 3: 写最小实现**

Create `desktop/src/main/petWindowOptions.ts`(**只 type-only 导入 electron**):

```ts
import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * 桌宠窗口的 BrowserWindow 构造选项(纯函数,便于按平台单测)。
 * darwin 用 NSPanel(type:'panel',nonactivating:点击/拖动不抢焦);其余平台不传
 * type(避免落到未知窗口类型)。focusable:false + 调用方的 setIgnoreMouseEvents 提供
 * 跨平台的"点击穿透/不抢焦"近似;Windows 的完全对等(WS_EX_NOACTIVATE + 跨虚拟桌面)
 * 留给块 5 的原生插件。
 */
export function petWindowOptions(
  platform: NodeJS.Platform,
  bounds: { x: number; y: number; width: number; height: number },
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    ...(platform === 'darwin' ? { type: 'panel' as const } : {}),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: true, movable: false, skipTaskbar: true, focusable: false, fullscreenable: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: preloadPath },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/petWindowOptions.test.ts`
Expected: PASS。

- [ ] **Step 5: 让 createPetWindow 消费纯函数**

改 `desktop/src/main/petWindow.ts`:顶部加 `import { petWindowOptions } from './petWindowOptions'`。把 `new BrowserWindow({ ... })`(x/y/width/height + type + frame … + webPreferences 那整段字面量)替换为:

```ts
win = new BrowserWindow(petWindowOptions(process.platform, b, deps.preloadPath))
```

- [ ] **Step 6: setVisibleOnAllWorkspaces 补 darwin 守卫**

同文件,把这行:

```ts
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
```

改为(Windows 本就 no-op,此为语义清晰 + 防未来 Electron 行为变动):

```ts
if (process.platform === 'darwin') {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}
```

(`win.setAlwaysOnTop(...)`、`win.setIgnoreMouseEvents(...)` 跨平台,保持不变;`app.setActivationPolicy` 那处已有 darwin 守卫,不动。)

- [ ] **Step 7: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0 error;vitest 全绿(含新 petWindowOptions 用例;既有 pet 相关测试不回归)。

- [ ] **Step 8: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/petWindowOptions.ts desktop/test/petWindowOptions.test.ts desktop/src/main/petWindow.ts
git commit -m "feat(windows): 桌宠建窗选项纯函数化 + setVisibleOnAllWorkspaces darwin 守卫

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 3: dev-win.ps1(Windows 备后端 jar 脚本)

**Files:**
- Create: `desktop/scripts/dev-win.ps1`

**Interfaces:**
- Consumes: 仓库根 `pom.xml`(Maven 构建),产物 `target/wraith-*.jar`。
- Produces: `%USERPROFILE%\.wraith\wraith.jar`(供 dev 后端 `spawn('java', ['-jar', <该 jar>, 'app-server'])` 使用)。

- [ ] **Step 1: 写脚本**

Create `desktop/scripts/dev-win.ps1`:

```powershell
# dev-win.ps1 — Windows 备 wraith 后端 jar 到稳定位置,供桌面 dev 用。
# 对标 macOS 的 wraith-install。用法(仓库任意位置):
#   powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
$ErrorActionPreference = 'Stop'

# 仓库根 = 本脚本上上级(desktop\scripts\ -> desktop -> repo)
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dest = Join-Path $env:USERPROFILE '.wraith\wraith.jar'

Write-Host "dev-win: 构建中 (mvn -q clean package -DskipTests)…"
Push-Location $repo
try {
  mvn -q clean package -DskipTests
} finally {
  Pop-Location
}

# shade 后的可执行包是 target\wraith-*.jar 里最大的那个(original-* 不匹配此通配)
$src = Get-ChildItem (Join-Path $repo 'target\wraith-*.jar') -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending | Select-Object -First 1
if (-not $src) { Write-Error "dev-win: 没找到构建产物 $repo\target\wraith-*.jar"; exit 1 }

New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Copy-Item $src.FullName $dest -Force
Write-Host "dev-win: 已安装 -> $dest"
Get-Item $dest | Format-List Name, Length, LastWriteTime
```

- [ ] **Step 2: 静态检查(mac 上尽力)**

Run(mac 若装了 pwsh):`pwsh -NoProfile -Command "$PSVersionTable.PSVersion; [System.Management.Automation.Language.Parser]::ParseFile('desktop/scripts/dev-win.ps1',[ref]$null,[ref]$null) | Out-Null; 'parse-ok'"`
Expected:打印 `parse-ok`(仅验语法)。
若 mac 无 pwsh:跳过,标注"语法待 Windows 侧首次运行验证"(诚实,不谎报)。

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/scripts/dev-win.ps1
git commit -m "feat(windows): dev-win.ps1 —— 备后端 jar 到 %USERPROFILE%\\.wraith\\wraith.jar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 4: docs/windows-dev.md(上手文档 + 验收清单)

**Files:**
- Create: `docs/windows-dev.md`

**Interfaces:**
- Consumes: Task 3 的 `dev-win.ps1`;既有 `npm run dev`。
- Produces:面向用户/CI 的 Windows dev 步骤 + 可打勾验收清单。

- [ ] **Step 1: 写文档**

Create `docs/windows-dev.md`:

````markdown
# 在 Windows 上跑 wraith 桌面 dev

> 状态:块 1(可跑 dev + 平台守卫兜底)。已知降级见文末。

## 前置(均需在 PATH)

- JDK 17:`java -version`
- Maven:`mvn -v`
- Node(建议 ≥ 18):`node -v`

## 步骤

1. **备后端 jar**(仓库根):
   ```powershell
   powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
   ```
   产物落到 `%USERPROFILE%\.wraith\wraith.jar`。

2. **装桌面依赖**(取 node-pty 的 Windows 原生二进制):
   ```powershell
   cd desktop
   npm install
   ```

3. **起 dev**:
   ```powershell
   npm run dev
   ```
   dev 后端由 Electron 主进程 `spawn('java', ['-jar', %USERPROFILE%\.wraith\wraith.jar, 'app-server'])` 拉起。

## 验收清单(在 Windows 实机逐条打勾)

- [ ] App 起动,主窗出现(标准系统窗框)
- [ ] 状态显示后端已连接
- [ ] 发一条消息,有回复
- [ ] 终端面板能打开、能敲命令(PowerShell / cmd)
- [ ] 记忆面板能搜索、能保存
- [ ] (若开启桌宠)开启后 App 不崩、宠物出现

## 已知降级(后续块处理)

- 窗口是**系统标准边框**(mac 的无边框 + 红绿灯视觉对等 → 块 2)。
- "用应用打开"文件走**系统默认程序**(Windows 编辑器探测 → 块 3)。
- 桌宠**不跨虚拟桌面**、点击**可能抢焦**(原生插件对等 → 块 5)。
- 无 Windows 安装包(打包 → 块 4)。
````

- [ ] **Step 2: 校对**

肉眼过一遍:命令可复制、路径正确、清单与 spec §3.4 一致。无占位符。

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add docs/windows-dev.md
git commit -m "docs(windows): Windows dev 上手文档 + 实机验收清单

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

## 完成判据(块 1)

- Task 1/2 的纯函数 vitest 全绿;`npm run typecheck` 0 error;既有 vitest 不回归。
- macOS 行为字节级不变(darwin 分支保持现状,单测锁定 `type:'panel'` 等)。
- `dev-win.ps1` + `docs/windows-dev.md` 就位。
- **Windows 实机 GUI 冒烟**(验收清单)= 用户/CI 负责,本环境不冒领。
