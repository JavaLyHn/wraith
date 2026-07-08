package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.llm.LlmClient;

/**
 * 把 Plan 步骤的流式正文导向 plan.step.output / thinking.*（桌面 sink）。
 *
 * <p>不变式：本监听器<b>故意不持有 StreamState、不调用 markStreamed()</b>。
 * 步骤正文走 plan.step.output（而非 message.delta），因此
 * {@code streamState.hasStreamedOutput()} 保持 false，
 * {@code PlanExecuteAgent.run()} 才会返回真实汇总串而非 ""（Main.java plan 路径
 * 据此发出唯一一条底部 message）。若日后在此触碰 streamState.markStreamed()，
 * 该不变式会被静默破坏。
 */
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
        // reasoning→content 过渡：正文一开始就收口思考块（thinking.end → 前端 done=true），
        // 否则思考块会一直停在「思考中」。镜像 ReAct 路径行为。
        endThinkingIfOpen();
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

    @Override
    public void finish() {
        // 步骤流结束：收口尚未闭合的思考块（纯思考、无正文的步骤靠这里收口）。
        // 计划完成后的 message.end 仍由 Main.java plan 路径统一处理。
        endThinkingIfOpen();
    }

    /** 若本步骤开过思考块则收口它（thinking.end → 前端 done=true）；幂等。 */
    private void endThinkingIfOpen() {
        if (thinkingBegun) {
            renderer.endThinking();
            thinkingBegun = false;
        }
    }
}
