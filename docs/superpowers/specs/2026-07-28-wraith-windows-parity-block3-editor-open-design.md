# wraith Windows 对等 —— 块 3:Windows 编辑器探测 + 打开(设计)

- 日期:2026-07-28
- 范围:让「用应用打开文件」在 **Windows** 上可用——探测已装编辑器(已知安装路径)+ 直接 spawn 其 exe 打开目标文件。macOS 行为不变;Linux 无探测(退回系统默认程序)。
- Windows 功能对等总目标(5 块)的第 3 块。见记忆 [[wraith-windows-parity]]。

## 1. 背景与既有结论

- **mac 现状**:`desktop/src/main/fileOpen.ts` 有 curated 表 `KNOWN_EDITORS`(`.app` 名 → 展示名:VS Code/Cursor/Xcode/IntelliJ/Sublime/Zed/Terminal)+ 纯函数 `detectEditors(appPaths): EditorApp[]`(从 `.app` 路径列表挑已装的)。`EditorApp = { name, appPath }`(`shared/editors.ts`)。
- **打开路径(块 1)**:`resolveOpenWithPlan(platform, appPath, filePath)` —— darwin → `{ kind:'spawn', cmd:'open', args:['-a', appPath, filePath] }`;**其它平台(含 win32)→ `{ kind:'shellOpen', target: filePath }`**(块 1 占位:Windows 无编辑器故走系统默认)。`wraith:openWithApp` handler 依 `plan.kind` 分派(`spawn(...).unref()` 或 `shell.openPath`)。
- **computeEditors(`index.ts`)**:扫 `/Applications` + `~/Applications` 的 `.app` → `detectEditors` → 缓存。Windows 上 `/Applications` 不存在被吞 → 返回 `[]`(故当前 Windows 无可选编辑器,`openWithApp` 因 `computeEditors().some(...)` 恒 false 先抛"无效的应用",`shellOpen` 分支实际不可达)。
- **渲染层**:`App.tsx` 无条件 `listEditors().then(setEditors)`;"用应用打开" UI **数据驱动**——`listEditors` 返回啥就显示啥。故 Windows 探测出编辑器后 UI 自动出现,**无需改渲染层**。
- **决策(用户 AskUserQuestion)**:探测机制 = **已知安装路径**(纯函数、可在 mac 单测、镜像 mac 的 curated 表;覆盖默认安装,漏自定义目录安装)。

## 2. 目标与非目标

**目标(块 3)**
1. Windows 上探测已装编辑器(默认安装路径),`computeEditors` 在 win32 返回真实 `EditorApp[]`。
2. `openWithApp` 在 win32 直接 spawn 编辑器 exe 打开目标文件(取代块 1 的 shellOpen 占位)。
3. 探测逻辑为纯函数,mac 上注入假 env/exists 完全单测。

**非目标(留后续/YAGNI)**
- 注册表 / 自定义目录安装探测(默认路径覆盖绝大多数;registry 为将来可选增强)。
- JetBrains(Toolbox 安装路径杂)、Zed(Windows 支持尚早)、Windows Terminal 等 —— 不进 v1 表。
- 渲染层任何改动(UI 数据驱动,自动生效)。
- macOS 行为改动(`detectEditors`/`KNOWN_EDITORS`/darwin 打开路径均不变)。

## 3. 交付物与详细需求

### 3.1 Windows 编辑器表 + 探测纯函数(`fileOpen.ts`)
- 新增 curated 表(每编辑器一组候选,`base`=环境变量名,`rel`=相对该目录的 exe 路径):

```ts
const KNOWN_WINDOWS_EDITORS: { name: string; candidates: { base: string; rel: string }[] }[] = [
  { name: 'VS Code', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\Microsoft VS Code\\Code.exe' },
    { base: 'ProgramFiles', rel: 'Microsoft VS Code\\Code.exe' },
  ] },
  { name: 'VS Code Insiders', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe' },
    { base: 'ProgramFiles', rel: 'Microsoft VS Code Insiders\\Code - Insiders.exe' },
  ] },
  { name: 'Cursor', candidates: [
    { base: 'LOCALAPPDATA', rel: 'Programs\\cursor\\Cursor.exe' },
  ] },
  { name: 'Sublime Text', candidates: [
    { base: 'ProgramFiles', rel: 'Sublime Text\\sublime_text.exe' },
  ] },
  { name: 'Notepad++', candidates: [
    { base: 'ProgramFiles', rel: 'Notepad++\\notepad++.exe' },
    { base: 'ProgramFiles(x86)', rel: 'Notepad++\\notepad++.exe' },
  ] },
]
```

- `export function detectWindowsEditors(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): EditorApp[]`:
  - 遍历表,对每个编辑器按候选顺序:`base` 环境变量缺失则跳过;用 **`path.win32.join(baseDir, rel)`**(保证在 mac 上也产 Windows 风格路径、测试确定化)拼绝对路径;`exists(full)` 命中即 `push({ name, appPath: full })` 并 **break**(每编辑器最多一条,天然按 name 去重)。
  - 纯函数,无 `fs`/`process` 直接依赖(env、exists 均注入)。

### 3.2 resolveOpenWithPlan 支持 win32 spawn(`fileOpen.ts`)
- 改为:
  - darwin → `{ kind:'spawn', cmd:'open', args:['-a', appPath, filePath] }`(不变)
  - **win32 → `{ kind:'spawn', cmd: appPath, args:[filePath] }`**(spawn 编辑器 exe 直接开文件;取代块 1 的 shellOpen)
  - 其它 → `{ kind:'shellOpen', target: filePath }`(linux 等)
- handler(`index.ts`)无需改(已按 `plan.kind` 分派,`spawn(plan.cmd, plan.args, {stdio:'ignore', detached:true}).unref()` 对 win32 exe 同样适用)。
- 更新块 1 遗留测试:`resolveOpenWithPlan('win32', …)` 断言从 `shellOpen` 改为 `spawn`。

### 3.3 computeEditors 平台分支(`index.ts`)
- 在 `computeEditors()` 开头(缓存判断之后)加 win32 分支:
  ```ts
  if (process.platform === 'win32') { editorsCache = detectWindowsEditors(process.env, fs.existsSync); return editorsCache }
  ```
  其余保持现有 `/Applications` 扫描(darwin 正常;linux `/Applications` 不存在被吞 → `[]`)。`detectWindowsEditors` 从 `./fileOpen` 导入。

### 3.4 文档(`docs/windows-dev.md`)
- 验收清单补一条:`- [ ] "用应用打开"能列出已装编辑器(VS Code 等),点击用该编辑器打开文件`。
- "已知降级"里关于"编辑器走系统默认程序 / 块 3"那条,改写为已完成表述(块 3 已支持已知编辑器探测+打开;仍不覆盖自定义目录安装)。

## 4. 测试策略

- **mac 上可跑(块 3 CI 门槛)**:
  - `detectWindowsEditors`(注入假 `env` + 假 `exists`):命中 VS Code(user/system 任一候选)、漏装跳过、多编辑器按表序、每编辑器命中首个候选即止(去重)、`base` 环境变量缺失跳过、产出的 `appPath` 为 `path.win32.join` 拼的 Windows 路径。
  - `resolveOpenWithPlan`:win32 → spawn exe(更新块 1 断言);darwin/linux 分支保持。
  - `npm run typecheck` 净;既有 vitest 不回归。
- **须 Windows 实机(用户 / 块 4 CI)**:真实安装的 VS Code 等被探测到、点击用其打开文件生效。
- **诚实边界**:本环境 macOS,无法验证真实 Windows 编辑器探测与 spawn 打开。

## 5. 成功标准

- `detectWindowsEditors` 纯函数有单测覆盖并绿;`resolveOpenWithPlan` win32=spawn 已更新且绿。
- `computeEditors` 在 win32 走 `detectWindowsEditors`;mac 扫描路径不变。
- macOS 行为不变(`detectEditors`/`KNOWN_EDITORS`/darwin 打开路径未改)。
- `tsc` 净、既有 vitest 不回归。
- `docs/windows-dev.md` 反映块 3 完成。

## 6. 后续块(总路线,非本 spec 范围)

4. 打包(`win:` NSIS + `icon.ico` + Windows JRE + node-pty Win 二进制)+ 启动脚本对等 + 可选 CI 冒烟。
5. 桌宠原生 Win32 插件(`WS_EX_NOACTIVATE` + 跨虚拟桌面)。
