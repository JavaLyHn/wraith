package com.lyhn.wraith.plan;

import com.lyhn.wraith.agent.ConversationDigest;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PlannerContextInjectionTest {

    private static final class RecordingClient implements LlmClient {
        List<Message> firstMessages = null;

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) {
            if (firstMessages == null) firstMessages = new ArrayList<>(messages);
            listener.finish();
            return new ChatResponse("assistant", "not-json", null, 1, 1);
        }

        @Override
        public String getModelName() { return "stub"; }

        @Override
        public String getProviderName() { return "stub"; }
    }

    // 足够复杂以绕开 isSimpleGoal 的 goal（含"然后"/"最后"等多步线索）
    private static final String GOAL = "克隆仓库然后读取 pom.xml 最后验证项目结构并生成报告";

    private static String userText(RecordingClient c) {
        LlmClient.Message last = c.firstMessages.get(c.firstMessages.size() - 1);
        return last.content();
    }

    @Test
    void contextInjected_whenSupplierNonBlank() {
        RecordingClient c = new RecordingClient();
        Planner p = new Planner(c);
        p.setConversationContextSupplier(() -> "用户: 克隆仓库\n助手: 已完成");
        try { p.createPlan(GOAL); } catch (Exception ignored) { }
        String user = userText(c);
        assertTrue(user.startsWith(ConversationDigest.INJECT_PREFIX), user);
        assertTrue(user.endsWith("请为以下任务制定执行计划：\n" + GOAL), user);
    }

    @Test
    void byteIdentical_whenNoSupplier() {
        RecordingClient c = new RecordingClient();
        Planner p = new Planner(c);
        try { p.createPlan(GOAL); } catch (Exception ignored) { }
        assertEquals("请为以下任务制定执行计划：\n" + GOAL, userText(c));
    }
}
