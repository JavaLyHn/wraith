package com.lyhn.wraith.gateway;

import com.lyhn.wraith.gateway.qq.InboundMsg;
import com.lyhn.wraith.hitl.ApprovalResult;
import java.util.concurrent.ExecutorService;

public final class ImTurnDriver {
    public interface Sender { void send(String openid, String text, String replyToMsgId); }

    private final SessionRouter router;
    private final Sender sender;
    private final ExecutorService pool;

    public ImTurnDriver(SessionRouter router, Sender sender, ExecutorService pool) {
        this.router = router; this.sender = sender; this.pool = pool;
    }

    public void onMessage(InboundMsg m) {
        if ("/new".equals(m.text().trim())) {
            router.reset(m.openid());
            sender.send(m.openid(), "已开启新会话。", m.msgId());
            return;
        }
        pool.submit(() -> {
            try {
                GatewaySession s = router.resolve(m.openid());
                String reply = s.runTurn(m.text());
                sender.send(m.openid(), reply == null || reply.isBlank() ? "(空回复)" : reply, m.msgId());
            } catch (Exception e) {
                sender.send(m.openid(), "出错了:" + e.getClass().getSimpleName(), m.msgId());
            }
        });
    }

    /** WS 线程:按 sessionKey(= openid)唤醒挂起的审批。 */
    public void onApproval(String openid, ApprovalResult r) {
        GatewaySession s = router.resolve(openid);
        s.renderer().resolveApproval(r);
    }
}
