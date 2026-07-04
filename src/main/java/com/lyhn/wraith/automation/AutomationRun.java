package com.lyhn.wraith.automation;

public class AutomationRun {
    public String runId, taskId;
    public long startedAt;
    public Long endedAt;
    public String status;      // running|waiting_approval|success|failed|interrupted
    public String sessionId, summary;
    public boolean miss;
}
