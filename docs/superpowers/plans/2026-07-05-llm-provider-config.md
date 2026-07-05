# 桌面 LLM Provider 配置栏 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面新增"Provider 配置"面板,内置仿照 openhanako 完整目录的 provider 列表(带 `@lobehub/icons` 官方头像),支持挑选→填 Key/选 model/改 baseURL→保存·设默认·删除;后端泛化为"通用 OpenAI-兼容 + Anthropic 原生"客户端按协议路由。

**Architecture:** 保留现有 6 个 bespoke 客户端(零回归);`LlmClientFactory` 的 `default` 分支按 config 的 `protocol` 建 `GenericOpenAiClient`(openai)或 `AnthropicClient`(anthropic)。config 每个 provider 存 `protocol`;面板经新 RPC `config.setProvider/removeProvider` 写 config.json(绝不回传 key)。catalog 是 TS 单一真源(逐个抓 openhanako 录入)。

**Tech Stack:** Java 17 / OkHttp / Jackson / JUnit5;Electron + React + TS / Vitest / `@lobehub/icons`。

## Global Constraints

- **偏离 spec §4(已获准再确认)**:不退役现有 bespoke 客户端(`GLMClient/DeepSeekClient/StepClient/KimiClient/FreeLlmApiClient/XfyunMaaSClient` 全保留);`default` 分支才用通用/Anthropic。`normalizeProvider` 已桥接 openhanako 别名(moonshot→kimi、stepfun→step、xfyun-maas→xfyun 等)。
- **安全铁律**:API Key 只存 `~/.wraith/config.json`,绝不进日志、绝不入库、**任何 RPC 回包绝不含 key 明文**(沿用 `ModelCatalog` 只报 `hasKey`)。
- 门禁:Java `mvn -DskipTests=false test` 0F/0E;桌面 `npm run typecheck` + `npx vitest run` 全绿。
- 每 commit 前:`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀)。
- commit trailer 两行:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 分支:`feat/llm-provider-config`(已建,spec 已提交)。
- `LlmClient` 契约(所有新客户端须实现):`ChatResponse chat(List<Message>, List<Tool>)`、`ChatResponse chat(List<Message>, List<Tool>, StreamListener)`、`String getModelName()`、`String getProviderName()`;类型 `Message(role,content,reasoningContent,toolCalls,toolCallId,contentParts)`、`ToolCall(id, Function(name,arguments))`、`Tool(name,description,JsonNode parameters)`、`ChatResponse(role,content,reasoningContent,toolCalls,inputTokens,outputTokens,cachedInputTokens)`、`StreamListener{onReasoningDelta,onContentDelta}`。

---

### Task 1: GenericOpenAiClient(可配置的薄 OpenAI-兼容客户端)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/llm/GenericOpenAiClient.java`
- Test: `src/test/java/com/lyhn/wraith/llm/GenericOpenAiClientTest.java`

**Interfaces:**
- Produces: `new GenericOpenAiClient(String apiKey, String model, String baseUrl, String providerId)`;`baseUrl` 是 API 根(如 `https://api.openai.com/v1`),内部拼 `/chat/completions`。

- [ ] **Step 1: 写失败测试**

`GenericOpenAiClientTest.java`:
```java
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=GenericOpenAiClientTest test`
Expected: 编译失败(类不存在)。

- [ ] **Step 3: 实现**

参照 `DeepSeekClient` 的薄子类写法。`GenericOpenAiClient.java`:
```java
package com.lyhn.wraith.llm;

/** 可配置的 OpenAI-兼容客户端:baseUrl+model+key+providerId 由 config/catalog 提供。
 *  覆盖 openhanako 目录里 defaultApi=openai-completions 的所有 provider。 */
public class GenericOpenAiClient extends AbstractOpenAiCompatibleClient {

    private final String apiKey;
    private final String model;
    private final String apiUrl;      // 完整 /chat/completions
    private final String providerId;

    public GenericOpenAiClient(String apiKey, String model, String baseUrl, String providerId) {
        this.apiKey = apiKey;
        this.model = model != null ? model.trim() : "";
        this.apiUrl = joinChatCompletions(baseUrl);
        this.providerId = providerId != null && !providerId.isBlank() ? providerId : "openai-compatible";
    }

    /** baseUrl(API 根)→ 拼 /chat/completions;去重尾斜杠。若已含 chat/completions 则原样返回。 */
    static String joinChatCompletions(String baseUrl) {
        String b = (baseUrl == null || baseUrl.isBlank()) ? "https://api.openai.com/v1" : baseUrl.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (b.endsWith("/chat/completions")) return b;
        return b + "/chat/completions";
    }

    @Override protected String getApiUrl() { return apiUrl; }
    @Override protected String getModel()  { return model; }
    @Override protected String getApiKey() { return apiKey; }

    @Override public String getModelName()    { return model; }
    @Override public String getProviderName() { return providerId; }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=GenericOpenAiClientTest test`
Expected: `Tests run: 3, Failures: 0, Errors: 0`

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/llm/GenericOpenAiClient.java src/test/java/com/lyhn/wraith/llm/GenericOpenAiClientTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"   # 仅命中测试金丝雀 sk-x
git commit -m "feat(llm): GenericOpenAiClient(可配置 OpenAI-兼容客户端)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 2: AnthropicClient(anthropic-messages 协议)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/llm/AnthropicClient.java`
- Test: `src/test/java/com/lyhn/wraith/llm/AnthropicClientTest.java`

**Interfaces:**
- Produces: `new AnthropicClient(String apiKey, String model, String baseUrl)`(baseUrl 根,默认 `https://api.anthropic.com`,请求打 `{baseUrl}/v1/messages`);实现 `LlmClient`。

**Context:** Anthropic 不兼容 OpenAI,须直接实现 `LlmClient`。协议要点:端点 `POST {baseUrl}/v1/messages`;头 `x-api-key: <key>`、`anthropic-version: 2023-06-01`、`content-type: application/json`;请求体 `{model, max_tokens, system?, messages:[...], tools?:[...]}`;`system` 是顶层字段(不在 messages 里);`messages` 每条 `{role:"user"|"assistant", content: <string 或 block 数组>}`;工具结果用 user 消息里的 `tool_result` block;assistant 的工具调用是 `tool_use` block。响应 `{content:[{type:"text",text}|{type:"tool_use",id,name,input}], usage:{input_tokens,output_tokens}, stop_reason}`。

**实现策略(v1)**:`chat(messages, tools)` 走**阻塞**请求 + 完整翻译;`chat(messages, tools, listener)` 复用阻塞实现,拿到结果后 `listener.onContentDelta(fullText)` 一次性吐出(原生 SSE 流式留作后续)。用 `AbstractOpenAiCompatibleClient.SHARED_HTTP_CLIENT` 复用连接池(它是 protected static)。

- [ ] **Step 1: 写失败测试(用一个 stub 覆盖 HTTP,只验翻译)**

把请求体构造 / 响应解析拆成**可单测的静态纯函数**,测它们(不打真网):

`AnthropicClientTest.java`:
```java
package com.lyhn.wraith.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AnthropicClientTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void buildRequestExtractsSystemAndMapsMessages() throws Exception {
        var msgs = List.of(
            LlmClient.Message.system("你是助手"),
            LlmClient.Message.user("你好"),
            LlmClient.Message.assistant("在"));
        ObjectNode body = AnthropicClient.buildRequestBody(M, "claude-x", 8192, msgs, List.of());
        assertEquals("claude-x", body.get("model").asText());
        assertEquals("你是助手", body.get("system").asText());          // system 提到顶层
        assertEquals(2, body.get("messages").size());                    // system 不在 messages
        assertEquals("user", body.get("messages").get(0).get("role").asText());
        assertEquals("assistant", body.get("messages").get(1).get("role").asText());
    }

    @Test void buildRequestMapsToolsToAnthropicSchema() throws Exception {
        JsonNode params = M.readTree("{\"type\":\"object\",\"properties\":{}}");
        var tools = List.of(new LlmClient.Tool("read_file", "读文件", params));
        ObjectNode body = AnthropicClient.buildRequestBody(M, "m", 8192, List.of(LlmClient.Message.user("hi")), tools);
        JsonNode t0 = body.get("tools").get(0);
        assertEquals("read_file", t0.get("name").asText());
        assertEquals("读文件", t0.get("description").asText());
        assertTrue(t0.has("input_schema"));                              // anthropic 用 input_schema
    }

    @Test void parseResponseExtractsTextToolCallsUsage() throws Exception {
        JsonNode resp = M.readTree("""
          {"content":[{"type":"text","text":"结果"},
                      {"type":"tool_use","id":"tu_1","name":"read_file","input":{"path":"a"}}],
           "usage":{"input_tokens":10,"output_tokens":5}}""");
        LlmClient.ChatResponse r = AnthropicClient.parseResponse(M, resp);
        assertEquals("结果", r.content());
        assertTrue(r.hasToolCalls());
        assertEquals("read_file", r.toolCalls().get(0).function().name());
        assertEquals("{\"path\":\"a\"}", r.toolCalls().get(0).function().arguments());
        assertEquals(10, r.inputTokens());
        assertEquals(5, r.outputTokens());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=AnthropicClientTest test`
Expected: 编译失败(类/静态方法不存在)。

- [ ] **Step 3: 实现**

`AnthropicClient.java`(HTTP 用 OkHttp,静态纯函数供测试;工具调用参数 arguments 存 JSON 字符串,与 OpenAI 侧一致):
```java
package com.lyhn.wraith.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.*;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Anthropic messages 协议客户端。v1:阻塞请求;流式 = 阻塞后一次性吐 content。 */
public class AnthropicClient implements LlmClient {
    private static final ObjectMapper M = new ObjectMapper();
    private static final MediaType JSON = MediaType.get("application/json");
    private static final String DEFAULT_BASE = "https://api.anthropic.com";
    private static final String VERSION = "2023-06-01";

    private final String apiKey, model, messagesUrl;

    public AnthropicClient(String apiKey, String model, String baseUrl) {
        this.apiKey = apiKey;
        this.model = model != null ? model.trim() : "";
        String b = (baseUrl == null || baseUrl.isBlank()) ? DEFAULT_BASE : baseUrl.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        this.messagesUrl = b.endsWith("/v1/messages") ? b : b + "/v1/messages";
    }

    @Override public String getModelName()    { return model; }
    @Override public String getProviderName() { return "anthropic"; }

    @Override public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
        ObjectNode body = buildRequestBody(M, model, 8192, messages, tools);
        Request req = new Request.Builder().url(messagesUrl)
                .header("x-api-key", apiKey)
                .header("anthropic-version", VERSION)
                .post(RequestBody.create(M.writeValueAsString(body), JSON))
                .build();
        try (Response resp = AbstractOpenAiCompatibleClient.SHARED_HTTP_CLIENT.newCall(req).execute()) {
            String s = resp.body() != null ? resp.body().string() : "";
            if (!resp.isSuccessful()) throw new IOException("Anthropic " + resp.code() + ": " + s);
            return parseResponse(M, M.readTree(s));
        }
    }

    @Override public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
        ChatResponse r = chat(messages, tools);           // v1:阻塞
        if (listener != null && r.content() != null && !r.content().isEmpty())
            listener.onContentDelta(r.content());         // 一次性吐出
        return r;
    }

    // ---- 可单测的纯函数 ----

    /** 构造 anthropic 请求体:system 提顶层,其余映射 messages;tools→input_schema。 */
    static ObjectNode buildRequestBody(ObjectMapper m, String model, int maxTokens,
                                       List<Message> messages, List<Tool> tools) {
        ObjectNode body = m.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        StringBuilder sys = new StringBuilder();
        ArrayNode msgs = body.putArray("messages");
        for (Message msg : messages) {
            if ("system".equals(msg.role())) {
                if (msg.content() != null) { if (sys.length() > 0) sys.append("\n\n"); sys.append(msg.content()); }
                continue;
            }
            ObjectNode mm = msgs.addObject();
            if ("tool".equals(msg.role())) {
                // 工具结果 → user 消息里的 tool_result block
                mm.put("role", "user");
                ArrayNode content = mm.putArray("content");
                ObjectNode tr = content.addObject();
                tr.put("type", "tool_result");
                tr.put("tool_use_id", msg.toolCallId() != null ? msg.toolCallId() : "");
                tr.put("content", msg.content() != null ? msg.content() : "");
                continue;
            }
            mm.put("role", "assistant".equals(msg.role()) ? "assistant" : "user");
            if (msg.toolCalls() != null && !msg.toolCalls().isEmpty()) {
                // assistant 带工具调用 → text block(可选) + tool_use blocks
                ArrayNode content = mm.putArray("content");
                if (msg.content() != null && !msg.content().isBlank()) {
                    ObjectNode tb = content.addObject(); tb.put("type", "text"); tb.put("text", msg.content());
                }
                for (ToolCall tc : msg.toolCalls()) {
                    ObjectNode tu = content.addObject();
                    tu.put("type", "tool_use");
                    tu.put("id", tc.id());
                    tu.put("name", tc.function().name());
                    try { tu.set("input", m.readTree(tc.function().arguments() == null || tc.function().arguments().isBlank()
                            ? "{}" : tc.function().arguments())); }
                    catch (Exception e) { tu.set("input", m.createObjectNode()); }
                }
            } else {
                mm.put("content", msg.content() != null ? msg.content() : "");
            }
        }
        if (sys.length() > 0) body.put("system", sys.toString());
        if (tools != null && !tools.isEmpty()) {
            ArrayNode ts = body.putArray("tools");
            for (Tool t : tools) {
                ObjectNode to = ts.addObject();
                to.put("name", t.name());
                if (t.description() != null) to.put("description", t.description());
                to.set("input_schema", t.parameters() != null ? t.parameters() : m.createObjectNode());
            }
        }
        return body;
    }

    /** 解析 anthropic 响应:text block 拼 content;tool_use → ToolCall(arguments=JSON 串)。 */
    static ChatResponse parseResponse(ObjectMapper m, JsonNode resp) {
        StringBuilder text = new StringBuilder();
        List<ToolCall> calls = new ArrayList<>();
        JsonNode content = resp.get("content");
        if (content != null && content.isArray()) {
            for (JsonNode block : content) {
                String type = block.path("type").asText();
                if ("text".equals(type)) text.append(block.path("text").asText());
                else if ("tool_use".equals(type)) {
                    String args = block.has("input") ? block.get("input").toString() : "{}";
                    calls.add(new ToolCall(block.path("id").asText(),
                            new ToolCall.Function(block.path("name").asText(), args)));
                }
            }
        }
        int in = resp.path("usage").path("input_tokens").asInt(0);
        int out = resp.path("usage").path("output_tokens").asInt(0);
        return new ChatResponse("assistant", text.toString(), calls, in, out);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=AnthropicClientTest test`
Expected: `Tests run: 3, Failures: 0, Errors: 0`。若 `ChatResponse` 4-参构造签名不符,按 Global Constraints 里的实际构造调整(`(role,content,toolCalls,inputTokens,outputTokens)`)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/llm/AnthropicClient.java src/test/java/com/lyhn/wraith/llm/AnthropicClientTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(llm): AnthropicClient(anthropic-messages 协议,阻塞+工具翻译)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 3: ProviderConfig.protocol 字段 + WraithConfig.getProtocol

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`
- Test: `src/test/java/com/lyhn/wraith/config/ProviderProtocolTest.java`

**Interfaces:**
- Produces: `ProviderConfig.getProtocol()/setProtocol(String)`(默认 null);`WraithConfig.getProtocol(String provider)`(config>缺省 `"openai"`)。

- [ ] **Step 1: 写失败测试**

`ProviderProtocolTest.java`:
```java
package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ProviderProtocolTest {
    private final ObjectMapper M = new ObjectMapper();

    @Test void protocolRoundTripsAndDefaultsToOpenai() throws Exception {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig();
        pc.setApiKey("k"); pc.setProtocol("anthropic");
        cfg.getProviders().put("anthropic", pc);
        String json = M.writeValueAsString(cfg);
        WraithConfig back = M.readValue(json, WraithConfig.class);
        assertEquals("anthropic", back.getProviders().get("anthropic").getProtocol());
        assertEquals("anthropic", back.getProtocol("anthropic"));
        assertEquals("openai", back.getProtocol("nonexistent"));   // 缺省 openai
    }

    @Test void legacyEntryWithoutProtocolReadsAsOpenai() throws Exception {
        // 旧 config(无 protocol 字段)
        String legacy = "{\"defaultProvider\":\"deepseek\",\"providers\":{\"deepseek\":{\"apiKey\":\"k\",\"model\":\"m\"}}}";
        WraithConfig cfg = M.readValue(legacy, WraithConfig.class);
        assertNull(cfg.getProviders().get("deepseek").getProtocol());
        assertEquals("openai", cfg.getProtocol("deepseek"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=ProviderProtocolTest test`
Expected: 编译失败(无 getProtocol/setProtocol)。

- [ ] **Step 3: 实现**

在 `WraithConfig.ProviderConfig`(有 `@JsonIgnoreProperties(ignoreUnknown=true)`,旧 config 兼容)加字段 + 存取:
```java
    private String protocol;   // "openai" | "anthropic";null=按缺省(openai)
    public String getProtocol() { return protocol; }
    public void setProtocol(String protocol) { this.protocol = protocol; }
```
在 `WraithConfig` 顶层加(与 getApiKey 同风格):
```java
    /** provider 的协议:config 有则用,否则缺省 "openai"。 */
    public String getProtocol(String provider) {
        ProviderConfig pc = providers.get(provider);
        if (pc != null && pc.getProtocol() != null && !pc.getProtocol().isBlank())
            return pc.getProtocol();
        return "openai";
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=ProviderProtocolTest test`
Expected: `Tests run: 2, Failures: 0, Errors: 0`

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/config/WraithConfig.java src/test/java/com/lyhn/wraith/config/ProviderProtocolTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(config): ProviderConfig.protocol + WraithConfig.getProtocol(缺省 openai,旧条目兼容)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 4: LlmClientFactory 按协议路由(default 分支建通用/Anthropic)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java`
- Test: `src/test/java/com/lyhn/wraith/llm/LlmClientFactoryRoutingTest.java`

**Interfaces:**
- Consumes: Task 1 `GenericOpenAiClient`、Task 2 `AnthropicClient`、Task 3 `WraithConfig.getProtocol`。
- Produces: `create(id, config)` 对既有 6 id 仍返 bespoke;其余有 key 时按 `protocol` 返 `GenericOpenAiClient`(openai)/`AnthropicClient`(anthropic);无 key 返 null。

- [ ] **Step 1: 写失败测试**

`LlmClientFactoryRoutingTest.java`:
```java
package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LlmClientFactoryRoutingTest {
    private WraithConfig cfgWith(String id, String protocol, String baseUrl) {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig();
        pc.setApiKey("sk-test"); pc.setModel("m"); pc.setBaseUrl(baseUrl);
        if (protocol != null) pc.setProtocol(protocol);
        cfg.getProviders().put(id, pc);
        return cfg;
    }

    @Test void bespokeProvidersStillReturnTheirClient() {
        assertTrue(LlmClientFactory.create("deepseek", cfgWith("deepseek", null, null)) instanceof DeepSeekClient);
        assertTrue(LlmClientFactory.create("glm", cfgWith("glm", null, null)) instanceof GLMClient);
    }
    @Test void newOpenaiProviderRoutesToGeneric() {
        LlmClient c = LlmClientFactory.create("openrouter", cfgWith("openrouter", "openai", "https://openrouter.ai/api/v1"));
        assertTrue(c instanceof GenericOpenAiClient);
        assertEquals("openrouter", c.getProviderName());
    }
    @Test void anthropicProviderRoutesToAnthropicClient() {
        LlmClient c = LlmClientFactory.create("anthropic", cfgWith("anthropic", "anthropic", "https://api.anthropic.com"));
        assertTrue(c instanceof AnthropicClient);
    }
    @Test void openhanakoAliasStillBridgesToBespoke() {
        // moonshot→kimi(normalizeProvider),仍走 bespoke KimiClient
        assertTrue(LlmClientFactory.create("moonshot", cfgWith("moonshot", null, null)) instanceof KimiClient);
    }
    @Test void unknownProviderWithoutKeyReturnsNull() {
        assertNull(LlmClientFactory.create("openai", new WraithConfig()));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=LlmClientFactoryRoutingTest test`
Expected: `newOpenaiProviderRoutesToGeneric`/`anthropicProviderRoutesToAnthropicClient` 失败(default 现返 null)。

- [ ] **Step 3: 实现**

把 `create(...)` 的 `switch` `default` 分支从 `-> null` 改为按协议构造(其余 case 不动):
```java
        return switch (normalized) {
            case "glm"        -> new GLMClient(apiKey, model);
            case "deepseek"   -> new DeepSeekClient(apiKey, model);
            case "step"       -> new StepClient(apiKey, model, baseUrl);
            case "kimi"       -> new KimiClient(apiKey, model, baseUrl);
            case "freellmapi" -> new FreeLlmApiClient(apiKey, model, baseUrl);
            case "xfyun"      -> new XfyunMaaSClient(apiKey, model, baseUrl, loraId);
            default           -> {
                String protocol = config.getProtocol(configuredProvider);  // 用 configured(未 normalize)id 取协议
                if ("anthropic".equalsIgnoreCase(protocol)) {
                    yield new AnthropicClient(apiKey, model, baseUrl);
                }
                yield new GenericOpenAiClient(apiKey, model, baseUrl, configuredProvider);
            }
        };
```
（`configuredProvider` 已在方法上部定义 = `provider.trim().toLowerCase()`;`baseUrl`/`model`/`loraId`/`apiKey` 均已就绪。协议按**配置里的 id**取,catalog 写入时 id 与 protocol 对应。）

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=LlmClientFactoryRoutingTest test`
Expected: `Tests run: 5, Failures: 0, Errors: 0`

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java src/test/java/com/lyhn/wraith/llm/LlmClientFactoryRoutingTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(llm): LlmClientFactory default 分支按协议建通用/Anthropic 客户端(既有 6 bespoke 不动)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 5: config.setProvider / removeProvider RPC + ModelCatalog 报全部已配置 provider

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(SessionRunner 接口 + dispatch)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(匿名 SessionRunner 实现)
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java`(providers 报 KNOWN ∪ config keys)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerProviderConfigTest.java`

**Interfaces:**
- Produces(SessionRunner 默认方法):`Map<String,Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol)`、`Map<String,Object> configRemoveProvider(String id)`(默认 throw UnsupportedOperationException)。
- Produces(RPC):`config.setProvider {id, apiKey, model?, baseUrl?, protocol?}` → `{ok:true}`;`config.removeProvider {id}` → `{ok:true}`。缺 id → -32602。
- Produces:`model.list` 的 providers 现含所有 config 里配置过的 provider(不止 KNOWN 6 个)。

- [ ] **Step 1: 写失败测试(端到端 + 断言无 apiKey 回传)**

`AppServerProviderConfigTest.java`(骨架仿 `AppServerAutomationsTest`/`AppServerSessionOpsTest` 的 `run(...)`,SessionRunner 用真实 `WraithConfig` + 临时 `wraith.config.dir`——若无该属性钩子,则用一个内存 WraithConfig 注入 SessionRunner 匿名类,直接实现 configSetProvider/removeProvider/modelList 委托到它):
```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerProviderConfigTest {
    private List<JsonNode> run(WraithConfig cfg, String... requests) throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String,Object> modelList() {
                return ModelCatalog.result(cfg, "deepseek", "m", false);
            }
            public Map<String,Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
                WraithConfig.ProviderConfig pc = cfg.getProviders().getOrDefault(id, new WraithConfig.ProviderConfig());
                if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);
                if (model != null) pc.setModel(model);
                if (baseUrl != null) pc.setBaseUrl(baseUrl);
                if (protocol != null) pc.setProtocol(protocol);
                cfg.getProviders().put(id, pc);
                return Map.of("ok", true);
            }
            public Map<String,Object> configRemoveProvider(String id) {
                cfg.getProviders().remove(id); return Map.of("ok", true);
            }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String r : requests) lines.add(r.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }
    private JsonNode byId(List<JsonNode> r, int id) {
        return r.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    @Test void setProviderThenListShowsItWithoutKey() throws Exception {
        WraithConfig cfg = new WraithConfig();
        List<JsonNode> r = run(cfg,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.setProvider\",\"params\":{\"id\":\"openai\",\"apiKey\":\"sk-secret\",\"model\":\"gpt-4o\",\"baseUrl\":\"https://api.openai.com/v1\",\"protocol\":\"openai\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"model.list\",\"params\":{}}");
        assertTrue(byId(r,2).path("result").path("ok").asBoolean());
        // model.list 里出现 openai 且标 hasKey,且【全响应文本不含 apiKey 明文】
        String all = r.toString();
        assertTrue(all.contains("openai"));
        assertFalse(all.contains("sk-secret"), "回包绝不能含 apiKey 明文");
    }
    @Test void removeProviderDropsIt() throws Exception {
        WraithConfig cfg = new WraithConfig();
        cfg.getProviders().put("openai", new WraithConfig.ProviderConfig("k","u","m"));
        List<JsonNode> r = run(cfg,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.removeProvider\",\"params\":{\"id\":\"openai\"}}");
        assertTrue(byId(r,2).path("result").path("ok").asBoolean());
        assertFalse(cfg.getProviders().containsKey("openai"));
    }
    @Test void missingIdIsParamError() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.setProvider\",\"params\":{\"apiKey\":\"k\"}}");
        assertEquals(-32602, byId(r,2).path("error").path("code").asInt());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=AppServerProviderConfigTest test`
Expected: 失败(dispatch 无 config.setProvider/removeProvider;ModelCatalog 可能不含 openai)。

- [ ] **Step 3: SessionRunner 接口加两默认方法**（AppServer.java,`configSetDefaultProvider` 附近)
```java
        default java.util.Map<String, Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
            throw new UnsupportedOperationException("configSetProvider not implemented");
        }
        default java.util.Map<String, Object> configRemoveProvider(String id) {
            throw new UnsupportedOperationException("configRemoveProvider not implemented");
        }
```

- [ ] **Step 4: dispatch 加两 case**（仿 `config.setDefaultProvider`）
```java
            case "config.setProvider" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String id = textParam(p, "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                String apiKey = p.hasNonNull("apiKey") ? p.get("apiKey").asText() : null;
                String model = p.hasNonNull("model") ? p.get("model").asText() : null;
                String baseUrl = p.hasNonNull("baseUrl") ? p.get("baseUrl").asText() : null;
                String protocol = p.hasNonNull("protocol") ? p.get("protocol").asText() : null;
                try { writer.result(msg.id(), session.configSetProvider(id, apiKey, model, baseUrl, protocol)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "config.removeProvider" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                String id = textParam(msg.params(), "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                try { writer.result(msg.id(), session.configRemoveProvider(id)); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 5: Main.java 匿名 SessionRunner 实现两方法**（`configSetDefaultProvider` 附近;写 config.json）
```java
                    public java.util.Map<String, Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
                        com.lyhn.wraith.config.WraithConfig.ProviderConfig pc =
                            config.getProviders().getOrDefault(id, new com.lyhn.wraith.config.WraithConfig.ProviderConfig());
                        if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);   // 空=不改现有 key
                        if (model != null) pc.setModel(model);
                        if (baseUrl != null) pc.setBaseUrl(baseUrl);
                        if (protocol != null) pc.setProtocol(protocol);
                        config.getProviders().put(id, pc);
                        config.save();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> configRemoveProvider(String id) {
                        config.getProviders().remove(id);
                        if (id.equals(config.getDefaultProvider())) {
                            // 回落到下一个有 key 的 provider(否则保留原值)
                            for (var e : config.getProviders().entrySet())
                                if (e.getValue() != null && e.getValue().getApiKey() != null && !e.getValue().getApiKey().isBlank()) {
                                    config.setDefaultProvider(e.getKey()); break;
                                }
                        }
                        config.save();
                        return java.util.Map.of("ok", true);
                    }
```

- [ ] **Step 6: ModelCatalog 报全部已配置 provider**

把 `providers(WraithConfig)` 的遍历集合从 `KNOWN_PROVIDERS` 改为 `KNOWN_PROVIDERS ∪ config.getProviders().keySet()`(去重、保持 KNOWN 在前),其余(name/model/hasKey)逻辑不变。示意:
```java
    public static List<Map<String, Object>> providers(WraithConfig config) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>(java.util.Arrays.asList(KNOWN_PROVIDERS));
        ids.addAll(config.getProviders().keySet());
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (String id : ids) {
            String model = config.getModel(id);
            boolean hasKey = config.getApiKey(id) != null && !config.getApiKey(id).isBlank();
            out.add(new java.util.LinkedHashMap<>(Map.of(
                "name", id, "model", model != null ? model : "", "hasKey", hasKey)));   // 绝不放 apiKey
        }
        return out;
    }
```

- [ ] **Step 7: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=AppServerProviderConfigTest,AppServerAutomationsTest test`
Expected: 全通过,0F/0E。

- [ ] **Step 8: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerProviderConfigTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(appserver): config.setProvider/removeProvider RPC + model.list 报全部已配置 provider(不回传 key)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 6: preload + IPC 暴露 setProvider/removeProvider + TS 类型

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/shared/types.ts`(ProviderView 加可选 protocol/baseUrl?——仅 UI 需要;不含 key)

**Interfaces:**
- Consumes: Task 5 RPC。
- Produces(window.wraith):`setProvider(p: { id: string; apiKey: string; model?: string; baseUrl?: string; protocol?: string }): Promise<{ok:boolean}>`、`removeProvider(id: string): Promise<{ok:boolean}>`。

- [ ] **Step 1: preload 接口 + 实现**（`setDefaultProvider` 附近)
```ts
  // 接口区(与 setDefaultProvider 相邻)
  setProvider(p: { id: string; apiKey: string; model?: string; baseUrl?: string; protocol?: string }): Promise<{ ok: boolean }>
  removeProvider(id: string): Promise<{ ok: boolean }>
```
```ts
  // 实现区
  setProvider(p) {
    return ipcRenderer.invoke('wraith:setProvider', p) as Promise<{ ok: boolean }>
  },
  removeProvider(id) {
    return ipcRenderer.invoke('wraith:removeProvider', id) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 2: main IPC handler**（`wraith:setDefaultProvider` 附近）
```ts
ipcMain.handle('wraith:setProvider', async (_e, p: { id: string; apiKey: string; model?: string; baseUrl?: string; protocol?: string }) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.setProvider', p)
})
ipcMain.handle('wraith:removeProvider', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.removeProvider', { id })
})
```

- [ ] **Step 3: typecheck**

Run: `cd desktop && npm run typecheck`
Expected: 通过(无输出)。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts desktop/src/shared/types.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(desktop): preload+IPC 暴露 setProvider/removeProvider" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 7: PROVIDER_CATALOG(逐个抓 openhanako 录入)+ @lobehub/icons 依赖

**Files:**
- Modify: `desktop/package.json`(加依赖 `@lobehub/icons`)
- Create: `desktop/src/shared/providerCatalog.ts`
- Test: `desktop/test/providerCatalog.test.ts`

**Interfaces:**
- Produces: `PROVIDER_CATALOG: ProviderCatalogEntry[]`;`ProviderCatalogEntry = { id, displayName, protocol:'openai'|'anthropic', defaultBaseUrl, suggestedModels: string[], consoleUrl?, aliases?: string[], builtin?: boolean, lobeIcon?: string }`;辅助 `findCatalogEntry(id): ProviderCatalogEntry | undefined`(按 id 或 alias 命中)。

- [ ] **Step 1: 采集数据**（这是一步数据录入,方法明确、非占位）

对以下每个 openhanako provider,抓 `https://raw.githubusercontent.com/liliMozi/openhanako/main/lib/providers/<name>.ts` 读 `defaultBaseUrl` + `defaultApi`(→ protocol:`anthropic-messages`=anthropic,否则 openai)+ `displayName`;`suggestedModels` 取自已知的 `lib/default-models.json`(每 provider 的 model 列表)。已确认值:deepseek=`https://api.deepseek.com`(openai)、openai=`https://api.openai.com/v1`(openai)、anthropic=`https://api.anthropic.com`(anthropic)、zhipu=`https://open.bigmodel.cn/api/paas/v4`(openai)。
provider 名单(去重规则见下):`agnes, anthropic, baichuan, baidu-cloud, dashscope, dashscope-coding, deepseek, fireworks, gemini, groq, hunyuan, infini, kimi-coding, minimax, mistral, mimo, modelscope, moonshot, openai, openrouter, perplexity, siliconflow, stepfun, together, volcengine, volcengine-coding, xai, zhipu, zhipu-coding`。
- 去重:`minimax-token-plan`、`mimo-token-plan` 并入 `minimax`/`mimo`(不建条目)。
- canonical id 例外:GLM 用 Wraith 的 `glm`(alias `zhipu`),其余用 openhanako id;`kimi`/`step` 作 `moonshot`/`stepfun` 的 alias(catalog 条目 id 用 `moonshot`/`stepfun`,aliases 含 kimi/step)。
- 补 Wraith 独有:`freellmapi`(openai,builtin,baseUrl 取现有默认)、`xfyun`(openai,builtin)。
- `lobeIcon`:每条给 `@lobehub/icons` 的组件名(见 Task 8),不确定的留空由 Task 8 回落。
- `consoleUrl`:人工整理(如 openai=`https://platform.openai.com/api-keys`、deepseek=`https://platform.deepseek.com`、anthropic=`https://console.anthropic.com`、zhipu=`https://open.bigmodel.cn`…),不确定的留空。

- [ ] **Step 2: 写失败测试**

`desktop/test/providerCatalog.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PROVIDER_CATALOG, findCatalogEntry } from '../src/shared/providerCatalog'

describe('PROVIDER_CATALOG', () => {
  it('每条 id 唯一,defaultBaseUrl 非空,protocol 合法', () => {
    const ids = new Set<string>()
    for (const e of PROVIDER_CATALOG) {
      expect(ids.has(e.id)).toBe(false); ids.add(e.id)
      expect(e.defaultBaseUrl.length).toBeGreaterThan(0)
      expect(['openai', 'anthropic']).toContain(e.protocol)
      expect(e.suggestedModels.length).toBeGreaterThan(0)
    }
  })
  it('别名不与任何 id 冲突,且可反查', () => {
    const ids = new Set(PROVIDER_CATALOG.map(e => e.id))
    for (const e of PROVIDER_CATALOG)
      for (const a of e.aliases ?? []) expect(ids.has(a)).toBe(false)
    expect(findCatalogEntry('zhipu')?.id).toBe('glm')       // alias 反查
    expect(findCatalogEntry('anthropic')?.protocol).toBe('anthropic')
    expect(findCatalogEntry('不存在')).toBeUndefined()
  })
  it('含 Anthropic 且协议正确、含 Wraith 独有 builtin', () => {
    expect(findCatalogEntry('anthropic')).toBeTruthy()
    expect(PROVIDER_CATALOG.some(e => e.builtin && e.id === 'xfyun')).toBe(true)
  })
})
```

- [ ] **Step 3: 加依赖**

Run: `cd desktop && npm install @lobehub/icons`
Expected: package.json + lock 更新。

- [ ] **Step 4: 实现 catalog**

`desktop/src/shared/providerCatalog.ts`(用 Step 1 采集的数据填全 ~26+ 条;下面是结构 + 4 个已确认样例,其余按同结构补齐):
```ts
export interface ProviderCatalogEntry {
  id: string
  displayName: string
  protocol: 'openai' | 'anthropic'
  defaultBaseUrl: string
  suggestedModels: string[]
  consoleUrl?: string
  aliases?: string[]
  builtin?: boolean
  lobeIcon?: string
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'openai', displayName: 'OpenAI', protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1', suggestedModels: ['gpt-4o', 'o3', 'o3-mini'],
    consoleUrl: 'https://platform.openai.com/api-keys', lobeIcon: 'OpenAI' },
  { id: 'anthropic', displayName: 'Anthropic', protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com', suggestedModels: ['claude-opus-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    consoleUrl: 'https://console.anthropic.com', lobeIcon: 'Anthropic' },
  { id: 'deepseek', displayName: 'DeepSeek', protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com', suggestedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    consoleUrl: 'https://platform.deepseek.com', lobeIcon: 'DeepSeek' },
  { id: 'glm', displayName: '智谱 GLM', protocol: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', suggestedModels: ['glm-5.2', 'glm-5', 'glm-4-flash'],
    consoleUrl: 'https://open.bigmodel.cn', aliases: ['zhipu'], lobeIcon: 'Zhipu' },
  // …其余按 Step 1 采集补齐:gemini, moonshot(aliases:[kimi]), dashscope, minimax, hunyuan,
  //   baichuan, xai, mistral, groq, perplexity, together, fireworks, openrouter, ollama,
  //   siliconflow, stepfun(aliases:[step]), modelscope, baidu-cloud, volcengine, dashscope-coding,
  //   zhipu-coding, kimi-coding, volcengine-coding, agnes, infini, mimo …
  { id: 'freellmapi', displayName: 'FreeLLMAPI', protocol: 'openai',
    defaultBaseUrl: 'https://api.free-llm.top/v1', suggestedModels: ['auto'], builtin: true },
  { id: 'xfyun', displayName: '讯飞 MaaS', protocol: 'openai',
    defaultBaseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v1', suggestedModels: ['Qwen3.6-35B-A3B'], builtin: true },
  // 注:custom(自定义 OpenAI 兼容)不进 PROVIDER_CATALOG —— 由 ProvidersPanel 底部单列,
  //     避免 catalog 出现空 defaultBaseUrl 破坏 Step 2 断言。
]

const BY_KEY = new Map<string, ProviderCatalogEntry>()
for (const e of PROVIDER_CATALOG) {
  BY_KEY.set(e.id, e)
  for (const a of e.aliases ?? []) BY_KEY.set(a, e)
}
export function findCatalogEntry(idOrAlias: string): ProviderCatalogEntry | undefined {
  return BY_KEY.get(idOrAlias)
}
```
> 注:`custom` 条目的 `defaultBaseUrl`/`suggestedModels` 为空,Step 2 测试对全表断言"defaultBaseUrl 非空/models 非空"——因此把 `custom` 从这两条断言里排除(测试里 `filter(e => e.id !== 'custom')`),或不把 custom 放进 PROVIDER_CATALOG 而在面板单独渲染。**实现选后者:custom 不进 PROVIDER_CATALOG,面板底部单列**,保持 catalog 全为真实 provider,测试无需特例。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/providerCatalog.test.ts && npm run typecheck`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add desktop/package.json desktop/package-lock.json desktop/src/shared/providerCatalog.ts desktop/test/providerCatalog.test.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(desktop): PROVIDER_CATALOG(仿 openhanako 全量)+ @lobehub/icons 依赖" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 8: ProviderIcon 组件(@lobehub/icons + 回落)

**Files:**
- Create: `desktop/src/renderer/components/ProviderIcon.tsx`
- Test: `desktop/test/providerIcon.test.tsx`(纯逻辑:回落判定抽成纯函数测)

**Interfaces:**
- Consumes: Task 7 catalog(`lobeIcon`)。
- Produces: `<ProviderIcon id={string} size?={number} />`;纯函数 `resolveIconKind(id): { kind: 'lobe'; name: string } | { kind: 'fallback'; letter: string }`。

- [ ] **Step 1: 写失败测试**

`desktop/test/providerIcon.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { resolveIconKind } from '../src/renderer/components/ProviderIcon'

describe('resolveIconKind', () => {
  it('已知 lobeIcon → lobe', () => {
    expect(resolveIconKind('openai')).toEqual({ kind: 'lobe', name: 'OpenAI' })
  })
  it('alias 命中 → 用 canonical 的 lobeIcon', () => {
    expect(resolveIconKind('zhipu')).toEqual({ kind: 'lobe', name: 'Zhipu' })
  })
  it('无 lobeIcon/未知 → 回落首字母', () => {
    expect(resolveIconKind('xfyun')).toEqual({ kind: 'fallback', letter: '讯' })   // displayName 首字
    expect(resolveIconKind('不存在-provider')).toEqual({ kind: 'fallback', letter: '不' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/providerIcon.test.tsx`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`desktop/src/renderer/components/ProviderIcon.tsx`:
```tsx
import { findCatalogEntry } from '../../shared/providerCatalog'
import * as LobeIcons from '@lobehub/icons'

export type IconKind = { kind: 'lobe'; name: string } | { kind: 'fallback'; letter: string }

/** 决定用 lobehub 图标还是回落首字母(纯函数,可测)。 */
export function resolveIconKind(id: string): IconKind {
  const e = findCatalogEntry(id)
  if (e?.lobeIcon) return { kind: 'lobe', name: e.lobeIcon }
  const label = e?.displayName || id
  return { kind: 'fallback', letter: [...label][0] ?? '?' }
}

export default function ProviderIcon({ id, size = 20 }: { id: string; size?: number }): JSX.Element {
  const k = resolveIconKind(id)
  if (k.kind === 'lobe') {
    const Comp = (LobeIcons as Record<string, any>)[k.name]?.Color ?? (LobeIcons as Record<string, any>)[k.name]
    if (Comp) return <Comp size={size} />
  }
  const letter = k.kind === 'fallback' ? k.letter : (findCatalogEntry(id)?.displayName?.[0] ?? '?')
  return (
    <span style={{ width: size, height: size }}
      className="inline-flex items-center justify-center rounded-full bg-surface text-[10px] text-fg-muted">
      {letter}
    </span>
  )
}
```
> `@lobehub/icons` 的具体导出名以实际包为准;`lobeIcon` 字段填的就是这些导出名。找不到导出时自动回落(上面 `Comp` 为空即回落),不会崩。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `cd desktop && npx vitest run test/providerIcon.test.tsx && npm run typecheck`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/components/ProviderIcon.tsx desktop/test/providerIcon.test.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(desktop): ProviderIcon(@lobehub/icons + 首字母回落)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 9: nav 接线(view 加 'providers' + Sidebar 按钮 + App 面板占位)

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`

**Interfaces:**
- Produces:`view` 联合含 `'providers'`;Sidebar 新增 `onOpenProviders: () => void` prop + `nav-providers` 按钮;`activeNav` 联合含 `'providers'`。

- [ ] **Step 1: 改 view 联合 + Sidebar 接线 + 占位面板**

`App.tsx`:
```tsx
// 1) view 类型
const [view, setView] = useState<'chat' | 'plugins' | 'automations' | 'im-gateway' | 'providers'>('chat')
```
```tsx
// 2) <Sidebar> 加 prop
  onOpenProviders={() => setView('providers')}
```
```tsx
// 3) 面板条件渲染链里加一支(ProvidersPanel 由 Task 10 实现;本任务先占位)
) : view === 'providers' ? (
  <ProvidersPanel onBack={() => setView('chat')} />
) : (
```
本任务先建一个最小占位 `ProvidersPanel`(Task 10 填内容),使编译通过:
```tsx
// desktop/src/renderer/components/ProvidersPanel.tsx(占位,Task 10 覆盖)
export default function ProvidersPanel({ onBack }: { onBack: () => void }): JSX.Element {
  return <div className="p-4 text-xs text-fg-muted"><button onClick={onBack}>← 返回</button> Provider 配置(建设中)</div>
}
```
并在 App.tsx `import ProvidersPanel from './components/ProvidersPanel'`。

`Sidebar.tsx`:
```tsx
// SidebarProps
  activeNav: 'plugins' | 'automations' | 'im-gateway' | 'providers' | null
  onOpenProviders: () => void
```
```tsx
// 解构参数加 onOpenProviders
```
```tsx
// nav 区,IM 网关按钮之后加
  <button data-testid="nav-providers" onClick={onOpenProviders}
    className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
      (activeNav === 'providers' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
    Provider 配置
  </button>
```
`App.tsx` 传给 Sidebar 的 `activeNav={view === 'chat' ? null : view}` 无需改(view 已含 providers)。

- [ ] **Step 2: typecheck + vitest**

Run: `cd desktop && npm run typecheck && npx vitest run`
Expected: 全绿(占位面板可编译)。

- [ ] **Step 3: 提交**

```bash
git add desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/components/ProvidersPanel.tsx
git commit -m "feat(desktop): 侧边栏新增 Provider 配置 nav + 面板占位接线" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

### Task 10: ProvidersPanel(catalog 列表 + 头像 + 搜索 + 配置表单)

**Files:**
- Modify: `desktop/src/renderer/components/ProvidersPanel.tsx`(覆盖占位)
- Modify: `desktop/test/e2e/shell.e2e.ts`(加一条面板可见性 e2e)

**Interfaces:**
- Consumes: Task 6 preload(`setProvider`/`removeProvider`/`modelList`/`setDefaultProvider`)、Task 7 catalog、Task 8 `ProviderIcon`。

- [ ] **Step 1: 实现面板**

`ProvidersPanel.tsx`(要点:进入时 `modelList()` 拿 configured 状态;catalog 渲染成"已配置"组 + "全部"组;选中/编辑弹表单;保存调 `setProvider`,删除调 `removeProvider`,设默认调 `setDefaultProvider`;底部单列"自定义"。key 输入用 `type="password"`,编辑态留空=不改):
```tsx
import { useEffect, useState } from 'react'
import { PROVIDER_CATALOG, findCatalogEntry } from '../../shared/providerCatalog'
import ProviderIcon from './ProviderIcon'
import type { ModelListResult } from '../../shared/types'

export default function ProvidersPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [data, setData] = useState<ModelListResult | null>(null)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)      // provider id in edit form
  const [form, setForm] = useState({ apiKey: '', model: '', baseUrl: '', protocol: 'openai' as 'openai' | 'anthropic' })
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => { try { setData(await window.wraith.modelList()) } catch { /* ignore */ } }
  useEffect(() => { void refresh() }, [])

  const configured = new Map((data?.providers ?? []).map(p => [p.name, p]))
  const defaultId = data?.default

  const openEdit = (id: string): void => {
    const e = findCatalogEntry(id)
    setForm({ apiKey: '', model: configured.get(id)?.model || e?.suggestedModels[0] || '',
      baseUrl: e?.defaultBaseUrl || '', protocol: e?.protocol || 'openai' })
    setError(null); setEditing(id)
  }
  const save = async (): Promise<void> => {
    if (!editing) return
    try {
      await window.wraith.setProvider({ id: editing, apiKey: form.apiKey, model: form.model, baseUrl: form.baseUrl, protocol: form.protocol })
      setEditing(null); void refresh()
    } catch (err) { setError((err as Error).message) }
  }
  const remove = async (id: string): Promise<void> => { await window.wraith.removeProvider(id); void refresh() }
  const setDefault = async (id: string): Promise<void> => { await window.wraith.setDefaultProvider(id); void refresh() }

  const list = PROVIDER_CATALOG.filter(e =>
    !q || e.displayName.toLowerCase().includes(q.toLowerCase()) || e.id.includes(q.toLowerCase()))
  const done = list.filter(e => configured.get(e.id)?.hasKey)
  const rest = list.filter(e => !configured.get(e.id)?.hasKey)

  const Row = (e: typeof PROVIDER_CATALOG[number]): JSX.Element => (
    <div key={e.id} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface/60">
      <ProviderIcon id={e.id} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-fg">{e.displayName}{defaultId === e.id && <span className="ml-1 text-[10px] text-accent">默认</span>}</div>
        <div className="truncate text-[10px] text-fg-subtle">{configured.get(e.id)?.hasKey ? (configured.get(e.id)?.model || '已配置') : '未配置'}</div>
      </div>
      {configured.get(e.id)?.hasKey && defaultId !== e.id &&
        <button data-testid="provider-setdefault" onClick={() => void setDefault(e.id)} className="text-[10px] text-fg-muted hover:text-accent">设默认</button>}
      <button data-testid="provider-config" onClick={() => openEdit(e.id)} className="text-[11px] text-fg-muted hover:text-accent">{configured.get(e.id)?.hasKey ? '编辑' : '＋配置'}</button>
    </div>
  )

  return (
    <div data-testid="providers-panel" className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <button data-testid="providers-back" onClick={onBack} className="text-xs text-fg-muted">← 返回</button>
        <input data-testid="providers-search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索 provider…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs outline-none focus:border-accent" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {done.length > 0 && <><div className="mt-2 px-2 text-[10px] uppercase tracking-wider text-fg-subtle">已配置</div>{done.map(Row)}</>}
        <div className="mt-3 px-2 text-[10px] uppercase tracking-wider text-fg-subtle">全部</div>
        {rest.map(Row)}
      </div>
      {editing && (() => { const e = findCatalogEntry(editing); return (
        <div className="mt-2 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-fg"><ProviderIcon id={editing} /> {e?.displayName ?? editing}
            {e?.consoleUrl && <a href={e.consoleUrl} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-accent">获取密钥 →</a>}</div>
          <label className="block text-[10px] text-fg-subtle">API Key(留空=不改)
            <input data-testid="provider-apikey" type="password" value={form.apiKey} onChange={ev => setForm({ ...form, apiKey: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          <label className="mt-2 block text-[10px] text-fg-subtle">模型
            <input data-testid="provider-model" list="pm-suggest" value={form.model} onChange={ev => setForm({ ...form, model: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" />
            <datalist id="pm-suggest">{(e?.suggestedModels ?? []).map(m => <option key={m} value={m} />)}</datalist></label>
          <label className="mt-2 block text-[10px] text-fg-subtle">Base URL
            <input data-testid="provider-baseurl" value={form.baseUrl} onChange={ev => setForm({ ...form, baseUrl: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          {error && <div className="mt-2 text-[10px] text-danger">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button data-testid="provider-save" onClick={() => void save()} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white">保存</button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted">取消</button>
            {configured.get(editing)?.hasKey &&
              <button data-testid="provider-remove" onClick={() => { void remove(editing); setEditing(null) }} className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-danger">删除</button>}
          </div>
        </div>
      )})()}
    </div>
  )
}
```
（"自定义"入口:可在"全部"组末尾加一个固定行,点它 `openEdit('custom')` 并允许改 id/baseUrl——v1 可省略,先支持 catalog 内 provider;若加,`custom` 的 setProvider 用用户填的 id。此为可选增强,YAGNI 下先不做,面板注明。)

- [ ] **Step 2: typecheck + vitest**

Run: `cd desktop && npm run typecheck && npx vitest run`
Expected: 全绿(无回归)。

- [ ] **Step 3: e2e(可见性)**

在 `desktop/test/e2e/shell.e2e.ts` 加一条:点 `nav-providers` → `providers-panel` 可见、`providers-search` 存在、catalog 行(如某个 `provider-config` 按钮)可见。若 e2e 环境下 `modelList` 无 mock,则面板仍应渲染 catalog(configured 为空,全在"全部"组)——断言 `providers-panel` + 至少一个 `provider-config` 可见即可;真实 setProvider 往返若 mock-appserver 无 handler 则降级为可见性 + 手动点验,并在报告注明(不写空断言)。

- [ ] **Step 4: 提交**

```bash
git add desktop/src/renderer/components/ProvidersPanel.tsx desktop/test/e2e/shell.e2e.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"
git commit -m "feat(desktop): ProvidersPanel(catalog+头像+搜索+配置表单,key/model/baseURL/获取密钥/设默认/删除)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -m "Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN"
```

---

## 完成后

- 全量门禁:`mvn -DskipTests=false test`(0F/0E)+ `cd desktop && npm run typecheck && npx vitest run`(全绿)。
- 重建 jar + 重装 + (面板)重启 gateway/app-server,重启桌面 app;手动点验:配置一个新 provider(如 OpenAI/Anthropic,填真 key)→ 保存 → 在 ModelSwitcher/新面板看到已配置 → 切换该 provider 发一条消息跑通(Anthropic 验 anthropic 协议);删除 → 回落默认。
- 整支复审(subagent-driven 终审)→ finishing-a-development-branch。

## 分期小结(4 阶段)
- **阶段一(Task 1-4)**:Java 泛化 —— GenericOpenAiClient + AnthropicClient + config.protocol + factory 路由。
- **阶段二(Task 5-6)**:RPC + 桥 —— setProvider/removeProvider + model.list 全量 + preload/IPC(不回传 key)。
- **阶段三(Task 7-8)**:catalog + 头像 —— PROVIDER_CATALOG(抓 openhanako)+ @lobehub/icons + ProviderIcon。
- **阶段四(Task 9-10)**:面板 —— nav 接线 + ProvidersPanel。
