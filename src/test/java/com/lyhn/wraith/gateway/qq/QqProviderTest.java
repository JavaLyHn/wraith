package com.lyhn.wraith.gateway.qq;

import com.lyhn.wraith.automation.delivery.QqDeliveryAdapter;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class QqProviderTest {

    private QqProvider provider(Path dir, Runnable wsLoop) {
        QqPendingStore pending = new QqPendingStore(dir);
        // api=null: these tests never call deliver()/flush(), so no network is touched.
        QqDeliveryAdapter adapter = new QqDeliveryAdapter("owner-openid", null, pending, openid -> null);
        return new QqProvider(adapter, pending, wsLoop);
    }

    @Test
    void platformIsQq(@TempDir Path dir) {
        assertEquals("qq", provider(dir, () -> {}).platform());
    }

    @Test
    void deliveryAdapterPresentAndQq(@TempDir Path dir) {
        var p = provider(dir, () -> {});
        assertTrue(p.deliveryAdapter().isPresent());
        assertEquals("qq", p.deliveryAdapter().get().platform());
    }

    @Test
    void surfaceScheduledApprovalEnqueuesApprovalPending(@TempDir Path dir) {
        QqPendingStore pending = new QqPendingStore(dir);
        QqDeliveryAdapter adapter = new QqDeliveryAdapter("owner-openid", null, pending, openid -> null);
        QqProvider p = new QqProvider(adapter, pending, () -> {});

        p.surfaceScheduledApproval("run1#1", "web_fetch", "抓取每日榜单");

        List<QqPendingStore.Pending> list = pending.drainAll();
        assertEquals(1, list.size());
        assertEquals("run1#1", list.get(0).approvalId);
        assertEquals("web_fetch", list.get(0).taskName);
        assertEquals("抓取每日榜单", list.get(0).answer);
    }

    @Test
    void surfaceScheduledApprovalNullSuggestionUsesDefault(@TempDir Path dir) {
        QqPendingStore pending = new QqPendingStore(dir);
        QqDeliveryAdapter adapter = new QqDeliveryAdapter("owner-openid", null, pending, openid -> null);
        QqProvider p = new QqProvider(adapter, pending, () -> {});

        p.surfaceScheduledApproval("run1#2", "shell", null);

        assertEquals("定时任务审批", pending.drainAll().get(0).answer);
    }

    @Test
    void startRunsWsLoopOnDaemonThread(@TempDir Path dir) throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        QqProvider p = provider(dir, ran::countDown);
        p.start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把 wsLoop 放到一条新线程上跑,并立即返回");
    }
}
