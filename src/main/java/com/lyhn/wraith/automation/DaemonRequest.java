package com.lyhn.wraith.automation;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 往 {@link RequestInbox} 投递一条请求,并判定它是否真被 gateway daemon 接手。
 *
 * <p><b>问题:</b>app-server 只能通过 inbox 请 daemon 干活(删/清队列要它的实例锁;跑任务、
 * 落审批更是只有它有 runner)。但 daemon 没运行时没人消费,请求文件就一直躺着 —— 界面点了
 * 毫无反应,而且**几小时后网关一起来,那些请求会突然一起执行**。真机实证:
 * automation-requests/ 里躺着两个 18:09 的 qq-pending-clear,而队列纹丝不动。
 *
 * <p><b>判定办法:</b>写完在宽限期内轮询该文件是否消失。过期仍在就用
 * {@code Files.deleteIfExists} 回收 —— 它的返回值是<b>跨进程原子</b>的所有权凭据:
 * 谁删掉谁负责后续。删到手 = 确无消费者({@link Outcome#ORPHANED},且已清理不留后患);
 * 删不到 = daemon 刚好取走({@link Outcome#CONSUMED_BY_DAEMON})。
 *
 * <p>调用方据此决定:能本地兜底的自己做(如清队列),不能的(跑任务/审批)就<b>如实报错</b>,
 * 而不是假装成功。
 */
public final class DaemonRequest {

    private DaemonRequest() {}

    public enum Outcome {
        /** daemon 已接手(或在回收竞争中抢先),后续由它负责。 */
        CONSUMED_BY_DAEMON,
        /** 无人消费,请求已被回收删除 —— daemon 未运行。 */
        ORPHANED,
    }

    /** 可注入的等待,便于测试模拟「daemon 在第 N 跳消费」。 */
    @FunctionalInterface
    public interface Waiter { void await(long millis) throws InterruptedException; }

    /**
     * 宽限 8×300ms≈2.4s。daemon 轮询周期 2~3s,足够它接手;
     * 调小会让本进程从活着的 daemon 手里抢走所有权,故只在测试里调。
     */
    private static final int DEFAULT_POLLS = Integer.getInteger("wraith.daemonreq.polls", 8);
    private static final long POLL_INTERVAL_MS = 300;

    public static Outcome submit(RequestInbox inbox, RequestInbox.Request request) throws IOException {
        return submit(inbox, request, DEFAULT_POLLS, Thread::sleep);
    }

    public static Outcome submit(RequestInbox inbox, RequestInbox.Request request,
                                 int polls, Waiter waiter) throws IOException {
        Path file = inbox.write(request);
        for (int i = 0; i < polls; i++) {
            if (!Files.exists(file)) return Outcome.CONSUMED_BY_DAEMON;
            try {
                waiter.await(POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;   // 被打断按「无人消费」处理:回收掉,让调用方如实报错,别留个定时炸弹
            }
        }
        return Files.deleteIfExists(file) ? Outcome.ORPHANED : Outcome.CONSUMED_BY_DAEMON;
    }
}
