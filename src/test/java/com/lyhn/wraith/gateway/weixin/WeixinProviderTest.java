package com.lyhn.wraith.gateway.weixin;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class WeixinProviderTest {

    @Test
    void platformIsWeixin() {
        assertEquals("weixin", new WeixinProvider("OWNER", () -> {}).platform());
    }

    @Test
    void deliveryAdapterPresentInPhaseB() {
        var opt = new WeixinProvider("OWNER", () -> {}).deliveryAdapter();
        assertTrue(opt.isPresent());
        assertEquals("weixin", opt.get().platform());
    }

    @Test
    void startRunsPollLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        new WeixinProvider("OWNER", ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把轮询回路放新线程跑并立即返回");
    }

    @Test
    void approvalReplyCompletesScheduledFuture() {
        java.util.Map<String, java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>> pending =
                new java.util.concurrent.ConcurrentHashMap<>();
        var future = new java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>();
        pending.put("run1#1", future);
        java.util.List<String> sent = new java.util.ArrayList<>();
        WeixinProvider p = new WeixinProvider("OWNER", () -> {}, pending, (ctx, text) -> sent.add(text));
        p.registerPendingForTest("run1#1", "CTX");
        p.handleApprovalText("y", "CTX");
        assertTrue(future.isDone());
        assertTrue(future.join().isApproved());
        assertNull(p.pendingSessionKeyForTest(), "回复后应清挂起");
        assertFalse(sent.isEmpty(), "应回执「已批准」");
    }

    @Test
    void surfaceScheduledApprovalUnreachableAutoRejects() {
        java.util.Map<String, java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>> pending =
                new java.util.concurrent.ConcurrentHashMap<>();
        var future = new java.util.concurrent.CompletableFuture<com.lyhn.wraith.hitl.ApprovalResult>();
        pending.put("run2#1", future);
        WeixinProvider p = new WeixinProvider("OWNER", () -> {}, pending, (ctx, text) -> {});
        p.surfaceScheduledApproval("run2#1", "shell", "跑脚本"); // 无 ownerContextToken
        assertTrue(future.isDone());
        assertFalse(future.join().isApproved(), "不可达应 fail-closed 自动拒绝");
    }
}
