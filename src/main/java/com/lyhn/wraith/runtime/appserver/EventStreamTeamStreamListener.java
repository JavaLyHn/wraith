package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.llm.LlmClient;

/**
 * 把 AgentOrchestrator 中各子 Agent（planner / 执行步骤）的 LLM 流式 delta
 * 转发到对应的 team.plan.output / team.step.output 通知。
 *
 * <p>reasoning delta 决策：v1 与正文 delta 走同一路由（team.plan.output 或
 * team.step.output）。理由：桌面 TeamCard 尚未提供独立思考折叠面板，把 reasoning
 * 当作正文流出可在步骤行下方给用户可见进度感；等桌面支持折叠思考块后再拆分。
 * 与 {@link EventStreamStepListener} 的"reasoning → thinking.begin/appendThinking"
 * 方案有意不同：plan-and-execute 只有单 planner，而 team 有多个并发步骤，共享
 * thinking 管道会造成交叉污染，故此处统一走内容通道。
 */
public final class EventStreamTeamStreamListener implements LlmClient.StreamListener {
    private final EventStreamRenderer renderer;
    private final String teamId;
    private final String kind;
    private final String id;

    /**
     * @param renderer 事件流渲染器（已 synchronized，并发安全）
     * @param teamId   本次 team 协作的唯一 ID
     * @param kind     "planner" 或其他（步骤类型/名称）
     * @param id       步骤 ID（planner 时可传空串或 planner 名称，路由时不使用）
     */
    public EventStreamTeamStreamListener(EventStreamRenderer renderer, String teamId,
                                         String kind, String id) {
        this.renderer = renderer;
        this.teamId = teamId;
        this.kind = kind;
        this.id = id;
    }

    @Override
    public void onContentDelta(String delta) {
        if (delta == null || delta.isEmpty()) return;
        if ("planner".equals(kind)) {
            renderer.emitTeamPlanOutput(teamId, delta);
        } else {
            renderer.emitTeamStepOutput(teamId, id, delta);
        }
    }

    /**
     * reasoning delta 与正文 delta 走同一路由（见类注释）。
     * 空/blank delta 跳过，避免无效通知。
     */
    @Override
    public void onReasoningDelta(String delta) {
        if (delta == null || delta.isBlank()) return;
        // 路由到与正文相同的通道（planner → team.plan.output，步骤 → team.step.output）
        onContentDelta(delta);
    }

    // 其余 StreamListener 方法使用接口默认实现（空实现 / hasStreamedOutput=false）
}
