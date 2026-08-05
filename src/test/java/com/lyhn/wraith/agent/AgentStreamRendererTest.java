package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentStreamRendererTest {

    @Test
    void shouldNotPrintEmptyReasoningHeadingBeforeTextIsFlushable() throws Exception {
        LlmClient.StreamListener renderer = newStreamRenderer();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream originalOut = System.out;
        try {
            System.setOut(new PrintStream(output, true, StandardCharsets.UTF_8));

            renderer.onReasoningDelta("继续查看 src 目录下的包结构");
            String afterDelta = output.toString(StandardCharsets.UTF_8);
            assertFalse(afterDelta.contains("思考过程"),
                    "没有完整行时不应先打印空的思考标题: " + afterDelta);

            invokeNoArg(renderer, "resetBetweenIterations");
        } finally {
            System.setOut(originalOut);
        }

        String rendered = output.toString(StandardCharsets.UTF_8);
        assertTrue(rendered.contains("思考过程"));
        assertTrue(rendered.contains("继续查看 src 目录下的包结构"));
    }

    /**
     * 用户实测：CLI 上「发完消息直接卡了」，而桌面端同一条消息没事。
     *
     * <p>根因是这条路只看「有没有换行」：reasoning 模型常常先吐一大段<b>不带换行</b>的思考，
     * 正文迟迟不来，于是整段全堆在缓冲里、屏幕上一个字都没有 —— 看起来就是卡死。
     * 桌面端不中招是因为 {@code EventStreamRenderer.supportsThinkingPanel()} 硬编码 true，
     * 走的是 appendThinking 那条即时显示的路。
     */
    @Test
    void longReasoningWithoutLineBreakMustStillBeFlushed() throws Exception {
        LlmClient.StreamListener renderer = newStreamRenderer();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream originalOut = System.out;
        // 200 字符、**一个换行都没有** —— 正是 reasoning 模型的常见形态
        String longNoBreak = "先看仓库结构再定位实现文件然后读关键类的方法签名".repeat(9);
        try {
            System.setOut(new PrintStream(output, true, StandardCharsets.UTF_8));
            renderer.onReasoningDelta(longNoBreak);
        } finally {
            System.setOut(originalOut);
        }
        String rendered = output.toString(StandardCharsets.UTF_8);
        assertTrue(longNoBreak.length() > 120, "前提:这段要超过 flush 门槛");
        assertTrue(rendered.contains("思考过程"),
                "攒够一行的量就必须冲出去,否则屏幕上一个字都没有: " + rendered);
        assertTrue(rendered.contains("先看仓库结构"),
                "标题出来了但内容还堆在 markdown 渲染器里 —— 那是第二层「吞掉」: " + rendered);
    }

    @Test
    void shortReasoningWithoutLineBreakStillWaits() throws Exception {
        // 上面那条修的是「无限期吞掉」,但**短 reasoning 继续等**这个原意图必须保住 ——
        // 先打一个「思考过程」标题再打三五个字很突兀。
        LlmClient.StreamListener renderer = newStreamRenderer();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream originalOut = System.out;
        try {
            System.setOut(new PrintStream(output, true, StandardCharsets.UTF_8));
            renderer.onReasoningDelta("短思考");
        } finally {
            System.setOut(originalOut);
        }
        assertFalse(output.toString(StandardCharsets.UTF_8).contains("思考过程"),
                "短且无换行时不该先打标题");
    }

    @Test
    void shouldIgnoreWhitespaceOnlyReasoningAcrossIterationReset() throws Exception {
        LlmClient.StreamListener renderer = newStreamRenderer();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream originalOut = System.out;
        try {
            System.setOut(new PrintStream(output, true, StandardCharsets.UTF_8));
            renderer.onReasoningDelta("  \n");
            invokeNoArg(renderer, "resetBetweenIterations");
        } finally {
            System.setOut(originalOut);
        }

        String rendered = output.toString(StandardCharsets.UTF_8);
        assertFalse(rendered.contains("思考过程"),
                "空白 reasoning 不应打印空的思考标题: " + rendered);
    }

    @Test
    void shouldPrintReasoningHeadingOnlyOnceAcrossToolIterations() throws Exception {
        LlmClient.StreamListener renderer = newStreamRenderer();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream originalOut = System.out;
        try {
            System.setOut(new PrintStream(output, true, StandardCharsets.UTF_8));
            renderer.onReasoningDelta("我先查找 ROADMAP.md。\n");
            invokeNoArg(renderer, "resetBetweenIterations");
            renderer.onReasoningDelta("已经读到内容，接下来总结给用户。\n");
            invokeNoArg(renderer, "finish");
        } finally {
            System.setOut(originalOut);
        }

        String rendered = output.toString(StandardCharsets.UTF_8);
        assertTrue(rendered.contains("我先查找 ROADMAP.md。"));
        assertTrue(rendered.contains("已经读到内容，接下来总结给用户。"));
        assertTrue(rendered.contains("思考过程"));
        assertTrue(countOccurrences(rendered, "思考过程") == 1,
                "同一次 ReAct 运行中工具调用前后的 reasoning 应归到同一个思考区: " + rendered);
    }

    @Test
    void inlineThinkingPanelReceivesReasoningInsteadOfTranscriptHeading() throws Exception {
        ThinkingRenderer thinkingRenderer = new ThinkingRenderer();
        LlmClient.StreamListener renderer = newStreamRenderer(thinkingRenderer);

        invokeNoArg(renderer, "beginThinking");
        renderer.onReasoningDelta("我先判断用户意图。\n");
        renderer.onContentDelta("好的");
        invokeNoArg(renderer, "finish");

        String transcript = thinkingRenderer.transcript();
        assertTrue(thinkingRenderer.started);
        assertTrue(thinkingRenderer.ended);
        assertTrue(thinkingRenderer.thinking().contains("我先判断用户意图。"));
        assertFalse(transcript.contains("思考过程"), transcript);
        assertTrue(transcript.contains("Thinking..."), transcript);
        assertTrue(transcript.contains("│ 我先判断用户意图。"), transcript);
        assertFalse(transcript.contains("π 回复"), transcript);
        assertTrue(transcript.contains("好的"), transcript);
    }

    private LlmClient.StreamListener newStreamRenderer() throws Exception {
        Class<?> rendererClass = Class.forName("com.lyhn.wraith.agent.Agent$StreamRenderer");
        Constructor<?> constructor = rendererClass.getDeclaredConstructor();
        constructor.setAccessible(true);
        return (LlmClient.StreamListener) constructor.newInstance();
    }

    private LlmClient.StreamListener newStreamRenderer(Renderer renderer) throws Exception {
        Class<?> rendererClass = Class.forName("com.lyhn.wraith.agent.Agent$StreamRenderer");
        Constructor<?> constructor = rendererClass.getDeclaredConstructor(Renderer.class);
        constructor.setAccessible(true);
        return (LlmClient.StreamListener) constructor.newInstance(renderer);
    }

    private void invokeNoArg(Object target, String methodName) throws Exception {
        Method method = target.getClass().getDeclaredMethod(methodName);
        method.setAccessible(true);
        method.invoke(target);
    }

    private int countOccurrences(String text, String needle) {
        int count = 0;
        int index = 0;
        while ((index = text.indexOf(needle, index)) >= 0) {
            count++;
            index += needle.length();
        }
        return count;
    }

    private static final class ThinkingRenderer implements Renderer {
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private final StringBuilder thinking = new StringBuilder();
        private final PrintStream stream = new PrintStream(output, true, StandardCharsets.UTF_8);
        private boolean started;
        private boolean ended;

        @Override
        public void start() {
        }

        @Override
        public boolean supportsThinkingPanel() {
            return true;
        }

        @Override
        public void beginThinking(String label) {
            started = true;
        }

        @Override
        public void appendThinking(String delta) {
            thinking.append(delta);
        }

        @Override
        public void endThinking() {
            ended = true;
        }

        @Override
        public PrintStream stream() {
            return stream;
        }

        @Override
        public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {
        }

        @Override
        public void appendDiff(String filePath, String before, String after) {
        }

        @Override
        public void updateStatus(StatusInfo status) {
        }

        @Override
        public ApprovalResult promptApproval(ApprovalRequest request) {
            return ApprovalResult.reject("test");
        }

        @Override
        public int openPalette(String title, List<String> items) {
            return -1;
        }

        @Override
        public void close() {
            stream.close();
        }

        private String transcript() {
            return output.toString(StandardCharsets.UTF_8);
        }

        private String thinking() {
            return thinking.toString();
        }
    }
}
