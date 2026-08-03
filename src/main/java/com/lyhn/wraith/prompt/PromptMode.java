package com.lyhn.wraith.prompt;

public enum PromptMode {
    AGENT("modes/agent.md", "ReAct"),
    PLAN("modes/plan.md", "Plan"),
    PLANNER("modes/planner.md", "Plan"),
    TEAM_PLANNER("modes/team-planner.md", "Team"),
    TEAM_WORKER("modes/team-worker.md", "Team"),
    TEAM_REVIEWER("modes/team-reviewer.md", "Team");

    private final String resourcePath;
    private final String displayName;

    PromptMode(String resourcePath, String displayName) {
        this.resourcePath = resourcePath;
        this.displayName = displayName;
    }

    public String resourcePath() {
        return resourcePath;
    }

    /**
     * 用户看到的模式名（切换器上写的那个）：ReAct / Plan / Team。
     *
     * <p>系统提示里那句「当前运行模式」用的就是它。<b>刻意由这个枚举派生</b>，
     * 而不是另加一个 {@code PromptContext} 字段：选模式文件的和声明模式的是同一个值，
     * 两者永远不会各说各话；多一个字段就多一个可以忘记更新的地方。
     *
     * <p>多对一是对的：{@code PLANNER} 是 Plan 模式里的规划者，
     * {@code TEAM_*} 三个都在 Team 模式里 —— 用户眼里只有三种模式。
     */
    public String displayName() {
        return displayName;
    }
}
