package com.lyhn.wraith.automation.delivery;

/**
 * Provides the most recent inbound msg_id that is still within QQ's 60-minute
 * passive-reply window for the given openid.
 *
 * <p>Returns the msg_id string if a fresh inbound message is available (received
 * within the last 60 minutes), or {@code null} if no such message exists or
 * the last one has expired.
 *
 * <p>The daemon supplies the real implementation in Task 12 by tracking the
 * last received {@code msg_id} and its arrival timestamp. Here it is a
 * constructor-injected collaborator so {@link QqDeliveryAdapter} can be
 * tested without a live daemon.
 */
@FunctionalInterface
public interface PassiveWindow {

    /**
     * Returns an inbound msg_id still within the 60-min passive reply window,
     * or {@code null} if none exists or the latest has expired.
     *
     * @param openid the QQ user openid to check
     * @return a fresh msg_id, or {@code null}
     */
    String freshMsgId(String openid);
}
