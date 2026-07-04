package com.lyhn.wraith.gateway;
import com.lyhn.wraith.gateway.qq.InboundMsg;
import org.junit.jupiter.api.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImTurnDriverTest {
    ExecutorService pool;
    @BeforeEach void up(){ pool = Executors.newCachedThreadPool(); }
    @AfterEach void down(){ pool.shutdownNow(); }

    @Test @Timeout(5)
    void runsTurnAndSendsPassiveReply() throws Exception {
        GatewaySession sess = mock(GatewaySession.class);
        when(sess.runTurn("在吗")).thenReturn("你好");
        SessionRouter router = mock(SessionRouter.class);
        when(router.resolve("O1")).thenReturn(sess);
        CountDownLatch sent = new CountDownLatch(1);
        AtomicReference<String[]> got = new AtomicReference<>();
        ImTurnDriver d = new ImTurnDriver(router,
                (openid,text,reply) -> { got.set(new String[]{openid,text,reply}); sent.countDown(); }, pool);
        d.onMessage(new InboundMsg("O1","在吗","MSG1", 0));
        assertTrue(sent.await(3, TimeUnit.SECONDS));
        assertArrayEquals(new String[]{"O1","你好","MSG1"}, got.get());
    }

    @Test @Timeout(5)
    void newCommandResetsSession() throws Exception {
        SessionRouter router = mock(SessionRouter.class);
        CountDownLatch sent = new CountDownLatch(1);
        ImTurnDriver d = new ImTurnDriver(router, (o,t,r) -> sent.countDown(), pool);
        d.onMessage(new InboundMsg("O1","/new","MSG2", 0));
        assertTrue(sent.await(3, TimeUnit.SECONDS));
        verify(router).reset("O1");
        verify(router, never()).resolve("O1");
    }

    @Test @Timeout(5)
    void turnFailureSendsError() throws Exception {
        GatewaySession sess = mock(GatewaySession.class);
        when(sess.runTurn(anyString())).thenThrow(new RuntimeException("boom"));
        SessionRouter router = mock(SessionRouter.class);
        when(router.resolve("O1")).thenReturn(sess);
        AtomicReference<String> msg = new AtomicReference<>();
        CountDownLatch sent = new CountDownLatch(1);
        ImTurnDriver d = new ImTurnDriver(router, (o,t,r) -> { msg.set(t); sent.countDown(); }, pool);
        d.onMessage(new InboundMsg("O1","hi","MSG3", 0));
        assertTrue(sent.await(3, TimeUnit.SECONDS));
        assertTrue(msg.get().contains("出错"));
    }
}
