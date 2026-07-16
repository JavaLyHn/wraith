package com.lyhn.wraith.automation.delivery;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.util.*;
import java.util.LinkedHashMap;

/**
 * Persists QQ pending deliveries to ~/.wraith/qq-pending.json so they survive
 * daemon restarts and can be flushed on the next inbound DM.
 *
 * <p>Mirrors the atomic-write pattern of AutomationStore: Jackson ObjectMapper,
 * temp-file + Files.move(ATOMIC_MOVE) with REPLACE_EXISTING fallback,
 * synchronized mutators, readers degrade to empty on missing/corrupt file.
 */
public final class QqPendingStore {

    /** POJO shape matching AutomationTask/AutomationRun public-field style. */
    public static class Pending {
        /** 稳定标识:enqueue 时若为 null 则赋 UUID;flush 失败重入队保持不变。
         *  旧版本落盘的遗留项可能为 null(只能被 clearResults 清除)。 */
        public String id;
        public String taskName;
        public String answer;
        public long ts;
        /**
         * Non-null for approval-pending items: the approvalId that the QQ inline
         * keyboard buttons must carry so the daemon can resolve the future in
         * {@code pendingApprovals}.  Null for plain delivery items.
         */
        public String approvalId;
    }

    private static final ObjectMapper M = new ObjectMapper();
    private static final String ROOT_KEY = "pending";

    private final Path file;

    public QqPendingStore(Path dir) {
        this.file = dir.resolve("qq-pending.json");
    }

    /** Appends {@code p} to the persisted list, assigning a UUID id if absent. */
    public synchronized void enqueue(Pending p) {
        if (p.id == null || p.id.isBlank()) {
            p.id = java.util.UUID.randomUUID().toString();
        }
        List<Pending> list = new ArrayList<>(loadList());
        list.add(p);
        writeAtomic(list);
    }

    /**
     * Returns the current list AND clears the persisted store atomically
     * w.r.t. this instance's lock.
     */
    public synchronized List<Pending> drainAll() {
        List<Pending> snapshot = new ArrayList<>(loadList());
        writeAtomic(List.of());
        return snapshot;
    }

    /** Returns the number of currently persisted pending items. */
    public synchronized int size() {
        return loadList().size();
    }

    /** 只读副本,不清队(供桌面 automations.qqPending 展示)。 */
    public synchronized List<Pending> snapshot() {
        return List.copyOf(loadList());
    }

    /**
     * 按 id 删除一条<strong>结果项</strong>。审批项(approvalId != null)拒删返回
     * false —— 删了对应 run 会永远卡在 waiting_approval,其唯一出口是批/拒。
     * id 无匹配也返回 false(幂等)。
     */
    public synchronized boolean removeById(String id) {
        if (id == null || id.isBlank()) return false;
        List<Pending> list = new ArrayList<>(loadList());
        for (int i = 0; i < list.size(); i++) {
            Pending p = list.get(i);
            if (id.equals(p.id)) {
                if (p.approvalId != null) return false; // 审批项不可手删
                list.remove(i);
                writeAtomic(list);
                return true;
            }
        }
        return false;
    }

    /** 清空所有结果项(approvalId == null,含遗留 null-id 项);审批项保留。返回清除条数。 */
    public synchronized int clearResults() {
        List<Pending> list = new ArrayList<>(loadList());
        int before = list.size();
        list.removeIf(p -> p.approvalId == null);
        if (list.size() != before) writeAtomic(list);
        return before - list.size();
    }

    /** 审批已定(批/拒)后清除队列中同 approvalId 的待发卡片,防冲刷发已失效键盘。返回清除条数。 */
    public synchronized int removeByApprovalId(String approvalId) {
        if (approvalId == null || approvalId.isBlank()) return 0;
        List<Pending> list = new ArrayList<>(loadList());
        int before = list.size();
        list.removeIf(p -> approvalId.equals(p.approvalId));
        if (list.size() != before) writeAtomic(list);
        return before - list.size();
    }

    // --- internal ---

    private List<Pending> loadList() {
        try {
            if (!Files.exists(file)) return List.of();
            Map<String, Object> root = M.readValue(Files.readAllBytes(file),
                    M.getTypeFactory().constructMapType(LinkedHashMap.class, String.class, Object.class));
            Object raw = root.get(ROOT_KEY);
            if (raw == null) return List.of();
            return M.convertValue(raw,
                    M.getTypeFactory().constructCollectionType(List.class, Pending.class));
        } catch (IOException e) {
            return List.of(); // half-written / corrupt → degrade to empty
        }
    }

    private void writeAtomic(List<Pending> list) {
        try {
            Files.createDirectories(file.getParent());
            Map<String, Object> root = new LinkedHashMap<>();
            root.put(ROOT_KEY, list);
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.write(tmp, M.writerWithDefaultPrettyPrinter().writeValueAsBytes(root));
            try {
                Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
