package com.lyhn.wraith.automation;

import java.util.List;

public class AutomationTask {
    public String id, name, prompt, workspace;
    public Schedule schedule;
    public boolean enabled;
    public List<DeliveryTarget> deliverTo;
    public ApprovalPolicy approval;
    public long createdAt, enabledAt;
}
