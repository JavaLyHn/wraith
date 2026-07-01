package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SeatbeltProfileTest {

    @Test
    void networkOffProfileDeniesNetworkAndConfinesWrites() {
        String p = SeatbeltProfile.workspaceWrite(false);
        assertTrue(p.contains("(version 1)"), p);
        assertTrue(p.contains("(allow default)"), "宽松读:allow default 打底");
        assertTrue(p.contains("(deny file-write*)"), "先全禁写");
        assertTrue(p.contains("(subpath (param \"WORKSPACE\"))"), "放行 workspace 写");
        assertTrue(p.contains("(subpath (param \"TMPDIR\"))"), "放行 TMPDIR 写");
        assertTrue(p.contains("(deny file-write* (subpath (param \"GIT_DIR\")))"), ".git 只读");
        assertTrue(p.contains("(deny network*)"), "默认断网");
    }

    @Test
    void networkOnProfileOmitsNetworkDenyButKeepsWriteConfinement() {
        String p = SeatbeltProfile.workspaceWrite(true);
        assertFalse(p.contains("(deny network*)"), "放行网络时不加断网规则");
        assertTrue(p.contains("(deny file-write*)"), "写限定与网络无关,始终保留");
        assertTrue(p.contains("(subpath (param \"WORKSPACE\"))"));
    }

    @Test
    void paramsCarryAllThreeDefines() {
        List<String> ps = SeatbeltProfile.params("/ws", "/tmpd", "/ws/.git");
        assertEquals(List.of(
                "-D", "WORKSPACE=/ws",
                "-D", "TMPDIR=/tmpd",
                "-D", "GIT_DIR=/ws/.git"), ps);
    }
}
