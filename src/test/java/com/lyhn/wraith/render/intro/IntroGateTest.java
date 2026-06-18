package com.lyhn.wraith.render.intro;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IntroGateTest {

    @Test
    void capableTerminalPlaysEveryLaunch() {
        assertTrue(IntroGate.shouldPlay(true, true, true, 80, null));
    }

    @Test
    void offDisables() {
        assertFalse(IntroGate.shouldPlay(true, true, true, 80, "off"));
        assertFalse(IntroGate.shouldPlay(true, true, true, 80, "0"));
    }

    @Test
    void incapableTerminalSkips() {
        assertFalse(IntroGate.shouldPlay(false, true, true, 80, null), "not inline");
        assertFalse(IntroGate.shouldPlay(true, false, true, 80, null), "no color");
        assertFalse(IntroGate.shouldPlay(true, true, false, 80, null), "not tty");
    }

    @Test
    void tooNarrowSkipsAtMinBoundary() {
        assertFalse(IntroGate.shouldPlay(true, true, true, IntroGate.MIN_COLUMNS - 1, null));
        assertTrue(IntroGate.shouldPlay(true, true, true, IntroGate.MIN_COLUMNS, null));
    }
}
