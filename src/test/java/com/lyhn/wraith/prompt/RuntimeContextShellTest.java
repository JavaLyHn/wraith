package com.lyhn.wraith.prompt;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 系统提示要告诉模型 {@code execute_command} 背后是哪个 shell。
 *
 * <p>不说的话，模型在 Windows 上会照 POSIX 习惯吐 {@code ls -la}，
 * 拿一堆「不是内部或外部命令」回来，白烧几轮往返才自己纠正过来。
 */
class RuntimeContextShellTest {

    @Test
    @DisplayName("Windows 明确点名 cmd.exe,并给出常用命令对照")
    void windowsAnnouncesCmd() {
        String s = PromptAssembler.runtimeContext("2026-08-02", "Asia/Shanghai", "Windows 11");
        assertTrue(s.contains("cmd.exe"), s);
        assertTrue(s.contains("dir"), "应给出 ls→dir 的对照: " + s);
        assertTrue(s.contains("Windows 11"), "应报出真实 os.name");
        assertFalse(s.contains("shell 是 **bash**"), "Windows 上不该说 bash: " + s);
    }

    @Test
    void posixAnnouncesBash() {
        String s = PromptAssembler.runtimeContext("2026-08-02", "Asia/Shanghai", "Mac OS X");
        assertTrue(s.contains("bash"), s);
        assertFalse(s.contains("cmd.exe"), s);
    }

    @Test
    @DisplayName("Darwin 不能被当成 Windows —— 字符串里含 win")
    void darwinIsNotWindows() {
        String s = PromptAssembler.runtimeContext("2026-08-02", "UTC", "Darwin");
        assertFalse(s.contains("cmd.exe"), "「Darwin」含 win,不能据此判为 Windows: " + s);
    }

    @Test
    void keepsDateAndZone() {
        String s = PromptAssembler.runtimeContext("2026-08-02", "Asia/Shanghai", "Linux");
        assertTrue(s.contains("2026-08-02"));
        assertTrue(s.contains("Asia/Shanghai"));
    }

    @Test
    void blankOsNameTolerated() {
        String s = PromptAssembler.runtimeContext("2026-08-02", "UTC", "");
        assertTrue(s.contains("未知"), s);
    }
}
