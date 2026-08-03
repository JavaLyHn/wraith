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
     *
     * <p><b>为什么这个四参重载是 public</b>：生产入口只暴露单参的
     * {@link #candidates(WraithConfig)}，它扫真实 {@code System.getenv()} / {@code .env}。
     * 跨包测试（{@code com.lyhn.wraith.llm.LlmClientFactoryFallbackTest}）需要验证
     * 「stale {@code defaultProvider}="glm" + 只配了某个 provider」这类场景，若走单参入口，
     * 结果会随本机是否设了 {@code GLM_API_KEY}/{@code DEEPSEEK_API_KEY} 等真实变量而漂移
     * （本仓库 checkout 里就有 {@code ./.env} 落着真实 {@code DEEPSEEK_API_KEY}）。
     * 开 public 只是为了让这类测试能注入「只认 config、不碰真实环境」的查询函数
     * （{@code envVarNames=Set.of()}），不是鼓励生产代码绕过 {@link #candidates(WraithConfig)}
     * 直调本方法。
     */
    public static List<String> candidates(WraithConfig config,
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
