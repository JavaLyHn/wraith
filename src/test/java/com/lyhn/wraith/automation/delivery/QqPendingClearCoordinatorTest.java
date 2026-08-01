package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.RequestInbox;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「清空 QQ 待发结果」此前只往 RequestInbox 写一个请求文件,等 daemon 来消费。
 * daemon 没运行时 —— 也就是绝大多数时候 —— 那个文件就一直躺着:界面点了没反应,
 * 队列纹丝不动,而且网关下次一起来那些消息照发。
 * 真机实证:automation-requests/ 里躺着两个 18:09 的 qq-pending-clear-*.json,
 * qq-pending.json 仍有 25 条、mtime 停在 17:32。
 *
 * 跨进程直接写不安全(QqPendingStore 的 synchronized 只锁得住进程内),所以保留
 * 「优先交给 daemon」,只在确认没人消费后由本进程兜底。归属判定用「谁删掉请求文件
 * 谁负责执行」—— deleteIfExists 的返回值就是原子的所有权凭据。
 */
class QqPendingClearCoordinatorTest {

    private static QqPendingStore.Pending result(String id, String answer) {
        QqPendingStore.Pending p = new QqPendingStore.Pending();
        p.id = id; p.taskName = "t"; p.answer = answer; p.ts = 1000;
        return p;
    }

    private static QqPendingStore.Pending approval(String id) {
        QqPendingStore.Pending p = new QqPendingStore.Pending();
        p.id = id; p.taskName = "t"; p.answer = "a"; p.ts = 1000; p.approvalId = "ap#1";
        return p;
    }

    private static long requestFiles(Path dir) {
        if (!Files.exists(dir)) return 0;
        try (Stream<Path> s = Files.list(dir)) { return s.filter(p -> p.toString().endsWith(".json")).count(); }
        catch (IOException e) { return -1; }
    }

    @Test
    void appliesLocallyWhenNobodyConsumes(@TempDir Path dir) throws Exception {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(result("r1", "答案一"));
        store.enqueue(result("r2", "答案二"));
        store.enqueue(approval("a1"));
        Path reqDir = dir.resolve("automation-requests");
        RequestInbox inbox = new RequestInbox(reqDir);

        QqPendingClearCoordinator.Outcome out =
                QqPendingClearCoordinator.clear(inbox, store, null, 4, ms -> { /* 没人消费 */ });

        assertEquals(QqPendingClearCoordinator.Outcome.APPLIED_LOCALLY, out);
        List<QqPendingStore.Pending> left = store.snapshot();
        assertEquals(1, left.size(), "结果项应被清掉");
        assertEquals("ap#1", left.get(0).approvalId, "审批项必须保留");
        assertEquals(0, requestFiles(reqDir), "兜底执行后不许留下请求文件,否则 daemon 起来会再执行一次");
    }

    @Test
    void defersToDaemonWhenRequestGetsConsumed(@TempDir Path dir) throws Exception {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(result("r1", "答案一"));
        Path reqDir = dir.resolve("automation-requests");
        RequestInbox inbox = new RequestInbox(reqDir);

        // 第 2 跳时模拟 daemon 消费掉请求
        int[] tick = {0};
        QqPendingClearCoordinator.Outcome out =
                QqPendingClearCoordinator.clear(inbox, store, null, 5, ms -> {
                    if (++tick[0] == 2) new RequestInbox(reqDir).drain();
                });

        assertEquals(QqPendingClearCoordinator.Outcome.CONSUMED_BY_DAEMON, out);
        assertEquals(1, store.snapshot().size(),
                "daemon 已接手,本进程绝不能再动队列(否则两个进程各写一次,可能丢更新)");
    }

    @Test
    void singleRemoveAlsoFallsBackLocally(@TempDir Path dir) throws Exception {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(result("r1", "留下"));
        store.enqueue(result("r2", "删掉"));
        RequestInbox inbox = new RequestInbox(dir.resolve("automation-requests"));

        QqPendingClearCoordinator.clear(inbox, store, "r2", 3, ms -> { });

        List<String> ids = store.snapshot().stream().map(p -> p.id).toList();
        assertEquals(List.of("r1"), ids);
    }

    /** 边界:宽限期最后一刻被 daemon 抢先删走 —— 所有权归它,本进程收手。 */
    @Test
    void losesOwnershipRaceGracefully(@TempDir Path dir) throws Exception {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(result("r1", "答案"));
        Path reqDir = dir.resolve("automation-requests");
        RequestInbox inbox = new RequestInbox(reqDir);

        // 所有轮询都看到文件还在,但就在最后一跳之后被消费 → deleteIfExists 拿不到
        int[] tick = {0};
        QqPendingClearCoordinator.Outcome out =
                QqPendingClearCoordinator.clear(inbox, store, null, 3, ms -> {
                    if (++tick[0] == 3) new RequestInbox(reqDir).drain();
                });

        assertEquals(QqPendingClearCoordinator.Outcome.CONSUMED_BY_DAEMON, out);
        assertEquals(1, store.snapshot().size());
    }

    @Test
    void nothingToClearIsStillClean(@TempDir Path dir) throws Exception {
        QqPendingStore store = new QqPendingStore(dir);
        Path reqDir = dir.resolve("automation-requests");
        QqPendingClearCoordinator.clear(new RequestInbox(reqDir), store, null, 2, ms -> { });
        assertTrue(store.snapshot().isEmpty());
        assertEquals(0, requestFiles(reqDir));
        assertFalse(store.snapshot().stream().anyMatch(p -> p.approvalId == null));
    }
}
