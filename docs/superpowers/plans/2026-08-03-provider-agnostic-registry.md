# Provider 注册表去硬编码 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删掉「那 6 家 provider」在仓库里的四份硬编码，让「谁是可用 provider」的唯一答案变成「config 或 env 里有 key 的」，顺带修掉「只配 anthropic 就启动不了」这个真 bug。

**Architecture:** 新增一个纯函数 `ProviderResolver.candidates(config)`，返回按优先级排序的 provider 候选表。四处硬编码列表（`ModelCatalog.KNOWN_PROVIDERS`、`LlmClientFactory` 回落数组、`WraithCompleter` 两处补全）全部改为消费这一个函数。`defaultProvider` 的硬编码初值 `"glm"` 改为 `null`，并在两个用户主动写入的时机自愈 stale 值。

**Tech Stack:** Java 17 / Maven / JUnit 5；桌面侧 TypeScript + Vitest + React。

**Spec:** `docs/superpowers/specs/2026-08-03-provider-agnostic-registry-design.md`

## Global Constraints

- **所有 `mvn` 命令必须带 `-DskipTests=false`** —— 本仓库测试默认跳过，不带这个参数会得到假绿。
- **不得读写真实 `~/.wraith/config.json`** —— 测试一律用 `new WraithConfig()` 内存对象或 `@TempDir`。此前 WeCom 的测试写过真实 config，已修，不要重犯。
- **不得依赖环境变量的真实取值** —— `ProviderResolver` 的测试入口必须注入 `envVarNames` / `keyLookup` / `baseUrlLookup` 三个查询。现有 `LlmClientFactoryRoutingTest.unknownProviderWithoutKeyReturnsNull` 就是靠「机器上恰好没设 `OPENAI_API_KEY`」才绿的，不要继承这个缺陷。
- **提交信息必须以这两行结尾**（顺序固定）：
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
  ```
- **`git add` 只加本任务涉及的文件**，禁止 `git add .` / `git add -A`。禁止碰这些 WIP 文件：`demo/pom.xml`。
- **不许伪造测试或评审结果。** 每个任务必须先看到红、再看到绿。
- **每个任务结束时必须干净**：`mvn -q compile -DskipTests=false` 通过，桌面任务另需 `npx tsc --noEmit` 零错误。
- 分支：当前 `feat/windows-parity-block1`。**不合 main**，Windows 相关工作未经真机验证前不上 main（本次改动不涉 Windows 路径，但分支纪律不变）。
- 提交后**不要 push**，等用户明确同意。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/main/java/com/lyhn/wraith/config/ProviderNames.java` | **新增。** provider 别名 → 规范名的**单一来源**（14 个别名，现私有于 `LlmClientFactory:62-71`）。 | Create |
| `src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java:62-71` | `normalizeProvider` 改为委托 `ProviderNames.normalize`，别名表不再各存一份。 | Modify |
| `src/main/java/com/lyhn/wraith/config/ProviderResolver.java` | **新增。** 唯一的「候选 provider 排序」逻辑。纯函数 + 一个生产包装。 | Create |
| `src/test/java/com/lyhn/wraith/config/ProviderResolverTest.java` | 上者的测试。 | Create |
| `src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java:47-60` | `createFromConfig` 改走 resolver，删 6 家数组。 | Modify |
| `src/test/java/com/lyhn/wraith/llm/LlmClientFactoryFallbackTest.java` | **新增。** 只覆盖 `createFromConfig` 的回落行为，不动现有两个 factory 测试文件。 | Create |
| `src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java` | 删 `KNOWN_PROVIDERS`；`providers()` 只报真有的；`result()` 报有效默认。 | Modify |
| `src/test/java/com/lyhn/wraith/runtime/appserver/ModelCatalogTest.java:159-170` | 改掉那条在断言 bug 的测试。 | Modify |
| `src/main/java/com/lyhn/wraith/cli/Main.java:1477-1503` | `configSetProvider` 存完自愈默认；`configRemoveProvider` 改调 resolver；修两处撒谎注释。 | Modify |
| `src/main/java/com/lyhn/wraith/cli/WraithCompleter.java:83-124` | 补全从注入的 config 现算。 | Modify |
| `src/test/java/com/lyhn/wraith/cli/WraithCompleterTest.java` | 加补全来自 config 的测试。 | Modify |
| `src/main/java/com/lyhn/wraith/config/WraithConfig.java:38` | `defaultProvider = "glm"` → `null`。 | Modify |
| `desktop/src/renderer/App.tsx:578` | 图片拦截文案去掉 `glm-5v-turbo` 举例。 | Modify |
| `desktop/test/providerAgnosticPanel.test.tsx` | **新增。** 空 providers / stale default 不崩。 | Create |

**为什么 `ProviderResolver` 放在 `config` 包**：它只依赖 `WraithConfig`，不依赖任何 `LlmClient`。放 `llm` 包会让 `ModelCatalog`（appserver 包）为了报一个默认值而依赖 `llm` 包。

**为什么新建 `LlmClientFactoryFallbackTest` 而不是往现有文件里加**：现有 `LlmClientFactoryTest`（测 `create` 单个 provider）和 `LlmClientFactoryRoutingTest`（测协议路由）职责清晰，回落是第三件事。

---

## Task 1: `ProviderResolver` —— 候选枚举

**Files:**
- Create: `src/main/java/com/lyhn/wraith/config/ProviderResolver.java`
- Test: `src/test/java/com/lyhn/wraith/config/ProviderResolverTest.java`

**Interfaces:**
- Consumes: `WraithConfig.getProviders()` → `Map<String, ProviderConfig>`（`LinkedHashMap`，保插入序）；`WraithConfig.getDefaultProvider()`；`WraithConfig.getApiKey(String)`；`WraithConfig.getBaseUrl(String)`
- Produces（四个方法，后续任务只用到前两个 public 的）：
  - `public static List<String> ProviderResolver.candidates(WraithConfig config)` —— 生产入口
  - `public static String ProviderResolver.effectiveDefault(WraithConfig config)` —— 候选首项，无候选时返回 `""`（不是 null）
  - `static List<String> ProviderResolver.candidates(WraithConfig, Set<String>, Function<String,String>, Function<String,String>)` —— 可测入口（包可见）
  - `static String ProviderResolver.effectiveDefault(WraithConfig, Set<String>, Function<String,String>, Function<String,String>)` —— 可测入口（包可见）

- [ ] **Step 1: 写失败的测试**

创建 `src/test/java/com/lyhn/wraith/config/ProviderResolverTest.java`：

```java
package com.lyhn.wraith.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 「谁是可用 provider」的唯一答案。
 *
 * <p><b>起因</b>：用户说「最开始面向 glm 只是因为我只有 glm 的，现在不应该出现只能用 glm
 * 才能完成的事情」。查下来 {@code {glm,deepseek,step,kimi,freellmapi,xfyun}} 这个列表在仓库里
 * 硬编码了四份，其中 {@code LlmClientFactory} 那份是可达真 bug：桌面里配好 anthropic 点保存，
 * {@code createFromConfig} 先试硬编码的 default "glm"（无 key）、再遍历那 6 家（anthropic 不在内），
 * 返回 null，用户看到「无可用模型」。
 *
 * <p><b>为什么三个查询全注入</b>：{@code WraithConfig.getApiKey} 会回落读真实环境变量。
 * 现有 {@code LlmClientFactoryRoutingTest.unknownProviderWithoutKeyReturnsNull} 断言
 * {@code create("openai", new WraithConfig())} 为 null —— 那条测试是靠「跑它的机器恰好没设
 * OPENAI_API_KEY」才绿的。这里不继承那个缺陷：本测试全部走注入入口，在任何机器上结果一致。
 */
class ProviderResolverTest {

    // ── 测试替身 ────────────────────────────────────────────────────────────

    /** 只认给定 map 的 key 查询;其余返回 null。 */
    private static Function<String, String> keys(Map<String, String> m) {
        return m::get;
    }

    private static Function<String, String> noBaseUrls() {
        return p -> null;
    }

    private static WraithConfig cfg(String defaultProvider, String... providerIdsWithKey) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(defaultProvider);
        c.setProviders(new LinkedHashMap<>());
        for (String id : providerIdsWithKey) {
            c.getProviders().put(id, new WraithConfig.ProviderConfig("sk-" + id, null, "m"));
        }
        return c;
    }

    // ── 顺序 ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("defaultProvider 有 key 时排第一")
    void defaultGoesFirst() {
        WraithConfig c = cfg("siliconflow", "anthropic", "siliconflow");
        List<String> got = ProviderResolver.candidates(c, Set.of(),
                keys(Map.of("anthropic", "sk-a", "siliconflow", "sk-s")), noBaseUrls());

        assertEquals("siliconflow", got.get(0), "显式默认必须优先: " + got);
        assertTrue(got.contains("anthropic"));
    }

    @Test
    @DisplayName("defaultProvider 无 key 时被跳过 —— 这就是 stale \"glm\" 的情形")
    void staleDefaultIsSkipped() {
        // 用户的老 config.json 里写着 defaultProvider:"glm"(硬编码初值落盘的),但 glm 没 key
        WraithConfig c = cfg("glm", "anthropic");
        List<String> got = ProviderResolver.candidates(c, Set.of(),
                keys(Map.of("anthropic", "sk-a")), noBaseUrls());

        assertEquals(List.of("anthropic"), got, "无 key 的 stale 默认不该占位: " + got);
    }

    @Test
    @DisplayName("config 内其余 provider 保持插入序(＝用户添加序)")
    void configOrderIsInsertionOrder() {
        WraithConfig c = cfg(null, "zeta", "alpha", "mid");
        List<String> got = ProviderResolver.candidates(c, Set.of(),
                keys(Map.of("zeta", "k", "alpha", "k", "mid", "k")), noBaseUrls());

        assertEquals(List.of("zeta", "alpha", "mid"), got, "不许按字母排序: " + got);
    }

    @Test
    @DisplayName("config 里有条目但没 key(只填了 model)→ 不是候选")
    void configEntryWithoutKeyIsNotCandidate() {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(null);
        c.setProviders(new LinkedHashMap<>());
        c.getProviders().put("openai", new WraithConfig.ProviderConfig(null, null, "gpt-4.1"));

        assertEquals(List.of(), ProviderResolver.candidates(
                c, Set.of(), keys(Map.of()), noBaseUrls()));
    }

    @Test
    @DisplayName("什么都没有 → 空表,不抛")
    void nothingConfiguredIsEmpty() {
        WraithConfig c = cfg(null);
        assertEquals(List.of(), ProviderResolver.candidates(
                c, Set.of(), keys(Map.of()), noBaseUrls()));
    }

    @Test
    @DisplayName("defaultProvider 为 null/空白都不能 NPE")
    void blankDefaultIsSafe() {
        assertDoesNotThrow(() -> ProviderResolver.candidates(
                cfg(null, "glm"), Set.of(), keys(Map.of("glm", "k")), noBaseUrls()));
        assertDoesNotThrow(() -> ProviderResolver.candidates(
                cfg("   ", "glm"), Set.of(), keys(Map.of("glm", "k")), noBaseUrls()));
    }

    // ── env-only 发现(D3) ───────────────────────────────────────────────────

    @Test
    @DisplayName("env 里的 ANTHROPIC_API_KEY 能被发现 —— 从没打开过桌面面板的用户也能起来")
    void discoversEnvOnlyProvider() {
        WraithConfig c = cfg(null);   // config 里一个 provider 都没有
        List<String> got = ProviderResolver.candidates(c,
                Set.of("ANTHROPIC_API_KEY"),
                keys(Map.of("anthropic", "sk-ant")),
                noBaseUrls());

        assertEquals(List.of("anthropic"), got);
    }

    @Test
    @DisplayName("config 与 env 同名只出现一次")
    void dedupesConfigAndEnv() {
        WraithConfig c = cfg(null, "anthropic");
        List<String> got = ProviderResolver.candidates(c,
                Set.of("ANTHROPIC_API_KEY"),
                keys(Map.of("anthropic", "sk-a")),
                noBaseUrls());

        assertEquals(List.of("anthropic"), got, "去重失败: " + got);
    }

    @Test
    @DisplayName("env 候选排在 config 候选之后 —— 显式配置优先于环境残留")
    void envComesAfterConfig() {
        WraithConfig c = cfg(null, "siliconflow");
        List<String> got = ProviderResolver.candidates(c,
                Set.of("ANTHROPIC_API_KEY"),
                keys(Map.of("siliconflow", "sk-s", "anthropic", "sk-a")),
                noBaseUrls());

        assertEquals(List.of("siliconflow", "anthropic"), got);
    }

    // ── env 发现的护栏 ───────────────────────────────────────────────────────

    @Test
    @DisplayName("端点定不了的 env 候选被挡 —— 否则会静默指向 api.openai.com")
    void envCandidateWithoutResolvableEndpointIsBlocked() {
        // GenericOpenAiClient 在 baseUrl 为空时兜底 https://api.openai.com/v1,
        // 所以一个无关的 MY_SERVICE_API_KEY 不是「连不上」,而是把 key 发给 OpenAI。
        WraithConfig c = cfg(null);
        List<String> got = ProviderResolver.candidates(c,
                Set.of("MY_SERVICE_API_KEY"),
                keys(Map.of("my_service", "sk-x")),
                noBaseUrls());

        assertEquals(List.of(), got, "端点未知的 env 候选必须被挡: " + got);
    }

    @Test
    @DisplayName("给了 <NAME>_BASE_URL 就放行 —— 自建服务的正当用法")
    void envCandidateWithExplicitBaseUrlPasses() {
        WraithConfig c = cfg(null);
        List<String> got = ProviderResolver.candidates(c,
                Set.of("MY_SERVICE_API_KEY", "MY_SERVICE_BASE_URL"),
                keys(Map.of("my_service", "sk-x")),
                p -> "my_service".equals(p) ? "https://llm.internal/v1" : null);

        assertEquals(List.of("my_service"), got);
    }

    @Test
    @DisplayName("端点可确定的 8 家不需要 BASE_URL 也放行")
    void builtinEndpointProvidersPassWithoutBaseUrl() {
        for (String p : List.of("glm", "deepseek", "step", "kimi",
                                "freellmapi", "xfyun", "anthropic", "openai")) {
            WraithConfig c = cfg(null);
            List<String> got = ProviderResolver.candidates(c,
                    Set.of(p.toUpperCase() + "_API_KEY"),
                    keys(Map.of(p, "sk-k")),
                    noBaseUrls());
            assertEquals(List.of(p), got, p + " 应有内置端点,不该被护栏挡下");
        }
    }

    // ── env 发现的排除项 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("EMBEDDING_API_KEY 不是 provider —— 那是 RAG 的 embedding 后端")
    void embeddingKeyIsNotAProvider() {
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("EMBEDDING_API_KEY"), keys(Map.of("embedding", "sk-e")), noBaseUrls());
        assertEquals(List.of(), got);
    }

    @Test
    @DisplayName("任意 WRAITH_* 都被挡 —— 验的是前缀规则,不是硬编码两个名字")
    void wraithOwnNamespaceIsExcluded() {
        // WRAITH_RUNTIME_API_KEY 是 wraith 自己的 Runtime HTTP API 认证 key(见 docs/phase-20)。
        // 用一个不存在的名字一起验,确保实现写的是前缀规则而非枚举 —— 将来新增自动被挡。
        for (String v : List.of("WRAITH_RUNTIME_API_KEY", "WRAITH_FUTURE_THING_API_KEY")) {
            List<String> got = ProviderResolver.candidates(cfg(null),
                    Set.of(v), k -> "sk-anything", p -> "https://x/v1");
            assertEquals(List.of(), got, v + " 不该成为 provider 候选");
        }
    }

    @Test
    @DisplayName("不匹配 <NAME>_API_KEY 的变量天然不参与")
    void unrelatedEnvVarsAreIgnored() {
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("SERPAPI_KEY", "SEARXNG_URL", "SEARCH_PROVIDER", "REMOTE_TOKEN", "PATH"),
                k -> "sk-anything", p -> "https://x/v1");
        assertEquals(List.of(), got);
    }

    // ── 原始名不可预先 normalize ──────────────────────────────────────────────

    @Test
    @DisplayName("MOONSHOT_API_KEY 产出 moonshot 而非 kimi —— 预先 normalize 会掐断双查")
    void keepsRawDiscoveredName() {
        // normalizeProvider("moonshot")→"kimi",而 getApiKey("kimi") 读的是 KIMI_API_KEY(不存在)。
        // MOONSHOT_API_KEY 之所以能用,靠的是 LlmClientFactory:20-23 用原始名再查一次。
        // resolver 若吐 "kimi",这条双查就失去输入。
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("MOONSHOT_API_KEY"), keys(Map.of("moonshot", "sk-m")), noBaseUrls());

        assertEquals(List.of("moonshot"), got);
    }

    @Test
    @DisplayName("XFYUN_MAAS_API_KEY 这个不规则名映射到 xfyun")
    void irregularAliasMapsToProvider() {
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("XFYUN_MAAS_API_KEY"), keys(Map.of("xfyun", "sk-x")), noBaseUrls());

        assertEquals(List.of("xfyun"), got);
    }

    @Test
    @DisplayName("别名的端点护栏要按**规范名**判 —— 否则 14 个别名会被全部误挡")
    void aliasesPassTheEndpointGuardByNormalizedName() {
        // ENDPOINT_KNOWN 装的是规范名。若拿原始名直接查表,moonshot/stepfun/iflytek…
        // 都会被挡下 —— 而它们规范化后是 kimi/step/xfyun,端点都由 bespoke client 烧死了。
        // 每对里前者是发现到的原始名(候选必须保留它),后者是它规范化后的名字。
        record Alias(String envName, String rawProvider) {}
        for (Alias a : List.of(
                new Alias("MOONSHOT_API_KEY", "moonshot"),
                new Alias("STEPFUN_API_KEY", "stepfun"),
                new Alias("IFLYTEK_API_KEY", "iflytek"),
                new Alias("FREELLM_API_KEY", "freellm"))) {
            List<String> got = ProviderResolver.candidates(cfg(null),
                    Set.of(a.envName()), keys(Map.of(a.rawProvider(), "sk-k")), noBaseUrls());

            assertEquals(List.of(a.rawProvider()), got,
                    a.envName() + " 应产出原始名 " + a.rawProvider() + " 且不被端点护栏挡下");
        }
    }

    // ── effectiveDefault ────────────────────────────────────────────────────

    @Test
    @DisplayName("effectiveDefault = 候选首项;一个都没有时返回空串(不是 null)")
    void effectiveDefaultIsFirstCandidate() {
        WraithConfig withOne = cfg("glm", "anthropic");   // stale default
        assertEquals("anthropic", ProviderResolver.effectiveDefault(withOne, Set.of(),
                keys(Map.of("anthropic", "sk-a")), noBaseUrls()));

        assertEquals("", ProviderResolver.effectiveDefault(cfg(null), Set.of(),
                keys(Map.of()), noBaseUrls()), "空串便于直接进 JSON,不必在调用方判 null");
    }

    // ── 健壮性 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("key 查询抛异常不能把启动带崩")
    void lookupFailureIsNotFatal() {
        WraithConfig c = cfg(null, "anthropic");
        assertDoesNotThrow(() -> ProviderResolver.candidates(c, Set.of(),
                k -> { throw new IllegalStateException("配置文件坏了"); }, noBaseUrls()));
    }
}
```

- [ ] **Step 2: 跑测试确认它红**

```bash
cd /Users/aa00945/Desktop/wraith
mvn -q test -DskipTests=false -Dtest=ProviderResolverTest
```

Expected: 编译失败 —— `cannot find symbol: class ProviderResolver`。

- [ ] **Step 3a: 抽出别名表（`ProviderNames`）**

创建 `src/main/java/com/lyhn/wraith/config/ProviderNames.java`：

```java
package com.lyhn.wraith.config;

import java.util.Locale;

/**
 * provider 别名 → 规范名的<b>单一来源</b>。
 *
 * <p>这张表原先私有在 {@code LlmClientFactory.normalizeProvider}（:62-71）。抽出来的原因：
 * {@link ProviderResolver} 的端点护栏也要用它——{@code MOONSHOT_API_KEY} 发现出的候选是
 * {@code moonshot}，而端点白名单装的是规范名 {@code kimi}，不规范化就查会把它误挡下，
 * 尽管 {@code KimiClient.DEFAULT_BASE_URL}（{@code https://api.moonshot.ai/v1}）确实存在。
 *
 * <p>本次改动的主题就是「同一份 provider 名单别抄多份」，所以这里不复制一份别名表，
 * 而是让 {@code LlmClientFactory} 反过来委托这里。
 */
public final class ProviderNames {

    private ProviderNames() {}

    /**
     * 别名归一。表外的名字原样返回（小写、去空白）——新 provider 不需要登记就能用。
     * 入参为 null 时返回 null。
     */
    public static String normalize(String provider) {
        if (provider == null) {
            return null;
        }
        String normalized = provider.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "stepfun", "step-fun" -> "step";
            case "moonshot", "moonshotai", "moonshot-ai" -> "kimi";
            case "free-llm-api", "free_llm_api", "freellm", "free-llm" -> "freellmapi";
            case "xfyun-maas", "xfyun_maas", "iflytek", "iflytek-maas", "iflytek_maas", "maas" -> "xfyun";
            default -> normalized;
        };
    }
}
```

然后把 `src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java:62-71` 的 `normalizeProvider`
改为委托（**不要**删掉这个方法，`create()` 里还在调它）：

```java
    /** 委托 {@link com.lyhn.wraith.config.ProviderNames}——别名表只存一份。 */
    private static String normalizeProvider(String provider) {
        return com.lyhn.wraith.config.ProviderNames.normalize(provider);
    }
```

⚠️ 注意原方法**没有** null 保护（`provider.trim()` 会 NPE），但 `create()` 在调它之前
已经 `if (provider == null) return null;`。`ProviderNames.normalize` 增加了 null 保护，
是放宽而非收紧，不影响现有调用。

- [ ] **Step 3b: 写 `ProviderResolver` 实现**

创建 `src/main/java/com/lyhn/wraith/config/ProviderResolver.java`：

```java
package com.lyhn.wraith.config;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * 「谁是可用 provider」的唯一答案：<b>config 或 env 里有 key 的就是</b>。
 *
 * <p><b>它替换掉了什么</b>：此前 {@code {glm,deepseek,step,kimi,freellmapi,xfyun}} 这个列表在
 * 仓库里硬编码了四份（{@code ModelCatalog.KNOWN_PROVIDERS}、{@code LlmClientFactory} 的回落数组、
 * {@code WraithCompleter} 的两处补全），互不一致，且其中 factory 那份是可达 bug——
 * 只配了 anthropic 的用户拿不到 client。
 *
 * <p>这条规则不是新发明的：{@code Main.configRemoveProvider} 早就在用「挑下一个有 key 的」，
 * 只是只装在了删除路径上。本类把它推广到启动回落、{@code model.list} 载荷与命令补全。
 *
 * <p><b>为什么查询要注入</b>：{@link WraithConfig#getApiKey(String)} 会回落读真实环境变量。
 * 若在本类内部直接读环境，测试结果就取决于跑它的机器设了什么变量
 * （现有 {@code LlmClientFactoryRoutingTest.unknownProviderWithoutKeyReturnsNull} 就有这个毛病）。
 * 注入是本仓库既有做法，见 {@code SearchProviderFactory.resolveKey}。
 */
public final class ProviderResolver {

    private ProviderResolver() {}

    /**
     * env 变量名 → provider id 的不规则映射。
     *
     * <p>只收「名字对不上 {@code NAME_API_KEY} 规律」的那几个；规律内的靠
     * {@link #providerFromEnvName} 的通用规则处理。与 {@code WraithConfig.loadApiKeyFromEnv}
     * 的 switch 一一对应，改那边记得改这边。
     */
    private static final Map<String, String> IRREGULAR_ENV_NAMES = Map.of(
            "XFYUN_MAAS_API_KEY", "xfyun");

    /**
     * 端点可确定的 provider —— env-only 发现的护栏白名单。
     *
     * <p><b>这张表的作用与被删掉的四份白名单相反</b>：白名单是*限制*谁能被创建，
     * 这张表是*允许* env-only 发现。不在表里的 provider 依然可用，只是需要显式
     * {@code <NAME>_BASE_URL} 或写进 config.json。
     *
     * <p><b>为什么必须有这道护栏</b>：{@code GenericOpenAiClient} 在 baseUrl 为空时兜底
     * {@code https://api.openai.com/v1}。所以一个无关的 {@code MY_SERVICE_API_KEY} 不是
     * 「连不上」——它会<b>静默把那个 key 发给 OpenAI</b>。这比失败更糟。
     *
     * <p>逐个 client 类核实的来源：GLMClient/DeepSeekClient 构造器不收 baseUrl（烧死）；
     * Step/Kimi/FreeLlmApi/XfyunMaaS 各有 {@code DEFAULT_BASE_URL}；
     * AnthropicClient 有 {@code DEFAULT_BASE}；openai 命中 GenericOpenAiClient 的兜底。
     *
     * <p><b>装的是规范名</b>，所以查表前必须先过 {@link ProviderNames#normalize}——
     * 否则 {@code MOONSHOT_API_KEY} 发现出的 {@code moonshot} 会被误挡：
     * 它规范化后是 {@code kimi}，而 {@code KimiClient.DEFAULT_BASE_URL}
     * （{@code https://api.moonshot.ai/v1}）确实存在，端点是可确定的。
     * 14 个别名都吃这个坑。
     */
    private static final Set<String> ENDPOINT_KNOWN = Set.of(
            "glm", "deepseek", "step", "kimi", "freellmapi", "xfyun", "anthropic", "openai");

    /** 不是推理 provider 的 {@code *_API_KEY}。{@code WRAITH_} 走前缀规则，不进这里。 */
    private static final Set<String> EXCLUDED_ENV_NAMES = Set.of("EMBEDDING_API_KEY");

    private static final String KEY_SUFFIX = "_API_KEY";
    private static final String BASE_URL_SUFFIX = "_BASE_URL";

    // ── 生产入口 ────────────────────────────────────────────────────────────

    /** 扫真实 env + {@code ./.env} + {@code ~/.env}；key/baseUrl 走 config 自带取值链。 */
    public static List<String> candidates(WraithConfig config) {
        return candidates(config, ambientEnvVarNames(), config::getApiKey, config::getBaseUrl);
    }

    /** 有效默认 provider：候选首项；一个都没有时返回空串（便于直接进 JSON）。 */
    public static String effectiveDefault(WraithConfig config) {
        return effectiveDefault(config, ambientEnvVarNames(), config::getApiKey, config::getBaseUrl);
    }

    // ── 可测入口（三个查询全注入） ───────────────────────────────────────────

    static String effectiveDefault(WraithConfig config,
                                   Set<String> envVarNames,
                                   Function<String, String> keyLookup,
                                   Function<String, String> baseUrlLookup) {
        List<String> list = candidates(config, envVarNames, keyLookup, baseUrlLookup);
        return list.isEmpty() ? "" : list.get(0);
    }

    /**
     * 按优先级列出「值得一试」的 provider id：
     * <ol>
     *   <li>{@code defaultProvider}（仅当它拿得到 key）</li>
     *   <li>{@code config.getProviders()} 中其余有 key 的，保持插入序＝用户添加序</li>
     *   <li>env 发现的（过了护栏与排除清单），附在末尾</li>
     * </ol>
     * 空表 = 一个都没配。任何查询抛异常都当作「没有」，不向外传播——
     * 配置文件坏了不该让整个后端起不来。
     */
    static List<String> candidates(WraithConfig config,
                                   Set<String> envVarNames,
                                   Function<String, String> keyLookup,
                                   Function<String, String> baseUrlLookup) {
        if (config == null) {
            return List.of();
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();

        String explicit = config.getDefaultProvider();
        if (explicit != null && !explicit.isBlank() && hasKey(explicit.trim(), keyLookup)) {
            out.add(explicit.trim());
        }
        if (config.getProviders() != null) {
            for (String id : config.getProviders().keySet()) {
                if (id != null && !id.isBlank() && hasKey(id, keyLookup)) {
                    out.add(id);
                }
            }
        }
        for (String discovered : discoverFromEnv(envVarNames)) {
            if (out.contains(discovered)) {
                continue;
            }
            if (hasKey(discovered, keyLookup) && endpointResolvable(discovered, baseUrlLookup)) {
                out.add(discovered);
            }
        }
        return List.copyOf(out);
    }

    // ── 内部 ────────────────────────────────────────────────────────────────

    private static boolean hasKey(String provider, Function<String, String> keyLookup) {
        try {
            String key = keyLookup.apply(provider);
            return key != null && !key.isBlank();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 端点能不能确定：显式 {@code <NAME>_BASE_URL}，或规范化后落在 {@link #ENDPOINT_KNOWN}。
     * 只对 env 发现的候选生效——config 里写下的条目是用户的明确意图，不替他判断。
     *
     * <p><b>必须先 normalize。</b> {@code ENDPOINT_KNOWN} 装的是规范名，而传进来的是
     * 发现到的原始名（{@code moonshot}、{@code stepfun}、{@code iflytek}…）。
     * 不 normalize 就查，14 个别名会被全部误挡——而它们的端点其实都由对应的
     * bespoke client 烧死了。
     */
    private static boolean endpointResolvable(String provider, Function<String, String> baseUrlLookup) {
        if (ENDPOINT_KNOWN.contains(ProviderNames.normalize(provider))) {
            return true;
        }
        try {
            String url = baseUrlLookup.apply(provider);
            return url != null && !url.isBlank();
        } catch (Exception e) {
            return false;
        }
    }

    /** 从变量名集合里挑出 provider 候选，保持稳定顺序（按变量名排序，避免 Set 迭代序不定）。 */
    private static List<String> discoverFromEnv(Set<String> envVarNames) {
        if (envVarNames == null || envVarNames.isEmpty()) {
            return List.of();
        }
        List<String> sorted = new ArrayList<>(envVarNames);
        sorted.sort(null);
        List<String> out = new ArrayList<>();
        for (String name : sorted) {
            String provider = providerFromEnvName(name);
            if (provider != null && !out.contains(provider)) {
                out.add(provider);
            }
        }
        return out;
    }

    /**
     * {@code <NAME>_API_KEY} → {@code lowercase(NAME)}；不规则名走 {@link #IRREGULAR_ENV_NAMES}。
     * 不是推理 provider 的返回 null。
     */
    private static String providerFromEnvName(String envName) {
        if (envName == null) {
            return null;
        }
        String name = envName.trim();
        String irregular = IRREGULAR_ENV_NAMES.get(name);
        if (irregular != null) {
            return irregular;
        }
        if (!name.endsWith(KEY_SUFFIX) || name.length() <= KEY_SUFFIX.length()) {
            return null;
        }
        if (EXCLUDED_ENV_NAMES.contains(name)) {
            return null;
        }
        // wraith 自己的配置命名空间(如 WRAITH_RUNTIME_API_KEY —— Runtime HTTP API 的认证 key)。
        // 写成前缀规则而非枚举:将来新增 WRAITH_*_API_KEY 自动被挡,不必回来补名单。
        if (name.startsWith("WRAITH_")) {
            return null;
        }
        return name.substring(0, name.length() - KEY_SUFFIX.length()).toLowerCase(Locale.ROOT);
    }

    /** 真实环境里存在的变量名：{@code System.getenv()} ∪ {@code ./.env} ∪ {@code ~/.env}。 */
    private static Set<String> ambientEnvVarNames() {
        LinkedHashSet<String> names = new LinkedHashSet<>(System.getenv().keySet());
        for (File f : new File[]{new File(".env"), new File(System.getProperty("user.home"), ".env")}) {
            if (!f.exists()) {
                continue;
            }
            try (BufferedReader reader = new BufferedReader(new FileReader(f))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) {
                        continue;
                    }
                    int eq = line.indexOf('=');
                    if (eq > 0) {
                        names.add(line.substring(0, eq).trim());
                    }
                }
            } catch (Exception ignored) {
                // .env 读不了就当它不存在 —— 不该因此让启动失败
            }
        }
        return names;
    }
}
```

- [ ] **Step 4: 跑测试确认它绿**

```bash
mvn -q test -DskipTests=false -Dtest=ProviderResolverTest
```

Expected: PASS，18 个测试全绿。

若 `builtinEndpointProvidersPassWithoutBaseUrl` 里 `openai` 那轮失败，检查 `providerFromEnvName("OPENAI_API_KEY")` 是否返回 `"openai"`。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/config/ProviderNames.java \
        src/main/java/com/lyhn/wraith/config/ProviderResolver.java \
        src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java \
        src/test/java/com/lyhn/wraith/config/ProviderResolverTest.java
git commit -F - <<'EOF'
feat(config): ProviderResolver——「谁是可用 provider」收敛成一个纯函数

规则:config 或 env 里有 key 的就是。顺序 = 显式 default(若有 key) →
config 内其余有 key 的(插入序) → env 发现的。

这条规则不是新发明:Main.configRemoveProvider 早就在用「挑下一个有 key 的」,
只是只装在了删除路径上。本类是为了把它推广到启动回落 / model.list / 命令补全,
替掉那四份互不一致的硬编码列表(后续任务逐个接上)。

三个查询(env 变量名集合 / key / baseUrl)全部注入而非内部读环境。原因:
WraithConfig.getApiKey 会回落读真实环境变量,现有
LlmClientFactoryRoutingTest.unknownProviderWithoutKeyReturnsNull 断言
create("openai", new WraithConfig()) 为 null —— 那条测试是靠跑它的机器恰好
没设 OPENAI_API_KEY 才绿的。不继承这个缺陷。

env 发现带两道闸:
- 排除:EMBEDDING_API_KEY(RAG 的后端)、WRAITH_ 前缀(自家命名空间,如
  WRAITH_RUNTIME_API_KEY 是 Runtime HTTP API 的认证 key)。写成前缀规则,
  将来新增自动被挡。
- 护栏:端点定不了的不放行。GenericOpenAiClient 在 baseUrl 空时兜底
  api.openai.com,所以无关的 MY_SERVICE_API_KEY 不是「连不上」而是会把那个
  key 静默发给 OpenAI —— 比失败更糟。ENDPOINT_KNOWN 八家逐个核实过来源。

候选名保留发现到的原始名,不预先 normalize:MOONSHOT_API_KEY 是活证据 ——
normalizeProvider("moonshot")→"kimi",而 getApiKey("kimi") 读 KIMI_API_KEY
(不存在),它能用全靠 LlmClientFactory:20-23 用原始名再查一次。

但端点护栏必须按**规范名**判:ENDPOINT_KNOWN 装的是规范名,拿原始名直接查会把
14 个别名全部误挡 —— moonshot 规范化后是 kimi,而 KimiClient.DEFAULT_BASE_URL
(https://api.moonshot.ai/v1)确实存在,它的端点本来就是可确定的。为此把别名表
从 LlmClientFactory 私有的 normalizeProvider 抽成 config 包的 ProviderNames,
LlmClientFactory 反过来委托 —— 本次改动的主题就是「同一份 provider 名单别抄多份」,
不能为了护栏再复制一份别名表。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## Task 2: `createFromConfig` 走 resolver —— 修「只配 anthropic 起不来」

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java:47-60`
- Test: `src/test/java/com/lyhn/wraith/llm/LlmClientFactoryFallbackTest.java`（Create）

**Interfaces:**
- Consumes: `ProviderResolver.candidates(WraithConfig)`（Task 1）
- Produces：
  - `public static LlmClient LlmClientFactory.createFromConfig(WraithConfig)` —— 签名不变，行为变（不再局限于 6 家）
  - `static LlmClient LlmClientFactory.createFrom(WraithConfig, List<String> candidates)` —— **新增包可见重载**，供测试注入候选表

⚠️ 加重载的理由与 Task 3 相同：`createFromConfig` 会扫真实环境变量，
所以「什么都没配 → 返回 null」这条断言若走 public 入口，
在设了 `ANTHROPIC_API_KEY` 的开发机上会拿到一个 client 而失败。
其余几条测试的 provider 都写在 `config.getProviders()` 里，候选表必含它们，不受 env 影响。

- [ ] **Step 1: 写失败的测试**

创建 `src/test/java/com/lyhn/wraith/llm/LlmClientFactoryFallbackTest.java`：

```java
package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@code createFromConfig} 的回落：配了 key 的 provider 必须能被找到，无论它是谁。
 *
 * <p><b>修的是什么 bug</b>：此前回落遍历的是硬编码数组
 * {@code {glm,deepseek,step,kimi,freellmapi,xfyun}}。链路：
 * {@code WraithConfig.defaultProvider} 硬编码初值 {@code "glm"} → {@code save()} 整对象落盘，
 * 全新安装就把它写进 config.json → {@code configSetProvider} 存 provider 时从不设默认 →
 * {@code createFromConfig} 先试 glm（无 key，null）→ 再遍历那 6 家 → anthropic 不在内 → null
 * → 用户在桌面里配好 anthropic 点保存，看到「无可用模型」。
 *
 * <p>用户自己的 config 就中了：6 个 provider（freellmapi、freellmapi-2..5、siliconflow），
 * 白名单只覆盖裸 freellmapi 一个 —— 连自家的多实例命名都覆盖不到。
 *
 * <p>这些测试都显式建 config 对象、不读真实文件；provider 的 key 直接写在 ProviderConfig 里，
 * 所以不依赖机器上的环境变量。
 */
class LlmClientFactoryFallbackTest {

    /** 一个「只配了某个 provider + defaultProvider 是 stale glm」的 config。 */
    private static WraithConfig staleDefaultWith(String id, String protocol, String baseUrl) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider("glm");            // 老 config.json 里落盘的硬编码初值
        c.setProviders(new LinkedHashMap<>());
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig("sk-test", baseUrl, "m");
        if (protocol != null) {
            pc.setProtocol(protocol);
        }
        c.getProviders().put(id, pc);
        return c;
    }

    @Test
    @DisplayName("只配 anthropic + stale glm 默认 → 拿得到 AnthropicClient(这条此前是红的)")
    void anthropicOnlyIsFound() {
        LlmClient client = LlmClientFactory.createFromConfig(
                staleDefaultWith("anthropic", "anthropic", "https://api.anthropic.com"));

        assertNotNull(client, "配好 anthropic 却拿不到 client —— 就是这个 bug");
        assertInstanceOf(AnthropicClient.class, client);
    }

    @Test
    @DisplayName("只配 siliconflow(白名单外的 openai-compatible)→ 拿得到 GenericOpenAiClient")
    void unlistedOpenAiCompatibleIsFound() {
        LlmClient client = LlmClientFactory.createFromConfig(
                staleDefaultWith("siliconflow", "openai", "https://api.siliconflow.cn/v1"));

        assertNotNull(client);
        assertInstanceOf(GenericOpenAiClient.class, client);
        assertEquals("siliconflow", client.getProviderName());
    }

    @Test
    @DisplayName("只配 freellmapi-5 这种多实例 id → 拿得到 client(旧白名单只有裸 freellmapi)")
    void repeatableInstanceIdIsFound() {
        LlmClient client = LlmClientFactory.createFromConfig(
                staleDefaultWith("freellmapi-5", "openai", "http://localhost:5173/v1"));

        assertNotNull(client, "多实例 id 不该因为不在白名单里就被跳过");
    }

    @Test
    @DisplayName("显式 defaultProvider 有 key 时优先它,不被回落抢走")
    void explicitDefaultWins() {
        WraithConfig c = new WraithConfig();
        c.setProviders(new LinkedHashMap<>());
        // anthropic 排在前面,但 default 指向 deepseek —— 显式选择必须赢
        WraithConfig.ProviderConfig ant =
                new WraithConfig.ProviderConfig("sk-a", "https://api.anthropic.com", "m");
        ant.setProtocol("anthropic");
        c.getProviders().put("anthropic", ant);
        c.getProviders().put("deepseek", new WraithConfig.ProviderConfig("sk-d", null, "m"));
        c.setDefaultProvider("deepseek");

        assertInstanceOf(DeepSeekClient.class, LlmClientFactory.createFromConfig(c));
    }

    @Test
    @DisplayName("一个 provider 都没配 → null(交由调用方给人话,不是 NPE)")
    void nothingConfiguredIsNull() {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(null);
        c.setProviders(new LinkedHashMap<>());

        // 走注入重载:public 入口会扫真实环境变量,这条断言在设了 ANTHROPIC_API_KEY 的
        // 开发机上会拿到一个 client 而失败、在干净 CI 上通过 —— 那种测试没有判别力。
        assertNull(LlmClientFactory.createFrom(c, java.util.List.of()));
    }

    @Test
    @DisplayName("多个都有 key 时按插入序取第一个 —— 结果可预期,不随 Map 实现变")
    void firstConfiguredWinsWhenNoDefault() {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(null);
        c.setProviders(new LinkedHashMap<>());
        c.getProviders().put("deepseek", new WraithConfig.ProviderConfig("sk-d", null, "m"));
        c.getProviders().put("step", new WraithConfig.ProviderConfig("sk-s", null, "m"));

        assertInstanceOf(DeepSeekClient.class, LlmClientFactory.createFromConfig(c));
    }
}
```

- [ ] **Step 2: 跑测试确认前三条红**

```bash
mvn -q test -DskipTests=false -Dtest=LlmClientFactoryFallbackTest
```

Expected: `anthropicOnlyIsFound` / `unlistedOpenAiCompatibleIsFound` / `repeatableInstanceIdIsFound` 三条 FAIL（`expected not <null>`）。**这三条红就是 bug 本身**，看到红再往下走。

- [ ] **Step 3: 写实现**

在 `src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java` 顶部加 import：

```java
import com.lyhn.wraith.config.ProviderResolver;
```

把 `createFromConfig`（当前 :47-60）整体替换为：

```java
    /**
     * 按 {@link ProviderResolver} 的候选顺序装载第一个能用的 client；一个都不行返回 null。
     *
     * <p><b>此前这里是一个硬编码数组</b> {@code {glm,deepseek,step,kimi,freellmapi,xfyun}}，
     * 于是只配了 anthropic / openai / siliconflow（乃至 freellmapi-2 这种多实例 id）的用户
     * 拿不到 client——桌面里明明配好了，界面却说「无可用模型」。
     * 现在的规则与 {@code Main.configRemoveProvider} 一致：谁有 key 谁就是候选。
     */
    public static LlmClient createFromConfig(WraithConfig config) {
        return createFrom(config, ProviderResolver.candidates(config));
    }

    /**
     * 同上，但候选表由调用方给出。
     *
     * <p>存在的唯一理由是<b>测试确定性</b>：{@link ProviderResolver#candidates(WraithConfig)}
     * 会扫真实环境变量，若测试走 public 入口，「什么都没配应返回 null」这类断言就会在设了
     * {@code ANTHROPIC_API_KEY} 的开发机上失败、在干净 CI 上通过。
     */
    static LlmClient createFrom(WraithConfig config, java.util.List<String> candidates) {
        if (candidates == null) {
            return null;
        }
        for (String provider : candidates) {
            LlmClient client = create(provider, config);
            if (client != null) {
                return client;
            }
        }
        return null;
    }
```

注意：**不要**保留原先「先单独试一次 `config.getDefaultProvider()`」的那段——`candidates` 的第一项就是它，重复试会让显式默认在无 key 时仍被尝试一次。

- [ ] **Step 4: 跑测试确认全绿 + 没打断邻居**

```bash
mvn -q test -DskipTests=false -Dtest='LlmClientFactoryFallbackTest+LlmClientFactoryTest+LlmClientFactoryRoutingTest'
```

Expected: 三个文件全 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java \
        src/test/java/com/lyhn/wraith/llm/LlmClientFactoryFallbackTest.java
git commit -F - <<'EOF'
fix(llm): 配好 anthropic 却「无可用模型」——回落只认硬编码的那 6 家

createFromConfig 的回落遍历的是硬编码数组 {glm,deepseek,step,kimi,
freellmapi,xfyun}。完整链路:

  WraithConfig.defaultProvider 硬编码初值 "glm" → save() 整对象落盘,全新安装
  就把它写进 config.json → configSetProvider 存 provider 时从不设默认 →
  createFromConfig 先试 glm(无 key,null)→ 再遍历那 6 家 → anthropic 不在内
  → null → 用户在桌面里配好 anthropic 点保存,看到的是「无可用模型」。

用户自己的 config 就中了:6 个 provider(freellmapi、freellmapi-2..5、
siliconflow),白名单只覆盖裸 freellmapi 一个 —— 连自家的多实例命名都覆盖不到。

改为走 ProviderResolver.candidates,规则与 Main.configRemoveProvider 一致:
谁有 key 谁就是候选。同时删掉原先「先单独试一次 defaultProvider」那段 ——
candidates 的第一项就是它,留着会让无 key 的显式默认被多试一次。

三条新测试在改之前是红的(anthropic / siliconflow / freellmapi-5 各一条),
那三条红就是 bug 本身。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## Task 3: `ModelCatalog` —— 删 `KNOWN_PROVIDERS`、报有效默认

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java`
- Modify: `src/test/java/com/lyhn/wraith/runtime/appserver/ModelCatalogTest.java:157-170`

**Interfaces:**
- Consumes: `ProviderResolver.candidates(WraithConfig)`（Task 1）
- Produces：
  - `public static List<Map<String,Object>> ModelCatalog.providers(WraithConfig)` —— 签名不变，行为变
  - `static List<Map<String,Object>> ModelCatalog.providers(WraithConfig, List<String> discovered)` —— **新增包可见重载**，供测试注入
  - `public static Map<String,Object> ModelCatalog.result(WraithConfig, String, String, boolean)` —— 签名不变
  - `static Map<String,Object> ModelCatalog.result(WraithConfig, String, String, boolean, List<String> candidates)` —— **新增包可见重载**

⚠️ **为什么必须加这两个重载**：`providers()` 若直接调生产版 `ProviderResolver.candidates(config)`，
就会扫真实环境变量——那么「零配置应报空表」这条断言在**设了 `ANTHROPIC_API_KEY` 的开发机上会失败、
在干净 CI 上通过**。这正是本计划 Global Constraints 里点名要避免的缺陷
（现有 `LlmClientFactoryRoutingTest.unknownProviderWithoutKeyReturnsNull` 就有这个毛病）。
新增的计数型断言一律走注入重载。

现有 7 条测试继续用 public 入口且**不需要改**——它们用 `stream().filter(...)` 取具体条目，
不断言总数，多出 env 条目也不受影响（唯一断言总数的是 :164，本任务正要改掉它）。

- [ ] **Step 1: 改掉那条在断言 bug 的测试，并加新断言**

打开 `src/test/java/com/lyhn/wraith/runtime/appserver/ModelCatalogTest.java`，把 :157-170 那一整块
（注释 `// ── Test: all KNOWN_PROVIDERS appear in providers list ───` 加
`providersListContainsAllKnownProviders` 方法）替换为：

```java
    // ── Test: providers 只报真有的,不再恒含 6 条空壳 ──────────────────────────
    //
    // 原测试断言 providers.size() == KNOWN_PROVIDERS.length —— 它在断言 bug。
    // 那 6 条 hasKey:false 的空壳在 UI 里根本看不见(桌面每个消费者都按 hasKey 过滤:
    // ProvidersPanel:30 doneInstances、:90 restCatalog、modelSwitcher:9
    // configuredProviders),纯属每次 model.list 多发的死载荷。

    // 这四条都走**注入重载**,不碰真实环境变量:若调 public 入口,它会扫 env,
    // 于是「零配置报空表」在设了 ANTHROPIC_API_KEY 的开发机上失败、在干净 CI 上通过。

    /** 一个只含指定 provider(都带 key)的 config。 */
    private static WraithConfig cfg(String defaultProvider, String... ids) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(defaultProvider);
        c.setProviders(new java.util.LinkedHashMap<>());
        for (String id : ids) {
            c.getProviders().put(id, new WraithConfig.ProviderConfig("sk-" + id, null, "m"));
        }
        return c;
    }

    @Test
    @DisplayName("零配置 → providers 为空表,不再凭空报 6 家")
    void emptyConfigReportsNoProviders() {
        assertTrue(ModelCatalog.providers(cfg(null), List.of()).isEmpty(),
                "一个 provider 都没配时不该报任何条目");
    }

    @Test
    @DisplayName("配了 N 个就报 N 个,一条不多")
    void reportsExactlyWhatIsConfigured() {
        WraithConfig config = cfg(null, "anthropic", "siliconflow");

        List<Map<String, Object>> providers =
                ModelCatalog.providers(config, List.of("anthropic", "siliconflow"));

        assertEquals(2, providers.size(), "实际: " + providers);
        assertEquals("anthropic", providers.get(0).get("name"), "保持插入序");
        assertEquals("siliconflow", providers.get(1).get("name"));
        assertEquals(true, providers.get(0).get("hasKey"));
    }

    @Test
    @DisplayName("env 里发现的 provider 也报出来 —— 否则 env-only 用户看到空面板但对话能用")
    void envDiscoveredProviderIsReported() {
        WraithConfig config = cfg(null);          // config.json 里一个都没有
        List<Map<String, Object>> providers = ModelCatalog.providers(config, List.of("anthropic"));

        assertEquals(1, providers.size(), "实际: " + providers);
        assertEquals("anthropic", providers.get(0).get("name"));
    }

    @Test
    @DisplayName("default 报有效默认 —— stale \"glm\" 不能让面板一个「默认」标都不显示")
    void resultReportsEffectiveDefault() {
        // 老 config.json 里 defaultProvider 是落盘的硬编码 "glm",但 glm 没 key。
        // 若照原样回报,ProvidersPanel:101 的 `defaultId === p.name` 匹配不上任何行。
        WraithConfig config = cfg("glm", "anthropic");

        Map<String, Object> result =
                ModelCatalog.result(config, "anthropic", "m", false, List.of("anthropic"));

        assertEquals("anthropic", result.get("default"),
                "应报实际会被用上的那个,而不是 config 里的死字段");
    }

    @Test
    @DisplayName("一个都没配时 default 是空串,不是 null(桌面直接读,不判 null)")
    void effectiveDefaultIsEmptyStringWhenNothingConfigured() {
        assertEquals("", ModelCatalog.result(cfg(null), "", "", false, List.of()).get("default"));
    }
```

若该文件顶部缺 `DisplayName` / `List` / `Map` 的 import，补上：

```java
import org.junit.jupiter.api.DisplayName;
import java.util.List;
import java.util.Map;
```

- [ ] **Step 2: 跑测试确认它红**

```bash
mvn -q test -DskipTests=false -Dtest=ModelCatalogTest
```

Expected: `emptyConfigReportsNoProviders` FAIL（报了 6 条）、`resultReportsEffectiveDefault` FAIL（`expected: <anthropic> but was: <glm>`）。

- [ ] **Step 3: 写实现**

在 `src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java` 里：

1. 删掉 `KNOWN_PROVIDERS` 常量（:11）
2. 顶部加 import：`import com.lyhn.wraith.config.ProviderResolver;`
3. 把现有 `providers(WraithConfig config)` 的方法头（含 Javadoc）替换为一对方法——public 的算出候选后委托给包可见那个：

```java
    /**
     * Build the providers list from config.
     *
     * <p>报 {@code config.getProviders().keySet()} ∪ {@code ProviderResolver.candidates}
     * （去重，config 优先）。<b>此前是恒含 6 条硬编码空壳</b>
     * （{@code KNOWN_PROVIDERS} ∪ config），而桌面每个消费者都按 {@code hasKey} 过滤
     * （{@code ProvidersPanel:30} doneInstances、{@code :90} restCatalog、
     * {@code modelSwitcher:9} configuredProviders）——那些空壳在 UI 里看不见，
     * 纯属每次 {@code model.list} 的死载荷。
     *
     * <p>每条含 name/model/hasKey/baseUrl/protocol/label。
     * 红线：NEVER includes apiKey value（只报 hasKey）；baseUrl/protocol/label 非密钥，
     * 回报用于编辑回填与多实例显示。
     */
    public static List<Map<String, Object>> providers(WraithConfig config) {
        return providers(config, ProviderResolver.candidates(config));
    }

    /**
     * 同上，但候选表由调用方给出。
     *
     * <p>存在的唯一理由是<b>测试确定性</b>：{@code ProviderResolver.candidates(config)} 会扫
     * 真实环境变量，若测试走 public 入口，「零配置应报空表」这类断言就会在设了
     * {@code ANTHROPIC_API_KEY} 的开发机上失败、在干净 CI 上通过。
     */
    static List<Map<String, Object>> providers(WraithConfig config, List<String> discovered) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>(config.getProviders().keySet());
        if (discovered != null) {
            ids.addAll(discovered);
        }
```

（方法体余下部分——`for (String p : ids) { ... }` 到 `return list;`——保持原样不动。）

4. 同样把 `result(...)` 拆成一对：

```java
    /**
     * Build the full model.list result map.
     * currentProvider/currentModel are the live client values.
     * fallback=true adds modelFallback:true.
     */
    public static Map<String, Object> result(WraithConfig config,
                                              String currentProvider, String currentModel,
                                              boolean fallback) {
        return result(config, currentProvider, currentModel, fallback,
                ProviderResolver.candidates(config));
    }

    /** 同上，候选表由调用方给出（理由同 {@link #providers(WraithConfig, List)}）。 */
    static Map<String, Object> result(WraithConfig config,
                                      String currentProvider, String currentModel,
                                      boolean fallback, List<String> candidates) {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("current", Map.of("provider", currentProvider, "model", currentModel));
        // 报**有效**默认而非 config 里的死字段:老 config.json 里落盘的 "glm" 常常没 key,
        // 照原样回报会让 ProvidersPanel:101 的 `defaultId === p.name` 匹配不上任何行 ——
        // 用户看到一个「默认」标都没有。空串而非 null,桌面侧直接读不必判空。
        res.put("default", candidates == null || candidates.isEmpty() ? "" : candidates.get(0));
        res.put("providers", providers(config, candidates));
        if (fallback) res.put("modelFallback", true);
        return res;
    }
```

**注意**：`default` 直接取 `candidates.get(0)` 而不再调 `ProviderResolver.effectiveDefault(config)`
——否则同一次 `result()` 调用会把环境扫描做两遍，且两次结果可能不一致（环境在两次调用之间变了）。
`effectiveDefault` 仍由 Task 4 的 `ProviderDefaults` 使用。

- [ ] **Step 4: 跑测试确认全绿**

```bash
mvn -q test -DskipTests=false -Dtest=ModelCatalogTest
mvn -q compile -DskipTests=false
```

Expected: PASS；编译零错误（确认没有别处还在引用 `KNOWN_PROVIDERS`）。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/ModelCatalogTest.java
git commit -F - <<'EOF'
fix(appserver): model.list 别再凭空报 6 家,default 报有效值而非死字段

两处改动:

1) 删 KNOWN_PROVIDERS。它给每次 model.list 塞 6 条 hasKey:false 的空壳,而桌面
   每个消费者都按 hasKey 过滤(ProvidersPanel:30 doneInstances、:90 restCatalog、
   modelSwitcher:9 configuredProviders)—— 那 6 条在 UI 里根本看不见,是死载荷。
   面板本来就是双源:model.list 报「已配置」,前端 31 条 PROVIDER_CATALOG 报「全部」,
   删掉不影响「全部」组。

2) default 改报 ProviderResolver.effectiveDefault。老 config.json 里落盘的
   defaultProvider 常是硬编码初值 "glm" 且没 key,照原样回报会让
   ProvidersPanel:101 的 `defaultId === p.name` 匹配不上任何行 —— 用户看到
   一个「默认」标都没有。

原测试 providersListContainsAllKnownProviders 断言
providers.size() == KNOWN_PROVIDERS.length —— 它在断言 bug,已改写为
「零配置报空表」+「配了 N 个报 N 个」+「default 是有效值」。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## Task 4: 存/删 provider 时自愈默认值 + 修两处撒谎注释

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java:1304-1305`（注释）、`:1477-1503`（两个方法）
- Test: `src/test/java/com/lyhn/wraith/cli/ProviderDefaultSelfHealTest.java`（Create）

**Interfaces:**
- Consumes: `ProviderResolver.effectiveDefault(WraithConfig)`（Task 1）
- Produces：
  - `static void ProviderDefaults.healDefault(WraithConfig config)` —— 生产入口（`Main` 调这个）
  - `static void ProviderDefaults.healDefault(WraithConfig config, String effective)` —— **决策本体**，供测试直接给定有效值

**为什么单独建测试文件**：`configSetProvider` 是 `Main.java` 里的匿名内部类方法，测不到。这里测的是**自愈规则本身**（一个可复用的静态判断），并在 `Main.java` 里调用它——把逻辑从匿名类里挪出来，才可测。

**为什么测试注入 `effective` 而不是让它自己算**：`ProviderResolver.effectiveDefault(config)`
会扫真实环境变量。若测试走生产入口，一台设了 `GLM_API_KEY` 的开发机上
「stale glm 应被换掉」会失败——因为 glm 在那台机器上**确实有 key**。
更重要的是职责划分：`healDefault` 只负责「写不写、写什么」，
「谁是有效默认」由 `ProviderResolverTest.staleDefaultIsSkipped` 等条目覆盖。两件事分开测。

- [ ] **Step 1: 写失败的测试**

创建 `src/test/java/com/lyhn/wraith/cli/ProviderDefaultSelfHealTest.java`：

```java
package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 存/删 provider 时把 stale 的 defaultProvider 修好。
 *
 * <p><b>起因</b>：{@code Main.java:1487-1488} 的注释承诺「首个 provider 落地后就地热装 ……
 * 存完立刻可用，不需要用户再去点一次「设默认」」——对旧白名单 6 家之外的 provider 全是假的。
 * 因为 {@code configSetProvider} <b>从不设置 defaultProvider</b>，而 defaultProvider 的
 * 硬编码初值 {@code "glm"} 会被 {@code save()} 落盘。
 *
 * <p><b>为什么不静默改写用户文件</b>：读路径已由 {@code ModelCatalog} 报有效默认兜住，
 * stale 值不影响行为。只在用户<b>主动写入</b>（存 provider / 删 provider）时顺手修好，
 * 这两个时机用户本来就在改配置，不算意外副作用。
 *
 * <p>「挑一个有 key 的」这条规则原本只装在 {@code configRemoveProvider}（:1494-1500），
 * 现在两边共用 {@code ProviderResolver}，不写第五份。
 */
class ProviderDefaultSelfHealTest {

    private static WraithConfig cfgWithDefault(String defaultProvider) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(defaultProvider);
        c.setProviders(new LinkedHashMap<>());
        return c;
    }

    private static void put(WraithConfig c, String id, String key) {
        c.getProviders().put(id, new WraithConfig.ProviderConfig(key, null, "m"));
    }

    @Test
    @DisplayName("stale 默认 + 有效值是 anthropic → 默认改成 anthropic")
    void healsStaleDefaultAfterSave() {
        WraithConfig c = cfgWithDefault("glm");     // 老 config.json 落盘的硬编码初值
        put(c, "anthropic", "sk-a");

        ProviderDefaults.healDefault(c, "anthropic");

        assertEquals("anthropic", c.getDefaultProvider(),
                "存完就该能用,不该还要用户去点一次「设默认」");
    }

    @Test
    @DisplayName("默认已经有效 → 一个字都不动(不能把用户的显式选择改掉)")
    void leavesValidDefaultAlone() {
        WraithConfig c = cfgWithDefault("deepseek");
        put(c, "deepseek", "sk-d");
        put(c, "anthropic", "sk-a");

        ProviderDefaults.healDefault(c, "deepseek");

        assertEquals("deepseek", c.getDefaultProvider());
    }

    @Test
    @DisplayName("删掉当前默认那个 → 落到下一个有 key 的")
    void healsAfterRemovingCurrentDefault() {
        WraithConfig c = cfgWithDefault("anthropic");
        put(c, "siliconflow", "sk-s");            // anthropic 已被 remove,只剩这个

        ProviderDefaults.healDefault(c, "siliconflow");

        assertEquals("siliconflow", c.getDefaultProvider());
    }

    @Test
    @DisplayName("有效值为空串(删到一个都不剩)→ 默认清空,不留一个指向虚空的 id")
    void clearsDefaultWhenNothingLeft() {
        WraithConfig c = cfgWithDefault("anthropic");

        ProviderDefaults.healDefault(c, "");

        assertNull(c.getDefaultProvider(), "实际: " + c.getDefaultProvider());
    }

    @Test
    @DisplayName("默认为 null(新版初值)且有效值有了 → 设成它")
    void setsDefaultOnFirstProvider() {
        WraithConfig c = cfgWithDefault(null);
        put(c, "siliconflow", "sk-s");

        ProviderDefaults.healDefault(c, "siliconflow");

        assertEquals("siliconflow", c.getDefaultProvider());
    }

    @Test
    @DisplayName("null / 空 config 不抛")
    void nullInputsAreSafe() {
        assertDoesNotThrow(() -> ProviderDefaults.healDefault(null, "anthropic"));
        assertDoesNotThrow(() -> ProviderDefaults.healDefault(null));
        assertDoesNotThrow(() -> ProviderDefaults.healDefault(cfgWithDefault(null), null));
    }

    @Test
    @DisplayName("生产入口跑完后,默认值必定是「空」或「一个真有 key 的 provider」")
    void productionEntryPointLeavesUsableDefault() {
        // 断言的是一条**在任何机器上都成立的不变式**,而不是具体是哪个 provider ——
        // 后者取决于跑它的机器设了哪些环境变量(设了 GLM_API_KEY 的机器上 glm 确实有 key)。
        // 「具体谁是有效默认」由 ProviderResolverTest 覆盖。
        WraithConfig c = cfgWithDefault("glm");
        put(c, "anthropic", "sk-a");

        ProviderDefaults.healDefault(c);

        String after = c.getDefaultProvider();
        if (after != null) {
            assertFalse(after.isBlank(), "要么是 null,要么是个真名字,不该留空白串");
            String key = c.getApiKey(after);
            assertTrue(key != null && !key.isBlank(),
                    "自愈后的默认必须拿得到 key,否则自愈没有意义。实际默认=" + after);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认它红**

```bash
mvn -q test -DskipTests=false -Dtest=ProviderDefaultSelfHealTest
```

Expected: 编译失败 —— `cannot find symbol: class ProviderDefaults`。

- [ ] **Step 3: 写实现**

创建 `src/main/java/com/lyhn/wraith/cli/ProviderDefaults.java`：

```java
package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.ProviderResolver;
import com.lyhn.wraith.config.WraithConfig;

/**
 * 在用户主动写配置时，把 stale 的 {@code defaultProvider} 修好。
 *
 * <p>为什么需要：{@code defaultProvider} 的硬编码初值曾是 {@code "glm"}，而
 * {@link WraithConfig#save()} 整对象落盘，于是全新安装第一次保存就把 {@code "glm"}
 * 写进了 {@code ~/.wraith/config.json}——哪怕用户配的是 anthropic。
 *
 * <p>为什么不在读路径静默改写用户文件：读路径已由 {@code ModelCatalog} 报有效默认兜住，
 * stale 值不影响任何行为。只在存 / 删 provider 这两个「用户本来就在改配置」的时机顺手修好。
 */
final class ProviderDefaults {

    private ProviderDefaults() {}

    /**
     * 生产入口：有效默认由 {@link ProviderResolver} 现算。
     *
     * <p>判定完全委托 {@code ProviderResolver}，与 {@code createFromConfig} 和
     * {@code model.list} 用的是同一套规则，不会漂移。
     */
    static void healDefault(WraithConfig config) {
        if (config == null) {
            return;
        }
        healDefault(config, ProviderResolver.effectiveDefault(config));
    }

    /**
     * 决策本体：{@code effective} 与当前值不同就写下它；{@code effective} 为空则清空。
     * 相同时一个字都不动——不能改掉用户的显式选择，也不该产生无意义的写入。
     *
     * <p>把「算有效值」与「写不写」分开，是为了让这段决策可以脱离环境变量单测：
     * {@code effectiveDefault} 会扫真实环境，测试若走一参入口，
     * 「stale glm 应被换掉」在一台设了 {@code GLM_API_KEY} 的机器上会失败——
     * 因为 glm 在那台机器上确实有 key。
     */
    static void healDefault(WraithConfig config, String effective) {
        if (config == null) {
            return;
        }
        String target = (effective == null || effective.isBlank()) ? null : effective;
        String current = config.getDefaultProvider();
        if (java.util.Objects.equals(current, target)) {
            return;
        }
        config.setDefaultProvider(target);
    }
}
```

然后改 `Main.java`：

**(a)** `configSetProvider`（:1485-1489），在 `config.save()` **之前**插入自愈：

```java
                        config.getProviders().put(id, pc);
                        // 存完就该能用:此前这里从不设 defaultProvider,而它的硬编码初值 "glm"
                        // 会被 save() 落盘 —— 于是配好 anthropic 点保存,createFromConfig
                        // 先试无 key 的 glm、再遍历旧白名单那 6 家,返回 null,界面说「无可用模型」。
                        ProviderDefaults.healDefault(config);
                        config.save();
                        // 首个 provider 落地后就地热装 —— 这是打破「想配 key 得先有 key」死锁的一环:
                        // 存完立刻可用,不需要重启后端,也不需要用户再去点一次「设默认」。
                        ensureClient.get();
```

**(b)** `configRemoveProvider`（:1493-1501），把手写的回落循环替换掉：

```java
                    public java.util.Map<String, Object> configRemoveProvider(String id) {
                        config.getProviders().remove(id);
                        // 删掉当前默认那个就落到下一个有 key 的。此前这里手写了一遍循环,
                        // 现在与 createFromConfig / model.list 共用 ProviderResolver —— 不写第五份。
                        ProviderDefaults.healDefault(config);
                        config.save();
                        return java.util.Map.of("ok", true);
                    }
```

**(c)** 修 `:1304-1305` 那句撒谎的注释：

```java
                //   createFromConfig 会按 ProviderResolver 的候选顺序逐个试,所以 config 或 env 里
                //   任意一个有 key 的 provider 都能装上(此前是硬编码的 6 家白名单,anthropic /
                //   openai / siliconflow 乃至 freellmapi-2 这种多实例 id 全都装不上)。
```

- [ ] **Step 4: 跑测试确认全绿**

```bash
mvn -q test -DskipTests=false -Dtest=ProviderDefaultSelfHealTest
mvn -q compile -DskipTests=false
```

Expected: 6 条 PASS；编译零错误。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/ProviderDefaults.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/ProviderDefaultSelfHealTest.java
git commit -F - <<'EOF'
fix(cli): 让「存完立刻可用」这句注释成真——存/删 provider 时自愈默认值

Main:1487 的注释承诺「首个 provider 落地后就地热装 …… 存完立刻可用,不需要
用户再去点一次「设默认」」,但 configSetProvider 从不设置 defaultProvider,
而它的硬编码初值 "glm" 会被 save() 落盘 —— 于是配好 anthropic 点保存,
createFromConfig 先试无 key 的 glm、再遍历旧白名单那 6 家,返回 null。

新增 ProviderDefaults.healDefault:当前默认拿不到 key 就换成第一个拿得到的,
都没有则清空;已经有效时一个字都不动(不能改掉用户的显式选择)。判定全部委托
ProviderResolver,与 createFromConfig / model.list 同一套规则,不会漂移。

不在读路径静默改写用户文件:读路径已由 ModelCatalog 报有效默认兜住,stale 值
不影响行为。只在存/删 provider 这两个用户本来就在改配置的时机顺手修好。

configRemoveProvider 原本手写了一遍「挑下一个有 key 的」循环(:1494-1500),
改为共用 healDefault —— 本次去掉的就是「同一逻辑抄多份」,不能自己再添一份。

顺带修 :1304 那句撒谎的注释(「只要任意一家有 key 就能装上」——只有那 6 家)。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## Task 5: `WraithCompleter` 补全从 config 现算

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/WraithCompleter.java:15-27`（构造器）、`:83-100`（`completeModel`）、`:113-124`（`completeConfig`）
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java:283`（传入 config supplier）
- Modify: `src/test/java/com/lyhn/wraith/cli/WraithCompleterTest.java`

**Interfaces:**
- Consumes: `WraithConfig.getProviders()` → `Map<String, ProviderConfig>`。
  **刻意不用 `ProviderResolver`** —— 补全要列出**所有已写下的** provider，包括暂时没填 key 的
  （用户很可能正要去填它）；候选表是给「装载哪个 client」用的，判据不同。
- Produces: `WraithCompleter(Supplier<List<McpResourceDescriptor>>, Supplier<List<Skill>>, Supplier<WraithConfig>)`
  三参构造器；原有一参 / 二参构造器保留并委托（12 处现有调用不动）

- [ ] **Step 1a: 改写三条在断言旧硬编码契约的老测试**

⚠️ 这三条老测试**必须改**，否则本任务无法完成——它们用一参构造器（没有 config）却断言仍能补全出硬编码的 provider，而本任务恰恰是要删掉那份硬编码：

| 测试 | 当前断言 | 为什么必须改 |
|---|---|---|
| `completesModelProviderNames`（:53-60） | `/model st` → `"step"` | `step` 来自被删的硬编码列表 |
| `completesConfigProviderCommand`（:63-70） | `/config provider fr` → `"freellmapi "` | 同上 |
| `completesXfyunProviderCommand`（:73-80） | `/config provider xf` → `"xfyun "` | 同上 |

它们与 Task 3 那条 `providersListContainsAllKnownProviders` 是同一类——**在断言 bug**。

**改写而非删除**，因为它们覆盖了新测试没覆盖的一件事：**前缀匹配**（新测试用的是空前缀 `"/model "`）。把数据源从硬编码换成 config，测试意图原样保留：

```java
    @Test
    void completesModelProviderNames() {
        // 数据源从硬编码列表换成 config —— 本任务删掉了那份硬编码。
        // 这条与新增的 modelCompletionListsConfiguredProviders 的区别在于:它验的是**前缀匹配**
        // (输入 "st" 只补出 step),那条验的是空前缀下的全量列出。
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("step", "kimi"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model st", "st"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("step")));
        assertFalse(candidates.stream().anyMatch(c -> c.value().equals("kimi")),
                "前缀 st 不该匹配 kimi");
    }

    @Test
    void completesConfigProviderCommand() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("freellmapi"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/config provider fr", "fr"), candidates);

        // 尾随空格是有意义的:它让补全直接推进到下一个参数位。
        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("freellmapi ")));
    }

    @Test
    void completesXfyunProviderCommand() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("xfyun"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/config provider xf", "xf"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("xfyun ")));
    }
```

其余 9 条老测试不涉 provider 补全，**保持不动**。

- [ ] **Step 1b: 追加新测试**

在 `src/test/java/com/lyhn/wraith/cli/WraithCompleterTest.java` 末尾（最后一个 `}` 之前）追加：

```java
    // ── provider 补全来自 config,不是硬编码 ──────────────────────────────────
    //
    // 此前 completeModel(:91-98)与 completeConfig(:117-122)各硬编码了一份
    // {glm,deepseek,step,kimi,freellmapi,xfyun},而 completeModel 那份还把两个**模型名**
    // (glm-5.1 / glm-5v-turbo)混进了 provider 列表 —— /model 收的是 provider 名。

    private static com.lyhn.wraith.config.WraithConfig cfgWith(String... providerIds) {
        com.lyhn.wraith.config.WraithConfig c = new com.lyhn.wraith.config.WraithConfig();
        c.setProviders(new java.util.LinkedHashMap<>());
        for (String id : providerIds) {
            c.getProviders().put(id,
                    new com.lyhn.wraith.config.WraithConfig.ProviderConfig("sk-x", null, "m"));
        }
        return c;
    }

    @Test
    void modelCompletionListsConfiguredProviders() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("anthropic", "siliconflow"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model ", ""), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().trim().equals("anthropic")),
                "补全里应有已配置的 anthropic: " + values(candidates));
        assertTrue(candidates.stream().anyMatch(c -> c.value().trim().equals("siliconflow")),
                "补全里应有已配置的 siliconflow: " + values(candidates));
    }

    @Test
    void modelCompletionDropsUnconfiguredHardcodedProviders() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("anthropic"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model ", ""), candidates);

        assertFalse(candidates.stream().anyMatch(c -> c.value().trim().equals("glm")),
                "没配 glm 就不该推荐它: " + values(candidates));
    }

    @Test
    void modelCompletionContainsNoModelNames() {
        // /model 收的是 provider 名,模型名由各 provider 的 config 决定,混在一起本身就是错的
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("glm"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model ", ""), candidates);

        assertFalse(candidates.stream().anyMatch(c -> c.value().contains("glm-5")),
                "模型名不该出现在 provider 补全里: " + values(candidates));
    }

    @Test
    void configProviderCompletionListsConfiguredProviders() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("openrouter"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/config provider ", ""), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().trim().equals("openrouter")),
                "实际: " + values(candidates));
    }

    @Test
    void completionFollowsLiveConfigNotASnapshot() {
        // 本仓库已四次栽在 snapshot-vs-live-signal 上(沙箱护盾、动作卡…)。
        // 用户刚在桌面面板里加完 provider,不该等重启才补全得出来。
        java.util.List<String> ids = new java.util.ArrayList<>(List.of("anthropic"));
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith(ids.toArray(new String[0])));

        List<Candidate> before = new ArrayList<>();
        completer.complete(null, parsed("/model ", ""), before);
        assertFalse(before.stream().anyMatch(c -> c.value().trim().equals("groq")));

        ids.add("groq");

        List<Candidate> after = new ArrayList<>();
        completer.complete(null, parsed("/model ", ""), after);
        assertTrue(after.stream().anyMatch(c -> c.value().trim().equals("groq")),
                "config 变了补全没跟上 —— 说明取了快照: " + values(after));
    }

    @Test
    void missingConfigSupplierDoesNotCrashCompletion() {
        // 一参 / 二参构造器仍在用(12 处),它们没有 config —— 补全应安静地不给 provider 建议
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        assertDoesNotThrow(() -> completer.complete(null, parsed("/model ", ""), candidates));
    }

    private static String values(List<Candidate> candidates) {
        return candidates.stream().map(Candidate::value).toList().toString();
    }
```

若该文件顶部缺 `assertFalse` / `assertDoesNotThrow`，把 import 改为：

```java
import static org.junit.jupiter.api.Assertions.*;
```

- [ ] **Step 2: 跑测试确认它红**

```bash
mvn -q test -DskipTests=false -Dtest=WraithCompleterTest
```

Expected: 编译失败 —— 三参构造器不存在。

- [ ] **Step 3: 写实现**

**(a)** `WraithCompleter.java` 顶部字段与构造器（:15-27）改为：

```java
final class WraithCompleter implements Completer {
    private final Supplier<List<McpResourceDescriptor>> resourceSupplier;
    private final Supplier<List<Skill>> skillSupplier;
    /**
     * provider 补全的来源。
     *
     * <p>用 {@code Supplier} 而非快照：本仓库已四次栽在 snapshot-vs-live-signal 上。
     * 用户刚在桌面面板里加完 provider，不该等重启后端才补全得出来。
     *
     * <p>可为 {@code null}（一参 / 二参构造器的老调用点）——那时不给 provider 建议，
     * 而不是回退到硬编码列表。
     */
    private final Supplier<com.lyhn.wraith.config.WraithConfig> configSupplier;

    WraithCompleter(Supplier<List<McpResourceDescriptor>> resourceSupplier) {
        this(resourceSupplier, List::of, null);
    }

    WraithCompleter(Supplier<List<McpResourceDescriptor>> resourceSupplier,
                    Supplier<List<Skill>> skillSupplier) {
        this(resourceSupplier, skillSupplier, null);
    }

    WraithCompleter(Supplier<List<McpResourceDescriptor>> resourceSupplier,
                    Supplier<List<Skill>> skillSupplier,
                    Supplier<com.lyhn.wraith.config.WraithConfig> configSupplier) {
        this.resourceSupplier = resourceSupplier;
        this.skillSupplier = skillSupplier == null ? List::of : skillSupplier;
        this.configSupplier = configSupplier;
    }
```

**(b)** 新增取 provider 名的私有方法（放在 `completeModel` 之前）：

```java
    /**
     * 已写下的 provider id，按插入序（＝用户添加序）。
     *
     * <p>刻意用 {@code getProviders().keySet()} 而非 {@code ProviderResolver.candidates}：
     * 补全要列出**所有写下过的** provider，包括暂时没填 key 的——用户很可能正要去填它。
     * 候选表是给「装载哪个 client」用的，判据不同。
     */
    private List<String> configuredProviderIds() {
        if (configSupplier == null) {
            return List.of();
        }
        try {
            com.lyhn.wraith.config.WraithConfig config = configSupplier.get();
            if (config == null || config.getProviders() == null) {
                return List.of();
            }
            return List.copyOf(config.getProviders().keySet());
        } catch (Exception e) {
            return List.of();   // 补全坏了不该把 REPL 带崩
        }
    }
```

**(c)** `completeModel` 的 `addMatching`（:91-98）替换为：

```java
        // provider 名来自 config,不再硬编码。原先这里还混进了两个**模型名**
        // (glm-5.1 / glm-5v-turbo)—— /model 收的是 provider 名,模型由各 provider 的 config 定。
        List<String> ids = configuredProviderIds();
        CommandOption[] options = new CommandOption[ids.size()];
        for (int i = 0; i < ids.size(); i++) {
            options[i] = option(ids.get(i), "已配置的 provider");
        }
        addMatching(candidates, "模型", value, options);
```

**(d)** `completeConfig` 里 provider 那段（:116-122）替换为：

```java
                List<String> ids = configuredProviderIds();
                CommandOption[] options = new CommandOption[ids.size()];
                for (int i = 0; i < ids.size(); i++) {
                    options[i] = option(ids.get(i) + " ", "已配置的 provider");
                }
                addMatching(candidates, "Provider", prefix, options);
```

⚠️ **类型是 `CommandOption`，不是 `Candidate`。** 已核实签名：
`option(String, String)` 返回 `WraithCompleter.CommandOption`（:317，一个私有 record
`CommandOption(String value, String description, String display)`，:345），
而 `addMatching(List<Candidate>, String group, String prefix, CommandOption... options)`（:325）
收的是 `CommandOption` 变参。写成 `Candidate[]` 会直接编译失败。

**(e)** `Main.java:283-284` 的构造调用加第三个参数。当前完整形态是：

```java
                    .completer(new WraithCompleter(mcpServerManager::resourceCandidates,
                            () -> skillRegistryRef.get() == null ? List.of() : skillRegistryRef.get().allSkills()))
```

改为：

```java
                    .completer(new WraithCompleter(mcpServerManager::resourceCandidates,
                            () -> skillRegistryRef.get() == null ? List.of() : skillRegistryRef.get().allSkills(),
                            () -> config))
```

`config` 是同作用域 `Main.java:236` 的 `WraithConfig config = WraithConfig.load();`——已核实同一方法内可见。

**若编译报「local variables referenced from a lambda expression must be final or effectively final」**：
在 `LineReaderBuilder` 之前加一行别名 `final WraithConfig completerConfig = config;`，
lambda 改用 `() -> completerConfig`。
**不要**改成 `WraithConfig::load` —— 那会每次按键重读磁盘文件，而且读不到内存里尚未落盘的改动，
恰好破坏我们要的 live 语义。

- [ ] **Step 4: 跑测试确认全绿**

```bash
mvn -q test -DskipTests=false -Dtest=WraithCompleterTest
mvn -q compile -DskipTests=false
```

Expected: 原有 12 条 + 新增 6 条全 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/WraithCompleter.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/WraithCompleterTest.java
git commit -F - <<'EOF'
fix(cli): /model 与 /config provider 的补全改从 config 现算

这是那份硬编码列表的第三、四份抄本(completeModel:91-98、completeConfig:117-122),
而且互不一致 —— completeModel 那份把两个**模型名**(glm-5.1 / glm-5v-turbo)混进了
provider 列表,而 /model 收的是 provider 名,模型由各 provider 的 config 定。
结果是:没配 GLM 的用户,补全首推的是 glm-5.1。

改为注入 Supplier<WraithConfig> 现算。用 Supplier 而非快照:本仓库已四次栽在
snapshot-vs-live-signal 上,用户刚在桌面面板里加完 provider,不该等重启才补全
得出来(有一条测试专门验这个)。

取 getProviders().keySet() 而非 ProviderResolver.candidates:补全要列出所有
写下过的 provider,包括暂时没填 key 的 —— 用户很可能正要去填它。候选表是给
「装载哪个 client」用的,判据不同。

一参/二参构造器保留(12 处现有调用不动),没有 config 时安静地不给 provider
建议,而不是回退到硬编码列表。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## Task 5b: `slashCommandHints` 去硬编码（Task 5 评审新发现）

**为什么计划里原本没有这一节**：调查阶段我断定硬编码是**四份**。Task 5 的评审全仓 grep 后证明是**六份**——漏掉的两处都在 `Main.java`，而且是**最显眼的**：`slashCommandHints()` 就是用户敲 `/` 时弹出的那张提示表。只配了 anthropic 的用户敲 `/`，看到的是「切换到 GLM-5.1」。

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java:3026-3037`（`slashCommandHints()` 里 9 条 provider 专属提示）、`:3267`（`handleConfigPalette` 的帮助文案）
- Modify: `src/test/java/com/lyhn/wraith/cli/MainInputNormalizationTest.java:206-218`（**在断言旧契约**，必须改写）

**Interfaces:**
- Consumes: `WraithCompleter.configuredProviderIds()`（Task 5 已落地，config 驱动）
- Produces: `Main.slashCommandHints()` 签名**不变**，返回内容少掉 9 条 provider 专属项

**设计决定：删副本，不复制副本。**

`slashCommandHints()` 有 4 个消费者：`WraithCompleter.java:82`（用户敲 `/` 的顶层补全）、`Main.java:3109` `printSlashCommandHelp`、`:3199` `slashCommandTailTips`、`:3216` `formatSlashCommandChoices`。后三个都是**无 config 参数的 static 方法**，把 config 穿进去要改三处签名及其调用链。

不做那个。改为**把那 9 条 provider 专属提示整体删掉**，静态表里只留裸 `/model`（已有）和新增裸 `/config provider `。provider 名此后**只有一个来源**：Task 5 已经改成 config 驱动的 `WraithCompleter.completeModel` / `completeConfig`。

这样零穿参、零新副本，而且是真正删掉一份重复，符合本次改动的主题。

- [ ] **Step 1: 改写在断言旧契约的那条测试**

`MainInputNormalizationTest.java:206-218` 的 `slashCommandChoicesAreRenderedDirectlyWithoutJLineConfirmationText` 现在断言 `choices.contains("/model glm-5.1")` 等 6 条 provider 项。它的**真实意图**是「选项以紧凑多列直接渲染、不带 JLine 的确认文案」——provider 断言只是当年顺手抓的脚手架。改写为：

```java
    @Test
    void slashCommandChoicesAreRenderedDirectlyWithoutJLineConfirmationText() {
        String choices = Main.formatSlashCommandChoices(120);

        // 断言换成与 provider 无关的命令:provider 名已不在这张静态表里,
        // 它们由 config 驱动的 WraithCompleter.completeModel 提供(见 Task 5)。
        // 这条测试的真实意图是「紧凑多列直接渲染、不带 JLine 确认文案」,
        // 原先那 6 条 /model glm-5.1 之类的断言只是脚手架,且正是本任务要删的硬编码。
        assertTrue(choices.contains("/model"), choices);
        assertTrue(choices.contains("/browser status"), choices);
        assertTrue(choices.contains("/plan"), choices);
        assertFalse(choices.contains("do you wish"), choices);
        // 注意 assertFalse 最多两参(condition, message),不要写成三个位置参数。
        assertFalse(choices.contains("glm-5.1"),
                "provider/模型名不该再出现在静态提示表里。实际: " + choices);
        assertTrue(choices.lines().count() < Main.slashCommandHints().size(),
                "choices should be compact multi-column output");
    }
```

- [ ] **Step 2: 跑测试确认它红**

```bash
mvn -q test -DskipTests=false -Dtest=MainInputNormalizationTest
```

Expected: FAIL —— `assertFalse(choices.contains("glm-5.1"))` 红（此刻 `glm-5.1` 确实还在表里）。**这一条是真红，不是编译失败**，因为它不依赖任何尚未存在的方法。

- [ ] **Step 3: 删掉那 9 条 provider 专属提示**

`Main.java:3026-3037`，把这 9 行删掉：

```java
                new SlashCommandHint("/model glm-5.1", "/model glm-5.1", "切换到 GLM-5.1"),
                new SlashCommandHint("/model glm-5v-turbo", "/model glm-5v-turbo", "切换到 GLM-5V-Turbo 多模态"),
                new SlashCommandHint("/model deepseek", "/model deepseek", "切换到 DeepSeek（读取配置模型）"),
                new SlashCommandHint("/model step", "/model step", "切换到 StepFun（读取配置模型）"),
                new SlashCommandHint("/model kimi", "/model kimi", "切换到 Kimi（读取配置模型）"),
                new SlashCommandHint("/model freellmapi", "/model freellmapi", "切换到本地 FreeLLMAPI（读取配置模型）"),
                new SlashCommandHint("/model xfyun", "/model xfyun", "切换到讯飞星辰 MaaS（读取配置模型）"),
                new SlashCommandHint("/config provider freellmapi ", "/config provider freellmapi <选项>", "配置本地 FreeLLMAPI provider"),
                new SlashCommandHint("/config provider xfyun ", "/config provider xfyun <选项>", "配置讯飞星辰 MaaS provider"),
```

保留已有的 `new SlashCommandHint("/model", "/model", "查看当前模型")`，并紧随其后新增一条通用的、不点名任何 provider 的：

```java
                new SlashCommandHint("/model ", "/model <provider>", "切换 provider（按 Tab 从已配置的里选）"),
                new SlashCommandHint("/config provider ", "/config provider <name>", "配置 provider（按 Tab 从已配置的里选）"),
```

在 `slashCommandHints()` 上方加一句 Javadoc 说明这个边界：

```java
    /**
     * 静态斜杠命令提示表。
     *
     * <p><b>刻意不含任何 provider / 模型名。</b> 这里曾硬编码 9 条
     * （{@code /model glm-5.1}、{@code /model deepseek}…），于是只配了 anthropic 的用户
     * 敲 {@code /} 会看到「切换到 GLM-5.1」。provider 名现在只有一个来源：
     * config 驱动的 {@link WraithCompleter} 补全。
     *
     * <p>本表的四个消费者里有三个是无 config 参数的 static 方法
     * （{@code printSlashCommandHelp} / {@code slashCommandTailTips} /
     * {@code formatSlashCommandChoices}），所以这里选择「删掉 provider 专属项」
     * 而不是「把 config 穿进来再生成」——后者要改三处签名，且会再造一份 provider 名单。
     */
```

- [ ] **Step 4: 改 `:3267` 的帮助文案**

```java
            case 0, 1 -> "💡 GLM: /model glm-5.1 / /model glm-5v-turbo；其它: /model deepseek|step|kimi|freellmapi|xfyun 读取配置模型";
```

改为（不点名任何 provider）：

```java
            // 不点名具体 provider:用户可能一个 GLM 都没配。按 Tab 从已配置的里选。
            case 0, 1 -> "💡 切换 provider: /model <name>（按 Tab 列出已配置的）；配置: /config provider <name>";
```

- [ ] **Step 5: 跑测试确认绿 + 无回归**

```bash
mvn -q test -DskipTests=false -Dtest=MainInputNormalizationTest,WraithCompleterTest
mvn -q compile -DskipTests=false
```

Expected: 全 PASS。若 `slashCommandHintsIncludeRagSlashCommands`（:192-202）红了，检查你有没有误删非 provider 的条目——它只断言 `/index`/`/search`/`/graph`/`/compact` 存在，不该受影响。

⚠️ 注意 `formatSlashCommandChoices` 那条的 `choices.lines().count() < slashCommandHints().size()` 是**相对**比较。删掉 9 条后表变短，紧凑多列的行数也会变——若这条红了，说明删完之后表太短、多列渲染的行数不再明显少于条目数。那不是回归，是这条断言在小表上失去意义；如遇到，报告给我，不要自己放宽阈值。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/MainInputNormalizationTest.java
git commit -F - <<'EOF'
fix(cli): 敲 / 不该再推荐 GLM——slashCommandHints 里那 9 条硬编码删掉

Task 5 的评审全仓 grep 后发现:硬编码的 provider 名单是**六份**不是我调查时
断定的四份,漏掉的两处都在 Main.java,而且是最显眼的 ——

  slashCommandHints()(:3026-3037)有 9 条 provider 专属提示,含
  /model glm-5.1 与 /model glm-5v-turbo。它有四个消费者,其中一个是
  WraithCompleter:82 —— 也就是用户敲 / 时弹出的顶层提示表。于是 Task 5 把
  completeModel/completeConfig 改成 config 驱动之后,只配了 anthropic 的用户
  敲 / 依然看到「切换到 GLM-5.1」。

  handleConfigPalette 的帮助文案(:3267)同样硬写「GLM: /model glm-5.1 …」。

修法是**删副本,不复制副本**:那 9 条整体删掉,静态表只留裸 /model 与裸
/config provider ,provider 名此后只有一个来源 —— Task 5 已改成 config 驱动的
WraithCompleter 补全。

为什么不把 config 穿进来生成:本表四个消费者里三个是无 config 参数的 static
方法(printSlashCommandHelp / slashCommandTailTips / formatSlashCommandChoices),
穿参要改三处签名及其调用链,而且会再造一份 provider 名单 —— 那正是本次要消灭的东西。

MainInputNormalizationTest 那条 slashCommandChoices… 在断言旧契约(硬断言
/model glm-5.1 等 6 条),已改写:它的真实意图是「紧凑多列直接渲染、不带 JLine
确认文案」,provider 断言只是当年顺手抓的脚手架。改写后加了一条负向断言
(glm-5.1 不该再出现),这条在改实现前是红的。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## Task 6: `defaultProvider` 初值改 null + 桌面文案去 GLM

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java:38`
- Modify: `desktop/src/renderer/App.tsx:578`
- Test: `src/test/java/com/lyhn/wraith/config/DefaultProviderInitialValueTest.java`（Create）
- Test: `desktop/test/providerAgnosticPanel.test.tsx`（Create）

**Interfaces:**
- Consumes: Task 1–5 全部就位（尤其 Task 2 的回落必须先能工作，否则改初值会让「什么都没配」的路径更早返回 null）
- Produces: 无新 API

- [ ] **Step 1: 写失败的 Java 测试**

创建 `src/test/java/com/lyhn/wraith/config/DefaultProviderInitialValueTest.java`：

```java
package com.lyhn.wraith.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 全新 config 不该预设任何 provider。
 *
 * <p>{@code defaultProvider} 的硬编码初值曾是 {@code "glm"}，而 {@link WraithConfig#save()}
 * 整对象落盘 —— 于是全新安装第一次保存就把 {@code "glm"} 写进了
 * {@code ~/.wraith/config.json}，哪怕用户配的是 anthropic。用户的原话是
 * 「最开始面向 glm 只是因为我只有 glm 的，现在不应该出现只能用 glm 才能完成的事情」。
 *
 * <p>本测试只碰内存对象，不读写真实 config.json。
 */
class DefaultProviderInitialValueTest {

    @Test
    @DisplayName("全新 WraithConfig 的 defaultProvider 不预设任何 provider")
    void freshConfigHasNoPresetDefault() {
        String actual = new WraithConfig().getDefaultProvider();

        assertTrue(actual == null || actual.isBlank(),
                "全新 config 不该预设 provider,实际是: " + actual);
    }

    @Test
    @DisplayName("尤其不能是 glm")
    void freshConfigDefaultIsNotGlm() {
        assertNotEquals("glm", new WraithConfig().getDefaultProvider());
    }

    @Test
    @DisplayName("null 默认下,effectiveDefault 与 candidates 首项始终一致")
    void nullDefaultKeepsResolverSelfConsistent() {
        // 断言的是两个 API 之间的**关系**,在任何机器上都成立;
        // 不断言具体值 —— 那取决于跑它的机器设了哪些 *_API_KEY。
        WraithConfig c = new WraithConfig();

        java.util.List<String> list = ProviderResolver.candidates(c);
        String expected = list.isEmpty() ? "" : list.get(0);

        assertEquals(expected, ProviderResolver.effectiveDefault(c),
                "effectiveDefault 必须就是候选首项,否则两个入口会给出矛盾的答案");
    }
}
```

- [ ] **Step 2: 跑测试确认它红**

```bash
mvn -q test -DskipTests=false -Dtest=DefaultProviderInitialValueTest
```

Expected: 前两条 FAIL（实际是 `"glm"`）。

- [ ] **Step 3: 改 `WraithConfig.java:38`**

```java
    /**
     * 用户显式选定的 provider；未选过时为 null。
     *
     * <p><b>刻意不预设。</b> 这里曾硬编码 {@code "glm"}，而 {@link #save()} 整对象落盘 ——
     * 于是全新安装第一次保存就把 {@code "glm"} 写进了 config.json，哪怕用户配的是别的。
     * 之后 {@code createFromConfig} 先试这个无 key 的 glm，再遍历一份硬编码白名单，
     * 返回 null，界面说「无可用模型」。
     *
     * <p>为 null 时由 {@code ProviderResolver} 现算有效默认；用户存 / 删 provider 时
     * {@code ProviderDefaults.healDefault} 会把它填上。
     */
    private String defaultProvider = null;
```

- [ ] **Step 4: 跑 Java 测试确认绿 + 全量回归**

```bash
mvn -q test -DskipTests=false -Dtest=DefaultProviderInitialValueTest
mvn test -DskipTests=false 2>&1 | tail -25
```

Expected: 新测试 PASS。全量结果与本任务开始前的基线一致（无新增失败）。

**若出现新增失败**：多半是某个测试隐含依赖 `defaultProvider` 初值为 `"glm"`。定位办法：
```bash
rg -n 'getDefaultProvider|defaultProvider' src/test/java/
```
逐个看它是在测「初值就该是 glm」（那条测试本身要改，附上理由注释）还是别的。

- [ ] **Step 5: 写失败的桌面测试**

创建 `desktop/test/providerAgnosticPanel.test.tsx`：

桩的写法照 `desktop/test/providersPanelBaseUrlHint.test.tsx`（同一组件的既有测试），
**不要自己发明**——尤其首行的 `// @vitest-environment jsdom` 和 `afterEach(cleanup)`，少了就跑不起来。

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ProvidersPanel from '../src/renderer/components/ProvidersPanel'
import { PROVIDER_CATALOG } from '../src/shared/providerCatalog'

afterEach(cleanup)

/**
 * 后端删掉 KNOWN_PROVIDERS 之后,model.list 的 providers 可能是空数组,
 * 且 default 可能指向一个不在 providers 里的 id(过渡期的 stale 值)。
 * 这两条是防御性回归锁:面板本来就按 hasKey 过滤,应当本来就扛得住 ——
 * 锁住它,是为了让「删 KNOWN_PROVIDERS 打断了桌面」这件事一旦发生就立刻可见。
 */
function stubModelList(result: unknown): void {
  ;(window as unknown as { wraith: unknown }).wraith = {
    modelList: vi.fn(async () => result),
    setProvider: vi.fn(async () => ({ ok: true })),
    removeProvider: vi.fn(async () => ({ ok: true })),
    setDefaultProvider: vi.fn(async () => ({ ok: true })),
    testProvider: vi.fn(async () => ({ ok: true })),
  }
}

describe('ProvidersPanel — provider 无关化后的载荷形态', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('providers 为空数组时不崩,「全部」组仍列出整份 catalog', async () => {
    stubModelList({ current: { provider: '', model: '' }, default: '', providers: [] })

    render(<ProvidersPanel onBack={vi.fn()} />)

    // catalog 是前端自带的,不受后端载荷影响。providers 为空 → doneRows 为空,
    // 于是 provider-config 按钮只来自 catalog 行。
    const rows = await screen.findAllByTestId('provider-config')
    expect(rows.length).toBe(PROVIDER_CATALOG.length)
  })

  it('default 指向 providers 里不存在的 id 时不崩(stale "glm" 的过渡期)', async () => {
    stubModelList({
      current: { provider: 'anthropic', model: 'claude-haiku-4-5' },
      default: 'glm',
      providers: [
        { name: 'anthropic', model: 'claude-haiku-4-5', hasKey: true, baseUrl: '', protocol: 'anthropic', label: '' },
      ],
    })

    render(<ProvidersPanel onBack={vi.fn()} />)

    expect(await screen.findByTestId('providers-panel')).toBeTruthy()
    expect(screen.getByText('Anthropic')).toBeTruthy()
  })
})
```

- [ ] **Step 6: 跑桌面测试**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
npx vitest run test/providerAgnosticPanel.test.tsx
```

Expected: PASS（面板本来就按 `hasKey` 过滤，这两条是**防御性回归锁**，用来确认删 `KNOWN_PROVIDERS` 不会打断桌面）。

**若 FAIL**：说明面板对空数组或 stale default 确有假设。按报错修 `ProvidersPanel.tsx`，并在提交信息里写清改了什么。若是本测试的 `window.wraith` 桩不对，参照 `desktop/test/` 里已有面板测试的桩写法对齐。

- [ ] **Step 7: 改 `App.tsx:578` 文案**

当前：

```tsx
      setSubmitError(`当前模型「${state.model}」不支持图片。请切到支持视觉的模型(如 glm-5v-turbo),或移除图片后再发。`)
```

改为：

```tsx
      // 不点名具体模型:这里曾硬写「如 glm-5v-turbo」,而用户可能根本没有 GLM。
      // 哪些模型支持视觉由 shared/modelVision.ts 判定,与 provider 无关。
      setSubmitError(`当前模型「${state.model}」不支持图片。请切到支持视觉的模型,或移除图片后再发。`)
```

- [ ] **Step 8: 桌面全量验证**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
npx tsc --noEmit
npx vitest run 2>&1 | tail -20
```

Expected: tsc 零错误；vitest 与基线一致。

**若有测试断言了旧文案里的 `glm-5v-turbo`**，改掉它并附一行理由注释（不要为了让测试绿而把文案改回去）。

- [ ] **Step 9: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/config/WraithConfig.java \
        src/test/java/com/lyhn/wraith/config/DefaultProviderInitialValueTest.java \
        desktop/src/renderer/App.tsx \
        desktop/test/providerAgnosticPanel.test.tsx
git commit -F - <<'EOF'
fix(config+desktop): 全新安装不再预设 glm;图片提示不再点名 glm-5v-turbo

WraithConfig.defaultProvider 的硬编码初值 "glm" 改为 null。它此前的实际效果是:
save() 整对象落盘 → 全新安装第一次保存就把 "glm" 写进 ~/.wraith/config.json,
哪怕用户配的是 anthropic → createFromConfig 先试这个无 key 的 glm。这是本次
bug 链条的起点。为 null 时由 ProviderResolver 现算有效默认,用户存/删 provider
时 ProviderDefaults.healDefault 填上。

App.tsx 的图片拦截文案去掉「如 glm-5v-turbo」举例 —— 用户可能根本没有 GLM,
而哪些模型支持视觉由 shared/modelVision.ts 判定。

新增两条桌面防御性回归锁:后端删掉 KNOWN_PROVIDERS 后 providers 可能是空数组、
default 可能指向不在 providers 里的 stale id,面板都得扛住。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## Task 7: 端到端收尾 —— 全量回归 + 文档

**Files:**
- Modify: `AGENTS.md`（provider 相关的连带清单）
- Modify: `.env.example`（说明 env-only 发现与护栏）

**Interfaces:**
- Consumes: Task 1–6 全部完成

- [ ] **Step 1: 确认四份硬编码真的都没了**

```bash
cd /Users/aa00945/Desktop/wraith
echo "=== 应该只剩 ProviderResolver.ENDPOINT_KNOWN 一处(那是护栏表,不是白名单) ==="
rg -n '"glm", "deepseek", "step", "kimi"' src/main/java/
rg -n "'glm', 'deepseek'" src/main/java/
echo "=== KNOWN_PROVIDERS 应该零命中 ==="
rg -n 'KNOWN_PROVIDERS' src/ || echo "✅ 已清除"
```

Expected：`KNOWN_PROVIDERS` 零命中；6 家列表只在 `ProviderResolver.ENDPOINT_KNOWN` 出现一次（且那里含 anthropic/openai 共 8 个，不是 6 个）。

- [ ] **Step 2: Java 全量**

```bash
mvn test -DskipTests=false 2>&1 | tail -25
```

Expected: 与本计划开始前的基线相比无新增失败。**把实际数字记下来写进提交信息，不要写「全绿」了事。**

- [ ] **Step 3: 桌面全量**

```bash
cd desktop && npx tsc --noEmit && npx vitest run 2>&1 | tail -20
```

Expected: tsc 零错误；vitest 与基线一致。

- [ ] **Step 4: 更新 `AGENTS.md`**

在 provider / 配置相关章节（`rg -n 'provider' AGENTS.md` 定位）加一条连带清单：

```markdown
- 改 provider 选择逻辑时连带：`ProviderResolver`（唯一的候选排序）+ `LlmClientFactory.createFromConfig` + `ModelCatalog.providers/result` + `ProviderDefaults.healDefault` + `WraithCompleter` 的两处补全。**不要新增第五份 provider 名单** —— 那 6 家曾被硬编码四遍且互不一致，其中一份是可达 bug（只配 anthropic 起不来），详见 `docs/superpowers/specs/2026-08-03-provider-agnostic-registry-design.md`。`ProviderResolver.ENDPOINT_KNOWN` 是 env-only 发现的护栏表（记录哪个 client 类烧死了哪个端点），**不是**偏好白名单。
```

- [ ] **Step 5: 更新 `.env.example`**

在 provider key 相关段落追加：

```bash
# ── provider 的发现方式 ────────────────────────────────────────────────────
# wraith 按这个顺序找可用 provider:
#   1. ~/.wraith/config.json 里 defaultProvider 指定的那个(若它有 key)
#   2. config.json 的 providers 里其余有 key 的(按你添加的顺序)
#   3. 本文件 / 环境变量里发现的 <NAME>_API_KEY  → provider 名 = 小写的 NAME
#
# 所以只在这里写一行 ANTHROPIC_API_KEY=sk-... 就能跑,不必打开桌面面板。
# 同理 OPENAI_API_KEY / DEEPSEEK_API_KEY / GLM_API_KEY 等。
#
# 第 3 条有一道护栏:端点定不了的不会被采用。以下 provider 有内置端点,只给 key 即可 ——
#   glm / deepseek / step / kimi / freellmapi / xfyun / anthropic / openai
# 其它(自建服务、代理网关)必须同时给 <NAME>_BASE_URL,例如:
#   MY_GATEWAY_API_KEY=sk-...
#   MY_GATEWAY_BASE_URL=https://llm.internal/v1
# 为什么要这道闸:baseUrl 空着时会兜底到 https://api.openai.com/v1 ——
# 那意味着把你的 key 静默发给 OpenAI,比连不上更糟。
#
# 注意 EMBEDDING_API_KEY 与任何 WRAITH_* 都不会被当成推理 provider(前者是 RAG 的
# embedding 后端,后者是 wraith 自己的命名空间,如 Runtime HTTP API 的认证 key)。
```

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add AGENTS.md .env.example
git commit -F - <<'EOF'
docs: provider 发现方式写进 .env.example,连带清单写进 AGENTS.md

.env.example 补齐三级发现顺序(config default → config 其余 → env 的
<NAME>_API_KEY),并写清护栏:端点定不了的 env 候选不会被采用,自建服务须同时给
<NAME>_BASE_URL。理由也写上 —— baseUrl 空着会兜底 api.openai.com,那是把 key
静默发给 OpenAI,比连不上更糟。

AGENTS.md 加连带清单,重点是「不要新增第五份 provider 名单」:那 6 家曾被硬编码
四遍且互不一致,其中一份是可达 bug。并说明 ProviderResolver.ENDPOINT_KNOWN 是
护栏表(记录哪个 client 类烧死了哪个端点),不是偏好白名单 —— 免得下一个人当成
白名单又去别处抄一份。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
```

---

## 验收条件

按 spec §4 的四条行为变化逐条核对：

| # | 条件 | 怎么验 |
|---|---|---|
| 1 | `model.list` 的 `providers` 只报真有的 | `ModelCatalogTest.emptyConfigReportsNoProviders` / `reportsExactlyWhatIsConfigured` |
| 2 | `default` 报有效默认 | `ModelCatalogTest.resultReportsEffectiveDefault` |
| 3 | 新 config 不写 `defaultProvider: "glm"` | `DefaultProviderInitialValueTest` |
| 4 | env-only 非白名单 provider 能被发现 | `ProviderResolverTest.discoversEnvOnlyProvider` |
| — | **只配 anthropic 就能启动**（本次的核心 bug） | `LlmClientFactoryFallbackTest.anthropicOnlyIsFound` |
| — | 四份硬编码清零 | Task 7 Step 1 的 `rg` 检查 |

## 真机眼验（我验不了的，交给用户）

按 spec §6：

1. **`.env` 里只放 `ANTHROPIC_API_KEY`、不碰桌面面板 → 能起来并对话。** 单测注入了 env 查询，真实环境的行为要真机验。
2. **桌面里新配一个 provider 点保存 → 立刻可用，不必再点「设默认」。** `ensureClient` 真装上没有，单测只能验 resolver 的返回值。
3. **老 config.json（`defaultProvider: "glm"` 且 glm 无 key）→ 面板上「默认」标出现在真正在用的 provider 上。**
4. **REPL 里 `/model ` 与 `/config provider ` 的补全只列出你配过的 provider**，不再首推 `glm-5.1`。

不涉 Windows 特有路径，无新增跨平台不可验项。
