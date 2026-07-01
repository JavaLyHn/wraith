package com.lyhn.wraith.cli;

import com.lyhn.wraith.policy.sandbox.CommandSandbox;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MainAppServerSandboxTest {

    private static final String KEY = "wraith.sandbox.network";

    @Test
    void defaultsToNetworkOff() {
        String prev = System.getProperty(KEY);
        System.clearProperty(KEY);
        try {
            CommandSandbox s = Main.buildAppServerSandbox();
            assertFalse(s.networkAllowed(), "默认断网");
        } finally {
            restore(prev);
        }
    }

    @Test
    void propertyOnEnablesNetwork() {
        String prev = System.getProperty(KEY);
        System.setProperty(KEY, "on");
        try {
            assertTrue(Main.buildAppServerSandbox().networkAllowed(), "-Dwraith.sandbox.network=on 放行");
        } finally {
            restore(prev);
        }
    }

    @Test
    void propertyOtherValueStaysOff() {
        String prev = System.getProperty(KEY);
        System.setProperty(KEY, "yes");
        try {
            assertFalse(Main.buildAppServerSandbox().networkAllowed(), "非 on 值一律断网");
        } finally {
            restore(prev);
        }
    }

    private static void restore(String prev) {
        if (prev == null) System.clearProperty(KEY);
        else System.setProperty(KEY, prev);
    }
}
