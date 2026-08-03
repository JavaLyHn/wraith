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
