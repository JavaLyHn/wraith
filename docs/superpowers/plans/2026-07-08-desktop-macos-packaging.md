# 桌面 App 图标 + macOS 打包/发布(v1) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面 App 显 WR 品牌图标(不显 Electron 原子标),并产出自包含(捆绑 JRE)、可安装的 macOS `.dmg`,启动时通知式检查更新。

**Architecture:** 复用现有 WR 标合成 App 图标;`electron-builder` 打 mac 包(ad-hoc 不签名);`jlink` 裁精简 JRE 随包;主进程按 `app.isPackaged` 解析 sidecar 用捆绑 java+jar;更新走 GitHub Releases 通知式(seam 预留)。

**Tech Stack:** Electron + electron-vite、electron-builder、sharp(图标)、jlink/iconutil/sips(JDK/macOS 自带工具)、vitest。

## Global Constraints

- 仅 macOS;ad-hoc 不签名(`mac.identity: null` + `CSC_IDENTITY_AUTO_DISCOVERY=false`)。
- 密钥面零新增:key 仍只在 `~/.wraith/config.json`(包外);捆绑 jar/JRE 无密钥;更新检查仅打**公共** GitHub API、匿名、不回传本地数据。
- 未签名 mac 应用**不做原地自动更新**;v1 仅通知 + 打开下载页。更新逻辑做成 seam(纯 `isNewerVersion` + `checkForUpdates()`)。
- 组件/纯逻辑 vitest;脚本靠运行产物断言;UI/打包靠 typecheck + build + 眼验(无 RTL)。
- 不改 Java 后端源码(jar 内容不变,仅随包);不打 win/linux;不搭 CI。
- 提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- 所有工作在 `desktop/` 下(除读根 `target/wraith-1.0-SNAPSHOT.jar`);路径以 `desktop/` 为根。

---

## 已核实的环境事实(实现时可直接用)

- 工具就绪:`jlink`/`jdeps` 26.0.1、`iconutil`、`sips`、`java` 26。
- `src/renderer/assets/logo-light.png`、`logo-dark.png` 均**透明底 1254×1254**(可直接合成,无需去白)。深底用 `logo-light.png`(浅色标)。
- jar 模块依赖(`jdeps --print-module-deps --ignore-missing-deps --multi-release 26`):
  `java.base,java.desktop,java.management,java.naming,java.net.http,java.security.jgss,java.sql,jdk.httpserver`。
  jlink 时**额外加 TLS**:`jdk.crypto.ec`(HTTPS provider 运行时加载,jdeps 检不到)。
- jlink 直出布局:`runtime/bin/java`;打包后位于 `<Wraith.app>/Contents/Resources/runtime/bin/java`,`process.resourcesPath` = `.../Contents/Resources`。

---

### Task 1: sidecar 命令三态解析(app-server + gateway,纯逻辑)

**Files:**
- Modify: `desktop/src/main/backend.ts`
- Modify: `desktop/src/main/gatewayManager.ts`(`resolveGatewayCommand`/`resolveBindCommand` 加 packaged 分支)
- Test: `desktop/test/backend.test.ts`(新增或补充)

**Interfaces:**
- Produces:
  - `packagedBackendCommand(resourcesPath: string): { cmd: string; args: string[] }`
  - `resolveBackendCommand(env, defaultJar: string, packaged?: { resourcesPath: string }): { cmd; args }`(向后兼容:不传 `packaged` 即原 dev 行为)
  - gateway 侧同形:`resolveGatewayCommand(env, defaultJar, packaged?)`、`resolveBindCommand(env, defaultJar, packaged?)`
- Consumes(Task 7):`app.isPackaged`、`process.resourcesPath`。

- [ ] **Step 1: 写失败测试**(`desktop/test/backend.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { resolveBackendCommand, packagedBackendCommand, defaultJarPath } from '../src/main/backend'

describe('resolveBackendCommand 三态', () => {
  const jar = defaultJarPath('/Users/x') // /Users/x/.wraith/wraith.jar

  it('env 覆写最高优先(即使 packaged 也让位)', () => {
    const r = resolveBackendCommand({ WRAITH_APPSERVER_CMD: 'foo -a b' }, jar, { resourcesPath: '/R' })
    expect(r).toEqual({ cmd: 'foo', args: ['-a', 'b'] })
  })

  it('packaged → 捆绑 java + 捆绑 jar', () => {
    const r = resolveBackendCommand({}, jar, { resourcesPath: '/R' })
    expect(r).toEqual({ cmd: '/R/runtime/bin/java', args: ['-jar', '/R/wraith.jar', 'app-server'] })
  })

  it('dev(无 packaged) → 系统 java + 默认 jar,行为不变', () => {
    const r = resolveBackendCommand({}, jar)
    expect(r).toEqual({ cmd: 'java', args: ['-jar', jar, 'app-server'] })
  })
})

describe('packagedBackendCommand', () => {
  it('拼 resourcesPath 下的 runtime/bin/java 与 wraith.jar', () => {
    expect(packagedBackendCommand('/R')).toEqual({
      cmd: '/R/runtime/bin/java', args: ['-jar', '/R/wraith.jar', 'app-server'],
    })
  })
})
```

- [ ] **Step 2: 运行验证失败** — `npx vitest run backend`,预期 FAIL(`packagedBackendCommand` 未导出 / packaged 分支不存在)。

- [ ] **Step 3: 实现**(`desktop/src/main/backend.ts` 全量替换）

```ts
import path from 'path'

/** ~/.wraith/wraith.jar(dev 用);参数化 homedir 便于测试。 */
export function defaultJarPath(homedir: string): string {
  return path.join(homedir, '.wraith', 'wraith.jar')
}

/** 打包态:用捆绑 JRE 的 java + 捆绑 jar 跑 app-server。 */
export function packagedBackendCommand(resourcesPath: string): { cmd: string; args: string[] } {
  return {
    cmd: path.join(resourcesPath, 'runtime', 'bin', 'java'),
    args: ['-jar', path.join(resourcesPath, 'wraith.jar'), 'app-server'],
  }
}

/**
 * resolveBackendCommand — 纯函数。
 * 优先级:WRAITH_APPSERVER_CMD 覆写 > packaged(捆绑 java+jar)> dev(系统 java + defaultJar)。
 */
export function resolveBackendCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string,
  packaged?: { resourcesPath: string },
): { cmd: string; args: string[] } {
  const override = env['WRAITH_APPSERVER_CMD']
  if (override && override.trim().length > 0) {
    const tokens = override.trim().split(/\s+/)
    const [cmd, ...args] = tokens
    return { cmd: cmd!, args }
  }
  if (packaged) return packagedBackendCommand(packaged.resourcesPath)
  return { cmd: 'java', args: ['-jar', defaultJar, 'app-server'] }
}
```

- [ ] **Step 4: gateway 镜像**(`desktop/src/main/gatewayManager.ts`)——给 `resolveGatewayCommand`/`resolveBindCommand` 加同形 `packaged?` 第三参:packaged 时 `cmd = <resourcesPath>/runtime/bin/java`、`args = ['-jar', <resourcesPath>/wraith.jar, 'gateway'(/'gateway','bind')]`;env 覆写与 dev 分支不变。补 2 条对应单测(packaged 分支)。

- [ ] **Step 5: 运行验证通过** — `npx vitest run backend gatewayManager && npm run typecheck`,预期全绿(dev 调用点未改签名,`packaged` 可选,build 不破)。

- [ ] **Step 6: 提交**

```bash
git add src/main/backend.ts src/main/gatewayManager.ts test/backend.test.ts test/gatewayManager*.test.ts
git commit -m "feat(desktop): sidecar 命令支持 packaged 态(捆绑 java+jar)"
```

---

### Task 2: 版本比较纯逻辑 `isNewerVersion`

**Files:**
- Create: `desktop/src/main/updateCheck.ts`(本任务仅纯函数部分)
- Test: `desktop/test/updateCheck.test.ts`

**Interfaces:**
- Produces:`isNewerVersion(latest: string, current: string): boolean`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { isNewerVersion } from '../src/main/updateCheck'

describe('isNewerVersion', () => {
  it('补丁号更高 → true', () => expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true))
  it('次版本更高(跨个位)→ true', () => expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true))
  it('相等 → false', () => expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false))
  it('更低 → false', () => expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false))
  it('剥离前导 v', () => expect(isNewerVersion('v1.0.1', '1.0.0')).toBe(true))
  it('非法串 → 安全 false(不误报更新)', () => {
    expect(isNewerVersion('abc', '1.0.0')).toBe(false)
    expect(isNewerVersion('', '1.0.0')).toBe(false)
  })
})
```

- [ ] **Step 2: 运行验证失败** — `npx vitest run updateCheck`,预期 FAIL(模块不存在)。

- [ ] **Step 3: 实现**(`desktop/src/main/updateCheck.ts`,先只放纯函数)

```ts
/** 语义化版本比较:latest 是否严格新于 current。剥离前导 v;非法串一律 false(不误报)。 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = String(v ?? '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = parse(latest), b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}
```

- [ ] **Step 4: 运行验证通过** — `npx vitest run updateCheck && npm run typecheck`,预期全绿。

- [ ] **Step 5: 提交**

```bash
git add src/main/updateCheck.ts test/updateCheck.test.ts
git commit -m "feat(desktop): 版本比较纯逻辑 isNewerVersion"
```

---

### Task 3: 通知式更新检查 `checkForUpdates()`

**Files:**
- Modify: `desktop/src/main/updateCheck.ts`(补 `checkForUpdates`)

**Interfaces:**
- Consumes:`isNewerVersion`(Task 2)、Electron `app`/`Notification`/`shell`。
- Produces:`checkForUpdates(deps): Promise<void>`(deps 注入便于将来测试:`{ isPackaged, currentVersion, notify, openExternal, fetchLatest }`,默认实参用真实 Electron/fetch)。

- [ ] **Step 1: 实现**(追加到 `updateCheck.ts`)

```ts
import { app, Notification, shell } from 'electron'

const REPO = 'JavaLyHn/wraith'

interface LatestRelease { tag_name: string; html_url: string }

async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'wraith-desktop' },
    })
    if (!res.ok) return null
    const j = await res.json() as LatestRelease
    return (j && typeof j.tag_name === 'string' && typeof j.html_url === 'string') ? j : null
  } catch {
    return null // 离线/限流 → 静默
  }
}

/** 仅打包态执行;有新版 → 弹通知,点击打开下载页。失败静默,绝不阻塞启动。 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  const latest = await fetchLatestRelease()
  if (!latest) return
  if (!isNewerVersion(latest.tag_name, app.getVersion())) return
  const n = new Notification({
    title: 'Wraith 有新版本',
    body: `${latest.tag_name} 可用,点击前往下载页更新。`,
  })
  n.on('click', () => { void shell.openExternal(latest.html_url) })
  n.show()
}
```

- [ ] **Step 2: 验证** — `npm run typecheck && npm run build`,预期 0 错(纯集成、无新单测:fetch/Notification 属副作用,靠 typecheck + 眼验)。

- [ ] **Step 3: 提交**

```bash
git add src/main/updateCheck.ts
git commit -m "feat(desktop): 通知式更新检查(GitHub Releases,seam 预留自动更新)"
```

---

### Task 4: 图标生成脚本(WR 标 → .icns + dev PNG)

**Files:**
- Create: `desktop/scripts/gen-icon.mjs`
- Modify: `desktop/package.json`(加 `sharp` devDep + `gen:icon` 脚本)
- 产物(git 追踪):`desktop/build/icon.icns`、`desktop/build/icon-512.png`

- [ ] **Step 1: 加 sharp devDep**

```bash
npm i -D sharp --legacy-peer-deps
```

- [ ] **Step 2: 写脚本**(`desktop/scripts/gen-icon.mjs`)

```js
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const SRC = path.join(ROOT, 'src/renderer/assets/logo-light.png') // 透明底浅色标
const BUILD = path.join(ROOT, 'build')
const ICONSET = path.join(BUILD, 'icon.iconset')

const CANVAS = 1024, TILE = 824, RADIUS = 185, MARK = 560, TILE_COLOR = '#1C1B2A'
const off = Math.round((CANVAS - TILE) / 2)

mkdirSync(BUILD, { recursive: true })
rmSync(ICONSET, { recursive: true, force: true })
mkdirSync(ICONSET, { recursive: true })

// 深色圆角瓷砖(居中于 1024 透明画布)
const tileSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
     <rect x="${off}" y="${off}" width="${TILE}" height="${TILE}" rx="${RADIUS}" ry="${RADIUS}" fill="${TILE_COLOR}"/>
   </svg>`)

const mark = await sharp(SRC)
  .resize(MARK, MARK, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer()

const master = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: tileSvg }, { input: mark, gravity: 'center' }])
  .png().toBuffer()

writeFileSync(path.join(BUILD, 'icon-master.png'), master)
writeFileSync(path.join(BUILD, 'icon-512.png'), await sharp(master).resize(512, 512).png().toBuffer())

// iconset:各尺寸 + @2x
const sizes = [16, 32, 128, 256, 512]
for (const s of sizes) {
  writeFileSync(path.join(ICONSET, `icon_${s}x${s}.png`), await sharp(master).resize(s, s).png().toBuffer())
  writeFileSync(path.join(ICONSET, `icon_${s}x${s}@2x.png`), await sharp(master).resize(s * 2, s * 2).png().toBuffer())
}

execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', path.join(BUILD, 'icon.icns')])
console.log('icon.icns + icon-512.png generated')
if (!existsSync(path.join(BUILD, 'icon.icns'))) { console.error('icon.icns 未生成'); process.exit(1) }
```

- [ ] **Step 3: package.json 加脚本**:`"gen:icon": "node scripts/gen-icon.mjs"`。

- [ ] **Step 4: 运行验证** — `npm run gen:icon`;断言 `build/icon.icns` 与 `build/icon-512.png` 存在;`sips -g pixelWidth build/icon-512.png` == 512。人工瞄一眼 `build/icon-master.png`:深底圆角、WR 标居中、紫斜杠可见。

- [ ] **Step 5: 提交**(含产物,便于打包免每次生成)

```bash
git add scripts/gen-icon.mjs package.json package-lock.json build/icon.icns build/icon-512.png build/icon-master.png
git commit -m "feat(desktop): WR 标生成 App 图标(.icns + dev PNG)"
```

---

### Task 5: 捆绑 JRE(jlink)+ prepare-resources

**Files:**
- Create: `desktop/scripts/gen-jre.mjs`
- Create: `desktop/scripts/prepare-resources.mjs`
- Modify: `desktop/package.json`(脚本 `gen:jre`、`prepare:resources`)
- Modify: `desktop/.gitignore`(忽略 `resources/`——产物大、每次由脚本生成)

**Interfaces:**
- 产物:`desktop/resources/runtime/bin/java`(jlink JRE)、`desktop/resources/wraith.jar`。

- [ ] **Step 1: 写 gen-jre.mjs**

```js
import { execFileSync } from 'node:child_process'
import { rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const OUT = path.join(ROOT, 'resources', 'runtime')

// jar 依赖 + 运行时 TLS(jdeps 检不到 crypto provider,显式补 jdk.crypto.ec)
const MODULES = [
  'java.base', 'java.desktop', 'java.management', 'java.naming',
  'java.net.http', 'java.security.jgss', 'java.sql', 'jdk.httpserver',
  'jdk.crypto.ec',
].join(',')

rmSync(OUT, { recursive: true, force: true }) // jlink 要求 output 不存在
execFileSync('jlink', [
  '--add-modules', MODULES,
  '--output', OUT,
  '--strip-debug', '--no-header-files', '--no-man-pages',
], { stdio: 'inherit' })

const java = path.join(OUT, 'bin', 'java')
if (!existsSync(java)) { console.error('jlink 未产出 java:', java); process.exit(1) }
execFileSync(java, ['-version'], { stdio: 'inherit' }) // 冒烟:能起
console.log('bundled JRE →', OUT)
```

- [ ] **Step 2: 写 prepare-resources.mjs**(拷 jar + 确保 runtime)

```js
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const REPO = path.resolve(ROOT, '..')            // 仓库根
const JAR_SRC = path.join(REPO, 'target', 'wraith-1.0-SNAPSHOT.jar')
const RES = path.join(ROOT, 'resources')

if (!existsSync(JAR_SRC)) { console.error('缺 jar,请先在仓库根跑 mvn -q clean package -DskipTests:', JAR_SRC); process.exit(1) }
mkdirSync(RES, { recursive: true })
copyFileSync(JAR_SRC, path.join(RES, 'wraith.jar'))
if (!existsSync(path.join(RES, 'runtime', 'bin', 'java'))) {
  execFileSync('node', [path.join(DIR, 'gen-jre.mjs')], { stdio: 'inherit' })
}
console.log('resources 就绪:wraith.jar + runtime')
```

- [ ] **Step 3: package.json 脚本 + .gitignore**:
  - 脚本:`"gen:jre": "node scripts/gen-jre.mjs"`、`"prepare:resources": "node scripts/prepare-resources.mjs"`。
  - `.gitignore` 追加 `resources/`。

- [ ] **Step 4: 运行验证** — 仓库根先 `mvn -q clean package -DskipTests`;再 `desktop/` 下 `npm run prepare:resources`;断言 `resources/wraith.jar`、`resources/runtime/bin/java` 存在且 `-version` 正常。

- [ ] **Step 5: 提交**

```bash
git add scripts/gen-jre.mjs scripts/prepare-resources.mjs package.json .gitignore
git commit -m "feat(desktop): jlink 捆绑 JRE + prepare-resources(jar+runtime)"
```

---

### Task 6: electron-builder 配置 + dist 脚本

**Files:**
- Create: `desktop/electron-builder.yml`
- Modify: `desktop/package.json`(`electron-builder` devDep + `dist:mac` 脚本)

- [ ] **Step 1: 加 electron-builder devDep**

```bash
npm i -D electron-builder --legacy-peer-deps
```

- [ ] **Step 2: 写 electron-builder.yml**

```yaml
appId: com.lyhn.wraith
productName: Wraith
directories:
  output: release
  buildResources: build
files:
  - out/**
mac:
  target: [dmg, zip]
  category: public.app-category.developer-tools
  icon: build/icon.icns
  identity: null   # ad-hoc / 不签名
extraResources:
  - from: resources/wraith.jar
    to: wraith.jar
  - from: resources/runtime
    to: runtime
```

- [ ] **Step 3: package.json 脚本**:
  `"dist:mac": "CSC_IDENTITY_AUTO_DISCOVERY=false electron-vite build && npm run prepare:resources && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac"`。

- [ ] **Step 4: 验证(构建冒烟,可能耗时)** — 仓库根先出 jar;`desktop/` 下 `npm run dist:mac`;断言 `release/` 下出现 `Wraith-*.dmg`。若 jlink/iconutil 环境缺失导致失败,记录并回报(不猜)。

- [ ] **Step 5: 提交**

```bash
git add electron-builder.yml package.json package-lock.json
git commit -m "feat(desktop): electron-builder mac 打包配置 + dist:mac"
```

---

### Task 7: 主进程接线(图标 + dock + packaged sidecar + 更新检查)

**Files:**
- Modify: `desktop/src/main/index.ts`

**Interfaces:**
- Consumes:Task 1 `resolveBackendCommand(env, jar, packaged?)`、Task 3 `checkForUpdates`、Task 4 `build/icon-512.png`。

- [ ] **Step 1: 图标路径解析 + BrowserWindow/dock**(`createWindow`/`BrowserWindow` 处)

```ts
// dev:指向源产物;packaged:mac 由 .icns 提供 dock 图标,此处主要惠及 win/linux 与 dev dock
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon-512.png') // 若需要,可在 extraResources 追加;mac 打包态非必需
  : path.join(__dirname, '../../build/icon-512.png')

mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  icon: iconPath, // mac 忽略窗口 icon,但对 win/linux 生效;无害
  webPreferences: { contextIsolation: true, nodeIntegration: false, preload: preloadPath },
})
```

并在 `app.whenReady()`(dev 期去原子标):

```ts
if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
  try { app.dock.setIcon(path.join(__dirname, '../../build/icon-512.png')) } catch { /* 忽略 */ }
}
```

- [ ] **Step 2: spawnBackend 传 packaged 态**(`spawnBackend()` 内)

```ts
const jar = defaultJarPath(os.homedir())
const { cmd, args } = resolveBackendCommand(
  process.env, jar,
  app.isPackaged ? { resourcesPath: process.resourcesPath } : undefined,
)
```

（gatewayManager 的构造/调用点同理传 `app.isPackaged ? { resourcesPath: process.resourcesPath } : undefined`。）

- [ ] **Step 3: 启动时检查更新** — `app.whenReady()` 内(或首帧后)`void checkForUpdates()`(内部已 guard `isPackaged`、失败静默)。

- [ ] **Step 4: 验证** — `npm run typecheck && npm run build`,预期 0 错。

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts
git commit -m "feat(desktop): 主进程接线——图标/dock + packaged sidecar + 更新检查"
```

---

### Task 8: 端到端打包 + 眼验(验证任务,无单测)

**Files:** 无代码改动(纯验证);如需修 bug 则回到对应 Task。

- [ ] **Step 1:** 仓库根 `mvn -q clean package -DskipTests`(出最新 jar)。
- [ ] **Step 2:** `desktop/` 下 `npm run dist:mac` → 得 `release/Wraith-*.dmg`。
- [ ] **Step 3:** 打开 dmg → 拖入 /Applications → **右键→打开**(过 Gatekeeper)。
- [ ] **Step 4 眼验清单:**
  - dock/程序坞显 **WR 标**,不显 Electron 原子标。
  - 冷启动能拉起**捆绑 JRE**(activity monitor 里 java 指向 `Wraith.app/Contents/Resources/runtime/bin/java`),对话正常(**验证 TLS**:能连 provider 出结果)。
  - `~/.wraith/config.json` 仍被读到(已配 key 的照常可用)。
  - (可选)本地造一个更高 tag 的 GitHub pre-release → 启动弹「有新版本」通知 → 点击打开下载页。
- [ ] **Step 5:** 眼验 OK → 交付(FF/merge 前点头;README 补「首启右键打开」「~200MB」说明可另开小提交)。

---

## Self-Review

- **Spec 覆盖**:图标(T4/T7)、打包(T6)、JRE 捆绑(T5)、sidecar packaged 解析(T1/T7)、gateway 镜像(T1/T7)、通知式更新(T2/T3/T7)、密钥面不变(全程无 key 入包)、眼验(T8)——spec 各节均有对应任务。
- **类型一致**:`resolveBackendCommand` 第三参 `packaged?: {resourcesPath}` 在 T1 定义、T7 消费,签名一致;`isNewerVersion`/`checkForUpdates` T2→T3→T7 链一致。
- **占位符**:无 TBD;图标去白问题因已核实 PNG 透明底而消解(直接合成)。
- **顺序**:T1/T2 纯逻辑先行(cheap 模型);T3 集成;T4/T5/T6 脚本+配置;T7 接线;T8 e2e。T7 依赖 T1/T3/T4 产物,排在其后。
