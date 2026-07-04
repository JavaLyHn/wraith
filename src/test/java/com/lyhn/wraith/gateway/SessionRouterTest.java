package com.lyhn.wraith.gateway;

import org.junit.jupiter.api.Test;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SessionRouterTest {
    @Test void resolveCreatesOnceThenReuses() {
        AtomicInteger created = new AtomicInteger();
        SessionRouter r = new SessionRouter(openid -> { created.incrementAndGet(); return mock(GatewaySession.class); });
        GatewaySession a = r.resolve("O1");
        GatewaySession b = r.resolve("O1");
        assertSame(a, b);
        assertEquals(1, created.get());
        r.reset("O1");
        GatewaySession c = r.resolve("O1");
        assertNotSame(a, c);
        assertEquals(2, created.get());
    }

    @Test void resetClosesRemovedSessionAndIsNullSafe() {
        GatewaySession sess = mock(GatewaySession.class);
        SessionRouter r = new SessionRouter(openid -> sess);
        r.resolve("O1");
        r.reset("O1");
        verify(sess).close();        // reset 关掉被移除的会话
        r.reset("unknown-openid");   // 未知 openid:remove 返 null,不抛
    }
}
