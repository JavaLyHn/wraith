package com.lyhn.wraith.gateway.feishu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.automation.delivery.FeishuDeliveryAdapter;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class FeishuProviderTest {

    private FeishuProvider provider(String ownerOpenid, List<String[]> cards, Runnable wsLoop) {
        FeishuDeliveryAdapter deliver = new FeishuDeliveryAdapter(ownerOpenid, (o, t) -> {});
        return new FeishuProvider(deliver, ownerOpenid,
                (openId, cardJson) -> cards.add(new String[]{openId, cardJson}), wsLoop);
    }

    @Test
    void platformIsFeishu() {
        assertEquals("feishu", provider("ou_o", new ArrayList<>(), () -> {}).platform());
    }

    @Test
    void deliveryAdapterPresentAndFeishu() {
        var p = provider("ou_o", new ArrayList<>(), () -> {});
        var opt = p.deliveryAdapter();
        assertTrue(opt.isPresent());
        assertEquals("feishu", opt.get().platform());
    }

    @Test
    void surfaceScheduledApprovalSendsCardToOwnerWithApprovalId() {
        List<String[]> cards = new ArrayList<>();
        provider("ou_o", cards, () -> {}).surfaceScheduledApproval("run1#1", "shell", "跑个脚本");
        assertEquals(1, cards.size());
        assertEquals("ou_o", cards.get(0)[0]);
        assertTrue(cards.get(0)[1].contains("run1#1"), "审批卡按钮 value 应含 approvalId 作 sessionKey");
    }

    @Test
    void surfaceScheduledApprovalNoOpWhenOwnerUnbound() {
        List<String[]> cards = new ArrayList<>();
        provider("", cards, () -> {}).surfaceScheduledApproval("run1#1", "shell", "跑个脚本");
        assertTrue(cards.isEmpty(), "owner 未绑定时不应发审批卡");
    }

    @Test
    void textContentJsonIsValidJsonAndEscapesSpecialChars() throws Exception {
        // 回归 code=230001:含换行/引号/反斜杠的答案必须拼成合法 JSON 且原文完整还原。
        String tricky = "第一行\n带\"引号\"和\\反斜杠";
        String content = FeishuProvider.textContentJson(tricky);
        JsonNode node = new ObjectMapper().readTree(content); // 非法 JSON 会在此抛出
        assertEquals(tricky, node.get("text").asText(), "text 字段应无损还原");
    }

    @Test
    void textContentJsonNullTextBecomesEmptyString() throws Exception {
        JsonNode node = new ObjectMapper().readTree(FeishuProvider.textContentJson(null));
        assertEquals("", node.get("text").asText());
    }

    @Test
    void startRunsWsLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        provider("ou_o", new ArrayList<>(), ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把 wsLoop 放到新线程上跑并立即返回");
    }
}
