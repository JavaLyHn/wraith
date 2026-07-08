package com.lyhn.wraith.agent;

import java.util.List;

/**
 * Multi-Agent 协作生命周期监听器(加法式旁路)。
 * AgentOrchestrator 在关键节点回调;默认 NOOP 保持 CLI 行为不变(叙述仍走 out.println)。
 * 注意:stepStarted/stepCompleted 可能从并行 worker 线程并发触发,实现方需并发安全。
 */
public interface TeamProgressListener {
    record AgentInfo(String id, String role) {}
    /** 步骤只读视图(供事件序列化,避免泄露内部可变 record)。 */
    record StepInfo(String id, String description, String type, List<String> dependencies) {}

    void started(String goal, List<AgentInfo> agents);
    void planParsed(List<StepInfo> steps);
    void batchStarted(int batchIndex, List<String> stepIds);
    void stepStarted(String stepId, String agentName);
    /** status: "completed" | "failed" | "skipped"。approved/retries 为审查结果(skipped/failed 时 approved=false, retries=0)。 */
    void stepCompleted(String stepId, String status, String result, boolean approved, int retries);
    void finished(String status); // "completed" | "partial" | "failed"

    TeamProgressListener NOOP = new TeamProgressListener() {
        @Override public void started(String goal, List<AgentInfo> agents) {}
        @Override public void planParsed(List<StepInfo> steps) {}
        @Override public void batchStarted(int batchIndex, List<String> stepIds) {}
        @Override public void stepStarted(String stepId, String agentName) {}
        @Override public void stepCompleted(String stepId, String status, String result, boolean approved, int retries) {}
        @Override public void finished(String status) {}
    };
}
