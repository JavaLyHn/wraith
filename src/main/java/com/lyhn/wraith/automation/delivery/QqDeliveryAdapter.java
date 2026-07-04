package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import com.lyhn.wraith.gateway.qq.QqApiClient;

import java.io.IOException;
import java.util.List;

/**
 * DeliveryAdapter for QQ C2C single-chat.
 *
 * <p>Strategy:
 * <ul>
 *   <li>If {@link PassiveWindow} reports a live msg_id (within 60-min passive
 *       reply window), send immediately via {@code QqApiClient.sendC2C}.
 *       On {@link IOException} (e.g. rate-limit, network hiccup) falls through
 *       to enqueue — never throws out of {@link #deliver}.</li>
 *   <li>Otherwise enqueue in {@link QqPendingStore} for later coalesced flush.</li>
 * </ul>
 *
 * <p>{@link #flush(String)} is called by the daemon on the next inbound DM:
 * it drains all pending items, coalesces them into ONE message (respecting
 * QQ's ≤4-replies-per-msg_id limit), and sends via {@code sendC2C}.
 */
public final class QqDeliveryAdapter implements DeliveryAdapter {

    private final String ownerOpenid;
    private final QqApiClient api;
    private final QqPendingStore pending;
    private final PassiveWindow window;

    /**
     * @param ownerOpenid the QQ openid of the bot owner to deliver to
     * @param api         the QQ API client
     * @param pending     persisted queue for out-of-window deliveries
     * @param window      provides a live msg_id if within the passive window
     */
    public QqDeliveryAdapter(String ownerOpenid,
                              QqApiClient api,
                              QqPendingStore pending,
                              PassiveWindow window) {
        this.ownerOpenid = ownerOpenid;
        this.api = api;
        this.pending = pending;
        this.window = window;
    }

    @Override
    public String platform() {
        return "qq";
    }

    /**
     * Delivers the run result to the owner.
     *
     * <p>If a fresh msg_id is available via {@link PassiveWindow}, attempts an
     * immediate passive send. On success returns immediately. On failure
     * (IOException) falls through to enqueue. If no fresh msg_id, enqueues
     * directly. Never throws.
     */
    @Override
    public void deliver(DeliveryTarget target, AutomationTask task, AutomationRunner.RunResult result) {
        String msgId = window.freshMsgId(ownerOpenid);
        if (msgId != null) {
            try {
                api.sendC2C(ownerOpenid, format(task, result), msgId);
                return;
            } catch (IOException ignored) {
                // fall through to enqueue
            }
        }
        QqPendingStore.Pending p = new QqPendingStore.Pending();
        p.taskName = task.name;
        p.answer = result.answer();
        p.ts = System.currentTimeMillis();
        pending.enqueue(p);
    }

    /**
     * Flushes all pending deliveries as a single coalesced message.
     *
     * <p>Called by the daemon on the next inbound DM. Drains {@link QqPendingStore},
     * builds a digest, and sends it as ONE message via {@code sendC2C}.
     * Coalescing into one message respects QQ's ≤4-replies-per-msg_id limit.
     *
     * @param freshMsgId the msg_id of the triggering inbound DM (passive reply token)
     * @return the coalesced digest string, or {@code null} if nothing was pending
     * @throws IOException if the underlying {@code sendC2C} call fails
     */
    public String flush(String freshMsgId) throws IOException {
        List<QqPendingStore.Pending> ps = pending.drainAll();
        if (ps.isEmpty()) {
            return null;
        }
        String digest = coalesce(ps);
        api.sendC2C(ownerOpenid, digest, freshMsgId);
        return digest;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Formats a single task result for immediate delivery.
     * Example: "⏰ daily-report:\nAll green"
     */
    private static String format(AutomationTask task, AutomationRunner.RunResult result) {
        return "⏰ " + task.name + ":\n" + result.answer();
    }

    /**
     * Coalesces multiple pending items into a single digest message.
     * Example:
     * <pre>
     * 📋 你有 2 条定时结果:
     * - task-alpha: Alpha result
     * - task-beta: Beta result
     * </pre>
     */
    private static String coalesce(List<QqPendingStore.Pending> ps) {
        StringBuilder sb = new StringBuilder();
        sb.append("📋 你有 ").append(ps.size()).append(" 条定时结果:\n");
        for (QqPendingStore.Pending p : ps) {
            sb.append("- ").append(p.taskName).append(": ").append(p.answer).append("\n");
        }
        return sb.toString().stripTrailing();
    }
}
