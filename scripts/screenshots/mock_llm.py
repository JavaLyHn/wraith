#!/usr/bin/env python3
"""
截图用的**假 LLM 端点** —— 说 OpenAI 兼容的 /chat/completions SSE。

为什么要它：README 的桌面截图定了个标准 ——「不消耗 API 额度、不暴露任何个人数据」。
终端截图要同一个标准，所以对话内容必须是脚本化的，而不是真打一次 API。

它按「第几次被调用」返回预先编好的一轮。两套场景，用 WRAITH_DEMO_SCENE 选：

  edit(默认) —— reasoning + read_file → edit_file → 收尾
                 一次拍到「思考面板 + 工具块 + diff」三样
  approval   —— reasoning + execute_command(rm -rf) → 收尾
                 拍 HITL 审批卡。注意交互式 CLI 的 HITL 默认是关的,
                 要先在 REPL 里敲 /hitl on。
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CALLS = {"n": 0}

REASONING = (
    "用户要把 README 里的版本号改掉。先确认现在写的是什么 —— "
    "直接改容易改错行，README 里出现版本号的地方可能不止一处。"
)

EDIT_TURNS = [
    # 第 1 轮：思考 + 读文件
    {
        "reasoning": REASONING,
        "tool": {
            "id": "call_1",
            "name": "read_file",
            "arguments": {"path": "README.md"},
        },
    },
    # 第 2 轮：改文件（产出 diff）
    {
        "reasoning": "只有徽章那一行写了版本号，改它就够。",
        "tool": {
            "id": "call_2",
            "name": "edit_file",
            "arguments": {
                "path": "README.md",
                "old_string": "Wraith v1.3.0",
                "new_string": "Wraith v1.4.0",
            },
        },
    },
    # 第 3 轮：收尾
    {
        "text": "已改好：`README.md` 里的版本号 1.3.0 → 1.4.0。\n\n"
                "全文只有徽章那一行带版本号，正文里的 `v16.1.0` 是**启动横幅**的开发期编号，"
                "和产品版本是两套，没有动。",
    },
]

# 审批场景：execute_command 在 ApprovalPolicy 里是 🔴 高危，必然触发 HITL 审批卡。
# 刻意选一条**看得出为什么要人过一眼**的命令 —— 一句无害的 `ls` 拍出来没有说服力。
APPROVAL_TURNS = [
    {
        "reasoning": "构建目录里还留着上次的产物，先清掉再打包，否则可能用到旧的 class。",
        "tool": {
            "id": "call_1",
            "name": "execute_command",
            "arguments": {"command": "rm -rf target/ && mvn -q package -DskipTests"},
        },
    },
    {
        "text": "已经清掉旧产物并重新打包。\n\n"
                "顺带一句：`rm -rf` 这类命令每次都会停下来等你点头 —— "
                "命令本身可以当场改，也可以对某个工具「本会话放行」。",
    },
]

TURNS = APPROVAL_TURNS if os.environ.get("WRAITH_DEMO_SCENE") == "approval" else EDIT_TURNS

def sse(payload: dict) -> bytes:
    return b"data: " + json.dumps(payload, ensure_ascii=False).encode() + b"\n\n"


def chunk(delta: dict) -> dict:
    return {
        "id": "chatcmpl-demo",
        "object": "chat.completion.chunk",
        "model": "wraith-demo",
        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass  # 别把日志刷到截图那个终端里

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)

        n = CALLS["n"]
        CALLS["n"] = n + 1
        turn = TURNS[min(n, len(TURNS) - 1)]

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        def write(data: bytes):
            self.wfile.write(data)
            self.wfile.flush()

        # reasoning 逐段吐 —— 思考面板要能看出它在动
        for piece in split_for_stream(turn.get("reasoning", "")):
            write(sse(chunk({"reasoning_content": piece})))
            time.sleep(0.06)

        if "text" in turn:
            for piece in split_for_stream(turn["text"]):
                write(sse(chunk({"content": piece})))
                time.sleep(0.04)
        else:
            tool = turn["tool"]
            write(sse(chunk({"tool_calls": [{
                "index": 0,
                "id": tool["id"],
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "arguments": json.dumps(tool["arguments"], ensure_ascii=False),
                },
            }]})))

        finish = "tool_calls" if "tool" in turn else "stop"
        write(sse({
            "id": "chatcmpl-demo",
            "object": "chat.completion.chunk",
            "model": "wraith-demo",
            "choices": [{"index": 0, "delta": {}, "finish_reason": finish}],
        }))
        write(b"data: [DONE]\n\n")


def split_for_stream(text: str, size: int = 12):
    return [text[i:i + size] for i in range(0, len(text), size)]


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
