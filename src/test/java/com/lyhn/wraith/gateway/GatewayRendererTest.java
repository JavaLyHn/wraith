package com.lyhn.wraith.gateway;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class GatewayRendererTest {
    @Test
    @Timeout(5)
    void promptBlocksUntilResolved() throws Exception {
        AtomicReference<String> pushed = new AtomicReference<>();
        GatewayRenderer r = new GatewayRenderer("sess-1", pushed::set);
        ApprovalRequest req = new ApprovalRequest("run_terminal", "{\"cmd\":\"rm x\"}", "high", "risk", "sug", "ctx", "sens");
        ExecutorService ex = Executors.newSingleThreadExecutor();
        Future<ApprovalResult> f = ex.submit(() -> r.promptApproval(req));
        Thread.sleep(100);
        assertEquals("sess-1", pushed.get());               // 已推审批
        assertFalse(f.isDone());                            // 阻塞中
        r.resolveApproval(ApprovalResult.approve());
        assertEquals(ApprovalResult.Decision.APPROVED, f.get(2, TimeUnit.SECONDS).decision());
        ex.shutdownNow();
    }

    @Test
    @Timeout(5)
    void pushFailureFailsClosedInsteadOfHanging() {
        // approvalPusher 抛异常（QQ 推送失败）→ promptApproval 必须 fail-closed 返回 REJECTED，
        // 绝不阻塞在 f.get() 上把整个回合吊死（@Timeout 兜底）。
        GatewayRenderer r = new GatewayRenderer("sess-2", sk -> { throw new RuntimeException("push failed"); });
        ApprovalRequest req = new ApprovalRequest("run_terminal", "{\"cmd\":\"rm x\"}", "high", "risk", "sug", "ctx", "sens");
        ApprovalResult res = r.promptApproval(req);
        assertEquals(ApprovalResult.Decision.REJECTED, res.decision());
    }

    @Test
    @Timeout(5)
    void noResponseTimesOutFailsClosed() {
        // 推送成功但用户一直不点 → 有界超时后 fail-closed 返回 REJECTED，不无限阻塞。
        GatewayRenderer r = new GatewayRenderer("sess-3", sk -> { /* 推送成功，但从不 resolve */ }, 150);
        ApprovalRequest req = new ApprovalRequest("run_terminal", "{\"cmd\":\"rm x\"}", "high", "risk", "sug", "ctx", "sens");
        ApprovalResult res = r.promptApproval(req);
        assertEquals(ApprovalResult.Decision.REJECTED, res.decision());
    }
}
