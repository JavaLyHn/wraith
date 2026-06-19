package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** {@link Main#mouseEnabled(String)} —— WRAITH_MOUSE 开关解析(默认开,off/0/false/no 关)。 */
class MainMouseToggleTest {

    @Test
    void defaultsOnWhenUnset() {
        assertTrue(Main.mouseEnabled(null));
    }

    @Test
    void offValuesDisable() {
        assertFalse(Main.mouseEnabled("off"));
        assertFalse(Main.mouseEnabled("0"));
        assertFalse(Main.mouseEnabled("false"));
        assertFalse(Main.mouseEnabled("no"));
    }

    @Test
    void caseAndWhitespaceInsensitive() {
        assertFalse(Main.mouseEnabled("  OFF  "));
        assertFalse(Main.mouseEnabled("False"));
        assertFalse(Main.mouseEnabled("No"));
    }

    @Test
    void otherValuesEnable() {
        assertTrue(Main.mouseEnabled("on"));
        assertTrue(Main.mouseEnabled("1"));
        assertTrue(Main.mouseEnabled("true"));
        assertTrue(Main.mouseEnabled(""));
        assertTrue(Main.mouseEnabled("yes"));
    }
}
