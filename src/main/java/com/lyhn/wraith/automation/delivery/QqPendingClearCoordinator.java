package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.DaemonRequest;
import com.lyhn.wraith.automation.RequestInbox;

import java.io.IOException;

/**
 * QQ 待发队列写操作(删单条 / 清结果)的跨进程协调。
 *
 * <p><b>为什么不能直接写:</b>{@link QqPendingStore} 的 mutator 是实例 {@code synchronized},
 * 只锁得住进程内。app-server 与 gateway daemon 是两个进程,同时读改写同一个 JSON 会丢更新
 * ——已删的消息可能复活并在下次冲刷时发出去。原设计因此规定写操作一律经 {@link RequestInbox}
 * 交给 daemon 在其实例锁内执行。
 *
 * <p><b>原设计漏了什么:</b>daemon 没运行时没人消费,请求文件就一直躺着 —— 界面点了「清空」
 * 毫无反应,队列纹丝不动,而且网关下次一起来那些消息照发。真机实证:automation-requests/ 里
 * 躺着两个 18:09 的 qq-pending-clear-*.json,而 qq-pending.json 仍有 25 条、mtime 停在 17:32。
 *
 * <p><b>本类的做法:</b>照旧先写请求(daemon 在跑就由它处理),然后在宽限期内轮询该文件是否
 * 消失。宽限期过后文件仍在,说明没有活着的消费者,此时用 {@code deleteIfExists} 抢所有权
 * ——它的返回值是跨进程原子的:<b>谁删掉谁负责执行</b>。抢到才由本进程落地,抢不到说明
 * daemon 刚好接手,本进程收手。
 *
 * <p>即便两侧在极窄窗口内都执行了也无害:删除类操作是收敛的(都只是移除同一批条目),
 * 不会让已删条目复活。
 */
public final class QqPendingClearCoordinator {

    private QqPendingClearCoordinator() {}

    public enum Outcome { CONSUMED_BY_DAEMON, APPLIED_LOCALLY }

    /** 转发 {@link DaemonRequest.Waiter},保持既有测试签名。 */
    @FunctionalInterface
    public interface Waiter { void await(long millis) throws InterruptedException; }

    public static Outcome clear(RequestInbox inbox, QqPendingStore store, String id) throws IOException {
        return apply(store, id, DaemonRequest.submit(
                inbox, new RequestInbox.Request("qq-pending-clear", id, null)));
    }

    /** @param polls 轮询次数(测试用) */
    public static Outcome clear(RequestInbox inbox, QqPendingStore store, String id,
                                int polls, Waiter waiter) throws IOException {
        return apply(store, id, DaemonRequest.submit(
                inbox, new RequestInbox.Request("qq-pending-clear", id, null),
                polls, waiter::await));
    }

    /** 只有确认无人消费时才由本进程落地;daemon 接手了绝不能再动(两进程各写一次会丢更新)。 */
    private static Outcome apply(QqPendingStore store, String id, DaemonRequest.Outcome outcome) {
        if (outcome != DaemonRequest.Outcome.ORPHANED) return Outcome.CONSUMED_BY_DAEMON;
        if (id == null || id.isBlank()) store.clearResults();
        else store.removeById(id);
        return Outcome.APPLIED_LOCALLY;
    }
}
