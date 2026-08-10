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
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class AppServerChoiceRespondTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void choiceRespond_resolvesPendingChoice() throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        JsonRpcWriter writer = new JsonRpcWriter(new PrintStream(baos, true));
        EventStreamRenderer renderer = new EventStreamRenderer(writer, "test-session");

        // 启动 promptChoice 阻塞
        List<ChoiceOption> opts = List.of(new ChoiceOption("A", null), new ChoiceOption("B", null));
        ChoiceRequest req = new ChoiceRequest("选", opts, true, null);
        var future = java.util.concurrent.CompletableFuture.supplyAsync(() -> renderer.promptChoice(req));

        // 等待 choice.requested 事件发出,拿到 choiceId
        Thread.sleep(100);
        String output = baos.toString();
        JsonNode notify = mapper.readTree(output.lines().findFirst().orElse("{}"));
        String choiceId = notify.path("params").path("choiceId").asText("");
        assertFalse(choiceId.isBlank(), "应有 choiceId");

        // 模拟 AppServer.handleChoiceRespond 的核心逻辑(直接调 resolveChoice)
        renderer.resolveChoice(choiceId, ChoiceResult.selected(0));

        ChoiceResult result = future.get(2, TimeUnit.SECONDS);
        assertFalse(result.isCancelled());
        assertEquals(0, result.selectedIndex());
    }

    @Test
    void choiceRespond_cancelledResultPropagates() throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        JsonRpcWriter writer = new JsonRpcWriter(new PrintStream(baos, true));
        EventStreamRenderer renderer = new EventStreamRenderer(writer, "test-session");

        List<ChoiceOption> opts = List.of(new ChoiceOption("A", null), new ChoiceOption("B", null));
        ChoiceRequest req = new ChoiceRequest("选", opts, true, null);
        var future = java.util.concurrent.CompletableFuture.supplyAsync(() -> renderer.promptChoice(req));

        Thread.sleep(100);
        String output = baos.toString();
        JsonNode notify = mapper.readTree(output.lines().findFirst().orElse("{}"));
        String choiceId = notify.path("params").path("choiceId").asText("");

        renderer.resolveChoice(choiceId, ChoiceResult.cancelled());

        ChoiceResult result = future.get(2, TimeUnit.SECONDS);
        assertTrue(result.isCancelled());
    }
}
