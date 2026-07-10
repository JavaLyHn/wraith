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
    void deliveryAdapterEmptyInPhaseA() {
        assertTrue(new WeixinProvider("OWNER", () -> {}).deliveryAdapter().isEmpty());
    }

    @Test
    void startRunsPollLoopOnDaemonThread() throws Exception {
        CountDownLatch ran = new CountDownLatch(1);
        new WeixinProvider("OWNER", ran::countDown).start();
        assertTrue(ran.await(2, TimeUnit.SECONDS), "start() 应把轮询回路放新线程跑并立即返回");
    }
}
