package com.lyhn.wraith.render;

import java.io.PrintStream;

/**
 * 提交消息后、模型开口前那段「准备期」的反馈。
 *
 * <p><b>为什么需要</b>（pty 实测，用户报「发送消息无响应」）：
 * <pre>
 * 输出到达秒数: [0.0, 0.01, 8.27, 8.53, ... 11.18]
 *                     ↑提交回显    ↑spinner 才开始转
 *                     └─ 8.26 秒零输出 ─┘
 * </pre>
 * spinner <b>是有的</b>，但它迟到了 8 秒多，而且自己显示 {@code (esc to cancel, 0s)} ——
 * 说明 {@code Agent} 的 {@code beginThinking()} 确实是那一刻才被调用的。
 *
 * <p>那 8 秒花在 {@code SnapshotService.runTurn} 里的 <b>pre-turn 快照</b>上：
 * <pre>
 * snapshotBeforeTurn(turnId, summary);   // ← 同步阻塞
 * try { return supplier.get(); }         // ← agent.run 在这之后才开始
 * finally { snapshotAfterTurnAsync(...); }
 * </pre>
 * post-turn 是异步的（对的），但 pre-turn 是同步的，对大仓库要几秒（实测本机
 * {@code ~/.wraith/snapshots} 已 747MB）。这段时间屏幕上一个字都没有，
 * 用户只能读作「卡死了」。
 *
 * <p>做法：提交后立刻把活动面板点起来。{@code Agent.beginThinking()} 随后会
 * 平滑接管 —— {@code InlineActivityDisplay.begin()} 内部先 {@code clearLocked()}
 * 再重置计时，所以不会出现两个面板叠在一起。
 *
 * <p>渲染器不支持活动面板时（{@code PlainRenderer}、或终端降级）退化成打一行字：
 * <b>一行字也比整屏静止好</b>。
 */
public final class TurnPreparationNotice {

    private TurnPreparationNotice() {
    }

    static final String LABEL = "准备本轮";
    static final String DETAIL = "保存快照 / 装配上下文";
    static final String PLAIN_LINE = "  · 准备本轮（保存快照 / 装配上下文）…";

    /**
     * 点亮准备期反馈。
     *
     * @return 收尾动作；调用方必须在 {@code finally} 里执行它。
     *         幂等：{@code Agent} 已经把面板换成自己的 thinking 时，这次 end 是空操作。
     */
    public static Runnable begin(Renderer renderer, PrintStream fallbackOut) {
        if (renderer == null) {
            return () -> { };
        }
        if (renderer.supportsActivityPanel()) {
            renderer.beginActivity(LABEL, DETAIL);
            return renderer::endActivity;
        }
        if (fallbackOut != null) {
            fallbackOut.println(PLAIN_LINE);
        }
        return () -> { };
    }
}
