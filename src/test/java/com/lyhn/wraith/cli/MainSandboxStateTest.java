package com.lyhn.wraith.cli;

import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import com.lyhn.wraith.policy.sandbox.SandboxKind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@code sandbox.get} / {@code sandbox.set} 的回包契约。
 *
 * <p>刻意断言的是<b>一致性</b>而不是绝对值：本机跑出来必然是 SEATBELT，
 * 写死 "macos-seatbelt" 的用例换台机器就红，且红得毫无信息量。
 */
class MainSandboxStateTest {

    @Test
    @DisplayName("available 与 kind 不许打架 —— 前端两个字段都在读")
    void availableAgreesWithKind() {
        Map<String, Object> s = Main.sandboxState(new CommandSandbox(false));
        SandboxKind kind = CommandSandbox.detect();

        assertEquals(kind.wire(), s.get("kind"));
        assertEquals(kind.sandboxed(), s.get("available"));
    }

    @Test
    void networkFlagPassesThrough() {
        assertEquals(true, Main.sandboxState(new CommandSandbox(true)).get("networkAllowed"));
        assertEquals(false, Main.sandboxState(new CommandSandbox(false)).get("networkAllowed"));
    }

    @Test
    @DisplayName("沙箱为 null 时按未放行网络处理(保守)")
    void nullSandboxMeansNoNetwork() {
        assertEquals(false, Main.sandboxState(null).get("networkAllowed"));
    }

    @Test
    @DisplayName("有沙箱时不带降级原因;没沙箱时必须带 —— 此前这个原因只进 log.warn,桌面看不到")
    void degradedReasonPresentExactlyWhenUnsandboxed() {
        Map<String, Object> s = Main.sandboxState(new CommandSandbox(false));
        boolean sandboxed = (Boolean) s.get("available");
        Object reason = s.get("degradedReason");

        if (sandboxed) {
            assertNull(reason, "有沙箱却给了降级原因: " + reason);
        } else {
            assertNotNull(reason, "无沙箱必须说明原因,否则用户无从判断该怎么办");
            assertTrue(reason.toString().contains("命令黑名单"),
                    "降级文案要说清还剩什么在保护: " + reason);
        }
    }

    @Test
    @DisplayName("回包字段齐全 —— 少一个前端就得靠 undefined 猜")
    void allFieldsPresent() {
        Map<String, Object> s = Main.sandboxState(new CommandSandbox(false));
        assertTrue(s.containsKey("available"));
        assertTrue(s.containsKey("kind"));
        assertTrue(s.containsKey("networkAllowed"));
        assertTrue(s.containsKey("degradedReason"));
    }
}
