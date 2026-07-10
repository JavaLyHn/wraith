package com.lyhn.wraith.gateway.wecom;

import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

class WecomProviderTest {

    private WecomProvider provider(String owner, Runnable wsLoop) {
        return new WecomProvider(owner, new WecomWsClient(new OkHttpClient(), "b", "s"), wsLoop);
    }

    @Test
    void platformIsWecom() {
        assertEquals("wecom", provider("U", () -> {}).platform());
    }

    @Test
    void deliveryAdapterEmptyInPhaseA() {
        // Phase A 尚无投递适配器(归 Phase B);此处应为 empty。
        assertTrue(provider("U", () -> {}).deliveryAdapter().isEmpty());
    }

    @Test
    void startRunsWsLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        provider("U", ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把 wsLoop 放新线程跑并立即返回");
    }
}
