package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.agent.PlanProgressListener;
import com.lyhn.wraith.plan.ExecutionPlan;
import com.lyhn.wraith.plan.Task;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 把 Plan 生命周期翻译成 plan.* JSON-RPC 通知（桌面 sink）。 */
public final class EventStreamPlanListener implements PlanProgressListener {
    private final EventStreamRenderer renderer;
    private final String planId;

    public EventStreamPlanListener(EventStreamRenderer renderer, String planId) {
        this.renderer = renderer;
        this.planId = planId;
    }

    /**
     * 将 ExecutionPlan 的任务列表序列化为前端可消费的 step 结构列表。
     * public 以便 Task A6（com.lyhn.wraith.cli 包）直接调用。
     */
    public static List<Map<String, Object>> stepsOf(ExecutionPlan plan) {
        List<Map<String, Object>> steps = new ArrayList<>();
        for (String id : plan.getExecutionOrder()) {
            Task t = plan.getTask(id);
            if (t == null) continue;
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("id", t.getId());
            s.put("description", t.getDescription());
            s.put("deps", t.getDependencies());
            steps.add(s);
        }
        return steps;
    }

    @Override
    public void planCreated(ExecutionPlan plan) {
        renderer.emitPlanCreated(planId, plan.getGoal(), stepsOf(plan));
    }

    @Override
    public void stepStarted(String stepId) {
        renderer.emitPlanStepStarted(planId, stepId);
    }

    @Override
    public void stepCompleted(String stepId, boolean ok, String result) {
        renderer.emitPlanStepCompleted(planId, stepId, ok, result);
    }

    @Override
    public void planFinished(String finalResult) {
        // 步骤正文已改走 plan.step.output，无 message 流需要在此收口。
        // 最终汇总结果由 Main.java plan 路径在 runTurn 返回后统一发 message.delta + message.end。
    }
}
