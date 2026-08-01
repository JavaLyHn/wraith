package com.lyhn.wraith.automation;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * lastFiredAt 的两个文件必须在「回读给 UI」这一步合流。
 *
 * 现状是 split-brain:调度器把 lastFiredAt 写进 automation-state.json(AutomationTask
 * 刻意不含该字段,见其类注释),而 automations.list 直接返回 loadTasks() —— 于是桌面
 * 永远读到 null。真机后果:任务今天真跑了 29 次,面板上的「下次」却只能从 enabledAt
 * 推算,与实际执行完全脱节。
 */
class AutomationStoreViewTest {

    private static AutomationStore store(Path dir) {
        return new AutomationStore(dir);
    }

    private static AutomationTask task(String id, String name) {
        AutomationTask t = new AutomationTask();
        t.id = id; t.name = name; t.prompt = "p"; t.workspace = "/w";
        Schedule sc = new Schedule();
        sc.kind = ScheduleKind.INTERVAL;
        sc.everyMinutes = 1;
        t.schedule = sc;
        t.enabled = true; t.createdAt = 1000; t.enabledAt = 1000;
        return t;
    }

    @Test
    void viewMergesLastFiredAtFromStateFile(@TempDir Path dir) {
        AutomationStore s = store(dir);
        s.saveTasks(List.of(task("a", "甲"), task("b", "乙")));
        s.setLastFiredAt("a", 1785576742489L);   // 只有 a 跑过

        List<Map<String, Object>> view = s.loadTasksForView();

        assertEquals(2, view.size());
        Map<String, Object> a = view.stream().filter(m -> "a".equals(m.get("id"))).findFirst().orElseThrow();
        Map<String, Object> b = view.stream().filter(m -> "b".equals(m.get("id"))).findFirst().orElseThrow();
        assertEquals(1785576742489L, ((Number) a.get("lastFiredAt")).longValue(),
                "跑过的任务必须带上真实 lastFiredAt,否则 UI 的「下次」永远从 enabledAt 推");
        assertTrue(b.containsKey("lastFiredAt"), "没跑过也要显式给出该键,免得前端分不清「没跑」与「字段缺失」");
        assertNull(b.get("lastFiredAt"));
    }

    @Test
    void viewKeepsTaskDefinitionFieldsIntact(@TempDir Path dir) {
        AutomationStore s = store(dir);
        s.saveTasks(List.of(task("a", "甲")));
        Map<String, Object> a = s.loadTasksForView().get(0);
        assertEquals("甲", a.get("name"));
        assertEquals("p", a.get("prompt"));
        assertEquals(Boolean.TRUE, a.get("enabled"));
        assertEquals("/w", a.get("workspace"));
    }

    /** 合并只发生在视图层:定义文件本身不许被 lastFiredAt 污染(它归 state 文件所有)。 */
    @Test
    void definitionFileStaysFreeOfLastFiredAt(@TempDir Path dir) throws Exception {
        AutomationStore s = store(dir);
        s.saveTasks(List.of(task("a", "甲")));
        s.setLastFiredAt("a", 123456789L);
        s.loadTasksForView();
        String defs = Files.readString(dir.resolve("automations.json"));
        assertTrue(!defs.contains("lastFiredAt"), "定义文件被写进了运行态字段:" + defs);
    }
}
