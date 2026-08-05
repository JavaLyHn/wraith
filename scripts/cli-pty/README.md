# `scripts/cli-pty` —— 在 mac/Linux 上驱动交互式 CLI

## 它解除了什么限制

**REPL 不吃管道。** `echo /help | java -jar wraith.jar` 得不到真实行为：JLine 需要 TTY，
拿不到就降级成 `DumbTerminal`（没有 raw mode，行编辑/补全/历史全失灵）。

此前因此认定「CLI 的行为只能靠实机试」，每个猜测都要等一轮往返。**伪终端绕开了这条限制**：
`pty.openpty()` + `TIOCSWINSZ` 给一个有真实尺寸的伪终端，JLine 会把它当正常终端。

```bash
mvn -q package -DskipTests
python3 scripts/cli-pty/drive.py target/wraith-1.0-SNAPSHOT.jar
```

## 验得了 / 验不了

| 能验 | 不能验 |
|---|---|
| 启动横幅、Tips、输入提示符 | **真实 LLM 轮次**（会花配额，需要显式改脚本才跑） |
| 行编辑：Ctrl-U、退格、自动建议 | Windows 的 `jni` provider 行为（平台差异，见 `wraith terminal doctor`） |
| **Tab 补全**（弹命令列表、逐字补全） | 真实终端的字体/宽字符渲染 |
| **中文输入回显**（Windows 上曾坏成 `???`） | 鼠标交互 |
| 命令输出（`/help`、`/model` …） | |
| 退出时的清屏与 scroll region 复位 | |

## 输出怎么读

每步一个 `=== [标签] ===`，下面是那一步收到的原始字节（`repr`，所以能看到 ANSI 序列）。
例如中文输入正常时长这样：

```
=== [输入中文 '你好'(不回车)] ===
'你\x1b[2m好\x1b[0m\x08\x08好'
```

`\x1b[2m…\x1b[0m` 是灰色的自动建议，`\x08` 是退格 —— 说明 JLine 拿到了真终端、
在做行内建议。**如果这里出现 `?` 或 `???`，就是输入编码坏了**（Windows dumb 终端的指纹）。

## 加一步

改 `drive.py` 末尾的列表，每项是 `(标签, 要写入的字节, 收集秒数)`：

```python
("Tab 补全 '/mo'", b"/mo\t", 2.0),
("中文", "你好".encode('utf-8'), 2.0),
("方向键上", b"\x1b[A", 1.5),
```

> ⚠ 方向键这类 ESC 序列**一次性写入**时，JLine 的 ESC 超时判断可能把它拆成字面
> `[A`。要精确验方向键，把 ESC 和后续字节分两次写、中间隔 50ms。
