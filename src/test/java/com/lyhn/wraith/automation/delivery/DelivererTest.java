package com.lyhn.wraith.automation.delivery;

import com.lyhn.wraith.automation.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class DelivererTest {
    static class Fake implements DeliveryAdapter {
        final String p; final List<String> got = new ArrayList<>();
        Fake(String p){this.p=p;}
        public String platform(){return p;}
        public void deliver(DeliveryTarget t, AutomationTask task, AutomationRunner.RunResult r){ got.add(r.answer()); }
    }
    private AutomationTask task(String... platforms) {
        AutomationTask t = new AutomationTask(); t.name="x"; t.deliverTo = new ArrayList<>();
        for (String p : platforms){ DeliveryTarget d=new DeliveryTarget(); d.platform=p; t.deliverTo.add(d); }
        return t;
    }

    @Test void dispatchesToMatchingAdapters() {
        Fake qq=new Fake("qq"), desk=new Fake("desktop");
        Deliverer d = new Deliverer(List.of(qq, desk));
        d.deliver(task("qq","desktop"), new AutomationRunner.RunResult("success","报告","s",List.of()));
        assertEquals(List.of("报告"), qq.got);
        assertEquals(List.of("报告"), desk.got);
    }

    @Test void emptyAnswerSuppressesDelivery() {
        Fake qq=new Fake("qq");
        new Deliverer(List.of(qq)).deliver(task("qq"),
                new AutomationRunner.RunResult("success","   ","s",List.of()));
        assertTrue(qq.got.isEmpty(), "空回复应抑制投递");
    }

    @Test void emptyDeliverToIsNoop() {
        Fake qq=new Fake("qq");
        new Deliverer(List.of(qq)).deliver(task(), new AutomationRunner.RunResult("success","x","s",List.of()));
        assertTrue(qq.got.isEmpty());
    }

    @Test void unknownPlatformSkipped() {
        Fake qq=new Fake("qq");
        new Deliverer(List.of(qq)).deliver(task("telegram"),
                new AutomationRunner.RunResult("success","x","s",List.of()));
        assertTrue(qq.got.isEmpty());   // 无 telegram adapter → 跳过,不抛
    }
}
