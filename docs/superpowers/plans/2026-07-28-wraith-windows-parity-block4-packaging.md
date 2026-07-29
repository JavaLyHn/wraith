# Windows 对等 块4:Windows 打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 wraith 桌面能在用户的 Windows 机器上原生构建出未签名 NSIS 安装包;mac 打包不变。

**Architecture:** mac 上写配置/脚本/文档 + 打包态后端路径修复(可单测);真 NSIS 构建+安装+运行由用户在 Windows 上做。核心代码逻辑只有 `packagedBackendCommand` 的 win32=java.exe 修复;其余是打包脚本的 java.exe 兼容、`.ico` 生成(mac 上真跑验证)、electron-builder.yml 的 win/nsis 段、dist:win 脚本、文档。

**Tech Stack:** Electron 32 + electron-builder 26(NSIS)、electron-vite、vitest、sharp + png-to-ico(图标)、本机 jlink(捆绑 JRE)。

## Global Constraints

- 语言:注释/文档中文;代码/命令/路径原样。
- 分支 `feat/windows-parity-block1`(Windows 系列同分支,已 checkout,直接提交)。工作目录 /Users/aa00945/Desktop/wraith;桌面命令在 desktop/ 下跑。
- **不改 Java 后端、不改 mac 打包**(`electron-builder.yml` 的 `mac:` 段、`dist:mac`、`build/icon.icns`、gen-icon 的 icns 分支均不动)。
- 每个代码任务结束:`cd desktop && npm run typecheck`(tsc 0)+ `npm run test`(vitest 全绿、不回归)。
- `git add` 只加本任务涉及文件,禁止 `git add .`/`-A`;**绝不碰** WIP 文件(README.md、demo/pom.xml、.claude/settings.json、demo/src/Hello.java、progress.md、.superpowers/)。
- 提交信息中文,结尾逐字附:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- 诚实边界:本环境 macOS,**无法验证 Windows NSIS 构建与安装运行**;交付 = 配置/脚本/文档 + java.exe 修复单测 + mac 上验证的 icon.ico 生成。真构建/安装/运行归用户 Windows 实机。

## 文件结构

- `desktop/src/main/backend.ts`(改)+ `desktop/test/backend.test.ts`(改):`packagedBackendCommand` 加 platform、win32→java.exe。
- `desktop/scripts/gen-jre.mjs`(改)、`desktop/scripts/prepare-resources.mjs`(改):java 可执行体名按平台。
- `desktop/package.json`(改)+ `desktop/package-lock.json`(改)+ `desktop/scripts/gen-icon.mjs`(改)+ `desktop/build/icon.ico`(新,生成物):png-to-ico + .ico。
- `desktop/electron-builder.yml`(改)+ `desktop/package.json`(改,加 dist:win):win/nsis 配置。
- `docs/windows-dev.md`(改):打包段。

---

### Task 1: packagedBackendCommand win32=java.exe(可单测)

**Files:**
- Modify: `desktop/src/main/backend.ts`
- Test: `desktop/test/backend.test.ts`

**Interfaces:**
- `packagedBackendCommand(resourcesPath: string, platform: NodeJS.Platform): { cmd: string; args: string[] }` —— win32→`runtime/bin/java.exe`,else→`runtime/bin/java`。
- `resolveBackendCommand(env, defaultJar, packaged?, platform: NodeJS.Platform = process.platform)` —— packaged 分支调 `packagedBackendCommand(packaged.resourcesPath, platform)`。

- [ ] **Step 1: 写失败测试**

先读 `desktop/test/backend.test.ts`。顶部若无 `import path`,加 `import path from 'node:path'`。把现有对 `packagedBackendCommand('/res')`(单参)的调用改为传平台(如 `'darwin'`,保持原断言)。追加:

```ts
describe('packagedBackendCommand platform', () => {
  it('win32 → runtime/bin/java.exe', () => {
    const r = packagedBackendCommand('/res', 'win32')
    expect(r.cmd).toBe(path.join('/res', 'runtime', 'bin', 'java.exe'))
    expect(r.args).toEqual(['-jar', path.join('/res', 'wraith.jar'), 'app-server'])
  })
  it('darwin/linux → runtime/bin/java', () => {
    expect(packagedBackendCommand('/res', 'darwin').cmd).toBe(path.join('/res', 'runtime', 'bin', 'java'))
    expect(packagedBackendCommand('/res', 'linux').cmd).toBe(path.join('/res', 'runtime', 'bin', 'java'))
  })
})

describe('resolveBackendCommand packaged platform', () => {
  it('packaged + win32 → 捆绑 java.exe', () => {
    const r = resolveBackendCommand({}, '/home/.wraith/wraith.jar', { resourcesPath: '/res' }, 'win32')
    expect(r.cmd).toBe(path.join('/res', 'runtime', 'bin', 'java.exe'))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/backend.test.ts`
Expected: FAIL —— `packagedBackendCommand` 现只接一个参数,新用例与之不符(或类型/断言不符)。

- [ ] **Step 3: 写实现**

改 `desktop/src/main/backend.ts`:

```ts
/** 打包态:用捆绑 JRE 的 java + 捆绑 jar 跑 app-server。Windows 可执行体是 java.exe。 */
export function packagedBackendCommand(resourcesPath: string, platform: NodeJS.Platform): { cmd: string; args: string[] } {
  const javaBin = platform === 'win32' ? 'java.exe' : 'java'
  return {
    cmd: path.join(resourcesPath, 'runtime', 'bin', javaBin),
    args: ['-jar', path.join(resourcesPath, 'wraith.jar'), 'app-server'],
  }
}
```

并把 `resolveBackendCommand` 签名加可选 `platform`,packaged 分支透传:

```ts
export function resolveBackendCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string,
  packaged?: { resourcesPath: string },
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
  const override = env['WRAITH_APPSERVER_CMD']
  if (override && override.trim().length > 0) {
    const tokens = override.trim().split(/\s+/)
    const [cmd, ...args] = tokens
    return { cmd: cmd!, args }
  }
  if (packaged) return packagedBackendCommand(packaged.resourcesPath, platform)
  return { cmd: 'java', args: ['-jar', defaultJar, 'app-server'] }
}
```

(`index.ts:207` 的调用 `resolveBackendCommand(process.env, defaultJarPath(os.homedir()), app.isPackaged ? {...} : undefined)` 因 platform 有默认值,无需改;dev 分支 `cmd:'java'` 不变。)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/backend.test.ts`
Expected: PASS(新用例 + 既有用例)。

- [ ] **Step 5: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0;vitest 全绿(不回归)。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/main/backend.ts desktop/test/backend.test.ts
git commit -m "fix(windows): packagedBackendCommand 打包态 win32 用 java.exe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 2: gen-jre / prepare-resources 的 java.exe 兼容

**Files:**
- Modify: `desktop/scripts/gen-jre.mjs`
- Modify: `desktop/scripts/prepare-resources.mjs`

**Interfaces:** 无导出契约;仅让两脚本在 win32 用 `java.exe` 作可执行体名。

- [ ] **Step 1: 改 gen-jre.mjs 冒烟路径**

在 `desktop/scripts/gen-jre.mjs`,把:

```js
const java = path.join(OUT, 'bin', 'java')
```

改为:

```js
const java = path.join(OUT, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
```

(其余不变;`execFileSync('jlink', …)` 在 Windows 上是本机 jlink,产 Windows runtime。)

- [ ] **Step 2: 改 prepare-resources.mjs 存在性检查**

在 `desktop/scripts/prepare-resources.mjs`,把:

```js
if (!existsSync(path.join(RES, 'runtime', 'bin', 'java'))) {
```

改为:

```js
if (!existsSync(path.join(RES, 'runtime', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) {
```

- [ ] **Step 3: 语法自检(mac 上 node 解析)**

Run: `cd desktop && node --check scripts/gen-jre.mjs && node --check scripts/prepare-resources.mjs && echo OK`
Expected: `OK`(仅语法;不实际跑 jlink——那会改本机 runtime,非本任务目的)。

- [ ] **Step 4: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/scripts/gen-jre.mjs desktop/scripts/prepare-resources.mjs
git commit -m "fix(windows): gen-jre/prepare-resources 的 java 可执行体名按平台(win32=java.exe)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 3: png-to-ico + gen-icon.mjs 产 build/icon.ico

**Files:**
- Modify: `desktop/package.json`(devDependencies)+ `desktop/package-lock.json`
- Modify: `desktop/scripts/gen-icon.mjs`
- Create(生成物): `desktop/build/icon.ico`

**Interfaces:** 无导出契约;`gen-icon.mjs` 额外产出 `build/icon.ico`。

- [ ] **Step 1: 加 png-to-ico 依赖**

Run: `cd desktop && npm install --save-dev png-to-ico`
(会更新 package.json + package-lock.json。)

- [ ] **Step 2: 扩展 gen-icon.mjs 产 .ico**

在 `desktop/scripts/gen-icon.mjs` 顶部 import 区加:

```js
import pngToIco from 'png-to-ico'
```

在文件末尾(`iconutil` 产 icns 之后、最终 console.log 之前)加:

```js
// Windows 多尺寸 .ico(从 master 派生;png-to-ico 纯 JS,mac 可跑)
const icoSizes = [16, 32, 48, 64, 128, 256]
const icoPngs = await Promise.all(icoSizes.map(s => sharp(master).resize(s, s).png().toBuffer()))
writeFileSync(path.join(BUILD, 'icon.ico'), await pngToIco(icoPngs))
if (!existsSync(path.join(BUILD, 'icon.ico'))) { console.error('icon.ico 未生成'); process.exit(1) }
```

(把最终 console.log 文案顺带更新为含 `icon.ico`。)

- [ ] **Step 3: 在 mac 上真跑 gen:icon 并验证 .ico**

Run: `cd desktop && npm run gen:icon && ls -la build/icon.ico`
Expected: 命令成功;`build/icon.ico` 存在且大小 > 0(多尺寸 ico 一般 数十~上百 KB)。

- [ ] **Step 4: 只提交 icon.ico + 依赖/脚本,还原被顺带改写的既有图标**

`npm run gen:icon` 会重写 `build/icon-512.png` 与 `build/icon.icns`(已入 git)——若它们出现字节 churn(sharp/libvips 版本差异),**还原**、不提交其 churn:

```bash
cd /Users/aa00945/Desktop/wraith
git checkout -- desktop/build/icon-512.png desktop/build/icon.icns   # 还原可能的 churn(若无改动此命令无害)
git add desktop/package.json desktop/package-lock.json desktop/scripts/gen-icon.mjs desktop/build/icon.ico
git status --short   # 确认只暂存了这 4 项、icon-512/icns 未被改
```

- [ ] **Step 5: typecheck + 全量 vitest(确保依赖变更未破坏构建)**

Run: `cd desktop && npm run typecheck && npm run test`
Expected: tsc 0;vitest 全绿。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git commit -m "feat(windows): png-to-ico + gen-icon 产多尺寸 build/icon.ico

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 4: electron-builder.yml win/nsis + dist:win 脚本

**Files:**
- Modify: `desktop/electron-builder.yml`
- Modify: `desktop/package.json`(scripts.dist:win)

**Interfaces:** 无导出契约;新增 Windows 打包配置 + 脚本。

- [ ] **Step 1: 补 win/nsis 段**

在 `desktop/electron-builder.yml` 里,在现有 `mac:` 段之后(与之并列)加:

```yaml
win:
  target: [nsis]
  icon: build/icon.ico
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
```

(不加任何签名字段 → 未签名。`extraResources`/`asarUnpack`/`directories` 保持不动,平台无关。`mac:` 段一字不改。)

- [ ] **Step 2: 加 dist:win 脚本**

在 `desktop/package.json` 的 `scripts` 里加:

```json
"dist:win": "electron-vite build && npm run prepare:resources && electron-builder --win"
```

- [ ] **Step 3: 校验 YAML 可解析 + package.json 合法**

Run: `cd desktop && node -e "const yaml=require('js-yaml');const fs=require('fs');const d=yaml.load(fs.readFileSync('electron-builder.yml','utf8'));if(!d.win||!d.win.target.includes('nsis'))throw new Error('win/nsis 缺失');console.log('yaml ok, win.target=',d.win.target)"`
（若无 js-yaml,退而用 `node -e "require('fs').readFileSync('electron-builder.yml','utf8')"` 并肉眼核 YAML 缩进;`node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts['dist:win']"` 确认脚本存在。）
Expected:打印 `yaml ok, win.target= [ 'nsis' ]`(或肉眼确认结构正确)。

- [ ] **Step 4: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/electron-builder.yml desktop/package.json
git commit -m "feat(windows): electron-builder win/nsis(向导式未签名)+ dist:win 脚本

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

### Task 5: docs/windows-dev.md 打包段

**Files:**
- Modify: `docs/windows-dev.md`

- [ ] **Step 1: 加"打包(生成 Windows 安装包)"段**

先读 `docs/windows-dev.md`。追加一节(在合适位置,如"已知降级"之前):

````markdown
## 打包:生成 Windows 安装包(在 Windows 机器上)

前置(均在 PATH):JDK(供 jlink,建议 17+)、Node、Maven。

```powershell
# 1) 仓库根:构建后端 jar
mvn -q clean package -DskipTests
# 2) 桌面依赖(含原生 node-pty)
cd desktop
npm install
# 3) 打包(向导式 NSIS,未签名)
npm run dist:win
```

产物:`desktop/release/` 下的 `*.exe` NSIS 安装包。

**未签名说明**:安装包未做代码签名,首次运行 Windows SmartScreen 会提示「Windows 已保护你的电脑 / 未知发布者」——点「更多信息 → 仍要运行」即可(与 macOS 版的 xattr 绕过同性质)。根治需 Authenticode 证书,暂未做。
````

并在"验收清单"追加:

```markdown
- [ ] `npm run dist:win` 能产出 `desktop/release/*.exe`
- [ ] 双击安装包能装(可选安装目录)、装完能从开始菜单/桌面快捷方式启动
- [ ] 安装版启动后核心功能(聊天/终端/记忆/窗控/编辑器打开)通
```

- [ ] **Step 2: 校对**

肉眼确认:命令可复制、产物路径 `desktop/release/` 正确、未签名说明清楚、无占位符。

- [ ] **Step 3: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add docs/windows-dev.md
git commit -m "docs(windows): 打包段(mvn→npm install→dist:win,产物+未签名说明+验收)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ"
```

---

## 完成判据(块 4)

- `packagedBackendCommand` win32=java.exe 单测绿;既有 backend 测试不回归;`npm run typecheck` 0。
- `gen-jre`/`prepare-resources` java 可执行体名按平台(node --check 通过)。
- `gen-icon.mjs` 产出 `build/icon.ico`(mac 上真跑验证、已提交);icon-512.png/icon.icns 未被 churn 污染。
- `electron-builder.yml` 有合法 win/nsis 段(向导式未签名);`dist:win` 脚本就位;`mac:`/`dist:mac` 未改。
- 既有 vitest 不回归。
- `docs/windows-dev.md` 有打包段(步骤+产物+未签名+验收)。
- **Windows 实机**(dist:win 真出安装包、装、跑)= 用户负责,本环境不冒领。
