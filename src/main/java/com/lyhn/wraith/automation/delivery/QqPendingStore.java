package com.lyhn.wraith.automation.delivery;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.util.*;

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
        public String taskName;
        public String answer;
        public long ts;
    }

    private static final ObjectMapper M = new ObjectMapper();
    private static final String ROOT_KEY = "pending";

    private final Path file;

    public QqPendingStore(Path dir) {
        this.file = dir.resolve("qq-pending.json");
    }

    /** Appends {@code p} to the persisted list. */
    public synchronized void enqueue(Pending p) {
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

    // --- internal ---

    private List<Pending> loadList() {
        try {
            if (!Files.exists(file)) return List.of();
            Map<?, ?> root = M.readValue(Files.readAllBytes(file), Map.class);
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
