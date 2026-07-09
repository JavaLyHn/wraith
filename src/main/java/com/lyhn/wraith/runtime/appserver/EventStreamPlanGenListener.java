package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.llm.LlmClient;

/**
 * 把 plan 模式"规划器生成计划"阶段的 LLM 流式 delta 转发为 {@code plan.output} 事件,
 * 让桌面在 {@code plan.created}(计划表)到达前的空窗期就能边生成边出字。
 *
 * <p>reasoning delta 与正文 delta 走同一路由(与 {@link EventStreamTeamStreamListener}
 * 的 v1 取舍一致):plan 卡片当前无独立思考折叠面板,把 reasoning 当正文流出即可给用户
 * 可见进度感;空/blank delta 跳过。</p>
 */
public final class EventStreamPlanGenListener implements LlmClient.StreamListener {
    private final EventStreamRenderer renderer;
    private final String planId;

    public EventStreamPlanGenListener(EventStreamRenderer renderer, String planId) {
        this.renderer = renderer;
        this.planId = planId;
    }

    @Override
    public void onContentDelta(String delta) {
        if (delta == null || delta.isEmpty()) return;
        renderer.emitPlanOutput(planId, delta);
    }

    @Override
    public void onReasoningDelta(String delta) {
        if (delta == null || delta.isBlank()) return;
        renderer.emitPlanOutput(planId, delta);
    }

    // 其余 StreamListener 方法用接口默认空实现。
}
