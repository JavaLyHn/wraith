# 搜索对等 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `web_search` 的三条路取值链对等（都能从 `config.json` 读），把「未配置」话术从 Zhipu provider 手里拿走，给 SearXNG 一条可粘贴的零门槛引导，再加一条显式可选的零 key 应急后端。

**Architecture:** `WraithConfig` 新增 `search` 节（照 `embedding` 同构）；`SearchProviderFactory` 的取值链由「每个 key 各自读一次 config」改成「一次解析出 `SearchSettings` 四元组」；新增 `UnconfiguredSearchProvider` 承担未配置话术（检测函数注入，纯文本可单测）与 `DuckDuckGoSearchProvider`（显式可选，自动链永不返回）；`/config search` 作为写入口，写完调 `ToolRegistry.invalidateSearchProvider()`。

**Tech Stack:** Java 17 / Maven；OkHttp（HTTP）+ jsoup 1.18.1（HTML 解析，`pom.xml:97-101` 已有 compile scope）+ Jackson（config 序列化）；测试用 JUnit 5 + OkHttp MockWebServer（`pom.xml` 已有 test scope）。

**Spec:** `docs/superpowers/specs/2026-08-03-search-parity-design.md`（D1→Task 1，D3→Task 2，D2→Task 3，D6→Task 4，D4→Task 5，D5→Task 6 —— D3 提到 D2 之前，因为 `UnconfiguredSearchProvider` 的无参构造要引用 `SearchDetection`）

## Global Constraints

- **不得读写真实 `~/.wraith/config.json`。** 测试一律用内存 `new WraithConfig()`，或 `@TempDir` + `System.setProperty("wraith.config.dir", ...)` 并在 finally 里还原。
- **不得依赖真实环境变量。** 本 checkout 的 `./.env` 含真实 `DEEPSEEK_API_KEY`，而 `WraithConfig.getApiKey(p)` 会回落读它；`SearchProviderFactory.readEnvOnly` 也读 `./.env` 与 `~/.env`。所有取值与检测函数一律注入。
- **绝不打印或断言真实密钥。** 测试里的 key 一律用 `sk-fake-*` 这类明显假串。
- **检测函数（docker 在不在 PATH、8888 有没有人听）一律注入**，测试不真查 PATH、不真连网。
- `mvn` 命令**必须**带 `-DskipTests=false`（本仓库默认跳过测试，否则是假绿）。
- 每个任务结束时 Java 全量必须是 `0 Failures / 0 Errors`。当前基线：**1952 tests / 0F / 0E**。
- `git add` **只加**本任务明确列出的文件；**绝不** `git add .` / `git add -A`；**绝不** `git add` 真实 `.env`；不提交 `demo/pom.xml`。
- commit message 末尾**必须**是这两行，顺序不变：
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
  ```
- **`GLM_API_KEY` → `providers.glm.apiKey` 的既有回落必须保留**，不是移除（spec §3.1）。「对等」是抬高低的，不是压低高的。
- **`pickProvider` 的签名不变**：`pickProvider(String explicit, String glmKey, String serpKey, String searxngUrl)`。
- **自动选择链永不返回 `"duckduckgo"`**（spec §3.6 核心约束）。
- 话术里**不得**把 GLM 作为推荐，只能作为三选一之一。

---

## File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `src/main/java/com/lyhn/wraith/config/WraithConfig.java` | 加 `SearchConfig` 静态类 + `search` 字段 + getter/setter | 1 |
| `src/main/java/com/lyhn/wraith/web/SearchProviderFactory.java` | 取值链、provider 选择、`create()` 派发 | 1,3,4 |
| `src/main/java/com/lyhn/wraith/web/UnconfiguredSearchProvider.java` | **新建**。未配置话术的载体（检测注入） | 3 |
| `src/main/java/com/lyhn/wraith/web/SearchDetection.java` | **新建**。docker-in-PATH 与 TCP 端口探测（纯函数 + 可注入） | 2 |
| `src/main/java/com/lyhn/wraith/web/DuckDuckGoSearchProvider.java` | **新建**。显式可选的零 key 后端 | 4 |
| `src/main/java/com/lyhn/wraith/web/ZhipuSearchProvider.java` | `unavailableHint()` 收窄成 GLM 专属 | 3 |
| `src/main/java/com/lyhn/wraith/web/SearchProvider.java` | 接口注释补全四家实现 | 6 |
| `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` | `invalidateSearchProvider()` + 两个包可见测试钩子 | 5 |
| `src/main/java/com/lyhn/wraith/cli/Main.java` | `/config search` 解析 + 路由 + 接线 | 5 |
| `.env.example` / `AGENTS.md` / `src/renderer/lib/pluginShowcase.ts` / `src/main/resources/skills/web-access/SKILL.md` | 文案与文档 | 6 |

---

### Task 1: D1 —— `search` 节进 config.json，取值链对等

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`（`:53` 字段区、`:151-166` `EmbeddingConfig` 之后、`:196-197` getter 区）
- Modify: `src/main/java/com/lyhn/wraith/web/SearchProviderFactory.java`（`:41-56` `create()`、`:78-113` `resolveKey`/`readEnv`/`providerForKey`）
- Test: `src/test/java/com/lyhn/wraith/web/SearchConfigResolutionTest.java`（新建）

**Interfaces:**
- Produces:
  - `WraithConfig.SearchConfig`（嵌套静态类，字段 `provider` / `apiKey` / `baseUrl`，各带 getter/setter）
  - `WraithConfig.getSearch()` / `WraithConfig.setSearch(SearchConfig)`
  - `SearchProviderFactory.SearchSettings`（package-visible record）：
    ```java
    record SearchSettings(String provider, String glmKey, String serpKey, String searxngUrl, String zhipuEngine) {}
    ```
  - `static SearchSettings SearchProviderFactory.resolveSettings(java.util.function.Function<String,String> envLookup, WraithConfig.SearchConfig search, java.util.function.Function<String,String> providerKeyLookup)` —— package-visible，纯函数，Task 2/3/4 的 `create()` 都从它拿值
- Consumes: 无（第一个任务）

- [ ] **Step 1: 写会红的测试**

新建 `src/test/java/com/lyhn/wraith/web/SearchConfigResolutionTest.java`：

```java
package com.lyhn.wraith.web;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 三条搜索路的取值链必须对等 —— 都能从 config.json 的 search 节读到。
 *
 * <p>此前只有 GLM_API_KEY 能回落 config.json（因为它蹭的是 providers.glm.apiKey），
 * SERPAPI_KEY / SEARXNG_URL 在 config.json 里没有对应概念，只能来自环境变量。
 * 「只有 GLM 零配置」的全部机制就是这个取值链不对等，不是搜索代码偏爱智谱。
 *
 * <p>全部走注入入口：不碰真实环境变量、不碰真实 ~/.wraith/config.json。
 */
class SearchConfigResolutionTest {

    private static WraithConfig.SearchConfig search(String provider, String apiKey, String baseUrl) {
        WraithConfig.SearchConfig s = new WraithConfig.SearchConfig();
        s.setProvider(provider);
        s.setApiKey(apiKey);
        s.setBaseUrl(baseUrl);
        return s;
    }

    /** 环境侧一概没有。 */
    private static final java.util.function.Function<String, String> NO_ENV = k -> null;
    /** providers.* 侧一概没有。 */
    private static final java.util.function.Function<String, String> NO_PROVIDER_KEY = p -> null;

    @Test
    @DisplayName("searxng 的 baseUrl 能从 search 节读到（此前只能来自 SEARXNG_URL 环境变量）")
    void searxngBaseUrlComesFromSearchSection() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                NO_ENV, search("searxng", null, "http://localhost:8888"), NO_PROVIDER_KEY);

        assertEquals("searxng", s.provider());
        assertEquals("http://localhost:8888", s.searxngUrl());
    }

    @Test
    @DisplayName("serpapi 的 key 能从 search 节读到，但仅当 provider 明确是 serpapi")
    void serpKeyComesFromSearchSectionOnlyWhenProviderIsExplicit() {
        SearchProviderFactory.SearchSettings explicit = SearchProviderFactory.resolveSettings(
                NO_ENV, search("serpapi", "sk-fake-serp", null), NO_PROVIDER_KEY);
        assertEquals("sk-fake-serp", explicit.serpKey());

        // provider 为空时不猜 apiKey 属于谁 —— 猜错会把 SerpAPI 的 key 发给智谱
        SearchProviderFactory.SearchSettings ambiguous = SearchProviderFactory.resolveSettings(
                NO_ENV, search(null, "sk-fake-serp", null), NO_PROVIDER_KEY);
        assertNull(ambiguous.serpKey(), "provider 未明确时 apiKey 不该被当成 serpapi 的");
        assertNull(ambiguous.glmKey(), "provider 未明确时 apiKey 也不该被当成 zhipu 的");
    }

    @Test
    @DisplayName("zhipu 的 key 能从 search 节读到，且 providers.glm.apiKey 的既有回落不被破坏")
    void zhipuKeyFromSearchSectionAndLegacyGlmFallbackBothWork() {
        SearchProviderFactory.SearchSettings fromSearch = SearchProviderFactory.resolveSettings(
                NO_ENV, search("zhipu", "sk-fake-from-search", null), NO_PROVIDER_KEY);
        assertEquals("sk-fake-from-search", fromSearch.glmKey());

        // search 节没有 apiKey 时，回落 providers.glm.apiKey —— 这是既有行为，必须保留
        SearchProviderFactory.SearchSettings fromProviders = SearchProviderFactory.resolveSettings(
                NO_ENV, null, p -> "glm".equals(p) ? "sk-fake-from-providers" : null);
        assertEquals("sk-fake-from-providers", fromProviders.glmKey());

        // search 节更具体，胜出
        SearchProviderFactory.SearchSettings both = SearchProviderFactory.resolveSettings(
                NO_ENV, search("zhipu", "sk-fake-from-search", null),
                p -> "glm".equals(p) ? "sk-fake-from-providers" : null);
        assertEquals("sk-fake-from-search", both.glmKey());
    }

    @Test
    @DisplayName("env 优先于 config 的 search 节")
    void envWinsOverSearchSection() {
        java.util.function.Function<String, String> env = k -> switch (k) {
            case "SEARCH_PROVIDER" -> "serpapi";
            case "SEARXNG_URL" -> "http://from-env:8888";
            case "SERPAPI_KEY" -> "sk-fake-env-serp";
            default -> null;
        };

        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                env, search("searxng", "sk-fake-config-serp", "http://from-config:8888"), NO_PROVIDER_KEY);

        assertEquals("serpapi", s.provider());
        assertEquals("http://from-env:8888", s.searxngUrl());
        assertEquals("sk-fake-env-serp", s.serpKey());
    }

    @Test
    @DisplayName("空白与空串当作没有配")
    void blankValuesCountAsAbsent() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                k -> "   ", search("  ", "  ", "  "), p -> "   ");

        assertNull(s.provider());
        assertNull(s.searxngUrl());
        assertNull(s.serpKey());
        assertNull(s.glmKey());
    }

    @Test
    @DisplayName("search 节整节缺失时回落 env，不抛异常")
    void missingSearchSectionFallsBackToEnv() {
        java.util.function.Function<String, String> env = k -> "SEARXNG_URL".equals(k)
                ? "http://localhost:8888" : null;

        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(env, null, NO_PROVIDER_KEY);

        assertEquals("http://localhost:8888", s.searxngUrl());
        assertNull(s.provider());
    }

    @Test
    @DisplayName("providers 侧读取抛异常时当作「没有」，不把搜索链路带崩（沿用 resolveKey 的吞异常约定）")
    void providerLookupExceptionIsSwallowed() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                NO_ENV, null, p -> { throw new RuntimeException("config.json 坏了"); });

        assertNull(s.glmKey(), "配置文件坏了该退化成「未配置」，用户看到可行动的提示；一个堆栈不是");
    }

    @Test
    @DisplayName("ZHIPU_SEARCH_ENGINE 仍是环境变量专属（config.json 里没有对应概念）")
    void zhipuEngineStaysEnvOnly() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                k -> "ZHIPU_SEARCH_ENGINE".equals(k) ? "search_pro" : null, null, NO_PROVIDER_KEY);

        assertEquals("search_pro", s.zhipuEngine());
    }
}
```

- [ ] **Step 2: 跑测试确认编译失败**

Run: `mvn -DskipTests=false -Dtest=SearchConfigResolutionTest test`
Expected: 编译失败，`cannot find symbol: class SearchConfig` / `method resolveSettings`

- [ ] **Step 3: 在 `WraithConfig` 加 `SearchConfig`**

在 `WraithConfig.java` 的 `EmbeddingConfig` 类之后（`:166` 那个 `}` 下面）插入：

```java
    /**
     * 搜索后端配置。三条路共用一个形状：provider 选谁、apiKey 给谁、baseUrl 指哪。
     *
     * <p>这一节存在的理由是<b>取值链对等</b>：此前只有 {@code GLM_API_KEY} 能回落
     * {@code config.json}（它蹭的是 {@code providers.glm.apiKey}），{@code SERPAPI_KEY} /
     * {@code SEARXNG_URL} 在 config.json 里没有对应概念，于是只能来自环境变量。
     * 「只有配了 GLM 的人 web_search 才零配置可用」的全部机制就是这个不对等。
     *
     * <p>{@code apiKey} 一个字段服务 zhipu 与 serpapi 两家，靠 {@code provider} 区分——
     * 搜索一次只用一家，不需要同时存多家的 key。{@code provider} 为空而 {@code apiKey} 有值时
     * <b>不猜它属于谁</b>，直接当作没有：猜错会把 SerpAPI 的 key 发给智谱（或反之）。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SearchConfig {
        private String provider;   // zhipu | serpapi | searxng | duckduckgo；空 = 自动选
        private String apiKey;     // zhipu / serpapi 用；仅本地存储,绝不回包/日志
        private String baseUrl;    // searxng 用
        public String getProvider() { return provider; }
        public void setProvider(String v) { this.provider = v; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String v) { this.apiKey = v; }
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String v) { this.baseUrl = v; }
    }
```

在 `:53` 的 `private EmbeddingConfig embedding;` 下面加：

```java
    /** 搜索后端配置。缺省时 SearchProviderFactory 回落 env / 自动选。 */
    private SearchConfig search;
```

在 `:197` 的 `public void setEmbedding(...)` 下面加：

```java
    public SearchConfig getSearch() { return search; }
    public void setSearch(SearchConfig search) { this.search = search; }
```

- [ ] **Step 4: 在 `SearchProviderFactory` 加 `SearchSettings` + `resolveSettings`**

在 `SearchProviderFactory` 类里、`pickProvider` 之后插入：

```java
    /**
     * 三条路的最终取值，一次解析完。
     *
     * <p>为什么是一个四元组而不是四次 {@code resolveKey}：旧写法里每个 key 各自
     * {@code WraithConfig.load()} 一遍（一共四遍），既浪费也可能读到不一致的快照。
     */
    record SearchSettings(String provider, String glmKey, String serpKey,
                          String searxngUrl, String zhipuEngine) {}

    /**
     * 取值链：<b>env / 系统属性 / .env（{@code envLookup}）→ config.json 的 {@code search} 节
     * → {@code providers.glm.apiKey}（仅 GLM，既有回落）</b>。
     *
     * <p>三个来源全部注入，便于不碰真实环境地单测（本仓库既有做法）。
     *
     * <p><b>{@code apiKey} 只在 {@code provider} 明确时才被读取。</b> 一个字段服务 zhipu 与
     * serpapi 两家，靠 {@code provider} 区分；{@code provider} 为空时不猜归属，宁可报「未配置」。
     *
     * <p>{@code providerKeyLookup} 抛出的任何异常都吞掉当作「没有」——配置文件坏了不该把整条
     * 搜索链路带崩，用户会看到的是「未配置」提示，那是可行动的；一个堆栈不是。
     */
    static SearchSettings resolveSettings(java.util.function.Function<String, String> envLookup,
                                          com.lyhn.wraith.config.WraithConfig.SearchConfig search,
                                          java.util.function.Function<String, String> providerKeyLookup) {
        String provider = firstNonBlank(envLookup.apply("SEARCH_PROVIDER"),
                search == null ? null : search.getProvider());
        String searxngUrl = firstNonBlank(envLookup.apply("SEARXNG_URL"),
                search == null ? null : search.getBaseUrl());
        String searchApiKey = search == null ? null : search.getApiKey();
        String normalizedProvider = provider == null ? "" : provider.toLowerCase(Locale.ROOT);

        String serpKey = firstNonBlank(envLookup.apply("SERPAPI_KEY"),
                "serpapi".equals(normalizedProvider) ? searchApiKey : null);
        String glmKey = firstNonBlank(envLookup.apply("GLM_API_KEY"),
                "zhipu".equals(normalizedProvider) ? searchApiKey : null,
                lookupQuietly(providerKeyLookup, "glm"));

        return new SearchSettings(provider, glmKey, serpKey, searxngUrl,
                firstNonBlank(envLookup.apply("ZHIPU_SEARCH_ENGINE")));
    }

    /** 第一个非空白值（已 trim），全空则 {@code null}。 */
    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }

    private static String lookupQuietly(java.util.function.Function<String, String> lookup, String provider) {
        try {
            return lookup.apply(provider);
        } catch (Exception e) {
            log.warn("读取 ~/.wraith/config.json 失败,搜索 key 回落为未配置: {}", e.getMessage());
            return null;
        }
    }
```

- [ ] **Step 5: 把 `create()` 切到 `resolveSettings`，删掉 `providerForKey` / `resolveKey` / `readEnv`**

把 `create()`（`:41-56`）整段替换为：

```java
    public static SearchProvider create() {
        return create(resolveProductionSettings());
    }

    /** 候选表由调用方给出的重载——测试用它避开真实 env 与真实 config.json。 */
    static SearchProvider create(SearchSettings settings) {
        String chosen = pickProvider(settings.provider(), settings.glmKey(),
                settings.serpKey(), settings.searxngUrl());
        log.info("SearchProvider chosen: {}", chosen);

        return switch (chosen) {
            case "searxng" -> new SearxngSearchProvider(settings.searxngUrl());
            case "serpapi" -> new SerpApiSearchProvider(settings.serpKey());
            default -> new ZhipuSearchProvider(settings.glmKey(), settings.zhipuEngine());
        };
    }

    /**
     * 生产取值：env/属性/.env 由 {@link #readEnvOnly}，{@code search} 节与
     * {@code providers.glm.apiKey} 由 {@link com.lyhn.wraith.config.WraithConfig#load()}。
     *
     * <p>config 只加载一次（旧写法每个 key 加载一遍，共四遍）。加载本身失败时退化成
     * 「只有 env」，理由同 {@link #resolveSettings} 的吞异常约定。
     */
    private static SearchSettings resolveProductionSettings() {
        com.lyhn.wraith.config.WraithConfig config = null;
        try {
            config = com.lyhn.wraith.config.WraithConfig.load();
        } catch (Exception e) {
            log.warn("加载 ~/.wraith/config.json 失败,搜索配置只用环境变量: {}", e.getMessage());
        }
        com.lyhn.wraith.config.WraithConfig.SearchConfig search = config == null ? null : config.getSearch();
        com.lyhn.wraith.config.WraithConfig finalConfig = config;
        return resolveSettings(SearchProviderFactory::readEnvOnly, search,
                provider -> finalConfig == null ? null : finalConfig.getApiKey(provider));
    }
```

删掉 `providerForKey`（`:73-76`）、`resolveKey`（`:78-103`）、`readEnv`（`:105-110`）三个方法。
在类头 Javadoc 里把「只有能映射到 provider 的 key（目前是 `GLM_API_KEY` → `glm`）才查 config；`SERPAPI_KEY` / `SEARXNG_URL` 在 config.json 里没有对应概念，仍是环境变量专属。」这段改成：

```
 * 三条路的取值链现在是对等的：env → 系统属性 → ./.env → ~/.env → config.json 的 search 节。
 * GLM 额外保留一条 providers.glm.apiKey 回落（推理与搜索共用一个 key 是智谱的产品事实）。
```

需要新增 import：`java.util.Locale` 已有（`:8`），确认无需再加。

- [ ] **Step 6: 改写 `SearchKeyFromConfigTest`**

⚠️ **这个文件里有一条测试正在断言本次要删掉的契约**（第 7 条同类，spec §2.5 只数到第 6 条）。**不要机械翻译它**——`onlyMappedKeysConsultConfig`（`:51-58`）的 `@DisplayName` 写着「SERPAPI/SEARXNG 仍是环境变量专属」，**那正是 D1 要消除的不对等**。它必须被**反转**，不是移植。

**不要删除这个文件**：它记录的「GUI 里配好 GLM 但搜索读不到」那条回归仍需守住。

逐个用例的处置：

| 用例 | 行 | 处置 |
|---|---|---|
| `fallsBackToConfigJson` | 28-38 | 机械改写成 `resolveSettings` |
| `envWinsOverConfig` | 40-49 | 机械改写 |
| **`onlyMappedKeysConsultConfig`** | **51-58** | **反转**：改名 `everyRouteConsultsSearchSection`，断言三条路都读得到 |
| `blankConfigValueIsNothing` | 60-65 | 机械改写 |
| `configLookupFailureIsNotFatal` | 67-76 | 机械改写；**删掉那行 `assertDoesNotThrow`**——它与下一行的 `assertNull` 冗余，且 `assertNull` 判别力更强 |
| `configKeyMakesZhipuReady` | 78-84 | **不动**（它只用 `pickProvider` 与 `ZhipuSearchProvider`，不涉及 `resolveKey`） |
| `stillNotReadyWithNothing` | 86-91 | 机械改写第一行断言 |

反转后的那条写成：

```java
    @Test
    @DisplayName("三条路都能从 search 节读到 —— 此前 SERPAPI/SEARXNG 是环境变量专属,那就是不对等本身")
    void everyRouteConsultsSearchSection() {
        // 这条用例此前叫 onlyMappedKeysConsultConfig,断言的是
        // assertNull(resolveKey("SERPAPI_KEY", k -> null, provider -> "x")) ——
        // 即「config 里没有 serpapi 这个概念,查了也是白查」。那句话在 D1 之前是对的
        // (config.json 里确实没有 search 节),但它同时也是「只有 GLM 零配置」的机制:
        // 一条路能读配置文件,两条只能读环境变量。加了 search 节之后必须反转。
        WraithConfig.SearchConfig serp = new WraithConfig.SearchConfig();
        serp.setProvider("serpapi");
        serp.setApiKey("sk-fake-serp");
        assertEquals("sk-fake-serp",
                SearchProviderFactory.resolveSettings(k -> null, serp, p -> null).serpKey());

        WraithConfig.SearchConfig searxng = new WraithConfig.SearchConfig();
        searxng.setProvider("searxng");
        searxng.setBaseUrl("http://localhost:8888");
        assertEquals("http://localhost:8888",
                SearchProviderFactory.resolveSettings(k -> null, searxng, p -> null).searxngUrl());

        WraithConfig.SearchConfig zhipu = new WraithConfig.SearchConfig();
        zhipu.setProvider("zhipu");
        zhipu.setApiKey("sk-fake-zhipu");
        assertEquals("sk-fake-zhipu",
                SearchProviderFactory.resolveSettings(k -> null, zhipu, p -> null).glmKey());
    }
```

机械改写的形状（以首个用例为例）：

```java
    @Test
    @DisplayName("环境/属性/.env 都没有时,回落到 config.json 里的 glm key")
    void fallsBackToConfigJson() {
        SearchProviderFactory.SearchSettings s = SearchProviderFactory.resolveSettings(
                k -> null,                                  // 环境/属性/.env 一概没有
                null,                                       // search 节也没有
                provider -> "glm".equals(provider) ? "sk-from-gui" : null);

        assertEquals("sk-from-gui", s.glmKey(),
                "桌面里配好的 key 必须能被搜索用上,否则「共享同一份配置」是句空话");
    }
```

文件需要新增 import：`com.lyhn.wraith.config.WraithConfig`。类 Javadoc 里「key 的来源由 `resolveKey` 决定」改成「由 `resolveSettings` 决定」；其余起因记录原样保留（仍然准确）。

- [ ] **Step 7: 跑测试**

Run: `mvn -DskipTests=false -Dtest='SearchConfigResolutionTest,SearchKeyFromConfigTest,SearchProviderFactoryTest' test`
Expected: 全部 PASS

- [ ] **Step 8: 跑全量**

Run: `mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Tests run: 1960, Failures: 0, Errors: 0`（1952 + 8 新增），`BUILD SUCCESS`

- [ ] **Step 9: 提交**

```bash
git add src/main/java/com/lyhn/wraith/config/WraithConfig.java \
        src/main/java/com/lyhn/wraith/web/SearchProviderFactory.java \
        src/test/java/com/lyhn/wraith/web/SearchConfigResolutionTest.java \
        src/test/java/com/lyhn/wraith/web/SearchKeyFromConfigTest.java
git commit -m "$(cat <<'EOF'
feat(search): search 节进 config.json —— 三条搜索路的取值链终于对等(D1)

此前只有 GLM_API_KEY 能回落 config.json,因为它蹭的是 providers.glm.apiKey;
SERPAPI_KEY / SEARXNG_URL 在 config.json 里没有对应概念,只能来自环境变量。
「只有配了 GLM 的人 web_search 才零配置可用」的全部机制就是这个取值链不对等,
不是搜索代码偏爱智谱。

WraithConfig 加 search 节(provider/apiKey/baseUrl,照 embedding 同构)。
apiKey 一个字段服务 zhipu 与 serpapi 两家,靠 provider 区分;provider 为空而
apiKey 有值时不猜归属,直接当没有——猜错会把 SerpAPI 的 key 发给智谱。
providers.glm.apiKey 那条回落保留:推理与搜索共用一个 key 是智谱的产品事实,
删掉是无谓回归。「对等」是抬高低的,不是压低高的。

取值由「每个 key 各自 load 一次 config」(共四遍)改成一次解析出 SearchSettings
四元组,三个来源全部注入。config 读取抛异常一律吞成「没有」——配置文件坏了不该
把整条搜索链路带崩,用户看到的是可行动的「未配置」提示,一个堆栈不是。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 2: D3 —— 真实检测（docker 在 PATH / 8888 有人听）

**Files:**
- Create: `src/main/java/com/lyhn/wraith/web/SearchDetection.java`
- Test: `src/test/java/com/lyhn/wraith/web/SearchDetectionTest.java`（新建）

**Interfaces:**
- Consumes: 无（只依赖 JDK）。Task 3 的 `UnconfiguredSearchProvider` 无参构造会引用本任务产出的两个方法引用
- Produces:
  ```java
  public static boolean SearchDetection.dockerOnPath()                                  // 生产
  static boolean SearchDetection.dockerOnPath(String pathEnv, String pathSeparator, boolean windows)  // 可注入
  public static boolean SearchDetection.searxngPortListening()                          // 生产
  static boolean SearchDetection.portListening(String host, int port, int timeoutMillis) // 可注入
  public static final int SearchDetection.SEARXNG_DEFAULT_PORT = 8888;
  public static final String SearchDetection.SEARXNG_LOCAL_URL = "http://localhost:8888";
  ```
  两个常量的家在本类而不是 `UnconfiguredSearchProvider`：那边的无参构造要引用本类的两个检测方法，本类的端口探测又要用这个端口——常量留在那边就成了环。依赖单向：`UnconfiguredSearchProvider` → `SearchDetection`。

- [ ] **Step 1: 写会红的测试**

新建 `src/test/java/com/lyhn/wraith/web/SearchDetectionTest.java`：

```java
package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「未配置」提示里的两个检测。纯函数入口全部注入 PATH 字符串与平台标记，
 * 不查本机真实 PATH；端口检测只连本进程起的 ServerSocket，不出机器。
 */
class SearchDetectionTest {

    @Test
    @DisplayName("PATH 里某一段下有可执行的 docker 就算有")
    void findsDockerOnPath(@TempDir Path dir) throws IOException {
        Path bin = Files.createDirectories(dir.resolve("bin"));
        Path docker = Files.createFile(bin.resolve("docker"));
        docker.toFile().setExecutable(true);

        assertTrue(SearchDetection.dockerOnPath(bin.toString(), ":", false));
    }

    @Test
    @DisplayName("PATH 多段时逐段找")
    void scansEveryPathSegment(@TempDir Path dir) throws IOException {
        Path empty = Files.createDirectories(dir.resolve("empty"));
        Path bin = Files.createDirectories(dir.resolve("bin"));
        Path docker = Files.createFile(bin.resolve("docker"));
        docker.toFile().setExecutable(true);

        String path = String.join(":", empty.toString(), bin.toString());
        assertTrue(SearchDetection.dockerOnPath(path, ":", false));
    }

    @Test
    @DisplayName("PATH 为空 / null / 没有 docker 时是 false")
    void noDockerMeansFalse(@TempDir Path dir) throws IOException {
        Path empty = Files.createDirectories(dir.resolve("empty"));

        assertFalse(SearchDetection.dockerOnPath(empty.toString(), ":", false));
        assertFalse(SearchDetection.dockerOnPath("", ":", false));
        assertFalse(SearchDetection.dockerOnPath(null, ":", false));
    }

    @Test
    @DisplayName("Windows 上找 docker.exe，且分隔符是分号")
    void windowsLooksForDockerExe(@TempDir Path dir) throws IOException {
        Path bin = Files.createDirectories(dir.resolve("bin"));
        Files.createFile(bin.resolve("docker.exe"));

        assertTrue(SearchDetection.dockerOnPath(bin.toString(), ";", true),
                "Windows 分支该找 docker.exe");
        assertFalse(SearchDetection.dockerOnPath(bin.toString(), ":", false),
                "非 Windows 分支只找无后缀的 docker,docker.exe 不算");
    }

    @Test
    @DisplayName("不存在的 PATH 段不该抛异常")
    void nonExistentPathSegmentIsIgnored() {
        assertFalse(SearchDetection.dockerOnPath("/no/such/dir/anywhere", ":", false));
    }

    @Test
    @DisplayName("有人在听就是 true，没人听就是 false")
    void detectsListeningPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            int port = socket.getLocalPort();
            assertTrue(SearchDetection.portListening("127.0.0.1", port, 300));
        }
    }

    @Test
    @DisplayName("没人听时在超时内返回 false（不挂住调用方）")
    void unusedPortReturnsFalseQuickly() throws IOException {
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        } // 关掉,于是这个端口没人听

        long start = System.nanoTime();
        assertFalse(SearchDetection.portListening("127.0.0.1", port, 300));
        long elapsedMillis = (System.nanoTime() - start) / 1_000_000;
        assertTrue(elapsedMillis < 3_000,
                "一句提示不能把 agent 卡住,实测耗时 " + elapsedMillis + "ms");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=SearchDetectionTest test`
Expected: 编译失败（`cannot find symbol: class SearchDetection`）

- [ ] **Step 3: 新建 `SearchDetection`**

```java
package com.lyhn.wraith.web;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Locale;

/**
 * 「未配置」提示要用的两个廉价检测。
 *
 * <p><b>都必须有上界</b>：这两个检测跑在一句提示的生成路径上，一旦挂住就是 agent 挂住。
 * 端口检测用 300ms 超时；docker 检测只查 {@code PATH} 各段下有没有那个文件，
 * <b>不执行 {@code docker --version}</b>——起进程更慢，而且可能触发 Docker Desktop 唤醒。
 *
 * <p>纯函数重载全部注入 {@code PATH} 与平台标记，测试不碰本机真实环境。
 */
public final class SearchDetection {

    private SearchDetection() {}

    /**
     * SearXNG docker 镜像的默认端口，也是引导命令里用的那个。
     *
     * <p>放在这里而不是 {@code UnconfiguredSearchProvider}：那边的无参构造要引用本类的两个
     * 检测方法，本类的端口探测又要用这个端口——常量留在那边就成了环。依赖是单向的：
     * {@code UnconfiguredSearchProvider} → {@code SearchDetection}。
     */
    public static final int SEARXNG_DEFAULT_PORT = 8888;
    public static final String SEARXNG_LOCAL_URL = "http://localhost:" + SEARXNG_DEFAULT_PORT;

    /** 生产入口：查本机真实 {@code PATH}。 */
    public static boolean dockerOnPath() {
        return dockerOnPath(System.getenv("PATH"), File.pathSeparator, isWindows());
    }

    /**
     * @param pathEnv       {@code PATH} 的原始值，null/空当作没有
     * @param pathSeparator 段分隔符（POSIX {@code :}，Windows {@code ;}）
     * @param windows       true 时找 {@code docker.exe}，否则找 {@code docker}
     */
    static boolean dockerOnPath(String pathEnv, String pathSeparator, boolean windows) {
        if (pathEnv == null || pathEnv.isBlank()) {
            return false;
        }
        String executable = windows ? "docker.exe" : "docker";
        for (String segment : pathEnv.split(java.util.regex.Pattern.quote(pathSeparator))) {
            if (segment == null || segment.isBlank()) {
                continue;
            }
            try {
                File candidate = new File(segment.trim(), executable);
                // Windows 上 canExecute() 对普通文件也返回 true,所以那边只看存在性;
                // POSIX 上必须要求可执行位,否则 PATH 里一个同名的普通文件会误报。
                if (candidate.isFile() && (windows || candidate.canExecute())) {
                    return true;
                }
            } catch (Exception ignored) {
                // 段本身非法（非法路径字符等）——跳过，不是致命错误
            }
        }
        return false;
    }

    /** 生产入口：探 {@code localhost:8888}（SearXNG docker 镜像的默认端口）。 */
    public static boolean searxngPortListening() {
        return portListening("127.0.0.1", SEARXNG_DEFAULT_PORT, 300);
    }

    /**
     * TCP connect 探测。只判断「有没有人在听」，<b>不发任何请求</b>——
     * 主动探 {@code /search?format=json} 会让提示变慢，且可能打扰一个无关的服务。
     */
    static boolean portListening(String host, int port, int timeoutMillis) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMillis);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}
```

- [ ] **Step 4: 跑测试**

Run: `mvn -DskipTests=false -Dtest=SearchDetectionTest test`
Expected: 全部 PASS

- [ ] **Step 5: 跑全量**

Run: `mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/web/SearchDetection.java \
        src/test/java/com/lyhn/wraith/web/SearchDetectionTest.java
git commit -m "$(cat <<'EOF'
feat(search): 两个廉价检测,给「未配置」提示看一眼本机环境的能力(D3)

一句不看环境的提示对用户没用。本提交只交付检测本身;拿它分三种话术
(已有服务在听 / 有 docker 给 docker run / 都没有则三条路都说清)的是
下一个提交的 UnconfiguredSearchProvider——它的无参构造引用这里的两个
方法引用,所以检测必须先落地。

两个检测都有上界——它们跑在一句提示的生成路径上,挂住就是 agent 挂住:
端口探测 TCP connect 300ms 超时,且只判断「有没有人在听」,不发任何请求
(主动探 /search?format=json 会变慢且可能打扰无关服务);docker 检测只查
PATH 各段下有没有那个文件,不执行 docker --version(起进程更慢,而且可能
触发 Docker Desktop 唤醒)。

检测结果不缓存:提示是低频路径,而缓存会让「用户刚起了 docker、再问一次
却还说没有」——又一个 snapshot-vs-live。

纯函数重载注入 PATH 与平台标记,测试不碰本机真实 PATH;端口测试只连本进程
起的 ServerSocket,不出机器。Windows 分支找 docker.exe 且只看存在性
(canExecute 在 Windows 上对普通文件也返真),POSIX 分支要求可执行位。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 3: D2 —— 「未配置」不再由 Zhipu 代言

**Files:**
- Create: `src/main/java/com/lyhn/wraith/web/UnconfiguredSearchProvider.java`
- Modify: `src/main/java/com/lyhn/wraith/web/SearchProviderFactory.java`（`pickProvider` 的全空分支 + `create` 的派发）
- Modify: `src/main/java/com/lyhn/wraith/web/ZhipuSearchProvider.java`（`:91-103` `unavailableHint`）
- Modify: `src/test/java/com/lyhn/wraith/web/SearchProviderFactoryTest.java:35-38`
- Test: `src/test/java/com/lyhn/wraith/web/UnconfiguredHintTest.java`（新建）

**Interfaces:**
- Consumes: `SearchProviderFactory.SearchSettings` / `resolveSettings`（Task 1）；`SearchDetection.dockerOnPath()` / `searxngPortListening()` / `SEARXNG_DEFAULT_PORT` / `SEARXNG_LOCAL_URL`（Task 2）
- Produces:
  - `UnconfiguredSearchProvider`：public 无参构造（生产用，检测走 Task 3 的真实实现）+ package-visible 构造
    ```java
    UnconfiguredSearchProvider(java.util.function.BooleanSupplier dockerOnPath,
                               java.util.function.BooleanSupplier searxngPortListening)
    ```
    `name()` → `"unconfigured"`，`isReady()` → `false`
  - `pickProvider(null, null, null, null)` → `"unconfigured"`（不再是 `"zhipu"`）

- [ ] **Step 1: 写会红的测试**

新建 `src/test/java/com/lyhn/wraith/web/UnconfiguredHintTest.java`：

```java
package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「未配置」这句话此前由 ZhipuSearchProvider 代言 —— pickProvider 在什么都没配时返回
 * "zhipu" 作占位，于是那条中立的「三条路都给你」的提示物理上挂在智谱 provider 上。
 * 用户截图里模型开口就提 GLM，原因就是它读到的可用信息是智谱 provider 在说话。
 *
 * <p>检测函数全部注入：不真查 PATH、不真连网。
 */
class UnconfiguredHintTest {

    private static UnconfiguredSearchProvider provider(boolean docker, boolean port) {
        return new UnconfiguredSearchProvider(() -> docker, () -> port);
    }

    @Test
    @DisplayName("载体是 unconfigured 而不是 zhipu")
    void nameIsUnconfigured() {
        assertEquals("unconfigured", provider(false, false).name());
        assertFalse(provider(false, false).isReady());
    }

    @Test
    @DisplayName("8888 有服务在听时，直接给可粘贴的 /config search")
    void portListeningBranchGivesConfigCommand() {
        String hint = provider(true, true).unavailableHint();

        assertTrue(hint.contains("localhost:8888"), "该点名检测到的端口");
        assertTrue(hint.contains("/config search --provider searxng --base-url http://localhost:8888"),
                "该给可直接粘贴的命令");
        assertFalse(hint.contains("docker run"), "已经有服务在听了,不该再让用户起一个容器");
    }

    @Test
    @DisplayName("有 docker 但 8888 空着时，给 docker run 再给 /config search")
    void dockerPresentBranchGivesDockerRunThenConfig() {
        String hint = provider(true, false).unavailableHint();

        assertTrue(hint.contains("docker run --rm -p 8888:8888 searxng/searxng"));
        assertTrue(hint.contains("/config search --provider searxng --base-url http://localhost:8888"));
        assertTrue(hint.contains("免费"), "该点明这条不要钱、不需要任何 key");
    }

    @Test
    @DisplayName("没有 docker 时三条路都说清，且不推荐任何一条为默认")
    void noDockerBranchListsAllThreeWithoutPickingAFavourite() {
        String hint = provider(false, false).unavailableHint();

        assertTrue(hint.contains("SEARXNG"), "SearXNG 那条要在");
        assertTrue(hint.contains("SERPAPI_KEY"), "SerpAPI 那条要在");
        assertTrue(hint.contains("GLM_API_KEY"), "智谱那条要在（作为三选一之一）");
        assertFalse(hint.contains("推荐 GLM"), "GLM 只能是三选一之一,不能是推荐");
        assertFalse(hint.contains("默认推荐"), "不该给任何一条贴「默认推荐」");
    }

    @Test
    @DisplayName("两条兜底出口都在，各自带警示")
    void bothFallbackExitsArePresentWithWarnings() {
        String hint = provider(false, false).unavailableHint();

        assertTrue(hint.contains("浏览器"), "浏览器那条兜底要在");
        assertTrue(hint.contains("Node"), "浏览器那条要说清它要 Node/npx");
        assertTrue(hint.contains("duckduckgo"), "duckduckgo 那条兜底要在");
        assertTrue(hint.contains("限流") || hint.contains("改版"),
                "duckduckgo 那条必须带不稳定警示,不能读成推荐");
    }

    @Test
    @DisplayName("两条兜底排在三条主路之后 —— 断言下标顺序，不是断言「包含」")
    void fallbackExitsComeAfterTheThreeMainPaths() {
        // 只断言「包含」的话,把兜底放到开头也能过 —— 那正是要防的失败:
        // 一条不稳定的应急路排在三条正路前面,读起来就是推荐。
        String hint = provider(false, false).unavailableHint();

        int lastMainPath = Math.max(Math.max(hint.indexOf("GLM_API_KEY"), hint.indexOf("SERPAPI_KEY")),
                hint.indexOf("SEARXNG"));
        int firstFallback = Math.min(indexOrMax(hint, "浏览器"), indexOrMax(hint, "duckduckgo"));

        assertTrue(lastMainPath >= 0 && firstFallback > lastMainPath,
                "兜底出口(下标 " + firstFallback + ")必须排在三条主路(最后一条在 "
                        + lastMainPath + ")之后");
    }

    private static int indexOrMax(String haystack, String needle) {
        int i = haystack.indexOf(needle);
        return i < 0 ? Integer.MAX_VALUE : i;
    }

    @Test
    @DisplayName("search() 抛出的异常带的就是这份提示")
    void searchThrowsWithTheHint() {
        UnconfiguredSearchProvider p = provider(false, false);

        java.io.IOException e = org.junit.jupiter.api.Assertions.assertThrows(
                java.io.IOException.class, () -> p.search("任意关键词", 5));
        assertEquals(p.unavailableHint(), e.getMessage());
    }
}
```

同时把 `src/test/java/com/lyhn/wraith/web/SearchProviderFactoryTest.java` 的 `fallsBackToZhipuPlaceholder`（`:35-38`）改写成：

```java
    @Test
    @DisplayName("什么都没配时返回 unconfigured —— 此前返回 zhipu,那是「未配置」话术偏心 GLM 的机制")
    void fallsBackToUnconfigured() {
        // 这条断言此前是 assertEquals("zhipu", ...)，它正在钉住那个偏心：
        // 占位 provider 是 zhipu ⇒ 中立的三路提示物理上挂在智谱 provider 上 ⇒ 模型张口就说 GLM。
        assertEquals("unconfigured", SearchProviderFactory.pickProvider(null, null, null, null));
    }
```

`SearchProviderFactoryTest` 需要新增 import：`org.junit.jupiter.api.DisplayName`。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest='UnconfiguredHintTest,SearchProviderFactoryTest' test`
Expected: 编译失败（`cannot find symbol: class UnconfiguredSearchProvider`）

- [ ] **Step 3: 新建 `UnconfiguredSearchProvider`**

```java
package com.lyhn.wraith.web;

import java.io.IOException;
import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * 「搜索还没配」这句话的载体。
 *
 * <p><b>为什么要单独一个类</b>：{@code pickProvider} 此前在什么都没配时返回 {@code "zhipu"}
 * 作占位，于是那条中立的「三条路都给你」的提示物理上挂在 {@link ZhipuSearchProvider} 上。
 * 用户截图里模型开口就提 GLM，原因就是它读到的可用信息是智谱 provider 在说话。
 * 提示的<b>内容</b>早就改成三路并列了，但<b>载体</b>没换，这层错位一直在。
 *
 * <p>两个检测函数都注入：生产用真实实现（{@link SearchDetection}），测试给常量，
 * 于是这个类是纯文本组合，不碰 PATH、不碰网络。
 */
public class UnconfiguredSearchProvider implements SearchProvider {

    /** 端口常量的家在 {@link SearchDetection}（依赖单向：本类 → SearchDetection）。 */
    static final String CONFIG_SEARXNG_COMMAND =
            "/config search --provider searxng --base-url " + SearchDetection.SEARXNG_LOCAL_URL;

    private final BooleanSupplier dockerOnPath;
    private final BooleanSupplier searxngPortListening;

    /** 生产入口。 */
    public UnconfiguredSearchProvider() {
        this(SearchDetection::dockerOnPath, SearchDetection::searxngPortListening);
    }

    UnconfiguredSearchProvider(BooleanSupplier dockerOnPath, BooleanSupplier searxngPortListening) {
        this.dockerOnPath = dockerOnPath;
        this.searxngPortListening = searxngPortListening;
    }

    @Override
    public String name() {
        return "unconfigured";
    }

    @Override
    public boolean isReady() {
        return false;
    }

    /**
     * 三段，顺序固定：中立的三路指引 → 本机检测结果 → 两条兜底出口。
     *
     * <p><b>兜底必须排在最后且各自带警示</b>，否则一条不稳定的应急路排在三条正路前面，
     * 读起来就是推荐。{@code UnconfiguredHintTest} 断言的是下标顺序而不是「包含」——
     * 只断言包含的话，把兜底放到开头也能过。
     */
    @Override
    public String unavailableHint() {
        StringBuilder out = new StringBuilder();
        out.append("web_search 还没有配搜索后端。三条路任选一条：\n");
        out.append("  1) SEARXNG —— 自托管开源元搜索，**免费且不需要任何 key**\n");
        out.append("  2) SERPAPI_KEY —— 国际通用，付费即开即用：https://serpapi.com/manage-api-key\n");
        out.append("  3) GLM_API_KEY —— 智谱 Web Search，与 GLM 推理共用同一个 key\n");
        out.append(detectionAdvice());
        out.append("另外两条应急路（都不需要 key，但都不如上面三条稳）：\n");
        out.append("  · 让我用浏览器去搜 —— 内建 chrome-devtools MCP，需要本机有 Node/npx；比 API 慢，但能用\n");
        out.append("  · ").append("/config search --provider duckduckgo")
                .append(" —— 靠抓 HTML，可能因改版或限流失效，只建议临时用\n");
        return out.toString();
    }

    /**
     * 检测结果段。<b>不缓存</b>：提示是低频路径（只在搜索不可用时出现），而缓存会让
     * 「用户刚起了 docker、再问一次却还说没有」——又一个 snapshot-vs-live。
     */
    private String detectionAdvice() {
        if (searxngPortListening.getAsBoolean()) {
            return "检测到 localhost:" + SearchDetection.SEARXNG_DEFAULT_PORT + " 有服务在听（可能已经是 SearXNG）。执行：\n"
                    + "  " + CONFIG_SEARXNG_COMMAND + "\n";
        }
        if (dockerOnPath.getAsBoolean()) {
            return "本机有 docker，最快的路是起一个 SearXNG（免费、无需任何 key）：\n"
                    + "  docker run --rm -p " + SearchDetection.SEARXNG_DEFAULT_PORT
                    + ":" + SearchDetection.SEARXNG_DEFAULT_PORT
                    + " searxng/searxng\n"
                    + "  " + CONFIG_SEARXNG_COMMAND + "\n";
        }
        return "本机没找到 docker，所以 SEARXNG 那条要先装 docker；另两条各有代价（一条付费、一条要智谱的 key）。\n";
    }

    @Override
    public List<SearchResult> search(String query, int topK) throws IOException {
        throw new IOException(unavailableHint());
    }
}
```

- [ ] **Step 4: 改 `pickProvider` 的全空分支与 `create` 的派发**

`SearchProviderFactory.pickProvider` 最后一行：

```java
        return "unconfigured"; // 载体换成 UnconfiguredSearchProvider —— 见 D2
```

`create(SearchSettings)` 的 switch 加一支，并把 `default` 的含义写清：

```java
        return switch (chosen) {
            case "searxng" -> new SearxngSearchProvider(settings.searxngUrl());
            case "serpapi" -> new SerpApiSearchProvider(settings.serpKey());
            case "unconfigured" -> new UnconfiguredSearchProvider();
            // default 是 zhipu：显式 SEARCH_PROVIDER 写了别的值时也落到这里,
            // 由 ZhipuSearchProvider 自己报「没有 GLM_API_KEY」。
            default -> new ZhipuSearchProvider(settings.glmKey(), settings.zhipuEngine());
        };
```

同时更新类头 Javadoc 里「自动选择优先级」那段的第 4 条：

```
 *   <li>都没有 → {@link UnconfiguredSearchProvider}，isReady() 为 false，由调用方提示用户</li>
```

- [ ] **Step 5: `ZhipuSearchProvider.unavailableHint()` 收窄成 GLM 专属**

把 `:91-103` 整段替换为：

```java
    @Override
    public String unavailableHint() {
        // 收窄成 GLM 专属 —— 此后这句话只在用户**显式**选了 zhipu 却没给 key 时才出现。
        // 那条中立的三路指引搬去了 UnconfiguredSearchProvider:它此前挂在这里,于是
        // 「什么都没配」这件事由智谱 provider 代言,模型张口就说 GLM(D2)。
        return "智谱 Web Search 需要 GLM_API_KEY —— 与 GLM 推理共用同一个 key。"
                + "在桌面「配置 → Provider 配置」里填 GLM，或写 .env / 环境变量，"
                + "或执行 /config search --provider zhipu --api-key <key>。\n"
                + "不想用智谱的话，/config search 还支持 serpapi 与 searxng（后者免费、不需要任何 key）。";
    }
```

- [ ] **Step 6: 改写 `SearchUnavailableHintTest` 里两条断言旧契约的用例**

⚠️ **这个文件里有两条测试正在断言本次要删掉的契约**（第 8、9 条同类）。它们钉住的正是 D2 要修的那层错位：中立的三路指引长在 Zhipu provider 上。

| 用例 | 行 | 处置 |
|---|---|---|
| **`zhipuHintListsAllThreeRoutes`** | **69-76** | **改指向** `UnconfiguredSearchProvider`（载体换了；`SEARXNG_URL` 这个断言串也要跟着换，新话术里那条叫 `SEARXNG`） |
| **`zhipuHintFlagsTheKeyFreeRoute`** | **78-84** | **改指向** `UnconfiguredSearchProvider` |
| `zhipuHintDoesNotClaimDotEnvOnly` | 86-92 | **不动**（新的 Zhipu 话术含「桌面」与「环境变量」，仍然通过；这条约束对 GLM 专属话术依然成立） |
| `hintOnlyMattersWhenNotReady` | 94-99 | 不动 |
| `everyProviderHasAHint` | 101-111 | 数组里**补上** `new UnconfiguredSearchProvider(() -> false, () -> false)` 与 `new DuckDuckGoSearchProvider()`，`@DisplayName` 的「三个 provider」改「每个 provider」 |

改指向后的两条写成：

```java
    @Test
    @DisplayName("中立的未配置提示要给出全部三条路 —— 载体是 UnconfiguredSearchProvider,不再是 Zhipu")
    void unconfiguredHintListsAllThreeRoutes() {
        // 这条用例此前断在 new ZhipuSearchProvider(null, null).unavailableHint() 上,
        // 而那正是 D2 要修的错位:「什么都没配」这句话由智谱 provider 代言,
        // 于是模型张口就说 GLM。内容早就是三路并列了,载体这次才换。
        String hint = new UnconfiguredSearchProvider(() -> false, () -> false).unavailableHint();
        assertTrue(hint.contains("GLM_API_KEY"), hint);
        assertTrue(hint.contains("SERPAPI_KEY"), hint);
        assertTrue(hint.contains("SEARXNG"), hint);
    }

    @Test
    @DisplayName("必须点明 SearXNG **不需要 key** —— 这是「我不想配 key」的用户唯一的答案")
    void unconfiguredHintFlagsTheKeyFreeRoute() {
        String hint = new UnconfiguredSearchProvider(() -> false, () -> false).unavailableHint();
        assertTrue(hint.contains("不需要") || hint.contains("免费") || hint.contains("无需"),
                "没有任何地方说 SearXNG 不要钱不要 key: " + hint);
    }
```

注意 `DuckDuckGoSearchProvider` 在 Task 4 才建。**本任务先只补 `UnconfiguredSearchProvider`**，Task 4 的 Step 6 跑测试时再把 DDG 加进 `everyProviderHasAHint` 的数组。

- [ ] **Step 7: 跑测试**

Run: `mvn -DskipTests=false -Dtest='UnconfiguredHintTest,SearchProviderFactoryTest,SearchUnavailableHintTest' test`
Expected: 全部 PASS

- [ ] **Step 8: 跑全量**

Run: `mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 9: 提交**

```bash
git add src/main/java/com/lyhn/wraith/web/UnconfiguredSearchProvider.java \
        src/main/java/com/lyhn/wraith/web/SearchProviderFactory.java \
        src/main/java/com/lyhn/wraith/web/ZhipuSearchProvider.java \
        src/test/java/com/lyhn/wraith/web/UnconfiguredHintTest.java \
        src/test/java/com/lyhn/wraith/web/SearchProviderFactoryTest.java \
        src/test/java/com/lyhn/wraith/web/SearchUnavailableHintTest.java
git commit -m "$(cat <<'EOF'
feat(search): 「未配置」不再由 Zhipu provider 代言(D2)

pickProvider 在什么都没配时返回 "zhipu" 作占位,于是那条中立的「三条路都给你」
的提示物理上挂在 ZhipuSearchProvider 上。用户截图里模型开口就提 GLM,原因就是
它读到的可用信息是智谱 provider 在说话——提示的内容早就改成三路并列了,但载体
没换,这层错位一直在。

新增 UnconfiguredSearchProvider 承担这句话,两个检测函数注入(生产走真实实现,
测试给常量),于是它是纯文本组合,不碰 PATH、不碰网络。
ZhipuSearchProvider.unavailableHint() 收窄成 GLM 专属:此后只在用户显式选了
zhipu 却没给 key 时才出现。

SearchProviderFactoryTest 那条 assertEquals("zhipu", pickProvider(null×4))
正是在钉住这个偏心,改写为 "unconfigured" 并留注释说明它此前在断言什么。

提示的两条兜底出口(浏览器 / duckduckgo)排在三条主路之后、各自带警示。
测试断言的是下标顺序而不是「包含」——只断言包含的话,把兜底放到开头也能过,
而那正是要防的失败:一条不稳定的应急路排在正路前面,读起来就是推荐。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 4: D6 —— DuckDuckGo：显式可选，永不自动选

**Files:**
- Create: `src/main/java/com/lyhn/wraith/web/DuckDuckGoSearchProvider.java`
- Modify: `src/main/java/com/lyhn/wraith/web/SearchProviderFactory.java`（`create(SearchSettings)` 的 switch 加一支）
- Test: `src/test/java/com/lyhn/wraith/web/DuckDuckGoProviderTest.java`（新建）
- Test: `src/test/java/com/lyhn/wraith/web/SearchProviderAutoSelectionTest.java`（新建）

**Interfaces:**
- Consumes: `SearchProviderFactory.pickProvider`（签名不变）、`SearchProviderFactory.create(SearchSettings)`（Task 1）、`SearchResult.of(int position, String title, String url, String snippet)`
- Produces:
  ```java
  public DuckDuckGoSearchProvider()                                   // 生产
  DuckDuckGoSearchProvider(String endpoint, okhttp3.OkHttpClient httpClient)  // 可注入，测试用
  ```
  `name()` → `"duckduckgo"`，`isReady()` → 恒 `true`

- [ ] **Step 1: 写会红的测试（解析 + 失败契约）**

新建 `src/test/java/com/lyhn/wraith/web/DuckDuckGoProviderTest.java`：

```java
package com.lyhn.wraith.web;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DuckDuckGo 后端是本设计里唯一零 key 的路，也是唯一被明确判定为**不可靠**的一条。
 * 它靠抓 html.duckduckgo.com 的页面标记，改版或限流都会让它碎。
 *
 * <p><b>失败契约是它能被接受的前提</b>：HTTP 非 200、被限流、或解析出 0 条结果，
 * 一律抛 IOException，<b>绝不返回空列表</b>。空列表和「网上没有这个信息」在模型眼里
 * 是同一件事，它会据此编造结论；异常则明确是「工具坏了」。
 *
 * <p>全程走 MockWebServer + 注入的 OkHttpClient，<b>不真连 duckduckgo.com</b>。
 */
class DuckDuckGoProviderTest {

    private MockWebServer server;
    private OkHttpClient client;

    @BeforeEach
    void setup() throws IOException {
        server = new MockWebServer();
        server.start();
        client = new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(5, TimeUnit.SECONDS)
                .build();
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    private DuckDuckGoSearchProvider provider() {
        return new DuckDuckGoSearchProvider(server.url("/html/").toString(), client);
    }

    private static final String TWO_RESULTS = """
            <html><body>
              <div class="result">
                <a class="result__a" href="https://example.com/alpha">Alpha 标题</a>
                <a class="result__snippet">Alpha 摘要文字</a>
              </div>
              <div class="result">
                <a class="result__a" href="https://example.org/beta">Beta 标题</a>
                <a class="result__snippet">Beta 摘要文字</a>
              </div>
            </body></html>
            """;

    @Test
    @DisplayName("解析出标题 / 链接 / 摘要 / 位置")
    void parsesResultsFromHtml() throws IOException {
        server.enqueue(new MockResponse().setBody(TWO_RESULTS));

        List<SearchResult> results = provider().search("任意关键词", 5);

        assertEquals(2, results.size());
        assertEquals(1, results.get(0).position());
        assertEquals("Alpha 标题", results.get(0).title());
        assertEquals("https://example.com/alpha", results.get(0).url());
        assertEquals("Alpha 摘要文字", results.get(0).snippet());
        assertEquals("example.com", results.get(0).source());
        assertEquals(2, results.get(1).position());
        assertEquals("https://example.org/beta", results.get(1).url());
    }

    @Test
    @DisplayName("topK 截断")
    void truncatesToTopK() throws IOException {
        server.enqueue(new MockResponse().setBody(TWO_RESULTS));

        assertEquals(1, provider().search("任意关键词", 1).size());
    }

    @Test
    @DisplayName("isReady 恒真 —— 没有 key 可缺")
    void isReadyIsAlwaysTrue() {
        assertTrue(provider().isReady());
        assertEquals("duckduckgo", provider().name());
    }

    @Test
    @DisplayName("HTTP 非 200 抛 IOException")
    void nonOkStatusThrows() {
        server.enqueue(new MockResponse().setResponseCode(429).setBody("rate limited"));

        IOException e = assertThrows(IOException.class, () -> provider().search("任意关键词", 5));
        assertTrue(e.getMessage().contains("429"), "该带上状态码,便于判断是限流还是别的");
    }

    @Test
    @DisplayName("解析出 0 条也抛 IOException —— 绝不返回空列表（失败契约的守门人）")
    void zeroParsedResultsThrowsInsteadOfReturningEmpty() {
        // 结构对但没有 result 锚点 —— 改版后的真实症状就是这样
        server.enqueue(new MockResponse().setBody(
                "<html><body><div class=\"nope\">改版了</div></body></html>"));

        IOException e = assertThrows(IOException.class, () -> provider().search("任意关键词", 5));

        assertTrue(e.getMessage().contains("0 条") || e.getMessage().contains("没有解析到"),
                "该说清是解析不出东西,而不是含糊的失败");
        assertTrue(e.getMessage().contains("searxng") || e.getMessage().contains("/config search"),
                "异常文案必须给出路:改用另三条");
    }

    @Test
    @DisplayName("请求带浏览器 User-Agent 且把关键词编码进查询串")
    void sendsBrowserUserAgentAndEncodedQuery() throws Exception {
        server.enqueue(new MockResponse().setBody(TWO_RESULTS));

        provider().search("中文 关键词", 5);

        okhttp3.mockwebserver.RecordedRequest request = server.takeRequest();
        String ua = request.getHeader("User-Agent");
        assertTrue(ua != null && ua.contains("Mozilla"),
                "默认 UA 会被限流得更快,伪装成常见浏览器");
        assertTrue(request.getPath().contains("q="), "关键词该进查询串");
    }
}
```

- [ ] **Step 2: 写会红的测试（自动链守门人）**

新建 `src/test/java/com/lyhn/wraith/web/SearchProviderAutoSelectionTest.java`：

```java
package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * D6 核心约束的守门人：<b>自动选择链永远不返回 duckduckgo</b>。
 *
 * <p>DDG 靠抓 HTML，改版或限流都会让它碎。做成「默认」会让搜索时好时坏，比明确报
 * 「未配置」更糟——一个静默返回垃圾的工具会让模型拿着空结果继续编。把可达性收窄到
 * 只有显式指定一条路之后，它就<b>无法静默降低任何人的搜索质量</b>，而「零 key 能搜」
 * 的好处保住了。这个测试就是那道收窄的门。
 *
 * <p>判别力自证：把自动链里任何一条改成回落 duckduckgo，本测试变红。
 */
class SearchProviderAutoSelectionTest {

    @Test
    @DisplayName("三个自动输入的全部 8 种空/非空组合，都不产生 duckduckgo")
    void autoSelectionNeverYieldsDuckDuckGo() {
        String[] glmKeys = {null, "sk-fake-glm"};
        String[] serpKeys = {null, "sk-fake-serp"};
        String[] searxngUrls = {null, "http://localhost:8888"};

        int combinations = 0;
        for (String glm : glmKeys) {
            for (String serp : serpKeys) {
                for (String url : searxngUrls) {
                    String chosen = SearchProviderFactory.pickProvider(null, glm, serp, url);
                    assertNotEquals("duckduckgo", chosen,
                            "自动链不该产出 duckduckgo (glm=" + glm + ", serp=" + serp + ", url=" + url + ")");
                    combinations++;
                }
            }
        }
        assertEquals(8, combinations, "三个布尔维度应当穷举 8 种组合");
    }

    @Test
    @DisplayName("空串与空白的 explicit 也走自动链，同样不产生 duckduckgo")
    void blankExplicitStillGoesThroughAutoSelection() {
        assertNotEquals("duckduckgo", SearchProviderFactory.pickProvider("", null, null, null));
        assertNotEquals("duckduckgo", SearchProviderFactory.pickProvider("   ", "sk-fake-glm", null, null));
    }

    @Test
    @DisplayName("显式指定时确实拿得到 duckduckgo，且 create 派发到那个类")
    void explicitDuckDuckGoIsReachable() {
        assertEquals("duckduckgo", SearchProviderFactory.pickProvider("duckduckgo", null, null, null));
        assertEquals("duckduckgo", SearchProviderFactory.pickProvider("  DuckDuckGo  ", null, null, null));

        SearchProvider provider = SearchProviderFactory.create(
                new SearchProviderFactory.SearchSettings("duckduckgo", null, null, null, null));
        assertEquals("duckduckgo", provider.name());
        assertEquals(DuckDuckGoSearchProvider.class, provider.getClass());
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest='DuckDuckGoProviderTest,SearchProviderAutoSelectionTest' test`
Expected: 编译失败（`cannot find symbol: class DuckDuckGoSearchProvider`）

- [ ] **Step 4: 新建 `DuckDuckGoSearchProvider`**

```java
package com.lyhn.wraith.web;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * DuckDuckGo HTML 后端 —— <b>显式可选，永不自动选</b>。
 *
 * <p>它是本仓库里唯一零 key 的搜索后端，也是唯一被明确判定为<b>不可靠</b>的一个：
 * 没有免费 JSON API，能用的只有抓 {@code html.duckduckgo.com} 再解页面标记，
 * 人家改版就碎、请求多了会被限流。
 *
 * <p><b>可达性被刻意收窄到一条</b>：只有 {@code SEARCH_PROVIDER=duckduckgo} 或
 * {@code /config search --provider duckduckgo} 能拿到它；
 * {@link SearchProviderFactory#pickProvider} 的自动选择链<b>永远不返回它</b>
 * （由 {@code SearchProviderAutoSelectionTest} 守门）。因此它无法静默降低任何人的
 * 搜索质量——那正是它被接受的条件。
 *
 * <p><b>失败契约</b>：HTTP 非 200、被限流、或解析出 0 条结果，一律抛 {@link IOException}，
 * <b>绝不返回空列表</b>。空列表和「网上没有这个信息」在模型眼里是同一件事，它会据此
 * 编造结论；异常则明确是「工具坏了」。这条契约不是可选的打磨。
 *
 * <p><b>明确不做</b>：不加重试、不加 UA 轮换、不加代理。那些是在跟对方的反爬对抗，
 * 一旦开始就没有尽头，且更接近 ToS 灰区。抓一次，不行就报错。
 */
public class DuckDuckGoSearchProvider implements SearchProvider {

    private static final Logger log = LoggerFactory.getLogger(DuckDuckGoSearchProvider.class);
    private static final String DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/";
    /** 默认 UA 会被限流得更快，伪装成常见浏览器。这不是反爬对抗，只是别自报是脚本。 */
    private static final String BROWSER_UA =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

    private final String endpoint;
    private final OkHttpClient httpClient;

    /** 生产入口。超时与 {@link SearxngSearchProvider} 对齐。 */
    public DuckDuckGoSearchProvider() {
        this(DEFAULT_ENDPOINT, new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .build());
    }

    /** endpoint 与 client 都注入，测试用 MockWebServer 顶上，不真连 duckduckgo.com。 */
    DuckDuckGoSearchProvider(String endpoint, OkHttpClient httpClient) {
        this.endpoint = endpoint;
        this.httpClient = httpClient;
    }

    @Override
    public String name() {
        return "duckduckgo";
    }

    /** 恒真 —— 没有 key 可缺。 */
    @Override
    public boolean isReady() {
        return true;
    }

    /**
     * 因 {@link #isReady()} 恒真而不会被展示，但仍要返回一句实话：留一句空串会让
     * 后来人以为这里没写完。
     */
    @Override
    public String unavailableHint() {
        return "duckduckgo 后端不需要任何 key，所以不会「未配置」——它只会因改版或限流而失败。"
                + "稳定用途请改用 searxng / serpapi / zhipu：/config search --provider <名字>";
    }

    @Override
    public List<SearchResult> search(String query, int topK) throws IOException {
        int maxResults = topK > 0 ? Math.min(topK, 10) : 5;

        HttpUrl url = HttpUrl.parse(endpoint).newBuilder()
                .addQueryParameter("q", query)
                .build();
        Request request = new Request.Builder()
                .url(url)
                .header("User-Agent", BROWSER_UA)
                .header("Accept", "text/html")
                .get()
                .build();
        log.info("DuckDuckGo search: query={}, topK={}", query, maxResults);

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException(failureMessage("HTTP " + response.code()));
            }
            String body = response.body() == null ? "" : response.body().string();
            List<SearchResult> results = parse(body, maxResults);
            if (results.isEmpty()) {
                throw new IOException(failureMessage("没有解析到任何结果（0 条）"));
            }
            return results;
        }
    }

    /** jsoup 解析。不手写正则——正则抓 HTML 是在脆弱之上再叠一层脆弱。 */
    private List<SearchResult> parse(String html, int maxResults) {
        Document document = Jsoup.parse(html);
        Elements anchors = document.select("a.result__a");
        Elements snippets = document.select("a.result__snippet");

        List<SearchResult> out = new ArrayList<>();
        for (int i = 0; i < anchors.size() && out.size() < maxResults; i++) {
            Element anchor = anchors.get(i);
            String link = anchor.attr("href");
            String title = anchor.text();
            if (link.isBlank() || title.isBlank()) {
                continue;
            }
            String snippet = i < snippets.size() ? snippets.get(i).text() : "";
            out.add(SearchResult.of(out.size() + 1, title, link, snippet));
        }
        return out;
    }

    private String failureMessage(String cause) {
        return "DuckDuckGo 后端失败（" + cause + "）。这个后端靠抓 HTML，改版或限流都会这样。"
                + "稳定用途请改用 searxng / serpapi / zhipu："
                + "/config search --provider searxng --base-url http://localhost:8888";
    }
}
```

- [ ] **Step 5: `create(SearchSettings)` 加派发**

在 `SearchProviderFactory.create(SearchSettings)` 的 switch 里，`case "unconfigured"` 之后加：

```java
            // 只有显式 SEARCH_PROVIDER / /config search 才走到这里 ——
            // pickProvider 的自动链永远不返回 duckduckgo(D6)
            case "duckduckgo" -> new DuckDuckGoSearchProvider();
```

`pickProvider` **不改**：显式分支已经原样透传并小写化，`"duckduckgo"` 自然流过；自动链的四条判断一条都不涉及它。在 `pickProvider` 的自动链末尾加一行注释锁住这个不变量：

```java
        // 注意:自动链到此结束,它永远不返回 "duckduckgo"(D6 的核心约束,
        // 由 SearchProviderAutoSelectionTest 穷举 8 种组合守门)。
        return "unconfigured";
```

- [ ] **Step 6: 把 DDG 补进 `everyProviderHasAHint`**

Task 3 的 Step 6 把 `SearchUnavailableHintTest.everyProviderHasAHint` 的数组补到了 `UnconfiguredSearchProvider`，但当时 `DuckDuckGoSearchProvider` 还不存在。现在补上：

```java
        for (SearchProvider p : new SearchProvider[]{
                new ZhipuSearchProvider(null, null),
                new SerpApiSearchProvider(null),
                new SearxngSearchProvider(null),
                new UnconfiguredSearchProvider(() -> false, () -> false),
                new DuckDuckGoSearchProvider()}) {
```

（DDG 的 `unavailableHint()` 因 `isReady()` 恒真而不会被展示，但仍须非空——留一句空串会让后来人以为这里没写完。这条断言就是守它。）

- [ ] **Step 7: 跑测试**

Run: `mvn -DskipTests=false -Dtest='DuckDuckGoProviderTest,SearchProviderAutoSelectionTest,SearchProviderFactoryTest,SearchUnavailableHintTest' test`
Expected: 全部 PASS

- [ ] **Step 8: 自证判别力**

把 `pickProvider` 全空分支临时改成 `return "duckduckgo";`，重跑：

Run: `mvn -DskipTests=false -Dtest=SearchProviderAutoSelectionTest test`
Expected: `autoSelectionNeverYieldsDuckDuckGo` FAIL（8 种组合里全空那种命中）

改回 `return "unconfigured";`，重跑确认恢复 PASS。**改回后必须再跑一次确认**，不要凭记忆认为改回了。

- [ ] **Step 9: 跑全量**

Run: `mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 10: 提交**

```bash
git add src/main/java/com/lyhn/wraith/web/DuckDuckGoSearchProvider.java \
        src/main/java/com/lyhn/wraith/web/SearchProviderFactory.java \
        src/test/java/com/lyhn/wraith/web/DuckDuckGoProviderTest.java \
        src/test/java/com/lyhn/wraith/web/SearchProviderAutoSelectionTest.java
git commit -m "$(cat <<'EOF'
feat(search): DuckDuckGo 后端 —— 显式可选,自动链永不返回它(D6)

它是唯一零 key 的搜索后端,也是唯一被明确判定为不可靠的一个:没有免费 JSON API,
能用的只有抓 html.duckduckgo.com 再解页面标记,人家改版就碎、请求多了会被限流。

用户当初排除它的理由是「做成默认会让搜索时好时坏,比明确报未配置更糟」。
把可达性收窄到只有 SEARCH_PROVIDER=duckduckgo / --provider duckduckgo 一条路
之后,那个理由不再成立——它无法静默降低任何人的搜索质量,而「零 key 能搜」的
好处保住了。SearchProviderAutoSelectionTest 穷举三个自动输入的 8 种组合守这道门,
并做了判别力自证(把全空分支改成 duckduckgo 则变红)。

失败契约是它能被接受的前提,不是可选的打磨: HTTP 非 200、限流、或解析出 0 条,
一律抛 IOException,绝不返回空列表。空列表和「网上没有这个信息」在模型眼里是
同一件事,它会据此编造结论;异常则明确是「工具坏了」。异常文案带状态码并给出路。

解析用 jsoup(pom 已有 compile scope,同包 HtmlExtractor 在用),不手写正则——
正则抓 HTML 是在脆弱之上再叠一层脆弱。endpoint 与 OkHttpClient 都注入,测试
走 MockWebServer,不真连 duckduckgo.com。

明确不做重试 / UA 轮换 / 代理:那是跟反爬对抗,一旦开始没有尽头且更近 ToS 灰区。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 5: D4 —— `/config search` 写入口 + 缓存失效

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（`:1012-1017` `searchProvider()` 附近）
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（`:742` CONFIG 分支、`:3314` `handleConfigCommand`、`:3442` `providerConfigUsage` 之后、`:4905` record 区）
- Test: `src/test/java/com/lyhn/wraith/cli/SearchConfigCommandTest.java`（新建）
- Test: `src/test/java/com/lyhn/wraith/tool/SearchProviderCacheTest.java`（新建）

**Interfaces:**
- Consumes: `WraithConfig.SearchConfig`（Task 1）、`DuckDuckGoSearchProvider`（Task 4，仅用于校验名单）
- Produces:
  - `public synchronized void ToolRegistry.invalidateSearchProvider()`
  - `synchronized void ToolRegistry.setSearchProviderForTest(SearchProvider p)`（包可见）
  - `synchronized SearchProvider ToolRegistry.searchProviderSnapshotForTest()`（包可见，未构造时返回 `null`）
  - `static Main.SearchConfigUpdate parseSearchConfigUpdate(String payload)`
  - `static String Main.handleConfigCommand(WraithConfig config, String payload)`（既有 2 参重载保留）
  - `static String Main.handleConfigCommand(WraithConfig config, String payload, ToolRegistry registry)`（新，写完调 `invalidateSearchProvider`）

- [ ] **Step 1: 写会红的测试（解析）**

新建 `src/test/java/com/lyhn/wraith/cli/SearchConfigCommandTest.java`：

```java
package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * `search` 节需要有人能写它，否则 D1 加的那一节只能手改 config.json，整条设计失去意义。
 *
 * <p>红线：不碰真实 ~/.wraith/config.json —— 需要落盘的用例一律 @TempDir +
 * -Dwraith.config.dir，并在 finally 里还原系统属性。
 */
class SearchConfigCommandTest {

    @Test
    @DisplayName("四个 provider 各自解析得到")
    void parsesAllFourProviders() {
        assertEquals("searxng", Main.parseSearchConfigUpdate(
                "search --provider searxng --base-url http://localhost:8888").provider());
        assertEquals("serpapi", Main.parseSearchConfigUpdate(
                "search --provider serpapi --api-key sk-fake-serp").provider());
        assertEquals("zhipu", Main.parseSearchConfigUpdate("search --provider zhipu").provider());
        assertEquals("duckduckgo", Main.parseSearchConfigUpdate("search --provider duckduckgo").provider());
    }

    @Test
    @DisplayName("非法 provider 给人话报错，不静默忽略")
    void rejectsUnknownProviderWithAHumanMessage() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate("search --provider google");

        assertNotNull(update.error());
        assertTrue(update.error().contains("zhipu"), "该把支持的名字列出来");
        assertTrue(update.error().contains("duckduckgo"));
    }

    @Test
    @DisplayName("--provider 是必需的 —— provider 为空时 apiKey 归属不可猜")
    void providerIsRequired() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate("search --api-key sk-fake");

        assertNotNull(update.error());
        assertTrue(update.error().contains("--provider"));
    }

    @Test
    @DisplayName("searxng 缺 --base-url 时报错")
    void searxngRequiresBaseUrl() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate("search --provider searxng");

        assertNotNull(update.error());
        assertTrue(update.error().contains("--base-url"));
    }

    @Test
    @DisplayName("duckduckgo 带 --api-key 或 --base-url 时报错，不静默吞掉")
    void duckDuckGoRejectsKeyAndBaseUrl() {
        // 静默吞掉会让用户以为 key 生效了,之后排查不可能
        Main.SearchConfigUpdate withKey = Main.parseSearchConfigUpdate(
                "search --provider duckduckgo --api-key sk-fake");
        assertNotNull(withKey.error());
        assertTrue(withKey.error().contains("--api-key"));

        Main.SearchConfigUpdate withUrl = Main.parseSearchConfigUpdate(
                "search --provider duckduckgo --base-url http://x");
        assertNotNull(withUrl.error());
        assertTrue(withUrl.error().contains("--base-url"));
    }

    @Test
    @DisplayName("未知配置项报错")
    void rejectsUnknownOption() {
        Main.SearchConfigUpdate update = Main.parseSearchConfigUpdate(
                "search --provider zhipu --engine search_pro");

        assertNotNull(update.error());
        assertTrue(update.error().contains("--engine") || update.error().contains("engine"));
    }

    @Test
    @DisplayName("接线：写进 config 的 search 节并落盘，apiKey 回显掩码")
    void writesSearchSectionAndMasksKeyInEcho(@TempDir Path tempDir) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            WraithConfig config = new WraithConfig();

            String out = Main.handleConfigCommand(config,
                    "search --provider serpapi --api-key sk-fake-serpapi-1234567890");

            assertNotNull(config.getSearch());
            assertEquals("serpapi", config.getSearch().getProvider());
            assertEquals("sk-fake-serpapi-1234567890", config.getSearch().getApiKey());
            assertFalse(out.contains("sk-fake-serpapi-1234567890"), "回显不得带明文 key");
            assertTrue(out.contains("..."), "该是掩码形式");
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    @Test
    @DisplayName("接线：searxng 的 baseUrl 写进 search 节")
    void writesSearxngBaseUrl(@TempDir Path tempDir) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            WraithConfig config = new WraithConfig();

            Main.handleConfigCommand(config,
                    "search --provider searxng --base-url http://localhost:8888");

            assertEquals("searxng", config.getSearch().getProvider());
            assertEquals("http://localhost:8888", config.getSearch().getBaseUrl());
            assertNull(config.getSearch().getApiKey());
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    @Test
    @DisplayName("接线：写完立刻失效搜索缓存 —— 否则本次会话仍用旧 provider")
    void invalidatesSearchCacheAfterWriting(@TempDir Path tempDir) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            boolean[] invalidated = {false};
            ToolRegistry spy = new ToolRegistry() {
                @Override
                public synchronized void invalidateSearchProvider() {
                    invalidated[0] = true;
                    super.invalidateSearchProvider();
                }
            };

            Main.handleConfigCommand(new WraithConfig(),
                    "search --provider searxng --base-url http://localhost:8888", spy);

            assertTrue(invalidated[0],
                    "第五次 snapshot-vs-live：不失效则用户配好后本次会话依然报「未配置」");
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    @Test
    @DisplayName("/config provider 那条路没被 search 分支影响")
    void providerBranchStillWorks(@TempDir Path tempDir) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            WraithConfig config = new WraithConfig();

            String out = Main.handleConfigCommand(config, "provider myrelay --api-key sk-fake-relay");

            assertTrue(out.contains("myrelay"));
            assertNotNull(config.getProviders().get("myrelay"));
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }
}
```

- [ ] **Step 2: 写会红的测试（缓存失效）**

新建 `src/test/java/com/lyhn/wraith/tool/SearchProviderCacheTest.java`：

```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.web.SearchProvider;
import com.lyhn.wraith.web.SearchResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * web_search 的 provider 缓存此前<b>没有任何失效路径，也没有注入口</b>：
 * 用户配好搜索后，本次会话依然报「未配置」，必须重启后端。
 * 这是本仓库第五次栽在 snapshot-vs-live 上（前四次：沙箱护盾、动作卡、pet 窗口、补全）。
 *
 * <p>既然本次引入了一个<b>可写</b>的配置节，这个缺陷会立刻变成用户可见的困惑。
 */
class SearchProviderCacheTest {

    /** 不发请求的假 provider —— 这个测试只关心「缓存里放的是谁」。 */
    private static SearchProvider stub(String name) {
        return new SearchProvider() {
            @Override public String name() { return name; }
            @Override public boolean isReady() { return true; }
            @Override public String unavailableHint() { return ""; }
            @Override public List<SearchResult> search(String query, int topK) { return List.of(); }
        };
    }

    @Test
    @DisplayName("invalidateSearchProvider() 之后缓存是空的，下次会重建")
    void invalidateClearsTheCachedProvider() {
        ToolRegistry registry = new ToolRegistry();
        SearchProvider injected = stub("injected");

        registry.setSearchProviderForTest(injected);
        assertSame(injected, registry.searchProviderSnapshotForTest());

        registry.invalidateSearchProvider();

        // 判别力自证：把 invalidateSearchProvider() 的 `searchProvider = null` 注释掉,
        // 这一行变红。
        assertNull(registry.searchProviderSnapshotForTest(),
                "不置空则本次会话继续用旧 provider —— 第五次 snapshot-vs-live");
    }

    @Test
    @DisplayName("没构造过时快照是 null（不该顺手替调用方构造一个）")
    void snapshotIsNullBeforeFirstUse() {
        assertNull(new ToolRegistry().searchProviderSnapshotForTest());
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest='SearchConfigCommandTest,SearchProviderCacheTest' test`
Expected: 编译失败（`cannot find symbol: method parseSearchConfigUpdate` / `invalidateSearchProvider`）

- [ ] **Step 4: `ToolRegistry` 加失效与测试钩子**

在 `ToolRegistry.searchProvider()`（`:1012`）之后插入：

```java
    /**
     * 搜索配置变更后调用；否则本次会话仍用旧 provider。
     *
     * <p>此前这个字段<b>没有任何失效路径</b>，用户配好搜索后必须重启后端才生效——
     * 本仓库第五次 snapshot-vs-live（前四次：沙箱护盾、动作卡、pet 窗口、补全）。
     */
    public synchronized void invalidateSearchProvider() {
        this.searchProvider = null;
    }

    /** 测试注入口（包可见）：避免为了验缓存行为去真连网。 */
    synchronized void setSearchProviderForTest(SearchProvider provider) {
        this.searchProvider = provider;
    }

    /** 测试观察口（包可见）：未构造时返回 {@code null}，<b>不</b>顺手替调用方构造。 */
    synchronized SearchProvider searchProviderSnapshotForTest() {
        return this.searchProvider;
    }
```

- [ ] **Step 5: `Main` 加 `SearchConfigUpdate` record**

在 `Main.java` 的 `ProviderConfigUpdate` record（`:4905-4910`）之后插入：

```java
    record SearchConfigUpdate(String provider, String apiKey, String baseUrl, String error) {
        static SearchConfigUpdate error(String error) {
            return new SearchConfigUpdate(null, null, null, error);
        }
    }
```

- [ ] **Step 6: `Main` 加 `parseSearchConfigUpdate`**

在 `providerConfigUsage()`（`:3442`）之后插入：

```java
    /** `/config search` 支持的四个后端。duckduckgo 见 D6：显式可选，自动链永不选它。 */
    private static final java.util.Set<String> SEARCH_PROVIDERS =
            java.util.Set.of("zhipu", "serpapi", "searxng", "duckduckgo");

    static SearchConfigUpdate parseSearchConfigUpdate(String payload) {
        List<String> args = splitArgs(payload);
        if (args.isEmpty() || !"search".equalsIgnoreCase(args.get(0))) {
            return SearchConfigUpdate.error("用法不正确");
        }

        String provider = null;
        String apiKey = null;
        String baseUrl = null;
        for (int i = 1; i < args.size(); i++) {
            String token = args.get(i);
            String key;
            String value;
            int equals = token.indexOf('=');
            if (equals > 0) {
                key = token.substring(0, equals);
                value = token.substring(equals + 1);
            } else {
                key = token;
                if (i + 1 >= args.size()) {
                    return SearchConfigUpdate.error("缺少 " + key + " 的值");
                }
                value = args.get(++i);
            }
            switch (normalizeConfigKey(key)) {
                case "provider" -> provider = value;
                case "api-key" -> apiKey = value;
                case "base-url" -> baseUrl = value;
                default -> {
                    return SearchConfigUpdate.error("未知配置项: " + key);
                }
            }
        }

        // --provider 必需：provider 为空而 apiKey 有值时,「这个 key 属于 zhipu 还是 serpapi」
        // 不可猜,猜错会把 SerpAPI 的 key 发给智谱(或反之)。宁可现在报错。
        if (provider == null || provider.isBlank()) {
            return SearchConfigUpdate.error("必须指定 --provider（zhipu / serpapi / searxng / duckduckgo）");
        }
        String normalized = provider.trim().toLowerCase(Locale.ROOT);
        if (!SEARCH_PROVIDERS.contains(normalized)) {
            return SearchConfigUpdate.error(
                    "未知搜索后端: " + provider + "，只支持 zhipu / serpapi / searxng / duckduckgo");
        }
        if ("searxng".equals(normalized) && (baseUrl == null || baseUrl.isBlank())) {
            return SearchConfigUpdate.error(
                    "searxng 需要 --base-url（例如 --base-url http://localhost:8888）");
        }
        // 静默吞掉多给的参数会让用户以为 key 生效了,之后排查不可能。
        if ("duckduckgo".equals(normalized) && (apiKey != null || baseUrl != null)) {
            return SearchConfigUpdate.error("duckduckgo 不需要 --api-key / --base-url");
        }
        return new SearchConfigUpdate(normalized, apiKey, baseUrl, null);
    }

    private static String searchConfigUsage() {
        return """
                用法:
                  /config search --provider searxng --base-url http://localhost:8888
                  /config search --provider serpapi --api-key <key>
                  /config search --provider zhipu --api-key <key>
                  /config search --provider zhipu                 # 沿用 providers.glm.apiKey
                  /config search --provider duckduckgo            # 无需 key,但靠抓 HTML,会抖
                """.stripTrailing();
    }

    private static String applySearchConfig(WraithConfig config, String payload) {
        SearchConfigUpdate update = parseSearchConfigUpdate(payload);
        if (update.error() != null) {
            return "❌ " + update.error() + "\n" + searchConfigUsage();
        }

        WraithConfig.SearchConfig search = config.getSearch();
        if (search == null) {
            search = new WraithConfig.SearchConfig();
            config.setSearch(search);
        }
        search.setProvider(update.provider());
        if (update.apiKey() != null) {
            search.setApiKey(update.apiKey());
        }
        if (update.baseUrl() != null) {
            search.setBaseUrl(update.baseUrl());
        }
        config.save();

        StringBuilder out = new StringBuilder();
        out.append("✅ 已保存搜索后端: ").append(update.provider()).append('\n');
        out.append("   apiKey: ").append(maskSecret(search.getApiKey())).append('\n');
        out.append("   baseUrl: ").append(search.getBaseUrl() == null || search.getBaseUrl().isBlank()
                ? "(未配置)" : search.getBaseUrl()).append('\n');
        if ("duckduckgo".equals(update.provider())) {
            out.append("   ⚠ 这个后端靠抓 HTML，可能因改版或限流失效，只建议临时用。\n");
        }
        out.append("   已立即生效，不需要重启。");
        return out.toString();
    }
```

- [ ] **Step 7: `handleConfigCommand` 路由到 search 分支 + 3 参重载**

把 `handleConfigCommand`（`:3314`）的签名与开头改成：

```java
    static String handleConfigCommand(WraithConfig config, String payload) {
        return handleConfigCommand(config, payload, null);
    }

    /**
     * @param registry 非 null 时，写完调 {@code invalidateSearchProvider()}——搜索配置改完
     *                 立刻生效，不再需要重启后端（第五次 snapshot-vs-live）。
     *                 无条件调用而不是只在 search 分支调：多一次工厂构造无害，
     *                 而「再解析一遍 payload 判断是不是 search」会让两处判断有分叉的机会。
     */
    static String handleConfigCommand(WraithConfig config, String payload, ToolRegistry registry) {
        List<String> head = splitArgs(payload);
        String result;
        if (!head.isEmpty() && "search".equalsIgnoreCase(head.get(0))) {
            result = applySearchConfig(config, payload);
        } else {
            result = applyProviderConfig(config, payload);
        }
        if (registry != null) {
            registry.invalidateSearchProvider();
        }
        return result;
    }

    private static String applyProviderConfig(WraithConfig config, String payload) {
        ProviderConfigUpdate update = parseProviderConfigUpdate(payload);
        // …原 handleConfigCommand 的余下全部内容原样搬进来，一行不改…
    }
```

即：把原 `handleConfigCommand` 从 `ProviderConfigUpdate update = ...` 开始的整个函数体原样搬进新的 `applyProviderConfig`，`handleConfigCommand` 只留路由。

- [ ] **Step 8: REPL 接线**

`Main.java:742` 那行改成传 registry：

```java
                            ui.println(handleConfigCommand(config, command.payload(), hitlToolRegistry));
```

（`hitlToolRegistry` 声明在 `:258`，与 REPL 循环同在一个 try-with-resources 块内，直接可见。`HitlToolRegistry extends ToolRegistry`。）

- [ ] **Step 9: 帮助里提一句写入口**

`providerConfigUsage()` 的最后加一行，让敲错的人知道还有 search 这条：

```java
                  /config search --provider searxng --base-url http://localhost:8888
```

- [ ] **Step 10: 跑测试**

Run: `mvn -DskipTests=false -Dtest='SearchConfigCommandTest,SearchProviderCacheTest,CliCommandParserTest' test`
Expected: 全部 PASS

- [ ] **Step 11: 自证判别力**

把 `ToolRegistry.invalidateSearchProvider()` 里的 `this.searchProvider = null;` 临时注释掉，重跑：

Run: `mvn -DskipTests=false -Dtest=SearchProviderCacheTest test`
Expected: `invalidateClearsTheCachedProvider` FAIL

恢复后重跑确认 PASS。

- [ ] **Step 12: 跑全量**

Run: `mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 13: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/cli/SearchConfigCommandTest.java \
        src/test/java/com/lyhn/wraith/tool/SearchProviderCacheTest.java
git commit -m "$(cat <<'EOF'
feat(search): /config search 写入口 + 配置改完立刻生效(D4)

D1 加的 search 节需要有人能写它,否则只能手改 config.json,整条设计失去意义。
照 /config provider 的样子加一个 CLI 写入口,四个后端各自:

  /config search --provider searxng --base-url http://localhost:8888
  /config search --provider serpapi --api-key <key>
  /config search --provider zhipu                      # 沿用 providers.glm.apiKey
  /config search --provider duckduckgo                 # 无需 key

--provider 是必需的: provider 为空而 apiKey 有值时,「这个 key 属于 zhipu 还是
serpapi」不可猜,猜错会把 SerpAPI 的 key 发给智谱。searxng 缺 --base-url 报错;
duckduckgo 多给 --api-key/--base-url 也报错——静默吞掉会让用户以为 key 生效了,
之后排查不可能。回显掩码 apiKey。

第五次 snapshot-vs-live: ToolRegistry.searchProvider 此前没有任何失效路径,
用户配好搜索后本次会话依然报「未配置」,必须重启后端。加
invalidateSearchProvider() 并在 /config 写完后无条件调用(多一次工厂构造无害,
而「再解析一遍 payload 判断是不是 search」会让两处判断有分叉的机会)。
缓存测试做了判别力自证:注释掉置空那行则变红。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

### Task 6: D5 —— 文案与文档

**Files:**
- Modify: `src/main/resources/skills/web-access/SKILL.md:26`
- Modify: `src/main/java/com/lyhn/wraith/web/SearchProvider.java:9-12`
- Modify: `.env.example`（`:88-113` 搜索段）
- Modify: `src/renderer/lib/pluginShowcase.ts:51`
- Modify: `AGENTS.md:200`
- Test: `src/test/java/com/lyhn/wraith/web/SearchRoutingDocTest.java`（新建）
- Test: `desktop/test/pluginShowcaseSearchRequires.test.tsx`（新建）

**Interfaces:**
- Consumes: 前五个任务的成果（`/config search`、`UnconfiguredSearchProvider`、`DuckDuckGoSearchProvider`）
- Produces: 无新 API

- [ ] **Step 1: 写会红的测试（skill 路由表）**

新建 `src/test/java/com/lyhn/wraith/web/SearchRoutingDocTest.java`：

```java
package com.lyhn.wraith.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * web-access skill 的工具选择表里，「搜索关键词、找入口」那行的 fallback 列曾是 `—`。
 *
 * <p>后果：`web_search` 不可用时，模型在<b>搜索这一步没有任何降级指令</b>，只能自己瞎凑。
 * 这个洞与「chrome-devtools 要不要接成 search provider」无关——它是纯文案洞，
 * 而 chrome-devtools 早就是内建 MCP（{@code Main.java} 里 {@code npx -y chrome-devtools-mcp@latest}），
 * skill 也在教模型用它读 SPA。缺的只是搜索这一步的出口。
 *
 * <p>这条测试守的就是那行不被改回去。
 */
class SearchRoutingDocTest {

    private static String skillMarkdown() throws IOException {
        try (InputStream in = SearchRoutingDocTest.class.getClassLoader()
                .getResourceAsStream("skills/web-access/SKILL.md")) {
            assertNotNull(in, "web-access skill 应当在 classpath 上");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    @DisplayName("搜索那一行有浏览器降级出口，不再是 `—`")
    void searchRowHasBrowserFallback() throws IOException {
        String markdown = skillMarkdown();

        String searchRow = markdown.lines()
                .filter(line -> line.contains("搜索关键词"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("工具选择表里应当有「搜索关键词」那行"));

        assertTrue(searchRow.contains("web_search"), "首选仍是 web_search");
        assertTrue(searchRow.contains("chrome-devtools"),
                "fallback 列该给浏览器出口,否则 web_search 不可用时模型只能瞎凑");
    }

    @Test
    @DisplayName("SearchProvider 接口注释列全四家实现")
    void interfaceDocListsAllFourImplementations() throws IOException {
        String source = java.nio.file.Files.readString(
                java.nio.file.Path.of("src/main/java/com/lyhn/wraith/web/SearchProvider.java"));

        assertTrue(source.contains("ZhipuSearchProvider"), "zhipu 此前就漏了");
        assertTrue(source.contains("SerpApiSearchProvider"));
        assertTrue(source.contains("SearxngSearchProvider"));
        assertTrue(source.contains("DuckDuckGoSearchProvider"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=SearchRoutingDocTest test`
Expected: 两条都 FAIL（`searchRow` 不含 `chrome-devtools`；接口注释不含 `ZhipuSearchProvider`）

- [ ] **Step 3: 改 `web-access/SKILL.md:26`**

把这一行：

```
| 搜索关键词、找入口 | `web_search` | — |
```

改成：

```
| 搜索关键词、找入口 | `web_search` | web_search 报未配置时：`mcp__chrome-devtools__navigate_page` 开搜索引擎页 + `take_snapshot`（慢，但不需要任何 key） |
```

- [ ] **Step 4: 改 `SearchProvider.java` 的接口注释**

把 `:9-12` 的「当前实现」三行替换为：

```java
 * 当前实现：
 * - {@link ZhipuSearchProvider}：智谱 Web Search，需 GLM_API_KEY（与 GLM 推理共用同一个 key）
 * - {@link SerpApiSearchProvider}：商业聚合 API，需 API Key，开箱即用
 * - {@link SearxngSearchProvider}：开源元搜索引擎，需要本地或可访问的 SearXNG 实例，免费无需 key
 * - {@link DuckDuckGoSearchProvider}：<b>显式可选</b>的零 key 应急后端，靠抓 HTML，
 *   自动选择链永不返回它（见该类 Javadoc）
 * - {@link UnconfiguredSearchProvider}：三条路都没配时的话术载体，isReady() 恒为 false
```

- [ ] **Step 5: 改 `.env.example` 的搜索段**

`:88-98` 那段（取值链说明 + 自动选择优先级）替换为：

```
# 搜索 key 的取值链：环境变量 → 系统属性 → ./.env → ~/.env → ~/.wraith/config.json 的 search 节。
#   三条路现在是对等的——都能从 config.json 读到（此前只有 GLM_API_KEY 能，因为它蹭的是
#   providers.glm.apiKey，SERPAPI_KEY / SEARXNG_URL 在 config.json 里没有对应概念）。
#   也可以不写 .env，直接用 CLI 写进 config.json：
#     /config search --provider searxng --base-url http://localhost:8888
#     /config search --provider serpapi --api-key <key>
#
# 自动选择优先级（未显式 SEARCH_PROVIDER 时）：
# 1. 有 GLM_API_KEY → zhipu（与 GLM 推理共用 Key）
# 2. 有 SERPAPI_KEY → serpapi（国际通用，付费即开即用）
# 3. 有 SEARXNG_URL → searxng（开源自托管，免费无需 key，需本地跑 docker 实例）
# 4. 都没有 → 报「未配置」并按本机环境给引导（有 docker 就给 docker run + /config search）
#
# SEARCH_PROVIDER 可选值：zhipu | serpapi | searxng | duckduckgo
#   duckduckgo 无需任何 key，但靠抓 HTML，会因改版或限流失效，只建议临时用；
#   它永远不会被自动选中，只能显式指定。
# SEARCH_PROVIDER=zhipu
```

（原 `:95` 那句「默认推荐：与 GLM 推理共用 Key，零额外配置，国内首选」必须删掉——它正是「话术偏心 GLM」的一处，而且「零额外配置」对没有官方 GLM key 的人是假话。）

- [ ] **Step 6: 改桌面 `pluginShowcase.ts:51`**

把 `requires` 那行替换为：

```ts
    requires: '搜索需四者之一:SEARXNG(自托管,免费无需 key)/ SERPAPI_KEY / GLM_API_KEY(与 GLM 推理共用)/ duckduckgo(无需 key,但靠抓 HTML 会抖);可用 /config search 写进配置;抓取(web_fetch)零配置',
```

同时把上面那两行注释里的取值链补上 search 节：

```ts
  // key 的取值链:环境变量 / 系统属性 / .env / ~/.wraith/config.json 的 search 节
  // (桌面 Provider 面板存的是 providers.*;搜索后端目前只能用 CLI 的 /config search 写)。
```

- [ ] **Step 7: 写桌面测试**

新建 `desktop/test/pluginShowcaseSearchRequires.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { pluginShowcase } from '../src/renderer/lib/pluginShowcase'

// 插件面板上「网页搜索与抓取」那条曾写「搜索需三者之一」,把 GLM 摆在第一位,
// 并暗示它是零配置的那条。对纯中转站用户(无任何官方 provider key)那是假话。
describe('pluginShowcase 的搜索 requires 文案', () => {
  const web = pluginShowcase.find((p) => p.id === 'web')

  it('存在且带 requires', () => {
    expect(web).toBeDefined()
    expect(web?.requires).toBeTruthy()
  })

  it('把免费那条放在前面,不把 GLM 说成零配置', () => {
    const requires = web!.requires!
    expect(requires).toContain('SEARXNG')
    expect(requires).toContain('SERPAPI_KEY')
    expect(requires).toContain('GLM_API_KEY')
    expect(requires.indexOf('SEARXNG')).toBeLessThan(requires.indexOf('GLM_API_KEY'))
    expect(requires).not.toContain('零额外配置')
  })

  it('提到 /config search 这个写入口', () => {
    expect(web!.requires!).toContain('/config search')
  })
})
```

若 `pluginShowcase.ts` 的导出名不是 `pluginShowcase`，按文件里的实际导出名调整 import（**先 `grep -n 'export' src/renderer/lib/pluginShowcase.ts` 确认**，不要凭猜）。

- [ ] **Step 8: 改 `AGENTS.md:200` 的连带清单**

把这一行：

```
### 5.2 改 Web/搜索 → `web/` 相关 + ToolRegistry + `.env.example` + 文档 + 测试
```

改成：

```
### 5.2 改 Web/搜索 → `web/` 相关 + ToolRegistry + `.env.example` + 文档 + 测试

> 改搜索后端另需连带：`WraithConfig.SearchConfig`（config.json 的 `search` 节）+ `UnconfiguredSearchProvider`（「未配置」话术的载体，**不是** Zhipu provider）+ `DuckDuckGoSearchProvider`（显式可选，**自动选择链永不返回它**，由 `SearchProviderAutoSelectionTest` 守门）+ `SearchDetection`（docker/端口检测，纯函数入口注入）+ `/config search` 写入口 + `ToolRegistry.invalidateSearchProvider()`（不调则本次会话仍用旧 provider）+ `src/main/resources/skills/web-access/SKILL.md` 的工具选择表 + 桌面 `pluginShowcase.ts` 的 `requires` 文案。
```

- [ ] **Step 9: 跑 Java 测试**

Run: `mvn -DskipTests=false -Dtest=SearchRoutingDocTest test`
Expected: 全部 PASS

- [ ] **Step 10: 跑桌面测试与类型检查**

```bash
cd desktop && npx tsc --noEmit && npx vitest run
```
Expected: `tsc` 退出码 0；vitest 全绿（此前基线 149 files / 1289 tests，本次 +1 file / +3 tests）

- [ ] **Step 11: 跑 Java 全量**

Run: `mvn -DskipTests=false test 2>&1 | grep -E '^\[ERROR\]   |Tests run:.*Skipped: [0-9]+$|BUILD'`
Expected: `Failures: 0, Errors: 0`，`BUILD SUCCESS`

- [ ] **Step 12: 提交**

```bash
git add src/main/resources/skills/web-access/SKILL.md \
        src/main/java/com/lyhn/wraith/web/SearchProvider.java \
        .env.example \
        src/renderer/lib/pluginShowcase.ts \
        AGENTS.md \
        src/test/java/com/lyhn/wraith/web/SearchRoutingDocTest.java \
        desktop/test/pluginShowcaseSearchRequires.test.tsx
git commit -m "$(cat <<'EOF'
docs(search): 文案与文档跟上取值链对等 + 补上搜索降级出口的真窟窿(D5)

web-access skill 的工具选择表里,「搜索关键词、找入口」那行的 fallback 列是 `—`,
于是 web_search 不可用时模型在搜索这一步没有任何降级指令,只能自己瞎凑。
这个洞与「chrome-devtools 要不要接成 search provider」无关——它是纯文案洞,
而 chrome-devtools 早就是内建 MCP,skill 也在教模型用它读 SPA。补一行出口。

.env.example 删掉「默认推荐:与 GLM 推理共用 Key,零额外配置,国内首选」——
那正是话术偏心 GLM 的一处,而且「零额外配置」对没有官方 GLM key 的人是假话。
取值链改写成对等版本并补 /config search 这个写入口;SEARCH_PROVIDER 的可选值
补 duckduckgo 并同行标注「靠抓 HTML,会抖,只建议临时用、永不自动选中」。

桌面 pluginShowcase 的 requires 从「需三者之一」(GLM 摆第一)改成四者,免费那条
在前;加 vitest 断言顺序与不含「零额外配置」。SearchProvider 接口注释此前连 zhipu
都漏了,补全五个实现。AGENTS.md 5.2 的连带清单补齐本次全部新增件。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ
EOF
)"
```

---

## 收尾验收（全部任务完成后）

- [ ] Java 全量：`mvn -DskipTests=false test` → `0 Failures / 0 Errors`
- [ ] 桌面：`cd desktop && npx tsc --noEmit && npx vitest run` → tsc 0，vitest 全绿
- [ ] `git status --short` 干净；`git log --oneline` 六个提交各自只含本任务文件
- [ ] `git show --stat` 逐个确认**没有** `.env`、`demo/pom.xml`、`target/` 混进去

## 真机验证（代码验不了的部分，交用户）

1. **SearXNG 端到端**：本机 `docker run --rm -p 8888:8888 searxng/searxng`，然后 `/config search --provider searxng --base-url http://localhost:8888`，问一句需要联网的问题，确认真的返回结果。
2. **未配置提示随环境变化**：把 `search` 节清掉、docker 停掉，问一句要搜的问题，看提示是不是「没找到 docker」那一支；起了 docker 再问一次，看是不是变成给 `docker run`（**不缓存**，所以应该立刻变）。
3. **配完立刻生效**：同一次会话里先问一次（应报未配置），`/config search` 配好，**不重启**再问一次，应当直接搜出来。
4. **DuckDuckGo 今天还能不能抓**：`/config search --provider duckduckgo` 后搜一次。抓不到时应当看到「0 条 → 建议改用另三条」的报错，**不是**空结果。
5. **Windows 上的 docker 检测**：`PATH` 分隔符与 `.exe` 后缀差异只有纯函数被单测覆盖，真机行为要在 Windows 上看一次。
