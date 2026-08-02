package com.lyhn.wraith.policy.sandbox;

/**
 * 当前平台实际生效的命令沙箱种类。
 *
 * <p><b>为什么要有这个枚举（而不是继续用 boolean）：</b>
 * 原先 {@code CommandSandbox.available()} 返回 boolean，后端只能回「有/没有」。
 * 于是 Windows 和「macOS 上 sandbox-exec 被删了」这两种完全不同的情况
 * 在前端拿到的是同一个 {@code none}，桌面端只好靠 {@code platform} 反推语义
 * （见 {@code topBar.ts:sandboxChipView} 那段长注释）。
 *
 * <p>那是当时唯一的解法，但根因是<b>后端没把话说清楚</b>。
 * 加上 Windows AppContainer 之后真实状态有三种，再靠 platform 猜就彻底不成立了——
 * 所以这里让后端直接报出「我是哪一种」，前端不必再推。
 */
public enum SandboxKind {

    /** macOS Seatbelt（{@code sandbox-exec} + SBPL profile）。 */
    SEATBELT("macos-seatbelt"),

    /** Windows AppContainer（能力模型：不给 {@code internetClient} 即内核级断网）。 */
    APPCONTAINER("windows-appcontainer"),

    /** 无沙箱：命令裸跑，只剩 {@code CommandGuard} 黑名单与 HITL 审批兜着。 */
    NONE("none");

    private final String wire;

    SandboxKind(String wire) {
        this.wire = wire;
    }

    /** RPC 回包用的稳定字符串（前端 {@code SandboxState} 与之一一对应，别随手改）。 */
    public String wire() {
        return wire;
    }

    public boolean sandboxed() {
        return this != NONE;
    }
}
