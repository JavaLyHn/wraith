package com.lyhn.wraith.automation;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class SchedulerTest {
    @TempDir Path dir;

    private void writeTasks(Path dir, String json) throws Exception {
        Files.write(dir.resolve("automations.json"), json.getBytes());
    }

    @Test void firesDueTaskRunsAndRecords() throws Exception {
        // interval 1 分钟,enabledAt=0 → 下次触发=60_000;clock=60_000 到点。
        writeTasks(dir, "{\"tasks\":[{\"id\":\"t1\",\"name\":\"x\",\"prompt\":\"ping\",\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"INTERVAL\",\"everyMinutes\":1},\"enabled\":true,"
                + "\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},\"createdAt\":0,\"enabledAt\":0}]}");
        AutomationStore store = new AutomationStore(dir);
        CountDownLatch delivered = new CountDownLatch(1);
        List<String> deliveredAnswers = new CopyOnWriteArrayList<>();
        AutomationRunner.TurnEngine engine = t -> new AutomationRunner.RunResult("success", "pong", "s1", List.of());
        Scheduler sch = new Scheduler(store, engine,
                (task, res) -> { deliveredAnswers.add(res.answer()); delivered.countDown(); },
                3, () -> 60_000L);

        sch.decideTick();
        assertTrue(delivered.await(3, TimeUnit.SECONDS), "到点应触发并跑完");
        assertEquals(List.of("pong"), deliveredAnswers);
        assertEquals(60_000L, store.lastFiredAt("t1"));                       // 锚点推进
        assertTrue(store.loadRuns().stream().anyMatch(r -> "success".equals(r.status)));
    }

    @Test void notDueTaskDoesNotFire() throws Exception {
        writeTasks(dir, "{\"tasks\":[{\"id\":\"t1\",\"name\":\"x\",\"prompt\":\"p\",\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"INTERVAL\",\"everyMinutes\":10},\"enabled\":true,"
                + "\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},\"createdAt\":0,\"enabledAt\":0}]}");
        AutomationStore store = new AutomationStore(dir);
        boolean[] fired = {false};
        Scheduler sch = new Scheduler(store, t -> { fired[0]=true; return new AutomationRunner.RunResult("success","","",List.of()); },
                (task,res) -> {}, 3, () -> 30_000L);                          // 30s < 600s 未到点
        sch.decideTick();
        Thread.sleep(100);
        assertFalse(fired[0]);
    }

    @Test void disabledTaskSkipped() throws Exception {
        writeTasks(dir, "{\"tasks\":[{\"id\":\"t1\",\"name\":\"x\",\"prompt\":\"p\",\"workspace\":\"/w\","
                + "\"schedule\":{\"kind\":\"INTERVAL\",\"everyMinutes\":1},\"enabled\":false,"
                + "\"deliverTo\":[],\"approval\":{\"default\":\"deny\"},\"createdAt\":0,\"enabledAt\":0}]}");
        boolean[] fired = {false};
        new Scheduler(new AutomationStore(dir), t -> { fired[0]=true; return null; },
                (a,r)->{}, 3, () -> 60_000L).decideTick();
        Thread.sleep(100);
        assertFalse(fired[0]);
    }
}
