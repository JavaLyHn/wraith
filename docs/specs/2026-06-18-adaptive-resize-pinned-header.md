# Spec — 自适应 resize + 顶部常驻 WRAITH 标识(B / option 2)

- 日期:2026-06-18
- 作者:LyHn
- 状态:**设计,待签字确认;尚未实现**。确认后在**独立分支**实现 + 真实终端人工测试。
- 关联:延续 `2026-06-18-startup-intro-animation.md` 第 8 节。

---

## 1. 问题

1. `render/` **无任何 SIGWINCH/resize 处理**:改终端大小 → 满屏碎片(证据:`截屏2026-06-18 11.30.55`)。
2. WRAITH 身份只存在于"开头打印、会滚走"的 banner,以及底部 dock 左端的品牌字;没有像 Claude 那样**始终可见的左上角标识**。

## 2. 目标

- 顶部**常驻 2 行 WRAITH 标识**,始终可见(不随对话滚走),resize 时自适应宽度。
- resize 时**活动 UI(顶栏 + 底部 dock + 输入区)干净重绘,不再乱码**。
- 边界(诚实):已滚出屏幕的历史由终端自行重折行,任何 CLI 都无法还原;只保证活动区干净自适应。

## 3. 顶栏设计(2 行,已定)

- **第 1 行**:`▌ WRAITH`(粗体白)+ `  ·  v16.1.0  ·  <model> (<provider>)`(暗色),左对齐;超宽按列宽截断。
- **第 2 行**:整宽细分隔线 `─`(暗色),把常驻头和下方滚动 transcript 分开。
- 纯白主色,与开场动画 / 静态字标一致。
- resize 自适应:第 2 行重新铺满新宽度,第 1 行按新宽度重新截断。

## 4. 布局 / 滚动区

- 用 DECSTBM 预留**顶部 2 行(顶栏)+ 底部 N 行(现有 dock)**:`ESC[3;{rows - dockH}r`。
- transcript 在中间区域滚动;顶栏固定在第 1–2 行,dock 固定在底部。

## 5. 与 JLine Status 共存(核心难点)

- JLine `Status` 自管底部区域并把滚动区 top 设为 1,与我们的顶部 margin **冲突**(每次 Status 更新会复位 top=1,把顶栏卷走)。
- **方案(S2,采用):** InlineRenderer **接管上下两个固定区**——不再依赖 JLine `Status` 管理滚动区/底部绘制,改为自己设滚动区 + 自己绘制顶栏与底部 dock(复用 `BottomStatusBar` 的内容格式化逻辑,只接管"画"和"滚动区")。
- 备选(S1,不采用):保留 JLine Status,在它每次更新后重设顶部 margin + 重绘顶栏 —— 闪烁、时序脆弱。
- 风险已知:S2 是对 `InlineRenderer`(~728 行)/`BottomStatusBar`(~445 行)的较大改动。

## 6. resize 处理

- 注册 `terminal.handle(Terminal.Signal.WINCH, sig -> onResize())`。
- `onResize()`:重算 cols/rows → 重设滚动区 → 重绘顶栏(按新宽度)→ 重绘底部 dock → 触发 `LineReader` redisplay。
- 必要时对高频 resize 做轻量去抖。

## 7. 组件 / 文件

| 文件 | 改动 |
|---|---|
| `render/inline/TopHeader.java`(新) | 纯函数 `render(int cols, StatusInfo info)` → 2 行字符串(可单测);+ 绘制辅助 |
| `render/inline/InlineRenderer.java` | 启动设滚动区(上 2 + 下 dock)、WINCH 处理、顶栏绘制;接管 dock 绘制 |
| `render/inline/BottomStatusBar.java` | 内容格式化复用,绘制/滚动区交回 InlineRenderer |

## 8. 降级

- 非 inline / `NO_COLOR` / dumb / 终端过窄(< 阈值)→ **不启用顶栏与滚动区**,维持当前行为。
- 任何终端异常 → 优雅回退(不画顶栏),绝不崩溃。

## 9. 测试与验证

- 单测:`TopHeader.render(cols, info)`(内容、宽度适配、截断、窄终端)。
- **无法 headless 自动验证**:滚动区 / WINCH / 实时重绘需要交互式 TTY → **真实终端人工测 + 迭代**。
- 实施位置:**独立分支**,`main` 保持稳定;合并前在真实终端确认 resize 干净、顶栏常驻不跑位。

## 10. 风险

- **高**:DECSTBM 滚动区 + 与 JLine Status 共存 + 终端差异 + 闪烁。这是本项目目前风险最高的改动,且无法在本环境验证 resize。
- 缓解:分支隔离、纯函数尽量多覆盖单测、真实终端逐步迭代。

## 11. 决策记录

- 顶栏 = **2 行**(小标 + 细分隔线)。
- 共存方案 = **S2 接管上下固定区**(不再依赖 JLine Status 管滚动区)。
- 流程:本 spec 确认后再实现,分支进行。
