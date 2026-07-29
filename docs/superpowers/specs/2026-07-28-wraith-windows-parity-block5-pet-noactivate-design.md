# wraith Windows 对等 —— 块 5:桌宠"点击不抢焦"(WS_EX_NOACTIVATE via koffi,设计)

- 日期:2026-07-28
- 范围:Windows 桌宠全局窗精确实现"点击/交互不激活抢焦"——经 **koffi FFI** 给窗口 HWND 加 `WS_EX_NOACTIVATE`。**跨虚拟桌面常驻**列为**文档化限制**(不做:无官方 API,COM 随 Windows build 易碎)。macOS 不变。
- Windows 功能对等总目标(5 块)的**最后一块**。见记忆 [[wraith-windows-parity]] [[desktop-pets-feature]]。

## 1. 背景与既有结论

- **桌宠窗现状**(`desktop/src/main/petWindow.ts` `createPetWindow`):darwin 用 NSPanel(`type:'panel'`,来自 `petWindowOptions`)+ `setVisibleOnAllWorkspaces` + `setActivationPolicy('regular')`;**win32/linux 现有**:`focusable:false`(`petWindowOptions`)+ `setIgnoreMouseEvents(true,{forward})` + `setAlwaysOnTop(true,'floating')`。全程 try/catch,失败即"无桌宠、不阻塞"。
- **块 1 审计定的两处 mac 专属硬坎**:①点击不抢焦(NSPanel `type:panel`);②跨虚拟桌面常驻(`setVisibleOnAllWorkspaces`)。
- **现实(块 5 brainstorm 定)**:①`focusable:false` 已基本挡住 Windows 抢焦;`WS_EX_NOACTIVATE` 是精确版、增益有限但正当。②跨虚拟桌面无官方 Windows API,只有未公开 `IVirtualDesktopManagerInternal` COM(GUID/vtable 随 build 变、极脆)→ **不做**。
- **无 FFI/native 依赖、无 binding.gyp**。`win.getNativeWindowHandle()` 在 Windows 返回含 HWND 的 Buffer。
- **决策(用户 AskUserQuestion)**:只做 `WS_EX_NOACTIVATE`(koffi FFI,无需 MSVC/C++);跨虚拟桌面=文档化限制。

## 2. 目标与非目标

**目标(块 5)**
1. Windows 上给桌宠窗 HWND 加 `WS_EX_NOACTIVATE`,精确实现点击不激活 wraith(不打断用户在别处的操作)。
2. 载体 = koffi(带各平台预编译二进制,`npm install` 即得,无 node-gyp/MSVC);仅 win32 分支 lazy 加载。
3. 全程 try/catch 降级:koffi 缺失/加载失败/FFI 调用出错 → 退回现有 `focusable:false`,绝不崩。
4. 纯位运算逻辑抽纯函数,mac 上单测。
5. 文档写清"跨虚拟桌面"为已知限制。

**非目标(YAGNI/文档化限制)**
- 跨虚拟桌面常驻(无官方 API,COM 太脆)——文档化限制。
- 自写 C++ node-gyp addon(koffi 免编译路径足够 WS_EX_NOACTIVATE)。
- `WS_EX_TOOLWINDOW` 等其它扩展样式(`skipTaskbar:true` 已处理任务栏;超范围)。
- macOS/Linux 桌宠行为改动(darwin NSPanel 路径、win 现有 focusable:false 兜底不动)。

## 3. 交付物与详细需求

### 3.1 koffi 依赖
- 加 `koffi` 到 `dependencies`(运行期用,非 dev)。它带 win32/darwin/linux 预编译二进制,`npm install --legacy-peer-deps`(仓库既有 @lobehub peer 坑)在各平台都装得上;mac 上装了但不被调用。

### 3.2 `winPetStyle.ts`(纯函数 + win32-only FFI 胶水)
Create `desktop/src/main/winPetStyle.ts`:
- 纯常量与函数(**mac 可单测**):
  - `export const WS_EX_NOACTIVATE = 0x08000000`
  - `export const GWL_EXSTYLE = -20`
  - `export function withNoActivate(exStyle: number): number { return (exStyle | WS_EX_NOACTIVATE) >>> 0 }`(`>>> 0` 归一为无符号 32 位;置位幂等、保留既有位)。
- `export function applyNoActivate(win: BrowserWindow): void`:
  - `process.platform !== 'win32'` → 直接 return(no-op)。
  - win32:整体包 try/catch(失败仅 `log`/静默,**绝不抛**):
    - `const koffi = require('koffi')`(**lazy**,只在 win32 分支;避免 mac 加载 + 缺失时被 catch)。
    - `const user32 = koffi.load('user32.dll')`;声明 `GetWindowLongPtrW(void* hWnd, int nIndex) -> intptr`、`SetWindowLongPtrW(void* hWnd, int nIndex, intptr dwNewLong) -> intptr`(具体 koffi 类型串以 koffi 当前 API 为准,见"诚实边界")。
    - HWND:`const buf = win.getNativeWindowHandle()`;x64 下 `const hwnd = buf.readBigUInt64LE()`(HWND 指针)。
    - `const cur = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE))`;`SetWindowLongPtrW(hwnd, GWL_EXSTYLE, withNoActivate(cur))`。
  - 注:`getNativeWindowHandle` 要求窗口已构造(调用点在 `new BrowserWindow` 之后,满足)。

### 3.3 `petWindow.ts` 接线
- `createPetWindow` 里,在 `win.setIgnoreMouseEvents(true, { forward: true })` 之后加 `applyNoActivate(win)`(自守卫 win32;失败自降级)。顶部 `import { applyNoActivate } from './winPetStyle'`。
- **保留** `focusable:false`(petWindowOptions)与既有 darwin 分支不动——applyNoActivate 是精确增强,focusable:false 是兜底。

### 3.4 文档(`docs/windows-dev.md`)
- 更新桌宠相关"已知降级":点击不抢焦在 Windows 已由 `WS_EX_NOACTIVATE` 精确实现(koffi FFI);**跨虚拟桌面常驻仍为已知限制**(Windows 无官方 API,不做)。
- 验收清单补:桌宠开启后,单击/拖动桌宠**不打断**你在其它应用里的操作(不抢焦)。

## 4. 测试策略

- **mac 上可跑(块 5 CI 门槛)**:
  - `withNoActivate` 纯函数单测:`withNoActivate(0) === 0x08000000`;`withNoActivate(0x100) === (0x100 | 0x08000000)`;已置位幂等 `withNoActivate(0x08000000) === 0x08000000`;保留既有位(如 `WS_EX_LAYERED 0x80000` 不丢)。
  - `applyNoActivate` 在非 win32(测试宿主=darwin)是 no-op、不抛(可断言调用不 throw、不 require koffi)。
  - `npm run typecheck` 净;既有 vitest 不回归(尤其 pet 相关)。
- **须 Windows 实机(用户)**:开桌宠 → 单击/拖动桌宠时,前台其它应用的焦点/输入**不被打断**;且桌宠仍显示、可拖、动画正常(koffi 未破坏窗口)。
- **诚实边界(全系列最硬)**:koffi FFI + Win32 调用在 **mac 上既编不了也跑不了**;`GetWindowLongPtrW`/`SetWindowLongPtrW` 的 koffi 类型声明、HWND 读法、koffi 与 Electron 32 ABI 兼容性,**我无法验证**,是"最佳努力"实现。**降级设计是安全网**:任何一环出错都被 try/catch 吞、退回 focusable:false,最坏结果是"没精确不抢焦"而非崩溃。Windows 实机验证 + 必要时按 koffi 当前 API 微调,归用户。

## 5. 成功标准

- `withNoActivate` 纯函数单测绿(位运算正确、幂等、保位);`applyNoActivate` 非 win32 no-op 不抛。
- `applyNoActivate` 接进 `createPetWindow`(win32 后置调用),win32 守卫 + try/catch 降级到位。
- macOS/Linux 桌宠行为不变(darwin 分支、focusable:false 兜底未动)。
- `tsc` 净、既有 vitest 不回归。
- `docs/windows-dev.md` 反映:点击不抢焦已精确、跨虚拟桌面为已知限制。
- **Windows 实机**(不抢焦生效 + 桌宠未被破坏)= 用户负责,本环境不冒领。

## 6. 收尾(Windows 对等 5 块完成后)

块 5 完成即 5 块全落地(均在 `feat/windows-parity-block1`,未 merge)。后续按系列决定:用户 Windows 实机验一轮 → 决定 merge。残留小债(记忆已记):编辑器 32 位路径/注册表探测(块 3)、`resolveNpx` 的 Windows 语义(pets 安装)、跨虚拟桌面文档化限制。
