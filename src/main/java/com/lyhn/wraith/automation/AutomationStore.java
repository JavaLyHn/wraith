package com.lyhn.wraith.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

public final class AutomationStore {
    private static final ObjectMapper M = new ObjectMapper();
    private static final int RUNS_PER_TASK = 50;
    private final Path defs, state, runs;

    public AutomationStore(Path dir) {
        this.defs = dir.resolve("automations.json");
        this.state = dir.resolve("automation-state.json");
        this.runs = dir.resolve("automation-runs.json");
    }

    // --- 定义(读写,app-server 单写者) ---
    public List<AutomationTask> loadTasks() {
        Map<String,Object> root = readMap(defs);
        Object tasks = root.get("tasks");
        if (tasks == null) return List.of();
        return M.convertValue(tasks, M.getTypeFactory()
                .constructCollectionType(List.class, AutomationTask.class));
    }

    /** 原子写全量任务定义列表到 automations.json。app-server 是 automations.json 的单一写者。 */
    public void saveTasks(List<AutomationTask> tasks) {
        Map<String,Object> root = new LinkedHashMap<>();
        root.put("tasks", tasks);
        writeAtomic(defs, root);
    }

    // --- 状态(读写,加锁) ---
    public synchronized Long lastFiredAt(String taskId) {
        Map<String,Object> lf = lastFiredMap();
        Object v = lf.get(taskId);
        return v == null ? null : ((Number) v).longValue();
    }
    public synchronized void setLastFiredAt(String taskId, long ts) {
        Map<String,Object> root = readMap(state);
        @SuppressWarnings("unchecked")
        Map<String,Object> lf = (Map<String,Object>) root.computeIfAbsent("lastFiredAt", k -> new LinkedHashMap<>());
        lf.put(taskId, ts);
        writeAtomic(state, root);
    }
    @SuppressWarnings("unchecked")
    private Map<String,Object> lastFiredMap() {
        Object lf = readMap(state).get("lastFiredAt");
        return lf == null ? Map.of() : (Map<String,Object>) lf;
    }

    // --- 历史(读写,加锁) ---
    public synchronized void putRun(AutomationRun run) {
        List<AutomationRun> all = new ArrayList<>(loadRuns());
        all.removeIf(r -> r.runId.equals(run.runId));
        all.add(run);
        // 每 taskId 保留 startedAt 最大的 RUNS_PER_TASK 条
        Map<String,List<AutomationRun>> byTask = all.stream().collect(Collectors.groupingBy(r -> r.taskId));
        List<AutomationRun> kept = new ArrayList<>();
        for (List<AutomationRun> g : byTask.values()) {
            g.sort(Comparator.comparingLong((AutomationRun r) -> r.startedAt).reversed());
            kept.addAll(g.subList(0, Math.min(RUNS_PER_TASK, g.size())));
        }
        Map<String,Object> root = new LinkedHashMap<>();
        root.put("runs", kept);
        writeAtomic(runs, root);
    }
    public List<AutomationRun> loadRuns() {
        Object rs = readMap(runs).get("runs");
        if (rs == null) return List.of();
        return M.convertValue(rs, M.getTypeFactory()
                .constructCollectionType(List.class, AutomationRun.class));
    }
    public List<AutomationRun> nonTerminalRuns() {
        return loadRuns().stream()
                .filter(r -> "running".equals(r.status) || "waiting_approval".equals(r.status) || "starting".equals(r.status))
                .collect(Collectors.toList());
    }

    // --- 底层 ---
    private Map<String,Object> readMap(Path p) {
        try {
            if (!Files.exists(p)) return new LinkedHashMap<>();
            return M.readValue(Files.readAllBytes(p), M.getTypeFactory()
                    .constructMapType(LinkedHashMap.class, String.class, Object.class));
        } catch (IOException e) { return new LinkedHashMap<>(); }   // 半写/坏 → 降级空
    }
    private void writeAtomic(Path p, Object value) {
        try {
            Files.createDirectories(p.getParent());
            Path tmp = p.resolveSibling(p.getFileName() + ".tmp");
            Files.write(tmp, M.writerWithDefaultPrettyPrinter().writeValueAsBytes(value));
            try { Files.move(tmp, p, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException e) { Files.move(tmp, p, StandardCopyOption.REPLACE_EXISTING); }
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }
}
