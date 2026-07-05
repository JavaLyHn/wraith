package com.lyhn.wraith.llm;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class GenericOpenAiClientTest {
    @Test void exposesConfiguredIdentityAndUrl() {
        GenericOpenAiClient c = new GenericOpenAiClient("sk-x", "gpt-4o", "https://api.openai.com/v1", "openai");
        assertEquals("gpt-4o", c.getModelName());
        assertEquals("openai", c.getProviderName());
    }
    @Test void appendsChatCompletionsToBaseUrl() {
        // baseUrl 带或不带尾斜杠都拼成 .../chat/completions
        assertEquals("https://x.ai/v1/chat/completions",
                GenericOpenAiClient.joinChatCompletions("https://x.ai/v1"));
        assertEquals("https://x.ai/v1/chat/completions",
                GenericOpenAiClient.joinChatCompletions("https://x.ai/v1/"));
    }
    @Test void defaultsModelToEmptySafeWhenBlank() {
        GenericOpenAiClient c = new GenericOpenAiClient("k", "  ", "https://h/v1", "p");
        assertEquals("", c.getModelName());  // 空 model 不崩(catalog 应保证非空,这里只求不 NPE)
    }
}
