package com.lyhn.wraith.cli;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.PlainRenderer;
import com.lyhn.wraith.render.Renderer;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link Main#replayConversation} —— 续接会话回放:必须把 user / assistant 正文打到 transcript
 * (修复"选中会话后看不到完整内容"的 bug);system / tool 结果跳过。
 */
class MainReplayConversationTest {

    private String replay(List<LlmClient.Message> msgs) {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PrintStream ui = new PrintStream(baos, true, StandardCharsets.UTF_8);
        Renderer renderer = new PlainRenderer();
        Main.replayConversation(renderer, ui, msgs);
        ui.flush();
        return baos.toString(StandardCharsets.UTF_8);
    }

    @Test
    void rendersUserAndAssistantContent() {
        String out = replay(List.of(
                LlmClient.Message.user("用户问题甲"),
                LlmClient.Message.assistant("助手回答乙")
        ));
        assertTrue(out.contains("用户问题甲"), "应回放用户消息:\n" + out);
        assertTrue(out.contains("助手回答乙"), "应回放助手正文:\n" + out);
    }

    @Test
    void skipsSystemAndToolMessages() {
        String out = replay(List.of(
                LlmClient.Message.system("系统提示丁"),
                LlmClient.Message.user("用户问题甲"),
                LlmClient.Message.assistant("助手回答乙"),
                LlmClient.Message.tool("call-1", "工具结果丙")
        ));
        assertTrue(out.contains("用户问题甲"));
        assertTrue(out.contains("助手回答乙"));
        assertFalse(out.contains("系统提示丁"), "system 不应回放(在 system prompt 内)");
        assertFalse(out.contains("工具结果丙"), "tool 结果不应回放(模型内部上下文)");
    }

    @Test
    void emptyOrNullIsNoop() {
        assertTrue(replay(List.of()).isEmpty());
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Main.replayConversation(new PlainRenderer(), new PrintStream(baos, true, StandardCharsets.UTF_8), null);
        assertTrue(baos.toString(StandardCharsets.UTF_8).isEmpty());
    }
}
