package com.lyhn.wraith.automation;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * 自动化任务的持久化定义(automations.json 单条)。刻意是桌面 TS 线格式的子集:
 * 桌面额外发来 projectPath(旧别名,已被 workspace 取代)与 lastFiredAt(运行态,
 * 归 daemon 的 automation-state.json),这些 TS-only 字段在此被容忍并丢弃,
 * 避免每次 upsert 因未知字段反序列化失败,也挡住"TS 加字段即崩"的整类跨层 bug。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class AutomationTask {
    public String id, name, prompt, workspace;
    public Schedule schedule;
    public boolean enabled;
    public List<DeliveryTarget> deliverTo;
    public ApprovalPolicy approval;
    public long createdAt, enabledAt;
}
