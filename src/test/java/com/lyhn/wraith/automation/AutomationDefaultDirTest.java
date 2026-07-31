package com.lyhn.wraith.automation;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class AutomationDefaultDirTest {

    @Test
    void defaultDirHonoursSystemProperty(@TempDir Path tmp) {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.setProperty("wraith.automation.dir", tmp.toString());
            assertEquals(tmp, AutomationStore.defaultDir());
            assertNotNull(AutomationStore.openDefault());
            assertNotNull(RequestInbox.openDefault());
        } finally {
            if (old == null) System.clearProperty("wraith.automation.dir");
            else System.setProperty("wraith.automation.dir", old);
        }
    }

    @Test
    void defaultDirFallsBackToHomeWraith() {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.clearProperty("wraith.automation.dir");
            assertEquals(Path.of(System.getProperty("user.home"), ".wraith"), AutomationStore.defaultDir());
        } finally {
            if (old != null) System.setProperty("wraith.automation.dir", old);
        }
    }

    @Test
    void blankPropertyAlsoFallsBack() {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.setProperty("wraith.automation.dir", "   ");
            assertEquals(Path.of(System.getProperty("user.home"), ".wraith"), AutomationStore.defaultDir());
        } finally {
            if (old == null) System.clearProperty("wraith.automation.dir");
            else System.setProperty("wraith.automation.dir", old);
        }
    }

    @Test
    void requestsDirIsSubdirOfBase(@TempDir Path tmp) {
        String old = System.getProperty("wraith.automation.dir");
        try {
            System.setProperty("wraith.automation.dir", tmp.toString());
            assertEquals(tmp.resolve("automation-requests"), AutomationStore.defaultRequestsDir());
        } finally {
            if (old == null) System.clearProperty("wraith.automation.dir");
            else System.setProperty("wraith.automation.dir", old);
        }
    }
}
