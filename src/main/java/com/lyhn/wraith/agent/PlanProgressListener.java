package com.lyhn.wraith.agent;

import com.lyhn.wraith.plan.ExecutionPlan;

/**
 * Plan 执行生命周期监听器（加法式旁路）。
 * PlanExecuteAgent 在关键节点回调；默认 NOOP 保持 CLI 行为不变。
 * CLI 用 NOOP（叙述仍走 out.println）；桌面注入 EventStreamPlanListener 发 plan.* 通知。
 */
public interface PlanProgressListener {
    /** 计划已生成、即将执行（复审通过后）。 */
    void planCreated(ExecutionPlan plan);
    /** 某步骤开始执行。 */
    void stepStarted(String stepId);
    /** 某步骤结束。ok=false 表示失败。 */
    void stepCompleted(String stepId, boolean ok, String result);
    /** 整个计划执行结束，finalResult 为汇总文本。 */
    void planFinished(String finalResult);

    PlanProgressListener NOOP = new PlanProgressListener() {
        @Override public void planCreated(ExecutionPlan plan) { }
        @Override public void stepStarted(String stepId) { }
        @Override public void stepCompleted(String stepId, boolean ok, String result) { }
        @Override public void planFinished(String finalResult) { }
    };
}
