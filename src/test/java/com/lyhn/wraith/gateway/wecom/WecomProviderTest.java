package com.lyhn.wraith.gateway.wecom;

import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.gateway.wecom.WecomFrames.CardEvent;

import static org.junit.jupiter.api.Assertions.*;

class WecomProviderTest {

    private WecomProvider provider(String owner, Runnable wsLoop) {
        return new WecomProvider(owner, new WecomWsClient(new OkHttpClient(), "b", "s"), wsLoop,
                new HashMap<>());
    }

    @Test
    void platformIsWecom() {
        assertEquals("wecom", provider("U", () -> {}).platform());
    }

    @Test
    void deliveryAdapterPresentInPhaseB() {
        var opt = provider("U", () -> {}).deliveryAdapter();
        assertTrue(opt.isPresent());
        assertEquals("wecom", opt.get().platform());
    }

    @Test
    void startRunsWsLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        provider("U", ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把 wsLoop 放新线程跑并立即返回");
    }

    @Test
    void onEventCompletesScheduledApprovalFuture() throws Exception {
        var pending = new HashMap<String, CompletableFuture<ApprovalResult>>();
        CompletableFuture<ApprovalResult> future = new CompletableFuture<>();
        pending.put("sess-123", future);

        WecomProvider p = new WecomProvider("U", new WecomWsClient(new OkHttpClient(), "b", "s"),
                () -> {}, pending);

        // 模拟卡片事件:operator=U(主人),eventKey=approve_once,taskId=sess-123
        CardEvent ce = new CardEvent("approve_once", "sess-123", "U");
        p.triggerOnEventForTest(ce);

        assertTrue(future.isDone(), "onEvent 应当完成 CompletableFuture");
        assertTrue(future.get(1, TimeUnit.SECONDS).isApproved());
    }
}
