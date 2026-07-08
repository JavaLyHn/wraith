package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.llm.LlmClient;

/** 把 Plan 步骤的流式正文导向 message.delta / thinking.*（桌面 sink）。 */
public final class EventStreamStepListener implements LlmClient.StreamListener {
    private final EventStreamRenderer renderer;
    /** 首个非空 reasoning delta 到达前保持 false；首次触发后发 beginThinking 并置 true。 */
    private boolean thinkingBegun;

    public EventStreamStepListener(EventStreamRenderer renderer) {
        this.renderer = renderer;
    }

    @Override
    public void onContentDelta(String delta) {
        if (delta == null || delta.isEmpty()) return;
        renderer.appendAssistantContentDelta(delta);
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

    // finish() 不覆写：message.end 由 EventStreamPlanListener.planFinished → finishAssistantContent 统一收口，
    // 避免每步都发一次 message.end 与最终收口重复。
}
