// src/test/java/com/lyhn/wraith/render/RendererDefaultMethodsTest.java
package com.lyhn.wraith.render;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

class RendererDefaultMethodsTest {
    @Test
    void defaultToolOutputMethodsAreNoOp() {
        Renderer r = new PlainRenderer();
        assertDoesNotThrow(() -> {
            r.appendToolOutputDelta("c1", "stdout", "hello\n");
            r.appendToolResult("c1", true, 0);
        });
    }
}
