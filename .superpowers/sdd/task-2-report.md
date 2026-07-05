# Task 2 Report: AnthropicClient (anthropic-messages 协议)

## Status
DONE — 3/3 tests pass, committed on `feat/llm-provider-config`.

## Red Phase
`mvn -DskipTests=false -Dtest=AnthropicClientTest test` → compilation failure:
```
找不到符号: 变量 AnthropicClient (x3)
```
Expected result confirmed.

## Green Phase
`mvn -DskipTests=false -Dtest=AnthropicClientTest test` →
```
Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

## Commit
- SHA: `c5afda9`
- Subject: `feat(llm): AnthropicClient(anthropic-messages 协议,阻塞+工具翻译)`

## Signature Verification & Adaptations

### LlmClient.ChatResponse
Brief says `new ChatResponse("assistant", text, calls, in, out)` — confirmed 5-arg constructor exists at LlmClient.java line 196-199:
```java
public ChatResponse(String role, String content, List<ToolCall> toolCalls,
                    int inputTokens, int outputTokens) {
    this(role, content, null, toolCalls, inputTokens, outputTokens, 0);
}
```
No adaptation needed — brief's call matches exactly.

### AbstractOpenAiCompatibleClient.SHARED_HTTP_CLIENT
`protected static` — accessible from `AnthropicClient` because both are in the same package `com.lyhn.wraith.llm`. Reference via `AbstractOpenAiCompatibleClient.SHARED_HTTP_CLIENT` compiles fine without subclassing.

### Other shapes
- `Message.system()`, `Message.user()`, `Message.assistant()` static factories — all present, signatures match.
- `Message` record accessors `role()`, `content()`, `toolCalls()`, `toolCallId()` — all present.
- `ToolCall(String id, Function function)` + `Function(String name, String arguments)` — exact match.
- `Tool(String name, String description, JsonNode parameters)` — exact match.

Zero adaptations required from brief.

## Secret Scan
`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"` returned only field/parameter names (`apiKey`, `x-api-key: apiKey`) — no real secrets in diff.

## Files Created
- `src/main/java/com/lyhn/wraith/llm/AnthropicClient.java`
- `src/test/java/com/lyhn/wraith/llm/AnthropicClientTest.java`

## Concerns
None. `SHARED_HTTP_CLIENT` reuse confirmed working. Native SSE streaming deferred as planned (v1 = blocking + one-shot listener emit).

---

## Fix Section: 合并连续 tool_result + 已知限制注释 (2026-07-05)

### 问题
`buildRequestBody` 对每条 `role:"tool"` 消息都单独创建一条 `user` 消息。当 agent 循环并行调用 ≥2 个工具时，会产生连续多条 `user` 消息，Anthropic Messages API 拒绝此结构并返回 HTTP 400。

### 变更
- `AnthropicClient.java`: 重构 `tool` 分支处理逻辑——在将 `tool` 消息映射为 `tool_result` block 前，先检查 `msgs` 数组末尾是否已存在同轮的 `user/tool_result` 消息；若是，则将新 block 追加到其 `content` 数组而非新建 `user` 消息（`merged` 路径）。单工具场景下行为不变。
- `AnthropicClient.java`: 在类顶部 Javadoc 新增两条 v1 已知限制注释：(a) 多模态 `contentParts` 不转发；(b) `max_tokens` 硬编码 8192。
- `AnthropicClientTest.java`: 新增 `buildRequestCoalescesConsecutiveToolResultsIntoSingleUserMessage` 测试。

### RED（修复前，新测试在原始代码上）
```
[ERROR] Tests run: 4, Failures: 1, Errors: 0, Skipped: 0
[ERROR] buildRequestCoalescesConsecutiveToolResultsIntoSingleUserMessage
  AssertionError: 两条连续 tool 消息应合并为一条 user 消息 ==> expected: <2> but was: <3>
```
（原始代码为每条 tool 消息创建独立 user 消息，共产生 3 条 messages 而非 2 条。）

### GREEN（修复后）
```
[INFO] Tests run: 4, Failures: 0, Errors: 0, Skipped: 0 -- in com.lyhn.wraith.llm.AnthropicClientTest
[INFO] BUILD SUCCESS
```

### Secret Scan
`git diff | grep -iE "api[_-]?key|secret|sk-|Bearer"` → 无输出（仅字段名，无真实密钥）。

### mvn 计数
修复前 3/3 pass；修复后 4/4 pass。
