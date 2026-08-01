package com.lyhn.wraith.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.util.AtomicFileMove;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

public final class AutomationStore {
    private static final ObjectMapper M = new ObjectMapper();
    private static final int RUNS_PER_TASK = 50;
    /**
     * 类级锁(非实例级,故意 public):{@link #openDefault()} 每次调用都返回一个新实例,桌面
     * RPC 线程与 agent 工具线程各自持有独立的 AutomationStore 对象——若锁挂在 this 上,两把
     * 锁互不相干,等于没锁。用一个跨所有实例共享的静态锁,{@link #loadTasks()}/
     * {@link #saveTasks} 内部各自用它保护自己的方法体,防止两次并发的原始读/写(例如两个
     * saveTasks 同时写同一个 automations.json.tmp)相互踩踏。
     *
     * <p><b>但这还不够。</b>调用方真正做的是"load → 按业务逻辑改一份内存拷贝 → save"三步
     * 复合操作(见 {@link com.lyhn.wraith.tool.ToolRegistry} 的 automation_upsert/
     * automation_remove、{@code AppServer} 的 automations.upsert/automations.remove)。
     * loadTasks() 和 saveTasks() 各自单独加锁、锁在两次方法调用之间会被释放,并不能让这
     * 三步整体对其它线程原子化——A、B 两个线程可能都在 A 存盘前读到同一份旧快照,各自加了
     * 不同的任务,后存盘的一份会把先存盘的一份整体覆盖,丢失更新(lost update),与没加锁
     * 时的表现完全一样。这是集合/朴素方法级锁的通病,不是本实现的疏漏。
     *
     * <p>因此上述四个调用点在 load 到 save 之间额外包了一层
     * {@code synchronized (AutomationStore.TASKS_LOCK) { ... }},把整段复合操作纳入同一次
     * 加锁——这才是消除同 JVM 内 load-modify-save 竞态的真正机制;仅给 loadTasks()/
     * saveTasks() 加锁只是必要条件,不是充分条件。新增的 automation_* 写路径如果不比照
     * 包一层这把锁,复合竞态依旧存在。
     */
    public static final Object TASKS_LOCK = new Object();
    private final Path defs, state, runs;

    public AutomationStore(Path dir) {
        this.defs = dir.resolve("automations.json");
        this.state = dir.resolve("automation-state.json");
        this.runs = dir.resolve("automation-runs.json");
    }

    /**
     * 默认自动化数据目录:系统属性 wraith.automation.dir 优先,否则 <user.home>/.wraith。
     * app-server / 网关守护 / agent 工具三方共用同一解析口径 —— 口径漂移会导致
     * 「一边写、另一边读不到」的整类 bug。
     */
    public static Path defaultDir() {
        String prop = System.getProperty("wraith.automation.dir");
        return (prop != null && !prop.isBlank())
                ? Path.of(prop)
                : Path.of(System.getProperty("user.home"), ".wraith");
    }

    /** 默认 request inbox 目录(defaultDir() 下的 automation-requests 子目录)。 */
    public static Path defaultRequestsDir() {
        return defaultDir().resolve("automation-requests");
    }

    /** 按默认目录打开。 */
    public static AutomationStore openDefault() {
        return new AutomationStore(defaultDir());
    }

    // --- 定义(读写) ---
    /**
     * 加载全量任务定义列表(automations.json)。方法体本身用类级 {@link #TASKS_LOCK} 保护,
     * 防止与并发的 {@link #saveTasks} 原始读写互相踩踏——同一 JVM 内的调用方即使各自通过
     * {@link #openDefault()} 拿到不同的 AutomationStore 实例(例如桌面 RPC 线程 vs. agent
     * 工具线程),这一步也不会交叠。
     *
     * <p>但这只保证单次调用本身的原子性,<b>不</b>保证"先 loadTasks() 再改一份内存拷贝再
     * saveTasks()"这一复合序列不被别的线程插队——调用方必须自己把整段包进
     * {@code synchronized (TASKS_LOCK) { ... }}(参见 {@link #TASKS_LOCK} 的完整说明与
     * ToolRegistry/AppServer 里的实际用法),否则同 JVM 内仍会发生 load-modify-save
     * 竞态导致的丢失更新。跨进程(CLI / 网关守护 / agent 工具 / 桌面 app-server 分别是
     * 独立 JVM)锁不跨进程边界,仍是 last-writer-wins;writeAtomic 的 tmp+rename 只保证
     * 单次写不会被读到半份内容,不提供跨进程互斥——这是已知且接受的限制。
     */
    public List<AutomationTask> loadTasks() {
        synchronized (TASKS_LOCK) {
            Map<String,Object> root = readMap(defs);
            Object tasks = root.get("tasks");
            if (tasks == null) return List.of();
            return M.convertValue(tasks, M.getTypeFactory()
                    .constructCollectionType(List.class, AutomationTask.class));
        }
    }

    /**
     * 原子写全量任务定义列表到 automations.json。方法体本身用类级 {@link #TASKS_LOCK} 保护,
     * 防止两个并发的 saveTasks() 互相踩踏同一个 automations.json.tmp。
     *
     * <p>与 {@link #loadTasks()} 同理:单独调用本方法是原子的,但"load-modify-save"整段
     * 复合操作要真正互斥,调用方必须自己在 load 之前到 save 之后包一层
     * {@code synchronized (TASKS_LOCK)}(参见 {@link #TASKS_LOCK} 的完整说明)。多方
     * (CLI / 网关守护 / agent 工具 / 桌面 app-server)都可能是写者,跨进程 last-writer-wins;
     * writeAtomic 的 tmp+rename 保证单次写不会被读到半份内容,但不提供跨进程互斥。
     */
    public void saveTasks(List<AutomationTask> tasks) {
        synchronized (TASKS_LOCK) {
            Map<String,Object> root = new LinkedHashMap<>();
            root.put("tasks", tasks);
            writeAtomic(defs, root);
        }
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
            AtomicFileMove.moveIntoPlace(tmp, p);
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }
}
