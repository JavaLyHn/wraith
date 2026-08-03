# 计价写入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `config.json` 的 `pricing` 节能从 CLI 与桌面图形界面写入，并且**写完立刻生效**。

**Architecture:** `PricingTable` 加只读视图供两端展示；`Agent` 加 `reloadPricingTable` 解决第 6 次 snapshot-vs-live；CLI 走 `/config pricing`（路由进今天刚加的 `handleConfigCommand` 分支表），桌面走 `config.getPricing`/`config.setPricing` 两条 RPC + 设置面板新增一节。RPC 是**整表替换**，不是逐条 CRUD。

**Tech Stack:** Java 17 / Maven（后端 + CLI + app-server RPC）；Electron + React + TypeScript + vitest（桌面七层链路）。

**Spec:** `docs/superpowers/specs/2026-08-03-pricing-write-path-design.md`（D1–D7）

## Global Constraints

- **不得读写真实 `~/.wraith/config.json`。** 需要落盘的用例一律 `@TempDir` + `System.setProperty("wraith.config.dir", …)`，并在 `finally` 里还原。
- **不得依赖真实环境变量。** 本 checkout 的 `./.env` 含真实 `DEEPSEEK_API_KEY`。
- **绝不打印或断言真实密钥。** 测试里的 key 一律 `sk-fake-*`。
- `mvn` 命令**必须**带 `-DskipTests=false`（本仓库默认跳过测试，否则是假绿）。
- 每个任务结束时 Java 全量必须 `0 Failures / 0 Errors`。**当前基线：1997 tests。** 桌面基线：`tsc` 退出码 0 + vitest **149 files / 1291 tests**。
- 桌面测试一律以 `// @vitest-environment jsdom` 开头并 `afterEach(cleanup)`（照 `desktop/test/providersPanelBaseUrlHint.test.tsx`）。
- `git add` **只加**本任务列出的文件；**绝不** `git add .` / `-A`；**绝不** `git add` 真实 `.env`；不提交 `demo/pom.xml`。
- commit message 末尾**必须**是这两行，顺序不变：
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
  ```
- **`SEEDS` 一条不加、不改、不可写**（spec §3.6）。用户条目在同长度时已优先于种子。
- **币种只允许 `CNY` / `USD`**：`PricingTable.formatCost`（:96）只认 `USD` → `$`，其余一律渲染 `¥`。
- **`cacheHit ≤ cacheMiss` 不校验**（真实牌价两个方向都存在）。
- **匹配语义**：config 条目 = 小写后 `startsWith`；种子 = 小写后 `equals`。两端的实现必须一致。
- 命令行工作目录**必须**是仓库根（`/Users/aa00945/Desktop/wraith`）；跑桌面命令时显式 `cd desktop`，跑 `mvn` 前显式 `cd` 回根 —— 本会话已经因为目录漂移吃过一次 `no POM in this directory`。

---

## File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `src/main/java/com/lyhn/wraith/context/PricingTable.java` | 加 `View` record + `view()` 只读视图 | 1 |
| `src/main/java/com/lyhn/wraith/agent/Agent.java` | 加 `reloadPricingTable(WraithConfig)` | 1 |
| `src/main/java/com/lyhn/wraith/cli/Main.java` | `ConfigReloadHook`、`/config pricing` 解析与落地、RPC session 实现、REPL 接线 | 2,3 |
| `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` | `pricingGet`/`pricingSet` 接口 default + `config.getPricing`/`config.setPricing` dispatch | 3 |
| `desktop/src/shared/types.ts` | `PricingEntryView` / `PricingListResult` | 4 |
| `desktop/src/preload/index.ts` | `configGetPricing` / `configSetPricing` 桥 | 4 |
| `desktop/src/main/index.ts` | 2 个 `ipcMain.handle` 转发 | 4 |
| `desktop/src/renderer/lib/pricingView.ts` | **新建**。纯函数：命中判定 + 校验 + 币种符号 | 4 |
| `desktop/src/renderer/components/SettingsPricing.tsx` | **新建**。表格式增删改 | 5 |
| `desktop/src/renderer/components/SettingsPanel.tsx` | NAV 加「计价」一项 | 5 |
| `AGENTS.md` | §5 连带清单加「改计价」 | 5 |

---

### Task 1: `PricingTable.view()` + `Agent.reloadPricingTable()`

后面所有任务的读侧与刷新原语。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/context/PricingTable.java`（`Price` record 之后 `:15`；`resolve` 之前）
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`（`setPricingTable` 之后 `:142`）
- Test: `src/test/java/com/lyhn/wraith/context/PricingTableViewTest.java`（新建）
- Test: `src/test/java/com/lyhn/wraith/agent/PricingReloadTest.java`（新建）

**Interfaces:**
- Consumes: 无
- Produces:
  ```java
  public record PricingTable.View(String modelKey, PricingTable.Price price, boolean seeded) {}
  public List<PricingTable.View> PricingTable.view()      // 不可变；config 条目在前，种子在后
  public void Agent.reloadPricingTable(com.lyhn.wraith.config.WraithConfig config)
  ```

- [ ] **Step 1: 写会红的测试（view）**

新建 `src/test/java/com/lyhn/wraith/context/PricingTableViewTest.java`：

```java
package com.lyhn.wraith.context;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * view() 是给 /config pricing --list 与桌面面板用的只读视图。
 *
 * <p>顺带守住 spec §2.3 那个静默陷阱：<b>config 条目是前缀匹配、种子要求精确相等</b>。
 * 这个差异不是 bug（注释写明前缀的模糊范围由用户承担），但它是静默的——
 * 用户填 {@code glm} 会让 glm-4.7 / glm-5v-turbo 全套同一个价。
 */
class PricingTableViewTest {

    private static WraithConfig.PricingEntry entry(String prefix, double hit, double miss,
                                                   double out, String currency) {
        WraithConfig.PricingEntry e = new WraithConfig.PricingEntry();
        e.setModelPrefix(prefix);
        e.setCacheHitPerM(hit);
        e.setCacheMissPerM(miss);
        e.setOutputPerM(out);
        e.setCurrency(currency);
        return e;
    }

    @Test
    @DisplayName("view() 同时列出用户条目与内置种子，seeded 标对")
    void listsUserEntriesAndSeedsWithCorrectFlag() {
        PricingTable table = new PricingTable(List.of(entry("my-relay-model", 1, 2, 3, "CNY")));

        List<PricingTable.View> view = table.view();

        PricingTable.View mine = view.stream()
                .filter(v -> "my-relay-model".equals(v.modelKey())).findFirst().orElseThrow();
        assertFalse(mine.seeded(), "用户条目不是种子");
        assertEquals(2.0, mine.price().cacheMissPerM());

        assertTrue(view.stream().anyMatch(v -> "glm-5".equals(v.modelKey()) && v.seeded()),
                "内置种子也要在视图里,并标 seeded");
        assertTrue(view.stream().anyMatch(v -> "deepseek-v4-pro".equals(v.modelKey()) && v.seeded()));
    }

    @Test
    @DisplayName("用户条目排在种子之前 —— 与构造器里 config 先于 SEEDS 的顺序一致")
    void userEntriesComeFirst() {
        PricingTable table = new PricingTable(List.of(entry("zzz-model", 1, 1, 1, "CNY")));

        List<PricingTable.View> view = table.view();

        assertFalse(view.get(0).seeded(), "第一条该是用户条目");
    }

    @Test
    @DisplayName("view() 不可变 —— 调用方拿不到内部列表的写权限")
    void viewIsImmutable() {
        List<PricingTable.View> view = new PricingTable(List.of()).view();

        org.junit.jupiter.api.Assertions.assertThrows(UnsupportedOperationException.class,
                () -> view.add(new PricingTable.View("x", new PricingTable.Price(1, 1, 1, "CNY"), false)));
    }

    @Test
    @DisplayName("守门：config 条目是前缀匹配,种子要求精确相等(spec §2.3 的静默陷阱)")
    void configEntriesArePrefixSeedsAreExact() {
        // 用户填 "glm" —— 前缀语义,会命中所有 glm-*
        PricingTable withPrefix = new PricingTable(List.of(entry("glm", 7, 7, 7, "CNY")));
        assertEquals(7.0, withPrefix.resolve("glm-4.7").orElseThrow().outputPerM(),
                "config 条目该按前缀命中");
        assertEquals(7.0, withPrefix.resolve("glm-5v-turbo").orElseThrow().outputPerM(),
                "同一条前缀会命中多个变体 —— 这正是要在 UI 里显示出来的那件事");

        // 种子 "glm-5" 精确相等才命中:glm-5.1 不该套用 glm-5 的旗舰价
        PricingTable seedsOnly = new PricingTable(List.of());
        assertEquals(60.0, seedsOnly.resolve("glm-5").orElseThrow().outputPerM());
        assertTrue(seedsOnly.resolve("glm-5.1").isEmpty(),
                "种子是精确匹配:glm-5.1 不该静默套用 glm-5 的价");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest=PricingTableViewTest test`
Expected: 编译失败，`找不到符号: 类 View` / `方法 view()`

- [ ] **Step 3: 给 `PricingTable` 加 `View` + `view()`**

在 `PricingTable.java` 的 `Price` record（`:15`）之后插入：

```java
    /**
     * 只读视图：给 {@code /config pricing --list} 与桌面「模型计价」面板用。
     *
     * <p>{@code seeded=true} 是内置种子（{@link #SEEDS}），<b>不可写</b>——种子的门槛是
     * 「两个独立可信来源对得上」，而中转站实付价没有公开来源（见 SEEDS 上的核对记录）。
     * 用户想覆盖某个种子价，填一条同名的 config 条目即可（同长度时 config 先命中）。
     *
     * <p>不外泄 {@link Entry}：那是 private record，且它的字段名 {@code exact} 是匹配语义，
     * 而视图消费者关心的是「这条能不能编辑」。
     */
    public record View(String modelKey, Price price, boolean seeded) {}
```

在 `resolve` 方法（`:76` 那个 `public Optional<Price> resolve`）之前插入：

```java
    /** 只读视图；顺序同内部列表（config 条目在前，种子在后）。 */
    public List<View> view() {
        List<View> out = new ArrayList<>();
        for (Entry e : entries) {
            out.add(new View(e.modelKey(), e.price(), e.exact()));
        }
        return List.copyOf(out);
    }
```

（`ArrayList` 与 `List` 都已 import，见 `:5-6`。`Entry.exact()` 为 true 即种子——`SEEDS` 全部用 `exact=true` 构造，config 条目全部 `false`，见构造器。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest=PricingTableViewTest test`
Expected: `Tests run: 4, Failures: 0, Errors: 0`

- [ ] **Step 5: 写会红的测试（reload）**

新建 `src/test/java/com/lyhn/wraith/agent/PricingReloadTest.java`：

```java
package com.lyhn.wraith.agent;

import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 第六次 snapshot-vs-live：setPricingTable 只在构造 Agent 时被注入
 * （Main.java:348 交互 CLI / :1326 app-server 会话），于是用户写完 pricing 后
 * <b>本次会话的状态栏依然不显示费用，必须重启</b>。
 * 前五次：沙箱护盾、动作卡、pet 窗口、补全、web_search 的 provider 缓存。
 *
 * <p>观察面用 {@code contextStateCore().get("estimatedCost")}：
 * 未知模型时 {@code TokenUsageFormatter.estimatedCost} 返回 null（宁缺勿虚），
 * 有价时返回带币种符号的字符串。0 token 也会给出 "¥0.0000"，所以不需要跑真实对话。
 */
class PricingReloadTest {

    private static WraithConfig.PricingEntry entry(String prefix, double out) {
        WraithConfig.PricingEntry e = new WraithConfig.PricingEntry();
        e.setModelPrefix(prefix);
        e.setCacheHitPerM(1);
        e.setCacheMissPerM(1);
        e.setOutputPerM(out);
        e.setCurrency("CNY");
        return e;
    }

    @Test
    @DisplayName("reloadPricingTable 之后本次会话就能算出成本 —— 不必重启")
    void reloadMakesNewPricingEffectiveInTheSameSession(@TempDir Path tempDir) {
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(tempDir.toString());
        Agent agent = new Agent(new FakeClient(), registry);

        // 起点:fake-model 在种子表里没有价 ⇒ 成本缺席
        assertNull(agent.contextStateCore().get("estimatedCost"),
                "起点该是「未知模型不算成本」");

        WraithConfig config = new WraithConfig();
        config.setPricing(List.of(entry("fake-model", 42)));
        agent.reloadPricingTable(config);

        // 判别力自证:把 reloadPricingTable 的方法体注释掉,这一行变红。
        Object cost = agent.contextStateCore().get("estimatedCost");
        assertNotNull(cost, "写完 pricing 后本次会话就该能算成本 —— 第六次 snapshot-vs-live");
        assertTrue(cost.toString().startsWith("¥"), "CNY 该渲染成 ¥: " + cost);
    }

    @Test
    @DisplayName("传 null pricing 不炸,退回「无价」而不是抛异常")
    void nullPricingFallsBackToEmptyTable(@TempDir Path tempDir) {
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(tempDir.toString());
        Agent agent = new Agent(new FakeClient(), registry);

        WraithConfig config = new WraithConfig();
        config.setPricing(null);   // setPricing(null) 会落成空 ArrayList
        agent.reloadPricingTable(config);

        assertNull(agent.contextStateCore().get("estimatedCost"));
    }

    /** 只提供 getModelName/getProviderName 等元信息，不做真实 chat 调用。 */
    private static final class FakeClient implements LlmClient {
        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            throw new UnsupportedOperationException("FakeClient does not perform real chat calls");
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener)
                throws IOException {
            throw new UnsupportedOperationException("FakeClient does not perform real chat calls");
        }

        @Override
        public String getModelName() {
            return "fake-model";
        }

        @Override
        public String getProviderName() {
            return "fake";
        }

        @Override
        public int maxContextWindow() {
            return 64_000;
        }

        @Override
        public boolean supportsTools() {
            return false;
        }
    }
}
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest=PricingReloadTest test`
Expected: 编译失败，`找不到符号: 方法 reloadPricingTable`

- [ ] **Step 7: 给 `Agent` 加 `reloadPricingTable`**

在 `Agent.java` 的 `setPricingTable`（`:139-142`）之后插入：

```java
    /**
     * 计价配置变更后调用；否则本次会话的 usage 行仍用旧表。
     *
     * <p><b>第六次 snapshot-vs-live</b>：{@link #setPricingTable} 只在构造 Agent 时被注入
     * （{@code Main.java:348} 交互 CLI、{@code :1326} app-server 会话），于是用户写完
     * {@code pricing} 后本次会话依然不显示费用，必须重启。前五次：沙箱护盾、动作卡、
     * pet 窗口、补全、{@code web_search} 的 provider 缓存。
     *
     * <p>{@code setPricingTable} 已经把表往 {@code curator} 里传一遍（见其实现），
     * 所以 curator 侧自动跟上，不必在这里单独接。
     */
    public void reloadPricingTable(com.lyhn.wraith.config.WraithConfig config) {
        setPricingTable(new PricingTable(config == null ? java.util.List.of() : config.getPricing()));
    }
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest='PricingReloadTest,PricingTableViewTest' test`
Expected: `Tests run: 6, Failures: 0, Errors: 0`

- [ ] **Step 9: 自证判别力**

把 `reloadPricingTable` 的方法体临时改成空（`{ }`），重跑：

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest=PricingReloadTest test`
Expected: `reloadMakesNewPricingEffectiveInTheSameSession` FAIL（`estimatedCost` 仍是 null）

改回后**必须再跑一次确认恢复绿**，不要凭记忆认为改回了。

- [ ] **Step 10: 跑全量**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Tests run: 2003, Failures: 0, Errors: 0`（1997 + 6），`BUILD SUCCESS`

- [ ] **Step 11: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/context/PricingTable.java \
        src/main/java/com/lyhn/wraith/agent/Agent.java \
        src/test/java/com/lyhn/wraith/context/PricingTableViewTest.java \
        src/test/java/com/lyhn/wraith/agent/PricingReloadTest.java
git commit -m "$(cat <<'EOF'
feat(pricing): 只读视图 + 配置重载 —— 修第六次 snapshot-vs-live

两个原语,后面的 CLI 与桌面写入口都要用。

PricingTable.view(): 同时列出用户条目与内置种子并标 seeded(不可写)。不外泄
private record Entry —— 它的字段叫 exact,那是匹配语义;视图消费者关心的是
「这条能不能编辑」。

Agent.reloadPricingTable(config): setPricingTable 此前只在构造 Agent 时被注入
(Main.java:348 交互 CLI / :1326 app-server 会话),于是用户写完 pricing 后本次
会话依然不显示费用,必须重启——本仓库第六次 snapshot-vs-live(前五次:沙箱护盾、
动作卡、pet 窗口、补全、web_search 的 provider 缓存)。没有它,「加了写入口」
对用户等于没加。

判别力自证:把 reloadPricingTable 方法体清空,reloadMakesNewPricingEffective
InTheSameSession 变红(estimatedCost 仍是 null),恢复即绿。

顺带加了一条守门测试钉住 spec §2.3 那个静默陷阱: config 条目是前缀匹配、
种子要求精确相等。用户填 glm 会让 glm-4.7 与 glm-5v-turbo 套同一个价,
而种子 glm-5 不会被 glm-5.1 命中。这个差异不是 bug 但是静默的。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 2: `/config pricing` CLI + `ConfigReloadHook`

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`
  - `:743` REPL 的 `handleConfigCommand` 调用
  - `:3316` 2 参重载、`:3320` 3 参重载的签名
  - `:3455` `providerConfigUsage()` 之后（放 pricing 的解析与落地）
  - `:3502` `normalizeConfigKey` 的映射表
  - record 区（`SearchConfigUpdate` 之后）
- Modify: `src/test/java/com/lyhn/wraith/cli/SearchConfigCommandTest.java:145-155`（唯一要改的既有测试）
- Test: `src/test/java/com/lyhn/wraith/cli/PricingConfigCommandTest.java`（新建）

**Interfaces:**
- Consumes: `PricingTable.view()`、`Agent.reloadPricingTable`（Task 1）
- Produces:
  ```java
  interface Main.ConfigReloadHook { void afterConfigWrite(WraithConfig config); }
  enum Main.PricingAction { LIST, UPSERT, REMOVE }
  record Main.PricingConfigUpdate(PricingAction action, String modelPrefix,
                                  double cacheHitPerM, double cacheMissPerM, double outputPerM,
                                  String currency, String error)
  static Main.PricingConfigUpdate Main.parsePricingConfigUpdate(String payload)
  static String Main.validatePricingEntry(String modelPrefix, double cacheHit, double cacheMiss,
                                          double output, String currency)   // null=通过
  static java.util.List<String> Main.pricingMatchedModels(String modelPrefix, WraithConfig config)
  static String Main.handleConfigCommand(WraithConfig config, String payload, ConfigReloadHook hook)
  ```
  **`handleConfigCommand` 的第三参类型从 `ToolRegistry` 变成 `ConfigReloadHook`**（spec §4.3）。2 参重载保留。

- [ ] **Step 1: 写会红的测试**

新建 `src/test/java/com/lyhn/wraith/cli/PricingConfigCommandTest.java`：

```java
package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * pricing 是 config.json 五节里唯一 CLI 与桌面两边都没有写入口的一节 ——
 * 用户只能手改 JSON。中转站实付价只有用户自己知道（官方牌价 ≠ 实付价），
 * 所以「能填」比「表里有什么」重要得多。
 *
 * <p>红线：需要落盘的用例一律 @TempDir + -Dwraith.config.dir，不碰真实 ~/.wraith/config.json。
 */
class PricingConfigCommandTest {

    private static void withTempConfigDir(Path tempDir, Runnable body) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            body.run();
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    private static WraithConfig withProviders(String... providerAndModel) {
        WraithConfig config = new WraithConfig();
        for (int i = 0; i < providerAndModel.length; i += 2) {
            config.getProviders().put(providerAndModel[i],
                    new WraithConfig.ProviderConfig("sk-fake", null, providerAndModel[i + 1]));
        }
        return config;
    }

    // ── 解析 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("单条写入解析出四个数值与币种")
    void parsesUpsert() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing glm-4.7 --cache-hit 20 --cache-miss 20 --output 60 --currency CNY");

        assertNull(u.error());
        assertEquals(Main.PricingAction.UPSERT, u.action());
        assertEquals("glm-4.7", u.modelPrefix());
        assertEquals(20.0, u.cacheHitPerM());
        assertEquals(60.0, u.outputPerM());
        assertEquals("CNY", u.currency());
    }

    @Test
    @DisplayName("币种缺省是 CNY（与 PricingEntry 的字段默认一致）")
    void currencyDefaultsToCny() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1");

        assertEquals("CNY", u.currency());
    }

    @Test
    @DisplayName("--list 与裸 pricing 都是列出")
    void parsesList() {
        assertEquals(Main.PricingAction.LIST, Main.parsePricingConfigUpdate("pricing --list").action());
        assertEquals(Main.PricingAction.LIST, Main.parsePricingConfigUpdate("pricing").action());
    }

    @Test
    @DisplayName("--remove 解析出要删的前缀")
    void parsesRemove() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate("pricing --remove glm-4.7");

        assertEquals(Main.PricingAction.REMOVE, u.action());
        assertEquals("glm-4.7", u.modelPrefix());
    }

    @Test
    @DisplayName("三个价缺任何一个都报错，不静默当 0 —— 0 意味着「免费」是错误信息")
    void missingAnyPriceIsAnError() {
        assertNotNull(Main.parsePricingConfigUpdate("pricing m --cache-hit 1 --cache-miss 1").error());
        assertNotNull(Main.parsePricingConfigUpdate("pricing m --cache-hit 1 --output 1").error());
        assertNotNull(Main.parsePricingConfigUpdate("pricing m --cache-miss 1 --output 1").error());
    }

    @Test
    @DisplayName("价不是数字时报人话")
    void nonNumericPriceIsAnError() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing m --cache-hit abc --cache-miss 1 --output 1");

        assertNotNull(u.error());
        assertTrue(u.error().contains("abc"), "该把用户敲的那个值回给他: " + u.error());
    }

    @Test
    @DisplayName("负价报错 —— 算出负成本比不显示更糟")
    void negativePriceIsAnError() {
        assertNotNull(Main.parsePricingConfigUpdate(
                "pricing m --cache-hit -1 --cache-miss 1 --output 1").error());
    }

    @Test
    @DisplayName("非法币种报错 —— formatCost 只认 USD，其余一律渲染成 ¥，允许 EUR 会骗人")
    void unsupportedCurrencyIsAnError() {
        Main.PricingConfigUpdate u = Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1 --currency EUR");

        assertNotNull(u.error());
        assertTrue(u.error().contains("CNY") && u.error().contains("USD"), u.error());
    }

    @Test
    @DisplayName("币种大小写不敏感，归一成大写")
    void currencyIsCaseInsensitive() {
        assertEquals("USD", Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1 --currency usd").currency());
    }

    @Test
    @DisplayName("未知配置项报错")
    void unknownOptionIsAnError() {
        assertNotNull(Main.parsePricingConfigUpdate(
                "pricing m --cache-hit 1 --cache-miss 1 --output 1 --discount 0.5").error());
    }

    // ── 命中提示（spec §3.4 的同一份逻辑，CLI 与面板共用语义） ─────────────

    @Test
    @DisplayName("pricingMatchedModels 用的是 config 条目的语义：小写 startsWith")
    void matchedModelsUsesPrefixSemantics() {
        WraithConfig config = withProviders(
                "freellmapi-4", "glm-4.7",
                "freellmapi-5", "glm-5v-turbo",
                "siliconflow", "Qwen/Qwen3-8B");

        assertEquals(List.of("glm-4.7", "glm-5v-turbo"), Main.pricingMatchedModels("glm", config),
                "填 glm 会命中两个 —— 这正是要显示给用户看的那件事");
        assertEquals(List.of("glm-4.7"), Main.pricingMatchedModels("glm-4.7", config));
        assertEquals(List.of("Qwen/Qwen3-8B"), Main.pricingMatchedModels("qwen/", config),
                "大小写不敏感");
        assertTrue(Main.pricingMatchedModels("gpt-", config).isEmpty());
    }

    // ── 接线 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("接线：写进 config.getPricing() 并落盘，回显带「会命中哪几个模型」")
    void upsertWritesAndEchoesMatchedModels(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = withProviders("freellmapi-4", "glm-4.7");

            String out = Main.handleConfigCommand(config,
                    "pricing glm-4.7 --cache-hit 20 --cache-miss 20 --output 60");

            assertEquals(1, config.getPricing().size());
            assertEquals("glm-4.7", config.getPricing().get(0).getModelPrefix());
            assertEquals(60.0, config.getPricing().get(0).getOutputPerM());
            assertTrue(out.contains("glm-4.7"), out);
        });
    }

    @Test
    @DisplayName("接线：同前缀再写一次是覆盖，不是加第二条")
    void upsertOverwritesSamePrefix(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();

            Main.handleConfigCommand(config, "pricing m --cache-hit 1 --cache-miss 1 --output 1");
            Main.handleConfigCommand(config, "pricing m --cache-hit 2 --cache-miss 2 --output 2");

            assertEquals(1, config.getPricing().size(), "同前缀该覆盖 —— 两条同名时哪条胜出是任意的");
            assertEquals(2.0, config.getPricing().get(0).getOutputPerM());
        });
    }

    @Test
    @DisplayName("接线：命中 0 个模型时给警示，但仍然写进去（可能在为还没配的模型预填价）")
    void zeroMatchWarnsButStillWrites(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = withProviders("freellmapi-4", "glm-4.7");

            String out = Main.handleConfigCommand(config,
                    "pricing gpt-5 --cache-hit 1 --cache-miss 1 --output 1");

            assertEquals(1, config.getPricing().size(), "不阻止保存");
            assertTrue(out.contains("⚠"), "但必须让他看见: " + out);
        });
    }

    @Test
    @DisplayName("接线：--remove 删掉那条；删不存在的报错而不是静默成功")
    void removeDeletesAndReportsMissing(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();
            Main.handleConfigCommand(config, "pricing m --cache-hit 1 --cache-miss 1 --output 1");

            String removed = Main.handleConfigCommand(config, "pricing --remove m");
            assertTrue(config.getPricing().isEmpty(), removed);

            String missing = Main.handleConfigCommand(config, "pricing --remove nope");
            assertTrue(missing.contains("❌"), "删不存在的该报错,不该静默成功: " + missing);
        });
    }

    @Test
    @DisplayName("接线：--list 同时列出用户条目与内置种子，种子标注不可编辑")
    void listShowsUserEntriesAndSeeds(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();
            Main.handleConfigCommand(config, "pricing my-model --cache-hit 1 --cache-miss 1 --output 1");

            String out = Main.handleConfigCommand(config, "pricing --list");

            assertTrue(out.contains("my-model"), out);
            assertTrue(out.contains("glm-5"), "内置种子也要列出: " + out);
            assertTrue(out.contains("内置"), "种子要标注: " + out);
        });
    }

    @Test
    @DisplayName("接线：写完调 ConfigReloadHook —— 否则本次会话状态栏仍不显示费用")
    void invokesReloadHookAfterWriting(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            boolean[] called = {false};
            Main.ConfigReloadHook hook = cfg -> called[0] = true;

            Main.handleConfigCommand(new WraithConfig(),
                    "pricing m --cache-hit 1 --cache-miss 1 --output 1", hook);

            assertTrue(called[0], "第六次 snapshot-vs-live：不刷新则写了等于没写");
        });
    }

    @Test
    @DisplayName("/config provider 与 /config search 两条路都没被 pricing 分支影响")
    void siblingBranchesStillWork(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            WraithConfig config = new WraithConfig();

            assertTrue(Main.handleConfigCommand(config, "provider myrelay --api-key sk-fake-relay")
                    .contains("myrelay"));
            assertTrue(Main.handleConfigCommand(config,
                    "search --provider searxng --base-url http://localhost:8888").contains("searxng"));
            assertFalse(config.getProviders().isEmpty());
            assertNotNull(config.getSearch());
        });
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest=PricingConfigCommandTest test`
Expected: 编译失败，`找不到符号: 方法 parsePricingConfigUpdate` 等

- [ ] **Step 3: 加 `ConfigReloadHook` + 两个 record，并改 `handleConfigCommand` 的第三参类型**

在 `Main.java` 的 `SearchConfigUpdate` record 之后插入：

```java
    /**
     * {@code /config} 写完后要刷新的活对象。
     *
     * <p>此前这里是 {@code ToolRegistry}（search 那条线为了失效搜索缓存加的），
     * 但 pricing 要刷的是 {@code Agent} 的计价表——继续往签名上加参数会一路长下去。
     * 收成一个回调：REPL 传一个 lambda 同时做两件事。
     */
    interface ConfigReloadHook {
        void afterConfigWrite(WraithConfig config);
    }

    enum PricingAction { LIST, UPSERT, REMOVE }

    record PricingConfigUpdate(PricingAction action, String modelPrefix,
                               double cacheHitPerM, double cacheMissPerM, double outputPerM,
                               String currency, String error) {
        static PricingConfigUpdate error(String error) {
            return new PricingConfigUpdate(null, null, 0, 0, 0, null, error);
        }
    }
```

把 `handleConfigCommand` 的两个重载改成（`:3314` 起）：

```java
    static String handleConfigCommand(WraithConfig config, String payload) {
        return handleConfigCommand(config, payload, null);
    }

    /**
     * @param hook 非 null 时，写完调 {@code afterConfigWrite}——搜索与计价配置改完都要
     *             立刻生效，不再需要重启后端（第五、第六次 snapshot-vs-live）。
     *             <b>无条件调用</b>而不是按分支调：多刷一次无害，而「再解析一遍 payload
     *             判断该刷谁」会让两处判断有分叉的机会。
     */
    static String handleConfigCommand(WraithConfig config, String payload, ConfigReloadHook hook) {
        List<String> head = splitArgs(payload);
        String first = head.isEmpty() ? "" : head.get(0).toLowerCase(Locale.ROOT);
        String result = switch (first) {
            case "search" -> applySearchConfig(config, payload);
            case "pricing" -> applyPricingConfig(config, payload);
            default -> applyProviderConfig(config, payload);
        };
        if (hook != null) {
            hook.afterConfigWrite(config);
        }
        return result;
    }
```

- [ ] **Step 4: 给 `normalizeConfigKey` 加三个映射**

`normalizeConfigKey`（`:3496` 的 switch）加：

```java
            case "cachehit", "cache_hit" -> "cache-hit";
            case "cachemiss", "cache_miss" -> "cache-miss";
            case "modelprefix", "model_prefix", "prefix" -> "model-prefix";
```

（`--cache-hit` 本来就会被 trim 成 `cache-hit`；这三条只是让 `--cacheHit` / `--cache_hit` 这类写法也认。）

- [ ] **Step 5: 写 `parsePricingConfigUpdate` / `validatePricingEntry` / `pricingMatchedModels` / `applyPricingConfig`**

在 `searchConfigUsage()` 之后插入：

```java
    private static final java.util.Set<String> PRICING_CURRENCIES = java.util.Set.of("CNY", "USD");

    /**
     * 一条计价条目的校验；返回 {@code null} 表示通过，否则是给人看的错误。
     * CLI 与 RPC 共用同一套规则——否则用户在一边被拒、在另一边写进去。
     *
     * <p><b>刻意不校验 {@code cacheHit <= cacheMiss}</b>：DeepSeek Flash 的真实牌价就是
     * 0.0028 vs 0.14，但反过来也可能存在，这不是 wraith 该管的。
     */
    static String validatePricingEntry(String modelPrefix, double cacheHit, double cacheMiss,
                                       double output, String currency) {
        if (modelPrefix == null || modelPrefix.isBlank()) {
            return "模型前缀不能为空（空前缀会命中所有模型）";
        }
        for (double v : new double[]{cacheHit, cacheMiss, output}) {
            if (Double.isNaN(v) || Double.isInfinite(v) || v < 0) {
                return "价格必须是 ≥ 0 的有限数字（算出负成本比不显示更糟）";
            }
        }
        String c = currency == null ? "" : currency.trim().toUpperCase(Locale.ROOT);
        if (!PRICING_CURRENCIES.contains(c)) {
            return "币种只支持 CNY 或 USD（状态栏只认这两种符号，填别的会一律显示成 ¥）";
        }
        return null;
    }

    /**
     * 这条前缀会命中哪几个已配置模型。
     *
     * <p>语义与 {@code PricingTable.Entry.matches(exact=false)} 一致：<b>小写后 startsWith</b>。
     * 用户填 {@code glm} 会命中 {@code glm-4.7} 与 {@code glm-5v-turbo}——把这件事显示出来，
     * 前缀语义就不再是静默的。
     */
    static List<String> pricingMatchedModels(String modelPrefix, WraithConfig config) {
        if (modelPrefix == null || modelPrefix.isBlank() || config == null
                || config.getProviders() == null) {
            return List.of();
        }
        String prefix = modelPrefix.trim().toLowerCase(Locale.ROOT);
        java.util.LinkedHashSet<String> hits = new java.util.LinkedHashSet<>();
        for (String id : config.getProviders().keySet()) {
            WraithConfig.ProviderConfig pc = config.getProviders().get(id);
            String model = pc == null ? null : pc.getModel();
            if (model != null && !model.isBlank()
                    && model.trim().toLowerCase(Locale.ROOT).startsWith(prefix)) {
                hits.add(model.trim());
            }
        }
        return List.copyOf(hits);
    }

    static PricingConfigUpdate parsePricingConfigUpdate(String payload) {
        List<String> args = splitArgs(payload);
        if (args.isEmpty() || !"pricing".equalsIgnoreCase(args.get(0))) {
            return PricingConfigUpdate.error("用法不正确");
        }
        if (args.size() == 1) {
            return new PricingConfigUpdate(PricingAction.LIST, null, 0, 0, 0, null, null);
        }

        String modelPrefix = null;
        Double cacheHit = null;
        Double cacheMiss = null;
        Double output = null;
        String currency = null;
        boolean list = false;
        String remove = null;

        for (int i = 1; i < args.size(); i++) {
            String token = args.get(i);
            if (!token.startsWith("-")) {
                if (modelPrefix != null) {
                    return PricingConfigUpdate.error("多余的参数: " + token);
                }
                modelPrefix = token;
                continue;
            }
            String key;
            String value = null;
            int equals = token.indexOf('=');
            if (equals > 0) {
                key = token.substring(0, equals);
                value = token.substring(equals + 1);
            } else {
                key = token;
            }
            String normalized = normalizeConfigKey(key);
            if ("list".equals(normalized)) {
                list = true;
                continue;
            }
            if (value == null) {
                if (i + 1 >= args.size()) {
                    return PricingConfigUpdate.error("缺少 " + key + " 的值");
                }
                value = args.get(++i);
            }
            switch (normalized) {
                case "remove" -> remove = value;
                case "model-prefix" -> modelPrefix = value;
                case "cache-hit" -> {
                    Double parsed = parsePricingNumber(value);
                    if (parsed == null) return PricingConfigUpdate.error("--cache-hit 不是数字: " + value);
                    cacheHit = parsed;
                }
                case "cache-miss" -> {
                    Double parsed = parsePricingNumber(value);
                    if (parsed == null) return PricingConfigUpdate.error("--cache-miss 不是数字: " + value);
                    cacheMiss = parsed;
                }
                case "output" -> {
                    Double parsed = parsePricingNumber(value);
                    if (parsed == null) return PricingConfigUpdate.error("--output 不是数字: " + value);
                    output = parsed;
                }
                case "currency" -> currency = value;
                default -> {
                    return PricingConfigUpdate.error("未知配置项: " + key);
                }
            }
        }

        if (remove != null) {
            if (remove.isBlank()) return PricingConfigUpdate.error("--remove 需要一个模型前缀");
            return new PricingConfigUpdate(PricingAction.REMOVE, remove.trim(), 0, 0, 0, null, null);
        }
        if (list) {
            return new PricingConfigUpdate(PricingAction.LIST, null, 0, 0, 0, null, null);
        }
        // 三个价一个都不能缺:缺省成 0 会把「免费」当成事实,违反 PricingTable 的「宁缺勿虚」
        if (cacheHit == null || cacheMiss == null || output == null) {
            return PricingConfigUpdate.error(
                    "三个价都要给：--cache-hit / --cache-miss / --output（缺省成 0 会把「免费」当成事实）");
        }
        String resolvedCurrency = currency == null || currency.isBlank()
                ? "CNY" : currency.trim().toUpperCase(Locale.ROOT);
        String invalid = validatePricingEntry(modelPrefix, cacheHit, cacheMiss, output, resolvedCurrency);
        if (invalid != null) {
            return PricingConfigUpdate.error(invalid);
        }
        return new PricingConfigUpdate(PricingAction.UPSERT, modelPrefix.trim(),
                cacheHit, cacheMiss, output, resolvedCurrency, null);
    }

    /** 数字解析：解析不出返回 null（由调用方报「不是数字」并把原串回给用户）。 */
    private static Double parsePricingNumber(String value) {
        try {
            return Double.parseDouble(value.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private static String pricingConfigUsage() {
        return """
                用法:
                  /config pricing --list
                  /config pricing glm-4.7 --cache-hit 20 --cache-miss 20 --output 60
                  /config pricing Qwen/Qwen3-8B --cache-hit 0.5 --cache-miss 0.5 --output 1.5 --currency CNY
                  /config pricing --remove glm-4.7
                说明:
                  价格单位是「每百万 token」;币种只支持 CNY / USD。
                  模型前缀是**前缀匹配**:填 glm 会让 glm-4.7、glm-5v-turbo 套同一个价。
                """.stripTrailing();
    }

    private static String applyPricingConfig(WraithConfig config, String payload) {
        PricingConfigUpdate update = parsePricingConfigUpdate(payload);
        if (update.error() != null) {
            return "❌ " + update.error() + "\n" + pricingConfigUsage();
        }
        return switch (update.action()) {
            case LIST -> pricingList(config);
            case REMOVE -> pricingRemove(config, update.modelPrefix());
            case UPSERT -> pricingUpsert(config, update);
        };
    }

    private static String pricingList(WraithConfig config) {
        StringBuilder out = new StringBuilder("📊 模型计价（价格单位：每百万 token）\n");
        List<com.lyhn.wraith.context.PricingTable.View> view =
                new com.lyhn.wraith.context.PricingTable(config.getPricing()).view();
        for (com.lyhn.wraith.context.PricingTable.View v : view) {
            com.lyhn.wraith.context.PricingTable.Price p = v.price();
            String symbol = "USD".equalsIgnoreCase(p.currency()) ? "$" : "¥";
            out.append("   ").append(v.modelKey())
                    .append(v.seeded() ? "  (内置，不可改)" : "")
                    .append("  ").append(symbol).append(p.cacheHitPerM())
                    .append(" / ").append(symbol).append(p.cacheMissPerM())
                    .append(" / ").append(symbol).append(p.outputPerM())
                    .append('\n');
            if (!v.seeded()) {
                List<String> hits = pricingMatchedModels(v.modelKey(), config);
                out.append("      ").append(hits.isEmpty()
                        ? "⚠ 当前不命中任何已配置模型" : "会命中：" + String.join("、", hits)).append('\n');
            }
        }
        out.append("   添加/修改: /config pricing <模型前缀> --cache-hit X --cache-miss Y --output Z");
        return out.toString();
    }

    private static String pricingRemove(WraithConfig config, String modelPrefix) {
        List<WraithConfig.PricingEntry> entries = config.getPricing();
        boolean removed = entries.removeIf(e -> e.getModelPrefix() != null
                && e.getModelPrefix().trim().equalsIgnoreCase(modelPrefix));
        if (!removed) {
            return "❌ 没有前缀为 " + modelPrefix + " 的计价条目（内置种子不可删）\n" + pricingConfigUsage();
        }
        config.save();
        return "✅ 已删除计价条目: " + modelPrefix;
    }

    private static String pricingUpsert(WraithConfig config, PricingConfigUpdate update) {
        List<WraithConfig.PricingEntry> entries = config.getPricing();
        // 同前缀覆盖而不是加第二条:最长前缀相同时哪条胜出是任意的
        entries.removeIf(e -> e.getModelPrefix() != null
                && e.getModelPrefix().trim().equalsIgnoreCase(update.modelPrefix()));
        WraithConfig.PricingEntry entry = new WraithConfig.PricingEntry();
        entry.setModelPrefix(update.modelPrefix());
        entry.setCacheHitPerM(update.cacheHitPerM());
        entry.setCacheMissPerM(update.cacheMissPerM());
        entry.setOutputPerM(update.outputPerM());
        entry.setCurrency(update.currency());
        entries.add(entry);
        config.save();

        String symbol = "USD".equals(update.currency()) ? "$" : "¥";
        StringBuilder out = new StringBuilder("✅ 已保存计价: ").append(update.modelPrefix()).append('\n');
        out.append("   ").append(symbol).append(update.cacheHitPerM())
                .append(" / ").append(symbol).append(update.cacheMissPerM())
                .append(" / ").append(symbol).append(update.outputPerM())
                .append("  每百万 token（缓存命中 / 缓存未中 / 输出）\n");
        List<String> hits = pricingMatchedModels(update.modelPrefix(), config);
        out.append("   ").append(hits.isEmpty()
                        ? "⚠ 当前不命中任何已配置模型 —— 前缀写对了吗？（预填未来要用的模型也正常）"
                        : "会命中：" + String.join("、", hits))
                .append('\n');
        out.append("   已立即生效，不需要重启。");
        return out.toString();
    }
```

`providerConfigUsage()` 的用法块补一行（`/config search` 那行之后）：

```java
                  /config pricing --list
```

- [ ] **Step 6: REPL 接线（`:743`）**

把 `:743` 那行改成：

```java
                            ui.println(handleConfigCommand(config, command.payload(), cfg -> {
                                // 两件事一起做:失效搜索缓存(第五次) + 重载计价表(第六次 snapshot-vs-live)
                                hitlToolRegistry.invalidateSearchProvider();
                                reactAgent.reloadPricingTable(cfg);
                            }));
```

（`hitlToolRegistry` 声明在 `:258`、`reactAgent` 在 `:347`，都在同一个 try-with-resources 块内且只赋值一次，lambda 捕获合法。）

- [ ] **Step 7: 改那条唯一受影响的既有测试**

`src/test/java/com/lyhn/wraith/cli/SearchConfigCommandTest.java` 的 `invalidatesSearchCacheAfterWriting`（`:145-155`）此前传的是 `ToolRegistry` 子类。改成断「hook 被调」。

⚠️ **不要试图在这个测试里直接验「registry 的缓存真被清空了」**：`setSearchProviderForTest` / `searchProviderSnapshotForTest` 是 `com.lyhn.wraith.tool` **包可见**的，而这个测试在 `com.lyhn.wraith.cli` 包，够不到。那件事由 `tool` 包里的 `SearchProviderCacheTest` 继续守（它已经在验，且做过判别力自证）。

```java
    @Test
    @DisplayName("接线：写完调 ConfigReloadHook —— 否则本次会话仍用旧 provider / 旧计价表")
    void invokesReloadHookAfterWriting(@TempDir Path tempDir) {
        withTempConfigDir(tempDir, () -> {
            // 第三参此前是 ToolRegistry,断言的是「registry 被失效了」;pricing 也要刷 Agent 的
            // 计价表,继续加参数会一路长下去,故收成 ConfigReloadHook。
            // 「invalidateSearchProvider 真的清空了缓存」由 tool 包里的 SearchProviderCacheTest
            // 继续守（那两个测试钩子是包可见的，这里够不到）。
            boolean[] called = {false};

            Main.handleConfigCommand(new WraithConfig(),
                    "search --provider searxng --base-url http://localhost:8888",
                    cfg -> called[0] = true);

            assertTrue(called[0], "第五、第六次 snapshot-vs-live：不刷新则写了等于没写");
        });
    }
```

同时删掉该文件里已不需要的 `import com.lyhn.wraith.tool.ToolRegistry;`（若无其它用处），并按需保留 `assertTrue`。

- [ ] **Step 8: 跑测试**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest='PricingConfigCommandTest,SearchConfigCommandTest,SearchProviderCacheTest,CliCommandParserTest' test`
Expected: 全部 PASS

- [ ] **Step 9: 跑全量**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 10: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/PricingConfigCommandTest.java \
        src/test/java/com/lyhn/wraith/cli/SearchConfigCommandTest.java
git commit -m "$(cat <<'EOF'
feat(pricing): /config pricing 写入口 —— pricing 节终于有 CLI 能写

pricing 是 config.json 五节里唯一 CLI 与桌面两边都没有写入口的一节,用户只能
手改 JSON。而中转站实付价只有用户自己知道(官方牌价≠实付价),所以「能填」比
「表里有什么」重要得多——某用户 6 个中转站模型在种子表里一条都不命中,状态栏
对他永远不显示费用估算。

  /config pricing --list
  /config pricing glm-4.7 --cache-hit 20 --cache-miss 20 --output 60
  /config pricing --remove glm-4.7

三个价一个都不能缺:缺省成 0 会把「免费」当成事实,违反 PricingTable 的
「宁缺勿虚」。币种只收 CNY/USD——formatCost 只认 USD→$,其余一律渲染 ¥,
允许 EUR 会骗人。刻意不校验 cacheHit<=cacheMiss:真实牌价两个方向都存在。

同前缀再写是覆盖而不是加第二条(最长前缀相同时哪条胜出是任意的);--remove 删
不存在的报错而不是静默成功。

前缀语义此前是静默的:填 glm 会让 glm-4.7 与 glm-5v-turbo 套同一个价。
pricingMatchedModels() 把「这条会命中你哪几个已配置模型」算出来,--list 与写入
回显都显示它;命中 0 个时警示但不阻止保存(可能在为还没配的模型预填价)。

handleConfigCommand 第三参从 ToolRegistry 改成 ConfigReloadHook: search 要刷
搜索缓存、pricing 要刷 Agent 的计价表,继续往签名上加参数会一路长下去。REPL 传
一个 lambda 同时做两件事。SearchConfigCommandTest 那条接线测试跟着改成断 hook
被调——「invalidateSearchProvider 真清空了缓存」由 tool 包里的
SearchProviderCacheTest 继续守(那两个测试钩子是包可见的,cli 包够不到)。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 3: `config.getPricing` / `config.setPricing` 两条 RPC

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`（`:271-277` 接口 default 区、`:786-802` dispatch 区）
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（`:1868-1885` session 实现区，紧邻 `embeddingGet/Set`）
- Test: `src/test/java/com/lyhn/wraith/cli/PricingRpcTest.java`（新建）

**Interfaces:**
- Consumes: `PricingTable.view()`、`Agent.reloadPricingTable`（Task 1）、`Main.validatePricingEntry`（Task 2）
- Produces:
  ```java
  // AppServer.Session
  default java.util.Map<String, Object> pricingGet()
  default java.util.Map<String, Object> pricingSet(java.util.List<java.util.Map<String, Object>> entries)
  ```
  RPC 名：`config.getPricing`（无参）/ `config.setPricing`（`{entries: [...]}`）
  回包：`getPricing` → `{entries: [{modelPrefix, cacheHitPerM, cacheMissPerM, outputPerM, currency, seeded}]}`；
  `setPricing` → `{ok: true}` 或 `{ok: false, error: "<人话>"}`

- [ ] **Step 1: 写会红的测试**

新建 `src/test/java/com/lyhn/wraith/cli/PricingRpcTest.java`：

```java
package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * config.getPricing / config.setPricing 的载荷契约。
 *
 * <p>这里只测<b>纯逻辑部分</b>——把 config 转成回包、把回包校验成 config：
 * session 实现要 app-server 整套装配（LlmClient、SessionStore…），端到端由真机验。
 * 校验规则与 CLI 共用 {@code Main.validatePricingEntry}，所以这里重点测
 * <b>整表替换语义</b>与<b>列表级重复前缀</b>——那两条 CLI 侧没有对应场景。
 */
class PricingRpcTest {

    private static Map<String, Object> row(String prefix, double hit, double miss,
                                           double out, String currency) {
        return Map.of("modelPrefix", prefix, "cacheHitPerM", hit, "cacheMissPerM", miss,
                "outputPerM", out, "currency", currency);
    }

    @Test
    @DisplayName("整表替换：旧条目被清掉，不是合并")
    void setReplacesWholeListRatherThanMerging() {
        WraithConfig config = new WraithConfig();
        Main.applyPricingEntries(config, List.of(row("old-a", 1, 1, 1, "CNY"),
                row("old-b", 1, 1, 1, "CNY")));
        assertEquals(2, config.getPricing().size());

        String error = Main.applyPricingEntries(config, List.of(row("new-only", 2, 2, 2, "USD")));

        assertEquals(null, error);
        assertEquals(1, config.getPricing().size(), "整表替换 —— old-a/old-b 该消失");
        assertEquals("new-only", config.getPricing().get(0).getModelPrefix());
        assertEquals("USD", config.getPricing().get(0).getCurrency());
    }

    @Test
    @DisplayName("空表是合法的（用户可以把计价全删掉）")
    void emptyListIsValid() {
        WraithConfig config = new WraithConfig();
        Main.applyPricingEntries(config, List.of(row("x", 1, 1, 1, "CNY")));

        assertEquals(null, Main.applyPricingEntries(config, List.of()));
        assertTrue(config.getPricing().isEmpty());
    }

    @Test
    @DisplayName("同表内重复前缀被拒（忽略大小写）—— 两条同名时哪条胜出是任意的")
    void duplicatePrefixIsRejected() {
        WraithConfig config = new WraithConfig();

        String error = Main.applyPricingEntries(config,
                List.of(row("glm-4.7", 1, 1, 1, "CNY"), row("GLM-4.7", 2, 2, 2, "CNY")));

        assertNotNull(error);
        assertTrue(error.contains("glm-4.7") || error.contains("GLM-4.7"), error);
        assertTrue(config.getPricing().isEmpty(), "校验失败时一条都不该落进去");
    }

    @Test
    @DisplayName("单条非法（负价 / 空前缀 / 非法币种）整批拒绝，不部分写入")
    void invalidEntryRejectsWholeBatch() {
        WraithConfig config = new WraithConfig();

        assertNotNull(Main.applyPricingEntries(config,
                List.of(row("ok", 1, 1, 1, "CNY"), row("bad", -1, 1, 1, "CNY"))));
        assertTrue(config.getPricing().isEmpty(), "不该只写进合法那条");

        assertNotNull(Main.applyPricingEntries(config, List.of(row("", 1, 1, 1, "CNY"))));
        assertNotNull(Main.applyPricingEntries(config, List.of(row("x", 1, 1, 1, "EUR"))));
    }

    @Test
    @DisplayName("缺字段的行按 0 读、缺币种按 CNY —— 但 0 价仍要过校验（合法）")
    void missingFieldsGetDefaults() {
        WraithConfig config = new WraithConfig();

        String error = Main.applyPricingEntries(config,
                List.of(Map.of("modelPrefix", "free-model")));

        assertEquals(null, error, "0 价是合法的：确实有免费模型");
        assertEquals("CNY", config.getPricing().get(0).getCurrency());
        assertEquals(0.0, config.getPricing().get(0).getOutputPerM());
    }

    @Test
    @DisplayName("回包同时带用户条目与种子，seeded 标对")
    void getPayloadCarriesSeedFlag() {
        WraithConfig config = new WraithConfig();
        Main.applyPricingEntries(config, List.of(row("my-model", 1, 1, 1, "CNY")));

        Map<String, Object> payload = Main.pricingPayload(config);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> entries = (List<Map<String, Object>>) payload.get("entries");
        assertNotNull(entries);
        assertTrue(entries.stream().anyMatch(e -> "my-model".equals(e.get("modelPrefix"))
                && Boolean.FALSE.equals(e.get("seeded"))));
        assertTrue(entries.stream().anyMatch(e -> "glm-5".equals(e.get("modelPrefix"))
                && Boolean.TRUE.equals(e.get("seeded"))), "内置种子也要回,并标 seeded");
        assertFalse(entries.isEmpty());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest=PricingRpcTest test`
Expected: 编译失败，`找不到符号: 方法 applyPricingEntries` / `pricingPayload`

- [ ] **Step 3: 在 `Main` 加两个静态（RPC 与 session 实现共用）**

在 `applyPricingConfig` 之后插入：

```java
    /** {@code config.getPricing} 的回包：用户条目 + 内置种子，各带 {@code seeded}。 */
    static java.util.Map<String, Object> pricingPayload(WraithConfig config) {
        List<java.util.Map<String, Object>> rows = new ArrayList<>();
        for (com.lyhn.wraith.context.PricingTable.View v
                : new com.lyhn.wraith.context.PricingTable(config.getPricing()).view()) {
            java.util.Map<String, Object> row = new LinkedHashMap<>();
            row.put("modelPrefix", v.modelKey());
            row.put("cacheHitPerM", v.price().cacheHitPerM());
            row.put("cacheMissPerM", v.price().cacheMissPerM());
            row.put("outputPerM", v.price().outputPerM());
            row.put("currency", v.price().currency());
            row.put("seeded", v.seeded());
            rows.add(row);
        }
        return java.util.Map.of("entries", rows);
    }

    /**
     * {@code config.setPricing} 的落地：<b>整表替换</b>。返回 {@code null} 表示成功，
     * 否则是给人看的错误（此时 config <b>一条都不写</b>）。
     *
     * <p>为什么整表替换而不是逐条 CRUD：{@code PricingEntry} 没有 id，{@code modelPrefix}
     * 是天然主键但用户会改它——「把 glm 改成 glm-4.7」在逐条 API 里是「改一条」还是
     * 「删一条加一条」有歧义，而歧义会在两个客户端之间分叉。
     *
     * <p>校验通过后才动 config：单条非法就整批拒绝，避免「写进去一半」这种最难排查的状态。
     */
    static String applyPricingEntries(WraithConfig config, List<java.util.Map<String, Object>> entries) {
        List<WraithConfig.PricingEntry> parsed = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (java.util.Map<String, Object> row : entries == null ? List.<java.util.Map<String, Object>>of() : entries) {
            String prefix = row.get("modelPrefix") == null ? "" : String.valueOf(row.get("modelPrefix")).trim();
            double hit = pricingNumberOf(row.get("cacheHitPerM"));
            double miss = pricingNumberOf(row.get("cacheMissPerM"));
            double out = pricingNumberOf(row.get("outputPerM"));
            String currency = row.get("currency") == null || String.valueOf(row.get("currency")).isBlank()
                    ? "CNY" : String.valueOf(row.get("currency")).trim().toUpperCase(Locale.ROOT);

            String invalid = validatePricingEntry(prefix, hit, miss, out, currency);
            if (invalid != null) {
                return invalid + "（条目：" + (prefix.isBlank() ? "(空)" : prefix) + "）";
            }
            if (!seen.add(prefix.toLowerCase(Locale.ROOT))) {
                return "重复的模型前缀: " + prefix + "（两条同名时哪条胜出是任意的）";
            }
            WraithConfig.PricingEntry entry = new WraithConfig.PricingEntry();
            entry.setModelPrefix(prefix);
            entry.setCacheHitPerM(hit);
            entry.setCacheMissPerM(miss);
            entry.setOutputPerM(out);
            entry.setCurrency(currency);
            parsed.add(entry);
        }
        config.setPricing(parsed);
        return null;
    }

    /** JSON 数字可能是 Integer/Double/String，统一读成 double；读不出按 0（0 价是合法的）。 */
    private static double pricingNumberOf(Object value) {
        if (value instanceof Number n) return n.doubleValue();
        if (value == null) return 0;
        try {
            return Double.parseDouble(String.valueOf(value).trim());
        } catch (Exception e) {
            return Double.NaN;   // 交给 validatePricingEntry 报「必须是有限数字」
        }
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest=PricingRpcTest test`
Expected: `Tests run: 6, Failures: 0, Errors: 0`

- [ ] **Step 5: `AppServer.Session` 加两个 default 方法**

在 `AppServer.java` 的 `embeddingSet` default（`:275-277`）之后插入：

```java
        default java.util.Map<String, Object> pricingGet() {
            throw new UnsupportedOperationException("pricingGet not implemented");
        }

        default java.util.Map<String, Object> pricingSet(java.util.List<java.util.Map<String, Object>> entries) {
            throw new UnsupportedOperationException("pricingSet not implemented");
        }
```

- [ ] **Step 6: 加 dispatch**

在 `config.setEmbedding` 那个 case（`:792-802`）之后插入：

```java
            case "config.getPricing" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.pricingGet()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.setPricing" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                java.util.List<java.util.Map<String, Object>> entries = new java.util.ArrayList<>();
                JsonNode arr = p == null ? null : p.get("entries");
                if (arr != null && arr.isArray()) {
                    for (JsonNode node : arr) {
                        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                        row.put("modelPrefix", node.hasNonNull("modelPrefix") ? node.get("modelPrefix").asText() : "");
                        row.put("cacheHitPerM", node.hasNonNull("cacheHitPerM") ? node.get("cacheHitPerM").asDouble() : 0d);
                        row.put("cacheMissPerM", node.hasNonNull("cacheMissPerM") ? node.get("cacheMissPerM").asDouble() : 0d);
                        row.put("outputPerM", node.hasNonNull("outputPerM") ? node.get("outputPerM").asDouble() : 0d);
                        row.put("currency", node.hasNonNull("currency") ? node.get("currency").asText() : "CNY");
                        entries.add(row);
                    }
                }
                try { writer.result(msg.id(), session.pricingSet(entries)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 7: session 实现 + 刷新那个会话的 Agent**

在 `Main.java` 的 `embeddingSet` 实现（`:1877-1885`）之后插入：

```java
                    public java.util.Map<String, Object> pricingGet() {
                        return pricingPayload(com.lyhn.wraith.config.WraithConfig.load());
                    }
                    public java.util.Map<String, Object> pricingSet(
                            java.util.List<java.util.Map<String, Object>> entries) {
                        com.lyhn.wraith.config.WraithConfig cfg =
                                com.lyhn.wraith.config.WraithConfig.load();
                        String error = applyPricingEntries(cfg, entries);
                        if (error != null) {
                            // 回 {ok:false,error} 而不是抛:表单要把这句话贴在字段旁边,
                            // 走 writer.error 的话前端只能弹一个通用失败框。
                            return java.util.Map.of("ok", false, "error", error);
                        }
                        cfg.save();
                        // 第六次 snapshot-vs-live:不刷新则本次会话状态栏仍用旧计价表
                        agent.reloadPricingTable(cfg);
                        return java.util.Map.of("ok", true);
                    }
```

变量名 `agent` 已核实：`Main.java:1326` 那处 `agent.setPricingTable(...)` 用的就是它，且它在这个匿名 `SessionRunner` 的作用域内可见（同一个类里 `:1844` 的 `sandboxGet()` 正在用 `agent.getToolRegistry()`）。**照原样写即可，不必再猜。**

- [ ] **Step 8: 跑测试**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false -Dtest='PricingRpcTest,PricingConfigCommandTest' test`
Expected: 全部 PASS

- [ ] **Step 9: 跑全量**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 10: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/PricingRpcTest.java
git commit -m "$(cat <<'EOF'
feat(pricing): config.getPricing / config.setPricing 两条 RPC

桌面表单要用的后端面,照 config.getEmbedding/setEmbedding 的样子接。

setPricing 是**整表替换**而不是逐条 CRUD: PricingEntry 没有 id,modelPrefix 是
天然主键但用户会改它——「把 glm 改成 glm-4.7」在逐条 API 里是「改一条」还是
「删一条加一条」有歧义,歧义会在两个客户端之间分叉。UI 持有草稿数组,保存时整体
覆盖。代价是两端同时改后写覆盖先写(embedding 也是同样取舍)。

校验通过后才动 config: 单条非法就整批拒绝,避免「写进去一半」这种最难排查的
状态。列表级另查重复前缀(忽略大小写)——两条同名时哪条胜出是任意的。
校验规则与 CLI 共用 validatePricingEntry,不写第二份。

回包带 seeded 标记,种子不可写(门槛是「两个独立可信来源对得上」)。
setPricing 失败回 {ok:false,error} 而不是抛异常:表单要把那句话贴在字段旁边,
走 writer.error 的话前端只能弹一个通用失败框。

写完调 agent.reloadPricingTable —— 第六次 snapshot-vs-live,不刷新则本次会话
状态栏仍用旧表。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 4: 桌面链路（types + preload + IPC）+ `pricingView.ts` 纯函数

**Files:**
- Modify: `desktop/src/shared/types.ts`（`EmbeddingConfigView`（`:408-413`）之后）
- Modify: `desktop/src/preload/index.ts`（`:115-116` 类型声明区、`:522-527` 实现区、`:2` 的 type import 列表）
- Modify: `desktop/src/main/index.ts`（`:1139` 的 `configSetEmbedding` handler 之后）
- Create: `desktop/src/renderer/lib/pricingView.ts`
- Test: `desktop/test/pricingView.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 的两条 RPC
- Produces:
  ```ts
  // shared/types.ts
  export interface PricingEntryView {
    modelPrefix: string; cacheHitPerM: number; cacheMissPerM: number
    outputPerM: number; currency: string; seeded?: boolean
  }
  export interface PricingListResult { entries: PricingEntryView[] }

  // preload → window.wraith
  configGetPricing(): Promise<PricingListResult>
  configSetPricing(entries: PricingEntryView[]): Promise<{ ok: boolean; error?: string }>

  // renderer/lib/pricingView.ts
  export function matchedModels(prefix: string, configuredModels: string[]): string[]
  export function validateEntries(entries: PricingEntryView[]): string | null   // null=通过
  export function currencySymbol(currency: string): string
  ```

- [ ] **Step 1: 写会红的测试**

新建 `desktop/test/pricingView.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { matchedModels, validateEntries, currencySymbol } from '../src/renderer/lib/pricingView'
import type { PricingEntryView } from '../src/shared/types'

function entry(over: Partial<PricingEntryView> = {}): PricingEntryView {
  return { modelPrefix: 'm', cacheHitPerM: 1, cacheMissPerM: 1, outputPerM: 1, currency: 'CNY', ...over }
}

// 后端 PricingTable 里 config 条目是前缀匹配、种子要求精确相等。这里复制的是**前缀**那一支
// (面板只编辑 config 条目)。这是一处刻意的双端重复实现,理由同 ragView.ts 的 embeddingDefaults:
// 为了不为一次 keystroke 发一趟 RPC。**改一边必须改另一边** —— 对应的 Java 侧是
// Main.pricingMatchedModels 与 PricingTable.Entry.matches(exact=false)。
describe('matchedModels', () => {
  const models = ['glm-4.7', 'glm-5v-turbo', 'Qwen/Qwen3-8B', 'deepseek-v4-pro']

  it('前缀命中多个 —— 这正是要显示给用户看的那件事', () => {
    expect(matchedModels('glm', models)).toEqual(['glm-4.7', 'glm-5v-turbo'])
  })

  it('完整模型名只命中自己', () => {
    expect(matchedModels('glm-4.7', models)).toEqual(['glm-4.7'])
  })

  it('大小写不敏感', () => {
    expect(matchedModels('qwen/', models)).toEqual(['Qwen/Qwen3-8B'])
    expect(matchedModels('DEEPSEEK', models)).toEqual(['deepseek-v4-pro'])
  })

  it('命中 0 个时是空数组，不是抛错', () => {
    expect(matchedModels('gpt-', models)).toEqual([])
  })

  it('空前缀不命中任何东西 —— 空前缀在后端会命中所有模型,但那是校验该拦的事', () => {
    expect(matchedModels('', models)).toEqual([])
    expect(matchedModels('   ', models)).toEqual([])
  })
})

describe('validateEntries', () => {
  it('合法表通过', () => {
    expect(validateEntries([entry({ modelPrefix: 'a' }), entry({ modelPrefix: 'b' })])).toBeNull()
  })

  it('空表合法 —— 用户可以把计价全删掉', () => {
    expect(validateEntries([])).toBeNull()
  })

  it('空前缀被拒 —— 空前缀会命中所有模型', () => {
    expect(validateEntries([entry({ modelPrefix: '' })])).toBeTruthy()
    expect(validateEntries([entry({ modelPrefix: '   ' })])).toBeTruthy()
  })

  it('负价被拒 —— 算出负成本比不显示更糟', () => {
    expect(validateEntries([entry({ cacheHitPerM: -1 })])).toBeTruthy()
    expect(validateEntries([entry({ outputPerM: -0.1 })])).toBeTruthy()
  })

  it('非有限数被拒', () => {
    expect(validateEntries([entry({ cacheMissPerM: NaN })])).toBeTruthy()
    expect(validateEntries([entry({ outputPerM: Infinity })])).toBeTruthy()
  })

  it('0 价合法 —— 确实有免费模型', () => {
    expect(validateEntries([entry({ cacheHitPerM: 0, cacheMissPerM: 0, outputPerM: 0 })])).toBeNull()
  })

  it('非法币种被拒 —— 状态栏只认 CNY/USD,填 EUR 会一律显示成 ¥', () => {
    expect(validateEntries([entry({ currency: 'EUR' })])).toBeTruthy()
  })

  it('重复前缀被拒（忽略大小写）—— 两条同名时哪条胜出是任意的', () => {
    const dup = validateEntries([entry({ modelPrefix: 'glm-4.7' }), entry({ modelPrefix: 'GLM-4.7' })])
    expect(dup).toBeTruthy()
    expect(dup).toMatch(/glm-4\.7/i)
  })

  it('报错文本点名是哪一条 —— 表单要把它贴在字段旁边', () => {
    expect(validateEntries([entry({ modelPrefix: 'my-model', outputPerM: -1 })])).toMatch(/my-model/)
  })
})

describe('currencySymbol', () => {
  it('只有 USD 是 $，其余都是 ¥（与后端 formatCost 一致）', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('usd')).toBe('$')
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('')).toBe('¥')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/pricingView.test.ts`
Expected: FAIL，`Failed to resolve import "../src/renderer/lib/pricingView"`

- [ ] **Step 3: 加共享类型**

`desktop/src/shared/types.ts` 在 `EmbeddingConfigView`（`:413` 的 `}`）之后插入：

```ts
/** 一条模型计价。seeded=内置种子（不可编辑）；价格单位是「每百万 token」。 */
export interface PricingEntryView {
  modelPrefix: string
  cacheHitPerM: number
  cacheMissPerM: number
  outputPerM: number
  currency: string
  seeded?: boolean
}

export interface PricingListResult {
  entries: PricingEntryView[]
}
```

- [ ] **Step 4: 新建 `pricingView.ts`**

```ts
import type { PricingEntryView } from '../../shared/types'

/**
 * 这条前缀会命中哪几个已配置模型。
 *
 * 语义与后端 `PricingTable.Entry.matches(exact=false)` / `Main.pricingMatchedModels` 一致：
 * **小写后 startsWith**。用户填 `glm` 会命中 `glm-4.7` 与 `glm-5v-turbo` —— 把这件事显示
 * 出来，前缀语义就不再是静默的。
 *
 * 这是一处刻意的双端重复实现（Java 一份、TS 一份），理由同 `ragView.ts` 的
 * `embeddingDefaults`：为了不为一次 keystroke 发一趟 RPC。**改一边必须改另一边。**
 */
export function matchedModels(prefix: string, configuredModels: string[]): string[] {
  const p = (prefix || '').trim().toLowerCase()
  if (!p) return []
  return configuredModels.filter((m) => (m || '').trim().toLowerCase().startsWith(p))
}

const CURRENCIES = ['CNY', 'USD']

/**
 * 整表校验；返回 null 表示通过，否则是给人看的错误（点名是哪一条，表单要贴在字段旁边）。
 *
 * 规则与后端 `Main.validatePricingEntry` + `applyPricingEntries` 的列表级查重一致 ——
 * 否则用户在一边被拒、在另一边写进去。
 */
export function validateEntries(entries: PricingEntryView[]): string | null {
  const seen = new Set<string>()
  for (const e of entries) {
    const prefix = (e.modelPrefix || '').trim()
    if (!prefix) return '模型前缀不能为空（空前缀会命中所有模型）'
    for (const [label, v] of [
      ['缓存命中', e.cacheHitPerM],
      ['缓存未中', e.cacheMissPerM],
      ['输出', e.outputPerM],
    ] as const) {
      if (!Number.isFinite(v) || v < 0) {
        return `${prefix} 的「${label}」必须是 ≥ 0 的数字（算出负成本比不显示更糟）`
      }
    }
    if (!CURRENCIES.includes((e.currency || '').trim().toUpperCase())) {
      return `${prefix} 的币种只支持 CNY 或 USD（状态栏只认这两种符号）`
    }
    const key = prefix.toLowerCase()
    if (seen.has(key)) return `重复的模型前缀 ${prefix}（两条同名时哪条胜出是任意的）`
    seen.add(key)
  }
  return null
}

/** 与后端 `PricingTable.formatCost` 一致：只有 USD 是 $，其余一律 ¥。 */
export function currencySymbol(currency: string): string {
  return (currency || '').trim().toUpperCase() === 'USD' ? '$' : '¥'
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/pricingView.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: 加 preload 桥**

`desktop/src/preload/index.ts`：
1. `:2` 的 type import 列表里加 `PricingListResult, PricingEntryView`
2. `:116` 的 `configSetEmbedding` 声明之后加：

```ts
  configGetPricing(): Promise<PricingListResult>
  configSetPricing(entries: PricingEntryView[]): Promise<{ ok: boolean; error?: string }>
```

3. `:527` 的 `configSetEmbedding` 实现之后加：

```ts
  configGetPricing() {
    return ipcRenderer.invoke('wraith:configGetPricing') as Promise<PricingListResult>
  },
  configSetPricing(entries) {
    return ipcRenderer.invoke('wraith:configSetPricing', entries) as Promise<{ ok: boolean; error?: string }>
  },
```

（**注意逗号**：照相邻条目的写法，别漏尾逗号。）

- [ ] **Step 7: 加主进程 IPC 转发**

`desktop/src/main/index.ts` 在 `wraith:configSetEmbedding` handler（`:1139` 的 `})`）之后插入：

```ts
// 模型计价(转发 config.getPricing / config.setPricing RPC)
ipcMain.handle('wraith:configGetPricing', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.getPricing', {})
})
ipcMain.handle('wraith:configSetPricing', async (_e, entries: unknown[]) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.setPricing', { entries })
})
```

- [ ] **Step 8: 类型检查 + 桌面全量**

```bash
cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit; echo "tsc exit=$?"; npx vitest run 2>&1 | tail -6
```
Expected: `tsc exit=0`；vitest 全绿（149 files → 150 files，1291 → 1291+新增）

- [ ] **Step 9: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/types.ts \
        desktop/src/preload/index.ts \
        desktop/src/main/index.ts \
        desktop/src/renderer/lib/pricingView.ts \
        desktop/test/pricingView.test.ts
git commit -m "$(cat <<'EOF'
feat(pricing): 桌面链路的三层 + 校验/命中判定纯函数

types → preload → 主进程 IPC 三层照 configGetEmbedding/SetEmbedding 的样子接完,
下一个提交的表单直接用。

pricingView.ts 是纯函数层,不碰 React,可单测:
- matchedModels(prefix, models): 这条前缀会命中哪几个已配置模型。语义与后端
  PricingTable.Entry.matches(exact=false) 一致(小写 startsWith)。这是一处刻意的
  双端重复实现,理由同 ragView.ts 的 embeddingDefaults: 为了不为一次 keystroke
  发一趟 RPC。注释里写明「改一边必须改另一边」
- validateEntries(entries): 与后端 validatePricingEntry + 列表级查重同规则——
  否则用户在一边被拒、在另一边写进去。报错文本点名是哪一条,表单要贴在字段旁边
- currencySymbol(currency): 与后端 formatCost 一致,只有 USD 是 $,其余一律 ¥

0 价是合法的(确实有免费模型);空前缀、负价、非有限数、非法币种、重复前缀被拒。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 5: 「设置 → 模型计价」表单 + NAV + 文档

**Files:**
- Create: `desktop/src/renderer/components/SettingsPricing.tsx`
- Modify: `desktop/src/renderer/components/SettingsPanel.tsx`（`:2` import、`:8` `Section` 类型、`:9-14` `NAV`、`:39-42` 渲染分支）
- Modify: `AGENTS.md`（§5 连带清单区，`### 5.2` 之后另起一条）
- Test: `desktop/test/settingsPricing.test.tsx`（新建）

**Interfaces:**
- Consumes: `window.wraith.configGetPricing/configSetPricing`、`window.wraith.modelList`（既有）、`pricingView.ts` 三个纯函数（Task 4）
- Produces: 无新 API

- [ ] **Step 1: 写会红的测试**

新建 `desktop/test/settingsPricing.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import SettingsPricing from '../src/renderer/components/SettingsPricing'

afterEach(cleanup)

const MODEL_LIST = {
  current: { provider: 'freellmapi-4', model: 'glm-4.7' },
  default: 'freellmapi-4',
  providers: [
    { name: 'freellmapi-4', model: 'glm-4.7', hasKey: true, baseUrl: '', protocol: 'openai', label: '' },
    { name: 'siliconflow', model: 'Qwen/Qwen3-8B', hasKey: true, baseUrl: '', protocol: 'openai', label: '' },
  ],
}

function stubWraith(entries: unknown[], setResult: { ok: boolean; error?: string } = { ok: true }): {
  configSetPricing: ReturnType<typeof vi.fn>
} {
  const configSetPricing = vi.fn().mockResolvedValue(setResult)
  ;(window as unknown as { wraith: unknown }).wraith = {
    configGetPricing: vi.fn().mockResolvedValue({ entries }),
    configSetPricing,
    modelList: vi.fn().mockResolvedValue(MODEL_LIST),
  }
  return { configSetPricing }
}

const USER_ROW = {
  modelPrefix: 'glm-4.7', cacheHitPerM: 20, cacheMissPerM: 20, outputPerM: 60,
  currency: 'CNY', seeded: false,
}
const SEED_ROW = {
  modelPrefix: 'glm-5', cacheHitPerM: 20, cacheMissPerM: 20, outputPerM: 60,
  currency: 'CNY', seeded: true,
}

describe('SettingsPricing', () => {
  it('渲染已有的用户条目与内置种子', async () => {
    stubWraith([USER_ROW, SEED_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    expect(screen.getByText(/glm-5/)).toBeTruthy()
  })

  it('种子行不可编辑 —— 门槛是「两个独立可信来源对得上」', async () => {
    stubWraith([SEED_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByText(/glm-5/)).toBeTruthy())
    // 种子渲染成静态文本,不是 input:找不到以它为值的输入框
    expect(screen.queryByDisplayValue('glm-5')).toBeNull()
  })

  it('保存只上传用户条目，种子不回传', async () => {
    const { configSetPricing } = stubWraith([USER_ROW, SEED_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
    const sent = configSetPricing.mock.calls[0][0] as { modelPrefix: string }[]
    expect(sent).toHaveLength(1)
    expect(sent[0].modelPrefix).toBe('glm-4.7')
  })

  it('加一行后保存传的是整表', async () => {
    const { configSetPricing } = stubWraith([USER_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-add'))
    fireEvent.change(screen.getByTestId('pricing-prefix-1'), { target: { value: 'Qwen/Qwen3-8B' } })
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
    const sent = configSetPricing.mock.calls[0][0] as { modelPrefix: string }[]
    expect(sent.map((e) => e.modelPrefix)).toEqual(['glm-4.7', 'Qwen/Qwen3-8B'])
  })

  it('删一行后保存传的是剩下的', async () => {
    const { configSetPricing } = stubWraith([USER_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-remove-0'))
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
    expect(configSetPricing.mock.calls[0][0]).toEqual([])
  })

  it('显示这条会命中哪几个模型 —— 前缀语义不再静默', async () => {
    stubWraith([{ ...USER_ROW, modelPrefix: 'glm' }])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm')).toBeTruthy())
    expect(screen.getByTestId('pricing-hits-0').textContent).toContain('glm-4.7')
  })

  it('命中 0 个时警示，但不阻止保存（可能在为还没配的模型预填价）', async () => {
    const { configSetPricing } = stubWraith([{ ...USER_ROW, modelPrefix: 'gpt-5' }])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('gpt-5')).toBeTruthy())
    expect(screen.getByTestId('pricing-hits-0').textContent).toMatch(/不命中|⚠/)

    fireEvent.click(screen.getByTestId('pricing-save'))
    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
  })

  it('前缀框挂 datalist，候选是已配置的模型名 —— 补掉「手敲敲错」这个代价', async () => {
    stubWraith([USER_ROW])
    const { container } = render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    const options = [...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))
    expect(options).toContain('glm-4.7')
    expect(options).toContain('Qwen/Qwen3-8B')
  })

  it('本地校验不过时不发 RPC，把错误显示出来', async () => {
    const { configSetPricing } = stubWraith([USER_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.change(screen.getByTestId('pricing-output-0'), { target: { value: '-5' } })
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(screen.getByTestId('pricing-error').textContent).toMatch(/glm-4\.7/))
    expect(configSetPricing).not.toHaveBeenCalled()
  })

  it('后端回 ok:false 时把它的话显示出来，不吞掉', async () => {
    stubWraith([USER_ROW], { ok: false, error: '重复的模型前缀 glm-4.7' })
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(screen.getByTestId('pricing-error').textContent).toContain('重复的模型前缀'))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/settingsPricing.test.tsx`
Expected: FAIL，`Failed to resolve import "../src/renderer/components/SettingsPricing"`

- [ ] **Step 3: 新建 `SettingsPricing.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Coins, Plus, Trash2 } from 'lucide-react'
import type { PricingEntryView } from '../../shared/types'
import { currencySymbol, matchedModels, validateEntries } from '../lib/pricingView'

/**
 * 「设置 → 模型计价」。
 *
 * 计价按**模型前缀**索引，不按 provider —— 一个中转站 provider 上可以跑多个模型，
 * 每个模型的实付价不同。所以这里不是「每个 provider 一行」。
 *
 * 用户选择把表单放在设置里（而不是 Providers 面板里每个模型旁给「填价」），
 * 代价是模型名要手敲、敲错就静默不生效。两处补偿：
 *   1. 前缀框挂 datalist，候选是已配置的模型名（复用 model.list，不加 RPC）
 *   2. 每行实时显示「这条会命中：…」；命中 0 个时警示，但**不阻止保存**
 *      （用户可能在为一个还没配的模型预填价）
 *
 * 保存是**整表替换**（见后端 applyPricingEntries 的注释）：种子行只读、不回传。
 */
export default function SettingsPricing(): JSX.Element {
  const [rows, setRows] = useState<PricingEntryView[]>([])
  const [seeds, setSeeds] = useState<PricingEntryView[]>([])
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await window.wraith.configGetPricing()
      setRows(r.entries.filter((e) => !e.seeded))
      setSeeds(r.entries.filter((e) => e.seeded))
    } catch (err) {
      setError((err as Error).message)
    }
    try {
      const m = await window.wraith.modelList()
      setModels(m.providers.map((p) => p.model).filter((s) => !!s && s.trim() !== ''))
    } catch {
      // 拿不到模型列表只是少了 datalist 候选与命中提示,不该让整个面板打不开
      setModels([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const patch = (i: number, over: Partial<PricingEntryView>): void =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...over } : r)))

  const num = (v: string): number => (v.trim() === '' ? 0 : Number(v))

  const save = async (): Promise<void> => {
    const invalid = validateEntries(rows)
    if (invalid) { setError(invalid); setNotice(''); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await window.wraith.configSetPricing(rows)
      if (r.ok) { setNotice('✅ 计价已保存，立即生效'); void load() } else { setError(r.error || '保存失败') }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const lbl = 'mb-1 block text-3xs uppercase tracking-wider text-fg-subtle'
  const inp = 'w-full rounded-lg border border-border bg-transparent px-2 py-1 text-xs outline-none placeholder:text-fg-subtle'

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex items-center gap-2 text-3xs uppercase tracking-wider text-fg-subtle">
          <Coins className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />模型计价
        </div>
        <p className="mb-3 text-2xs text-fg-muted">
          价格单位是「每百万 token」。<strong>模型前缀是前缀匹配</strong>：填 <code>glm</code> 会让
          所有 <code>glm-*</code> 套同一个价。官方牌价 ≠ 实付价，中转站的换算率只有你知道。
        </p>

        {error && <div data-testid="pricing-error" className="mb-2 text-xs text-danger">{error}</div>}
        {notice && <div className="mb-2 text-xs text-fg">{notice}</div>}

        <datalist id="pricing-model-options">
          {models.map((m) => <option key={m} value={m} />)}
        </datalist>

        {rows.map((r, i) => {
          const hits = matchedModels(r.modelPrefix, models)
          return (
            <div key={i} className="mb-3 rounded-lg border border-border p-2">
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <span className={lbl}>模型前缀</span>
                  <input data-testid={`pricing-prefix-${i}`} list="pricing-model-options" className={inp}
                    value={r.modelPrefix} placeholder="glm-4.7"
                    onChange={(e) => patch(i, { modelPrefix: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <span className={lbl}>缓存命中</span>
                  <input data-testid={`pricing-hit-${i}`} className={inp} value={String(r.cacheHitPerM)}
                    onChange={(e) => patch(i, { cacheHitPerM: num(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <span className={lbl}>缓存未中</span>
                  <input data-testid={`pricing-miss-${i}`} className={inp} value={String(r.cacheMissPerM)}
                    onChange={(e) => patch(i, { cacheMissPerM: num(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <span className={lbl}>输出</span>
                  <input data-testid={`pricing-output-${i}`} className={inp} value={String(r.outputPerM)}
                    onChange={(e) => patch(i, { outputPerM: num(e.target.value) })} />
                </div>
                <div className="col-span-1 flex items-end">
                  <button data-testid={`pricing-remove-${i}`} title="删除这条"
                    onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                    className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <select data-testid={`pricing-currency-${i}`} value={r.currency}
                  onChange={(e) => patch(i, { currency: e.target.value })}
                  className="rounded-lg border border-border bg-transparent px-2 py-1 text-xs outline-none">
                  <option value="CNY">CNY ¥</option>
                  <option value="USD">USD $</option>
                </select>
                <span data-testid={`pricing-hits-${i}`}
                  className={'text-2xs ' + (hits.length === 0 ? 'text-warn' : 'text-fg-muted')}>
                  {hits.length === 0
                    ? '⚠ 当前不命中任何已配置模型 —— 前缀写对了吗？（预填未来要用的模型也正常）'
                    : '会命中：' + hits.join('、')}
                </span>
              </div>
            </div>
          )
        })}

        <div className="flex items-center gap-2">
          <button data-testid="pricing-add"
            onClick={() => setRows([...rows, {
              modelPrefix: '', cacheHitPerM: 0, cacheMissPerM: 0, outputPerM: 0, currency: 'CNY',
            }])}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />添加一条
          </button>
          <button data-testid="pricing-save" disabled={busy} onClick={() => void save()}
            className="rounded-lg bg-accent/15 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {seeds.length > 0 && (
        <div>
          <div className={lbl}>内置牌价（不可改）</div>
          <p className="mb-2 text-2xs text-fg-muted">
            这些是实现时对官方 pricing 页核准过的<strong>确切</strong>模型标识符，精确匹配才命中。
            想覆盖某一条，在上面填一条同名的即可。
          </p>
          {seeds.map((s) => (
            <div key={s.modelPrefix} className="text-2xs text-fg-muted">
              {s.modelPrefix} — {currencySymbol(s.currency)}{s.cacheHitPerM} / {currencySymbol(s.currency)}{s.cacheMissPerM} / {currencySymbol(s.currency)}{s.outputPerM}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

告警色用 `text-warn`（已核实：`desktop/src` 里有 12 处既有用法；`text-warning` **不存在**，写它 `tsc` 不报错但样式会静默失效）。

- [ ] **Step 4: `SettingsPanel` 加 NAV 项**

`desktop/src/renderer/components/SettingsPanel.tsx` 四处改动：

```tsx
// :2 —— 加 Coins 图标
import { ArrowLeft, User, Palette, Bot, Coins, Info, type LucideIcon } from 'lucide-react'
// :3-6 之后 —— 加 import
import SettingsPricing from './SettingsPricing'

// :8
type Section = 'me' | 'interface' | 'pets' | 'pricing' | 'about'

// :9-14 —— 「关于」之前插一项
const NAV: { key: Section; label: string; Icon: LucideIcon }[] = [
  { key: 'me', label: '我', Icon: User },
  { key: 'interface', label: '界面', Icon: Palette },
  { key: 'pets', label: '宠物', Icon: Bot },
  { key: 'pricing', label: '计价', Icon: Coins },
  { key: 'about', label: '关于', Icon: Info },
]

// :39-42 —— 加渲染分支
          {active === 'pricing' && <SettingsPricing />}
```

（默认落地页仍是 `'me'`，`:19` 不动。）

- [ ] **Step 5: 跑桌面测试与类型检查**

```bash
cd /Users/aa00945/Desktop/wraith/desktop && npx tsc --noEmit; echo "tsc exit=$?"; npx vitest run 2>&1 | tail -6
```
Expected: `tsc exit=0`；vitest 全绿

- [ ] **Step 6: 补 `AGENTS.md` 连带清单**

在 `AGENTS.md` 的 `### 5.2 改 Web/搜索 …` 那一节（含它下面的 `>` 引用块）之后插入：

```markdown
### 5.3 改计价 → `PricingTable` + `Agent.reloadPricingTable` + `/config pricing` + 两条 RPC + 桌面「设置 → 模型计价」 + 测试

> 七层链路缺一层就是「填了没反应」：`PricingTable.view()`（只读视图，`seeded` 标不可写）→ `Main.validatePricingEntry`/`applyPricingEntries`（**校验规则 CLI 与 RPC 共用一份**，否则用户在一边被拒、在另一边写进去）→ `config.getPricing`/`config.setPricing`（**整表替换**，不是逐条 CRUD：`PricingEntry` 无 id 而 `modelPrefix` 会被用户改）→ `desktop/src/{shared/types,preload/index,main/index}.ts` → `renderer/lib/pricingView.ts`（`matchedModels` 是 Java 侧 `pricingMatchedModels` 的**双端重复实现，改一边必须改另一边**）→ `SettingsPricing.tsx`。
>
> **`reloadPricingTable` 不调则写了等于没写** —— `setPricingTable` 只在构造 Agent 时注入（`Main.java:348` 交互 CLI、`:1326` app-server 会话），这是本仓库第六次 snapshot-vs-live。
>
> `SEEDS` 一条不加不改不可写：门槛是「两个独立可信来源对得上」，中转站实付价没有公开来源（`PricingTable` 的核对记录里连 `glm-5.1` 都因多源矛盾而缺席）。用户条目同长度时已优先于种子。
>
> **config 条目是前缀匹配、种子要求精确相等** —— 这个差异是静默的（填 `glm` 会让 `glm-4.7` 与 `glm-5v-turbo` 套同一个价），所以两个写入口都要显示「这条会命中哪几个已配置模型」。

（原 `### 5.3 改 Memory …` 及之后各节序号顺延。）
```

⚠️ **实现者注意**：`AGENTS.md` 里 `### 5.3` 之后已有 `5.3 改 Memory` / `5.4` / `5.5`。**插入新节后必须把后面各节的编号顺延**（Memory → 5.4、HITL/策略 → 5.5、MCP → 5.6），并检查文中有没有「见 §5.4」这类交叉引用需要跟着改（`rg -n '§5\.|5\.4|5\.5' AGENTS.md`）。若顺延牵连过多，改为把本节编成 `### 5.6 改计价` 放在最后，不动既有编号 —— 两种都可以，选牵连小的那个并在 commit message 里说明。

- [ ] **Step 7: 跑 Java 全量（确认没被桌面改动牵连）**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 8: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/SettingsPricing.tsx \
        desktop/src/renderer/components/SettingsPanel.tsx \
        desktop/test/settingsPricing.test.tsx \
        AGENTS.md
git commit -m "$(cat <<'EOF'
feat(pricing): 桌面「设置 → 模型计价」表单

计价按模型前缀索引而不是按 provider —— 一个中转站 provider 上可以跑多个模型,
每个模型实付价不同,所以不是「每个 provider 一行」。

用户选了「设置里单开一节」这个落点(而不是 Providers 面板里每个模型旁给「填价」),
代价是模型名要手敲、敲错静默不生效。落点内两处补偿:
- 前缀框挂 datalist,候选是已配置的模型名(复用 model.list,不加 RPC)
- 每行实时显示「这条会命中:…」;命中 0 个时警示但**不阻止保存**——用户可能在
  为一个还没配的模型预填价

种子行只读且不回传(门槛是「两个独立可信来源对得上」)。保存是整表替换,本地先
过 validateEntries 再发 RPC;后端回 ok:false 时把它的话原样显示,不吞掉。
拿不到 model.list 只降级成「没有 datalist 候选与命中提示」,不让整个面板打不开。

AGENTS.md 加「改计价」一节,点明七层链路缺一层就是「填了没反应」、
reloadPricingTable 不调则写了等于没写、SEEDS 不可写的理由、以及 config 条目
前缀匹配与种子精确相等这个静默差异。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

## 收尾验收（全部任务完成后）

- [ ] Java 全量：`cd /Users/aa00945/Desktop/wraith && mvn -DskipTests=false test` → `0 Failures / 0 Errors`
- [ ] 桌面：`cd desktop && npx tsc --noEmit && npx vitest run` → tsc 0，vitest 全绿
- [ ] `git status --short` 干净；`git log --oneline -5` 五个提交各自只含本任务文件
- [ ] `git show --stat` 逐个确认**没有** `.env`、`demo/pom.xml`、`target/` 混进去
- [ ] 端到端手验一次 CLI：`/config pricing --list` → `/config pricing <你的模型> --cache-hit … ` → `/config pricing --list` 看到它 → `/config pricing --remove <前缀>`

## 真机验证（代码验不了的部分，交用户）

1. **状态栏真的开始显示费用** —— 填一条命中当前模型的价，**不重启**，发一句话，看 usage 行有没有出现估算。这是整条特性的验收点，也是 `reloadPricingTable` 的真机证明。
2. **桌面表单的手感** —— 一个 12 列网格的增删改在窄面板里够不够用，只能真机看。纯函数与渲染断言覆盖不到布局。
3. **`datalist` 在 Electron 里的行为** —— 原生 `datalist` 的下拉样式与触发方式各平台不同，jsdom 测的只是 `<option>` 有没有渲染出来。
4. **两客户端并发写** —— 桌面面板与 CLI 同时改会后写覆盖先写（spec §3.1 的已知取舍），单测测不到。
5. **告警行的颜色在深/浅色主题下都看得清** —— 用的是项目既有的 `text-warn`（12 处在用），但那 12 处的上下文背景与这里不同，只能真机看一眼。
