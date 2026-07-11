# 桌面启动动画(幽灵浮现)设计稿

日期:2026-07-11
状态:已与用户确认设计,待写实现计划

## 目标

App 打开时呈现一个**独立、无边框、背景全透明**的启动窗,logo 以「幽灵浮现」动效
淡入,覆盖后端初始化时间,就绪后优雅散去、交接到主窗口。契合 wraith 幽灵主题,页面
需美观。纯 logo,无文字字标。

## 范围

- **做**:一个 cosmetic 启动动画窗 + 与现有启动/后端就绪流程的交接。
- **不做**:字标/文案、可配置项(时长/开关)、跨该特性之外的窗口重构。

## 行为

1. App 启动即创建 `splash` 窗(约 320×320,居中,置顶,背景透明),logo 悬浮于**桌面之上**。
   同时以 `show:false` 创建主窗口(隐藏)。
2. logo 播「幽灵浮现」:opacity 虚→实淡入 + 轻微上浮(translateY 12→0)+ 一圈柔和辉光
   缓慢呼吸。
3. 何时散去由 `shouldDismissSplash(elapsedMs, connected, floorMs, capMs)` 决定:
   - `connected`:监听现有后端 `connection: connected` 事件(真·就绪信号)。
   - **地板** `floorMs = 1200`:动画至少放完、不闪。
   - **天花板** `capMs = 4000`:后端慢/失败也强制散去,不卡住启动。
   - 语义:`elapsedMs >= capMs || (connected && elapsedMs >= floorMs)` → 散去。
4. 散去:splash **淡出 + 轻微放大"散去"**(~450ms);淡出完成后关闭 splash 并 `mainWindow.show()`
   (小窗浮于桌面 → 淡出 → 主窗现身,短暂露出桌面与"桌面悬浮"美学一致)。

## 架构

- **新增 `splash` BrowserWindow**:`{ transparent:true, frame:false, alwaysOnTop:true, hasShadow:false,
  resizable:false, skipTaskbar:true, focusable:false, width:320, height:320, center:true }`。
- **自包含 splash 页**:main 进程用一段内联 HTML(内联 CSS 动画 + logo 以 base64 内嵌)通过
  `loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))` 加载。**不走主渲染进程、
  不依赖 dev server / 后端**,dev 与打包行为一致。
  - logo 资源须在 dev + 打包两态都可解析 → **内联 base64**(从 `build/icon-512.png` 幽灵标生成);
    实现期确定生成方式(构建期常量或运行时读取带 dev/packaged 兜底)。
  - 深/浅色:按 `nativeTheme.shouldUseDarkColors` 选 logo/辉光配色;或单一带 alpha 的标在两态皆可,
    实现期定。
  - `prefers-reduced-motion`:开启则只淡入淡出,不浮动/缩放/呼吸。
- **`index.ts` 编排**(在 `app.whenReady` / `createWindow` / `spawnBackend` 流程内):
  - 记录 `splashStartedAt`;创建 splash;主窗口改为 `show:false` 创建。
  - 后端 `connected`(现有 `sendEvent({kind:'connection',state:'connected'})` 处)置 `connected=true`。
  - 一个轻量定时器(如每 150ms)按 `shouldDismissSplash(...)` 判定;命中即触发散去序列(通知 splash
    页播淡出 → 450ms 后关 splash + show 主窗)。
  - 兜底:splash 创建失败 → 直接 show 主窗(动画非关键路径,绝不阻塞启动)。

## 纯函数与可测性

```
shouldDismissSplash(elapsedMs, connected, floorMs=1200, capMs=4000): boolean
  return elapsedMs >= capMs || (connected && elapsedMs >= floorMs)
```
- 放在可单测的模块(如 `desktop/src/main/splash.ts`),vitest 覆盖:未到地板不散、就绪且过地板即散、
  到天花板强制散、未就绪未到天花板不散。
- 启动窗视觉本身不做自动化测试,靠眼验。

## 边界与风险

- 后端始终连不上 → 天花板 4s 强制散去,主窗仍现身。
- 多显示器 → `center:true` 落主显示器;可接受。
- macOS 透明无边框窗:需 `frame:false`;`focusable:false` 避免抢焦点;不加 vibrancy 以免破坏全透明。
- 主窗从"立即显示"改为"隐藏+就绪后显示":确认现有 `createWindow`/`ready-to-show` 逻辑不与之冲突
  (实现期核对,避免双重 show 或白屏)。

## 交付后

- 眼验:启动观感(淡入/辉光/散去/交接顺滑)、深浅色、reduced-motion。
- 与后端就绪时序在快/慢两种情况下都自然(冷启动 vs jar 已热)。
