package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.RequestInbox;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

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

    /** 可注入的等待,便于测试模拟「daemon 在第 N 跳消费」。 */
    @FunctionalInterface
    public interface Waiter { void await(long millis) throws InterruptedException; }

    /**
     * 生产用:总宽限 ~2.4s,分 8 跳 —— daemon 轮询周期 2~3s,足够它接手。
     * 调小会让本进程从活着的 daemon 手里抢走所有权(结果仍正确,删除是收敛的,
     * 但可能压掉 daemon 同一瞬间的 enqueue),故只在测试里调。
     */
    private static final int DEFAULT_POLLS =
            Integer.getInteger("wraith.qqclear.polls", 8);
    private static final long POLL_INTERVAL_MS = 300;

    public static Outcome clear(RequestInbox inbox, QqPendingStore store, String id) throws IOException {
        return clear(inbox, store, id, DEFAULT_POLLS, Thread::sleep);
    }

    /**
     * @param id    null = 清空全部结果项(审批项保留);非 null = 删除该条
     * @param polls 轮询次数;每跳间隔 {@value #POLL_INTERVAL_MS}ms
     */
    public static Outcome clear(RequestInbox inbox, QqPendingStore store, String id,
                                int polls, Waiter waiter) throws IOException {
        Path request = inbox.write(new RequestInbox.Request("qq-pending-clear", id, null));

        for (int i = 0; i < polls; i++) {
            if (!Files.exists(request)) return Outcome.CONSUMED_BY_DAEMON;   // daemon 已接手
            try {
                waiter.await(POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;   // 被打断就别再等,按「无人消费」兜底,总比静默丢掉这次清空好
            }
        }

        // 抢所有权:删掉才算我们的。删不掉 = daemon 刚好取走,交给它。
        if (!Files.deleteIfExists(request)) return Outcome.CONSUMED_BY_DAEMON;

        if (id == null || id.isBlank()) store.clearResults();
        else store.removeById(id);
        return Outcome.APPLIED_LOCALLY;
    }
}
