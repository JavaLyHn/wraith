package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.llm.LlmClient;

/** 把 Plan 步骤的流式正文导向 plan.step.output / thinking.*（桌面 sink）。 */
public final class EventStreamStepListener implements LlmClient.StreamListener {
    private final EventStreamRenderer renderer;
    private final String planId;
    private final String stepId;
    /** 首个非空 reasoning delta 到达前保持 false；首次触发后发 beginThinking 并置 true。 */
    private boolean thinkingBegun;

    public EventStreamStepListener(EventStreamRenderer renderer, String planId, String stepId) {
        this.renderer = renderer;
        this.planId = planId;
        this.stepId = stepId;
    }

    @Override
    public void onContentDelta(String delta) {
        if (delta == null || delta.isEmpty()) return;
        // 步骤正文嵌套在计划清单步骤行下方，不再作为独立 message.delta 浮动
        renderer.emitPlanStepOutput(planId, stepId, delta);
    }

    @Override
    public void onReasoningDelta(String delta) {
        if (delta == null || delta.isBlank()) return;
        // 首个非空思考片段：先发 thinking.begin，后续直接追加
        if (!thinkingBegun) {
            renderer.beginThinking("计划步骤");
            thinkingBegun = true;
        }
        renderer.appendThinking(delta);
    }

    // finish() 不覆写：步骤流是流量 delta，无需独立收口；
    // 计划完成后由 Main.java plan 路径统一发 message.end。
}
