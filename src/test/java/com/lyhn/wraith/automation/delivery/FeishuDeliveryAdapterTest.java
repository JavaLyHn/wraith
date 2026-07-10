package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FeishuDeliveryAdapterTest {

    @Test
    void platformIsFeishu() {
        assertEquals("feishu", new FeishuDeliveryAdapter("ou_o", (o, t) -> {}).platform());
    }

    @Test
    void deliverSendsFormattedResultToOwnerImmediately() {
        List<String[]> sent = new ArrayList<>();
        FeishuDeliveryAdapter a = new FeishuDeliveryAdapter("ou_o", (o, t) -> sent.add(new String[]{o, t}));

        AutomationTask task = new AutomationTask();
        task.name = "daily-report";
        AutomationRunner.RunResult result = new AutomationRunner.RunResult("success", "全绿", null, List.of());

        DeliveryTarget target = new DeliveryTarget();
        target.platform = "feishu";
        target.chatId = "ou_o";
        a.deliver(target, task, result);

        assertEquals(1, sent.size());
        assertEquals("ou_o", sent.get(0)[0]);
        assertTrue(sent.get(0)[1].contains("daily-report"));
        assertTrue(sent.get(0)[1].contains("全绿"));
    }
}
