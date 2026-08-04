package com.lyhn.wraith.config;

import com.lyhn.wraith.policy.sandbox.ShellCommand;

/**
 * 配置路径的<b>展示写法</b>（分平台）。
 *
 * <p>路径<b>实现</b>一直是对的：全仓库都走 {@code System.getProperty("user.home")} +
 * {@code Path.of}，在 Windows 上解析成 {@code C:\Users\<名>\.wraith}，能读能写。
 * 这个类只管「怎么把它写给人和模型看」。
 *
 * <p><b>为什么值得单独一个类</b>：{@code ~/.wraith} 此前硬编码在 prompt 语料、CLI 提示、
 * 桌面文案等十几处，而它在 Windows 上是错的，并且错得有后果 ——
 * 模型照着把 {@code ~/.wraith} 塞进 {@code execute_command}，那头是 {@code cmd.exe}，
 * <b>{@code ~} 不展开</b>，于是拿到空结果，对用户宣布「{@code ~/.wraith} 为空」。
 * 一个存在且非空的目录被报成空的。
 *
 * <p><b>三种形态，各有各的用处</b>：
 * <ul>
 *   <li>{@link #home()} / {@link #path} —— 给<b>人</b>看的简写：
 *       Unix {@code ~/.wraith}，Windows {@code %USERPROFILE%\.wraith}
 *       （后者在 {@code cmd.exe} 里能展开，而 cmd.exe 正是 Windows 上
 *       {@code execute_command} 用的 shell）</li>
 *   <li>{@link #absoluteHome()} —— 给<b>模型</b>看的绝对路径，不含任何需要展开的记号。
 *       prompt 的 Runtime Context 用它，这样模型压根不需要猜怎么展开</li>
 * </ul>
 *
 * <p>{@code -Dwraith.config.dir} 覆盖生效时<b>原样显示</b>那个路径：套简写只会误导。
 */
public final class ConfigPathDisplay {

    private static final String DIR_NAME = ".wraith";

    private ConfigPathDisplay() {}

    /** 展示用的配置目录（简写形态）。 */
    public static String home() {
        return home(osName(), userHome(), override());
    }

    /** 展示用的配置目录下某个文件 / 子目录（简写形态）。 */
    public static String path(String... segments) {
        return pathIn(osName(), userHome(), override(), segments);
    }

    /** 绝对路径形态：给模型用，不含任何需要展开的记号。 */
    public static String absoluteHome() {
        return absoluteHome(osName(), userHome(), override());
    }

    // ---- 可测重载（注入 os.name / user.home / 覆盖值，绝不碰真实环境）----

    static String home(String osName, String userHome, String override) {
        String trimmed = override == null ? null : override.trim();
        if (trimmed != null && !trimmed.isEmpty()) {
            return trimmed;
        }
        return ShellCommand.isWindows(osName) ? "%USERPROFILE%\\" + DIR_NAME : "~/" + DIR_NAME;
    }

    /** 名字与 {@link #path(String...)} 不同是必须的:两者都是 String 变参,同名会歧义。 */
    static String pathIn(String osName, String userHome, String override, String... segments) {
        String sep = ShellCommand.isWindows(osName) ? "\\" : "/";
        StringBuilder sb = new StringBuilder(home(osName, userHome, override));
        for (String segment : segments) {
            if (segment == null || segment.isBlank()) continue;
            sb.append(sep).append(segment);
        }
        return sb.toString();
    }

    static String absoluteHome(String osName, String userHome, String override) {
        String trimmed = override == null ? null : override.trim();
        if (trimmed != null && !trimmed.isEmpty()) {
            return trimmed;
        }
        if (userHome == null || userHome.isBlank()) {
            // user.home 缺失是极端情况，但吐 "null/.wraith" 比吐一个裸目录名更糟
            return DIR_NAME;
        }
        String sep = ShellCommand.isWindows(osName) ? "\\" : "/";
        String base = userHome.trim();
        return base.endsWith(sep) ? base + DIR_NAME : base + sep + DIR_NAME;
    }

    private static String osName() {
        return System.getProperty("os.name", "");
    }

    private static String userHome() {
        return System.getProperty("user.home", "");
    }

    private static String override() {
        return System.getProperty("wraith.config.dir");
    }
}
