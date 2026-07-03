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
}
