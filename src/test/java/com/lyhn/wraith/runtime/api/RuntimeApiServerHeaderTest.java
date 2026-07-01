package com.lyhn.wraith.runtime.api;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RuntimeApiServerHeaderTest {
    @Test
    void apiKeyHeaderHasNoSpace() {
        assertEquals("X-Wraith-API-Key", RuntimeApiServer.API_KEY_HEADER);
        assertFalse(RuntimeApiServer.API_KEY_HEADER.contains(" "), "HTTP 头名不能含空格");
    }
}
