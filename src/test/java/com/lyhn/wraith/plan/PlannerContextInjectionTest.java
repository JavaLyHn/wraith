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

    // Finding 1 回归锁定：isSimpleGoal 的简单目标（"查看它"），配合 conversationContextSupplier
    // 的两种取值方向，都必须锁死行为，不能只顾一头。

    private static final String SIMPLE_GOAL = "查看它";

    @Test
    void simpleGoal_blankContext_stillUsesFastPath_noLlmCall() throws Exception {
        RecordingClient c = new RecordingClient();
        Planner p = new Planner(c);
        // 不设置 conversationContextSupplier（默认空串）—— 快路径应被采用，LLM 不应被调用
        p.createPlan(SIMPLE_GOAL);
        assertNull(c.firstMessages, "空上下文下的简单目标应走快路径，不应调用 LLM");
    }

    @Test
    void simpleGoal_nonBlankContext_bypassesFastPath_andInjectsContext() {
        RecordingClient c = new RecordingClient();
        Planner p = new Planner(c);
        p.setConversationContextSupplier(() -> "用户: 查看仓库\n助手: 已展示");
        try { p.createPlan(SIMPLE_GOAL); } catch (Exception ignored) { }
        assertNotNull(c.firstMessages, "非空上下文下即使是简单目标，也应绕开快路径走 LLM");
        String user = userText(c);
        assertTrue(user.startsWith(ConversationDigest.INJECT_PREFIX), user);
        assertTrue(user.endsWith("请为以下任务制定执行计划：\n" + SIMPLE_GOAL), user);
    }
}
