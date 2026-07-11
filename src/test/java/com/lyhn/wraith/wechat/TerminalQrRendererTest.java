package com.lyhn.wraith.wechat;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TerminalQrRendererTest {
    @Test
    void rendersQrAsAnsiBlocks() {
        String rendered = TerminalQrRenderer.renderAnsi("https://liteapp.weixin.qq.com/q/test?qrcode=abc");

        assertTrue(rendered.contains("\u001B[40m"));
        assertTrue(rendered.contains("\u001B[107m"));
        assertTrue(rendered.contains("▀"));
        assertFalse(rendered.contains("https://liteapp.weixin.qq.com"));
    }

    @Test
    void rendersInlinePngAtExpectedSize() {
        String rendered = TerminalQrRenderer.renderInlinePng(
                "https://liteapp.weixin.qq.com/q/test?qrcode=abc",
                TerminalQrRenderer.DEFAULT_IMAGE_SIZE_PX);

        assertTrue(rendered.startsWith("\u001B]1337;File=inline=1;width=260px;height=260px;"));
        assertFalse(rendered.contains("https://liteapp.weixin.qq.com"));
    }

    @Test
    void rendersPngBytes() throws Exception {
        byte[] png = TerminalQrRenderer.renderPng(
                "https://liteapp.weixin.qq.com/q/test?qrcode=abc",
                TerminalQrRenderer.DEFAULT_IMAGE_SIZE_PX);

        assertTrue(png.length > 100);
        assertEquals((byte) 0x89, png[0]);
        assertEquals((byte) 'P', png[1]);
        assertEquals((byte) 'N', png[2]);
        assertEquals((byte) 'G', png[3]);
    }

    @Test
    void pngMarkerCarriesDecodablePngBase64() {
        String marker = TerminalQrRenderer.pngMarker("https://liteapp.weixin.qq.com/q/test?qrcode=abc");

        assertTrue(marker.startsWith(TerminalQrRenderer.QR_PNG_MARKER + " "));
        String base64 = marker.substring((TerminalQrRenderer.QR_PNG_MARKER + " ").length());
        // 单行(无换行),便于桌面按行解析
        assertFalse(base64.contains("\n"));
        byte[] png = java.util.Base64.getDecoder().decode(base64);
        assertEquals((byte) 0x89, png[0]);
        assertEquals((byte) 'P', png[1]);
        assertEquals((byte) 'N', png[2]);
        assertEquals((byte) 'G', png[3]);
        // 二维码明文不得出现在标记里(仅 base64)
        assertFalse(marker.contains("https://liteapp.weixin.qq.com"));
    }

    @Test
    void pngMarkerReturnsNullForBlankContent() {
        assertEquals(null, TerminalQrRenderer.pngMarker(""));
        assertEquals(null, TerminalQrRenderer.pngMarker(null));
    }
}
