// src/test/java/com/lyhn/wraith/cli/MainAppServerCommandTest.java
package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MainAppServerCommandTest {
    @Test
    void recognizesAppServerSubcommand() {
        assertTrue(Main.isAppServerCommand(new String[]{"app-server"}));
        assertTrue(Main.isAppServerCommand(new String[]{"app-server", "--anything"}));
    }
    @Test
    void rejectsOthers() {
        assertFalse(Main.isAppServerCommand(new String[]{"serve", "--http"}));
        assertFalse(Main.isAppServerCommand(new String[]{}));
        assertFalse(Main.isAppServerCommand(null));
    }
}
