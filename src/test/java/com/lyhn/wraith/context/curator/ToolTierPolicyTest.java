package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ToolTierPolicyTest {
    private final ToolTierPolicy policy = new ToolTierPolicy();

    @Test
    void protectedToolsAreNotCompressible() {
        assertFalse(policy.compressible("load_skill"));
        assertFalse(policy.compressible("save_memory"));
        assertFalse(policy.compressible("revert_turn"));
    }

    @Test
    void unknownAndWhitelistToolsAreCompressible() {
        assertTrue(policy.compressible("execute_command"));
        assertTrue(policy.compressible("grep_code"));
        assertTrue(policy.compressible("some_future_tool"));  // 新工具默认可压,保护靠名单显式声明
        assertTrue(policy.compressible(null));                 // 无名映射(找不到所属工具)按可压处理
    }
}
