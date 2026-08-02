package com.lyhn.wraith.gateway.bind;

import com.lyhn.wraith.wechat.TerminalQrRenderer;
import org.junit.jupiter.api.Test;

import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

/**
 * QQ 接入卡此前只有「打开 QQ 授权页」一个按钮 —— 必须跳浏览器，
 * 而微信那张卡已经能在应用内直接显示二维码。差别不在于谁更重要，
 * 只在于微信的 iLink 返回二维码图片 URL，而 QQ 只返回一条 connect URL。
 *
 * <p>但 URL 本身就可以编码成二维码，且仓库里已有 zxing + {@link TerminalQrRenderer}
 * （微信那条内联通道走的就是它）。所以 QQ 复用同一条通道，不引入新依赖、不新增协议。
 *
 * <p><b>诚实边界</b>：这条 URL 原本是给<b>桌面浏览器</b>打开的（QQ 页面再渲染真正的扫码图）。
 * 直接扫它能否走通取决于 QQ 页面对移动端的处理，<b>未经真机验证</b>。
 * 因此桌面端同时保留「打开授权页」——扫得通省一跳，扫不通原路可走。
 */
class QqConnectQrTest {

    @Test
    void connectUrl_带上_openclaw_授权页所需的全部参数() {
        String u = BindCommand.connectUrl("task-abc-123");
        assertTrue(u.startsWith("https://q.qq.com/qqbot/openclaw/connect.html"), u);
        assertTrue(u.contains("task_id=task-abc-123"), u);
        assertTrue(u.contains("_wv=2"), "缺 _wv=2,QQ webview 可能不按预期打开: " + u);
        assertTrue(u.contains("source=wraith"), u);
    }

    @Test
    void connect_url_能被渲染成机读二维码标记() {
        // 这是内联二维码的全部前提:URL 编得进二维码,且以桌面能解析的单行标记输出。
        String marker = TerminalQrRenderer.pngMarker(BindCommand.connectUrl("t1"));
        assertNotNull(marker, "pngMarker 返回 null 说明二维码渲染失败,内联那半就是空的");
        assertTrue(marker.startsWith(TerminalQrRenderer.QR_PNG_MARKER + " "), marker.substring(0, 40));
    }

    @Test
    void 标记必须是单行_否则桌面按行解析会截断() {
        String marker = TerminalQrRenderer.pngMarker(BindCommand.connectUrl("t1"));
        assertFalse(marker.contains("\n"), "base64 里混了换行,桌面 readline 会把二维码截成半张");
        assertFalse(marker.contains("\r"), marker.substring(0, 40));
    }

    @Test
    void 载荷是合法_base64_png() {
        String marker = TerminalQrRenderer.pngMarker(BindCommand.connectUrl("t1"));
        String b64 = marker.substring(TerminalQrRenderer.QR_PNG_MARKER.length() + 1);
        byte[] png = assertDoesNotThrow(() -> Base64.getDecoder().decode(b64));
        // PNG magic:89 50 4E 47
        assertTrue(png.length > 100, "PNG 太小,不像真图: " + png.length);
        assertEquals((byte) 0x89, png[0]);
        assertEquals('P', png[1]);
        assertEquals('N', png[2]);
        assertEquals('G', png[3]);
    }

    @Test
    void 不同_taskId_产出不同二维码_不会串号() {
        String a = TerminalQrRenderer.pngMarker(BindCommand.connectUrl("task-A"));
        String b = TerminalQrRenderer.pngMarker(BindCommand.connectUrl("task-B"));
        assertNotEquals(a, b, "两个 task 的二维码相同 —— 扫谁都绑到同一个任务上");
    }
}
