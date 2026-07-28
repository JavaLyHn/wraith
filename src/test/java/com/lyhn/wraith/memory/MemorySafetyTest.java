package com.lyhn.wraith.memory;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class MemorySafetyTest {
    @Test void detectsCredentials() {
        assertTrue(MemorySafety.isSensitive("数据库密码是 abc123"));
        assertTrue(MemorySafety.isSensitive("密钥: xyz789"));
        assertTrue(MemorySafety.isSensitive("访问令牌为 ghp_aaa"));
        assertTrue(MemorySafety.isSensitive("API key 是 sk-abc123def"));
        assertTrue(MemorySafety.isSensitive("password = hunter2"));
    }
    @Test void allowsBenign() {
        assertFalse(MemorySafety.isSensitive("用户偏好使用密码管理器 1Password"));
        assertFalse(MemorySafety.isSensitive("用户偏好 Java 17"));
        assertFalse(MemorySafety.isSensitive("项目用 Maven 构建"));
        assertFalse(MemorySafety.isSensitive(null));
    }
}
