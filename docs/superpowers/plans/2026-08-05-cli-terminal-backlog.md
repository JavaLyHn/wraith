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
| ✅ | `jni` provider 被 `Module.isNativeAccessEnabled()` 挡住（JDK 21 回移了检查却不认 manifest；实测 Oracle JDK 21 就会） | 启动器探测一次 `--enable-native-access=ALL-UNNAMED` 并缓存 |
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

### ~~T2. 「思考面板」被和 scroll region 绑死~~ —— ✅ 已修（是**假耦合**，5 行）

原来的写法：

```java
statusBar       = supportsScrollRegion(terminal) ? new BottomStatusBar(...) : null;
activityDisplay = statusBar == null ? null : new InlineActivityDisplay(..., statusBar);
supportsThinkingPanel() → activityDisplay != null      // ⇐ 等价于 supportsScrollRegion
```

**动手前先查了那个 `statusBar` 参数被用在哪 —— 答案是「没有」**：
`InlineActivityDisplay` 313 行里它只出现在构造器签名上，没有字段、没有一处引用，
而且早就有一个 2 参构造器 `this(terminal, renderLock, null)`。
所以这不是「需要重构的耦合」，是**一个死参数误导了调用方**。

两者的前提本来不同：

| | 需要什么 |
|---|---|
| 底部状态栏 | scroll region（DECSTBM）→ **准确的行数** |
| 思考面板 | 只用 `\n` / `CLEAR_TO_EOL` 原地擦重画 → **能写 ANSI 就够** |

**实际后果**（这才是它值得修的理由）：终端一降级就连 spinner 和 reasoning 的即时显示
一起没了，只能落到 `Agent` 里「攒够 120 字符才 flush」的兜底路上。触发条件有三个，
其中第三个最讽刺 —— **用户只想关状态栏，丢掉的却是「知道它在动」**：

1. 终端降级成 dumb
2. 行数 < 5 或列数 < 20
3. 显式 `WRAITH_NO_STATUSBAR=true` / `-Dwraith.no.statusbar=true`

修法：删掉那个死参数，`activityDisplay` 无条件创建
（`InlineRenderer` 本身只在 `supportsAnsi` 时才被 `RendererFactory` 创建，所以安全）。
两条测试钉住：dumb 终端上 / `WRAITH_NO_STATUSBAR=true` 时思考面板都必须还在；
变异（退回假耦合）确认两条都变红。

> 附带收益：`TurnPreparationNotice`（T3）也靠 `supportsActivityPanel()`，
> 所以降级终端上的准备期反馈从「一行静态文字」升级回「带 spinner 的活动面板」。

### ~~T3. 提交到首个 token 之间没有任何活动指示~~ —— ✅ 已修

**pty 实测把这条从猜测变成了数字**：

```
输出到达秒数: [0.0, 0.01, 8.27, 8.53, ... 11.18]
                    ↑提交回显    ↑spinner 才开始转
                    └─ 8.26 秒零输出 ─┘
```

spinner **本来就有**（`Agent:319` 的 `streamRenderer.beginThinking()` 在 `llmClient.chat()` 之前），
而且它自己显示 `(esc to cancel, 0s)` —— 证明它是第 8.27 秒才被调的，不是「没有指示器」。

那 8 秒花在 `SnapshotService.runTurn` 里：

```java
snapshotBeforeTurn(turnId, summary);   // ← 同步阻塞,大仓库要好几秒
try { return supplier.get(); }         // ← agent.run 在这之后
finally { snapshotAfterTurnAsync(...); }   // ← post-turn 是异步的(对的)
```

修法：`TurnPreparationNotice` 在 `runWithCancelSupport` 之前点亮活动面板，
`Agent.beginThinking()` 随后平滑接管（`InlineActivityDisplay.begin()` 内部先 clear 再重置）。
不支持活动面板时退化成打一行字 —— 一行字也比整屏静止好。

**实测结果**：`准备本轮` 首次出现 **0.01s**（改前 8.26s），`Thinking` 0.48s 接管。

> 仍未做的部分：`statusInfo(...)` 依然只传 `idle`/`compacting`，状态栏本身没有
> 「running/thinking」这一档。活动面板已经盖住了体感，但状态栏文字仍不准。

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
（JDK 24+ 生效），但 **JDK 21-23 的 mac 用户会中同样的招**（实测 Oracle JDK 21 就回移了那个检查，不限 GraalVM）。
至少要在文档里写清；理想是提供一个仓库内的 mac 启动器。

### T7. 开屏动画节奏（本轮已调，但没有客观标准）

用户反馈「开屏动画非常快」。改前 38ms × 约 33 帧 ≈ **1.25 秒**；
现在 46ms + 显现步数 12→18 + 三个转折点各插停顿帧，约 **48 帧 ≈ 2.2 秒**。

**刻意没有再往上加**：CLI 的开场动画是在给启动期（MCP / skill 装配）打掩护的，
长过实际启动耗时就变成纯等待，比太快更烦人。实测本机启动到可输入约 2-8 秒
（MCP 慢时会超时降级），所以 2.2 秒是「盖住最快那一段」的量。

没有客观标准，是一次审美判断 —— 若仍觉得快/慢，`IntroAnimation` 里
`FRAME_MS` 与四个 `HOLD_*` 常量都是独立可调的。

## 验证资产

`scripts/cli-pty/drive.py` —— 用伪终端在 mac 上驱动 CLI。
**这解除了「CLI 只能靠 Windows 实机试」的限制**（REPL 不吃管道，但吃 pty）。
已用它验证 mac 上 Tab 补全 / 中文输入 / 行编辑 / 命令输出全部正常 ——
这个结论把「用户 mac 那次卡住」的范围从「输入层」缩到了「流式输出层」，
才定位到 reasoning 被吞掉。
