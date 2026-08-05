#!/usr/bin/env python3
"""用伪终端驱动 wraith 的交互式 CLI,在 mac/Linux 上自验 REPL 行为。

**为什么需要它**:REPL 不吃管道 —— `echo /help | java -jar wraith.jar` 拿不到
真实行为,因为 JLine 需要 TTY(拿不到就降级成 DumbTerminal,行编辑全失灵)。
此前因此认定「CLI 只能靠 Windows 实机试」,每个猜测都要等用户跑一轮。
pty 绕开了这条限制:openpty + TIOCSWINSZ 给一个真实尺寸的伪终端,
JLine 会把它当正常终端,于是 Tab 补全 / 方向键 / 中文输入 / 命令输出都能在
mac 上验证。

用法:
    python3 scripts/cli-pty/drive.py target/wraith-1.0-SNAPSHOT.jar

**它验得了什么、验不了什么**:
  验得了 —— 启动横幅、行编辑、Tab 补全、命令输出、中文输入回显、退出清屏
  验不了 —— 真实 LLM 轮次(会花配额);Windows 的 jni provider 行为(平台差异)

做法是**确定性分段**:喂一步 -> 固定窗口收集输出 -> 打标记 -> 下一步。
早先版本用「静默检测」决定何时喂下一步,结果 /help 输出太长把后续步骤全挤掉了。
"""
import os, pty, select, subprocess, sys, time, fcntl, termios, struct

def collect(master, seconds):
    buf = bytearray()
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.2)
        if r:
            try:
                c = os.read(master, 65536)
            except OSError:
                break
            if not c:
                break
            buf += c
    return buf.decode('utf-8', errors='replace')

def main(jar, steps):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    env = dict(os.environ); env['TERM'] = 'xterm-256color'
    p = subprocess.Popen(['java', '-jar', jar], stdin=slave, stdout=slave,
                         stderr=slave, env=env, close_fds=True)
    os.close(slave)
    print("=== [启动] ===")
    print(collect(master, 8.0)[-400:])
    for label, data, wait in steps:
        print("\n=== [%s] ===" % label)
        os.write(master, data)
        print(repr(collect(master, wait)))
    try:
        p.terminate(); p.wait(timeout=3)
    except Exception:
        try: p.kill()
        except Exception: pass
    os.close(master)

if __name__ == '__main__':
    # 默认这套步骤覆盖「用户实测报过问题」的那几项。
    # 中文那条尤其重要:Windows 上 dumb 终端会把中文输入读坏成 ???,
    # 而 ASCII 正常 —— 那是「按控制台码页读输入」的指纹。
    main(sys.argv[1], [
        ("输入 ASCII 'abc'(不回车)", b"abc", 1.5),
        ("Ctrl-U 清行", b"\x15", 1.0),
        ("输入中文 '你好'(不回车)", "你好".encode('utf-8'), 2.0),
        ("Ctrl-U 清行", b"\x15", 1.0),
        ("Tab 补全 '/mo'", b"/mo\t", 2.0),
        ("Ctrl-U 清行", b"\x15", 1.0),
        ("方向键上(取历史)", b"\x1b[A", 1.5),
        ("Ctrl-U 清行", b"\x15", 1.0),
        ("/exit + Enter", b"/exit\r", 3.0),
    ])
