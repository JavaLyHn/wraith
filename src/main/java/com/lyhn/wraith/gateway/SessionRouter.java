package com.lyhn.wraith.gateway;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/** openid→进程内长活会话;/new 重建。v1 纯内存映射(持久化 deferred)。 */
public final class SessionRouter {
    private final Function<String, GatewaySession> factory;
    private final Map<String, GatewaySession> live = new ConcurrentHashMap<>();

    public SessionRouter(Function<String, GatewaySession> factory) {
        this.factory = factory;
    }

    /** get-or-create:openid 首次建会话,之后复用。 */
    public GatewaySession resolve(String openid) {
        return live.computeIfAbsent(openid, factory);
    }

    /** /new:移除并关闭当前会话(reap MCP 子进程),下次 resolve 重建;未知 openid 安全 no-op。 */
    public void reset(String openid) {
        GatewaySession removed = live.remove(openid);
        if (removed != null) {
            removed.close();
        }
    }
}
