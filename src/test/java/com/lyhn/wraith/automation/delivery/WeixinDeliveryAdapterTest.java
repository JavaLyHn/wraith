package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;

import static org.junit.jupiter.api.Assertions.*;

class WeixinDeliveryAdapterTest {

    private static AutomationTask makeTask(String name) {
        AutomationTask t = new AutomationTask();
        t.name = name;
        return t;
    }

    private static AutomationRunner.RunResult makeResult(String answer) {
        return new AutomationRunner.RunResult("success", answer, null, List.of());
    }

    private static DeliveryTarget makeTarget(String chatId) {
        DeliveryTarget dt = new DeliveryTarget();
        dt.platform = "weixin";
        dt.chatId = chatId;
        return dt;
    }

    @Test
    void platformIsWeixin() {
        WeixinDeliveryAdapter adapter = new WeixinDeliveryAdapter(() -> "ctx_xxx", (c, t) -> {});
        assertEquals("weixin", adapter.platform());
    }

    @Test
    void ownerContextTokenEmpty_sinkNotCalled() {
        List<String[]> sent = new ArrayList<>();
        WeixinDeliveryAdapter adapter = new WeixinDeliveryAdapter(() -> "", (c, t) -> sent.add(new String[]{c, t}));

        adapter.deliver(makeTarget("ctx_xxx"), makeTask("daily"), makeResult("全绿"));

        assertTrue(sent.isEmpty(), "contextToken 为空时 sink 不应被调用");
    }

    @Test
    void ownerContextTokenNull_sinkNotCalled() {
        List<String[]> sent = new ArrayList<>();
        WeixinDeliveryAdapter adapter = new WeixinDeliveryAdapter(() -> null, (c, t) -> sent.add(new String[]{c, t}));

        adapter.deliver(makeTarget("ctx_xxx"), makeTask("daily"), makeResult("全绿"));

        assertTrue(sent.isEmpty(), "contextToken 为 null 时 sink 不应被调用");
    }

    @Test
    void ownerContextTokenPresent_sinkReceivesTokenAndFormattedText() {
        List<String[]> sent = new ArrayList<>();
        WeixinDeliveryAdapter adapter = new WeixinDeliveryAdapter(() -> "ctx_abc123", (c, t) -> sent.add(new String[]{c, t}));

        // answer 含 markdown 加粗,纯文本应无 **
        adapter.deliver(makeTarget("ctx_xxx"), makeTask("morning-brief"), makeResult("**任务完成**"));

        assertEquals(1, sent.size());
        assertEquals("ctx_abc123", sent.get(0)[0]);
        assertTrue(sent.get(0)[1].contains("morning-brief"), "文本应包含任务名");
        assertTrue(sent.get(0)[1].contains("任务完成"), "文本应包含运行结果(纯文本)");
        assertFalse(sent.get(0)[1].contains("**"), "微信不渲染 markdown,输出不应含 **");
    }

    @Test
    void sinkThrows_deliverDoesNotPropagate() {
        BiConsumer<String, String> throwingSink = (c, t) -> {
            throw new RuntimeException("微信发送失败");
        };
        WeixinDeliveryAdapter adapter = new WeixinDeliveryAdapter(() -> "ctx_abc123", throwingSink);

        // 不应向外抛异常
        assertDoesNotThrow(() ->
                adapter.deliver(makeTarget("ctx_xxx"), makeTask("daily"), makeResult("ok"))
        );
    }
}
