# ContextCurator Phase B 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tier3 增量活摘要替代 legacy 代位 + 防-兜-报失败处理 + 校准估算/精确计价 + per-model 键控 + `context.state.get` 状态快照(修"重启空白/换模型不刷新")。

**Architecture:** 全部落在既有 `com.lyhn.wraith.context.curator` 包与 Agent/AppServer 接线点上:`IncrementalSummarizer`(LlmClient 注入、mark 定位、delta 分批)内化进 `ContextCurator` tier3;`PrunePass` 参数化 EMERGENCY 档做确定性兜底;`CalibratedTokenCounter` per-model EMA 校准估算;`PricingTable` 收口成本计算;快照 RPC 走 SessionRunner 默认方法模式。

**Tech Stack:** Java 17 / Maven / JUnit5(测试默认跳过,须 `-DskipTests=false`);桌面 Electron+React+TS(vitest)。

**Spec:** `docs/superpowers/specs/2026-07-17-context-curator-phase-b-design.md`(§引用均指此文件)

## Global Constraints

- 测试红线:一律 `@TempDir`,**绝不写真实 `~/.wraith`/config/会话目录**。
- 密钥红线:密钥只存 `~/.wraith/config.json`,绝不进日志/RPC/renderer;curator 路径异常日志**只报异常类名**(`e.getClass().getSimpleName()`)。
- 压缩红线(总 spec §5,任何档不破):保护区内一切 / 用户纯文本(仅代码块可截)/ system / 保护名单工具输出 / 活摘要。
- 单调性:一切改写带尾标(`⟦wraith:snip⟧`/`⟦wraith:prune⟧`/`⟦wraith:summary⟧`),见标跳过,同一 history 跑两遍第二遍零变更。
- 跑测试:`mvn test -DskipTests=false`(可加 `-Dtest=XxxTest`);全量基线 **1492/0F/0E**,任务完成后不得有新增失败。
- 系统属性旋钮统一 `wraith.context.*` 前缀,读取风格照 `WatermarkGauge.threshold()`。
- 中文注释/日志,风格与包内现有代码一致。
- 提交信息尾部两行:`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- **push 需用户单独点头**,任务只 commit 不 push。

---

### Task 1: SUMMARY_MARK 与两个 pass 的活摘要红线

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/context/curator/CurationMarks.java`
- Modify: `src/main/java/com/lyhn/wraith/context/curator/SnipPass.java:35`
- Modify: `src/main/java/com/lyhn/wraith/context/curator/PrunePass.java:30`
- Test: `src/test/java/com/lyhn/wraith/context/curator/SnipPassTest.java`、`PrunePassTest.java`

**Interfaces:**
- Produces: `CurationMarks.SUMMARY_MARK`(常量 `"⟦wraith:summary⟧"`),后续 Task 4/8 依赖。

- [ ] **Step 1: 写失败测试**(两个测试类各加一个)

SnipPassTest 追加:

```java
@Test
void skipsLiveSummaryMessageEntirely() {
    // 活摘要是 user 消息且可能含大代码块;snip 见 SUMMARY_MARK 必须整条跳过
    String big = "```java\n" + "int x = 1;\n".repeat(100) + "```";
    List<Message> h = new ArrayList<>(List.of(
            Message.system("sys"),
            Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\n" + big),
            Message.user("q1"), Message.assistant("a1"),
            Message.user("q2"), Message.assistant("a2")));
    SnipPass.Result r = SnipPass.apply(h, h.size(), new ToolTierPolicy(), Long.MAX_VALUE);
    assertTrue(h.get(1).content().contains("int x = 1;"), "活摘要内容不得被截");
    assertTrue(r.changes().stream().noneMatch(c -> c.index() == 1));
}
```

PrunePassTest 追加:

```java
@Test
void skipsMessageCarryingSummaryMark() {
    // 防御:任何带 SUMMARY_MARK 的消息(即使 assistant 长文)prune 不碰
    String longText = ("句子。").repeat(400) + CurationMarks.SUMMARY_MARK;
    List<Message> h = new ArrayList<>(List.of(
            Message.system("sys"),
            Message.assistant(longText),
            Message.user("q1"), Message.assistant("a1"),
            Message.user("q2"), Message.assistant("a2")));
    SnipPass.Result r = PrunePass.apply(h, h.size(), new ToolTierPolicy(), Long.MAX_VALUE);
    assertEquals(longText, h.get(1).content());
    assertTrue(r.changes().isEmpty());
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest='SnipPassTest,PrunePassTest'`
Expected: FAIL — `SUMMARY_MARK` 符号不存在(编译错)。

- [ ] **Step 3: 最小实现**

CurationMarks.java 加常量(SNIP/PRUNE 之后):

```java
    /** 活摘要消息标识:pass 见标整条跳过;summarizer 靠它定位替换。 */
    public static final String SUMMARY_MARK = "⟦wraith:summary⟧";
```

SnipPass.java L35 原 `if (content == null || content.contains(CurationMarks.SNIP_MARK)) continue;` 改为:

```java
            if (content == null || content.contains(CurationMarks.SNIP_MARK)
                    || content.contains(CurationMarks.SUMMARY_MARK)) continue;
```

PrunePass.java L30 原 `if (content == null || content.contains(CurationMarks.PRUNE_MARK)) continue;` 改为:

```java
            if (content == null || content.contains(CurationMarks.PRUNE_MARK)
                    || content.contains(CurationMarks.SUMMARY_MARK)) continue;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest='SnipPassTest,PrunePassTest'`
Expected: PASS(原有 6+3 个 + 新 2 个)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/CurationMarks.java \
        src/main/java/com/lyhn/wraith/context/curator/SnipPass.java \
        src/main/java/com/lyhn/wraith/context/curator/PrunePass.java \
        src/test/java/com/lyhn/wraith/context/curator/SnipPassTest.java \
        src/test/java/com/lyhn/wraith/context/curator/PrunePassTest.java
git commit -m "feat(curator): SUMMARY_MARK 活摘要标识+两 pass 见标跳过红线"
```

---

### Task 2: PrunePass EMERGENCY 档(确定性兜底的肌肉)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/context/curator/PrunePass.java`
- Modify: `src/main/java/com/lyhn/wraith/context/curator/ToolTierPolicy.java`
- Test: `src/test/java/com/lyhn/wraith/context/curator/PrunePassTest.java`

**Interfaces:**
- Consumes: Task 1 的 SUMMARY_MARK 跳过逻辑。
- Produces: `PrunePass.Mode`(enum `NORMAL, EMERGENCY`)与重载 `PrunePass.apply(List<Message>, int, ToolTierPolicy, long, Mode)`;`ToolTierPolicy.ASSISTANT_EMERGENCY_MIN_CHARS = 200`、`ToolTierPolicy.EMERGENCY_TOOL_MIN_CHARS = 80`。Task 5 依赖。

- [ ] **Step 1: 写失败测试**

PrunePassTest 追加(需要 tool 消息带 toolCalls 映射,照该文件既有用例构造 assistant(toolCalls)+tool 对;若该文件已有辅助方法直接复用):

```java
@Test
void emergencyPrunesUnsnippedSmallToolOutputs() {
    // 500 字符工具输出:不够 SNIP_MIN_CHARS(1500)永远不会被 snip,常规 prune 也不碰;
    // EMERGENCY 必须能压成占位符——这是 tier3 失败兜底的真实增量空间
    List<LlmClient.ToolCall> tcs = List.of(new LlmClient.ToolCall("c1",
            new LlmClient.ToolCall.Function("grep_code", "{}")));
    List<Message> h = new ArrayList<>(List.of(
            Message.system("sys"),
            Message.assistant(null, null, tcs),
            Message.tool("c1", "x".repeat(500)),
            Message.user("q1"), Message.assistant("a1"),
            Message.user("q2"), Message.assistant("a2")));
    // 常规档不动它
    SnipPass.Result normal = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE);
    assertTrue(normal.changes().isEmpty());
    // EMERGENCY 压掉
    SnipPass.Result em = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
    assertEquals(1, em.changes().size());
    assertTrue(h.get(2).content().contains(CurationMarks.PRUNE_MARK));
    // 单调:第二遍零变更
    SnipPass.Result again = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
    assertTrue(again.changes().isEmpty());
}

@Test
void emergencyPrunesShorterAssistantButKeepsRedlines() {
    List<Message> h = new ArrayList<>(List.of(
            Message.system("sys"),
            Message.assistant("这是一段三百字的助手输出。" + "补充内容。".repeat(60)),  // >200 chars, <1200 chars
            Message.user("用户纯文本,一字不动"),
            Message.user("q2"), Message.assistant("a2"),
            Message.user("q3"), Message.assistant("a3")));
    SnipPass.Result em = PrunePass.apply(h, 3, new ToolTierPolicy(), Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
    assertTrue(h.get(1).content().contains(CurationMarks.PRUNE_MARK), "300字 assistant 在 EMERGENCY 应被裁");
    assertEquals("用户纯文本,一字不动", h.get(2).content(), "用户纯文本任何档不动");
    assertEquals(1, em.changes().size());
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=PrunePassTest`
Expected: FAIL — `Mode` 符号不存在。

- [ ] **Step 3: 实现**

ToolTierPolicy.java 加两常量(既有常量之后):

```java
    /** EMERGENCY 档(tier3 摘要失败兜底):assistant 裁剪阈值大幅下调。 */
    public static final int ASSISTANT_EMERGENCY_MIN_CHARS = 200;
    /** EMERGENCY 档:工具输出超过此长度即占位(占位符自身 ~几十字符,再短无收益)。 */
    public static final int EMERGENCY_TOOL_MIN_CHARS = 80;
```

PrunePass.java:加 `Mode` 枚举、保留 4 参重载委托 NORMAL、循环内按档分流:

```java
public final class PrunePass {
    /** NORMAL=常规(只压已 snip 的工具输出);EMERGENCY=tier3 摘要失败兜底(零 LLM 强压)。 */
    public enum Mode { NORMAL, EMERGENCY }
```

`apply` 改为:

```java
    public static SnipPass.Result apply(List<Message> history, int protectedFrom,
                                        ToolTierPolicy policy, long releaseTarget) {
        return apply(history, protectedFrom, policy, releaseTarget, Mode.NORMAL);
    }

    public static SnipPass.Result apply(List<Message> history, int protectedFrom,
                                        ToolTierPolicy policy, long releaseTarget, Mode mode) {
```

循环体内两处判断改为(其余不动;红线检查在 Task 1 已加的 SUMMARY_MARK 行,继续生效):

```java
            boolean emergency = mode == Mode.EMERGENCY;
            if ("tool".equals(m.role())
                    && (content.contains(CurationMarks.SNIP_MARK)
                        || (emergency && content.length() > ToolTierPolicy.EMERGENCY_TOOL_MIN_CHARS))) {
                // ……原 tool 分支内容原样(占位符+保留指针行)
            } else if ("assistant".equals(m.role())
                    && content.length() > (emergency
                        ? ToolTierPolicy.ASSISTANT_EMERGENCY_MIN_CHARS
                        : ToolTierPolicy.ASSISTANT_PRUNE_MIN_CHARS)) {
                // ……原 assistant 分支内容原样
            }
```

注意:`boolean emergency` 声明放循环体首行(`Message m = history.get(i);` 之前或之后均可,只要在两分支前)。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=PrunePassTest`
Expected: PASS(原 3 + Task1 的 1 + 新 2 = 6)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/PrunePass.java \
        src/main/java/com/lyhn/wraith/context/curator/ToolTierPolicy.java \
        src/test/java/com/lyhn/wraith/context/curator/PrunePassTest.java
git commit -m "feat(curator): PrunePass EMERGENCY 档——未snip小工具输出+短assistant确定性强压,红线单调不变"
```

---

### Task 3: CalibratedTokenCounter + WatermarkGauge per-model 锚点

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/CalibratedTokenCounter.java`
- Modify: `src/main/java/com/lyhn/wraith/context/curator/WatermarkGauge.java`
- Modify: `src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java`(onUsage/curate 换校准估算+模型键)
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java:75-84`(构造传 modelSupplier)
- Test: Create `src/test/java/com/lyhn/wraith/context/curator/CalibratedTokenCounterTest.java`;Modify `WatermarkGaugeTest.java`、`ContextCuratorTest.java:29`

**Interfaces:**
- Produces:
  - `TokenCounter` 接口(spec §3 承诺的抽象,将来精确 tokenizer 可插):`long estimate(String modelKey, List<Message> messages)`、`void calibrate(String modelKey, long realInput, long rawEstimateAtCall)`、`double factor(String modelKey)`。
  - `CalibratedTokenCounter implements TokenCounter`(默认实现,EMA 校准)。
  - `WatermarkGauge.onRealUsage(String modelKey, long inputTokens, long historyEstimateAtCall)`、`WatermarkGauge.read(String modelKey, long historyEstimateNow)`(旧 2 参方法删除,调用方全在 curator 内)。
  - `ContextCurator` 构造签名:`ContextCurator(LongSupplier windowSupplier, Supplier<String> modelSupplier, ToolTierPolicy policy, CurationSink sink, BiConsumer<String,Map<String,Object>> eventOut)`。
- Task 4/5 依赖 counter 与新构造签名。

- [ ] **Step 1: 写失败测试**

新建 CalibratedTokenCounterTest.java:

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CalibratedTokenCounterTest {

    @Test
    void convergesTowardRealDensity() {
        CalibratedTokenCounter c = new CalibratedTokenCounter();
        List<Message> h = List.of(Message.user("中英 mixed content 一段话"));
        long raw = TokenBudget.estimateMessagesTokens(h);
        // 真实一直是估算的 1.5 倍 → 系数应向 1.5 收敛
        for (int i = 0; i < 20; i++) c.calibrate("deepseek-chat", Math.round(raw * 1.5), raw);
        assertEquals(1.5, c.factor("deepseek-chat"), 0.1);
        assertEquals(Math.round(raw * c.factor("deepseek-chat")), c.estimate("deepseek-chat", h));
    }

    @Test
    void modelsAreIsolated() {
        CalibratedTokenCounter c = new CalibratedTokenCounter();
        for (int i = 0; i < 20; i++) c.calibrate("deepseek-chat", 300, 100);
        assertEquals(1.0, c.factor("kimi-k2"), 1e-9, "未校准模型必须保持初始系数");
    }

    @Test
    void clampsAbsurdObservations() {
        CalibratedTokenCounter c = new CalibratedTokenCounter();
        for (int i = 0; i < 50; i++) c.calibrate("m", 100_000, 1); // 观测比 10万,须被钳制
        assertTrue(c.factor("m") <= 3.0);
        c.calibrate("m2", 0, 100);   // 非法输入忽略
        c.calibrate("m3", 100, 0);
        assertEquals(1.0, c.factor("m2"), 1e-9);
        assertEquals(1.0, c.factor("m3"), 1e-9);
    }
}
```

WatermarkGaugeTest.java:既有 4 个测试的 `onRealUsage(...)`/`read(...)` 调用全部加首参 `"m"`(同一模型),并追加:

```java
@Test
void anchorInvalidatesOnModelSwitch() {
    WatermarkGauge g = new WatermarkGauge(() -> 100_000);
    g.onRealUsage("deepseek-chat", 90_000, 50_000);   // 旧模型锚:真实 90k
    // 切到新模型:锚点失效,只能用估算 → used=估算值而非 90k+diff
    WatermarkGauge.Reading r = g.read("kimi-k2", 30_000);
    assertEquals(30_000, r.usedTokens());
    // 切回旧模型:锚仍有效
    WatermarkGauge.Reading back = g.read("deepseek-chat", 50_000);
    assertEquals(90_000, back.usedTokens());
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest='CalibratedTokenCounterTest,WatermarkGaugeTest'`
Expected: FAIL(类不存在/签名不匹配编译错)。

- [ ] **Step 3: 实现**

新建同包 TokenCounter.java(5 行接口):

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import java.util.List;

/** 事前 token 计数抽象(spec §3):默认校准估算;将来精确 tokenizer 作为另一实现可插。 */
public interface TokenCounter {
    long estimate(String modelKey, List<Message> messages);
    void calibrate(String modelKey, long realInput, long rawEstimateAtCall);
    double factor(String modelKey);
}
```

新建 CalibratedTokenCounter.java(`public final class CalibratedTokenCounter implements TokenCounter`,方法加 `@Override`):

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 校准估算 token 计数(spec §3):静态字符估算 × per-model EMA 校准系数。
 * 每次真实 usage 到来用 真实input÷当时原始估算 更新系数,修正 30-50% 系统性偏差;
 * 事前量(切批预算/释放目标/差分)全走这里。事前 100% 精确不存在——请求总量
 * 含 chat template/tools schema,只有 API usage 知道,触发判断仍以真实锚点为准。
 */
public final class CalibratedTokenCounter {
    private static final double ALPHA = 0.3;          // EMA 平滑
    private static final double MIN_F = 0.5, MAX_F = 3.0;  // 钳制荒谬观测

    private final Map<String, Double> factors = new ConcurrentHashMap<>();

    public long estimate(String modelKey, List<Message> messages) {
        long raw = TokenBudget.estimateMessagesTokens(messages);
        return Math.round(raw * factor(modelKey));
    }

    public double factor(String modelKey) {
        return factors.getOrDefault(key(modelKey), 1.0);
    }

    public void calibrate(String modelKey, long realInput, long rawEstimateAtCall) {
        if (realInput <= 0 || rawEstimateAtCall <= 0) return;
        double obs = Math.max(MIN_F, Math.min(MAX_F, (double) realInput / rawEstimateAtCall));
        factors.merge(key(modelKey), obs, (old, o) -> old + ALPHA * (o - old));
    }

    private static String key(String m) { return m == null ? "?" : m; }
}
```

WatermarkGauge.java:字段加 `private String anchorModel;`,两方法改签名:

```java
    /** LLM 响应到达时调用:真实 inputTokens + 该次调用前 history 的(校准)估算值 + 所属模型。 */
    public synchronized void onRealUsage(String modelKey, long inputTokens, long historyEstimateAtCall) {
        if (inputTokens <= 0) return;
        this.lastRealInput = inputTokens;
        this.estimateAtReal = historyEstimateAtCall;
        this.anchorModel = modelKey;
    }

    public synchronized Reading read(String modelKey, long historyEstimateNow) {
        long window = Math.max(1, windowSupplier.getAsLong());
        boolean anchored = lastRealInput >= 0
                && anchorModel != null && anchorModel.equals(modelKey);
        long used = !anchored
                ? historyEstimateNow
                : Math.max(0, lastRealInput + (historyEstimateNow - estimateAtReal));
        double ratio = (double) used / window;
        int tier = ratio >= TIER3 ? 3 : ratio >= TIER2 ? 2 : ratio >= TIER1 ? 1 : 0;
        return new Reading(used, window, ratio, tier);
    }
```

ContextCurator.java:字段加 `private final Supplier<String> modelSupplier;` 与 `private final CalibratedTokenCounter counter = new CalibratedTokenCounter();`(加 `import java.util.function.Supplier;`);构造器插入第二参数 `Supplier<String> modelSupplier` 并赋值;`onUsage` 改:

```java
    public void onUsage(long input, long output, long cached, List<Message> history) {
        try {
            String model = modelSupplier.get();
            long rawEst = TokenBudget.estimateMessagesTokens(history);
            counter.calibrate(model, input, rawEst);
            long estNow = counter.estimate(model, history);
            gauge.onRealUsage(model, input, estNow);
            WatermarkGauge.Reading r = gauge.read(model, estNow);
            // ……后续 stats/事件 不变
```

`curate` 内三处估算与两处 `gauge.read` 同步替换:`estBefore = counter.estimate(model, history)`(方法开头取一次 `String model = modelSupplier.get();`)、`gauge.read(model, ...)`、`estAfterPasses`/`estAfter` 同理。`counter()` 加包可见 getter 供 Task 4 注入:`CalibratedTokenCounter counter() { return counter; }`。

Agent.java:75 构造器加第二实参:

```java
        this.curator = new ContextCurator(
                () -> this.llmClient == null ? 128_000 : this.llmClient.maxContextWindow(),
                () -> this.llmClient == null ? "?" : this.llmClient.getModelName(),
                new com.lyhn.wraith.context.curator.ToolTierPolicy(),
                ...(其余原样)
```

ContextCuratorTest.java:29 构造处同步加 `() -> "test-model"` 第二参。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest='CalibratedTokenCounterTest,WatermarkGaugeTest,ContextCuratorTest'`
Expected: PASS(3 + 5 + 4)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/CalibratedTokenCounter.java \
        src/main/java/com/lyhn/wraith/context/curator/WatermarkGauge.java \
        src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java \
        src/main/java/com/lyhn/wraith/agent/Agent.java \
        src/test/java/com/lyhn/wraith/context/curator/
git commit -m "feat(curator): 校准估算 CalibratedTokenCounter(per-model EMA)+ 水位锚点按模型失效"
```

---

### Task 4: IncrementalSummarizer(增量活摘要)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/curator/IncrementalSummarizer.java`
- Test: Create `src/test/java/com/lyhn/wraith/context/curator/IncrementalSummarizerTest.java`

**Interfaces:**
- Consumes: `CurationMarks.SUMMARY_MARK`(T1)、`CalibratedTokenCounter`(T3)、`LlmClient.chat(List<Message>, List<Tool>)`(返回 `ChatResponse.content()`)。
- Produces: `IncrementalSummarizer(Supplier<LlmClient> clientSupplier, CalibratedTokenCounter counter)`;`boolean summarize(List<Message> history, int protectedFrom, String modelKey, long window)`(true=已改写 history);`protected String callLlm(String prompt) throws IOException`(测试子类覆写点,照 `ConversationHistoryCompactorTest.StubCompactor` 模式)。Task 5 依赖。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class IncrementalSummarizerTest {

    /** 测试桩:callLlm 返回固定摘要并捕获 prompt。 */
    private static class Stub extends IncrementalSummarizer {
        final AtomicReference<String> lastPrompt = new AtomicReference<>();
        private final String reply;
        Stub(String reply) {
            super(() -> null, new CalibratedTokenCounter());
            this.reply = reply;
        }
        @Override protected String callLlm(String prompt) throws IOException {
            lastPrompt.set(prompt);
            if (reply == null) throw new IOException("LLM down");
            return reply;
        }
    }

    private static List<Message> historyOf6Rounds() {
        List<Message> h = new ArrayList<>();
        h.add(Message.system("SYS"));
        for (int i = 0; i < 6; i++) {
            h.add(Message.user("Q" + i + " " + "内容。".repeat(500)));
            h.add(Message.assistant("A" + i));
        }
        return h;
    }

    @Test
    void firstSummarizeReplacesDeltaWithMarkedSummary() {
        List<Message> h = historyOf6Rounds();
        int protectedFrom = 9;    // Q4 起保护(index: sys=0, Q0=1..A5=12 → Q4=9)
        Stub s = new Stub("四段摘要内容");
        assertTrue(s.summarize(h, protectedFrom, "m", 128_000));
        // 形态: [sys][summary][ack][Q4][A4][Q5][A5]
        assertEquals(7, h.size());
        assertTrue(h.get(1).content().contains(CurationMarks.SUMMARY_MARK));
        assertTrue(h.get(1).content().contains("四段摘要内容"));
        assertEquals("assistant", h.get(2).role());
        assertTrue(h.get(3).content().startsWith("Q4"));
    }

    @Test
    void secondSummarizeMergesOldSummaryIntoPrompt() {
        List<Message> h = historyOf6Rounds();
        Stub s1 = new Stub("旧摘要ABC");
        assertTrue(s1.summarize(h, 9, "m", 128_000));
        // 再堆两轮,活摘要在 index 1
        h.add(Message.user("Q6 " + "更多。".repeat(500)));
        h.add(Message.assistant("A6"));
        Stub s2 = new Stub("合并后新摘要");
        int protectedFrom2 = h.size() - 2;   // 只保 Q6 轮
        assertTrue(s2.summarize(h, protectedFrom2, "m", 128_000));
        assertTrue(s2.lastPrompt.get().contains("旧摘要ABC"), "旧活摘要必须进合并 prompt");
        assertTrue(h.get(1).content().contains("合并后新摘要"));
        assertFalse(h.get(1).content().contains("旧摘要ABC"), "旧摘要消息已被替换");
    }

    @Test
    void failureLeavesHistoryUntouched() {
        List<Message> h = historyOf6Rounds();
        List<Message> snapshot = new ArrayList<>(h);
        Stub s = new Stub(null);   // 抛 IOException
        assertFalse(s.summarize(h, 9, "m", 128_000));
        assertEquals(snapshot, h);
    }

    @Test
    void blankSummaryAborts() {
        List<Message> h = historyOf6Rounds();
        int before = h.size();
        Stub s = new Stub("   ");
        assertFalse(s.summarize(h, 9, "m", 128_000));
        assertEquals(before, h.size());
    }

    @Test
    void oversizedDeltaIsSlicedAtUserBoundaryOldestFirst() {
        List<Message> h = historyOf6Rounds();
        // 压小输入预算:window 很小 → budget 只装得下前几轮
        System.setProperty("wraith.context.summary.inputCap", "800");
        try {
            Stub s = new Stub("部分摘要");
            assertTrue(s.summarize(h, 11, "m", 128_000));   // 保护 Q5 起
            // 剩余 delta 应还有原文轮次留在 history(未被一次吞完)
            boolean hasRawRounds = h.stream().anyMatch(m ->
                    m.content() != null && m.content().startsWith("Q") && !m.content().startsWith("Q5"));
            assertTrue(hasRawRounds, "超预算时应只吞最老的一段,剩余留给下轮");
            assertTrue(h.get(1).content().contains(CurationMarks.SUMMARY_MARK));
        } finally {
            System.clearProperty("wraith.context.summary.inputCap");
        }
    }

    @Test
    void noUserBoundaryInBudgetAborts() {
        // 首条 delta 消息单条超预算且后面没有 user 边界可切 → 放弃不改写
        List<Message> h = new ArrayList<>();
        h.add(Message.system("SYS"));
        h.add(Message.user("Q0 " + "巨量内容。".repeat(5000)));
        h.add(Message.assistant("A0"));
        h.add(Message.user("Q1"));
        h.add(Message.assistant("A1"));
        System.setProperty("wraith.context.summary.inputCap", "100");
        try {
            Stub s = new Stub("摘要");
            int before = h.size();
            assertFalse(s.summarize(h, 3, "m", 128_000));
            assertEquals(before, h.size());
        } finally {
            System.clearProperty("wraith.context.summary.inputCap");
        }
    }

    @Test
    void protectedTailAndToolPairsSurvive() {
        List<Message> h = new ArrayList<>();
        h.add(Message.system("SYS"));
        h.add(Message.user("Q0 " + "老内容。".repeat(500)));
        h.add(Message.assistant("A0"));
        h.add(Message.user("Q1"));
        List<LlmClient.ToolCall> tcs = List.of(new LlmClient.ToolCall("c1",
                new LlmClient.ToolCall.Function("read_file", "{}")));
        h.add(Message.assistant(null, null, tcs));
        h.add(Message.tool("c1", "file content"));
        h.add(Message.assistant("done"));
        Stub s = new Stub("摘要");
        assertTrue(s.summarize(h, 3, "m", 128_000));   // 保护 Q1 起
        // 尾部 [Q1][assistant+tc][tool][assistant] 完整保留
        int qi = -1;
        for (int i = 0; i < h.size(); i++) if ("Q1".equals(h.get(i).content())) qi = i;
        assertTrue(qi > 0);
        assertNotNull(h.get(qi + 1).toolCalls());
        assertEquals("tool", h.get(qi + 2).role());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=IncrementalSummarizerTest`
Expected: FAIL — 类不存在。

- [ ] **Step 3: 实现**

```java
package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Supplier;

/**
 * Tier3 增量活摘要(spec §1/§2.1):history 驻留一条 SUMMARY_MARK 活摘要,
 * 触发时 LLM 输入 = 旧活摘要 + delta(最老优先、user 边界切、超预算分批),
 * 合并出新活摘要替换旧摘要并删除已吞 delta。失败/空摘要即放弃原样保留。
 */
public class IncrementalSummarizer {
    private static final Logger log = LoggerFactory.getLogger(IncrementalSummarizer.class);

    static final String SUMMARY_PROMPT = """
            你在维护一份"活摘要"——对话历史的持续更新状态。把[旧活摘要]与[新增对话]合并成一份新活摘要。
            结构化四段(用小标题):进展 / 文件与代码 / 待办 / 约束与偏好。
            同一文件或事实以最新状态覆盖旧描述;保留变量名、函数签名、错误信息等关键细节;
            输出中文,不超过 %d token,不输出任何元描述。

            === 旧活摘要(可能为空)===
            %s
            === 旧活摘要(结束)===

            === 新增对话 ===
            %s
            === 新增对话(结束)===
            """;

    private final Supplier<LlmClient> clientSupplier;
    private final CalibratedTokenCounter counter;

    public IncrementalSummarizer(Supplier<LlmClient> clientSupplier, CalibratedTokenCounter counter) {
        this.clientSupplier = clientSupplier;
        this.counter = counter;
    }

    /** @return true = history 已被改写(摘要成功) */
    public boolean summarize(List<Message> history, int protectedFrom, String modelKey, long window) {
        try {
            int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;
            int summaryIdx = findSummaryIdx(history);
            String oldSummary = summaryIdx < 0 ? ""
                    : history.get(summaryIdx).content().replace(CurationMarks.SUMMARY_MARK, "").trim();
            int deltaStart = summaryIdx < 0 ? systemEnd : summaryIdx + 1;
            // 跳过驻留 ack(摘要后固定跟一条 assistant 确认)
            if (summaryIdx >= 0 && deltaStart < history.size()
                    && "assistant".equals(history.get(deltaStart).role())
                    && history.get(deltaStart).toolCalls() == null) {
                deltaStart++;
            }
            int deltaEnd = Math.min(protectedFrom, history.size());
            // deltaEnd 必须落 user 边界(防拆 tool 对);ProtectionBoundary 通常已保证,此处防御回退
            while (deltaEnd > deltaStart && deltaEnd < history.size()
                    && !"user".equals(history.get(deltaEnd).role())) {
                deltaEnd--;
            }
            if (deltaEnd <= deltaStart) return false;

            long inputBudget = inputBudget(window)
                    - counter.estimate(modelKey, List.of(Message.user(oldSummary)))
                    - 1_000;   // prompt 脚手架余量
            // 最老优先切片:累计超预算就停在最近一个 user 边界
            long acc = 0;
            int sliceEnd = -1;
            for (int i = deltaStart; i < deltaEnd; i++) {
                acc += counter.estimate(modelKey, List.of(history.get(i)));
                if (acc > inputBudget) break;
                if (i + 1 >= deltaEnd || "user".equals(history.get(i + 1).role())) sliceEnd = i + 1;
            }
            if (sliceEnd <= deltaStart) {
                log.warn("summary slice found no user boundary within budget; abort");
                return false;
            }

            String transcript = renderTranscript(history.subList(deltaStart, sliceEnd));
            long outputBudget = outputBudget(window);
            String prompt = String.format(Locale.ROOT, SUMMARY_PROMPT, outputBudget,
                    oldSummary.isBlank() ? "(空)" : oldSummary, transcript);
            String newSummary = callLlm(prompt);
            if (newSummary == null || newSummary.isBlank()) {
                log.warn("summary returned blank; abort");
                return false;
            }

            List<Message> rebuilt = new ArrayList<>();
            for (int i = 0; i < systemEnd; i++) rebuilt.add(history.get(i));
            rebuilt.add(Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\n" + newSummary.trim()));
            rebuilt.add(Message.assistant("好的，我已了解之前的上下文，请继续。"));
            for (int i = sliceEnd; i < history.size(); i++) rebuilt.add(history.get(i));
            history.clear();
            history.addAll(rebuilt);
            return true;
        } catch (Exception e) {
            log.warn("incremental summarize failed: {}", e.getClass().getSimpleName());
            return false;
        }
    }

    /** 真正调 LLM。protected 供测试子类覆写(照 ConversationHistoryCompactor 模式)。 */
    protected String callLlm(String prompt) throws IOException {
        LlmClient client = clientSupplier.get();
        if (client == null) throw new IOException("LLM client not configured");
        List<Message> req = List.of(
                Message.system("你是一个对话摘要助手，只输出摘要本身，不输出元描述。"),
                Message.user(prompt));
        LlmClient.ChatResponse resp = client.chat(req, null);
        return resp == null ? null : resp.content();
    }

    static int findSummaryIdx(List<Message> history) {
        for (int i = 0; i < history.size(); i++) {
            String c = history.get(i).content();
            if (c != null && c.contains(CurationMarks.SUMMARY_MARK)) return i;
        }
        return -1;
    }

    static long inputBudget(long window) {
        double ratio = WatermarkGauge.threshold("wraith.context.summary.inputRatio", 0.4);
        long cap = (long) WatermarkGauge.threshold("wraith.context.summary.inputCap", 128_000);
        return Math.max(2_000, Math.min((long) (window * ratio), cap));
    }

    static long outputBudget(long window) {
        long dflt = Math.min((long) (window * 0.03), 8_000);
        return (long) WatermarkGauge.threshold("wraith.context.summary.outputBudget", dflt);
    }

    private static String renderTranscript(List<Message> messages) {
        StringBuilder sb = new StringBuilder();
        for (Message m : messages) {
            sb.append(m.role().toUpperCase(Locale.ROOT)).append(": ");
            if (m.content() != null) sb.append(m.content());
            if (m.toolCalls() != null) {
                for (LlmClient.ToolCall tc : m.toolCalls()) {
                    sb.append("\n  TOOL_CALL ").append(tc.function().name())
                            .append(": ").append(tc.function().arguments());
                }
            }
            sb.append("\n\n");
        }
        return sb.toString();
    }
}
```

注意 `WatermarkGauge.threshold` 现为 `static double`(包可见)——已满足;若可见性不够改 `static`→`static`(同包,无需改)。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=IncrementalSummarizerTest`
Expected: PASS(7 个)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/IncrementalSummarizer.java \
        src/test/java/com/lyhn/wraith/context/curator/IncrementalSummarizerTest.java
git commit -m "feat(curator): IncrementalSummarizer——mark定位活摘要+delta最老优先分批+失败放弃,预算随窗口"
```

---

### Task 5: ContextCurator 防-兜-报接线 + compactNow + 签名收口

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java`
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`(构造注入 summarizer 依赖、`maybeCompactHistory`、`legacyAutoCompact` 简化、`compactHistoryNow` 换 curator)
- Test: Modify `src/test/java/com/lyhn/wraith/context/curator/ContextCuratorTest.java`

**Interfaces:**
- Consumes: T2 `PrunePass.Mode.EMERGENCY`、T4 `IncrementalSummarizer`。
- Produces:
  - `ContextCurator` 构造:`ContextCurator(LongSupplier windowSupplier, Supplier<String> modelSupplier, Supplier<LlmClient> clientSupplier, ToolTierPolicy policy, CurationSink sink, BiConsumer<String,Map<String,Object>> eventOut)`;测试用重载再加尾参 `IncrementalSummarizer summarizer`(null=默认构造)。
  - `boolean curate(List<Message> history)`(**IntConsumer 参数删除**)。
  - `boolean compactNow(List<Message> history)`(手动:force 流水线 1+2+3)。
  - `void setNoticeOut(java.util.function.Consumer<String> out)`(压不动时一次性提示;默认 no-op)。
- Agent 侧:`legacyAutoCompact(int)` 变体删除,恢复无参版(fd97bbc 的 `compactIfNeededProtecting` 保留——回退/对照用途,测试仍在)。

- [ ] **Step 1: 写失败测试**

ContextCuratorTest.java:三处 `c.curate(h, pf -> ...)` 改 `c.curate(h)`;`tier3RunsFallbackWhenPassesCannotRelease` 重写 + 追加(测试构造处按新签名注入假 summarizer):

```java
    /** 可控假摘要器 */
    private static class FakeSummarizer extends IncrementalSummarizer {
        boolean succeed; int calls = 0;
        FakeSummarizer(boolean succeed) {
            super(() -> null, new CalibratedTokenCounter());
            this.succeed = succeed;
        }
        @Override public boolean summarize(List<Message> h, int pf, String m, long w) {
            calls++;
            if (!succeed) return false;
            h.subList(1, Math.max(1, pf)).clear();
            h.add(1, Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\nS"));
            return true;
        }
    }

@Test
void tier3SuccessEmitsSummarizedEvent() {
    FakeSummarizer fs = new FakeSummarizer(true);
    ContextCurator c = curatorWith(fs);          // 辅助:窗口小到必 tier3
    List<Message> h = bigHistory();
    assertTrue(c.curate(h));
    assertEquals(1, fs.calls);
    assertTrue(lastEvent("context.compaction").get("summarized").equals(true));
}

@Test
void tier3FailureRunsEmergencyAndCoolsDown() {
    FakeSummarizer fs = new FakeSummarizer(false);
    ContextCurator c = curatorWith(fs);
    List<Message> h = bigHistory();
    c.curate(h);
    assertEquals(1, fs.calls);
    Map<String, Object> evt = lastEvent("context.compaction");
    assertEquals(false, evt.get("summarized"));
    assertEquals("emergency", evt.get("fallback"));
    // 冷却期内不再调 LLM 摘要
    c.curate(h);
    c.curate(h);
    assertEquals(1, fs.calls, "cooldown 期间 summarize 不得重试");
}

@Test
void pressureNoticeFiresOnceWhenNothingReleasable() {
    FakeSummarizer fs = new FakeSummarizer(false);
    ContextCurator c = curatorWith(fs);
    List<String> notices = new ArrayList<>();
    c.setNoticeOut(notices::add);
    List<Message> h = bigHistory();
    c.curate(h);
    c.curate(h);
    assertEquals(1, notices.size(), "压不动提示只发一次");
}

@Test
void manualCompactNowRunsFullPipeline() {
    FakeSummarizer fs = new FakeSummarizer(true);
    ContextCurator c = curatorWith(fs);
    List<Message> h = bigHistory();
    assertTrue(c.compactNow(h));
    assertEquals(1, fs.calls, "手动压缩必须走到摘要");
}
```

(`curatorWith`/`bigHistory`/`lastEvent` 依该测试文件既有辅助改造:eventOut 收集到 List,`bigHistory` 沿用现有 4 轮大 history 构造,窗口 supplier 调小使 ratio ≥95%。既有辅助不满足就在测试类内补,完整可运行为准。)

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=ContextCuratorTest`
Expected: FAIL — 构造签名/`curate(h)`/`compactNow`/`setNoticeOut` 不存在。

- [ ] **Step 3: 实现**

ContextCurator.java 全量重构(保持事件字段兼容,新增 `fallback` 键):

```java
    private final IncrementalSummarizer summarizer;
    private java.util.function.Consumer<String> noticeOut = s -> {};
    private int cooldown = 0;
    private boolean pressureNotified = false;

    private static int intProp(String prop, int dflt) {
        try {
            String v = System.getProperty(prop);
            return v == null ? dflt : Integer.parseInt(v);
        } catch (NumberFormatException e) { return dflt; }
    }

    public ContextCurator(LongSupplier windowSupplier, Supplier<String> modelSupplier,
                          Supplier<LlmClient> clientSupplier, ToolTierPolicy policy,
                          CurationSink sink, BiConsumer<String, Map<String, Object>> eventOut) {
        this(windowSupplier, modelSupplier, clientSupplier, policy, sink, eventOut, null);
    }

    /** 测试注入摘要器用重载。 */
    public ContextCurator(LongSupplier windowSupplier, Supplier<String> modelSupplier,
                          Supplier<LlmClient> clientSupplier, ToolTierPolicy policy,
                          CurationSink sink, BiConsumer<String, Map<String, Object>> eventOut,
                          IncrementalSummarizer summarizer) {
        this.windowSupplier = windowSupplier;
        this.modelSupplier = modelSupplier;
        this.gauge = new WatermarkGauge(windowSupplier);
        this.policy = policy;
        this.stats = new CurationStats(sink);
        this.eventOut = eventOut;
        this.summarizer = summarizer != null ? summarizer
                : new IncrementalSummarizer(clientSupplier, counter);
    }

    public void setNoticeOut(java.util.function.Consumer<String> out) {
        this.noticeOut = out == null ? s -> {} : out;
    }
```

`curate` 核心段(tier 判定后)替换为:

```java
    public boolean curate(List<Message> history) {
        try {
            String model = modelSupplier.get();
            long estBefore = counter.estimate(model, history);
            WatermarkGauge.Reading r = gauge.read(model, estBefore);
            if (r.tier() == 0) { pressureNotified = false; return false; }

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
                pruned += prune.changes().size();
                releasedSoFar += prune.releasedEstTokens();
            }

            boolean summarized = false;
            String fallback = null;
            long estAfterPasses = counter.estimate(model, history);
            if (r.tier() >= 3 && gauge.read(model, estAfterPasses).tier() >= 3) {
                if (cooldown > 0) {
                    cooldown--;
                    fallback = "cooldown";
                    SnipPass.Result em = PrunePass.apply(history, protectedFrom, policy,
                            Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
                    all.addAll(em.changes());
                    pruned += em.changes().size();
                } else if (summarizer.summarize(history, protectedFrom, model, r.window())) {
                    summarized = true;
                } else {
                    cooldown = intProp("wraith.context.summary.cooldown", 3);
                    fallback = "emergency";
                    SnipPass.Result em = PrunePass.apply(history, protectedFrom, policy,
                            Long.MAX_VALUE, PrunePass.Mode.EMERGENCY);
                    all.addAll(em.changes());
                    pruned += em.changes().size();
                }
            }

            long estAfter = counter.estimate(model, history);
            // 压完仍 ≥95% → 一次性提示(绝不静默,也绝不破保护区)
            if (gauge.read(model, estAfter).tier() >= 3) {
                if (!pressureNotified) {
                    pressureNotified = true;
                    noticeOut.accept("⚠️ 上下文已满,零成本压缩手段已用尽,建议开新会话或收窄任务。");
                }
            } else {
                pressureNotified = false;
            }

            int snipped = snip.changes().size();
            if (snipped == 0 && pruned == 0 && !summarized) return false;
            // ……durationMs/stats.recordCompaction/事件 payload 原样,payload 增加:
            //    if (fallback != null) p.put("fallback", fallback);
            //    (summarized 键原本就有)
            return true;
        } catch (Exception e) {
            log.warn("context curation failed: {}", e.getClass().getSimpleName());
            return false;
        }
    }

    /** 手动压缩(spec §7):force 跑 1+2+3,保护区不动;返回是否有任何变化。 */
    public boolean compactNow(List<Message> history) {
        try {
            String model = modelSupplier.get();
            long estBefore = counter.estimate(model, history);
            WatermarkGauge.Reading r = gauge.read(model, estBefore);
            long start = System.nanoTime();
            int protectedFrom = ProtectionBoundary.protectedFrom(
                    history, ProtectionBoundary.protectedBudget(r.window()));
            List<SnipPass.Change> all = new ArrayList<>();
            SnipPass.Result snip = SnipPass.apply(history, protectedFrom, policy, Long.MAX_VALUE);
            all.addAll(snip.changes());
            SnipPass.Result prune = PrunePass.apply(history, protectedFrom, policy, Long.MAX_VALUE);
            all.addAll(prune.changes());
            boolean summarized = summarizer.summarize(history, protectedFrom, model, r.window());
            long estAfter = counter.estimate(model, history);
            boolean any = !all.isEmpty() || summarized;
            if (any) {
                long durationMs = (System.nanoTime() - start) / 1_000_000;
                stats.recordCompaction(r.tier(), estBefore, estAfter,
                        snip.changes().size(), prune.changes().size(), summarized, durationMs);
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("tier", r.tier());
                p.put("manual", true);
                p.put("beforeTokens", estBefore);
                p.put("afterTokens", estAfter);
                p.put("summarized", summarized);
                p.put("savedTokens", Math.max(0, estBefore - estAfter));
                eventOut.accept("context.compaction", p);
            }
            return any;
        } catch (Exception e) {
            log.warn("manual curation failed: {}", e.getClass().getSimpleName());
            return false;
        }
    }
```

(import 补 `com.lyhn.wraith.llm.LlmClient`。)

Agent.java:
- 构造器 curator 处在 modelSupplier 后插入 `() -> this.llmClient`。
- `maybeCompactHistory`:

```java
    private void maybeCompactHistory() {
        if (curatorEnabled()) {
            curator.curate(conversationHistory);
            return;
        }
        legacyAutoCompact();
    }
```

- `legacyAutoCompact(int)` 变体删除,恢复 fd97bbc 之前的单一无参版(内部 `historyCompactor.compactIfNeeded(conversationHistory, trigger)`)。
- 构造器尾部(`conversationHistory.add(...)` 前)加:`this.curator.setNoticeOut(msg -> renderer().stream().println(msg));`
- `compactHistoryNow`(L386)内 `historyCompactor.compactNow(conversationHistory)` 改:

```java
            boolean compacted = curatorEnabled()
                    ? curator.compactNow(conversationHistory)
                    : historyCompactor.compactNow(conversationHistory);
```

- [ ] **Step 4: 跑受影响测试**

Run: `mvn test -DskipTests=false -Dtest='ContextCuratorTest,ConversationHistoryCompactorTest,IncrementalSummarizerTest'`
Expected: PASS。

- [ ] **Step 5: 跑全量防回归**

Run: `mvn test -DskipTests=false`
Expected: `BUILD SUCCESS`,无新增失败(Agent 签名变化可能波及别的测试,红了就修到绿)。

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java \
        src/main/java/com/lyhn/wraith/agent/Agent.java \
        src/test/java/com/lyhn/wraith/context/curator/ContextCuratorTest.java
git commit -m "feat(curator): tier3 内化增量摘要+防兜报(cooldown/emergency/一次性提示)+手动压缩换语义,legacy 退役至回退开关"
```

---

### Task 6: PricingTable + config pricing + TokenUsageFormatter 收口

**Files:**
- Create: `src/main/java/com/lyhn/wraith/context/PricingTable.java`
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`(加 pricing 字段)
- Modify: `src/main/java/com/lyhn/wraith/context/TokenUsageFormatter.java`
- Test: Create `src/test/java/com/lyhn/wraith/context/PricingTableTest.java`

**Interfaces:**
- Produces:
  - `WraithConfig.PricingEntry`(字段 `modelPrefix, cacheHitPerM, cacheMissPerM, outputPerM, currency`,Jackson getter/setter)+ `WraithConfig.getPricing()/setPricing(List<PricingEntry>)`。
  - `PricingTable`:`record Price(double cacheHitPerM, double cacheMissPerM, double outputPerM, String currency)`;`PricingTable(List<WraithConfig.PricingEntry> configEntries)`;`Optional<Price> resolve(String modelName)`(最长前缀优先,config 先于种子);`Optional<String> formatCost(String modelName, long inputTokens, long outputTokens, long cachedInputTokens)`(如 `"¥0.0935"`/`"$0.0021"`);`Optional<Double> cost(String modelName, long in, long out, long cached)`。
  - `TokenUsageFormatter.estimatedCost(LlmClient, PricingTable, int in, int out, int cached)` 返回 `String|null`;旧 `estimatedCostCny` 删除。
- Task 7/8 依赖 `PricingTable`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.context;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PricingTableTest {

    private static WraithConfig.PricingEntry entry(String prefix, double hit, double miss, double out, String cur) {
        WraithConfig.PricingEntry e = new WraithConfig.PricingEntry();
        e.setModelPrefix(prefix);
        e.setCacheHitPerM(hit);
        e.setCacheMissPerM(miss);
        e.setOutputPerM(out);
        e.setCurrency(cur);
        return e;
    }

    @Test
    void unknownModelYieldsEmptyNotZero() {
        PricingTable t = new PricingTable(List.of());
        assertTrue(t.resolve("totally-unknown-llm").isEmpty());
        assertTrue(t.formatCost("totally-unknown-llm", 1_000_000, 1_000_000, 0).isEmpty(),
                "未知模型宁缺勿虚:不给 0 不给猜");
    }

    @Test
    void configOverridesSeedAndLongestPrefixWins() {
        PricingTable t = new PricingTable(List.of(
                entry("my-model", 1, 2, 3, "CNY"),
                entry("my-model-pro", 10, 20, 30, "CNY")));
        assertEquals(20.0, t.resolve("my-model-pro-32k").orElseThrow().cacheMissPerM(), 1e-9,
                "最长前缀优先");
        assertEquals(2.0, t.resolve("my-model-base").orElseThrow().cacheMissPerM(), 1e-9);
    }

    @Test
    void costFormulaSplitsCacheHitMiss() {
        PricingTable t = new PricingTable(List.of(entry("m", 1.0, 10.0, 20.0, "CNY")));
        // 1M input 其中 40万 cache 命中,50万 output:
        // 0.4*1 + 0.6*10 + 0.5*20 = 16.4
        assertEquals(16.4, t.cost("m", 1_000_000, 500_000, 400_000).orElseThrow(), 1e-6);
        assertEquals("¥16.4000", t.formatCost("m", 1_000_000, 500_000, 400_000).orElseThrow());
    }

    @Test
    void noCacheSplitFallsBackToAllMiss() {
        PricingTable t = new PricingTable(List.of(entry("m", 1.0, 10.0, 20.0, "CNY")));
        // cached=0(provider 不回传拆分)→ 全按 miss 保守计
        assertEquals(10.0, t.cost("m", 1_000_000, 0, 0).orElseThrow(), 1e-6);
    }

    @Test
    void cachedClampedToInput() {
        PricingTable t = new PricingTable(List.of(entry("m", 1.0, 10.0, 20.0, "CNY")));
        // cached > input 的脏数据钳到 input
        assertEquals(1.0, t.cost("m", 1_000_000, 0, 9_000_000).orElseThrow(), 1e-6);
    }

    @Test
    void usdCurrencyFormatsWithDollar() {
        PricingTable t = new PricingTable(List.of(entry("v4", 0.0028, 0.14, 0.28, "USD")));
        assertTrue(t.formatCost("v4-flash", 1_000_000, 0, 0).orElseThrow().startsWith("$"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=PricingTableTest`
Expected: FAIL — 类不存在。

- [ ] **Step 3: 实现**

WraithConfig.java 加字段与嵌套类(GatewayConfig 同级风格):

```java
    private java.util.List<PricingEntry> pricing = new java.util.ArrayList<>();

    public java.util.List<PricingEntry> getPricing() { return pricing; }
    public void setPricing(java.util.List<PricingEntry> pricing) {
        this.pricing = pricing == null ? new java.util.ArrayList<>() : pricing;
    }

    /** 模型计价条目(用户自配;官方牌价≠实付价,换算率由掌握合同的人提供)。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class PricingEntry {
        private String modelPrefix;
        private double cacheHitPerM;
        private double cacheMissPerM;
        private double outputPerM;
        private String currency = "CNY";
        public String getModelPrefix() { return modelPrefix; }
        public void setModelPrefix(String v) { this.modelPrefix = v; }
        public double getCacheHitPerM() { return cacheHitPerM; }
        public void setCacheHitPerM(double v) { this.cacheHitPerM = v; }
        public double getCacheMissPerM() { return cacheMissPerM; }
        public void setCacheMissPerM(double v) { this.cacheMissPerM = v; }
        public double getOutputPerM() { return outputPerM; }
        public void setOutputPerM(double v) { this.outputPerM = v; }
        public String getCurrency() { return currency; }
        public void setCurrency(String v) { this.currency = v == null ? "CNY" : v; }
    }
```

PricingTable.java:

```java
package com.lyhn.wraith.context;

import com.lyhn.wraith.config.WraithConfig;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * 模型计价表(spec §4):config pricing(用户口径,最高优先)> 内置种子(官方牌价)> 缺席。
 * 未知模型不算成本——宁缺勿虚,0 意味着"免费"是错误信息。绝不自动联网搜价。
 */
public final class PricingTable {
    public record Price(double cacheHitPerM, double cacheMissPerM, double outputPerM, String currency) {}
    private record Entry(String modelPrefix, Price price) {}

    /**
     * 内置种子:仅收录实现时已对官方 pricing 页核准过的模型。
     * ⚠ 实现此任务时必须先访问 https://api-docs.deepseek.com 与 https://bigmodel.cn/pricing
     * 核对当下牌价再填;下面数值是 plan 编写时(2026-07)的调研值,以核对结果为准。
     * GLM 未公布 cache 折扣价 → cacheHit=cacheMiss(保守)。
     */
    private static final List<Entry> SEEDS = List.of(
            new Entry("deepseek-v4-flash", new Price(0.0028, 0.14, 0.28, "USD")),
            new Entry("deepseek-v4-pro", new Price(0.003625, 0.435, 0.87, "USD")),
            new Entry("glm-4.5", new Price(0.8, 0.8, 2.0, "CNY")),
            new Entry("glm-5", new Price(20.0, 20.0, 60.0, "CNY")));

    private final List<Entry> entries = new ArrayList<>();

    public PricingTable(List<WraithConfig.PricingEntry> configEntries) {
        if (configEntries != null) {
            for (WraithConfig.PricingEntry e : configEntries) {
                if (e.getModelPrefix() == null || e.getModelPrefix().isBlank()) continue;
                entries.add(new Entry(e.getModelPrefix(),
                        new Price(e.getCacheHitPerM(), e.getCacheMissPerM(), e.getOutputPerM(), e.getCurrency())));
            }
        }
        entries.addAll(SEEDS);   // config 在前:同前缀时先命中用户口径
    }

    /** 最长前缀优先;config 条目先于种子。 */
    public Optional<Price> resolve(String modelName) {
        if (modelName == null) return Optional.empty();
        Entry best = null;
        for (Entry e : entries) {
            if (!modelName.startsWith(e.modelPrefix())) continue;
            if (best == null || e.modelPrefix().length() > best.modelPrefix().length()) best = e;
        }
        return best == null ? Optional.empty() : Optional.of(best.price());
    }

    public Optional<Double> cost(String modelName, long inputTokens, long outputTokens, long cachedInputTokens) {
        return resolve(modelName).map(p -> {
            long cached = Math.max(0, Math.min(inputTokens, cachedInputTokens));
            long miss = Math.max(0, inputTokens - cached);
            return (cached / 1_000_000.0) * p.cacheHitPerM()
                    + (miss / 1_000_000.0) * p.cacheMissPerM()
                    + (Math.max(0, outputTokens) / 1_000_000.0) * p.outputPerM();
        });
    }

    public Optional<String> formatCost(String modelName, long inputTokens, long outputTokens, long cachedInputTokens) {
        Optional<Price> p = resolve(modelName);
        if (p.isEmpty()) return Optional.empty();
        String symbol = "USD".equalsIgnoreCase(p.get().currency()) ? "$" : "¥";
        return cost(modelName, inputTokens, outputTokens, cachedInputTokens)
                .map(c -> String.format(Locale.ROOT, "%s%.4f", symbol, c));
    }
}
```

TokenUsageFormatter.java:删掉 `estimatedCostCny` 的硬编码 if-else 全段,改:

```java
    /** 成本估算:未知模型返回 null(宁缺勿虚)。table 由调用方持有(config 生命周期)。 */
    public static String estimatedCost(LlmClient llmClient, PricingTable table,
                                       int inputTokens, int outputTokens, int cachedInputTokens) {
        if (llmClient == null || table == null) return null;
        return table.formatCost(llmClient.getModelName(), inputTokens, outputTokens, cachedInputTokens)
                .orElse(null);
    }
```

`format(...)` 中 cost 为 null 时省略"估算 X"片段(拼接处三元判空)。调用方修复:grep `estimatedCostCny` 全仓(Agent.pushStatus 与 TokenUsageFormatter.format 自身),Agent 加字段 `private PricingTable pricingTable = new PricingTable(java.util.List.of());` + setter `setPricingTable(PricingTable)`(装配点:Main.java 建 Agent 处 `agent.setPricingTable(new PricingTable(config.getPricing()))`,用 `grep -n "new Agent(" src/main/java/com/lyhn/wraith/cli/Main.java` 找到装配行插入),pushStatus 调 `TokenUsageFormatter.estimatedCost(llmClient, pricingTable, ...)`。

- [ ] **Step 4: 跑测试确认通过 + 全编译**

Run: `mvn test -DskipTests=false -Dtest=PricingTableTest && mvn -q compile`
Expected: PASS(6 个)+ 编译零错(所有 estimatedCostCny 调用点已改干净)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/PricingTable.java \
        src/main/java/com/lyhn/wraith/config/WraithConfig.java \
        src/main/java/com/lyhn/wraith/context/TokenUsageFormatter.java \
        src/main/java/com/lyhn/wraith/agent/Agent.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/context/PricingTableTest.java
git commit -m "feat(pricing): PricingTable——config用户口径>官方种子>缺席,cache拆分计价,退役硬编码单价"
```

---

### Task 7: metrics 成本字段 + CurationStats 会话累计

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/context/curator/CurationStats.java`
- Modify: `src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java`(onUsage 传成本)
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`(把 pricingTable 透传 curator)
- Test: Modify `src/test/java/com/lyhn/wraith/context/curator/CurationStatsTest.java`

**Interfaces:**
- Consumes: T6 `PricingTable`。
- Produces:
  - `CurationStats.recordUsage(long input, long output, long cached, WatermarkGauge.Reading r, Double cost, String currency)`(cost=null 时 JSONL 不写 cost/currency 键);
  - 累计 getter:`totalInput()/totalOutput()/totalCached()`(synchronized,Task 8 快照兜底用);
  - `ContextCurator.setPricingTable(PricingTable)`(默认空表)。

- [ ] **Step 1: 写失败测试**

CurationStatsTest 追加:

```java
@Test
void usageLineCarriesCostOnlyWhenKnown() {
    List<String> lines = new ArrayList<>();
    CurationSink sink = new CurationSink() {
        @Override public Optional<Path> writeToolLog(String t, CharSequence c) { return Optional.empty(); }
        @Override public void appendMetrics(String j) { lines.add(j); }
    };
    CurationStats s = new CurationStats(sink);
    WatermarkGauge.Reading r = new WatermarkGauge.Reading(100, 1000, 0.1, 0);
    s.recordUsage(100, 50, 20, r, 0.1234, "CNY");
    s.recordUsage(100, 50, 20, r, null, null);
    assertTrue(lines.get(0).contains("\"cost\":0.123400") && lines.get(0).contains("\"currency\":\"CNY\""));
    assertFalse(lines.get(1).contains("cost"), "未知价格的行绝不写 cost 键");
    assertEquals(200, s.totalInput());
    assertEquals(100, s.totalOutput());
    assertEquals(40, s.totalCached());
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=CurationStatsTest`
Expected: FAIL — 签名不匹配。

- [ ] **Step 3: 实现**

CurationStats.java:加累计字段与 getter;`recordUsage` 改:

```java
    private long totalInput, totalOutput, totalCached;

    public synchronized void recordUsage(long input, long output, long cached,
                                         WatermarkGauge.Reading r, Double cost, String currency) {
        step++;
        totalInput += Math.max(0, input);
        totalOutput += Math.max(0, output);
        totalCached += Math.max(0, cached);
        String costPart = cost == null ? "" : String.format(Locale.ROOT,
                ",\"cost\":%.6f,\"currency\":\"%s\"", cost, currency == null ? "CNY" : currency);
        sink.appendMetrics(String.format(Locale.ROOT,
                "{\"ts\":%d,\"step\":%d,\"inputTokens\":%d,\"outputTokens\":%d,\"cachedInputTokens\":%d,\"ratio\":%.4f,\"tier\":%d%s}",
                System.currentTimeMillis(), step, input, output, cached, r.ratio(), r.tier(), costPart));
    }

    public synchronized long totalInput() { return totalInput; }
    public synchronized long totalOutput() { return totalOutput; }
    public synchronized long totalCached() { return totalCached; }
```

ContextCurator:字段 `private PricingTable pricingTable = new PricingTable(java.util.List.of());` + setter;onUsage 内:

```java
            Double cost = pricingTable.cost(model, input, output, cached).orElse(null);
            String currency = pricingTable.resolve(model).map(PricingTable.Price::currency).orElse(null);
            stats.recordUsage(input, output, cached, r, cost, currency);
```

(import `com.lyhn.wraith.context.PricingTable`。)Agent.setPricingTable 里同步 `curator.setPricingTable(table)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest='CurationStatsTest,ContextCuratorTest'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/context/curator/CurationStats.java \
        src/main/java/com/lyhn/wraith/context/curator/ContextCurator.java \
        src/main/java/com/lyhn/wraith/agent/Agent.java \
        src/test/java/com/lyhn/wraith/context/curator/CurationStatsTest.java
git commit -m "feat(curator): metrics 行带精确成本(有价才写)+ 会话累计计数器"
```

---

### Task 8: `context.state.get` 后端(Agent 快照核 + SessionRunner + AppServer + Main 装配)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`(加 `contextStateCore()`)
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(SessionRunner 默认方法 + dispatch case)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java:1235` 匿名 runner(实现 `contextState()`:核 + metrics JSONL 聚合)
- Test: Create `src/test/java/com/lyhn/wraith/agent/AgentContextStateTest.java`

**Interfaces:**
- Consumes: T7 stats 累计 getter、`SessionStore.artifactDir()`(返回 `Optional<Path>`)、`ContextCurator.stats()`。
- Produces:
  - `Agent.contextStateCore()` → `Map<String,Object>`,键:`model, contextWindow, totalTokens, phase, liveSummary(String|null), inputTokens, outputTokens, cachedInputTokens, estimatedCost(String|null)`——**与 status 通知同形**,桌面可直接当 status 事件 dispatch(§6)。
  - `SessionRunner.contextState()` 默认返回 `null`(→ -32000);
  - AppServer case `"context.state.get"`。

- [ ] **Step 1: 写失败测试**

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.context.curator.CurationMarks;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AgentContextStateTest {

    @Test
    void snapshotCarriesModelWindowAndLiveSummaryPreview() {
        Agent agent = new Agent(new FakeClient());   // 该测试包内既有假 client 可复用则复用;
                                                     // 没有就写最小 LlmClient 匿名实现(chat 抛 UnsupportedOperationException,
                                                     // getModelName()="fake-model", maxContextWindow()=64_000)
        agent.restoreHistory(java.util.List.of(
                LlmClient.Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\n这是活摘要正文"),
                LlmClient.Message.assistant("好的，我已了解之前的上下文，请继续。"),
                LlmClient.Message.user("继续干活")));
        Map<String, Object> m = agent.contextStateCore();
        assertEquals("fake-model", m.get("model"));
        assertEquals(64_000L, m.get("contextWindow"));
        assertTrue(((String) m.get("liveSummary")).contains("这是活摘要正文"));
        assertEquals("idle", m.get("phase"));
        assertTrue((Long) m.get("totalTokens") > 0);
    }

    @Test
    void liveSummaryNullWhenAbsent() {
        Agent agent = new Agent(new FakeClient());
        assertNull(agent.contextStateCore().get("liveSummary"));
    }
}
```

(`restoreHistory` 已存在——resume 路径在用;若为私有改包可见或经 resume 同路径调用,以现有 API 为准,测试意图不变。⚠ 若构造完整 `Agent` 有文件系统副作用(MemoryManager/ToolRegistry 写真实目录),违反测试红线——此时改为把 `contextStateCore` 的历史扫描/快照拼装逻辑抽成包可见静态方法单测,Agent 方法变薄壳,测试意图不变。)

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=AgentContextStateTest`
Expected: FAIL — `contextStateCore` 不存在。

- [ ] **Step 3: 实现**

Agent.java(`currentStatus` 附近)加:

```java
    /** context.state.get 快照核(spec §6):与 status 通知同形,便于桌面直接复用 reducer。 */
    public java.util.Map<String, Object> contextStateCore() {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("model", llmClient == null ? "—" : llmClient.getModelName());
        m.put("contextWindow", llmClient == null ? 0L : llmClient.maxContextWindow());
        m.put("totalTokens", (long) estimateCurrentContextTokens());
        m.put("estimated", true);   // 核只有估算;runner 用 JSONL 尾行覆盖时置 false(spec §6"估算,待首轮校准")
        m.put("phase", turnActive ? "running" : "idle");
        String liveSummary = null;
        for (LlmClient.Message msg : conversationHistory) {
            String c = msg.content();
            if (c != null && c.contains(com.lyhn.wraith.context.curator.CurationMarks.SUMMARY_MARK)) {
                liveSummary = c.replace(com.lyhn.wraith.context.curator.CurationMarks.SUMMARY_MARK, "").trim();
                break;
            }
        }
        m.put("liveSummary", liveSummary);
        var stats = curator.stats();
        m.put("inputTokens", stats.totalInput());
        m.put("outputTokens", stats.totalOutput());
        m.put("cachedInputTokens", stats.totalCached());
        m.put("estimatedCost", TokenUsageFormatter.estimatedCost(llmClient, pricingTable,
                (int) Math.min(Integer.MAX_VALUE, stats.totalInput()),
                (int) Math.min(Integer.MAX_VALUE, stats.totalOutput()),
                (int) Math.min(Integer.MAX_VALUE, stats.totalCached())));
        return m;
    }
```

AppServer.java SessionRunner 接口加默认方法(modelList 旁):

```java
        /** context.state.get 快照(spec Phase B §6)。默认 null(-32000)。 */
        default java.util.Map<String, Object> contextState() { return null; }
```

dispatch 加 case(`"session.compact"` 旁,同 task.list 错误风格):

```java
            case "context.state.get" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try {
                    java.util.Map<String, Object> st = session.contextState();
                    if (st == null) writer.error(msg.id(), -32000, "not supported");
                    else writer.result(msg.id(), st);
                } catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

Main.java:1235 匿名 runner 内加(listSessions 旁;`sessionStore`/`agent` 均在闭包作用域):

```java
                    public java.util.Map<String, Object> contextState() {
                        java.util.Map<String, Object> m = agent.contextStateCore();
                        // 会话累计以 metrics JSONL 为准(覆盖重启前轮次;in-process 行也在文件里)
                        sessionStore.artifactDir().ifPresent(dir -> {
                            java.nio.file.Path f = dir.resolve("context-metrics.jsonl");
                            if (!java.nio.file.Files.isRegularFile(f)) return;
                            try {
                                long in = 0, out = 0, cached = 0;
                                com.fasterxml.jackson.databind.ObjectMapper om =
                                        new com.fasterxml.jackson.databind.ObjectMapper();
                                com.fasterxml.jackson.databind.JsonNode last = null;
                                for (String line : java.nio.file.Files.readAllLines(f)) {
                                    if (line.isBlank()) continue;
                                    try {
                                        com.fasterxml.jackson.databind.JsonNode n = om.readTree(line);
                                        if (n.has("compaction")) continue;   // 压缩行不计入 usage 累计
                                        in += n.path("inputTokens").asLong(0);
                                        out += n.path("outputTokens").asLong(0);
                                        cached += n.path("cachedInputTokens").asLong(0);
                                        last = n;
                                    } catch (Exception ignored) { /* 坏行跳过 */ }
                                }
                                if (last != null) {
                                    m.put("inputTokens", in);
                                    m.put("outputTokens", out);
                                    m.put("cachedInputTokens", cached);
                                    m.put("ratio", last.path("ratio").asDouble(0));
                                    m.put("tier", last.path("tier").asInt(0));
                                    m.put("estimated", false);   // 有真实 usage 尾行,水位不再是纯估算
                                }
                            } catch (Exception e) {
                                // 聚合失败不影响快照主体
                            }
                        });
                        return m;
                    }
```

- [ ] **Step 4: 跑测试确认通过 + 全编译**

Run: `mvn test -DskipTests=false -Dtest=AgentContextStateTest && mvn -q compile`
Expected: PASS + 编译零错。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/agent/Agent.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/agent/AgentContextStateTest.java
git commit -m "feat(appserver): context.state.get 快照 RPC——Agent核+metrics JSONL会话累计聚合,状态与status通知同形"
```

---

### Task 9: setLlmClient 状态帧 + 桌面接线 + 全量回归

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java:92-98`(setLlmClient 推状态帧)
- Modify: `desktop/src/preload/index.ts`(类型 + `contextState()`)
- Modify: `desktop/src/main/index.ts`(`wraith:contextState` handler,加在 `wraith:compactHistory`(L684)之后)
- Modify: `desktop/src/renderer/App.tsx`(startSession/resumeSession 成功后拉快照 dispatch)

**Interfaces:**
- Consumes: T8 `context.state.get`(返回与 status 通知同形)。
- Produces: 桌面 `window.wraith.contextState()`;修复两个显示 bug(重启空白/换模型不刷新)。

- [ ] **Step 1: 后端——setLlmClient 推状态帧**

Agent.java setLlmClient 末尾加一行:

```java
    public void setLlmClient(LlmClient llmClient) {
        this.llmClient = llmClient;
        this.memoryManager.setLlmClient(llmClient);
        this.historyCompactor.setLlmClient(llmClient);
        this.toolRegistry.setContextProfile(memoryManager.getContextProfile());
        this.toolRegistry.setCurrentModel(llmClient.getProviderName(), llmClient.getModelName());
        // 换模型立即推一帧状态:窗口/模型/价格口径同步刷新(spec §5/§6);
        // summarizer/gauge/counter 无需手动同步——curator 持 supplier,天然跟当前 client
        renderer().updateStatus(currentStatus(turnActive ? "running" : "idle"));
    }
```

Run: `mvn -q compile` → 零错。

- [ ] **Step 2: 桌面——preload + main handler**

desktop/src/preload/index.ts:接口声明区(L137 `compactHistory` 旁)加:

```ts
  contextState(): Promise<Record<string, unknown>>
```

实现区(L566 `compactHistory()` 实现旁)加:

```ts
  contextState() {
    return ipcRenderer.invoke('wraith:contextState') as Promise<Record<string, unknown>>
  },
```

desktop/src/main/index.ts L688(compactHistory handler 之后)加:

```ts
// 上下文状态快照(启动/切会话时拉一次,修"发消息前空白")
ipcMain.handle('wraith:contextState', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('context.state.get', {})
})
```

- [ ] **Step 3: 桌面——App.tsx 启动/切会话拉快照**

App.tsx:找到 startSession 与 resumeSession 的成功回调(`grep -n "startSession\|resumeSession" desktop/src/renderer/App.tsx`),各加(快照与 status 通知同形,直接走既有 reducer 路径,即 L223 同款 dispatch):

```ts
        try {
          const snap = await window.wraith.contextState()
          dispatch({ kind: 'notification', method: 'status', params: snap } as BackendEvent)
        } catch { /* 后端未就绪时静默:首条消息的 status 通知会补上 */ }
```

- [ ] **Step 4: 桌面验证**

Run: `cd desktop && npx tsc --noEmit && npx vitest run`
Expected: typecheck 0 错;vitest 基线不降。

- [ ] **Step 5: Java 全量回归**

Run: `mvn test -DskipTests=false`
Expected: `Tests run: ≥1520, Failures: 0, Errors: 0`,`BUILD SUCCESS`(1492 基线 + 本计划新增 ~30 个,零既有失败)。

- [ ] **Step 6: Commit(不 push——push 需用户单独点头)**

```bash
git add src/main/java/com/lyhn/wraith/agent/Agent.java desktop/src/preload/index.ts \
        desktop/src/main/index.ts desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 启动/切会话拉 context.state.get 快照 + 换模型即推状态帧——修重启空白与换模型不刷新"
```

---

## 完成定义

- 全量 `mvn test -DskipTests=false` BUILD SUCCESS,零既有失败;desktop `tsc --noEmit` 0 错、vitest 基线不降。
- `-Dwraith.context.curator.enabled=false` 回退路径行为与 Phase A 一致(legacy 全量摘要)。
- 真机眼验(用户执行):重启桌面 App 未发消息即显示水位;切模型后徽标 window/model/成本立即刷新;手动压缩按钮走新流水线。
