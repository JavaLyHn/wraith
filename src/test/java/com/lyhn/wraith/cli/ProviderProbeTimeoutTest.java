package com.lyhn.wraith.cli;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * provider「测试连接」卡住的根因有两层，这里守第二层：探测调用的超时上限。
 *
 * <p><b>第一层</b>（在 AppServer 里修）：{@code config.testProvider} 原本<b>同步跑在
 * {@code serve()} 那条唯一的 reader 线程上</b>，所以它一阻塞，整个 app-server 就处理不了
 * 任何 RPC —— 不只是那个按钮，整个桌面端都是死的。改用早就存在的 {@code dispatchAsync}。
 *
 * <p><b>第二层</b>（这里）：探测复用的是 {@code SHARED_HTTP_CLIENT}，它的超时是按
 * <b>真实对话</b>调的 —— connect 60s / read 300s / <b>callTimeout 600s</b>（放宽到这么大是为了
 * GLM-5.1 生成大段 reasoning_content 时服务端长时间静默）。但「测试连接」只是发一个 ping：
 * 用 10 分钟去等一个结论毫无意义，20 秒内给答案才有用。
 *
 * <p><b>已知残留</b>：超时返回后，那次 OkHttp 调用仍会在后台跑到 callTimeout 才结束 ——
 * OkHttp 的 socket 读不响应线程中断，而 {@code LlmClient} 接口没有暴露 {@code Call} 句柄可以
 * 取消。线程是守护线程、不阻塞退出，代价可接受；真要根治得给 LlmClient 加逐次调用的超时钩子，
 * 那要动所有 client 实现，不在本次范围内。
 */
class ProviderProbeTimeoutTest {

    @Test
    @DisplayName("正常返回时原样透传结果")
    void passesThroughWhenFastEnough() {
        Map<String, Object> ok = Map.of("ok", true, "model", "glm-4.7", "latencyMs", 12L);

        assertEquals(ok, Main.awaitProbe(() -> ok, 5));
    }

    @Test
    @DisplayName("超时返回 ok:false + 人话，而不是把调用方吊死")
    void timesOutWithAHumanMessage() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        long t0 = System.nanoTime();

        Map<String, Object> r = Main.awaitProbe(() -> {
            release.await();                 // 永远等不到 —— 模拟「能连上但不回应」
            return Map.of("ok", true);
        }, 1);

        long elapsedMs = (System.nanoTime() - t0) / 1_000_000L;
        assertEquals(Boolean.FALSE, r.get("ok"));
        assertNotNull(r.get("error"));
        String error = String.valueOf(r.get("error"));
        assertTrue(error.contains("秒"), "该说清是多少秒内没响应: " + error);
        assertTrue(error.contains("baseUrl") || error.contains("网络"),
                "该给出可行动的方向,而不是只说「超时」: " + error);
        assertTrue(elapsedMs < 10_000,
                "必须在给定上限附近返回,不能等到 callTimeout;实测 " + elapsedMs + "ms");
        release.countDown();                 // 收尾,别把后台线程留在 await 上
    }

    @Test
    @DisplayName("探测自身抛异常时也回 ok:false，不把异常抛给 RPC 层")
    void probeExceptionBecomesOkFalse() {
        Map<String, Object> r = Main.awaitProbe(() -> { throw new IllegalStateException("boom"); }, 5);

        assertEquals(Boolean.FALSE, r.get("ok"));
        assertTrue(String.valueOf(r.get("error")).contains("boom"),
                "原因要透出来,否则用户只看到一句「失败」: " + r.get("error"));
    }

    @Test
    @DisplayName("默认上限取 20 秒，且可用系统属性覆盖 —— 中转站冷启动慢的人自己调")
    void defaultTimeoutIsTwentySecondsAndOverridable() {
        String previous = System.getProperty("wraith.llm.probe.timeout.seconds");
        System.clearProperty("wraith.llm.probe.timeout.seconds");
        try {
            assertEquals(20L, Main.probeTimeoutSeconds());

            System.setProperty("wraith.llm.probe.timeout.seconds", "45");
            assertEquals(45L, Main.probeTimeoutSeconds());

            // 非法值不该让测试连接整条路挂掉,退回默认
            System.setProperty("wraith.llm.probe.timeout.seconds", "abc");
            assertEquals(20L, Main.probeTimeoutSeconds());
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.llm.probe.timeout.seconds");
            } else {
                System.setProperty("wraith.llm.probe.timeout.seconds", previous);
            }
        }
    }

    @Test
    @DisplayName("探测线程是守护线程 —— 被放弃的那次调用不能拖住 JVM 退出")
    void probeThreadsAreDaemon() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        boolean[] daemon = {false};

        Map<String, Object> r = Main.awaitProbe(() -> {
            daemon[0] = Thread.currentThread().isDaemon();
            started.countDown();
            Thread.sleep(5_000);
            return Map.of("ok", true);
        }, 1);

        assertTrue(started.await(3, TimeUnit.SECONDS), "探测没跑起来");
        assertEquals(Boolean.FALSE, r.get("ok"));
        assertTrue(daemon[0], "探测线程必须是守护线程,否则超时后它会拖住 JVM 退出到 callTimeout");
    }
}
