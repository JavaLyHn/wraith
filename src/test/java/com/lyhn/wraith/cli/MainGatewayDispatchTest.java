package com.lyhn.wraith.cli;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MainGatewayDispatchTest {

    @Test
    void detectsGatewayCommand() {
        assertTrue(Main.isGatewayCommand(new String[]{"gateway"}));
        assertTrue(Main.isGatewayCommand(new String[]{"gateway", "bind"}));
        assertFalse(Main.isGatewayCommand(new String[]{"app-server"}));
        assertFalse(Main.isGatewayCommand(new String[]{}));
    }
}
