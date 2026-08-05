package com.lyhn.wraith.snapshot;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public record SnapshotConfig(
        boolean enabled,
        Path snapshotsRoot,
        int maxSnapshots,
        List<String> excludes
) {
    private static final List<String> DEFAULT_EXCLUDES = List.of(
            ".git",
            ".wraith/snapshots",
            "target",
            "node_modules",
            "dist",
            // electron-builder 的输出目录。原来只排了 dist,而桌面端产物落在 release/
            // (含 .app / .exe / 解包后的 asar,几百 MB,里面还有超长路径)——
            // 每轮 git add . 都要遍历它,在 Windows 上是 AddCommand 失败的头号嫌疑。
            "release",
            ".claude/worktrees",
            ".idea",
            "*.class",
            "*.jar"
    );

    /**
     * {@code enabled} 这个值<b>是谁决定的</b>。
     *
     * <p>桌面开关按钮需要它：被环境变量覆盖时按钮必须<b>置灰并说明原因</b>，
     * 而不是让用户点了没反应。「面板显示的状态与实际生效的不是一回事」这个坑
     * 在「网页搜索与抓取」那张卡片上踩过一次了。
     */
    public enum EnabledSource {
        /** 环境变量 {@code WRAITH_SNAPSHOT_ENABLED} */
        ENV,
        /** 系统属性 {@code -Dwraith.snapshot.enabled}（{@code --no-snapshot} 也走它） */
        PROPERTY,
        /** {@code ~/.wraith/config.json} 的 {@code snapshot.enabled}（桌面按钮 / {@code /snapshot off} 写的） */
        CONFIG,
        /** 谁都没表态 —— 默认开 */
        DEFAULT,
    }

    /**
     * 当前 {@code enabled} 的来源。
     *
     * <p>与 {@link #fromEnvironment()} 的判定<b>必须同源</b>，所以两者都走
     * {@link #resolveEnabled()}；各算一遍的话按钮会说「配置说了算」而实际是 env 在管。
     */
    public static EnabledSource enabledSource() {
        return resolveEnabled().source();
    }

    private record EnabledDecision(boolean enabled, EnabledSource source) {}

    /**
     * 取值链：<b>环境变量 → 系统属性 → config.json → 默认开</b>。
     *
     * <p>env/属性优先于配置文件，与 {@code SearchProviderFactory} 的既有约定一致：
     * 显式设了环境变量的人是在做「本次运行的临时覆盖」，配置文件不该压过它。
     * 代价是 shell profile 里写死了那个变量的人点桌面按钮不生效 ——
     * 所以才有 {@link EnabledSource}，让按钮能如实说明。
     */
    private static EnabledDecision resolveEnabled() {
        Boolean fromEnv = parseBoolean(System.getenv("WRAITH_SNAPSHOT_ENABLED"));
        if (fromEnv != null) {
            return new EnabledDecision(fromEnv, EnabledSource.ENV);
        }
        Boolean fromProperty = parseBoolean(System.getProperty("wraith.snapshot.enabled"));
        if (fromProperty != null) {
            return new EnabledDecision(fromProperty, EnabledSource.PROPERTY);
        }
        Boolean fromConfig = configuredEnabled();
        if (fromConfig != null) {
            return new EnabledDecision(fromConfig, EnabledSource.CONFIG);
        }
        return new EnabledDecision(true, EnabledSource.DEFAULT);
    }

    /**
     * config.json 里的 {@code snapshot.enabled}；没配过或读不出来返回 {@code null}。
     *
     * <p>吞异常与 {@code SearchProviderFactory.resolveSettings} 同一个约定：
     * 配置文件坏了不该把快照链路带崩 —— 退化成「默认开」是安全的方向
     * （宁可多存几张快照，不可静默不存）。
     */
    private static Boolean configuredEnabled() {
        try {
            com.lyhn.wraith.config.WraithConfig.SnapshotSettings settings =
                    com.lyhn.wraith.config.WraithConfig.load().getSnapshot();
            return settings == null ? null : settings.getEnabled();
        } catch (Exception e) {
            return null;
        }
    }

    /** {@code null} = 没给值 / 认不出来（不是 false —— 那会把「没配」当成「关掉」）。 */
    private static Boolean parseBoolean(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "1", "true", "yes", "on" -> Boolean.TRUE;
            case "0", "false", "no", "off" -> Boolean.FALSE;
            default -> null;
        };
    }

    public static SnapshotConfig fromEnvironment() {
        boolean enabled = resolveEnabled().enabled();
        Path root = Path.of(readString("wraith.snapshot.dir", "WRAITH_SNAPSHOT_DIR",
                Path.of(System.getProperty("user.home"), ".wraith", "snapshots").toString()));
        int max = readInt("wraith.snapshot.max", "WRAITH_SNAPSHOT_MAX", 50);
        List<String> excludes = mergeExcludes(readString("wraith.snapshot.excludes", "WRAITH_SNAPSHOT_EXCLUDES", ""));
        return new SnapshotConfig(enabled, root, Math.max(1, max), excludes);
    }

    public SnapshotConfig withEnabled(boolean enabled) {
        return new SnapshotConfig(enabled, snapshotsRoot, maxSnapshots, excludes);
    }

    // readBoolean 已删:enabled 的取值链现在多了一层 config.json,而且要报告来源,
    // 走 resolveEnabled() / parseBoolean()。留一个只有 env+属性两层的旧函数在这儿
    // 迟早会有人拿它读第二个开关,然后那个开关就悄悄不认配置文件了。

    private static int readInt(String property, String env, int fallback) {
        String value = readNullable(property, env);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static String readString(String property, String env, String fallback) {
        String value = readNullable(property, env);
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static String readNullable(String property, String env) {
        String value = System.getProperty(property);
        if (value != null) {
            return value;
        }
        return System.getenv(env);
    }

    private static List<String> mergeExcludes(String configured) {
        Set<String> merged = new LinkedHashSet<>(DEFAULT_EXCLUDES);
        if (configured != null && !configured.isBlank()) {
            for (String item : configured.split(",")) {
                String trimmed = item.trim();
                if (!trimmed.isEmpty()) {
                    merged.add(trimmed);
                }
            }
        }
        return new ArrayList<>(merged);
    }
}
