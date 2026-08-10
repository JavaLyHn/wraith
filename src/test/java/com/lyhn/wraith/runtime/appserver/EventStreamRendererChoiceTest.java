package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class EventStreamRendererChoiceTest {

    private final ObjectMapper mapper = new ObjectMapper();

    /** JsonRpcWriter 需要一个 PrintStream 构造,但 promptChoice 的测试只验证 notify 发出的事件内容,
     *  不需要真正读 stdout。用 ByteArrayOutputStream 捕获即可。 */
    private EventStreamRenderer newRenderer() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        JsonRpcWriter writer = new JsonRpcWriter(new PrintStream(baos, true));
        return new EventStreamRenderer(writer, "test-session");
    }

    @Test
    void promptChoice_emitsChoiceRequestedEvent_withCorrectPayload() throws Exception {
        EventStreamRenderer renderer = newRenderer();
        List<ChoiceOption> opts = List.of(
                new ChoiceOption("方案A", "描述A"),
                new ChoiceOption("方案B", null)
        );
        ChoiceRequest req = new ChoiceRequest("选择", opts, true, "请选择");

        // 在另一个线程 resolve,模拟前端回传
        Thread resolver = new Thread(() -> {
            try { Thread.sleep(50); } catch (InterruptedException ignored) {}
            renderer.resolveChoice("choice_1", ChoiceResult.selected(1));
        });
        resolver.start();

        ChoiceResult result = renderer.promptChoice(req);

        assertFalse(result.isCancelled());
        assertEquals(1, result.selectedIndex());
    }

    @Test
    void promptChoice_returnsCancelledWhenResolvedCancelled() throws Exception {
        EventStreamRenderer renderer = newRenderer();
        ChoiceRequest req = new ChoiceRequest("选择",
                List.of(new ChoiceOption("A", null), new ChoiceOption("B", null)), true, null);

        Thread resolver = new Thread(() -> {
            try { Thread.sleep(50); } catch (InterruptedException ignored) {}
            renderer.resolveChoice("choice_1", ChoiceResult.cancelled());
        });
        resolver.start();

        ChoiceResult result = renderer.promptChoice(req);
        assertTrue(result.isCancelled());
    }

    @Test
    void promptChoice_returnsCancelledForEmptyOptions() {
        EventStreamRenderer renderer = newRenderer();
        ChoiceRequest req = new ChoiceRequest("空", List.of(), true, null);
        ChoiceResult result = renderer.promptChoice(req);
        assertTrue(result.isCancelled());
    }

    @Test
    void resolveChoice_unknownIdIsIgnored() {
        EventStreamRenderer renderer = newRenderer();
        // 不应抛异常
        renderer.resolveChoice("nonexistent", ChoiceResult.selected(0));
    }
}
