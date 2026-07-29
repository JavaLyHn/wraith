# wraith Windows 对等 —— 块 4:Windows 打包(设计)

- 日期:2026-07-28
- 范围:产出可分发的 **Windows NSIS 安装包(未签名)**。分工:mac 上写配置/脚本/文档 + 打包态后端路径修复;**用户在自己的 Windows 机器上原生构建 + 眼验**。不加 CI、不签名。macOS 打包不变。
- Windows 功能对等总目标(5 块)的第 4 块。见记忆 [[wraith-windows-parity]]。

## 1. 背景与既有结论

- **打包现状**:`desktop/electron-builder.yml` 只有 `mac:` target(dmg/zip,`icon: build/icon.icns`,`identity: null` 不签名)。`extraResources` 打入 `resources/wraith.jar` + `resources/runtime`;`asarUnpack` 打入 `node-pty`。`dist:mac` 脚本 = `electron-vite build && npm run prepare:resources && electron-builder --mac`。
- **捆绑 JRE**:`scripts/gen-jre.mjs` 跑**本机 jlink** → 产宿主平台 runtime(Windows 上跑 = Windows runtime,原生)。冒烟检查路径写死 `bin/java`(Windows 是 `bin\java.exe`)。
- **资源准备**:`scripts/prepare-resources.mjs` 拷 `target/wraith-1.0-SNAPSHOT.jar` → `resources/wraith.jar`,并在 `resources/runtime/bin/java` 不存在时调 gen-jre(Windows 是 `java.exe`)。
- **打包态后端启动**:`backend.ts` 的 `packagedBackendCommand(resourcesPath)` 返回 `cmd = path.join(resourcesPath,'runtime','bin','java')`——**Windows 上应为 `java.exe`**(块 1 只修了 dev 态 `spawn('java')`,打包态这处一直是 Windows 真 bug)。
- **图标**:`scripts/gen-icon.mjs` 用 `sharp` 造 master PNG + iconset,再用 **macOS 专属 `iconutil`** 出 `.icns`(sharp 不直接出 `.ico`)。`desktop/build/icon.icns` 与 `icon-512.png` **已入 git**(master/iconset 被 gitignore)。
- **node-pty**:原生插件;Windows 上 `npm install` + `@electron/rebuild` 本地编译即得,故本机 Windows 构建无交叉编译问题。
- **决策(用户)**:有 Windows 环境;**不签名、不 CI**;NSIS = **向导式**(oneClick:false);`.ico` = **加 png-to-ico 在 mac 生成并提交**。

## 2. 目标与非目标

**目标(块 4)**
1. `electron-builder.yml` 具备可用的 `win:` + `nsis:` 配置(向导式、未签名),Windows 上 `npm run dist:win` 能产出 NSIS 安装包。
2. 打包态后端在 Windows 用 `runtime\bin\java.exe`(修 `packagedBackendCommand`)。
3. `gen-jre.mjs`/`prepare-resources.mjs` 的 java 可执行体路径在 win32 用 `java.exe`。
4. `build/icon.ico`(多尺寸)由 mac 上的 `gen-icon.mjs` 生成并提交。
5. Windows 打包上手文档(前置/步骤/产物位置/未签名+SmartScreen 说明)。

**非目标(YAGNI/后续)**
- 代码签名(未签名 + SmartScreen「更多信息→仍要运行」文档,同 mac 现状)。
- CI(GitHub Actions 等)——用户本机 Windows 构建。
- 自动更新(electron-updater / latest.yml)。
- macOS 打包改动(`mac:`/`dist:mac`/`.icns` 均不动)。
- 编辑器 32 位路径(块 3 待办,另计)。

## 3. 交付物与详细需求

### 3.1 打包态后端路径修复(`backend.ts`,唯一实际逻辑、可单测)
- `packagedBackendCommand(resourcesPath: string, platform: NodeJS.Platform)`:`platform === 'win32'` → java 可执行体 `path.join(resourcesPath, 'runtime', 'bin', 'java.exe')`,否则 `.../bin/java`。`args` 不变(`['-jar', <resourcesPath>/wraith.jar, 'app-server']`)。
- `resolveBackendCommand(env, defaultJar, packaged?)` 调 `packagedBackendCommand(packaged.resourcesPath, process.platform)`(把 `process.platform` 传进去;为保持纯测试,`resolveBackendCommand` 可加可选 `platform` 参数默认 `process.platform`,或在调用处传入——实现细节见计划)。
- dev 路径(`cmd:'java'`)不变(块 1 已处理,Windows CreateProcess 解析 java.exe)。

### 3.2 打包脚本 java.exe 兼容(`gen-jre.mjs` / `prepare-resources.mjs`)
- `gen-jre.mjs`:冒烟检查的 `const java = path.join(OUT,'bin','java')` → win32 用 `'java.exe'`。
- `prepare-resources.mjs`:`resources/runtime/bin/java` 存在性检查 → win32 用 `'java.exe'`。
- 两脚本仍跑**本机 jlink**(Windows 上即产 Windows runtime),逻辑不变,仅可执行体名按平台。

### 3.3 `.ico` 生成(`gen-icon.mjs` + png-to-ico)
- 加 devDependency `png-to-ico`(纯 JS,mac 可跑)。
- `gen-icon.mjs` 在产 `.icns` 的同时,从 master buffer 派生多尺寸 PNG(16/32/48/64/128/256)→ `png-to-ico` → 写 `build/icon.ico`。
- 在 mac 上运行 `npm run gen:icon` 生成 `build/icon.ico` 并**提交**(与 `icon.icns` 同惯例)。**只提交 `build/icon.ico`**;若该次运行顺带改写了已入 git 的 `icon-512.png`/`icon.icns`(sharp/libvips 版本差异致字节变化),**还原**这两个文件、不提交其 churn。

### 3.4 `electron-builder.yml` `win:` + `nsis:`
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
不配任何签名字段(未签名)。`extraResources`/`asarUnpack`/`directories` 复用现有(平台无关)。

### 3.5 `dist:win` 脚本(`package.json`)
- `"dist:win": "electron-vite build && npm run prepare:resources && electron-builder --win"`。
- 不需要 mac 的 `CSC_IDENTITY_AUTO_DISCOVERY`(那是 macOS 签名开关)。

### 3.6 Windows 打包文档(`docs/windows-dev.md` 新增"打包"段)
- 前置:JDK(供 jlink,建议 17+)、Node、Maven,均在 PATH。
- 步骤:①仓库根 `mvn -q clean package -DskipTests`(出 `target/wraith-*.jar`);②`cd desktop && npm install`(拿原生 node-pty);③`npm run dist:win`。
- 产物:`desktop/release/`(electron-builder `output: release`)下的 `*.exe` NSIS 安装包。
- **未签名说明**:首次运行 Windows SmartScreen 报「未知发布者」→「更多信息 → 仍要运行」;根治需 Authenticode 证书(未做,同 mac 的 xattr 姿态)。
- 验收清单补:安装包能装、装完能启动、核心功能(聊天/终端/记忆/窗控/编辑器打开)通。

## 4. 测试策略

- **mac 上可跑(块 4 CI 门槛)**:
  - `packagedBackendCommand(resourcesPath, platform)` 单测:darwin/linux → `.../runtime/bin/java`;win32 → `...\\runtime\\bin\\java.exe`;args 不变。`resolveBackendCommand` 既有测试不回归。
  - 真跑 `npm run gen:icon`(mac),确认 `build/icon.ico` 生成且非空(可读文件头/大小)。
  - `electron-builder.yml` 能被 YAML 解析(结构合法)。
  - `npm run typecheck` 净;既有 vitest 不回归。
- **须 Windows 实机(用户)**:`npm run dist:win` 真出安装包、装、跑、核心功能眼验。
- **诚实边界**:本环境 macOS,**无法验证 Windows NSIS 构建与安装运行**;交付 = 配置/脚本/文档 + java.exe 修复单测 + mac 上验证的 icon.ico 生成。

## 5. 成功标准

- `packagedBackendCommand` win32=java.exe 修复有单测并绿;既有 backend 测试不回归。
- `gen-icon.mjs` 产出 `build/icon.ico`(mac 上验证);已提交。
- `electron-builder.yml` 有合法 `win:`/`nsis:` 段(向导式、未签名);`dist:win` 脚本就位;`gen-jre`/`prepare-resources` java.exe 兼容。
- `tsc` 净、既有 vitest 不回归、macOS 打包配置/脚本未改。
- `docs/windows-dev.md` 有 Windows 打包段(步骤 + 产物 + 未签名说明 + 验收清单)。

## 6. 后续块(总路线)

5. 桌宠原生 Win32 插件(`WS_EX_NOACTIVATE` + 跨虚拟桌面)。
（编辑器 32 位路径、注册表探测等块 3 待办,可并入块 5 或单列小增强。）
