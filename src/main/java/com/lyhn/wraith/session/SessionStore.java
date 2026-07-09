package com.lyhn.wraith.session;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.llm.LlmClient;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 项目级会话持久化:每个项目(cwd hash)一个目录,每个会话一个 JSONL 文件
 * (首行 meta + 每行一条消息)。支持续接(resume)与列表。
 *
 * <p>写入策略:每轮整文件重写(meta 行可更新 updatedAt/turns)。会话文件不大(几十条消息),
 * 重写代价可忽略;换来 meta 始终最新、实现简单。落盘格式与 spec 一致(JSONL)。
 *
 * <p>线程安全:写/续接走 synchronized;list/latest 只读。
 */
public final class SessionStore {

    private static final DateTimeFormatter ID_TIME =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneId.systemDefault());

    private final ObjectMapper mapper = new ObjectMapper();
    private final Path dir;
    private final String cwd;
    private String provider;
    private String model;

    // 当前正在写入的会话(惰性创建文件)
    private String currentId;
    private String createdAt;
    private String title;
    private boolean starred;
    private String name;

    private SessionStore(Path dir, String cwd, String provider, String model) {
        this.dir = dir;
        this.cwd = cwd;
        this.provider = provider == null ? "" : provider;
        this.model = model == null ? "" : model;
    }

    /** 以项目目录定位会话存储:~/.wraith/sessions/&lt;project_hash&gt;/。 */
    public static SessionStore open(Path home, String projectPath, String provider, String model) {
        String key = projectPath == null || projectPath.isBlank() ? "default" : projectPath;
        Path dir = home.resolve(".wraith").resolve("sessions").resolve(hash(key));
        return new SessionStore(dir, key, provider, model);
    }

    /** 开一个全新会话(下次 persist 时惰性建文件)。/clear 时调用。 */
    public synchronized void startNew() {
        currentId = null;
        createdAt = null;
        title = null;
        starred = false;
        name = null;
    }

    /**
     * 更新 live provider/model(setModel 或 resume 恢复 provider 后调用)。
     * 下次 persist 将使用新值写入 meta,防止 stale provider 被记录。
     */
    public synchronized void setProviderModel(String provider, String model) {
        if (provider != null && !provider.isBlank()) this.provider = provider;
        if (model != null && !model.isBlank()) this.model = model;
    }

    /** 把当前对话历史整体落盘(剔除 system / 空对话)。首次写入惰性分配会话 ID。 */
    public synchronized void persist(List<LlmClient.Message> history) {
        if (history == null) {
            return;
        }
        List<LlmClient.Message> convo = new ArrayList<>();
        for (LlmClient.Message m : history) {
            if (m != null && !"system".equals(m.role())) {
                convo.add(m.withoutImageContent());
            }
        }
        if (convo.isEmpty()) {
            return;
        }
        String now = Instant.now().toString();
        if (currentId == null) {
            currentId = newId();
            createdAt = now;
        }
        if (title == null || title.isBlank()) {
            title = deriveTitle(convo);
        }
        int turns = 0;
        for (LlmClient.Message m : convo) {
            if ("user".equals(m.role())) {
                turns++;
            }
        }
        try {
            write(new SessionMeta(currentId, cwd, createdAt, now, provider, model, title, turns, starred, name), convo);
        } catch (IOException e) {
            // 持久化失败不致命:本轮不写,下轮再试
        }
    }

    /** 当前正在写入的会话 ID(首个 persist 前为 null)。 */
    public synchronized String currentId() {
        return currentId;
    }

    /** 删除当前会话文件并重置(rewind 清空到无用户消息时用):无当前会话则为 no-op。 */
    public synchronized void deleteCurrent() {
        if (currentId != null) {
            try {
                Files.deleteIfExists(dir.resolve(currentId + ".jsonl"));
                Files.deleteIfExists(cardsFile(currentId));
            } catch (IOException ignored) {
                // 删除失败不致命:文件残留,但内存状态照常重置
            }
        }
        startNew();
    }

    /** 按 id 删除会话文件;成功=true,文件不存在=false。非法 id 安全返回 false。 */
    public synchronized boolean deleteById(String id) {
        if (id == null || id.isBlank()) {
            return false;
        }
        try {
            String sid = safeId(id);
            boolean removed = Files.deleteIfExists(dir.resolve(sid + ".jsonl"));
            Files.deleteIfExists(cardsFile(sid));
            if (removed && sid.equals(currentId)) {
                startNew();   // 删掉的是当前会话 → 重置内存态
            }
            return removed;
        } catch (IOException e) {
            return false;
        }
    }

    /** 给指定会话加/去星。找不到该会话返回 false。 */
    public synchronized boolean setStarred(String id, boolean starredFlag) {
        return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
                m.provider(), m.model(), m.title(), m.turns(), starredFlag, m.name()));
    }

    /** 给指定会话设自定义名;name 为 null/空白 → 清除(回落 title)。找不到返回 false。 */
    public synchronized boolean rename(String id, String newName) {
        String nm = (newName == null || newName.isBlank()) ? null : newName.strip();
        return rewriteMeta(id, m -> new SessionMeta(m.id(), m.cwd(), m.createdAt(), m.updatedAt(),
                m.provider(), m.model(), m.title(), m.turns(), m.starred(), nm));
    }

    // ---------------- sidecar cards ----------------

    private Path cardsFile(String id) {
        return dir.resolve(safeId(id) + ".cards.jsonl");
    }

    /** 追加一条卡片记录(events 为已序列化的 JSON 数组字符串)。 */
    public synchronized void appendCard(String sessionId, int turnOrdinal, String eventsJson) {
        if (sessionId == null || sessionId.isBlank() || eventsJson == null) return;
        try {
            Files.createDirectories(dir);
            ObjectNode line = mapper.createObjectNode();
            line.put("v", 1);
            line.put("turnOrdinal", turnOrdinal);
            line.set("events", mapper.readTree(eventsJson));
            Files.writeString(cardsFile(sessionId), mapper.writeValueAsString(line) + "\n",
                    StandardCharsets.UTF_8,
                    java.nio.file.StandardOpenOption.CREATE,
                    java.nio.file.StandardOpenOption.APPEND);
        } catch (IOException e) { /* 非致命 */ }
    }

    /** 读回卡片记录(每项 {turnOrdinal, events})。文件不存在或坏行 → 跳过。 */
    public synchronized List<JsonNode> readCards(String id) {
        Path f = cardsFile(id);
        if (!Files.isRegularFile(f)) return List.of();
        List<JsonNode> out = new ArrayList<>();
        try (BufferedReader r = Files.newBufferedReader(f, StandardCharsets.UTF_8)) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.isBlank()) continue;
                try { out.add(mapper.readTree(line)); } catch (Exception ignore) {}
            }
        } catch (IOException e) { return out; }
        return out;
    }

    /** 读该会话整文件 → 变换 meta 首行 → 原子写回。若是当前会话,同步内存态。 */
    private boolean rewriteMeta(String id, java.util.function.UnaryOperator<SessionMeta> mutator) {
        SessionRecord rec = read(id);
        if (rec == null) {
            return false;
        }
        SessionMeta updated = mutator.apply(rec.meta());
        try {
            write(updated, rec.messages());
        } catch (IOException e) {
            return false;
        }
        if (updated.id().equals(currentId)) {
            this.starred = updated.starred();
            this.name = updated.name();
        }
        return true;
    }

    /** 续接指定会话:载入历史消息,并把后续 persist 指向该文件。找不到返回空列表。 */
    public synchronized List<LlmClient.Message> resume(String id) {
        SessionRecord rec = read(id);
        if (rec == null) {
            return List.of();
        }
        currentId = rec.meta().id();
        createdAt = rec.meta().createdAt();
        title = rec.meta().title();
        starred = rec.meta().starred();
        name = rec.meta().name();
        return rec.messages();
    }

    /** 读取指定 id 会话的元信息(不加载消息体)。id 不存在返回 null。 */
    public SessionMeta meta(String id) {
        if (id == null || id.isBlank()) return null;
        Path file = dir.resolve(safeId(id) + ".jsonl");
        if (!Files.isRegularFile(file)) return null;
        return readMeta(file);
    }

    /** 本项目最近更新的会话。 */
    public Optional<SessionMeta> latest() {
        return list(1).stream().findFirst();
    }

    /** 本项目会话列表,按 updatedAt 倒序,最多 limit 条。 */
    public List<SessionMeta> list(int limit) {
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        List<SessionMeta> metas = new ArrayList<>();
        try (Stream<Path> files = Files.list(dir)) {
            List<Path> jsonl = files
                    .filter(f -> {
                        String n = f.getFileName().toString();
                        return n.endsWith(".jsonl") && !n.endsWith(".cards.jsonl");
                    })
                    .collect(Collectors.toList());
            for (Path p : jsonl) {
                SessionMeta m = readMeta(p);
                if (m != null) {
                    metas.add(m);
                }
            }
        } catch (IOException e) {
            return metas;
        }
        metas.sort(Comparator.comparing(SessionMeta::updatedAt,
                Comparator.nullsFirst(Comparator.naturalOrder())).reversed());
        if (limit > 0 && metas.size() > limit) {
            return new ArrayList<>(metas.subList(0, limit));
        }
        return metas;
    }

    // ---------------- internals ----------------

    private record SessionRecord(SessionMeta meta, List<LlmClient.Message> messages) {
    }

    private SessionMeta readMeta(Path file) {
        try (BufferedReader r = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            String first = r.readLine();
            if (first == null || first.isBlank()) {
                return null;
            }
            JsonNode n = mapper.readTree(first);
            return new SessionMeta(
                    text(n, "id"), text(n, "cwd"), text(n, "createdAt"), text(n, "updatedAt"),
                    text(n, "provider"), text(n, "model"), text(n, "title"),
                    n.has("turns") ? n.get("turns").asInt() : 0,
                    n.has("starred") && n.get("starred").asBoolean(),
                    text(n, "name"));
        } catch (Exception e) {
            return null;
        }
    }

    private SessionRecord read(String id) {
        Path file = dir.resolve(safeId(id) + ".jsonl");
        if (!Files.isRegularFile(file)) {
            return null;
        }
        SessionMeta meta = readMeta(file);
        if (meta == null) {
            return null;
        }
        List<LlmClient.Message> msgs = new ArrayList<>();
        try (BufferedReader r = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            r.readLine(); // 跳过 meta 行
            String line;
            while ((line = r.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                try {
                    LlmClient.Message m = SessionMessageCodec.fromJson(mapper.readTree(line));
                    if (m != null) {
                        msgs.add(m);
                    }
                } catch (Exception ignore) {
                    // 坏行跳过,不毁整会话
                }
            }
        } catch (IOException e) {
            return null;
        }
        return new SessionRecord(meta, msgs);
    }

    private void write(SessionMeta meta, List<LlmClient.Message> convo) throws IOException {
        Files.createDirectories(dir);
        Path tmp = dir.resolve(meta.id() + ".jsonl.tmp");
        try (BufferedWriter w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            w.write(metaJson(meta));
            w.write("\n");
            for (LlmClient.Message m : convo) {
                w.write(mapper.writeValueAsString(SessionMessageCodec.toJson(mapper, m)));
                w.write("\n");
            }
        }
        Path target = dir.resolve(meta.id() + ".jsonl");
        try {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private String metaJson(SessionMeta m) throws IOException {
        ObjectNode n = mapper.createObjectNode();
        n.put("v", 1);
        n.put("id", m.id());
        n.put("cwd", m.cwd());
        n.put("createdAt", m.createdAt());
        n.put("updatedAt", m.updatedAt());
        n.put("provider", m.provider());
        n.put("model", m.model());
        n.put("title", m.title());
        n.put("turns", m.turns());
        n.put("starred", m.starred());
        if (m.name() != null) {
            n.put("name", m.name());
        }
        return mapper.writeValueAsString(n);
    }

    private static String deriveTitle(List<LlmClient.Message> convo) {
        for (LlmClient.Message m : convo) {
            if ("user".equals(m.role()) && m.content() != null && !m.content().isBlank()) {
                String t = m.content().strip().replaceAll("\\s+", " ");
                return t.length() > 50 ? t.substring(0, 50) + "…" : t;
            }
        }
        return "(空会话)";
    }

    private static String newId() {
        return ID_TIME.format(Instant.now()) + "-" + String.format("%04x", new Random().nextInt(0x10000));
    }

    private static String text(JsonNode n, String field) {
        return n.hasNonNull(field) ? n.get(field).asText() : null;
    }

    private static String safeId(String id) {
        return id == null ? "" : id.replaceAll("[^A-Za-z0-9_-]", "");
    }

    /** 项目路径 → 稳定短 hash(SHA-256 前 8 字节,与快照口径一致)。 */
    static String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) {
                sb.append(String.format("%02x", bytes[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(value.hashCode());
        }
    }
}
