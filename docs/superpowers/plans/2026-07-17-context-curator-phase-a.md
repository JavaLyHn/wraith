# ContextCurator Phase A(后端核心)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地四级水位线的零成本层——真实 token 水位(Tier 判档+滞回)、Tier1 Snip、Tier2 Prune、工具全量落盘回取、context.watermark/context.compaction 事件、metrics JSONL、`wraith.context.curator.enabled` 回退开关;Tier3 本期由旧 `ConversationHistoryCompactor` 代位兜底(Phase B 换增量摘要)。

**Architecture:** 新包 `com.lyhn.wraith.context.curator`,六个可独立单测的单元(CurationMarks+ToolTierPolicy / WatermarkGauge / ProtectionBoundary / spill 三件套 / SnipPass / PrunePass / CurationStats / ContextCurator 编排);Agent 两处挂点(调 LLM 前 curate、收到 usage 后 onUsage);snip/prune 为破坏性原地改写+机器可读尾标,天然单调。

**Tech Stack:** Java 17 / Maven / JUnit 5;Jackson(已有依赖)只用于 metrics JSON 行;无新依赖。

**Spec:** `docs/superpowers/specs/2026-07-17-context-curator-design.md`(commit 8715847)。

## Global Constraints

- 阈值常量(全部支持 `-Dwraith.context.*` 覆盖):TIER1=0.60、TIER2=0.80、TIER3=0.95、TARGET=0.50;保护区预算 = min(12_000, window/4);spill 单文件上限 2_097_152 字符(2MB)。
- 红线:保护区内一切、用户纯文本(仅 markdown 代码块可截)、system prompt、保护名单工具(`load_skill`/`save_memory`/`revert_turn`)输出,任何 pass 不动;带 contentParts(图片)的 user 消息整条跳过。
- 单调:凡 content 含 `⟦wraith:snip⟧` 的消息 SnipPass 跳过;含 `⟦wraith:prune⟧` 的 PrunePass 跳过;同一 history 连跑两遍 pass,第二遍必须零变更(有单测)。
- tool_call/tool_result 成对协议不可破:pass 只改消息 content,绝不增删消息、绝不动 role/toolCallId/toolCalls 结构(PrunePass 裁 assistant 正文时必须原样保留其 toolCalls)。
- curator 一切异常不得让 Agent 主循环挂掉:入口 try/catch + log.warn,失败即本轮不治理。
- 测试红线:@TempDir,绝不写真实 `~/.wraith`;不打印任何密钥;异常只报类名。
- 门禁:单任务 `mvn -q test -DskipTests=false -Dtest=<TestClass>`;收尾全量 `mvn -q test -DskipTests=false`(既有 ~4F/38E 为 JDK26+Mockito 噪声,不算新增失败,新增失败为零才算过)。
- git add/commit 在仓库根;提交信息结尾统一加:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
```

## File Structure

- Create `src/main/java/com/lyhn/wraith/context/curator/`:`CurationMarks.java`、`ToolTierPolicy.java`、`WatermarkGauge.java`、`ProtectionBoundary.java`、`CurationSink.java`、`SpillingTruncator.java`、`SnipPass.java`、`PrunePass.java`、`CurationStats.java`、`ContextCurator.java`
- Create `src/main/java/com/lyhn/wraith/session/SessionCurationSink.java`
- Modify `src/main/java/com/lyhn/wraith/session/SessionStore.java`(加 artifactDir)
- Modify `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`(spill 接线两处)
- Modify `src/main/java/com/lyhn/wraith/render/Renderer.java`(default contextEvent)
- Modify `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`(override)
- Modify `src/main/java/com/lyhn/wraith/agent/Agent.java`(两挂点+busy-guard+开关)
- Modify `src/main/java/com/lyhn/wraith/cli/Main.java` 与/或 `AppServer.java`(sink 装配,按勘察实装)
- Test:`src/test/java/com/lyhn/wraith/context/curator/*Test.java`、`src/test/java/com/lyhn/wraith/session/SessionCurationSinkTest.java`

---

### Task 1: CurationMarks + ToolTierPolicy(标记与分级表)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/CurationMarks.java`
- Create: `src/main/java/com/lyhn/wraith/context/curator/ToolTierPolicy.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/ToolTierPolicyTest.java`

**Interfaces:**
- Produces:`CurationMarks.SNIP_MARK`/`PRUNE_MARK`/`LOG_POINTER_PREFIX`;`ToolTierPolicy.compressible(String)`、`ToolTierPolicy.SNIP_KEEP_HEAD_CHARS=600`、`SNIP_MIN_CHARS=1_500`、`CODEBLOCK_KEEP_LINES=8`、`CODEBLOCK_MIN_LINES=60`、`ASSISTANT_PRUNE_MIN_CHARS=1_200`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ToolTierPolicyTest {
    private final ToolTierPolicy policy = new ToolTierPolicy();

    @Test
    void protectedToolsAreNotCompressible() {
        assertFalse(policy.compressible("load_skill"));
        assertFalse(policy.compressible("save_memory"));
        assertFalse(policy.compressible("revert_turn"));
    }

    @Test
    void unknownAndWhitelistToolsAreCompressible() {
        assertTrue(policy.compressible("execute_command"));
        assertTrue(policy.compressible("grep_code"));
        assertTrue(policy.compressible("some_future_tool"));  // 新工具默认可压,保护靠名单显式声明
        assertTrue(policy.compressible(null));                 // 无名映射(找不到所属工具)按可压处理
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — Run: `mvn -q test -DskipTests=false -Dtest=ToolTierPolicyTest`,Expected: 编译失败(类不存在)。

- [ ] **Step 3: 最小实现**

```java
package com.lyhn.wraith.context.curator;

/** 治理产物的机器可读标记:pass 见标即跳过——单调性的实现基石。 */
public final class CurationMarks {
    public static final String SNIP_MARK = "⟦wraith:snip⟧";
    public static final String PRUNE_MARK = "⟦wraith:prune⟧";
    /** 完整日志指针行前缀(spill 与 pass 共用,pass 改写时必须保留该行)。 */
    public static final String LOG_POINTER_PREFIX = "[完整输出: ";
    private CurationMarks() {}
}
```

```java
package com.lyhn.wraith.context.curator;

import java.util.Set;

/** 工具分级:保护名单显式声明,其余(含未知新工具)默认可压。数值为 pass 的截断常量。 */
public final class ToolTierPolicy {
    /** 任何 Tier 不动:技能正文=工作知识;记忆写入极小;状态回滚凭据。 */
    public static final Set<String> PROTECTED_TOOLS = Set.of("load_skill", "save_memory", "revert_turn");

    public static final int SNIP_KEEP_HEAD_CHARS = 600;
    public static final int SNIP_MIN_CHARS = 1_500;          // 原文短于此不值得动
    public static final int CODEBLOCK_KEEP_LINES = 8;
    public static final int CODEBLOCK_MIN_LINES = 60;        // 用户代码块超过此行数才截
    public static final int ASSISTANT_PRUNE_MIN_CHARS = 1_200;

    public boolean compressible(String toolName) {
        return toolName == null || !PROTECTED_TOOLS.contains(toolName);
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令,Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/ src/test/java/com/lyhn/wraith/context/curator/
git commit -m "feat(curator): 治理标记与工具分级表(保护名单制,新工具默认可压)"
```

---

### Task 2: WatermarkGauge(真实 token 水位 + 滞回)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/WatermarkGauge.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/WatermarkGaugeTest.java`

**Interfaces:**
- Consumes:无(独立)。
- Produces:`record Reading(long usedTokens, long window, double ratio, int tier)`;`void onRealUsage(long inputTokens, long historyEstimateAtCall)`;`Reading read(long historyEstimateNow)`;`long tokensToRelease(Reading r)`;构造 `WatermarkGauge(java.util.function.LongSupplier windowSupplier)`;静态 `double threshold(String prop, double dflt)`。

**口径(spec §6)**:`used = lastRealInput + (estNow − estAtReal)`;无真实值时 `used = estNow`。估算只算相对增量,触发以真实值为锚。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WatermarkGaugeTest {
    private WatermarkGauge gauge(long window) { return new WatermarkGauge(() -> window); }

    @Test
    void fallsBackToEstimateBeforeFirstRealUsage() {
        WatermarkGauge g = gauge(100_000);
        WatermarkGauge.Reading r = g.read(30_000);
        assertEquals(30_000, r.usedTokens());
        assertEquals(0, r.tier());
    }

    @Test
    void realUsageAnchorsAndEstimateTracksDelta() {
        WatermarkGauge g = gauge(100_000);
        g.onRealUsage(70_000, 40_000);          // 真实 70k,当时估算 40k(估算低估)
        WatermarkGauge.Reading r = g.read(45_000); // 又新增估算 5k
        assertEquals(75_000, r.usedTokens());      // 70k + (45k-40k)
        assertEquals(1, r.tier());                 // 75% → Tier1(≥60 <80)
    }

    @Test
    void tierBoundaries() {
        WatermarkGauge g = gauge(100_000);
        assertEquals(0, g.read(59_999).tier());
        assertEquals(1, g.read(60_000).tier());
        assertEquals(2, g.read(80_000).tier());
        assertEquals(3, g.read(95_000).tier());
    }

    @Test
    void tokensToReleaseTargetsFiftyPercent() {
        WatermarkGauge g = gauge(100_000);
        WatermarkGauge.Reading r = g.read(72_000);
        assertEquals(22_000, g.tokensToRelease(r)); // 72k − 50k
        assertEquals(0, g.tokensToRelease(g.read(40_000)));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `mvn -q test -DskipTests=false -Dtest=WatermarkGaugeTest`,Expected: 编译失败。

- [ ] **Step 3: 最小实现**

```java
package com.lyhn.wraith.context.curator;

import java.util.function.LongSupplier;

/**
 * 真实 token 水位计:以最近一次 LLM 真实 usage 为锚,加上锚点之后 history 估算增量。
 * 真实优先、估算兜底;估算只承担相对量(spec §6 滞回口径)。
 */
public final class WatermarkGauge {
    public static final double TIER1 = threshold("wraith.context.tier1", 0.60);
    public static final double TIER2 = threshold("wraith.context.tier2", 0.80);
    public static final double TIER3 = threshold("wraith.context.tier3", 0.95);
    public static final double TARGET = threshold("wraith.context.target", 0.50);

    public record Reading(long usedTokens, long window, double ratio, int tier) {}

    private final LongSupplier windowSupplier;
    private long lastRealInput = -1;
    private long estimateAtReal = 0;

    public WatermarkGauge(LongSupplier windowSupplier) {
        this.windowSupplier = windowSupplier;
    }

    /** LLM 响应到达时调用:真实 inputTokens + 该次调用前 history 的估算值(作差分锚点)。 */
    public synchronized void onRealUsage(long inputTokens, long historyEstimateAtCall) {
        if (inputTokens <= 0) return;
        this.lastRealInput = inputTokens;
        this.estimateAtReal = historyEstimateAtCall;
    }

    public synchronized Reading read(long historyEstimateNow) {
        long window = Math.max(1, windowSupplier.getAsLong());
        long used = lastRealInput < 0
                ? historyEstimateNow
                : Math.max(0, lastRealInput + (historyEstimateNow - estimateAtReal));
        double ratio = (double) used / window;
        int tier = ratio >= TIER3 ? 3 : ratio >= TIER2 ? 2 : ratio >= TIER1 ? 1 : 0;
        return new Reading(used, window, ratio, tier);
    }

    /** 压回 TARGET 线所需释放的估算 token 量(≤0 表示无需释放)。 */
    public long tokensToRelease(Reading r) {
        return Math.max(0, r.usedTokens() - (long) Math.floor(r.window() * TARGET));
    }

    static double threshold(String prop, double dflt) {
        try {
            String v = System.getProperty(prop);
            return v == null ? dflt : Double.parseDouble(v);
        } catch (NumberFormatException e) {
            return dflt;
        }
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — 同上,Expected: PASS(4 tests)。
- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/WatermarkGauge.java src/test/java/com/lyhn/wraith/context/curator/WatermarkGaugeTest.java
git commit -m "feat(curator): WatermarkGauge——真实usage锚点+估算差分水位,四档判定与50%滞回目标"
```

---

### Task 3: ProtectionBoundary(保护区计算 + 工具名映射)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/ProtectionBoundary.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/ProtectionBoundaryTest.java`

**Interfaces:**
- Consumes:`com.lyhn.wraith.memory.TokenBudget.estimateMessagesTokens(List<Message>)`(已有 public static)。
- Produces:`static int protectedFrom(List<LlmClient.Message> history, long budget)`(返回保护区起始索引,含;该索引到末尾不可动);`static long protectedBudget(long window)`(= min(12_000, window/4),`-Dwraith.context.protect` 可覆盖);`static Map<String,String> toolNamesById(List<Message>)`(assistant.toolCalls 的 id→function.name)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ProtectionBoundaryTest {

    private static Message user(String s) { return Message.user(s); }
    private static Message asst(String s) { return Message.assistant(s); }

    @Test
    void budgetClampsForSmallWindows() {
        assertEquals(12_000, ProtectionBoundary.protectedBudget(128_000));
        assertEquals(2_000, ProtectionBoundary.protectedBudget(8_000)); // 8k/4
    }

    @Test
    void protectsAtLeastLastTwoUserRounds() {
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                user("r1"), asst("a1"),
                user("r2"), asst("a2"),
                user("r3"), asst("a3")));
        // 预算极小(1 token)也必须至少保住最近 2 个 user 轮 → 边界落在 "r2"(index 3)
        assertEquals(3, ProtectionBoundary.protectedFrom(h, 1));
    }

    @Test
    void boundaryExpandsBackToUserEdge() {
        // 大预算把累计推进到中段的 assistant 上 → 必须外扩到其前最近 user
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                user("x".repeat(4000)), asst("y".repeat(4000)),
                user("tail1"), asst("t"), user("tail2"), asst("t")));
        int from = ProtectionBoundary.protectedFrom(h, 3_000);
        assertEquals("user", h.get(from).role());
    }

    @Test
    void toolNamesByIdWalksAssistantToolCalls() {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("id-1",
                new LlmClient.ToolCall.Function("grep_code", "{}"));
        List<Message> h = List.of(
                Message.assistant("do", List.of(tc)),
                Message.tool("id-1", "result"));
        assertEquals("grep_code", ProtectionBoundary.toolNamesById(h).get("id-1"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `mvn -q test -DskipTests=false -Dtest=ProtectionBoundaryTest`,Expected: 编译失败。

- [ ] **Step 3: 最小实现**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.llm.LlmClient.ToolCall;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 保护区:尾部累计 token 预算外扩到 user 边界,且至少最近 2 个完整 user 轮(spec §5)。 */
public final class ProtectionBoundary {
    private ProtectionBoundary() {}

    public static long protectedBudget(long window) {
        long dflt = Math.min(12_000, Math.max(1, window / 4));
        try {
            String v = System.getProperty("wraith.context.protect");
            return v == null ? dflt : Long.parseLong(v);
        } catch (NumberFormatException e) {
            return dflt;
        }
    }

    /** 返回保护区起始索引(含):[from, size) 任何 pass 不得改写。 */
    public static int protectedFrom(List<Message> history, long budget) {
        int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;
        if (history.size() <= systemEnd) return systemEnd;

        long acc = 0;
        int idx = history.size();
        for (int i = history.size() - 1; i >= systemEnd; i--) {
            acc += TokenBudget.estimateMessagesTokens(List.of(history.get(i)));
            idx = i;
            if (acc >= budget) break;
        }
        // 外扩到 user 边界(含该 user)
        int anchor = idx;
        while (anchor > systemEnd && !"user".equals(history.get(anchor).role())) anchor--;
        if (!"user".equals(history.get(anchor).role())) anchor = idx;

        // 至少最近 2 个 user 轮
        List<Integer> users = new ArrayList<>();
        for (int i = systemEnd; i < history.size(); i++) {
            if ("user".equals(history.get(i).role())) users.add(i);
        }
        if (users.size() >= 2) anchor = Math.min(anchor, users.get(users.size() - 2));
        else if (users.size() == 1) anchor = Math.min(anchor, users.get(0));

        return Math.max(anchor, systemEnd);
    }

    /** assistant.toolCalls 建 id→工具名映射,供 pass 对 tool 消息判豁免。 */
    public static Map<String, String> toolNamesById(List<Message> history) {
        Map<String, String> m = new HashMap<>();
        for (Message msg : history) {
            if (msg.toolCalls() == null) continue;
            for (ToolCall tc : msg.toolCalls()) {
                if (tc.id() != null && tc.function() != null) m.put(tc.id(), tc.function().name());
            }
        }
        return m;
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — 同上,Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/ProtectionBoundary.java src/test/java/com/lyhn/wraith/context/curator/ProtectionBoundaryTest.java
git commit -m "feat(curator): 保护区边界计算(预算外扩user边界+至少2轮)与tool名映射"
```

---

### Task 4: 落盘回取(CurationSink + SessionStore.artifactDir + SpillingTruncator + ToolRegistry 接线)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/CurationSink.java`
- Create: `src/main/java/com/lyhn/wraith/context/curator/SpillingTruncator.java`
- Create: `src/main/java/com/lyhn/wraith/session/SessionCurationSink.java`
- Modify: `src/main/java/com/lyhn/wraith/session/SessionStore.java`
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`(grep_code 渲染 ~:495-535 与 readProcessOutput ~:1532-1555 两处,按内容匹配)
- Test: `src/test/java/com/lyhn/wraith/context/curator/SpillingTruncatorTest.java`、`src/test/java/com/lyhn/wraith/session/SessionCurationSinkTest.java`

**Interfaces:**
- Produces:
  - `interface CurationSink { Optional<Path> writeToolLog(String tool, CharSequence content); void appendMetrics(String jsonLine); CurationSink NOOP; }`
  - `SpillingTruncator.truncateWithSpill(CurationSink sink, String tool, String full, int maxChars)` → 不超限原样返回;超限返回 `head(maxChars) + "\n...(输出已截断)" + ["\n" + LOG_POINTER_PREFIX + path + "]"](spill 成功时)`
  - `SessionStore.artifactDir()` → `Optional<Path>`(无 currentId → empty;有则 `dir/<safeId(currentId)>-artifacts/`,惰性建目录)
  - `ToolRegistry.setCurationSink(CurationSink)`(默认 NOOP)
- Consumes:`CurationMarks.LOG_POINTER_PREFIX`(Task 1)。

- [ ] **Step 1: 写失败测试(SpillingTruncator)**

```java
package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;

class SpillingTruncatorTest {

    static CurationSink dirSink(Path dir) {
        return new CurationSink() {
            @Override public Optional<Path> writeToolLog(String tool, CharSequence content) {
                try {
                    Path p = dir.resolve(tool + "-" + System.nanoTime() + ".log");
                    Files.writeString(p, content);
                    return Optional.of(p);
                } catch (Exception e) { return Optional.empty(); }
            }
            @Override public void appendMetrics(String jsonLine) {}
        };
    }

    @Test
    void underLimitPassesThrough(@TempDir Path dir) {
        assertEquals("short", SpillingTruncator.truncateWithSpill(dirSink(dir), "grep_code", "short", 100));
    }

    @Test
    void overLimitSpillsFullAndAppendsPointer(@TempDir Path dir) throws Exception {
        String full = "x".repeat(500);
        String out = SpillingTruncator.truncateWithSpill(dirSink(dir), "grep_code", full, 100);
        assertTrue(out.startsWith("x".repeat(100)));
        assertTrue(out.contains(CurationMarks.LOG_POINTER_PREFIX));
        // 指针指向的文件内容 = 全量
        String path = out.substring(out.indexOf(CurationMarks.LOG_POINTER_PREFIX)
                + CurationMarks.LOG_POINTER_PREFIX.length(), out.lastIndexOf(']'));
        assertEquals(full, Files.readString(Path.of(path)));
    }

    @Test
    void spillFailureDegradesToPlainTruncation(@TempDir Path dir) {
        CurationSink broken = new CurationSink() {
            @Override public Optional<Path> writeToolLog(String t, CharSequence c) { return Optional.empty(); }
            @Override public void appendMetrics(String j) {}
        };
        String out = SpillingTruncator.truncateWithSpill(broken, "grep_code", "x".repeat(500), 100);
        assertFalse(out.contains(CurationMarks.LOG_POINTER_PREFIX));
        assertTrue(out.contains("(输出已截断)"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `mvn -q test -DskipTests=false -Dtest=SpillingTruncatorTest`,Expected: 编译失败。

- [ ] **Step 3: 实现 CurationSink + SpillingTruncator**

```java
package com.lyhn.wraith.context.curator;

import java.nio.file.Path;
import java.util.Optional;

/** 治理产物的落地通道:工具全量日志 + metrics JSONL。实现须自行吞异常(治理不许拖垮主循环)。 */
public interface CurationSink {
    Optional<Path> writeToolLog(String tool, CharSequence content);
    void appendMetrics(String jsonLine);

    CurationSink NOOP = new CurationSink() {
        @Override public Optional<Path> writeToolLog(String tool, CharSequence content) { return Optional.empty(); }
        @Override public void appendMetrics(String jsonLine) {}
    };
}
```

```java
package com.lyhn.wraith.context.curator;

import java.nio.file.Path;
import java.util.Optional;

/** 入口截断 + 全量落盘:被截 ≠ 丢——截断版尾部附完整日志指针(spec §3)。 */
public final class SpillingTruncator {
    /** spill 内容上限 2MB 字符,防内存/磁盘失控。 */
    public static final int SPILL_MAX_CHARS = 2_097_152;

    private SpillingTruncator() {}

    public static String truncateWithSpill(CurationSink sink, String tool, String full, int maxChars) {
        if (full == null || full.length() <= maxChars) return full;
        String toSpill = full.length() > SPILL_MAX_CHARS
                ? full.substring(0, SPILL_MAX_CHARS) + "\n...(spill 上限 2MB,其余丢弃)"
                : full;
        Optional<Path> logged = sink.writeToolLog(tool, toSpill);
        String base = full.substring(0, maxChars) + "\n...(输出已截断)";
        return logged.map(p -> base + "\n" + CurationMarks.LOG_POINTER_PREFIX + p + "]").orElse(base);
    }
}
```

- [ ] **Step 4: 跑 SpillingTruncatorTest 确认通过**。

- [ ] **Step 5: 写失败测试(SessionCurationSink)**

```java
package com.lyhn.wraith.session;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class SessionCurationSinkTest {

    @Test
    void writesLogAndMetricsUnderArtifactDir(@TempDir Path home) throws Exception {
        SessionStore store = SessionStore.forWorkspace(home, Path.of("/tmp/proj"));  // 按 SessionStore 实际工厂签名调整
        store.startNew();                                                             // 产生 currentId;按实际 API 调整
        SessionCurationSink sink = new SessionCurationSink(store);
        Path log = sink.writeToolLog("grep_code", "FULL").orElseThrow();
        assertEquals("FULL", Files.readString(log));
        sink.appendMetrics("{\"a\":1}");
        Path metrics = log.getParent().resolve("context-metrics.jsonl");
        assertTrue(Files.readString(metrics).contains("{\"a\":1}"));
    }

    @Test
    void noSessionMeansNoop(@TempDir Path home) {
        SessionStore store = SessionStore.forWorkspace(home, Path.of("/tmp/proj"));
        SessionCurationSink sink = new SessionCurationSink(store);
        assertTrue(sink.writeToolLog("t", "x").isEmpty());  // 无 currentId → empty,不抛
    }
}
```

**注**:`SessionStore` 的工厂/开会话 API 名以实际源码为准(实现者先读 `SessionStore.java` 头部与 :60-90 区域,把测试里两行标注处替换为真实调用;若工厂只认真实 home,用其现有可注 home 的构造/工厂——该类 :70 依据 home resolve `.wraith/sessions/<hash>`,测试传 @TempDir 为 home 即不碰真实目录)。

- [ ] **Step 6: 实现 SessionStore.artifactDir + SessionCurationSink**

`SessionStore.java` 增加(紧随现有 `dir` 字段族方法之后;`safeId`/`currentId` 均为该类已有成员):

```java
    /** 当前会话的治理产物目录(工具全量日志/metrics):<dir>/<safeId(currentId)>-artifacts/。无会话返回 empty。 */
    public java.util.Optional<java.nio.file.Path> artifactDir() {
        if (currentId == null || currentId.isBlank()) return java.util.Optional.empty();
        java.nio.file.Path p = dir.resolve(safeId(currentId) + "-artifacts");
        try {
            java.nio.file.Files.createDirectories(p);
            return java.util.Optional.of(p);
        } catch (java.io.IOException e) {
            return java.util.Optional.empty();
        }
    }
```

```java
package com.lyhn.wraith.session;

import com.lyhn.wraith.context.curator.CurationSink;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

/** 会话作用域的治理落地:日志/metrics 都写进当前会话的 -artifacts 目录;一切失败静默降级。 */
public final class SessionCurationSink implements CurationSink {
    private final SessionStore store;
    private final AtomicLong seq = new AtomicLong();

    public SessionCurationSink(SessionStore store) { this.store = store; }

    @Override
    public Optional<Path> writeToolLog(String tool, CharSequence content) {
        try {
            Optional<Path> dir = store.artifactDir();
            if (dir.isEmpty()) return Optional.empty();
            String safeTool = tool == null ? "tool" : tool.replaceAll("[^a-zA-Z0-9_-]", "_");
            Path p = dir.get().resolve(seq.incrementAndGet() + "-" + safeTool + ".log");
            Files.writeString(p, content);
            return Optional.of(p);
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    @Override
    public void appendMetrics(String jsonLine) {
        try {
            Optional<Path> dir = store.artifactDir();
            if (dir.isEmpty()) return;
            Files.writeString(dir.get().resolve("context-metrics.jsonl"), jsonLine + "\n",
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (Exception ignored) {
        }
    }
}
```

- [ ] **Step 7: 跑 SessionCurationSinkTest 确认通过**。

- [ ] **Step 8: ToolRegistry 接线(两处)**

字段+setter(类字段区):

```java
    private com.lyhn.wraith.context.curator.CurationSink curationSink =
            com.lyhn.wraith.context.curator.CurationSink.NOOP;
    public void setCurationSink(com.lyhn.wraith.context.curator.CurationSink sink) {
        this.curationSink = sink == null ? com.lyhn.wraith.context.curator.CurationSink.NOOP : sink;
    }
```

**(a) grep_code**(按内容匹配 ~:495-535 的渲染循环):把现有循环体抽成私有 `renderGrepMatches(GrepResult result, String query, int capChars)`(返回渲染串+是否截断,内部逻辑原样搬移);原调用处改为:

```java
        RenderedGrep rendered = renderGrepMatches(result, query, maxChars);
        if (!rendered.truncated()) return rendered.text();
        // 截断:全量(2MB 帽)重渲一次落盘,截断版尾部附指针
        RenderedGrep full = renderGrepMatches(result, query, com.lyhn.wraith.context.curator.SpillingTruncator.SPILL_MAX_CHARS);
        return curationSink.writeToolLog("grep_code", full.text())
                .map(p -> rendered.text() + "\n" + com.lyhn.wraith.context.curator.CurationMarks.LOG_POINTER_PREFIX + p + "]")
                .orElse(rendered.text());
```

`record RenderedGrep(String text, boolean truncated) {}` 为 ToolRegistry 内部私有 record。抽方法时保持原有 partial 提示、appendSuggestedReads 行为不变(截断版走原样,全量版跳过 suggestions)。

**(b) execute_command `readProcessOutput`**(按内容匹配 ~:1532-1555):加侧缓冲收集全量(帽 2MB),溢出时落盘+指针:

```java
    private String readProcessOutput(Process process, String callId) throws Exception {
        StringBuilder output = new StringBuilder();
        StringBuilder fullBuf = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (callId != null) {
                    safeOnChunk(callId, "stdout", line);
                }
                if (fullBuf.length() < com.lyhn.wraith.context.curator.SpillingTruncator.SPILL_MAX_CHARS) {
                    fullBuf.append(line).append('\n');
                }
                if (output.length() < MAX_COMMAND_OUTPUT_CHARS) {
                    int remaining = MAX_COMMAND_OUTPUT_CHARS - output.length();
                    if (line.length() > remaining) {
                        output.append(line, 0, remaining);
                    } else {
                        output.append(line);
                    }
                    output.append("\n");
                }
            }
        }
        if (output.length() >= MAX_COMMAND_OUTPUT_CHARS) {
            String truncated = output.substring(0, MAX_COMMAND_OUTPUT_CHARS) + "\n...(输出已截断)";
            return curationSink.writeToolLog("execute_command", fullBuf)
                    .map(p -> truncated + "\n" + com.lyhn.wraith.context.curator.CurationMarks.LOG_POINTER_PREFIX + p + "]")
                    .orElse(truncated);
        }
        return output.toString();
    }
```

- [ ] **Step 9: 全量相关测试** — `mvn -q test -DskipTests=false -Dtest='SpillingTruncatorTest,SessionCurationSinkTest'` PASS;再跑 `mvn -q test -DskipTests=false -Dtest='*ToolRegistry*'`(如有)确认无回归。
- [ ] **Step 10: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/ src/main/java/com/lyhn/wraith/session/ src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/test/java
git commit -m "feat(curator): 工具全量落盘回取——CurationSink/SpillingTruncator/会话artifacts目录,grep_code+execute_command 截断处接指针"
```

---

### Task 5: SnipPass(Tier 1 零成本截短)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/SnipPass.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/SnipPassTest.java`

**Interfaces:**
- Consumes:`ToolTierPolicy`(T1)、`CurationMarks`(T1)、`ProtectionBoundary.toolNamesById`(T3)、`TokenBudget.estimateMessagesTokens`。
- Produces:`record Change(int index, String tool, long releasedEstTokens, String logPath)`;`record Result(java.util.List<Change> changes, long releasedEstTokens)`;`static Result apply(List<Message> history, int protectedFrom, ToolTierPolicy policy, long releaseTarget)`。

**行为**:从最老端(system 之后)向后、到 protectedFrom 为止:
- `tool` 消息:所属工具可压 && content 不含 SNIP_MARK && 长度 > SNIP_MIN_CHARS → 改写为 `head(SNIP_KEEP_HEAD_CHARS) + "\n" + SNIP_MARK + "[原 N 字符已截]" + [原文中的日志指针行(若有,原样保留)]`;
- `user` 消息:纯文本不动;`contentParts != null` 整条跳过;content 含 ≥CODEBLOCK_MIN_LINES 行的 fenced 代码块(``` 包裹)→ 块内保留前 CODEBLOCK_KEEP_LINES 行 + `…(SNIP_MARK)[代码块原 N 行已截]`,块外文本逐字不动;
- 累计释放达 releaseTarget 即停;返回变更集与释放估算。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SnipPassTest {
    private final ToolTierPolicy policy = new ToolTierPolicy();

    private static List<Message> historyWithTool(String tool, String content) {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("c1",
                new LlmClient.ToolCall.Function(tool, "{}"));
        return new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user("do it"),
                Message.assistant("run", List.of(tc)),
                Message.tool("c1", content),
                Message.user("next"),
                Message.assistant("ok")));
    }

    @Test
    void snipsLongToolOutputOutsideProtection() {
        List<Message> h = historyWithTool("grep_code", "L".repeat(5000) + "\n[完整输出: /tmp/x.log]");
        SnipPass.Result r = SnipPass.apply(h, 4, policy, Long.MAX_VALUE);
        assertEquals(1, r.changes().size());
        String c = h.get(3).content();
        assertTrue(c.contains(CurationMarks.SNIP_MARK));
        assertTrue(c.contains("[完整输出: /tmp/x.log]"));          // 指针行保留
        assertTrue(c.length() < 1200);
        assertEquals("c1", h.get(3).toolCallId());                 // 协议字段不动
    }

    @Test
    void monotonicSecondRunChangesNothing() {
        List<Message> h = historyWithTool("grep_code", "L".repeat(5000));
        SnipPass.apply(h, 4, policy, Long.MAX_VALUE);
        SnipPass.Result second = SnipPass.apply(h, 4, policy, Long.MAX_VALUE);
        assertTrue(second.changes().isEmpty());
    }

    @Test
    void protectedToolAndProtectedZoneUntouched() {
        List<Message> h = historyWithTool("load_skill", "S".repeat(5000));
        assertTrue(SnipPass.apply(h, 4, policy, Long.MAX_VALUE).changes().isEmpty());
        List<Message> h2 = historyWithTool("grep_code", "L".repeat(5000));
        assertTrue(SnipPass.apply(h2, 0, policy, Long.MAX_VALUE).changes().isEmpty()); // 全在保护区
    }

    @Test
    void userPlainTextNeverTouchedButHugeCodeblockClipped() {
        String code = "```java\n" + "line;\n".repeat(100) + "```";
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user("前言\n" + code + "\n后记"),
                Message.assistant("a"),
                Message.user("tail"), Message.assistant("t")));
        SnipPass.apply(h, 3, policy, Long.MAX_VALUE);
        String c = h.get(1).content();
        assertTrue(c.startsWith("前言"));
        assertTrue(c.endsWith("后记"));
        assertTrue(c.contains(CurationMarks.SNIP_MARK));
        assertTrue(c.lines().count() < 30);
    }

    @Test
    void stopsWhenReleaseTargetReached() {
        LlmClient.ToolCall t1 = new LlmClient.ToolCall("c1", new LlmClient.ToolCall.Function("grep_code", "{}"));
        LlmClient.ToolCall t2 = new LlmClient.ToolCall("c2", new LlmClient.ToolCall.Function("grep_code", "{}"));
        List<Message> h = new ArrayList<>(List.of(
                Message.system("sys"),
                Message.user("u"),
                Message.assistant("a", List.of(t1)), Message.tool("c1", "A".repeat(8000)),
                Message.assistant("a", List.of(t2)), Message.tool("c2", "B".repeat(8000)),
                Message.user("tail"), Message.assistant("t")));
        SnipPass.Result r = SnipPass.apply(h, 6, policy, 100); // 极小目标:第一条就够
        assertEquals(1, r.changes().size());
        assertFalse(h.get(5).content().contains(CurationMarks.SNIP_MARK)); // 第二条未动
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `mvn -q test -DskipTests=false -Dtest=SnipPassTest`。

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tier 1 Snip:保护区外、可压工具输出截短 + 用户超大代码块截短。零 LLM。
 * 破坏性原地改写 + SNIP_MARK 尾标 → 见标跳过,单调免费(spec §2)。
 */
public final class SnipPass {
    public record Change(int index, String tool, long releasedEstTokens, String logPath) {}
    public record Result(List<Change> changes, long releasedEstTokens) {}

    private static final Pattern FENCE = Pattern.compile("```[^\\n]*\\n(.*?)```", Pattern.DOTALL);
    private static final Pattern POINTER_LINE =
            Pattern.compile("^" + Pattern.quote(CurationMarks.LOG_POINTER_PREFIX) + ".*\\]$", Pattern.MULTILINE);

    private SnipPass() {}

    public static Result apply(List<Message> history, int protectedFrom, ToolTierPolicy policy, long releaseTarget) {
        List<Change> changes = new ArrayList<>();
        long released = 0;
        Map<String, String> toolNames = ProtectionBoundary.toolNamesById(history);
        int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;

        for (int i = systemEnd; i < Math.min(protectedFrom, history.size()) && released < releaseTarget; i++) {
            Message m = history.get(i);
            String content = m.content();
            if (content == null || content.contains(CurationMarks.SNIP_MARK)) continue;

            if ("tool".equals(m.role())) {
                String tool = toolNames.get(m.toolCallId());
                if (!policy.compressible(tool) || content.length() <= ToolTierPolicy.SNIP_MIN_CHARS) continue;
                String pointer = extractPointer(content);
                String rebuilt = content.substring(0, ToolTierPolicy.SNIP_KEEP_HEAD_CHARS)
                        + "\n" + CurationMarks.SNIP_MARK + "[原 " + content.length() + " 字符已截]"
                        + (pointer == null ? "" : "\n" + pointer);
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, Message.tool(m.toolCallId(), rebuilt));
                released += Math.max(0, delta);
                changes.add(new Change(i, tool, Math.max(0, delta), pointer));
            } else if ("user".equals(m.role())) {
                if (m.contentParts() != null) continue;  // 图片消息整条跳过(spec §11)
                String rebuilt = clipCodeblocks(content);
                if (rebuilt.equals(content)) continue;
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, Message.user(rebuilt));
                released += Math.max(0, delta);
                changes.add(new Change(i, null, Math.max(0, delta), null));
            }
        }
        return new Result(changes, released);
    }

    private static String extractPointer(String content) {
        Matcher m = POINTER_LINE.matcher(content);
        return m.find() ? m.group() : null;
    }

    /** 只截 fenced 代码块,块外文本逐字不动(用户纯文本红线)。 */
    private static String clipCodeblocks(String content) {
        Matcher m = FENCE.matcher(content);
        StringBuilder out = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String body = m.group(1);
            long lines = body.lines().count();
            out.append(content, last, m.start());
            if (lines >= ToolTierPolicy.CODEBLOCK_MIN_LINES) {
                String head = body.lines().limit(ToolTierPolicy.CODEBLOCK_KEEP_LINES)
                        .reduce("", (a, b) -> a + b + "\n");
                String fenceHeader = content.substring(m.start(), content.indexOf('\n', m.start()) + 1);
                out.append(fenceHeader).append(head)
                        .append("…").append(CurationMarks.SNIP_MARK)
                        .append("[代码块原 ").append(lines).append(" 行已截]\n```");
            } else {
                out.append(content, m.start(), m.end());
            }
            last = m.end();
        }
        out.append(content.substring(last));
        return out.toString();
    }

    private static long estimate(String text) {
        return TokenBudget.estimateMessagesTokens(List.of(Message.user(text)));
    }
}
```

- [ ] **Step 4: 跑测试确认通过**(5 tests)。
- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/SnipPass.java src/test/java/com/lyhn/wraith/context/curator/SnipPassTest.java
git commit -m "feat(curator): SnipPass——保护区外工具输出/用户大代码块零成本截短,尾标单调,达标即停"
```

---

### Task 6: PrunePass(Tier 2 占位与 assistant 裁剪)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/PrunePass.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/PrunePassTest.java`

**Interfaces:**
- Consumes:T1/T3 同上;复用 `SnipPass.Change`/`SnipPass.Result`(公开 record)。
- Produces:`static SnipPass.Result apply(List<Message> history, int protectedFrom, ToolTierPolicy policy, long releaseTarget)`。

**行为**(保护区外,oldest-first,达标即停):
- `tool` 消息:含 SNIP_MARK 且不含 PRUNE_MARK → 整体替换为 `"[工具输出已压缩]" + PRUNE_MARK + [指针行(若有)]`(可压工具才动;从 SNIP 产物继续压)。
- `assistant` 消息:content 长度 > ASSISTANT_PRUNE_MIN_CHARS 且不含 PRUNE_MARK → 改写为前两句(按 `。.!?\n` 切,最多 240 字符)+ `"…[truncated]" + PRUNE_MARK`;**toolCalls 原样保留**(用五参构造 `new Message("assistant", rebuilt, null, m.toolCalls(), null)`),reasoningContent 置 null(额外释放,DeepSeek 不要求回放 reasoning)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class PrunePassTest {
    private final ToolTierPolicy policy = new ToolTierPolicy();

    @Test
    void snippedToolBecomesPlaceholderKeepingPointer() {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("c1", new LlmClient.ToolCall.Function("grep_code", "{}"));
        List<Message> h = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"),
                Message.assistant("a", List.of(tc)),
                Message.tool("c1", "head..." + CurationMarks.SNIP_MARK + "[原 9000 字符已截]\n"
                        + CurationMarks.LOG_POINTER_PREFIX + "/tmp/x.log]"),
                Message.user("tail"), Message.assistant("t")));
        PrunePass.apply(h, 4, policy, Long.MAX_VALUE);
        String c = h.get(3).content();
        assertTrue(c.contains(CurationMarks.PRUNE_MARK));
        assertTrue(c.contains("/tmp/x.log"));
        assertFalse(c.contains("head..."));
    }

    @Test
    void longAssistantTextTrimmedButToolCallsPreserved() {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("c9", new LlmClient.ToolCall.Function("read_file", "{}"));
        String longText = "第一句。第二句。" + "废话".repeat(2000);
        List<Message> h = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"),
                Message.assistant(longText, List.of(tc)),
                Message.tool("c9", "r"),
                Message.user("tail"), Message.assistant("t")));
        PrunePass.apply(h, 4, policy, Long.MAX_VALUE);
        Message pruned = h.get(2);
        assertTrue(pruned.content().contains(CurationMarks.PRUNE_MARK));
        assertTrue(pruned.content().length() < 400);
        assertNotNull(pruned.toolCalls());
        assertEquals("c9", pruned.toolCalls().get(0).id());
    }

    @Test
    void monotonicAndProtectedZoneUntouched() {
        List<Message> h = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"),
                Message.assistant("长".repeat(3000)),
                Message.user("tail"), Message.assistant("t")));
        PrunePass.apply(h, 3, policy, Long.MAX_VALUE);
        assertTrue(PrunePass.apply(h, 3, policy, Long.MAX_VALUE).changes().isEmpty()); // 二遍零变更
        List<Message> h2 = new ArrayList<>(List.of(
                Message.system("s"), Message.user("u"), Message.assistant("长".repeat(3000))));
        assertTrue(PrunePass.apply(h2, 1, policy, Long.MAX_VALUE).changes().isEmpty()); // 全保护
    }
}
```

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Tier 2 Prune:snip 产物→占位符;老 assistant 长文裁前两句。零 LLM,同样尾标单调。 */
public final class PrunePass {
    private static final Pattern POINTER_LINE =
            Pattern.compile("^" + Pattern.quote(CurationMarks.LOG_POINTER_PREFIX) + ".*\\]$", Pattern.MULTILINE);
    private static final Pattern SENTENCE_END = Pattern.compile("[。.!?\\n]");

    private PrunePass() {}

    public static SnipPass.Result apply(List<Message> history, int protectedFrom,
                                        ToolTierPolicy policy, long releaseTarget) {
        List<SnipPass.Change> changes = new ArrayList<>();
        long released = 0;
        Map<String, String> toolNames = ProtectionBoundary.toolNamesById(history);
        int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;

        for (int i = systemEnd; i < Math.min(protectedFrom, history.size()) && released < releaseTarget; i++) {
            Message m = history.get(i);
            String content = m.content();
            if (content == null || content.contains(CurationMarks.PRUNE_MARK)) continue;

            if ("tool".equals(m.role()) && content.contains(CurationMarks.SNIP_MARK)) {
                String tool = toolNames.get(m.toolCallId());
                if (!policy.compressible(tool)) continue;
                Matcher p = POINTER_LINE.matcher(content);
                String rebuilt = "[工具输出已压缩]" + CurationMarks.PRUNE_MARK
                        + (p.find() ? "\n" + p.group() : "");
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, Message.tool(m.toolCallId(), rebuilt));
                released += Math.max(0, delta);
                changes.add(new SnipPass.Change(i, tool, Math.max(0, delta), null));
            } else if ("assistant".equals(m.role())
                    && content.length() > ToolTierPolicy.ASSISTANT_PRUNE_MIN_CHARS) {
                String rebuilt = firstSentences(content) + "…[truncated]" + CurationMarks.PRUNE_MARK;
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, new Message("assistant", rebuilt, null, m.toolCalls(), null));
                released += Math.max(0, delta);
                changes.add(new SnipPass.Change(i, null, Math.max(0, delta), null));
            }
        }
        return new SnipPass.Result(changes, released);
    }

    private static String firstSentences(String text) {
        Matcher m = SENTENCE_END.matcher(text);
        int end = -1;
        for (int hits = 0; m.find() && hits < 2 && m.end() <= 240; hits++) end = m.end();
        return text.substring(0, end > 0 ? end : Math.min(240, text.length()));
    }

    private static long estimate(String text) {
        return TokenBudget.estimateMessagesTokens(List.of(Message.user(text)));
    }
}
```

- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/PrunePass.java src/test/java/com/lyhn/wraith/context/curator/PrunePassTest.java
git commit -m "feat(curator): PrunePass——snip产物换占位符+老assistant裁前两句(toolCalls保留),尾标单调"
```

---

### Task 7: CurationStats(累计统计 + metrics JSONL 行)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/CurationStats.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/CurationStatsTest.java`

**Interfaces:**
- Consumes:`CurationSink.appendMetrics`(T4)。
- Produces:`void recordUsage(long input, long output, long cached, WatermarkGauge.Reading r)`(step 自增+写一行 metrics);`void recordCompaction(int tier, long before, long after, int snipped, int pruned, boolean summarized, long durationMs)`(累计+写一行);getter:`long totalSavedEst()`、`int totalSnipped()`、`int totalPruned()`、`int compactions()`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class CurationStatsTest {

    @Test
    void writesUsageAndCompactionLinesAndAccumulates() {
        List<String> lines = new ArrayList<>();
        CurationSink sink = new CurationSink() {
            @Override public Optional<Path> writeToolLog(String t, CharSequence c) { return Optional.empty(); }
            @Override public void appendMetrics(String j) { lines.add(j); }
        };
        CurationStats stats = new CurationStats(sink);
        stats.recordUsage(1000, 200, 300, new WatermarkGauge.Reading(1000, 10_000, 0.10, 0));
        stats.recordCompaction(1, 9000, 6000, 3, 0, false, 12);

        assertEquals(2, lines.size());
        assertTrue(lines.get(0).contains("\"inputTokens\":1000"));
        assertTrue(lines.get(0).contains("\"cachedInputTokens\":300"));
        assertTrue(lines.get(1).contains("\"tier\":1"));
        assertEquals(3000, stats.totalSavedEst());
        assertEquals(3, stats.totalSnipped());
        assertEquals(1, stats.compactions());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.context.curator;

import java.util.Locale;

/** 治理统计:面板取数源 + metrics JSONL 行(spec §9)。字段全数值,手拼 JSON 安全。 */
public final class CurationStats {
    private final CurationSink sink;
    private long step;
    private long totalSavedEst;
    private int totalSnipped;
    private int totalPruned;
    private int compactions;

    public CurationStats(CurationSink sink) { this.sink = sink; }

    public synchronized void recordUsage(long input, long output, long cached, WatermarkGauge.Reading r) {
        step++;
        sink.appendMetrics(String.format(Locale.ROOT,
                "{\"ts\":%d,\"step\":%d,\"inputTokens\":%d,\"outputTokens\":%d,\"cachedInputTokens\":%d,\"ratio\":%.4f,\"tier\":%d}",
                System.currentTimeMillis(), step, input, output, cached, r.ratio(), r.tier()));
    }

    public synchronized void recordCompaction(int tier, long before, long after,
                                              int snipped, int pruned, boolean summarized, long durationMs) {
        compactions++;
        totalSnipped += snipped;
        totalPruned += pruned;
        totalSavedEst += Math.max(0, before - after);
        sink.appendMetrics(String.format(Locale.ROOT,
                "{\"ts\":%d,\"compaction\":true,\"tier\":%d,\"beforeTokens\":%d,\"afterTokens\":%d,"
                        + "\"snipped\":%d,\"pruned\":%d,\"summarized\":%b,\"durationMs\":%d}",
                System.currentTimeMillis(), tier, before, after, snipped, pruned, summarized, durationMs));
    }

    public synchronized long totalSavedEst() { return totalSavedEst; }
    public synchronized int totalSnipped() { return totalSnipped; }
    public synchronized int totalPruned() { return totalPruned; }
    public synchronized int compactions() { return compactions; }
}
```

- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/CurationStats.java src/test/java/com/lyhn/wraith/context/curator/CurationStatsTest.java
git commit -m "feat(curator): CurationStats——usage/compaction 两类 metrics JSONL 行与会话累计"
```

---

### Task 8: ContextCurator 编排 + Renderer.contextEvent

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java`
- Modify: `src/main/java/com/lyhn/wraith/render/Renderer.java`
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/ContextCuratorTest.java`

**Interfaces:**
- Consumes:T1-T7 全部。
- Produces:
  - `ContextCurator(LongSupplier windowSupplier, ToolTierPolicy policy, CurationSink sink, BiConsumer<String, Map<String,Object>> eventOut)`(内部自建 gauge/stats;`stats()` getter 供 Phase C);
  - `void onUsage(long input, long output, long cached, List<Message> history)`(锚 gauge + metrics 行 + `context.watermark` 事件;绝不抛);
  - `boolean curate(List<Message> history, Runnable tier3Fallback)`(判档→T1/T2→仍 ≥TIER3 则 fallback→`context.compaction` 事件;绝不抛;返回是否有动作);
  - `Renderer` 新增 `default void contextEvent(String method, java.util.Map<String, Object> payload) {}`;`EventStreamRenderer` override 为 `writer.notify(method, payload)`(payload 并入 base() 的 turnId,参照该类既有 emit 模式)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ContextCuratorTest {

    private static List<Message> bigHistory() {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("c1", new LlmClient.ToolCall.Function("grep_code", "{}"));
        List<Message> h = new ArrayList<>();
        h.add(Message.system("sys"));
        h.add(Message.user("start"));
        for (int i = 0; i < 6; i++) {
            h.add(Message.assistant("a", List.of(tc)));
            h.add(Message.tool("c1", ("data" + i).repeat(3000)));
        }
        h.add(Message.user("tail"));
        h.add(Message.assistant("done"));
        return h;
    }

    record Ev(String method, Map<String, Object> payload) {}

    private static ContextCurator curator(List<Ev> events, long window) {
        return new ContextCurator(() -> window, new ToolTierPolicy(), CurationSink.NOOP,
                (m, p) -> events.add(new Ev(m, p)));
    }

    @Test
    void belowTier1DoesNothing() {
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 10_000_000);  // 巨大窗口 → ratio≈0
        List<Message> h = bigHistory();
        assertFalse(c.curate(h, () -> fail("不该走 tier3")));
        assertTrue(events.isEmpty());
    }

    @Test
    void tier1SnipsAndEmitsCompactionEvent() {
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 30_000);      // bigHistory 估算远超 60%
        List<Message> h = bigHistory();
        assertTrue(c.curate(h, () -> {}));
        assertEquals("context.compaction", events.get(events.size() - 1).method());
        Map<String, Object> p = events.get(events.size() - 1).payload();
        assertTrue((int) p.get("snipped") > 0);
        // 至少一条工具输出带了 snip 标
        assertTrue(h.stream().anyMatch(m -> m.content() != null && m.content().contains(CurationMarks.SNIP_MARK)));
    }

    @Test
    void onUsageEmitsWatermarkAndNeverThrows() {
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 100_000);
        c.onUsage(70_000, 500, 60_000, bigHistory());
        assertEquals("context.watermark", events.get(0).method());
        assertTrue(((Number) events.get(0).payload().get("usedTokens")).longValue() >= 70_000);
    }

    @Test
    void tier3RunsFallbackWhenPassesCannotRelease() {
        // 大头全是保护名单工具(load_skill)→ passes 无从下手 → 仍 ≥95% → 必须走 fallback
        LlmClient.ToolCall tc = new LlmClient.ToolCall("s1", new LlmClient.ToolCall.Function("load_skill", "{}"));
        List<Message> h = new ArrayList<>();
        h.add(Message.system("sys"));
        h.add(Message.user("start"));
        for (int i = 0; i < 6; i++) {
            h.add(Message.assistant("a", List.of(tc)));
            h.add(Message.tool("s1", "skill-body".repeat(3000)));
        }
        h.add(Message.user("tail"));
        h.add(Message.assistant("done"));
        List<Ev> events = new ArrayList<>();
        ContextCurator c = curator(events, 12_000);
        boolean[] ran = {false};
        c.curate(h, () -> ran[0] = true);
        assertTrue(ran[0]);
        // 保护名单未被任何 pass 碰过
        assertTrue(h.stream().noneMatch(m -> m.content() != null && m.content().contains(CurationMarks.SNIP_MARK)));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 实现 ContextCurator**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.LongSupplier;

/**
 * 四级水位线编排(spec §1/§2):判档 → Tier1 Snip → Tier2 Prune → 仍 ≥95% 交 tier3Fallback。
 * 一切异常内部吞掉并 log(治理绝不拖垮主循环);事件通过 eventOut 外发。
 */
public final class ContextCurator {
    private static final Logger log = LoggerFactory.getLogger(ContextCurator.class);

    private final WatermarkGauge gauge;
    private final ToolTierPolicy policy;
    private final CurationStats stats;
    private final BiConsumer<String, Map<String, Object>> eventOut;
    private final LongSupplier windowSupplier;

    public ContextCurator(LongSupplier windowSupplier, ToolTierPolicy policy,
                          CurationSink sink, BiConsumer<String, Map<String, Object>> eventOut) {
        this.windowSupplier = windowSupplier;
        this.gauge = new WatermarkGauge(windowSupplier);
        this.policy = policy;
        this.stats = new CurationStats(sink);
        this.eventOut = eventOut;
    }

    public CurationStats stats() { return stats; }

    /** LLM 响应到达后调用:锚定真实水位 + metrics 行 + watermark 事件。 */
    public void onUsage(long input, long output, long cached, List<Message> history) {
        try {
            long estNow = TokenBudget.estimateMessagesTokens(history);
            gauge.onRealUsage(input, estNow);
            WatermarkGauge.Reading r = gauge.read(estNow);
            stats.recordUsage(input, output, cached, r);
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("usedTokens", r.usedTokens());
            p.put("window", r.window());
            p.put("ratio", r.ratio());
            p.put("tier", r.tier());
            eventOut.accept("context.watermark", p);
        } catch (Exception e) {
            log.warn("context watermark record failed: {}", e.getClass().getSimpleName());
        }
    }

    /** 调 LLM 前治理。返回是否发生任何动作。 */
    public boolean curate(List<Message> history, Runnable tier3Fallback) {
        try {
            long estBefore = TokenBudget.estimateMessagesTokens(history);
            WatermarkGauge.Reading r = gauge.read(estBefore);
            if (r.tier() == 0) return false;

            long start = System.nanoTime();
            long target = gauge.tokensToRelease(r);
            int protectedFrom = ProtectionBoundary.protectedFrom(
                    history, ProtectionBoundary.protectedBudget(r.window()));

            List<SnipPass.Change> all = new ArrayList<>();
            SnipPass.Result snip = SnipPass.apply(history, protectedFrom, policy, target);
            all.addAll(snip.changes());
            int pruned = 0;
            long releasedSoFar = snip.releasedEstTokens();
            if (r.tier() >= 2 && releasedSoFar < target) {
                SnipPass.Result prune = PrunePass.apply(history, protectedFrom, policy, target - releasedSoFar);
                all.addAll(prune.changes());
                pruned = prune.changes().size();
                releasedSoFar += prune.releasedEstTokens();
            }

            boolean summarized = false;
            long estAfterPasses = TokenBudget.estimateMessagesTokens(history);
            if (r.tier() >= 3 && gauge.read(estAfterPasses).tier() >= 3 && tier3Fallback != null) {
                tier3Fallback.run();   // Phase A:旧 ConversationHistoryCompactor 代位;Phase B 换增量摘要
                summarized = true;
            }

            long estAfter = TokenBudget.estimateMessagesTokens(history);
            int snipped = snip.changes().size();
            if (snipped == 0 && pruned == 0 && !summarized) return false;

            long durationMs = (System.nanoTime() - start) / 1_000_000;
            stats.recordCompaction(r.tier(), estBefore, estAfter, snipped, pruned, summarized, durationMs);
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("tier", r.tier());
            p.put("beforeTokens", estBefore);
            p.put("afterTokens", estAfter);
            p.put("snipped", snipped);
            p.put("pruned", pruned);
            p.put("summarized", summarized);
            p.put("savedTokens", Math.max(0, estBefore - estAfter));
            p.put("durationMs", durationMs);
            List<Map<String, Object>> items = new ArrayList<>();
            for (SnipPass.Change c : all) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("index", c.index());
                if (c.tool() != null) item.put("tool", c.tool());
                item.put("releasedEstTokens", c.releasedEstTokens());
                if (c.logPath() != null) item.put("logPath", c.logPath());
                items.add(item);
            }
            p.put("items", items);
            eventOut.accept("context.compaction", p);
            log.info("context curated: tier={} est {} -> {}, snipped={}, pruned={}, summarized={}",
                    r.tier(), estBefore, estAfter, snipped, pruned, summarized);
            return true;
        } catch (Exception e) {
            log.warn("context curation failed: {}", e.getClass().getSimpleName());
            return false;
        }
    }
}
```

- [ ] **Step 4: Renderer + EventStreamRenderer**

`Renderer.java` 接口内(其余 default 方法旁)加:

```java
    /** 上下文治理事件(context.watermark / context.compaction)。终端渲染器默认忽略;事件流渲染器转发桌面。 */
    default void contextEvent(String method, java.util.Map<String, Object> payload) {
    }
```

`EventStreamRenderer.java` 加 override(参照该类既有 `emit`/`base()` 模式,payload 合并 base 的 turnId 字段后 notify):

```java
    @Override public void contextEvent(String method, java.util.Map<String, Object> payload) {
        java.util.Map<String, Object> p = base();
        p.putAll(payload);
        writer.notify(method, p);
    }
```

- [ ] **Step 5: 跑测试确认通过** — `mvn -q test -DskipTests=false -Dtest=ContextCuratorTest`。
- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java src/main/java/com/lyhn/wraith/render/Renderer.java src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java src/test/java/com/lyhn/wraith/context/curator/ContextCuratorTest.java
git commit -m "feat(curator): ContextCurator 编排(判档→Snip→Prune→tier3代位)+ context.* 事件经 Renderer 外发"
```

---

### Task 9: Agent 接线(两挂点 + busy-guard + 开关 + sink 装配)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`
- Modify: sink 装配点(实现者用 `grep -rn "new Agent(" src/main/java` 与 `grep -rn "new SessionStore\|SessionStore " src/main/java/com/lyhn/wraith/cli/Main.java src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` 找到 Agent 与 SessionStore 同时在手的装配处——预期在 cli.Main 的 SessionRunner 构建区)
- Test: 复用既有 Agent 相关测试回归 + `src/test/java/com/lyhn/wraith/context/curator/` 已有单测

**Interfaces:**
- Consumes:T8 `ContextCurator`、T4 `SessionCurationSink`、`ToolRegistry.setCurationSink`。
- Produces:`Agent.setCurationSink(CurationSink)`(公开,装配点调用;同时透传给 toolRegistry);`Agent.compactHistoryNow()` busy 时返回 `CompactionResult(false, before, before, "busy: 回合运行中,稍后再试")`。

- [ ] **Step 1: Agent 字段与构造**(按内容匹配;`historyCompactor` 字段旁)

```java
    private final ContextCurator curator;
    private com.lyhn.wraith.context.curator.CurationSink curationSink =
            com.lyhn.wraith.context.curator.CurationSink.NOOP;
    private volatile boolean turnActive = false;
```

构造器里(`this.historyCompactor = new ConversationHistoryCompactor(llmClient);` 之后):

```java
        this.curator = new ContextCurator(
                () -> this.llmClient == null ? 128_000 : this.llmClient.maxContextWindow(),
                new com.lyhn.wraith.context.curator.ToolTierPolicy(),
                new com.lyhn.wraith.context.curator.CurationSink() {   // 委托可替换的 curationSink 字段
                    @Override public java.util.Optional<java.nio.file.Path> writeToolLog(String t, CharSequence c) {
                        return curationSink.writeToolLog(t, c);
                    }
                    @Override public void appendMetrics(String j) { curationSink.appendMetrics(j); }
                },
                (method, payload) -> renderer().contextEvent(method, payload));
```

setter(setLlmClient 旁):

```java
    /** 会话治理落地通道(工具全量日志/metrics);装配点在建好 SessionStore 后注入,同时透传工具层。 */
    public void setCurationSink(com.lyhn.wraith.context.curator.CurationSink sink) {
        this.curationSink = sink == null ? com.lyhn.wraith.context.curator.CurationSink.NOOP : sink;
        if (toolRegistry != null) toolRegistry.setCurationSink(this.curationSink);
    }
```

(import 区加 `com.lyhn.wraith.context.curator.ContextCurator`。)

- [ ] **Step 2: 两挂点 + 开关**

`maybeCompactHistory()`(:431 附近)整体改为:

```java
    private static boolean curatorEnabled() {
        return !"false".equals(System.getProperty("wraith.context.curator.enabled"));
    }

    private void maybeCompactHistory() {
        if (curatorEnabled()) {
            curator.curate(conversationHistory, this::legacyAutoCompact);
            return;
        }
        legacyAutoCompact();
    }

    /** 旧路径(回退开关 + Phase A 的 Tier3 代位;Phase B 换增量摘要后仅剩回退用途)。 */
    private void legacyAutoCompact() {
        if (historyCompactor == null) return;
        int trigger = memoryManager.getContextProfile().compressionTriggerTokens();
        try {
            boolean compacted = historyCompactor.compactIfNeeded(conversationHistory, trigger);
            if (compacted) {
                renderer().stream().println("📦 上下文接近窗口上限，已把早期对话压缩为摘要后继续。");
            }
        } catch (Exception e) {
            log.warn("conversationHistory compaction failed", e);
        }
    }
```

**注意**:Tier3 代位走 legacy 时,`compactIfNeeded` 自身还有 trigger 判断——curate 已判 ≥95%,通常必然超 trigger,行为兼容。

usage 挂点(:250 `budget.recordTokens(...)` 之后紧接):

```java
                curator.onUsage(response.inputTokens(), response.outputTokens(),
                        response.cachedInputTokens(), conversationHistory);
```

- [ ] **Step 3: busy-guard**

`run(...)` 主方法体(while 循环外层)用 try/finally 包住:进入处 `turnActive = true;`,finally `turnActive = false;`(实现者找 run 方法的最外层入口——`pushStatus(budget, startNanos, ...)` 首调之前设 true,与方法返回路径统一的 finally 设 false)。

`compactHistoryNow()`(:353 附近)开头加:

```java
        if (turnActive) {
            long tokens = estimateCurrentContextTokens();
            return new CompactionResult(false, tokens, tokens, "busy: 回合运行中,稍后再试");
        }
```

- [ ] **Step 4: 装配点注入 sink**

在 grep 找到的装配处(Agent 与 SessionStore 都在手的位置,预期 cli.Main 的会话装配区)加:

```java
        agent.setCurationSink(new com.lyhn.wraith.session.SessionCurationSink(sessionStore));
```

(变量名按现场实际;若同一处也持有 ToolRegistry 单独实例,setCurationSink 已内部透传,无需重复接。找不到唯一装配点时:按 `new ConversationHistoryCompactor` 的装配先例放同一层。)

- [ ] **Step 5: 全量门禁**

Run: `mvn -q test -DskipTests=false 2>&1 | tail -20`
Expected: 新增测试全绿;总失败/错误数不超过既有基线(~4F/38E,JDK26+Mockito 噪声),**零新增失败**。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/agent/Agent.java src/main/java/com/lyhn/wraith/cli/ src/main/java/com/lyhn/wraith/runtime/appserver/
git commit -m "feat(curator): Agent 接线——curate 替换自动压缩(开关可回退)、真实usage挂点、手动压缩busy互斥、会话sink装配"
```

---

## 收尾:门禁 + opus 终审 + 眼验

- 全量 `mvn -q test -DskipTests=false`(零新增失败)。
- opus 读全 diff(base..HEAD)终审重点:单调性(两遍 pass 零变更测试真实存在且通过)、红线(保护区/用户纯文本/保护名单/协议对)、curate 异常隔离(绝不拖垮主循环)、开关回退完整性(disabled 时行为与改造前逐字节等价)、spill 降级路径、事件 payload 字段与 spec §7 一致、YAGNI。
- 眼验(用户,重启桌面 dev + `mvn package` + cp jar 到 `~/.wraith/wraith.jar`——改了 Java 后端):长会话观察 log 中 `context curated` 行、`~/.wraith/sessions/<hash>/<id>-artifacts/` 出现工具日志与 metrics;`-Dwraith.context.curator.enabled=false` 回退无感。
- **push 需用户单独点头**。

## 执行说明

- T1→T2→T3 可先行(纯新增无依赖冲突,但串行提交);T4 独立;T5/T6 依赖 T1/T3;T7 依赖 T4 接口;T8 依赖全部;T9 收口。全程串行执行。
- 实现者模型:T1/T2/T3/T7 haiku(简报含完整代码,转录+跑测);T4/T5/T6/T8 sonnet(涉既有大文件接线/正则细节);T9 sonnet(跨文件装配+勘察)。reviewer sonnet;终审 opus。
