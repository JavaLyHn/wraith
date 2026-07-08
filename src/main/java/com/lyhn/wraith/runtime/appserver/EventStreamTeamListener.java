package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.agent.TeamProgressListener;

import java.util.List;
import java.util.Map;

/** 把 Team 生命周期回调导向 team.* 通知（桌面 sink）。 */
public final class EventStreamTeamListener implements TeamProgressListener {
    private final EventStreamRenderer renderer;
    private final String teamId;

    public EventStreamTeamListener(EventStreamRenderer renderer, String teamId) {
        this.renderer = renderer;
        this.teamId = teamId;
    }

    @Override
    public void started(String goal, List<AgentInfo> agents) {
        renderer.emitTeamStarted(teamId, goal,
                agents.stream()
                        .map(a -> Map.<String, Object>of("id", a.id(), "role", a.role()))
                        .toList());
    }

    @Override
    public void planParsed(List<StepInfo> steps) {
        renderer.emitTeamPlan(teamId, steps.stream()
                .map(s -> Map.<String, Object>of(
                        "id", s.id(),
                        "description", s.description(),
                        "type", s.type(),
                        "dependencies", s.dependencies() == null ? List.of() : s.dependencies()))
                .toList());
    }

    @Override
    public void batchStarted(int batchIndex, List<String> stepIds) {
        renderer.emitTeamBatch(teamId, batchIndex, stepIds);
    }

    @Override
    public void stepStarted(String stepId, String agentName) {
        renderer.emitTeamStepStarted(teamId, stepId, agentName);
    }

    @Override
    public void stepCompleted(String stepId, String status, String result, boolean approved, int retries) {
        renderer.emitTeamStepCompleted(teamId, stepId, status, result == null ? "" : result, approved, retries);
    }

    @Override
    public void finished(String status) {
        renderer.emitTeamFinished(teamId, status);
    }
}
