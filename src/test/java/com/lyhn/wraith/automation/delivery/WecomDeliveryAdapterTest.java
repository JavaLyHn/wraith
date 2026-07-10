package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;

class WecomDeliveryAdapterTest {

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
        dt.platform = "wecom";
        dt.chatId = chatId;
        return dt;
    }

    @Test
    void platformIsWecom() {
        WecomDeliveryAdapter adapter = new WecomDeliveryAdapter(() -> "wg_xxx", (c, t) -> {});
        assertEquals("wecom", adapter.platform());
    }

    @Test
    void ownerChatIdEmpty_sinkNotCalled() {
        List<String[]> sent = new ArrayList<>();
        WecomDeliveryAdapter adapter = new WecomDeliveryAdapter(() -> "", (c, t) -> sent.add(new String[]{c, t}));

        adapter.deliver(makeTarget("wg_xxx"), makeTask("daily"), makeResult("全绿"));

        assertTrue(sent.isEmpty(), "chatId 为空时 sink 不应被调用");
    }

    @Test
    void ownerChatIdNull_sinkNotCalled() {
        List<String[]> sent = new ArrayList<>();
        WecomDeliveryAdapter adapter = new WecomDeliveryAdapter(() -> null, (c, t) -> sent.add(new String[]{c, t}));

        adapter.deliver(makeTarget("wg_xxx"), makeTask("daily"), makeResult("全绿"));

        assertTrue(sent.isEmpty(), "chatId 为 null 时 sink 不应被调用");
    }

    @Test
    void ownerChatIdPresent_sinkReceivesChatIdAndFormattedText() {
        List<String[]> sent = new ArrayList<>();
        WecomDeliveryAdapter adapter = new WecomDeliveryAdapter(() -> "wg_abc123", (c, t) -> sent.add(new String[]{c, t}));

        adapter.deliver(makeTarget("wg_xxx"), makeTask("morning-brief"), makeResult("任务完成"));

        assertEquals(1, sent.size());
        assertEquals("wg_abc123", sent.get(0)[0]);
        assertTrue(sent.get(0)[1].contains("morning-brief"), "文本应包含任务名");
        assertTrue(sent.get(0)[1].contains("任务完成"), "文本应包含运行结果");
    }

    @Test
    void sinkThrows_deliverDoesNotPropagate() {
        BiConsumer<String, String> throwingSink = (c, t) -> {
            throw new RuntimeException("企微发送失败");
        };
        WecomDeliveryAdapter adapter = new WecomDeliveryAdapter(() -> "wg_abc123", throwingSink);

        // 不应向外抛异常
        assertDoesNotThrow(() ->
                adapter.deliver(makeTarget("wg_xxx"), makeTask("daily"), makeResult("ok"))
        );
    }
}
