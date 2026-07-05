package com.lyhn.wraith.automation;

public class AutomationRun {
    public String runId, taskId;
    public long startedAt;
    public Long endedAt;
    public String status;      // running|waiting_approval|success|failed|interrupted
    public String sessionId, summary;
    public boolean miss;
    /** Set by DesktopDeliveryAdapter; the desktop app reads this to pop an OS notification. */
    public boolean notifyDesktop;
    /**
     * Set by the AskSurface when a run enters waiting_approval status.
     * Null when not in approval state. Additive field — nullable for backward compat.
     */
    public String approvalId;
    /**
     * The name of the tool requiring approval, set alongside approvalId.
     * Null when not in approval state. Additive field — nullable for backward compat.
     */
    public String approvalTool;
}
