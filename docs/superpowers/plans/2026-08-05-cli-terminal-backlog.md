# CLI 终端待办（2026-08-05）

> 起因：用户在 Windows 上报「终端不支持 ANSI + 输入命令不管用」，在 mac 上报「发完消息直接卡了」，
> 并明确说「桌面端不卡，仅仅是 CLI 端有很多 bug」。
> 已修的部分见 commit `b5b3d32`（ANSI 错判 + 降级诊断）、`a5c30ab`（native access 根因）、
> 以及本轮的 reasoning flush 修复。这份清单记**已定位但还没修**的。

## 已修（留档，便于对照）

| # | 问题 | 修法 |
|---|---|---|
| ✅ | 「终端不支持 ANSI」是错判（DumbTerminal ≠ 终端不解释 ANSI） | 判据改为「dumb 时看现代终端证据」+ `WRAITH_FORCE_ANSI` 逃生阀 |
| ✅ | JLine 降级原因是个黑洞（`dumb(true)` 让它一行日志都不打） | 构建期间临时接住 `org.jline` 日志 + `wraith terminal doctor` |
| ✅ | `jni` provider 被 `Module.isNativeAccessEnabled()` 挡住（GraalVM JDK 21 回移了检查却不认 manifest） | 启动器探测一次 `--enable-native-access=ALL-UNNAMED` 并缓存 |
| ✅ | GBK 控制台上 emoji 变 `??` | `ConsoleSafeText` + `SafeConsoleStream`（只拦文本，不拦 `write(byte[])`） |
| ✅ | 不带换行的长 reasoning 被无限期吞掉 → 屏幕完全静止 | `REASONING_FLUSH_CHARS=120` 兜底 + `flushPartialLineIfLongerThan` |

## P0 — 已定位，未修

### T1. `Renderer.beginTask()` 全仓 **0 个调用点**

接口注释写着「开始一次用户任务输出。默认 no-op；inline renderer 用它重置本轮可重绘 transcript」，
但 `grep -rn "beginTask" src/main` **没有任何结果**。也就是说 inline 的「本轮可重绘 transcript」
从来没被重置过。

`InlineRenderer.beginTurn()` 里做了 `transcript.clear()` 之类的事，说明真正在用的是 `beginTurn`。
**要么把 `beginTask` 删掉，要么接上** —— 现在这样是一个悬空的接口方法，读代码的人会以为它在工作。

先查清 `beginTurn` 和 `beginTask` 的意图差别，再决定删哪个。

### T2. 「思考面板」被和 scroll region 绑死

```java
// InlineRenderer 构造器
statusBar       = supportsScrollRegion(terminal) ? new BottomStatusBar(...) : null;
activityDisplay = statusBar == null ? null : new InlineActivityDisplay(...);
supportsThinkingPanel() → activityDisplay != null      // ← 等价于 supportsScrollRegion
```

**思考面板不需要 scroll region。** 现在终端一降级（dumb、或 rows<5、或
`WRAITH_NO_STATUSBAR=true`）就连思考面板一起没了，reasoning 只能落到 Agent 里
「攒够 120 字符才 flush」的兜底路上 —— 那是兜底，不是应有的体验。

对照：桌面端 `EventStreamRenderer.supportsThinkingPanel()` 硬编码 `true`，所以桌面端不受影响。
**这正是「桌面端不卡、CLI 卡」的结构性原因。**

修法方向：让 `InlineActivityDisplay` 不依赖 `BottomStatusBar`（或提供一个不占 scroll region 的
降级实现），把两个能力解耦。**注意这是我上一版 `supportsScrollRegion` 在 dumb 时返回 false
所加重的** —— 那个改动本身是对的（尺寸不可信时画 scroll region 更糟），
但不该连带关掉思考面板。

### T3. 提交到首个 token 之间没有任何活动指示

`statusInfo(...)` 全仓只传过 `idle` 和 `compacting` 两种状态；
`startActivity` 只在 compacting 场景用。按下 Enter 后状态栏仍写着 `idle`。

即使 T2 修好，**首个 reasoning/content delta 到达之前**仍然是纯静止。
桌面端有 thinking 面板占位，CLI 没有。

修法：提交后立刻切一个 `thinking`/`waiting` 状态，首个 delta 到达时切走。

## P1

### T4. `wraith terminal doctor` 没显示 `java-flags.txt` 的状态

那个缓存文件直接决定启动时加不加 `--enable-native-access`，但报告里没有它。
换过 JDK 而没重跑 `wraith-install` 时，用户看不出「缓存过期了」。

### T5. `ConsoleSafeText` 的符号表覆盖不全

用户实测里 `👋 再见!` 变成 `? 再见!`（表里没有 `👋`）。降级成 `?` 不算错（周围文字保住了），
但常用 emoji 应该都有 ASCII 等价物。做法：把仓库里所有输出用到的 emoji 扫一遍补进表里，
并加一条测试断言「源码里出现的 emoji 都在表内」。

### T6. mac 上 `--enable-native-access` 没有对应的处理

`/opt/homebrew/bin/wraith` 是用户手写的、不在仓库里。mac 上 `java -jar` 走 manifest
（JDK 24+ 生效），但 **GraalVM JDK 21-23 的 mac 用户会中同样的招**。
至少要在文档里写清；理想是提供一个仓库内的 mac 启动器。

## 验证资产

`scripts/cli-pty/drive.py` —— 用伪终端在 mac 上驱动 CLI。
**这解除了「CLI 只能靠 Windows 实机试」的限制**（REPL 不吃管道，但吃 pty）。
已用它验证 mac 上 Tab 补全 / 中文输入 / 行编辑 / 命令输出全部正常 ——
这个结论把「用户 mac 那次卡住」的范围从「输入层」缩到了「流式输出层」，
才定位到 reasoning 被吞掉。
