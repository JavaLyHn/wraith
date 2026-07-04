package com.lyhn.wraith.automation;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AutomationRunnerTest {
    @Test void turnEngineContractRunReturnsResult() {
        AutomationRunner.TurnEngine fake = task -> new AutomationRunner.RunResult("success", "pong", "sess1", List.of());
        AutomationTask t = new AutomationTask(); t.id="t"; t.prompt="ping";
        AutomationRunner.RunResult r = fake.run(t);
        assertEquals("success", r.status());
        assertEquals("pong", r.answer());
    }
}
