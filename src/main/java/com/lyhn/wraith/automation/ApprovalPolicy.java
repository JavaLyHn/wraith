package com.lyhn.wraith.automation;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public class ApprovalPolicy {
    @JsonProperty("default") public ApprovalMode default_;
    public Map<String, ApprovalMode> tools;
    public Integer askTimeoutMinutes;
    public ApprovalMode resolve(String tool) {
        if (tools != null && tool != null) {
            ApprovalMode m = tools.get(tool);
            if (m != null) return m;
        }
        return default_ != null ? default_ : ApprovalMode.DENY;
    }
    public int askTimeoutMinutesOr(int fallback) {
        return askTimeoutMinutes != null ? askTimeoutMinutes : fallback;
    }
}
