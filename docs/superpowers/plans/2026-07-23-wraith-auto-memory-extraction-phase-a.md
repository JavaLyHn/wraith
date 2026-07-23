# wraith 自动记忆提取 — Phase A(后端核心)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 wraith 长期记忆加"会话边界自动抽取 → 候选待批"的后端核心:复用 `ContextCompressor` 现有(死代码)抽取资产产候选,经去噪门 + 去重入待确认队列,人工批准才落 `long_term_memory.json`;巩固走追加 + 软超请。

**Architecture:** 纯 Java 后端。新增 `PendingFact`/`PendingMemoryStore`(候选队列 JSON)+ `MemoryExtractionService`(编排:复用 `ContextCompressor.extractFactCandidates` 抽取 → `MemoryRetriever` 去重/挂最相似提示 → 敏感正则兜底 → 入队);`LongTermMemory` 加 `markSuperseded` + 检索过滤;`MemoryManager` 加候选批准/驳回 + 触发;`Agent` 在 `/clear` 清短期记忆前触发抽取。**无 UI**(Phase B CLI/RPC、Phase C 桌面另出计划)。

**Tech Stack:** Java 17,Maven,Jackson(`ObjectMapper`,同 `LongTermMemory` 落盘方式),JUnit 5 + Mockito(现有测试栈),SLF4J 日志。

## Global Constraints

- 纯 Java 后端,`com.lyhn.wraith.memory` 包 + 一处 `Agent` 接线;**不改 CLI/RPC/桌面**(留 Phase B/C)。
- **复用而非重造**:抽取判据用 `ContextCompressor` 现有 `EXTRACT_FACTS_PROMPT`(:45)+ `isPersistentFactCandidate`(:284);把死代码 `extractFacts(entries, longTermMemory)`(:148,零调用者已核实)重构为纯 `extractFactCandidates(entries)`(只产候选串、不落库),并删除旧的直接落库死方法。
- 候选**不自动入正式库**:一律先进 `PendingMemoryStore`;`long_term_memory.json` 唯一新写入路径是 `MemoryManager.approvePending*`。原有 `save_memory`/`/save`/`ExplicitMemoryHints` 路径不动。
- 巩固=**追加 + 软超请**:超请不自动判定,入队仅挂 `nearestExistingId` 提示;`markSuperseded` 给旧条 metadata 打 `superseded=true`(**不硬删**);`MemoryEntry` 不可变,须**重建条目**覆盖。
- 检索/列出**过滤 superseded**:`LongTermMemory.getAll()`/`getAll(projectKey)`/`search(...)` 默认排除 superseded 条(仍留在 map+磁盘供审计/按 id 删)。
- 开关 `-Dwraith.memory.autoExtract`,默认 `true`;关则触发链整段跳过。
- 敏感信息:候选命中凭证正则(`sk-`、`token`、`password=` 等)入队前丢弃。
- 作用域:project 按 `MemoryManager.getCurrentProject()`(真实路径归一)隔离;global 跨项目。
- 测试:JUnit5 + Mockito,放 `src/test/java/com/lyhn/wraith/memory/`;运行 `mvn -q -DskipTests=false -Dtest=<Class> test`(本仓测试默认 skip)。基线 1490/11F/0E,不新增失败。
- `git add` 仅本任务文件,禁止 `git add .`/`-A`;不碰 WIP(README.md、demo/*、.claude/settings.json、progress.md)。

---

### Task 1: PendingFact + PendingMemoryStore(候选队列)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/memory/PendingFact.java`
- Create: `src/main/java/com/lyhn/wraith/memory/PendingMemoryStore.java`
- Test: `src/test/java/com/lyhn/wraith/memory/PendingMemoryStoreTest.java`

**Interfaces:**
- Produces:
  ```java
  // PendingFact:候选事实(不可变)
  public record PendingFact(String id, String fact, String type, String scope,
                            String nearestExistingId, String sourceSessionId,
                            String project, String createdAt) {}
  // PendingMemoryStore:候选队列,JSON 落盘 pending_facts.json
  public PendingMemoryStore()                       // 默认目录(同 LongTermMemory 解析)
  public PendingMemoryStore(File storageDir)        // 测试注入
  public void add(PendingFact fact)
  public List<PendingFact> list(String projectKey)  // 含 global + 该 project
  public java.util.Optional<PendingFact> get(String id)
  public boolean remove(String id)
  public void clear(String projectKey)              // 清 global + 该 project
  ```
- Consumes: 无。

- [ ] **Step 1: 写失败测试**

写入 `src/test/java/com/lyhn/wraith/memory/PendingMemoryStoreTest.java`:

```java
package com.lyhn.wraith.memory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PendingMemoryStoreTest {

    private PendingFact fact(String id, String scope, String project) {
        return new PendingFact(id, "事实-" + id, "FACT", scope, null, "sess-1", project, "2026-07-23T00:00:00Z");
    }

    @Test
    void addListGetRemove(@TempDir File dir) {
        PendingMemoryStore store = new PendingMemoryStore(dir);
        store.add(fact("a", "project", "/proj"));
        assertEquals(1, store.list("/proj").size());
        assertTrue(store.get("a").isPresent());
        assertTrue(store.remove("a"));
        assertTrue(store.list("/proj").isEmpty());
        assertFalse(store.remove("a"));
    }

    @Test
    void listFiltersByProjectPlusGlobal(@TempDir File dir) {
        PendingMemoryStore store = new PendingMemoryStore(dir);
        store.add(fact("p1", "project", "/proj"));
        store.add(fact("p2", "project", "/other"));
        store.add(fact("g1", "global", null));
        List<PendingFact> visible = store.list("/proj");
        assertEquals(2, visible.size()); // p1 + g1,不含 /other 的 p2
        assertTrue(visible.stream().anyMatch(f -> f.id().equals("p1")));
        assertTrue(visible.stream().anyMatch(f -> f.id().equals("g1")));
    }

    @Test
    void persistsAcrossReload(@TempDir File dir) {
        new PendingMemoryStore(dir).add(fact("a", "project", "/proj"));
        PendingMemoryStore reloaded = new PendingMemoryStore(dir);
        assertEquals(1, reloaded.list("/proj").size());
    }

    @Test
    void clearRemovesGlobalAndProject(@TempDir File dir) {
        PendingMemoryStore store = new PendingMemoryStore(dir);
        store.add(fact("p1", "project", "/proj"));
        store.add(fact("p2", "project", "/other"));
        store.add(fact("g1", "global", null));
        store.clear("/proj");
        assertTrue(store.list("/proj").isEmpty());          // p1 + g1 清掉
        assertEquals(1, store.list("/other").size());       // /other 的 p2 保留
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=PendingMemoryStoreTest test`
Expected: 编译失败/找不到符号 `PendingFact`、`PendingMemoryStore`(类未建)。

- [ ] **Step 3: 写实现**

`src/main/java/com/lyhn/wraith/memory/PendingFact.java`:

```java
package com.lyhn.wraith.memory;

/** 待确认候选事实(不可变)。op 语义在批准时由调用方决定(ADD 或替换 nearestExistingId)。 */
public record PendingFact(
        String id,
        String fact,
        String type,
        String scope,             // "project" | "global"
        String nearestExistingId, // 最相似既有长期记忆条 id,供批准者对照;可为 null
        String sourceSessionId,
        String project,           // scope=project 时的项目 key;global 时为 null
        String createdAt          // ISO-8601 字符串
) {}
```

`src/main/java/com/lyhn/wraith/memory/PendingMemoryStore.java`:

```java
package com.lyhn.wraith.memory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 待确认候选记忆队列 - 自动抽取的候选事实先落此处,人工批准才进长期记忆。
 * JSON 落盘 pending_facts.json,与长期记忆同目录、分文件。
 */
public class PendingMemoryStore {
    private static final Logger log = LoggerFactory.getLogger(PendingMemoryStore.class);
    private static final String STORAGE_DIR_PROPERTY = "wraith.memory.dir";
    private static final String STORAGE_DIR_ENV = "WRAITH_MEMORY_DIR";
    private static final String STORAGE_FILE = "pending_facts.json";

    private final Map<String, PendingFact> entries = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();
    private final File storageFile;

    public PendingMemoryStore() {
        this(resolveStorageDir());
    }

    public PendingMemoryStore(File storageDir) {
        this.mapper.enable(SerializationFeature.INDENT_OUTPUT);
        if (!storageDir.exists()) {
            storageDir.mkdirs();
        }
        this.storageFile = new File(storageDir, STORAGE_FILE);
        loadFromDisk();
    }

    public void add(PendingFact fact) {
        entries.put(fact.id(), fact);
        saveToDisk();
    }

    public List<PendingFact> list(String projectKey) {
        return entries.values().stream()
                .filter(f -> isVisible(f, projectKey))
                .collect(Collectors.toList());
    }

    public Optional<PendingFact> get(String id) {
        return Optional.ofNullable(entries.get(id));
    }

    public boolean remove(String id) {
        if (entries.remove(id) != null) {
            saveToDisk();
            return true;
        }
        return false;
    }

    public void clear(String projectKey) {
        List<String> toRemove = entries.values().stream()
                .filter(f -> isVisible(f, projectKey))
                .map(PendingFact::id)
                .collect(Collectors.toList());
        toRemove.forEach(entries::remove);
        saveToDisk();
    }

    private static boolean isVisible(PendingFact f, String projectKey) {
        if ("global".equals(f.scope())) {
            return true;
        }
        return projectKey != null && !projectKey.isBlank() && Objects.equals(f.project(), projectKey);
    }

    private void saveToDisk() {
        try {
            mapper.writeValue(storageFile, new ArrayList<>(entries.values()));
        } catch (IOException e) {
            log.warn("候选记忆持久化失败: {}", e.getMessage(), e);
        }
    }

    private void loadFromDisk() {
        if (!storageFile.exists()) return;
        try {
            PendingFact[] loaded = mapper.readValue(storageFile, PendingFact[].class);
            for (PendingFact f : loaded) {
                if (f != null && f.id() != null) {
                    entries.put(f.id(), f);
                }
            }
        } catch (IOException e) {
            log.warn("加载候选记忆失败: {}", e.getMessage(), e);
        }
    }

    private static File resolveStorageDir() {
        String dir = System.getProperty(STORAGE_DIR_PROPERTY);
        if (dir == null || dir.isBlank()) {
            dir = System.getenv(STORAGE_DIR_ENV);
        }
        if (dir != null && !dir.isBlank()) {
            return new File(dir);
        }
        return new File(new File(System.getProperty("user.home"), ".wraith"), "memory");
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=PendingMemoryStoreTest test`
Expected: 4 个用例全通过。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/memory/PendingFact.java src/main/java/com/lyhn/wraith/memory/PendingMemoryStore.java src/test/java/com/lyhn/wraith/memory/PendingMemoryStoreTest.java
git commit -m "feat(memory): PendingFact + PendingMemoryStore 候选待确认队列(JSON 落盘/项目隔离)"
```

---

### Task 2: ContextCompressor 抽取重构(死代码 → 纯候选方法)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/memory/ContextCompressor.java`(删 `extractFacts(:148)`,加 `extractFactCandidates`)
- Test: `src/test/java/com/lyhn/wraith/memory/ContextCompressorExtractTest.java`

**Interfaces:**
- Produces:
  ```java
  // 纯抽取:只产候选事实串、不落库。复用现有 EXTRACT_FACTS_PROMPT + isPersistentFactCandidate。
  public List<String> extractFactCandidates(List<MemoryEntry> entries)
  ```
- Consumes: 现有私有 `EXTRACT_FACTS_PROMPT`、`isPersistentFactCandidate`、`normalizeFactLine`、`resolveSource`、`llmClient`(均在 ContextCompressor 内)。

- [ ] **Step 1: 写失败测试**

写入 `src/test/java/com/lyhn/wraith/memory/ContextCompressorExtractTest.java`:

```java
package com.lyhn.wraith.memory;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ContextCompressorExtractTest {

    private MemoryEntry entry(String content) {
        return new MemoryEntry("user-x", content, MemoryEntry.MemoryType.CONVERSATION,
                Map.of("source", "user"), MemoryEntry.estimateTokens(content));
    }

    @Test
    void extractsDurableFactsAndFiltersEphemeral() throws Exception {
        LlmClient llm = mock(LlmClient.class);
        // 模型返回 4 行:1 条稳定事实(含"项目"命中 DURABLE_FACT_HINTS)、
        // 1 条冒号事实、1 条一次性任务(EPHEMERAL 前缀)、1 条猜测(SPECULATION)。
        String out = "用户偏好使用 Java 17\n项目路径：/Users/x/wraith\n帮我新建一个文件\n这可能是个笔误";
        when(llm.chat(anyList(), isNull())).thenReturn(new LlmClient.ChatResponse(out, null, null, null, 0, 0, 0));
        ContextCompressor c = new ContextCompressor(llm);

        List<String> facts = c.extractFactCandidates(List.of(entry("聊天内容")));

        assertTrue(facts.contains("用户偏好使用 Java 17"));
        assertTrue(facts.contains("项目路径：/Users/x/wraith"));
        assertFalse(facts.stream().anyMatch(f -> f.startsWith("帮我")));   // EPHEMERAL 前缀被过滤
        assertFalse(facts.stream().anyMatch(f -> f.contains("笔误")));      // SPECULATION 被过滤
    }

    @Test
    void emptyInputReturnsEmpty() {
        ContextCompressor c = new ContextCompressor(mock(LlmClient.class));
        assertTrue(c.extractFactCandidates(List.of()).isEmpty());
    }
}
```

> **注**:`LlmClient.ChatResponse` 的构造签名以本仓实际为准(实现者按 `ChatResponse` 源码调整 mock 的构造参数;测试只依赖 `response.content()` 返回上面的 `out`)。若 `ChatResponse` 有更简的工厂/构造,用之。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=ContextCompressorExtractTest test`
Expected: 编译失败——`extractFactCandidates` 方法不存在。

- [ ] **Step 3: 写实现**

在 `ContextCompressor.java` 中,**删除** `extractFacts(List<MemoryEntry> entries, LongTermMemory longTermMemory)` 整个方法(第 145–190 行,已核实零调用者),**新增**纯方法(复用其抽取逻辑、去掉落库副作用):

```java
    /**
     * 从对话中提取"跨会话稳定"的候选事实串(只产候选、不落库)。
     * 复用 EXTRACT_FACTS_PROMPT + isPersistentFactCandidate 规则过滤。
     */
    public List<String> extractFactCandidates(List<MemoryEntry> entries) {
        if (entries == null || entries.isEmpty()) return List.of();

        StringBuilder conversation = new StringBuilder();
        for (MemoryEntry entry : entries) {
            conversation.append(resolveSource(entry).toUpperCase(Locale.ROOT))
                    .append("(").append(entry.getType()).append("): ")
                    .append(entry.getContent()).append("\n\n");
        }

        try {
            String prompt = String.format(EXTRACT_FACTS_PROMPT, conversation);
            List<LlmClient.Message> messages = List.of(
                    LlmClient.Message.system("你是一个信息提取助手，只输出关键事实，不输出其他内容。"),
                    LlmClient.Message.user(prompt)
            );
            LlmClient.ChatResponse response = llmClient.chat(messages, null);
            String factsText = response.content();

            List<String> facts = new ArrayList<>();
            for (String line : factsText.split("\n")) {
                String fact = normalizeFactLine(line);
                if (isPersistentFactCandidate(fact)) {
                    facts.add(fact);
                }
            }
            return facts;
        } catch (IOException e) {
            log.warn("候选事实抽取失败: {}", e.getMessage());
            return List.of();
        }
    }
```

同时:文件顶部若无 SLF4J logger 则加(`private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ContextCompressor.class);`),替换原 `extractFacts` 里的 `System.err.println` 风格;`UUID` import 若因删方法不再使用则移除(避免未用 import 告警)。保留 `EXTRACT_FACTS_PROMPT`、`isPersistentFactCandidate`、`normalizeFactLine`、`resolveSource`、`EPHEMERAL_FACT_PREFIXES`/`SPECULATION_CUES`/`DURABLE_FACT_HINTS`(仍被 `extractFactCandidates` 使用)。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=ContextCompressorExtractTest test`
Expected: 2 个用例通过。

- [ ] **Step 5: 确认删除未破坏编译**

Run: `mvn -q -DskipTests=false -Dtest=ContextCompressorExtractTest test`(已含编译);另确认全量编译 `mvn -q -o compile`(离线,若依赖已缓存)或 `mvn -q compile`。
Expected: 编译通过,无"未使用 import"告警。

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/lyhn/wraith/memory/ContextCompressor.java src/test/java/com/lyhn/wraith/memory/ContextCompressorExtractTest.java
git commit -m "refactor(memory): ContextCompressor 抽取死代码重构为纯 extractFactCandidates(不落库)"
```

---

### Task 3: LongTermMemory 软超请(markSuperseded + 检索过滤)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/memory/LongTermMemory.java`
- Test: `src/test/java/com/lyhn/wraith/memory/LongTermMemorySupersedeTest.java`

**Interfaces:**
- Produces:
  ```java
  public boolean markSuperseded(String id)  // 给条目 metadata 打 superseded=true(重建不可变条目),不硬删
  ```
- 行为变更:`getAll()`、`getAll(String projectKey)`、`search(String,int,String)` 默认**排除** superseded 条;`retrieve(id)` 与磁盘持久化仍保留 superseded 条。
- Consumes: 无(自身类内)。

- [ ] **Step 1: 写失败测试**

写入 `src/test/java/com/lyhn/wraith/memory/LongTermMemorySupersedeTest.java`:

```java
package com.lyhn.wraith.memory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class LongTermMemorySupersedeTest {

    private MemoryEntry fact(String id, String content) {
        return new MemoryEntry(id, content, MemoryEntry.MemoryType.FACT,
                Map.of("source", "fact", "scope", "global"), MemoryEntry.estimateTokens(content));
    }

    @Test
    void supersededExcludedFromGetAllAndSearchButKeptById(@TempDir File dir) {
        LongTermMemory ltm = new LongTermMemory(dir);
        ltm.store(fact("f1", "用户住在纽约"));
        ltm.store(fact("f2", "用户偏好深色主题"));

        assertTrue(ltm.markSuperseded("f1"));

        assertEquals(1, ltm.getAll().size());                                  // f1 被排除
        assertTrue(ltm.getAll().stream().noneMatch(e -> e.getId().equals("f1")));
        assertTrue(ltm.search("纽约", 10, null).isEmpty());                    // 检索不到 superseded
        assertFalse(ltm.search("深色", 10, null).isEmpty());                   // 未超请的仍在
        assertTrue(ltm.retrieve("f1").isPresent());                            // 按 id 仍可取(审计/删除)
        assertEquals("true", ltm.retrieve("f1").get().getMetadata().get("superseded"));
    }

    @Test
    void markSupersededMissingReturnsFalse(@TempDir File dir) {
        assertFalse(new LongTermMemory(dir).markSuperseded("nope"));
    }

    @Test
    void supersededSurvivesReload(@TempDir File dir) {
        LongTermMemory ltm = new LongTermMemory(dir);
        ltm.store(fact("f1", "旧事实"));
        ltm.markSuperseded("f1");
        LongTermMemory reloaded = new LongTermMemory(dir);
        assertTrue(reloaded.getAll().isEmpty());                               // 重载后仍被过滤
        assertTrue(reloaded.retrieve("f1").isPresent());                       // 仍在磁盘
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=LongTermMemorySupersedeTest test`
Expected: 编译失败——`markSuperseded` 不存在。

- [ ] **Step 3: 写实现**

在 `LongTermMemory.java` 加方法 + 过滤。新增:

```java
    /** 软超请:给条目 metadata 打 superseded=true(重建不可变条目覆盖),不删除。 */
    public boolean markSuperseded(String id) {
        MemoryEntry existing = entries.get(id);
        if (existing == null) {
            return false;
        }
        Map<String, String> meta = new HashMap<>(existing.getMetadata());
        meta.put("superseded", "true");
        meta.put("supersededAt", java.time.Instant.now().toString());
        MemoryEntry rebuilt = new MemoryEntry(existing.getId(), existing.getContent(), existing.getType(),
                existing.getTimestamp(), meta, existing.getTokenCount());
        entries.put(id, rebuilt);
        saveToDisk();
        return true;
    }

    private static boolean isSuperseded(MemoryEntry entry) {
        return "true".equals(entry.getMetadata().get("superseded"));
    }
```

在 `search(String query, int limit, String projectKey)` 的 stream 里、`isVisibleInProject` 之后加一层过滤 `.filter(entry -> !isSuperseded(entry))`;在 `getAll()` 改为:

```java
    @Override
    public List<MemoryEntry> getAll() {
        return entries.values().stream()
                .filter(entry -> !isSuperseded(entry))
                .collect(Collectors.toList());
    }
```

在 `getAll(String projectKey)` 的 stream 里同样加 `.filter(entry -> !isSuperseded(entry))`。`saveToDisk()`(遍历 `entries.values()`)与 `retrieve(id)`、`delete(id)` 保持不变(superseded 仍落盘、仍可按 id 取/删)。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=LongTermMemorySupersedeTest test`
Expected: 3 个用例通过。

- [ ] **Step 5: 回归既有记忆检索测试**

Run: `mvn -q -DskipTests=false -Dtest=MemoryRetrieverTest,LongTermMemoryTest,MemoryManagerTest test`
Expected: 全通过(getAll/search 过滤只影响 superseded 条,普通条不受影响)。若有失败,按 systematic-debugging 定位,勿绕过。

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/lyhn/wraith/memory/LongTermMemory.java src/test/java/com/lyhn/wraith/memory/LongTermMemorySupersedeTest.java
git commit -m "feat(memory): LongTermMemory 软超请 markSuperseded + 检索/列出过滤 superseded"
```

---

### Task 4: MemoryExtractionService(编排抽取 → 去重 → 入队)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/memory/MemoryExtractionService.java`
- Test: `src/test/java/com/lyhn/wraith/memory/MemoryExtractionServiceTest.java`

**Interfaces:**
- Consumes:Task 1 `PendingFact`/`PendingMemoryStore`;Task 2 `ContextCompressor.extractFactCandidates`;`MemoryRetriever.retrieveLongTerm(query, limit, projectKey)`;`MemoryEntry`。
- Produces:
  ```java
  public MemoryExtractionService(ContextCompressor compressor, MemoryRetriever retriever, PendingMemoryStore pendingStore)
  // 同步抽取一次:返回入队候选数。id/时间由入参提供以便可测(不在内部取系统时钟)。
  public int extractFromSession(List<MemoryEntry> slice, String sessionId, String projectKey,
                                java.util.function.Supplier<String> idGen, String nowIso)
  ```
- 说明:去重=候选与 `retrieveLongTerm(fact,1,projectKey)` 最相似条比较,内容**相等**即丢(near-dup);否则挂该条 id 为 `nearestExistingId`。敏感正则命中即丢。scope 统一先记 "project"(global 判定留后续),`type="FACT"`。

- [ ] **Step 1: 写失败测试**

写入 `src/test/java/com/lyhn/wraith/memory/MemoryExtractionServiceTest.java`:

```java
package com.lyhn.wraith.memory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MemoryExtractionServiceTest {

    private Supplier<String> seqIds() {
        AtomicInteger n = new AtomicInteger();
        return () -> "cand-" + n.incrementAndGet();
    }

    private MemoryExtractionService service(File dir, ContextCompressor compressor, MemoryRetriever retriever, PendingMemoryStore store) {
        return new MemoryExtractionService(compressor, retriever, store);
    }

    @Test
    void enqueuesNonDuplicateCandidates(@TempDir File dir) {
        ContextCompressor compressor = mock(ContextCompressor.class);
        when(compressor.extractFactCandidates(anyList()))
                .thenReturn(List.of("用户偏好 Java 17", "项目用 Maven 构建"));
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        when(retriever.retrieveLongTerm(anyString(), anyInt(), any())).thenReturn(List.of()); // 无相似既有条
        PendingMemoryStore store = new PendingMemoryStore(dir);

        int n = service(dir, compressor, retriever, store)
                .extractFromSession(List.of(), "sess-1", "/proj", seqIds(), "2026-07-23T00:00:00Z");

        assertEquals(2, n);
        assertEquals(2, store.list("/proj").size());
        assertTrue(store.list("/proj").stream().allMatch(f -> "FACT".equals(f.type()) && "project".equals(f.scope())));
    }

    @Test
    void dropsExactDuplicateAndAttachesNearestForSimilar(@TempDir File dir) {
        ContextCompressor compressor = mock(ContextCompressor.class);
        when(compressor.extractFactCandidates(anyList()))
                .thenReturn(List.of("用户偏好 Java 17", "用户住在旧金山"));
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        MemoryEntry exactDup = new MemoryEntry("e1", "用户偏好 Java 17", MemoryEntry.MemoryType.FACT, Map.of(), 5);
        MemoryEntry similar = new MemoryEntry("e2", "用户住在纽约", MemoryEntry.MemoryType.FACT, Map.of(), 5);
        when(retriever.retrieveLongTerm(eq("用户偏好 Java 17"), anyInt(), any())).thenReturn(List.of(exactDup));
        when(retriever.retrieveLongTerm(eq("用户住在旧金山"), anyInt(), any())).thenReturn(List.of(similar));
        PendingMemoryStore store = new PendingMemoryStore(dir);

        int n = service(dir, compressor, retriever, store)
                .extractFromSession(List.of(), "sess-1", "/proj", seqIds(), "2026-07-23T00:00:00Z");

        assertEquals(1, n);                                            // 精确重复被丢,仅剩 1
        List<PendingFact> pending = store.list("/proj");
        assertEquals(1, pending.size());
        assertEquals("用户住在旧金山", pending.get(0).fact());
        assertEquals("e2", pending.get(0).nearestExistingId());        // 相似(非等)条挂为提示
    }

    @Test
    void dropsSensitiveCandidates(@TempDir File dir) {
        ContextCompressor compressor = mock(ContextCompressor.class);
        when(compressor.extractFactCandidates(anyList()))
                .thenReturn(List.of("API key 是 sk-abc123def", "用户偏好深色主题"));
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        when(retriever.retrieveLongTerm(anyString(), anyInt(), any())).thenReturn(List.of());
        PendingMemoryStore store = new PendingMemoryStore(dir);

        int n = service(dir, compressor, retriever, store)
                .extractFromSession(List.of(), "sess-1", "/proj", seqIds(), "2026-07-23T00:00:00Z");

        assertEquals(1, n);                                            // sk- 候选被丢
        assertEquals("用户偏好深色主题", store.list("/proj").get(0).fact());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=MemoryExtractionServiceTest test`
Expected: 编译失败——`MemoryExtractionService` 不存在。

- [ ] **Step 3: 写实现**

`src/main/java/com/lyhn/wraith/memory/MemoryExtractionService.java`:

```java
package com.lyhn.wraith.memory;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * 会话边界自动记忆抽取编排:复用 ContextCompressor 抽取候选 → 去重/挂最相似提示 →
 * 敏感信息兜底 → 入 PendingMemoryStore 待确认。不直接写长期记忆。
 */
public class MemoryExtractionService {
    private static final Logger log = LoggerFactory.getLogger(MemoryExtractionService.class);

    // 凭证类敏感模式(命中即丢,不入队)
    private static final Pattern SENSITIVE = Pattern.compile(
            "(?i)(sk-[a-z0-9]{6,}|password\\s*=|passwd\\s*=|api[_-]?key|secret|token\\s*[:=]|-----BEGIN)");

    private final ContextCompressor compressor;
    private final MemoryRetriever retriever;
    private final PendingMemoryStore pendingStore;

    public MemoryExtractionService(ContextCompressor compressor, MemoryRetriever retriever, PendingMemoryStore pendingStore) {
        this.compressor = compressor;
        this.retriever = retriever;
        this.pendingStore = pendingStore;
    }

    /**
     * 从会话切片抽取候选并入队。返回入队数。
     * idGen/nowIso 由调用方注入以便测试确定化。
     */
    public int extractFromSession(List<MemoryEntry> slice, String sessionId, String projectKey,
                                  Supplier<String> idGen, String nowIso) {
        if (slice == null || slice.isEmpty()) {
            return 0;
        }
        List<String> candidates;
        try {
            candidates = compressor.extractFactCandidates(slice);
        } catch (RuntimeException e) {
            log.warn("自动记忆抽取失败: {}", e.getMessage());
            return 0;
        }

        int enqueued = 0;
        for (String fact : candidates) {
            if (fact == null || fact.isBlank()) {
                continue;
            }
            if (SENSITIVE.matcher(fact).find()) {
                log.debug("敏感候选丢弃: {}", fact);
                continue;
            }
            String nearestId = null;
            List<MemoryEntry> similar = retriever.retrieveLongTerm(fact, 1, projectKey);
            if (!similar.isEmpty()) {
                MemoryEntry top = similar.get(0);
                if (top.getContent().equals(fact)) {
                    continue; // 精确重复,丢弃不入队
                }
                nearestId = top.getId(); // 相似(非等)→ 挂提示,批准者定夺
            }
            pendingStore.add(new PendingFact(
                    idGen.get(), fact, "FACT", "project", nearestId, sessionId, projectKey, nowIso));
            enqueued++;
        }
        return enqueued;
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=MemoryExtractionServiceTest test`
Expected: 3 个用例通过。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/memory/MemoryExtractionService.java src/test/java/com/lyhn/wraith/memory/MemoryExtractionServiceTest.java
git commit -m "feat(memory): MemoryExtractionService 编排抽取/去重/敏感兜底/入候选队列"
```

---

### Task 5: MemoryManager 批准接线 + autoExtract 触发

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/memory/MemoryManager.java`
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`(`/clear` 清短期记忆前触发)
- Test: `src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java`

**Interfaces:**
- Consumes:Task 1 `PendingMemoryStore`/`PendingFact`;Task 4 `MemoryExtractionService`;Task 3 `LongTermMemory.markSuperseded`;现有 `storeFact(fact,scope)`、`getShortTermMemory()`、`getCurrentProject()`、`getLongTermMemory()`、`retriever`(私有,已有)。
- Produces(`MemoryManager` 新增):
  ```java
  public List<PendingFact> listPending()
  public boolean approvePending(String id)                    // ADD:storeFact(fact,scope) + 出队
  public boolean approvePendingReplacing(String id, String oldId) // storeFact(新) + markSuperseded(oldId) + 出队
  public boolean rejectPending(String id)                     // 仅出队
  public void clearPending()
  public int runAutoExtraction(String sessionId)              // 受 autoExtract 开关门控,抽当前短期记忆切片
  ```
- 开关:`autoExtract` 读 `System.getProperty("wraith.memory.autoExtract","true")`,`"false"` 关。

- [ ] **Step 1: 写失败测试**

写入 `src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java`:

```java
package com.lyhn.wraith.memory;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MemoryManagerPendingTest {

    private MemoryManager managerWithTempMemory(File dir) {
        System.setProperty("wraith.memory.dir", dir.getAbsolutePath());
        LlmClient llm = mock(LlmClient.class);
        MemoryManager m = new MemoryManager(llm, 4000, 128000, new LongTermMemory(dir));
        m.setProjectPath("/proj");
        return m;
    }

    @Test
    void approveAddsToLongTerm(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.enqueuePendingForTest(new PendingFact("c1", "用户偏好 Java 17", "FACT", "project", null, "s1", m.getCurrentProject(), "2026-07-23T00:00:00Z"));
        assertEquals(1, m.listPending().size());

        assertTrue(m.approvePending("c1"));

        assertTrue(m.listPending().isEmpty());
        assertTrue(m.getLongTermMemory().getAll().stream().anyMatch(e -> e.getContent().equals("用户偏好 Java 17")));
    }

    @Test
    void approveReplacingSupersedesOld(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.storeFact("用户住在纽约", "global");
        String oldId = m.getLongTermMemory().getAll().get(0).getId();
        m.enqueuePendingForTest(new PendingFact("c2", "用户住在旧金山", "FACT", "global", oldId, "s1", null, "2026-07-23T00:00:00Z"));

        assertTrue(m.approvePendingReplacing("c2", oldId));

        List<MemoryEntry> all = m.getLongTermMemory().getAll();
        assertTrue(all.stream().anyMatch(e -> e.getContent().equals("用户住在旧金山")));
        assertTrue(all.stream().noneMatch(e -> e.getContent().equals("用户住在纽约"))); // 旧条被超请、检索过滤
        assertTrue(m.listPending().isEmpty());
    }

    @Test
    void rejectDropsWithoutStoring(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.enqueuePendingForTest(new PendingFact("c3", "临时废话", "FACT", "project", null, "s1", m.getCurrentProject(), "2026-07-23T00:00:00Z"));
        assertTrue(m.rejectPending("c3"));
        assertTrue(m.listPending().isEmpty());
        assertTrue(m.getLongTermMemory().getAll().isEmpty());
    }

    @Test
    void autoExtractDisabledSkips(@TempDir File dir) {
        System.setProperty("wraith.memory.autoExtract", "false");
        try {
            MemoryManager m = managerWithTempMemory(dir);
            m.getShortTermMemory().store(new MemoryEntry("user-1", "用户偏好 Java 17", MemoryEntry.MemoryType.CONVERSATION, java.util.Map.of(), 5));
            assertEquals(0, m.runAutoExtraction("s1")); // 关闭 → 不抽
        } finally {
            System.clearProperty("wraith.memory.autoExtract");
        }
    }
}
```

> **注**:测试用了 `enqueuePendingForTest(PendingFact)` 直接入队(避免依赖真实 LLM 抽取);实现须提供此**包级可见**(或 public)测试辅助,直接委托 `pendingStore.add`。`MemoryManager(LlmClient, int, int, LongTermMemory)` 构造已存在(`MemoryManager.java:42`)。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 编译失败——`listPending`/`approvePending`/`approvePendingReplacing`/`rejectPending`/`runAutoExtraction`/`enqueuePendingForTest` 不存在。

- [ ] **Step 3: 写实现(MemoryManager)**

在 `MemoryManager` 加字段 + 初始化(在私有构造 `MemoryManager(LlmClient, ContextProfile, LongTermMemory)` 末尾,`this.currentProject=...` 之后):

```java
        this.pendingStore = new PendingMemoryStore();
        this.extractionService = new MemoryExtractionService(this.compressor, this.retriever, this.pendingStore);
```

字段声明(类顶部,与其它 final 字段一起):

```java
    private final PendingMemoryStore pendingStore;
    private final MemoryExtractionService extractionService;
    private final java.util.concurrent.ExecutorService extractionExecutor =
            java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "memory-extraction");
                t.setDaemon(true);
                return t;
            });
```

方法:

```java
    public List<PendingFact> listPending() {
        return pendingStore.list(currentProject);
    }

    public boolean approvePending(String id) {
        return pendingStore.get(id).map(pf -> {
            storeFact(pf.fact(), pf.scope());
            pendingStore.remove(id);
            return true;
        }).orElse(false);
    }

    public boolean approvePendingReplacing(String id, String oldId) {
        return pendingStore.get(id).map(pf -> {
            storeFact(pf.fact(), pf.scope());
            longTermMemory.markSuperseded(oldId);
            pendingStore.remove(id);
            return true;
        }).orElse(false);
    }

    public boolean rejectPending(String id) {
        return pendingStore.remove(id);
    }

    public void clearPending() {
        pendingStore.clear(currentProject);
    }

    /** 同步抽取当前短期记忆切片入候选队列(受 autoExtract 开关门控)。返回入队数。 */
    public int runAutoExtraction(String sessionId) {
        if (!autoExtractEnabled()) {
            return 0;
        }
        List<MemoryEntry> slice = shortTermMemory.getAll();
        return extractionService.extractFromSession(
                slice, sessionId, currentProject,
                () -> "cand-" + java.util.UUID.randomUUID().toString().substring(0, 8),
                java.time.Instant.now().toString());
    }

    /** 会话边界异步触发(不阻塞)。 */
    public void triggerAutoExtractionAsync(String sessionId) {
        if (!autoExtractEnabled()) {
            return;
        }
        List<MemoryEntry> slice = new java.util.ArrayList<>(shortTermMemory.getAll()); // 拷贝,后续可能被清
        extractionExecutor.submit(() -> {
            try {
                extractionService.extractFromSession(slice, sessionId, currentProject,
                        () -> "cand-" + java.util.UUID.randomUUID().toString().substring(0, 8),
                        java.time.Instant.now().toString());
            } catch (RuntimeException e) {
                log.warn("异步记忆抽取失败: {}", e.getMessage());
            }
        });
    }

    private static boolean autoExtractEnabled() {
        return !"false".equalsIgnoreCase(System.getProperty("wraith.memory.autoExtract", "true"));
    }

    // 测试辅助:直接入候选队列(绕过真实 LLM 抽取)
    void enqueuePendingForTest(PendingFact fact) {
        pendingStore.add(fact);
    }
```

需 import:`import java.util.List;`(已有)、`java.time`/`java.util.concurrent`/`java.util.UUID` 用全限定或补 import。`log` 字段已存在(`MemoryManager.java:20`)。

- [ ] **Step 4: 写实现(Agent 触发接线)**

`Agent.java:388` 现为 `memoryManager.clearShortTerm();`(在 `/clear` 处理里)。改为**先触发抽取再清**:

```java
        memoryManager.triggerAutoExtractionAsync(sessionId());
        memoryManager.clearShortTerm();
```

其中 `sessionId()`:若 `Agent` 已有会话 id 取用之;若无现成会话 id,用 `"clear-" + System.currentTimeMillis()` 之类的临时标识(实现者按 `Agent` 现有字段决定,sessionId 仅用于候选溯源、非关键)。**注意**:`triggerAutoExtractionAsync` 拷贝了切片,故在 `clearShortTerm()` 之前调用即可安全并发。

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 4 个用例通过。

- [ ] **Step 6: 全量后端回归**

Run: `mvn -q -DskipTests=false test`
Expected: 基线 1490 附近全绿(允许既有 11F 环境噪声,不新增失败);本 Phase 新增 4 个测试类全通过。若新增失败,systematic-debugging 定位。

- [ ] **Step 7: Commit**

```bash
git add src/main/java/com/lyhn/wraith/memory/MemoryManager.java src/main/java/com/lyhn/wraith/agent/Agent.java src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java
git commit -m "feat(memory): MemoryManager 候选批准/超请/驳回 + autoExtract 会话边界触发接线"
```

---

## Self-Review(写完对照 spec)

**1. Spec coverage(Phase A 部分)**:
- `PendingMemoryStore` + `PendingFact` → Task 1。
- 复用 `ContextCompressor` 抽取(纯方法 + 删死代码)→ Task 2。
- `markSuperseded` + 检索过滤 superseded → Task 3。
- `MemoryExtractionService`(抽取/去重/敏感兜底/入队/nearestExistingId 提示)→ Task 4。
- `MemoryManager` 批准(ADD/replacing)/驳回/列出/清 + autoExtract 触发 + Agent 接线 → Task 5。
- CLI/RPC(Phase B)、桌面(Phase C)→ **本计划不含**,另出。spec 已注明分期。

**2. Placeholder scan**:所有代码步骤含完整代码;`ChatResponse` 构造与 `sessionId()` 两处显式标注"以本仓实际为准 + 实现者据现有字段决定",并给了兜底方案,非模糊占位。

**3. Type consistency**:`PendingFact` 8 字段签名在 Task 1 定义,Task 4/5 构造一致(id,fact,type,scope,nearestExistingId,sessionId,project,createdAt);`extractFactCandidates(List<MemoryEntry>)` Task 2 定义、Task 4 消费一致;`markSuperseded(String):boolean` Task 3 定义、Task 5 消费一致;`retrieveLongTerm(String,int,String)` 用现有签名;`MemoryManager(LlmClient,int,int,LongTermMemory)` 用现有构造。

## 后续(不在本计划)

- **Phase B**:`/memory pending|approve|reject`(+`approve <id> replace <oldId>`)CLI + `memory.pending*` RPC。
- **Phase C**:`MemoryPanel` 待确认区(批准/替换/编辑/驳回)+ preload/IPC。
- A 合入并眼验后各自出计划。
