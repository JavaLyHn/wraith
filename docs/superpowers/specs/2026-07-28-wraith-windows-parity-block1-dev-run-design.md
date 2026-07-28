# wraith Windows 对等 —— 块 1:可跑 dev + 平台守卫兜底(设计)

- 日期:2026-07-28
- 范围:让 wraith 桌面在**干净 Windows 机器**上能从 clone 跑到 `npm run dev`,核心功能(聊天 / 记忆 / 终端 / 面板)全通,且**无任何 macOS 专属调用在 Windows 上抛错**。
- 这是"Windows 功能对等"总目标的第一块。总对等分 5 块(见文末),本 spec 只覆盖块 1。

## 1. 背景与既有结论(审计已完成)

对全仓做过平台专属假设审计,结论:

- **Java 后端引擎全跨平台**:`src/main/java` 内零 `ProcessBuilder`/`Runtime.exec`/`os.name`/硬编码 `/Users`,仅有 `\r\n→\n` 归一化。agent / LLM / memory / curator / 工具 / IM 网关 / cron 在 Windows 上靠 JVM 原样运行,**块 1 不改后端**。
- **Electron 渲染层全跨平台**:`.is-mac` 已把 macOS 磨砂皮肤(vibrancy)gate 掉,非 mac 走实色;窗口 UI 是 Web 技术。**块 1 不改渲染层视觉**(视觉对等属块 2)。
- **后端 dev 启动可用**:`resolveBackendCommand` 的 dev 路径 = `spawn('java', ['-jar', <jar>, 'app-server'])`,`spawn` 未带 `shell`;Windows 上 CreateProcess 会解析 `java.exe`,只要 JDK 在 PATH。jar 路径 `path.join(homedir, '.wraith', 'wraith.jar')` 跨平台。**无需改码**,仅需 Windows 侧准备 jar + 文档。
- **终端 shell 已 win32-aware**:`ptyHelpers.ts` 用 `env.COMSPEC || 'powershell.exe'`;node-pty 原生二进制由 Windows 上 `npm install` 取得。**无需改码**。
- **桌宠建窗不会崩**:`createPetWindow` 整体包在 `try/catch`,失败即"降级无桌宠、绝不阻塞应用";`type:'panel'`、`setActivationPolicy` 已 darwin 守卫;`setVisibleOnAllWorkspaces` 在 Windows 是 no-op(不抛)。桌宠在 Windows 上会以透明置顶点击穿透窗出现,但**不跨虚拟桌面**(该硬坎留块 5 原生插件)。

**唯一在 Windows 上真会抛错的调用**:`ipcMain.handle('wraith:openWithApp')` 里的 `spawn('open', ['-a', appPath, p])`(`open -a` 是 macOS 专属;Windows 无 `open` → ENOENT)。正常路径下 `computeEditors()` 在 Windows 返回空列表(扫 `/Applications` 目录不存在被吞),UI 不会给出可选编辑器,故 handler 一般不可达;但仍需防御性守卫。

## 2. 目标与非目标

**目标(块 1)**
1. 干净 Windows 机器:clone → 备好后端 jar → `npm install` → `npm run dev` 能起,主窗出现、后端连上。
2. 核心功能全通:聊天、长期记忆面板、终端(node-pty)、各面板。
3. 无 macOS 专属调用在 Windows 上抛错(审计已确认只 1 处,须守卫)。
4. 所有平台分支逻辑抽成**纯函数**并有 vitest 覆盖,使 Windows 分支能在 mac 上确定性验证。

**非目标(留后续块)**
- 窗口视觉对等(无边框 + 自绘窗控)——块 2。
- Windows 外部编辑器完整探测与打开——块 3(块 1 仅做防御性守卫/降级)。
- 打包(`win:` NSIS + `icon.ico` + Windows JRE)与启动脚本对等——块 4。
- 桌宠跨虚拟桌面 + 点击不抢焦的原生 Win32 插件——块 5。
- 后端 Java 任何改动。

## 3. 交付物与详细需求

### 3.1 平台守卫兜底
- **`openWithApp` 守卫**:抽纯函数 `resolveOpenWithPlan(platform, appPath, filePath)`:
  - `platform === 'darwin'` → `{ kind: 'spawn', cmd: 'open', args: ['-a', appPath, filePath] }`(保持现状)。
  - 其余平台 → `{ kind: 'shellOpen', target: filePath }`(handler 用 `shell.openPath(filePath)` 以系统默认程序打开;不再 `spawn('open')`)。
  - handler 依据返回的 plan 执行;darwin 行为字节级不变。
- **桌宠 `setVisibleOnAllWorkspaces` 显式守卫**:包一层 `if (process.platform === 'darwin')`(Windows 本就 no-op,此为语义清晰 + 防未来 Electron 版本行为变动)。不改 macOS 行为。
- **复扫确认**:实现时对 `desktop/src` 再跑一次平台专属调用扫描,任何"Windows 会抛"的 mac-only 调用一律补守卫。审计当前只发现上述 1 处真会抛。

### 3.2 平台分支纯函数化 + 单测
在 mac 上用 vitest 确定性验证 Windows 分支,不靠实机:
- `resolveShell(env, platform)`(已存在):补 win32 断言(`COMSPEC` 命中 / 缺失回退 `powershell.exe`)。
- `petWindowOptions(platform, bounds, preloadPath)`:抽出 `createPetWindow` 里构造 `BrowserWindow` 选项的纯逻辑,断言 darwin 含 `type:'panel'`、win32/linux 不含,其余选项(frame/transparent/focusable 等)一致。`createPetWindow` 改为消费该函数。
- `resolveOpenWithPlan(platform, appPath, filePath)`:如 3.1,断言 darwin=spawn-open、win32=shellOpen。

所有纯函数放在可单测的模块(如 `backend.ts` 同级的 `platform.ts` 或就近文件),不引入 Electron 运行时依赖以便 vitest 直接 import。

### 3.3 Windows 后端 jar 准备脚本
- `desktop/scripts/dev-win.ps1`(PowerShell):
  1. 在仓库根跑 `mvn -q clean package -DskipTests`;
  2. 取 `target/wraith-*.jar`(排除 `original-*`)中体积最大者;
  3. 拷到 `$env:USERPROFILE\.wraith\wraith.jar`(目录不存在则建);
  4. 打印目标路径 + 大小。
- 对标现有 macOS `wraith-install`。失败(缺产物 / mvn 不在 PATH)给清晰报错并非零退出。

### 3.4 Windows dev 上手文档 + 验收清单
- `docs/windows-dev.md`,内容:
  - **前置**:JDK 17、Maven、Node 均在 PATH(给校验命令 `java -version` / `mvn -v` / `node -v`)。
  - **步骤**:`powershell -File desktop\scripts\dev-win.ps1`(备 jar)→ `cd desktop; npm install`(取 node-pty Windows 二进制)→ `npm run dev`。
  - **已知降级(块 1 阶段)**:外部编辑器"用应用打开"改为系统默认程序打开(完整探测见块 3);窗口为系统标准边框(视觉对等见块 2);桌宠不跨虚拟桌面 / 点击可能抢焦(见块 5)。
  - **验收清单(用户在 Windows 上逐条打勾)**:①App 起动、主窗出现;②状态显示后端已连接;③发一条消息有回复;④终端面板能开、能敲命令;⑤记忆面板能搜索/保存;⑥(若开启桌宠)开启后 App 不崩、宠物出现。

## 4. 测试策略

- **可在 mac 上跑(块 1 的 CI 门槛)**:新增/扩充的纯函数 vitest 全绿;`npm run typecheck`(tsc)净;既有 vitest 不回归。
- **须 Windows 实机(用户或块 4 CI 负责)**:第 3.4 的验收清单。
- **诚实边界**:本环境是 macOS,**无法验证 Windows 实机 GUI 行为**。块 1 交付 = 逻辑经单测 + `dev-win.ps1` + 可打勾清单;运行时冒烟归用户/CI。此边界写入文档,不含糊。

## 5. 成功标准

- 干净 Windows 机器按 `docs/windows-dev.md` 可跑起 dev 且核心功能通(由用户按清单确认)。
- `resolveOpenWithPlan` / `petWindowOptions` / `resolveShell` 的 win32 分支有 vitest 覆盖并绿。
- `tsc` 净、既有 vitest 不回归。
- macOS 行为字节级不变(darwin 分支保持现状,单测锁定)。

## 6. 后续块(总对等路线,非本 spec 范围)

2. 窗口视觉对等(`frame:false` + 自绘最小/最大/关闭 + 拖拽区)。
3. Windows 外部编辑器探测(注册表/已知路径)+ 打开。
4. 打包(`win:` NSIS + `icon.ico` + Windows JDK jlink 产 Win JRE + node-pty Win 二进制)+ 启动脚本 `.ps1`/`.cmd` 对等 + 可选 GitHub Actions windows runner 冒烟。
5. 桌宠原生 Win32 插件(N-API):`WS_EX_NOACTIVATE` 点击不抢焦 + 跨虚拟桌面常驻。
