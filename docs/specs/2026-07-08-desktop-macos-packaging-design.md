# 设计：桌面 App 图标 + macOS 打包/发布（v1）

日期：2026-07-08
范围：桌面（Electron 主进程接线 + 打包配置 + 图标/JRE 生成脚本 + 通知式更新）。分支 `feat/desktop-macos-packaging`（off main）。**含产物构建脚本，收尾出可安装 `.dmg` 供眼验。**

## 问题

当前桌面以 `electron-vite dev` 运行，`BrowserWindow` 未设 `icon`、无 `app.dock.setIcon()`、无任何打包配置（只有 `electron-vite build` 出 JS bundle）。因此 dock/窗口回落到 **Electron 默认原子标**，且没有可分发安装包，无法"发布第一个版本"。

应用是 **Electron + Java sidecar** 结构：主进程 `spawnBackend()` 拉起 `java -jar ~/.wraith/wraith.jar app-server`（见 `src/main/backend.ts` `resolveBackendCommand`）。打包成自包含 `.app` 必须解决三件事：图标、Java 运行时随包、可分发/可更新。

## 决策（已与用户确认）

- **仅 macOS**（用户在 mac，先落地 mac 版；win/linux 后续）。
- **暂不签名（ad-hoc / unsigned）**：零成本，用户首启需右键→打开绕过 Gatekeeper。
- **捆绑 jlink 精简 JRE（自包含）**：用户零配置双击即用，代价是包体 +~45MB。
- **图标沿用现有 WR 标**：合成到规范 App 图标瓷砖，不重画品牌。
- **更新走 GitHub Releases，v1 为「通知式」**（见下"关键约束"）。

## 关键约束：未签名 mac 应用无法原地自动更新

macOS Squirrel.Mac（`electron-updater` 底层）**要求应用有有效签名**才能应用更新——ad-hoc/未签名包在签名校验处失败，做不到下载后原地替换。因此"暂不签名"与"自动更新"不可兼得，v1 折中：

- **v1 = 通知式更新**：启动时查 GitHub Releases 最新版，有新版 → 弹提示 + `shell.openExternal` 打开下载页，用户手动下载覆盖安装。**不做原地自动安装。**
- **真·原地自动更新**留到愿意签名/公证时（phase 2）。更新逻辑做成干净 seam（`checkForUpdates()` + 纯 `isNewerVersion` 比较），届时换成 `electron-updater` 只是替换实现，不动调用方。

## 目标

1. dock/窗口/打包 App 图标显 WR 品牌标，不再显 Electron 原子标（dev 期即生效）。
2. `npm run dist:mac` 产出可安装 `.dmg`：自包含 JRE，双击（右键→打开）即可用，无需系统 Java。
3. 启动时检测新版本并通知，seam 预留未来全自动更新。
4. 密钥面不变（key 仍只在 `~/.wraith/config.json`，包内无任何密钥）。

## 非目标（YAGNI）

- 不打 Windows / Linux 包。
- 不做代码签名 / 公证 / App Store（→ Gatekeeper 右键打开）。
- 不做原地自动更新（deferred；v1 仅通知式）。
- 不搭 CI 多平台构建（v1 本机 `dist:mac` 手动发；CI 后续）。
- 不改 Java 后端代码（jar 内容不变，仅随包）。

## 现有结构（锚点）

- `desktop/src/main/backend.ts`：`defaultJarPath(homedir)`、`resolveBackendCommand(env, defaultJar)`（纯函数，有 `WRAITH_APPSERVER_CMD` env 覆写口子）。
- `desktop/src/main/index.ts:146` `spawnBackend()` 调 `resolveBackendCommand` 后 `spawn`；`BrowserWindow`（:221）无 `icon`。
- `desktop/src/main/gatewayManager.ts`：IM 网关 java spawn（`resolveGatewayCommand`/`resolveBindCommand`），同样 `java -jar ~/.wraith/wraith.jar gateway`。
- `desktop/src/renderer/assets/logo-dark.png` / `logo-light.png`：WR 字母组合标（深藏青 + 紫渐变斜杠），`Logo.tsx` 界面内用。
- `desktop/electron.vite.config.ts`：electron-vite 构建配置；`package.json` 无 `build`/electron-builder。
- 根 `target/wraith-1.0-SNAPSHOT.jar`：Java 后端产物（~32MB）。

## 设计

### §1 图标（WR 标 → App 图标 + 资源管线）

App 图标构图（macOS 不自动圆角遮罩，需自行烘焙）：

- 1024×1024 画布，透明留白；居中 ~824×824 圆角瓷砖（圆角半径 ~185，仿 Big Sur squircle），填**深藏青**（取自 mark，约 `#1C1B2A`）。
- WR 标居中（约瓷砖 55–60%），保留**紫渐变斜杠**；深底上用浅色 mark（`logo-light` 变体）。
- **透明底处理**：现有 PNG 若为白底，则合成前需去白转透明；若去白不干净，**回落方案**：在 `build/icon.svg` 用矢量路径重绘 WR（简单几何字形）。此为实现细节，Task 内定夺，二者皆产出同一构图。

资源管线（`scripts/gen-icon.mjs`，用 `sharp` devDep）：

1. 生成圆角瓷砖 SVG buffer → 1024 画布；合成 WR mark（缩放居中）→ `build/icon-master.png`。
2. `sharp` resize 出 iconset 全尺寸（16/32/64/128/256/512 及 @2x）到 `build/icon.iconset/`。
3. `iconutil -c icns build/icon.iconset -o build/icon.icns`（macOS 自带）。
4. 另出 `build/icon-512.png` 供 dev 期 `app.dock.setIcon`。

主进程接线：`BrowserWindow({ icon: <512png> })` + `if (app.dock) app.dock.setIcon(<512png>)`（dev 期立即去原子标；打包态 dock 图标由 `.icns` 提供）。图标路径按 dev/packaged 解析（dev 指向源，packaged 指向 `process.resourcesPath` 或 bundle 内）。

### §2 打包（electron-builder）

新增 `electron-builder` devDep + `electron-builder.yml`：

```yaml
appId: com.lyhn.wraith
productName: Wraith
directories:
  output: release
  buildResources: build
files:
  - out/**
mac:
  target: [dmg, zip]      # zip 为未来自动更新预留；v1 分发用 dmg
  category: public.app-category.developer-tools
  icon: build/icon.icns
  identity: null          # ad-hoc / 不签名
extraResources:
  - from: resources/wraith.jar
    to: wraith.jar
  - from: resources/runtime
    to: runtime
```

- `mac.identity: null` + 构建时 `CSC_IDENTITY_AUTO_DISCOVERY=false` 确保跳过签名。
- 脚本：
  - `"prepare:resources": "node scripts/prepare-resources.mjs"` — 从根 `target/wraith-1.0-SNAPSHOT.jar` 拷到 `desktop/resources/wraith.jar`；生成/拷 jlink runtime 到 `desktop/resources/runtime`。
  - `"dist:mac": "electron-vite build && npm run prepare:resources && electron-builder --mac"`。
- 产物 `release/Wraith-<version>.dmg` + `.zip`。

### §3 捆绑 JRE（jlink）+ sidecar 路径解析

**JRE 生成**（`scripts/gen-jre.mjs` 或纳入 prepare-resources）：

1. `jdeps --print-module-deps --ignore-missing-deps target/wraith-1.0-SNAPSHOT.jar` → 模块列表。
2. `jlink --add-modules <mods>,jdk.crypto.ec,jdk.crypto.cryptoki --output desktop/resources/runtime --strip-debug --no-header-files --no-man-pages --compress=2`。
3. **必保 TLS 模块**（provider/DeepSeek 走 HTTPS）：显式加 `jdk.crypto.ec`；冷启动眼验兜底。
4. runtime 布局：jlink 直出 `runtime/bin/java`（打包后位于 `<Wraith.app>/Contents/Resources/runtime/bin/java`）。

**sidecar 路径解析**（扩展 `backend.ts`，保持纯/可测）：

```
resolveBackendCommand(env, opts) → { cmd, args }
  opts = { defaultJar, isPackaged, resourcesPath }
  1. env.WRAITH_APPSERVER_CMD 非空 → 覆写（dev/test 最高优先，不变）
  2. isPackaged → cmd = <resourcesPath>/runtime/bin/java
                  args = ['-jar', <resourcesPath>/wraith.jar, 'app-server']
  3. 否则（dev）→ cmd = 'java', args = ['-jar', <defaultJar>, 'app-server']   # 现状
```

- `index.ts:spawnBackend()` 传入 `app.isPackaged` 与 `process.resourcesPath`。
- `gatewayManager` 的 `resolveGatewayCommand`/`resolveBindCommand` **镜像同一 packaged 分支**（用捆绑 java+jar 的 `gateway`/`gateway bind` 参数），避免打包后 IM 网关因缺系统 Java 而废。
- `~/.wraith/config.json`（密钥/配置）仍在用户目录，包内不含。

### §4 更新（通知式，seam 预留）

- `scripts` 无关；主进程新增 `src/main/updateCheck.ts`：
  - 纯函数 `isNewerVersion(latest: string, current: string): boolean`（语义化版本比较，剥离前导 `v`，处理 `x.y.z`）。
  - `checkForUpdates()`：仅 `app.isPackaged` 时执行；GET `https://api.github.com/repos/JavaLyHn/wraith/releases/latest`，取 `tag_name` 比 `app.getVersion()`；新版 → `Notification` + 点击 `shell.openExternal(release.html_url)`。
  - 失败（离线/限流）**静默**，不阻塞启动。公共仓库 latest-release 免鉴权（匿名 60 req/hr 足够）。
- seam：调用方只认 `checkForUpdates()`；phase 2 签名后内部换 `electron-updater` 全自动，不改 `index.ts`。
- 发布：v1 手动 `electron-builder --mac` 后把 `.dmg` 传到 GitHub Release（tag `v<version>`）。自动 publish（`--publish always` + `GH_TOKEN`）留后续。

### §5 版本管理

- `package.json` `version` 即 `app.getVersion()` 之源；发布前置版本号（v1 从 `0.1.0` 起，README 记 tag 约定 `v0.1.0`）。

## 测试 / 门禁

- **vitest（纯逻辑）**：
  - `resolveBackendCommand`：三态——env 覆写 / packaged（bundled java+jar 路径）/ dev（系统 java + 默认 jar）。
  - `isNewerVersion`：`1.0.1>1.0.0`、`1.1.0>1.0.9`、相等 false、带 `v` 前缀、非法串安全 false。
- **脚本**：`gen-icon` / `gen-jre` / `prepare-resources` 可复跑、幂等；产物存在性断言。
- **typecheck + build** 全绿。
- **手动眼验**（含产物）：`npm run dist:mac` 出 `.dmg` → 装 /Applications → 右键打开过 Gatekeeper → **dock 显 WR 标不显原子** → 冷启动能拉起**捆绑 JRE**、正常对话（验证 TLS：能连 provider）→ 造一个更高 tag 的 release → 启动弹通知 + 打开下载页。

## 风险

- **jlink 模块裁剪不全** → sidecar 起不来：`jdeps` 自动 + 显式 TLS 模块 + 冷启动眼验兜底；失败时可临时 `--add-modules ALL-MODULE-PATH` 定位。
- **Gatekeeper 拦截**（未签名）：README 写明「右键→打开」或 `xattr -cr /Applications/Wraith.app`。
- **包体积**：Electron(~150MB) + JRE(~45MB) ≈ 200MB dmg，属预期，README 注明。
- **resourcesPath java 布局差异**：以 jlink 直出 `runtime/bin/java` 为准，打包后核实路径存在。
- **GitHub API 限流/离线**：更新检查失败静默，绝不阻塞启动。
- **图标去白不净**：回落矢量重绘 WR（见 §1）。

## 交付链路

`feat/desktop-macos-packaging` → 实现（TDD：`resolveBackendCommand`/`isNewerVersion` 纯逻辑先行；图标/JRE 脚本；打包配置；主进程接线）→ 桌面 typecheck + vitest + build 全绿 → `dist:mac` 出 `.dmg` → 眼验（图标/冷启动/更新通知）→ FF/merge（推送前点头）。

## 安全

- 密钥面**零新增**：key 仍只在 `~/.wraith/config.json`（用户目录，包外）；捆绑的 jar/JRE 不含任何密钥。
- 更新检查仅打公共 GitHub API（匿名、无 token），不回传任何本地数据。
- 每次提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`（只应命中字段名/自指）。
