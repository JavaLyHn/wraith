package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.AutomationRunner;
import com.lyhn.wraith.automation.AutomationTask;
import com.lyhn.wraith.automation.DeliveryTarget;
import com.lyhn.wraith.gateway.qq.QqApiClient;
import com.lyhn.wraith.gateway.qq.QqApproval;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
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

    private static final Logger log = LoggerFactory.getLogger(QqDeliveryAdapter.class);

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
     * Flushes all pending deliveries.
     *
     * <p>Called by the daemon on the next inbound DM. Drains {@link QqPendingStore},
     * then:
     * <ul>
     *   <li>Plain delivery items (approvalId == null) are coalesced into ONE
     *       {@code sendC2C} message (respecting QQ's ≤4-replies-per-msg_id limit).</li>
     *   <li>Approval-pending items (approvalId != null) are each sent as a
     *       SEPARATE keyboard message via {@code sendC2CWithKeyboard}, so the user
     *       can tap approve/reject for each one.</li>
     * </ul>
     *
     * <p>On send failure all affected items are re-enqueued so they are NOT lost,
     * and the method returns null. Never throws.
     *
     * @param freshMsgId the msg_id of the triggering inbound DM (passive reply token)
     * @return the number of pending items successfully delivered this flush (0 if nothing pending or all sends failed)
     */
    public int flush(String freshMsgId) {
        List<QqPendingStore.Pending> ps = pending.drainAll();
        if (ps.isEmpty()) {
            return 0;
        }

        // Partition into plain deliveries and approval-pending items
        List<QqPendingStore.Pending> plain = new ArrayList<>();
        List<QqPendingStore.Pending> approvals = new ArrayList<>();
        for (QqPendingStore.Pending p : ps) {
            if (p.approvalId != null) {
                approvals.add(p);
            } else {
                plain.add(p);
            }
        }

        int delivered = 0;

        // Send each approval item as its own keyboard message
        for (QqPendingStore.Pending ap : approvals) {
            try {
                api.sendC2CWithKeyboard(ownerOpenid,
                        "⚠️ 定时任务需审批(点按钮同意/拒绝):",
                        freshMsgId,
                        QqApproval.keyboardJson(ap.approvalId));
                delivered++;
            } catch (IOException e) {
                // Re-enqueue on failure so it is retried on the next inbound DM
                pending.enqueue(ap);
                log.warn("QqDeliveryAdapter: flush 审批消息发送失败,已重新入队 approvalId={}", ap.approvalId, e);
            }
        }

        // Coalesce and send plain delivery items
        if (!plain.isEmpty()) {
            String digest = coalesce(plain);
            try {
                api.sendC2C(ownerOpenid, digest, freshMsgId);
                delivered += plain.size();
            } catch (IOException e) {
                for (QqPendingStore.Pending p : plain) pending.enqueue(p);
                log.warn("QqDeliveryAdapter: flush 发送失败,已重新入队 {} 条待发", plain.size(), e);
            }
        }

        return delivered;
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
