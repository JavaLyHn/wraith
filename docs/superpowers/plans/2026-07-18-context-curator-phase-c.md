# ContextCurator Phase C 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面可观测 UI(四档色水位 + RightDock ContextPanel)+ TUI tier 徽标 + Phase B 终审留档 6 项收口。

**Architecture:** 桌面侧核心是让 `transcriptReducer` 接住**已经在飞**的 `context.watermark/compaction` 通知(EventStreamRenderer.java:355 已外发,现被 reducer 丢弃),新增 `context` 切片;UI 三件(StatusChip 升级/RightDock 第三分段 ContextPanel/TUI 徽标)全部只消费该切片与既有 status。后端收口四小件互相独立:compactNow 防兜报+回报字段、JSONL 聚合抽 `ContextStateAggregator`(带 ratio 重算)、headless 接 pricingTable、两个入口拉快照。

**Tech Stack:** Java 17/Maven/JUnit5(`-DskipTests=false`);Electron+React+TS(vitest;reducer 纯函数测)。

**Spec:** `docs/superpowers/specs/2026-07-18-context-curator-phase-c-design.md`

## Global Constraints

- 测试红线:Java 一律 `@TempDir`,**绝不写真实 `~/.wraith`**;桌面测试纯内存。
- 密钥红线:密钥不进日志/RPC/快照;异常日志只报类名。
- 事件形状(实证,勿混淆):`context.watermark/compaction` 通知 params **平铺**(`usedTokens` 等直接在顶层,EventStreamRenderer.contextEvent putAll);`status` 通知是信封(`params.status` 嵌套)。
- 四档色单一来源:`desktop/src/shared/contextTier.ts`(Task 4 建),色值 tier0 `#22c55e` 绿 / tier1 `#eab308` 黄 / tier2 `#f97316` 橙 / tier3 `#ef4444` 红;TUI 用 ANSI 32/33/38;5;208/31 对应。
- 阈值口径与后端一致:tier = ratio≥0.95→3,≥0.80→2,≥0.60→1,否则 0。
- 基线:Java 全量 **1527** 不降、desktop `tsc --noEmit` 0 错、vitest **678** 不降(`cd desktop && npx tsc --noEmit && npx vitest run`)。
- 跑 Java 测试:`mvn test -DskipTests=false [-Dtest=XxxTest]`。
- 提交信息尾部两行:`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01E6qtyEJFHAxiMsCSKsjpQh`。
- **push 需用户单独点头**,任务只 commit 不 push。

---

### Task 1: compactNow 防-兜-报 + ManualCompaction 回报(后端)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java`(compactNow)
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java:415-437`(compactHistoryNow + CompactionResult)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java:1569-1580` 附近(runner compactHistory map 补键)
- Test: `src/test/java/com/lyhn/wraith/context/curator/ContextCuratorTest.java`

**Interfaces:**
- Consumes: `PrunePass.apply(..., PrunePass.Mode.EMERGENCY)`、`intProp("wraith.context.summary.cooldown",3)`、FakeSummarizer 测试桩(均已在)。
- Produces:
  - `ContextCurator.ManualCompaction`(record `boolean any, boolean summarized, String fallback`;fallback null=未走兜底)
  - `ContextCurator.compactNow(List<Message>)` 返回 `ManualCompaction`(原 boolean)。
  - `Agent.CompactionResult` 扩为 `record CompactionResult(boolean compacted, long beforeTokens, long afterTokens, String error, boolean summarized, String fallback)`。
  - Main runner map 新增键 `summarized`(boolean)、`fallback`(String|绝不 put null——null 时不 put)。Task 2 依赖这两键。

- [ ] **Step 1: 写失败测试**(ContextCuratorTest 追加;FakeSummarizer/curatorWith/bigHistory 均已有)

```java
@Test
void manualCompactFailureFallsBackAndReports() {
    FakeSummarizer fs = new FakeSummarizer(false);
    ContextCurator c = curatorWith(fs);
    List<Message> h = bigHistory();
    ContextCurator.ManualCompaction r = c.compactNow(h);
    assertEquals(1, fs.calls);
    assertTrue(r.any(), "snip/prune 有动作");
    assertFalse(r.summarized());
    assertEquals("emergency", r.fallback(), "摘要失败必须走兜底并如实回报");
    Map<String, Object> evt = lastEvent("context.compaction");
    assertEquals(true, evt.get("manual"));
    assertEquals("emergency", evt.get("fallback"));
    // 失败进入 cooldown:随后自动 curate 冷却期内不再调 LLM
    c.curate(h);
    assertEquals(1, fs.calls, "manual 失败也应进入 cooldown");
}

@Test
void cooldownExpiryRetriesSummarizeEndToEnd() {
    // spec §7 顺带补:Phase B 留档的 cooldown 到期重试 e2e——默认 cooldown=3,
    // 失败轮 + 3 个冷却轮之后,第 5 次 curate 必须重试 summarize
    FakeSummarizer fs = new FakeSummarizer(false);
    ContextCurator c = curatorWith(fs);
    List<Message> h = bigHistory();
    c.curate(h);                       // 失败,calls=1,cooldown=3
    c.curate(h); c.curate(h); c.curate(h);   // 冷却 3→2→1→0,不调 LLM
    assertEquals(1, fs.calls);
    c.curate(h);                       // 冷却耗尽,重试
    assertEquals(2, fs.calls, "cooldown 到期后必须重试摘要");
}

@Test
void manualCompactSuccessReportsSummarizedNoFallback() {
    FakeSummarizer fs = new FakeSummarizer(true);
    ContextCurator c = curatorWith(fs);
    ContextCurator.ManualCompaction r = c.compactNow(bigHistory());
    assertTrue(r.any());
    assertTrue(r.summarized());
    assertNull(r.fallback(), "成功路径 fallback 必须为 null");
    assertNull(lastEvent("context.compaction").get("fallback"), "成功事件不带 fallback 键");
}
```

同时把既有 `manualCompactNowRunsFullPipeline` 的 `assertTrue(c.compactNow(h))` 改为 `assertTrue(c.compactNow(h).any())`。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=ContextCuratorTest`
Expected: FAIL — `ManualCompaction` 不存在(编译错)。

- [ ] **Step 3: 实现**

ContextCurator.java 加 record(类内,ManualCompaction 放 stats() 附近):

```java
    /** 手动压缩回报(spec Phase C §4):fallback null=未走兜底。 */
    public record ManualCompaction(boolean any, boolean summarized, String fallback) {}
```

`compactNow` 签名改 `public ManualCompaction compactNow(List<Message> history)`,摘要调用段改为与 curate 同语义:

```java
            boolean summarized = false;
            String fallback = null;
            if (summarizer.summarize(history, protectedFrom, model, r.window())) {
                summarized = true;
            } else {
                cooldown = intProp("wraith.context.summary.cooldown", 3);
                fallback = "emergency";
                SnipPass.Result em = PrunePass.apply(history, protectedFrom, policy,
                        Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
                all.addAll(em.changes());
            }
```

事件 payload 在 `p.put("manual", true);` 后加 `if (fallback != null) p.put("fallback", fallback);`;方法尾:

```java
            boolean any = !all.isEmpty() || summarized;
            if (any) { /* ……原 stats/事件段不动…… */ }
            return new ManualCompaction(any, summarized, fallback);
        } catch (Exception e) {
            log.warn("manual curation failed: {}", e.getClass().getSimpleName());
            return new ManualCompaction(false, false, null);
        }
```

(catch 分支返回三 false/null;原 `return any;`/`return false;` 全替换。)

Agent.java:CompactionResult 扩 6 字段 + 兼容旧 4 参构造器(3 个既有构造点不用改):

```java
    public record CompactionResult(boolean compacted, long beforeTokens, long afterTokens, String error,
                                   boolean summarized, String fallback) {
        public CompactionResult(boolean compacted, long beforeTokens, long afterTokens, String error) {
            this(compacted, beforeTokens, afterTokens, error, false, null);
        }
    }
```

`compactHistoryNow` 的 curator 分支改:

```java
            if (curatorEnabled()) {
                ContextCurator.ManualCompaction mc = curator.compactNow(conversationHistory);
                return new CompactionResult(mc.any(), beforeTokens, estimateCurrentContextTokens(), null,
                        mc.summarized(), mc.fallback());
            }
            boolean compacted = historyCompactor.compactNow(conversationHistory);
            return new CompactionResult(compacted, beforeTokens, estimateCurrentContextTokens(), null);
```

(import `com.lyhn.wraith.context.curator.ContextCurator`——Agent 已 import。)

Main.java:1569 附近 runner `compactHistory()` 的 map 组装处(以实际代码为准,现组装 compacted/beforeTokens/afterTokens/error 四键)追加:

```java
                            m.put("summarized", r.summarized());
                            if (r.fallback() != null) m.put("fallback", r.fallback());
```

- [ ] **Step 4: 跑测试确认通过 + 全编译**

Run: `mvn test -DskipTests=false -Dtest=ContextCuratorTest && mvn -q compile`
Expected: PASS(既有 8 + 新 2)+ 编译零错。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java \
        src/main/java/com/lyhn/wraith/agent/Agent.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/context/curator/ContextCuratorTest.java
git commit -m "feat(curator): compactNow 防兜报对齐curate+ManualCompaction回报,CompactionResult补summarized/fallback"
```

---

### Task 2: 手动压缩前端回报文案(compactView + preload 类型)

**Files:**
- Modify: `desktop/src/renderer/lib/compactView.ts`
- Modify: `desktop/src/preload/index.ts:137` 附近(compactHistory 返回类型)
- Test: `desktop/test/compactView.test.ts`

**Interfaces:**
- Consumes: Task 1 的 RPC 新键 `summarized?: boolean; fallback?: string`。
- Produces: `CompactionView` 增字段;`compactionNotice` 新文案(App 既有调用点零改动——字段可选)。

- [ ] **Step 1: 写失败测试**(compactView.test.ts 追加)

```ts
it('summarized result mentions incremental summary', () =>
  expect(compactionNotice({ compacted: true, beforeTokens: 12300, afterTokens: 4100, summarized: true }))
    .toBe('✅ 已压缩上下文:12.3k → 4.1k tokens(含增量摘要)'))

it('fallback result warns summary unavailable', () =>
  expect(compactionNotice({ compacted: true, beforeTokens: 12300, afterTokens: 9000, summarized: false, fallback: 'emergency' }))
    .toBe('⚠️ 摘要暂不可用,已零成本压缩:12.3k → 9k tokens'))

it('plain compaction text unchanged', () =>
  expect(compactionNotice({ compacted: true, beforeTokens: 12300, afterTokens: 4100 }))
    .toBe('✅ 已压缩上下文:12.3k → 4.1k tokens'))
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/compactView.test.ts`
Expected: FAIL(文案不匹配/类型错)。

- [ ] **Step 3: 实现**

compactView.ts:

```ts
export interface CompactionView {
  compacted: boolean
  beforeTokens: number
  afterTokens: number
  error?: string | null
  summarized?: boolean
  fallback?: string
}

export function compactionNotice(r: CompactionView): string {
  if (r.error) return `❌ 压缩失败:${r.error}`
  if (!r.compacted) return '上下文未超阈值,无需压缩'
  const range = `${formatTokens(r.beforeTokens)} → ${formatTokens(r.afterTokens)} tokens`
  if (r.fallback) return `⚠️ 摘要暂不可用,已零成本压缩:${range}`
  if (r.summarized) return `✅ 已压缩上下文:${range}(含增量摘要)`
  return `✅ 已压缩上下文:${range}`
}
```

preload/index.ts:137 的 compactHistory 返回类型补 `summarized?: boolean; fallback?: string`(声明与实现两处泛型一致)。

- [ ] **Step 4: 跑测试确认通过 + typecheck**

Run: `cd desktop && npx vitest run test/compactView.test.ts && npx tsc --noEmit`
Expected: PASS + 0 错。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/lib/compactView.ts desktop/src/preload/index.ts desktop/test/compactView.test.ts
git commit -m "feat(desktop): 手动压缩文案区分含摘要/零成本兜底,preload补回报字段"
```

---

### Task 3: ContextStateAggregator 抽方法 + ratio 重算 + headless pricingTable

**Files:**
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/ContextStateAggregator.java`
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(①contextState 匿名实现改调聚合器;②runHeadlessTaskAt 的 Agent 装配点补 pricingTable)
- Test: Create `src/test/java/com/lyhn/wraith/runtime/appserver/ContextStateAggregatorTest.java`

**Interfaces:**
- Consumes: 现 Main.java:1260-1294 匿名 runner 里的聚合逻辑(整段迁移,含 Phase B 终审修的 cost 单币聚合)。
- Produces: `public static void merge(Map<String,Object> core, java.nio.file.Path metricsFile, long currentWindow)`——原地增补 core;文件缺失/不可读 → core 原样;**ratio 重算**:`usedTokens = 尾行.usedTokens? 无则以尾行 inputTokens 近似`——注意:metrics usage 行没有 usedTokens 字段,只有 ratio/tier/inputTokens;spec §6 要求"usedTokens 从尾行恢复+ratio 按当前 window 重算"——**以尾行 `inputTokens` 作为 usedTokens 恢复值**(该行的 input 即该次请求真实上下文用量,正是水位分子),`ratio = inputTokens ÷ max(1,currentWindow)`,`tier` 按 0.60/0.80/0.95 对照重算。core 增键 `usedTokens`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.runtime.appserver;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ContextStateAggregatorTest {

    private static Map<String, Object> core() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("estimated", true);
        m.put("estimatedCost", "¥0.0000");
        return m;
    }

    @Test
    void aggregatesUsageAndRecalculatesRatioAgainstCurrentWindow(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, """
                {"ts":1,"step":1,"inputTokens":10000,"outputTokens":100,"cachedInputTokens":2000,"ratio":0.9,"tier":3,"cost":0.5,"currency":"CNY"}
                {"ts":2,"compaction":true,"tier":1,"beforeTokens":9,"afterTokens":5,"snipped":1,"pruned":0,"summarized":false,"durationMs":3}
                bad line not json
                {"ts":3,"step":2,"inputTokens":50000,"outputTokens":200,"cachedInputTokens":40000,"ratio":0.9,"tier":3,"cost":1.5,"currency":"CNY"}
                """);
        Map<String, Object> m = core();
        // 关键:窗口从旧模型 64k 换成 1M——尾行 ratio 0.9 必须按当前窗口重算,不得直取
        ContextStateAggregator.merge(m, f, 1_000_000L);
        assertEquals(60_000L, m.get("inputTokens"));
        assertEquals(300L, m.get("outputTokens"));
        assertEquals(42_000L, m.get("cachedInputTokens"));
        assertEquals(50_000L, m.get("usedTokens"), "usedTokens 从尾行 inputTokens 恢复");
        assertEquals(0.05, (double) m.get("ratio"), 1e-9, "ratio 必须按当前 window 重算");
        assertEquals(0, m.get("tier"), "重算后 5% → tier0,不得沿用尾行 tier3");
        assertEquals(false, m.get("estimated"));
        assertEquals("¥2.0000", m.get("estimatedCost"));
    }

    @Test
    void mixedCurrenciesDropCostKey(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, """
                {"ts":1,"step":1,"inputTokens":100,"outputTokens":1,"cachedInputTokens":0,"ratio":0.1,"tier":0,"cost":0.5,"currency":"CNY"}
                {"ts":2,"step":2,"inputTokens":100,"outputTokens":1,"cachedInputTokens":0,"ratio":0.1,"tier":0,"cost":0.5,"currency":"USD"}
                """);
        Map<String, Object> m = core();
        ContextStateAggregator.merge(m, f, 100_000L);
        assertFalse(m.containsKey("estimatedCost"), "混币宁缺勿虚");
    }

    @Test
    void missingFileLeavesCoreUntouched(@TempDir Path dir) {
        Map<String, Object> m = core();
        Map<String, Object> snapshot = new LinkedHashMap<>(m);
        ContextStateAggregator.merge(m, dir.resolve("nope.jsonl"), 100_000L);
        assertEquals(snapshot, m);
    }

    @Test
    void usageRowsWithoutCostYieldNoCostKey(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("context-metrics.jsonl");
        Files.writeString(f, "{\"ts\":1,\"step\":1,\"inputTokens\":100,\"outputTokens\":1,\"cachedInputTokens\":0,\"ratio\":0.1,\"tier\":0}\n");
        Map<String, Object> m = core();
        ContextStateAggregator.merge(m, f, 100_000L);
        assertFalse(m.containsKey("estimatedCost"));
        assertEquals(false, m.get("estimated"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=ContextStateAggregatorTest`
Expected: FAIL — 类不存在。

- [ ] **Step 3: 实现**

ContextStateAggregator.java(逻辑整段从 Main.java:1260-1294 迁移,差异:ratio/tier/usedTokens 重算、estimatedCost 覆盖或移除):

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * context.state.get 的 metrics JSONL 会话聚合(spec Phase C §5②⑥):
 * usage 行求和(compaction 行/坏行跳过)、成本单币累计(混币/零条缺席——宁缺勿虚)、
 * 尾行恢复 usedTokens 并按**当前** window 重算 ratio/tier(总 spec §6:窗口可能已随换模型改变)。
 * 一切失败原样返回 core,不抛。
 */
public final class ContextStateAggregator {
    private ContextStateAggregator() {}

    public static void merge(Map<String, Object> core, Path metricsFile, long currentWindow) {
        if (metricsFile == null || !Files.isRegularFile(metricsFile)) return;
        try {
            long in = 0, out = 0, cached = 0;
            double costSum = 0;
            Set<String> currencies = new LinkedHashSet<>();
            ObjectMapper om = new ObjectMapper();
            JsonNode last = null;
            for (String line : Files.readAllLines(metricsFile)) {
                if (line.isBlank()) continue;
                try {
                    JsonNode n = om.readTree(line);
                    if (n.has("compaction")) continue;   // 压缩行不计入 usage 累计
                    in += n.path("inputTokens").asLong(0);
                    out += n.path("outputTokens").asLong(0);
                    cached += n.path("cachedInputTokens").asLong(0);
                    if (n.has("cost")) {
                        costSum += n.path("cost").asDouble(0);
                        currencies.add(n.path("currency").asText(""));
                    }
                    last = n;
                } catch (Exception ignored) { /* 坏行跳过 */ }
            }
            if (last == null) return;
            core.put("inputTokens", in);
            core.put("outputTokens", out);
            core.put("cachedInputTokens", cached);
            long used = last.path("inputTokens").asLong(0);   // 该次请求真实上下文用量=水位分子
            double ratio = (double) used / Math.max(1L, currentWindow);
            core.put("usedTokens", used);
            core.put("ratio", ratio);
            core.put("tier", ratio >= 0.95 ? 3 : ratio >= 0.80 ? 2 : ratio >= 0.60 ? 1 : 0);
            core.put("estimated", false);
            if (currencies.size() == 1 && costSum > 0) {
                String symbol = "USD".equalsIgnoreCase(currencies.iterator().next()) ? "$" : "¥";
                core.put("estimatedCost", String.format(Locale.ROOT, "%s%.4f", symbol, costSum));
            } else {
                core.remove("estimatedCost");   // 混币/无 cost 行:宁缺勿虚(core 里 in-process 零值也一并摘除)
            }
        } catch (Exception e) {
            // 聚合失败不影响快照主体
        }
    }
}
```

Main.java contextState 匿名实现整段替换为:

```java
                    public java.util.Map<String, Object> contextState() {
                        java.util.Map<String, Object> m = agent.contextStateCore();
                        long window = m.get("contextWindow") instanceof Number n ? n.longValue() : 0L;
                        sessionStore.artifactDir().ifPresent(dir ->
                                com.lyhn.wraith.runtime.appserver.ContextStateAggregator.merge(
                                        m, dir.resolve("context-metrics.jsonl"), window));
                        return m;
                    }
```

runHeadlessTaskAt 内 Agent 装配点(grep `runHeadlessTaskAt` 定位方法体,找到其中 `new Agent(` 后的装配行)补:

```java
        agent.setPricingTable(new com.lyhn.wraith.context.PricingTable(
                com.lyhn.wraith.config.WraithConfig.load().getPricing()));
```

(`WraithConfig.load()` 已存在于 WraithConfig.java:228;agent 变量名以该处实际代码为准。)

- [ ] **Step 4: 跑测试确认通过 + 全编译**

Run: `mvn test -DskipTests=false -Dtest='ContextStateAggregatorTest,AgentContextStateTest' && mvn -q compile`
Expected: PASS(4+4)+ 0 错。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/ContextStateAggregator.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/ContextStateAggregatorTest.java
git commit -m "feat(appserver): JSONL聚合抽ContextStateAggregator+ratio按当前窗口重算+headless接pricingTable"
```

---

### Task 4: 桌面 reducer context 切片 + contextTier 单一色源 + 入口拉快照补齐

**Files:**
- Create: `desktop/src/shared/contextTier.ts`
- Modify: `desktop/src/shared/transcriptReducer.ts`(TranscriptState 加 context 切片 + 3 个新 case)
- Modify: `desktop/src/renderer/App.tsx`(①既有两处快照 dispatch 追加 `context.snapshot`;②reconnect 与 switchToProject 成功路径补拉快照——共四入口)
- Test: Create `desktop/test/contextObservability.test.ts`

**Interfaces:**
- Consumes: `context.watermark/compaction` 通知(params **平铺**)、`context.state.get` 快照对象(键:usedTokens/window|contextWindow/ratio/tier/estimated/liveSummary/inputTokens/outputTokens/cachedInputTokens/estimatedCost)。
- Produces(Task 5/6 依赖,签名逐字):
  - `contextTier.ts`:`export function tierOf(ratio: number): 0|1|2|3`;`export const TIER_HEX: Record<0|1|2|3,string>`;`export const TIER_LABEL: Record<0|1|2|3,string>`(宽裕/整理/释压/兜底);`export const TIER_TW: Record<0|1|2|3,string>`(tailwind 文本色类:`text-emerald-500`/`text-yellow-500`/`text-orange-500`/`text-red-500`)。
  - reducer **`export interface ContextObservability` 与 `export interface CompactionEntry`**(Task 6 将从 transcriptReducer import 这两个类型,必须 export);`TranscriptState.context: ContextObservability`(接口逐字照 spec §1:watermark/compactions/liveSummary/totalsFromSnapshot;CompactionEntry 含 ts/tier/before/after/snipped/pruned/summarized/fallback?/manual?/savedTokens/items?);初始值 `{ watermark: null, compactions: [], liveSummary: null, totalsFromSnapshot: null }`;compactions 上限 **200**(超出丢最老)。
  - 新 case:`'context.watermark'`(平铺读 usedTokens/window/ratio/tier 覆盖 watermark,estimated=false 语义:该来源即真实)、`'context.compaction'`(平铺读,push CompactionEntry,ts=Date.now())、`'context.snapshot'`(App 合成事件,params=快照对象平铺:初始化 watermark{usedTokens, window: contextWindow 键名适配, ratio, tier}+estimated 标记、liveSummary、totalsFromSnapshot)。
  - `ContextObservability` 里 watermark 加 `estimated: boolean` 字段(snapshot 来源带 estimated,事件来源恒 false)。

- [ ] **Step 1: 探明 reducer 重置语义**

Run: `grep -n "initialState\|function initial\|case 'reset'\|resetSession" desktop/src/shared/transcriptReducer.ts desktop/src/renderer/App.tsx | head -8`
确认切会话时 state 如何回初始(通常 reducer 返回 initialState 或 App 重建 state)。context 切片放进初始 state 后随既有重置路径自动清零;若发现切会话**不**重置整个 state,则在该路径显式清 context 切片——以真实代码为准并在报告写明。

- [ ] **Step 2: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { reducer, initialState } from '../src/shared/transcriptReducer'
import { tierOf } from '../src/shared/contextTier'

const notif = (method: string, params: Record<string, unknown>) =>
  ({ kind: 'notification', method, params }) as never

describe('contextTier', () => {
  it('maps ratio to tier with backend thresholds', () => {
    expect(tierOf(0.2)).toBe(0)
    expect(tierOf(0.6)).toBe(1)
    expect(tierOf(0.8)).toBe(2)
    expect(tierOf(0.95)).toBe(3)
  })
})

describe('context observability slice', () => {
  it('watermark event overwrites and is authoritative', () => {
    let s = reducer(initialState, notif('context.watermark', { usedTokens: 60000, window: 100000, ratio: 0.6, tier: 1 }))
    expect(s.context.watermark).toEqual({ usedTokens: 60000, window: 100000, ratio: 0.6, tier: 1, estimated: false })
  })

  it('compaction events append with cap 200', () => {
    let s = initialState
    for (let i = 0; i < 205; i++) {
      s = reducer(s, notif('context.compaction', {
        tier: 1, beforeTokens: 100, afterTokens: 50, snipped: 1, pruned: 0,
        summarized: false, savedTokens: 50,
      }))
    }
    expect(s.context.compactions.length).toBe(200)
  })

  it('compaction entry keeps fallback and manual flags', () => {
    const s = reducer(initialState, notif('context.compaction', {
      tier: 3, beforeTokens: 100, afterTokens: 90, snipped: 0, pruned: 2,
      summarized: false, fallback: 'emergency', manual: true, savedTokens: 10,
      items: [{ index: 2, tool: 'grep_code', releasedEstTokens: 5 }],
    }))
    const e = s.context.compactions[0]
    expect(e.fallback).toBe('emergency')
    expect(e.manual).toBe(true)
    expect(e.items?.[0].tool).toBe('grep_code')
  })

  it('snapshot initializes watermark(estimated)+liveSummary+totals', () => {
    const s = reducer(initialState, notif('context.snapshot', {
      usedTokens: 15000, contextWindow: 128000, ratio: 0.117, tier: 0, estimated: true,
      liveSummary: '进展:xxx', inputTokens: 18000, outputTokens: 200, cachedInputTokens: 9000,
      estimatedCost: '¥0.09',
    }))
    expect(s.context.watermark?.estimated).toBe(true)
    expect(s.context.watermark?.window).toBe(128000)
    expect(s.context.liveSummary).toBe('进展:xxx')
    expect(s.context.totalsFromSnapshot?.cachedInputTokens).toBe(9000)
  })

  it('real watermark event beats earlier estimated snapshot', () => {
    let s = reducer(initialState, notif('context.snapshot', { usedTokens: 1, contextWindow: 100, ratio: 0.01, tier: 0, estimated: true }))
    s = reducer(s, notif('context.watermark', { usedTokens: 60, window: 100, ratio: 0.6, tier: 1 }))
    expect(s.context.watermark?.estimated).toBe(false)
    expect(s.context.watermark?.ratio).toBe(0.6)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/contextObservability.test.ts`
Expected: FAIL — contextTier 不存在/state.context undefined。

- [ ] **Step 4: 实现**

contextTier.ts:

```ts
/** 四档水位:阈值与后端 WatermarkGauge 一致(0.60/0.80/0.95),色值全端单一来源。 */
export function tierOf(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio >= 0.95) return 3
  if (ratio >= 0.8) return 2
  if (ratio >= 0.6) return 1
  return 0
}
export const TIER_HEX: Record<0 | 1 | 2 | 3, string> = { 0: '#22c55e', 1: '#eab308', 2: '#f97316', 3: '#ef4444' }
export const TIER_LABEL: Record<0 | 1 | 2 | 3, string> = { 0: '宽裕', 1: '整理', 2: '释压', 3: '兜底' }
export const TIER_TW: Record<0 | 1 | 2 | 3, string> = {
  0: 'text-emerald-500', 1: 'text-yellow-500', 2: 'text-orange-500', 3: 'text-red-500',
}
```

transcriptReducer.ts:TranscriptState 加 `context: ContextObservability`(接口定义按 spec §1 逐字,watermark 加 estimated 字段);initialState 加初始值;三个 case(照 'status' case 的容错读法,平铺取 p 顶层键):

```ts
    // ── context 治理可观测(Phase C;payload 平铺,见 EventStreamRenderer.contextEvent)──
    case 'context.watermark': {
      const num = (k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : 0)
      return {
        ...state,
        context: {
          ...state.context,
          watermark: { usedTokens: num('usedTokens'), window: num('window'), ratio: num('ratio'), tier: num('tier'), estimated: false },
        },
      }
    }
    case 'context.compaction': {
      const num = (k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : 0)
      const entry = {
        ts: Date.now(),
        tier: num('tier'), beforeTokens: num('beforeTokens'), afterTokens: num('afterTokens'),
        snipped: num('snipped'), pruned: num('pruned'),
        summarized: p['summarized'] === true,
        ...(typeof p['fallback'] === 'string' ? { fallback: p['fallback'] as 'cooldown' | 'emergency' } : {}),
        ...(p['manual'] === true ? { manual: true } : {}),
        savedTokens: num('savedTokens'),
        ...(Array.isArray(p['items']) ? { items: p['items'] as never } : {}),
      }
      const compactions = [...state.context.compactions, entry].slice(-200)
      return { ...state, context: { ...state.context, compactions } }
    }
    case 'context.snapshot': {
      const num = (k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : 0)
      return {
        ...state,
        context: {
          ...state.context,
          watermark: {
            usedTokens: num('usedTokens'),
            window: num('contextWindow') || num('window'),
            ratio: num('ratio'), tier: num('tier'),
            estimated: p['estimated'] !== false,
          },
          liveSummary: typeof p['liveSummary'] === 'string' ? (p['liveSummary'] as string) : null,
          totalsFromSnapshot: {
            inputTokens: num('inputTokens'), outputTokens: num('outputTokens'),
            cachedInputTokens: num('cachedInputTokens'),
            ...(typeof p['estimatedCost'] === 'string' ? { estimatedCost: p['estimatedCost'] as string } : {}),
            estimated: p['estimated'] !== false,
          },
        },
      }
    }
```

App.tsx:既有两处快照 dispatch(启动 ~L378、commitSwitchTo ~L313)在 status dispatch 后各追加一行:

```ts
          dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
```

reconnect 效果与 switchToProject 成功路径(grep 定位)各加同款完整块(contextState → status 信封 dispatch + context.snapshot dispatch,catch 静默)。

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run: `cd desktop && npx vitest run test/contextObservability.test.ts && npx tsc --noEmit`
Expected: PASS + 0 错。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shared/contextTier.ts desktop/src/shared/transcriptReducer.ts \
        desktop/src/renderer/App.tsx desktop/test/contextObservability.test.ts
git commit -m "feat(desktop): reducer接context.watermark/compaction事件+snapshot合成事件+四档色单一来源,补reconnect/项目切换拉快照"
```

---

### Task 5: StatusChip 四档色+点击 + RightDock 第三分段(pane 状态上提)

**Files:**
- Modify: `desktop/src/renderer/components/StatusChip.tsx`(31 行小文件,整体升级)
- Modify: `desktop/src/renderer/components/Composer.tsx:509` 附近(透传新 props)
- Modify: `desktop/src/renderer/components/RightDock.tsx`(pane 状态上提为受控 + 第三分段 'context')
- Modify: `desktop/src/renderer/App.tsx`(rightDockPane 状态 + StatusChip 点击接线 + ContextPanel 占位)
- Test: `desktop/test/statusChipTier.test.ts`(Create)

**Interfaces:**
- Consumes: Task 4 的 `state.context.watermark`、`tierOf/TIER_TW`。
- Produces:
  - `StatusChip` props 变为 `{ status, watermark, onOpenPanel }`(watermark: `{ ratio: number; tier: number; estimated: boolean } | null`;onOpenPanel: `() => void`)。
  - `RightDock` props 变为 `{ open, cwd, pane, onPaneChange, onClose }`(pane: `'browser' | 'terminal' | 'context'`;内部 useState 删除,分段按钮调 onPaneChange);第三分段渲染 `<ContextPanel …>`(Task 6 实现;本任务先渲染占位 `<div data-testid="context-panel-placeholder" />` 保持可编译,Task 6 替换)。
  - App:`const [rightDockPane, setRightDockPane] = useState<'browser'|'terminal'|'context'>('browser')`;StatusChip 的 `onOpenPanel={() => { setRightDockPane('context'); setRightDockOpen(true) }}`。
  - 纯函数 `chipView(status, watermark)`(StatusChip 内 export,供测试):返回 `{ pct: number, tw: string, suffix: '' | '~' }`——watermark 有值用 `ratio`(suffix 按 estimated),否则回退 `totalTokens/contextWindow` 估算(suffix '~')。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { chipView } from '../src/renderer/components/StatusChip'

describe('chipView', () => {
  const status = { totalTokens: 30000, contextWindow: 100000 } as never
  it('prefers real watermark ratio over estimate', () => {
    const v = chipView(status, { ratio: 0.62, tier: 2, estimated: false })
    expect(v.pct).toBe(62)
    expect(v.tw).toBe('text-orange-500')
    expect(v.suffix).toBe('')
  })
  it('estimated watermark carries tilde', () => {
    expect(chipView(status, { ratio: 0.62, tier: 2, estimated: true }).suffix).toBe('~')
  })
  it('falls back to status estimate with tilde', () => {
    const v = chipView(status, null)
    expect(v.pct).toBe(30)
    expect(v.suffix).toBe('~')
    expect(v.tw).toBe('text-emerald-500')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/statusChipTier.test.ts`
Expected: FAIL — chipView 不导出。

- [ ] **Step 3: 实现**

StatusChip.tsx(保留 Tooltip 明细结构,外层变可点击;新增 chipView):

```tsx
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import type { StatusData } from '../../shared/types'
import { tierOf, TIER_TW } from '../../shared/contextTier'

export interface WatermarkView { ratio: number; tier: number; estimated: boolean }

/** 徽标口径(纯函数,可测):真实水位优先,估算带 ~。 */
export function chipView(
  status: Pick<StatusData, 'totalTokens' | 'contextWindow'>,
  watermark: WatermarkView | null,
): { pct: number; tw: string; suffix: '' | '~' } {
  if (watermark) {
    const pct = Math.min(100, Math.round(watermark.ratio * 100))
    return { pct, tw: TIER_TW[tierOf(watermark.ratio)], suffix: watermark.estimated ? '~' : '' }
  }
  const ratio = status.contextWindow > 0 ? status.totalTokens / status.contextWindow : 0
  return { pct: Math.min(100, Math.round(ratio * 100)), tw: TIER_TW[tierOf(ratio)], suffix: '~' }
}

export default function StatusChip({ status, watermark, onOpenPanel }: {
  status: StatusData | null | undefined
  watermark: WatermarkView | null
  onOpenPanel?: () => void
}): JSX.Element | null {
  if (!status || status.contextWindow <= 0) return null
  const v = chipView(status, watermark)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-testid="status-chip"
          onClick={onOpenPanel}
          className={`shrink-0 cursor-pointer whitespace-nowrap rounded-lg border border-border px-2 py-1 text-xs ${v.tw}`}
        >
          ◓ {v.pct}%{v.suffix}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {/* 原 tooltip 明细三行原样保留 */}
      </TooltipContent>
    </Tooltip>
  )
}
```

(TooltipContent 内原三行明细逐字保留,别删。)

Composer.tsx:509:`<StatusChip status={status} watermark={watermark} onOpenPanel={onOpenContextPanel} />`——Composer props 加 `watermark`/`onOpenContextPanel` 透传(类型照上;App 传入)。

RightDock.tsx:删内部 `useState pane`,props 加 `pane`/`onPaneChange`;seg 按钮 onClick 改 `onPaneChange(id)`;加第三分段与第三面板:

```tsx
          {seg('context', '上下文')}
          …
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'context' ? '' : 'hidden')}>
            <div data-testid="context-panel-placeholder" />
          </div>
```

(seg 的 id 联合类型扩为 `'browser' | 'terminal' | 'context'`。)

App.tsx:`rightDockPane` 状态、RightDock 传参、Composer 传 `watermark={state.context.watermark}` 与 `onOpenContextPanel`。

- [ ] **Step 4: 跑测试确认通过 + typecheck + vitest 全量**

Run: `cd desktop && npx vitest run test/statusChipTier.test.ts && npx tsc --noEmit && npx vitest run`
Expected: 新测试 PASS;tsc 0;既有 RightDock/Composer 相关测试若因 props 变化红了,修到绿(以行为不变为准)。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/StatusChip.tsx desktop/src/renderer/components/Composer.tsx \
        desktop/src/renderer/components/RightDock.tsx desktop/src/renderer/App.tsx desktop/test/statusChipTier.test.ts
git commit -m "feat(desktop): StatusChip四档色+真实水位口径+点击开面板,RightDock第三分段(pane受控上提)"
```

---

### Task 6: ContextPanel 组件

**Files:**
- Create: `desktop/src/renderer/components/ContextPanel.tsx`
- Create: `desktop/src/renderer/lib/contextPanelView.ts`(纯函数:面板数据拼装,可测)
- Modify: `desktop/src/renderer/components/RightDock.tsx`(占位换真组件)
- Modify: `desktop/src/renderer/App.tsx`(RightDock 传 context 数据与手动压缩回调)
- Test: `desktop/test/contextPanelView.test.ts`(Create)

**Interfaces:**
- Consumes: `state.context`(Task 4)、`state.status`(累计口径优先)、`tierOf/TIER_HEX/TIER_LABEL`、`formatTokens`(compactView.ts 已有)、手动压缩回调(App 里既有 compactHistory 调用逻辑复用)。
- Produces:
  - `contextPanelView.ts`:
    - `export function totalsView(status, totalsFromSnapshot): { input: number; output: number; cached: number; cost: string | null; hitRate: string }`——spec §3 口径:status 有数据(totalTokens>0 或 inputTokens>0)优先,否则 snapshot;hitRate = cached/input 百分比字符串,分母 0 → `'—'`;cost 无值 → null。
    - `export function compactionLine(e: CompactionEntry): string`——`T{tier} {动作} {before}→{after}`;动作 = summarized?'摘要':fallback==='emergency'?'兜底':fallback==='cooldown'?'冷却':`snip×${snipped}${pruned?` prune×${pruned}`:''}`;manual 前缀 `手动 `。
    - `export function savedTotal(compactions): number`(savedTokens 求和)。
  - `ContextPanel` props:`{ context: ContextObservability; status: StatusData | null; onCompact: () => void }`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { totalsView, compactionLine, savedTotal } from '../src/renderer/lib/contextPanelView'

describe('totalsView', () => {
  it('prefers live status over snapshot', () => {
    const v = totalsView(
      { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 400, estimatedCost: '¥0.10', totalTokens: 1, contextWindow: 1 } as never,
      { inputTokens: 9, outputTokens: 9, cachedInputTokens: 9, estimated: true },
    )
    expect(v.input).toBe(1000)
    expect(v.hitRate).toBe('40%')
    expect(v.cost).toBe('¥0.10')
  })
  it('falls back to snapshot when status empty', () => {
    const v = totalsView(
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCost: null, totalTokens: 0, contextWindow: 1 } as never,
      { inputTokens: 500, outputTokens: 5, cachedInputTokens: 100, estimatedCost: '¥0.05', estimated: false },
    )
    expect(v.input).toBe(500)
    expect(v.hitRate).toBe('20%')
    expect(v.cost).toBe('¥0.05')
  })
  it('zero denominator yields em-dash and null cost stays null', () => {
    const v = totalsView({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCost: null, totalTokens: 0, contextWindow: 1 } as never, null)
    expect(v.hitRate).toBe('—')
    expect(v.cost).toBeNull()
  })
})

describe('compactionLine', () => {
  const base = { ts: 0, tier: 1, beforeTokens: 12300, afterTokens: 9000, snipped: 3, pruned: 0, summarized: false, savedTokens: 3300 }
  it('renders snip line', () => expect(compactionLine(base as never)).toBe('T1 snip×3 12.3k→9k'))
  it('renders summary line', () =>
    expect(compactionLine({ ...base, tier: 3, summarized: true } as never)).toBe('T3 摘要 12.3k→9k'))
  it('renders manual emergency line', () =>
    expect(compactionLine({ ...base, tier: 3, fallback: 'emergency', manual: true } as never)).toBe('手动 T3 兜底 12.3k→9k'))
})

describe('savedTotal', () => {
  it('sums savedTokens', () =>
    expect(savedTotal([{ savedTokens: 10 }, { savedTokens: 5 }] as never)).toBe(15))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/contextPanelView.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

contextPanelView.ts:

```ts
import { formatTokens } from './compactView'
import type { CompactionEntry, ContextObservability } from '../../shared/transcriptReducer'
import type { StatusData } from '../../shared/types'

export function totalsView(
  status: StatusData | null,
  snap: ContextObservability['totalsFromSnapshot'],
): { input: number; output: number; cached: number; cost: string | null; hitRate: string } {
  const live = status && (status.inputTokens > 0 || status.totalTokens > 0)
  const input = live ? status.inputTokens : snap?.inputTokens ?? 0
  const output = live ? status.outputTokens : snap?.outputTokens ?? 0
  const cached = live ? status.cachedInputTokens : snap?.cachedInputTokens ?? 0
  const cost = live ? status.estimatedCost ?? snap?.estimatedCost ?? null : snap?.estimatedCost ?? null
  const hitRate = input > 0 ? Math.round((cached / input) * 100) + '%' : '—'
  return { input, output, cached, cost, hitRate }
}

export function compactionLine(e: CompactionEntry): string {
  const action = e.summarized ? '摘要'
    : e.fallback === 'emergency' ? '兜底'
    : e.fallback === 'cooldown' ? '冷却'
    : `snip×${e.snipped}${e.pruned ? ` prune×${e.pruned}` : ''}`
  const prefix = e.manual ? '手动 ' : ''
  return `${prefix}T${e.tier} ${action} ${formatTokens(e.beforeTokens)}→${formatTokens(e.afterTokens)}`
}

export function savedTotal(compactions: CompactionEntry[]): number {
  return compactions.reduce((a, e) => a + Math.max(0, e.savedTokens), 0)
}
```

ContextPanel.tsx(组件;样式类照 RightDock 内既有 pane 的 tailwind 惯例):

```tsx
import { useState } from 'react'
import type { ContextObservability } from '../../shared/transcriptReducer'
import type { StatusData } from '../../shared/types'
import { tierOf, TIER_HEX, TIER_LABEL } from '../../shared/contextTier'
import { formatTokens } from '../lib/compactView'
import { totalsView, compactionLine, savedTotal } from '../lib/contextPanelView'

/** 上下文治理面板(spec Phase C §3):水位/累计/压缩历史/活摘要预览/手动压缩。 */
export default function ContextPanel({ context, status, onCompact }: {
  context: ContextObservability
  status: StatusData | null
  onCompact: () => void
}): JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [pricingHintDismissed, setPricingHintDismissed] = useState(false)
  const w = context.watermark
  const tier = w ? tierOf(w.ratio) : 0
  const totals = totalsView(status, context.totalsFromSnapshot)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
      {/* 水位区 */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-medium">上下文水位</span>
          <span style={{ color: TIER_HEX[tier] }}>{TIER_LABEL[tier]}{w?.estimated ? '(估算)' : ''}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-border">
          <div className="h-full rounded" style={{
            width: `${w ? Math.min(100, Math.round(w.ratio * 100)) : 0}%`,
            backgroundColor: TIER_HEX[tier],
          }} />
        </div>
        <div className="mt-1 text-fg-muted">
          {w ? `${formatTokens(w.usedTokens)} / ${formatTokens(w.window)}(${Math.min(100, Math.round(w.ratio * 100))}%)` : '暂无数据'}
        </div>
      </div>
      {/* 累计区 */}
      <div className="grid grid-cols-2 gap-1 text-fg-muted">
        <span>累计节省</span><span>{formatTokens(savedTotal(context.compactions))} tokens(估算)</span>
        <span>cache 命中</span><span>{totals.hitRate}</span>
        <span>输入/输出</span><span>{formatTokens(totals.input)} / {formatTokens(totals.output)}</span>
        <span>成本</span><span>{totals.cost ?? '—'}</span>
      </div>
      {totals.cost === null && !pricingHintDismissed && (
        <div className="rounded border border-border p-2 text-fg-muted">
          该模型未配置价格,在 config.json 的 pricing 里加一条即可显示成本
          <button className="ml-2 underline" onClick={() => setPricingHintDismissed(true)}>知道了</button>
        </div>
      )}
      {/* 压缩历史 */}
      <div>
        <div className="mb-1 font-medium">压缩历史</div>
        {context.compactions.length === 0 && <div className="text-fg-muted">本会话尚无压缩</div>}
        {context.compactions.map((e, i) => (
          <div key={i}>
            <button className="w-full text-left hover:bg-surface/60"
              onClick={() => setExpanded(expanded === i ? null : i)}>
              <span style={{ color: TIER_HEX[(e.tier >= 0 && e.tier <= 3 ? e.tier : 0) as 0 | 1 | 2 | 3] }}>●</span>{' '}
              {compactionLine(e)}
            </button>
            {expanded === i && e.items && (
              <ul className="ml-4 text-fg-muted">
                {e.items.map((it, j) => (
                  <li key={j}>{it.tool ?? 'user'} −{formatTokens(it.releasedEstTokens)}{it.logPath ? ` · ${it.logPath}` : ''}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {/* 活摘要预览 */}
      <div>
        <div className="mb-1 font-medium">活摘要</div>
        {context.liveSummary
          ? <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border p-2 font-mono text-2xs">{context.liveSummary}</pre>
          : <div className="text-fg-muted">尚未生成活摘要</div>}
      </div>
      {/* 手动压缩 */}
      <button data-testid="context-panel-compact" onClick={onCompact}
        className="rounded border border-border px-2 py-1 hover:bg-surface/60">立即压缩</button>
    </div>
  )
}
```

RightDock 第三面板占位换 `<ContextPanel context={context} status={status} onCompact={onCompact} />`(RightDock props 加 `context/status/onCompact` 透传;App 传 `state.context`/`state.status`/既有手动压缩 handler——grep App.tsx 里现有 compactHistory 按钮的 onClick 逻辑复用同一函数)。

- [ ] **Step 4: 跑测试确认通过 + typecheck + vitest 全量**

Run: `cd desktop && npx vitest run test/contextPanelView.test.ts && npx tsc --noEmit && npx vitest run`
Expected: PASS + 0 错 + 基线不降。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/ContextPanel.tsx desktop/src/renderer/lib/contextPanelView.ts \
        desktop/src/renderer/components/RightDock.tsx desktop/src/renderer/App.tsx desktop/test/contextPanelView.test.ts
git commit -m "feat(desktop): ContextPanel——水位条/累计/压缩历史可展开/活摘要预览/手动压缩,未配价一次性提示"
```

---

### Task 7: TUI tier 徽标(BottomStatusBar)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/render/inline/BottomStatusBar.java`(contextSegment 处)
- Test: 既有 BottomStatusBar 测试文件追加(`grep -rln "BottomStatusBar" src/test/` 定位;无则新建 `src/test/java/com/lyhn/wraith/render/inline/BottomStatusBarTierTest.java`)

**Interfaces:**
- Consumes: `contextGauge(StatusInfo)`(已有,percent 字段)。
- Produces: `static String tierBadge(int percent)`(包可见,供测试):percent<60 → `""`;否则 ANSI 色 `●` + 标签 + 复位——`60-79 "\u001B[33m● 整理\u001B[0m"` / `80-94 "\u001B[38;5;208m● 释压\u001B[0m"` / `≥95 "\u001B[31m● 兜底\u001B[0m"`。`contextSegment` 前缀拼接(badge 非空时 badge+空格)。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.render.inline;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class BottomStatusBarTierTest {

    @Test
    void tier0IsSilent() {
        assertEquals("", BottomStatusBar.tierBadge(59));
    }

    @Test
    void tiersCarryAnsiColorAndLabel() {
        assertEquals("\u001B[33m● 整理\u001B[0m", BottomStatusBar.tierBadge(60));
        assertEquals("\u001B[38;5;208m● 释压\u001B[0m", BottomStatusBar.tierBadge(80));
        assertEquals("\u001B[31m● 兜底\u001B[0m", BottomStatusBar.tierBadge(95));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=BottomStatusBarTierTest`
Expected: FAIL — tierBadge 不存在。

- [ ] **Step 3: 实现**

```java
    /** tier 徽标(spec Phase C §6):tier0 不加噪音;阈值与 WatermarkGauge 一致(60/80/95)。 */
    static String tierBadge(int percent) {
        if (percent >= 95) return "\u001B[31m● 兜底\u001B[0m";
        if (percent >= 80) return "\u001B[38;5;208m● 释压\u001B[0m";
        if (percent >= 60) return "\u001B[33m● 整理\u001B[0m";
        return "";
    }
```

`contextSegment` 返回处改:

```java
        String badge = tierBadge(gauge.percent());
        return (badge.isEmpty() ? "" : badge + " ") + "ctx " + bar + " " + gauge.percent() + "% ("
                + formatTokens(gauge.total()) + "/" + formatTokens(gauge.window()) + ")";
```

- [ ] **Step 4: 跑测试确认通过**(既有 BottomStatusBar 测试若断言 contextSegment 全文,percent≥60 的用例会红——按新语义修)

Run: `mvn test -DskipTests=false -Dtest='BottomStatusBarTierTest,*BottomStatus*'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/render/inline/BottomStatusBar.java src/test/java/com/lyhn/wraith/render/inline/
git commit -m "feat(tui): BottomStatusBar tier徽标——四档ANSI色,tier0静默"
```

---

### Task 8: 全量回归收尾

**Files:** 无新改动(只跑验证;红了修到绿)。

- [ ] **Step 1: Java 全量**

Run: `mvn test -DskipTests=false`
Expected: `Tests run: ≥1537, Failures: 0, Errors: 0`(1527 基线 + 本计划新增 ~10+),`BUILD SUCCESS`,贴 Results 总行。

- [ ] **Step 2: desktop 全量**

Run: `cd desktop && npx tsc --noEmit && npx vitest run`
Expected: 0 错;vitest ≥678 全过(新增 ~14),贴总行。

- [ ] **Step 3: 回退开关抽查**

Run: `mvn test -DskipTests=false -Dtest='ConversationHistoryCompactorTest,ContextCuratorTest'`
Expected: PASS(legacy 与 curator 两路径均绿)。

- [ ] **Step 4: Commit(若 Step1-3 触发过修复)**

```bash
git add -A src/ desktop/src/ desktop/test/
git commit -m "fix(phase-c): 全量回归修复"
```

(零修复则跳过本步。)

---

## 完成定义

- Java 全量 0 失败、desktop tsc 0、vitest 基线不降。
- 真机眼验(用户):StatusChip 随水位变四档色且可点开面板;面板显示水位条/累计/压缩历史(触发一次压缩后有行)/活摘要;手动压缩文案区分"含增量摘要/零成本兜底";TUI tier≥1 显徽标。
