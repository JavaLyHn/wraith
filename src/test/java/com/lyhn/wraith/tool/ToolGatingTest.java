package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** 三件套工具的注册与闸门:防「工具没注册」「高危工具漏进 HITL」两类静默失效。 */
class ToolGatingTest {

    private static final List<String> ALL_NEW = List.of(
            "task_add", "task_list", "task_get", "task_cancel",
            "memory_list", "memory_search", "memory_delete",
            "memory_pending_list", "memory_pending_approve", "memory_pending_reject",
            "automation_list", "automation_upsert", "automation_remove",
            "automation_run_now", "automation_runs");

    private static final List<String> MUST_BE_HITL = List.of(
            "task_add", "memory_delete",
            "automation_upsert", "automation_remove", "automation_run_now");

    @Test
    void allNewToolsAreRegisteredAndExposedToLlm() {
        ToolRegistry reg = new ToolRegistry();
        var exposed = reg.getToolDefinitions().stream().map(t -> t.name()).toList();
        for (String name : ALL_NEW) {
            assertTrue(reg.hasTool(name), name + " 应已注册");
            assertTrue(exposed.contains(name), name + " 应暴露给 LLM");
        }
    }

    @Test
    void highConsequenceWritesRequireApproval() {
        for (String name : MUST_BE_HITL) {
            assertTrue(com.lyhn.wraith.hitl.ApprovalPolicy.requiresApproval(name),
                    name + " 必须走 HITL 审批");
        }
    }

    @Test
    void readOnlyToolsDoNotRequireApproval() {
        for (String name : List.of("task_list", "task_get", "memory_list", "memory_search",
                "memory_pending_list", "automation_list", "automation_runs")) {
            assertFalse(com.lyhn.wraith.hitl.ApprovalPolicy.requiresApproval(name),
                    name + " 是只读工具,不该设审批闸");
        }
    }
}
