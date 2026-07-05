# Provider 配置面板三项精修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给已实现的 Provider 配置面板补三项精修:编辑时回填已保存的 baseURL/protocol、一键「测试连接」、freellmapi 可配置多个实例(带可读命名)。

**Architecture:** 后端 `ModelCatalog` 回报非密钥的 baseUrl/protocol/label(修回填根因);新增 `config.testProvider` RPC 走真实 `LlmClientFactory` 客户端发一条极小对话探连通;`ProviderConfig` 加 `label` 字段 + catalog 加 `repeatable` 标记,前端用纯函数铸造实例 id / 生成显示名,freellmapi 常驻"全部"可反复新增。

**Tech Stack:** Java 17 / Maven / JUnit5 / Jackson;Electron + React18 + TypeScript + Vitest;既有 JSON-RPC(AppServer)+ preload/IPC 桥。

## Global Constraints

- 密钥红线:任何 RPC 回包、任何日志**绝不含 apiKey 明文**;`baseUrl`/`protocol`/`label` 均非密钥,可回报。
- 提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 门禁:Java `mvn -DskipTests=false test` 0F/0E;桌面 `npm run typecheck` + `npx vitest run` 全绿;涉及打包时 `npm run build` PASS。
- 分支:`feat/llm-provider-config`(在既有特性上追加,不新开分支)。
- 仅 freellmapi 可重复(catalog `repeatable`),其余 provider 行为不变(YAGNI)。
- 测试连接单测不打真网(blank-key 路径 + 不回显 key);真网成功靠真机眼验。

---

## File Structure

| 层 | 文件 | 职责 |
|---|---|---|
| Java config | `src/main/java/com/lyhn/wraith/config/WraithConfig.java` | ProviderConfig +label 字段 |
| Java catalog | `src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java` | providers 每条回报 baseUrl/protocol/label |
| Java RPC | `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` | SessionRunner +configTestProvider default + 分发 config.testProvider |
| Java 实现 | `src/main/java/com/lyhn/wraith/cli/Main.java` | configTestProvider 生产实现(临时 config + 真实客户端 ping) |
| 桥 | `desktop/src/preload/index.ts`、`desktop/src/main/index.ts` | testProvider / wraith:testProvider;setProvider 参数 +label |
| 共享 | `desktop/src/shared/providerCatalog.ts` | repeatable 标记 + nextInstanceId/instanceDisplayName/baseProviderId 纯函数 |
| 共享类型 | `desktop/src/shared/types.ts` | ProviderView +label? |
| 前端 | `desktop/src/renderer/components/ProvidersPanel.tsx` | 回填 + 测试按钮 + 多实例列表/表单 |

---

## Task 1: ProviderConfig 加 label 字段

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`(内部类 `ProviderConfig`,约 28-59 行)
- Test: `src/test/java/com/lyhn/wraith/config/ProviderConfigLabelTest.java`(新建)

**Interfaces:**
- Produces: `WraithConfig.ProviderConfig.getLabel(): String` / `setLabel(String)`。`label` 为非密钥自定义显示名,可空;旧 config.json 无此字段时反序列化为 null(`@JsonIgnoreProperties(ignoreUnknown=true)` 已在类上)。

- [ ] **Step 1: Write the failing test**

Create `src/test/java/com/lyhn/wraith/config/ProviderConfigLabelTest.java`:

```java
package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ProviderConfigLabelTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void labelRoundTrips() throws Exception {
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig();
        pc.setLabel("工作号");
        String json = MAPPER.writeValueAsString(pc);
        WraithConfig.ProviderConfig back = MAPPER.readValue(json, WraithConfig.ProviderConfig.class);
        assertEquals("工作号", back.getLabel());
    }

    @Test
    void oldConfigWithoutLabelDeserializesToNull() throws Exception {
        // 旧文件:只有 apiKey/model,没有 label
        String legacy = "{\"apiKey\":\"k\",\"model\":\"m\",\"baseUrl\":\"u\"}";
        WraithConfig.ProviderConfig back = MAPPER.readValue(legacy, WraithConfig.ProviderConfig.class);
        assertNull(back.getLabel(), "旧文件无 label → null");
        assertEquals("k", back.getApiKey());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=ProviderConfigLabelTest test`
Expected: 编译失败 `cannot find symbol: method setLabel/getLabel`。

- [ ] **Step 3: Write minimal implementation**

In `WraithConfig.java`, inside `public static class ProviderConfig`, add the field next to `protocol`:

```java
        private String protocol;           // "openai" | "anthropic"; null=按缺省(openai)
        private String label;              // 用户自定义显示名(非密钥;多实例区分用);可空
```

And add getter/setter next to the protocol accessors:

```java
        public String getProtocol() { return protocol; }
        public void setProtocol(String protocol) { this.protocol = protocol; }
        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=ProviderConfigLabelTest test`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/config/WraithConfig.java src/test/java/com/lyhn/wraith/config/ProviderConfigLabelTest.java
git commit -m "feat(provider): ProviderConfig 加非密钥 label 字段(多实例显示名)"
```

---

## Task 2: ModelCatalog 回报 baseUrl/protocol/label(修编辑回填根因)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java`(`providers` 方法,18-33 行)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/ModelCatalogTest.java`(改现有 2 个断言 + 加 1 个新测试)

**Interfaces:**
- Consumes: `WraithConfig.getBaseUrl(id)`、`WraithConfig.getProtocol(id)`(缺省返回 `"openai"`)、`ProviderConfig.getLabel()`(Task 1)。
- Produces: `ModelCatalog.providers(config)` 每条 map 现含 `baseUrl`(String,null→`""`)、`protocol`(String)、`label`(String,null→`""`),仍含 `name/model/hasKey`,**永不含 apiKey**。

> ⚠️ 现有 `ModelCatalogTest.providersNeverExposesApiKeyValue` 与 `resultNeverExposesApiKeyOrBaseUrl` 断言 baseUrl **不出现**(canary `https://CANARY-BASEURL.example.invalid`)。本任务令 baseUrl **要出现**,故这两处断言必须翻转为"baseUrl 出现 / apiKey 仍不出现"。这是刻意的契约变更,不是回归。

- [ ] **Step 1: Update the tests to the new contract (failing)**

In `ModelCatalogTest.java`, replace `providersNeverExposesApiKeyValue` body's baseUrl assertion and rename for clarity:

```java
    @Test
    void providersExposesBaseUrlButNeverApiKey() throws Exception {
        String canaryKey = "FAKE-LEAK-CANARY-APIKEY-9999";
        String canaryBaseUrl = "https://CANARY-BASEURL.example.invalid";
        WraithConfig config = configWithCanary("deepseek", canaryKey, canaryBaseUrl);

        List<Map<String, Object>> providers = ModelCatalog.providers(config);
        String json = MAPPER.writeValueAsString(providers);

        assertFalse(json.contains(canaryKey),
                "providers() 序列化结果不应含 canary apiKey 值: " + canaryKey);
        assertTrue(json.contains(canaryBaseUrl),
                "providers() 现在应回报 baseUrl(非密钥,回填所需): " + canaryBaseUrl);
    }
```

Replace `resultNeverExposesApiKeyOrBaseUrl` similarly:

```java
    @Test
    void resultExposesBaseUrlButNeverApiKey() throws Exception {
        String canaryKey = "FAKE-LEAK-CANARY-APIKEY-9999";
        String canaryBaseUrl = "https://CANARY-BASEURL.example.invalid";
        WraithConfig config = configWithCanary("glm", canaryKey, canaryBaseUrl);
        config.setDefaultProvider("glm");

        Map<String, Object> result = ModelCatalog.result(config, "glm", "glm-4-flash", false);
        String json = MAPPER.writeValueAsString(result);

        assertFalse(json.contains(canaryKey),
                "result() 序列化结果不应含 canary apiKey 值: " + canaryKey);
        assertTrue(json.contains(canaryBaseUrl),
                "result() 现在应回报 baseUrl(非密钥): " + canaryBaseUrl);
    }
```

Add a new test that pins baseUrl/protocol/label reporting:

```java
    @Test
    void providersReportBaseUrlProtocolLabel() {
        WraithConfig config = new WraithConfig();
        WraithConfig.ProviderConfig pc =
                new WraithConfig.ProviderConfig("k", "https://x.example/v1", "m");
        pc.setProtocol("anthropic");
        pc.setLabel("工作号");
        config.getProviders().put("minimax", pc);

        Map<String, Object> entry = ModelCatalog.providers(config).stream()
                .filter(e -> "minimax".equals(e.get("name")))
                .findFirst().orElseThrow();

        assertEquals("https://x.example/v1", entry.get("baseUrl"));
        assertEquals("anthropic", entry.get("protocol"));
        assertEquals("工作号", entry.get("label"));
        assertTrue((Boolean) entry.get("hasKey"));
        assertFalse(entry.containsKey("apiKey"), "entry 绝不含 apiKey 字段");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=ModelCatalogTest test`
Expected: `providersExposesBaseUrlButNeverApiKey` / `resultExposesBaseUrlButNeverApiKey` FAIL(baseUrl 尚未回报,`assertTrue(contains)` 失败);`providersReportBaseUrlProtocolLabel` FAIL(无 baseUrl/protocol/label 键)。

- [ ] **Step 3: Implement — report baseUrl/protocol/label**

In `ModelCatalog.java`, update the loop in `providers(...)` (replace lines 22-31) and the javadoc:

```java
    /**
     * Build the providers list from config.
     * Reports KNOWN_PROVIDERS ∪ config.getProviders().keySet() (KNOWN first, deduped).
     * 每条含 name/model/hasKey/baseUrl/protocol/label。
     * 红线:NEVER includes apiKey value(只报 hasKey);baseUrl/protocol/label 非密钥,回报用于编辑回填与多实例显示。
     */
    public static List<Map<String, Object>> providers(WraithConfig config) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>(java.util.Arrays.asList(KNOWN_PROVIDERS));
        ids.addAll(config.getProviders().keySet());
        List<Map<String, Object>> list = new ArrayList<>();
        for (String p : ids) {
            String apiKey = config.getApiKey(p);
            boolean hasKey = apiKey != null && !apiKey.isBlank();
            String modelName = config.getModel(p);
            String baseUrl = config.getBaseUrl(p);
            WraithConfig.ProviderConfig pc = config.getProviders().get(p);
            String label = pc != null ? pc.getLabel() : null;
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", p);
            entry.put("model", modelName != null ? modelName : "");
            entry.put("hasKey", hasKey);
            entry.put("baseUrl", baseUrl != null ? baseUrl : "");
            entry.put("protocol", config.getProtocol(p));
            entry.put("label", label != null ? label : "");
            list.add(entry);
        }
        return list;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=ModelCatalogTest test`
Expected: PASS(全部,含改动后的 canary + 新增 3 字段测试)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java src/test/java/com/lyhn/wraith/runtime/appserver/ModelCatalogTest.java
git commit -m "fix(provider): ModelCatalog 回报 baseUrl/protocol/label(修编辑回填;apiKey 仍不回传)"
```

---

## Task 3: config.testProvider RPC(真实客户端探连通)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(SessionRunner 接口 ~92 行加 default;分发 ~234 行后加 case)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(SessionRunner 匿名实现,~1290 行 configRemoveProvider 之后)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerProviderConfigTest.java`(加测试双+断言)

**Interfaces:**
- Consumes: `LlmClientFactory.create(id, config)`;`LlmClient.chat(List<Message>, List<Tool>)`;`LlmClient.Message.user(String)`;`LlmClient.getModelName()`。
- Produces: RPC `config.testProvider {id, apiKey?, model?, baseUrl?, protocol?}` → result `{ok:boolean, model?:string, latencyMs?:number, error?:string}`。id 缺失 → JSON-RPC error -32602。回包**绝不含 apiKey**。SessionRunner 新 default 方法 `configTestProvider(String id, String apiKey, String model, String baseUrl, String protocol)`。

- [ ] **Step 1: Write the failing test**

In `AppServerProviderConfigTest.java`, add `configTestProvider` to the anonymous `SessionRunner` in `run(...)` (after `configRemoveProvider`, before the closing `};`):

```java
            public Map<String,Object> configTestProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
                if (apiKey == null || apiKey.isBlank()) return Map.of("ok", false, "error", "缺少 API Key");
                // 模拟连通成功;绝不回显 key
                return Map.of("ok", true, "model", model == null ? "" : model, "latencyMs", 5L);
            }
```

Then add three test methods:

```java
    @Test void testProviderEchoesResultWithoutKey() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.testProvider\",\"params\":{\"id\":\"openai\",\"apiKey\":\"sk-canary-test\",\"model\":\"gpt-4o\"}}");
        JsonNode res = byId(r,2).path("result");
        assertTrue(res.path("ok").asBoolean(), "有 key 时应回 ok:true");
        assertEquals("gpt-4o", res.path("model").asText());
        assertFalse(r.toString().contains("sk-canary-test"), "回包绝不能含 apiKey 明文");
    }
    @Test void testProviderBlankKeyReturnsNotOk() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.testProvider\",\"params\":{\"id\":\"openai\",\"apiKey\":\"\"}}");
        JsonNode res = byId(r,2).path("result");
        assertFalse(res.path("ok").asBoolean());
        assertTrue(res.path("error").asText().contains("API Key"));
    }
    @Test void testProviderMissingIdIsParamError() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.testProvider\",\"params\":{\"apiKey\":\"k\"}}");
        assertEquals(-32602, byId(r,2).path("error").path("code").asInt());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=AppServerProviderConfigTest test`
Expected: 三个新测试 FAIL —— 分发无 `config.testProvider` case,`byId(r,2)` 拿到的是 method-not-found error 或缺 result(`testProviderMissingIdIsParamError` 可能因 method-not-found 返回 -32601 而非 -32602)。

- [ ] **Step 3a: Implement — SessionRunner default method**

In `AppServer.java`, inside `interface SessionRunner`, after `configRemoveProvider` default (line ~92, before the interface's closing `}`), add:

```java
        /**
         * 用给定(表单)参数走真实客户端发一条极小对话探连通。
         * apiKey 为空/null → 沿用已存 key。回包只含 {ok, model?, latencyMs?, error?},绝不含 apiKey。
         * 默认抛出。
         */
        default java.util.Map<String, Object> configTestProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
            throw new UnsupportedOperationException("configTestProvider not implemented");
        }
```

- [ ] **Step 3b: Implement — dispatch case**

In `AppServer.java`, after the `case "config.removeProvider"` block (line ~234), add:

```java
            case "config.testProvider" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String id = textParam(p, "id");
                if (id == null || id.isBlank()) { writer.error(msg.id(), -32602, "缺 id"); return true; }
                String apiKey = p != null && p.hasNonNull("apiKey") ? p.get("apiKey").asText() : null;
                String model = p != null && p.hasNonNull("model") ? p.get("model").asText() : null;
                String baseUrl = p != null && p.hasNonNull("baseUrl") ? p.get("baseUrl").asText() : null;
                String protocol = p != null && p.hasNonNull("protocol") ? p.get("protocol").asText() : null;
                try { writer.result(msg.id(), session.configTestProvider(id, apiKey, model, baseUrl, protocol)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 3c: Implement — production impl in Main.java**

In `Main.java`, inside the anonymous `SessionRunner` (after `configRemoveProvider`, ~1290, before `setSessionStarred`), add:

```java
                    public java.util.Map<String, Object> configTestProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
                        // 用表单值构造临时 config:先继承已存条目,再按传入非空值覆写(apiKey 空=沿用已存)
                        com.lyhn.wraith.config.WraithConfig tmp = new com.lyhn.wraith.config.WraithConfig();
                        com.lyhn.wraith.config.WraithConfig.ProviderConfig existing = config.getProviders().get(id);
                        com.lyhn.wraith.config.WraithConfig.ProviderConfig pc =
                            new com.lyhn.wraith.config.WraithConfig.ProviderConfig();
                        if (existing != null) {
                            pc.setApiKey(existing.getApiKey());
                            pc.setModel(existing.getModel());
                            pc.setBaseUrl(existing.getBaseUrl());
                            pc.setProtocol(existing.getProtocol());
                            pc.setLoraId(existing.getLoraId());
                        }
                        if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);
                        if (model != null && !model.isBlank()) pc.setModel(model);
                        if (baseUrl != null && !baseUrl.isBlank()) pc.setBaseUrl(baseUrl);
                        if (protocol != null && !protocol.isBlank()) pc.setProtocol(protocol);
                        tmp.getProviders().put(id, pc);
                        com.lyhn.wraith.llm.LlmClient probe =
                            com.lyhn.wraith.llm.LlmClientFactory.create(id, tmp);
                        if (probe == null) return java.util.Map.of("ok", false, "error", "缺少 API Key");
                        long t0 = System.nanoTime();
                        try {
                            probe.chat(java.util.List.of(com.lyhn.wraith.llm.LlmClient.Message.user("ping")),
                                       java.util.List.of());
                            long ms = (System.nanoTime() - t0) / 1_000_000L;
                            return java.util.Map.of("ok", true, "model", probe.getModelName(), "latencyMs", ms);
                        } catch (Exception e) {
                            String em = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                            if (em.length() > 300) em = em.substring(0, 300);
                            return java.util.Map.of("ok", false, "error", em);
                        }
                    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=AppServerProviderConfigTest test`
Expected: PASS(原 4 + 新 3 = 7 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerProviderConfigTest.java
git commit -m "feat(provider): config.testProvider RPC(真实客户端 ping 探连通;不回显 key)"
```

---

## Task 4: 桥 — preload/IPC testProvider + setProvider 参数带 label

**Files:**
- Modify: `desktop/src/preload/index.ts`(65 行 setProvider 类型 + 66 行后加 testProvider 声明;280 行 setProvider 实现 + 285 行后加实现)
- Modify: `desktop/src/main/index.ts`(468 行 setProvider handler 类型;476 行后加 wraith:testProvider handler)

**Interfaces:**
- Consumes: 既有 `client.request(method, params)` 桥模式。
- Produces: `window.wraith.testProvider(p: {id; apiKey?; model?; baseUrl?; protocol?}): Promise<{ok:boolean; model?:string; latencyMs?:number; error?:string}>`;`setProvider` 参数增可选 `label?: string`。

- [ ] **Step 1: Update preload type + impl**

In `desktop/src/preload/index.ts`, change the `setProvider` signature (line 65) to include `label?`:

```ts
  setProvider(p: { id: string; apiKey: string; model?: string; baseUrl?: string; protocol?: string; label?: string }): Promise<{ ok: boolean }>
```

Add a `testProvider` declaration right after `removeProvider` (line 66):

```ts
  removeProvider(id: string): Promise<{ ok: boolean }>
  testProvider(p: { id: string; apiKey?: string; model?: string; baseUrl?: string; protocol?: string }): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>
```

Update the `setProvider` implementation (line 280) to the same param type:

```ts
  setProvider(p) {
    return ipcRenderer.invoke('wraith:setProvider', p) as Promise<{ ok: boolean }>
  },
```

(No body change needed — `p` is forwarded whole; only the interface type widened.) Add the `testProvider` implementation right after `removeProvider` (line 285):

```ts
  removeProvider(id) {
    return ipcRenderer.invoke('wraith:removeProvider', id) as Promise<{ ok: boolean }>
  },
  testProvider(p) {
    return ipcRenderer.invoke('wraith:testProvider', p) as Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>
  },
```

- [ ] **Step 2: Update main IPC**

In `desktop/src/main/index.ts`, widen the `wraith:setProvider` handler param (line 468) to include `label?`:

```ts
ipcMain.handle('wraith:setProvider', async (_e, p: { id: string; apiKey: string; model?: string; baseUrl?: string; protocol?: string; label?: string }) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.setProvider', p)
})
```

Add the `wraith:testProvider` handler right after `wraith:removeProvider` (line 476):

```ts
ipcMain.handle('wraith:testProvider', async (_e, p: { id: string; apiKey?: string; model?: string; baseUrl?: string; protocol?: string }) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.testProvider', p)
})
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck`
Expected: 无错误(注意:`config.setProvider` 现会带 `label`,但需 Java 侧 `configSetProvider` 落 label —— 见 Step 4)。

- [ ] **Step 4: Persist label in configSetProvider (Java)**

The bridge now forwards `label`, but `AppServer.dispatch` for `config.setProvider` doesn't parse it and `Main.configSetProvider` doesn't store it. Wire it through:

In `AppServer.java` `case "config.setProvider"` block, parse label and pass to a widened method. To avoid churning the 5-arg signature across all test doubles, parse `label` and set it via the config directly is NOT possible (SessionRunner owns config). Instead, widen `configSetProvider` is heavy. **Simpler, chosen approach:** keep `configSetProvider` 5-arg; parse `label` in dispatch and, when present, call it through a dedicated path. Since that adds a 6th param anyway, widen the signature to 6 args (label last) — the default method + Main impl + the one test double in AppServerProviderConfigTest are the only impls.

4a. `AppServer.java` SessionRunner default (line 82) → add `String label`:

```java
        default java.util.Map<String, Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol, String label) {
            throw new UnsupportedOperationException("configSetProvider not implemented");
        }
```

4b. `AppServer.java` dispatch `case "config.setProvider"` — parse label + pass:

```java
                String protocol = p != null && p.hasNonNull("protocol") ? p.get("protocol").asText() : null;
                String label = p != null && p.hasNonNull("label") ? p.get("label").asText() : null;
                try { writer.result(msg.id(), session.configSetProvider(id, apiKey, model, baseUrl, protocol, label)); }
```

4c. `Main.java` `configSetProvider` → add `String label` param + persist:

```java
                    public java.util.Map<String, Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol, String label) {
                        com.lyhn.wraith.config.WraithConfig.ProviderConfig pc =
                            config.getProviders().getOrDefault(id, new com.lyhn.wraith.config.WraithConfig.ProviderConfig());
                        if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);   // 空=不改现有 key
                        if (model != null) pc.setModel(model);
                        if (baseUrl != null) pc.setBaseUrl(baseUrl);
                        if (protocol != null) pc.setProtocol(protocol);
                        if (label != null) pc.setLabel(label);
                        config.getProviders().put(id, pc);
                        config.save();
                        return java.util.Map.of("ok", true);
                    }
```

4d. `AppServerProviderConfigTest.java` — update the test double's `configSetProvider` to 6 args + persist label (so existing tests still compile & pass):

```java
            public Map<String,Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol, String label) {
                WraithConfig.ProviderConfig pc = cfg.getProviders().getOrDefault(id, new WraithConfig.ProviderConfig());
                if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);
                if (model != null) pc.setModel(model);
                if (baseUrl != null) pc.setBaseUrl(baseUrl);
                if (protocol != null) pc.setProtocol(protocol);
                if (label != null) pc.setLabel(label);
                cfg.getProviders().put(id, pc);
                return Map.of("ok", true);
            }
```

- [ ] **Step 5: Run typecheck + full Java suite for the touched classes**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck`
Expected: PASS.
Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=AppServerProviderConfigTest test`
Expected: PASS(6-arg 变更不破坏既有 setProvider 测试)。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerProviderConfigTest.java
git commit -m "feat(provider): 桥接 testProvider + setProvider 透传 label"
```

---

## Task 5: catalog — repeatable 标记 + 实例纯函数 + ProviderView.label

**Files:**
- Modify: `desktop/src/shared/providerCatalog.ts`(接口 +repeatable;freellmapi +repeatable;文件末尾加 3 个纯函数)
- Modify: `desktop/src/shared/types.ts`(ProviderView +label?)
- Test: `desktop/test/providerCatalog.test.ts`(加实例函数用例)

**Interfaces:**
- Produces:
  - `ProviderCatalogEntry.repeatable?: boolean`;freellmapi `repeatable: true`。
  - `baseProviderId(id: string): string` — 去掉末尾 `-<数字>`(`freellmapi-2`→`freellmapi`;`baidu-cloud`/`zhipu-coding` 等非数字后缀不变)。
  - `nextInstanceId(baseId: string, configuredIds: Set<string>): string` — `baseId` 未占用→返回 `baseId`;否则 `${baseId}-N`,N 从 2 起最小未占用。
  - `instanceDisplayName(id: string, label: string | undefined, entry: ProviderCatalogEntry | undefined): string` — 有 label→`${displayName} · ${label}`;否则 base→`displayName`、`-N`→`${displayName} #N`;entry 缺省→回落 id。
  - `ProviderView.label?: string`。

- [ ] **Step 1: Write the failing tests**

In `desktop/test/providerCatalog.test.ts`, add imports and a new describe block:

```ts
import { PROVIDER_CATALOG, findCatalogEntry, baseProviderId, nextInstanceId, instanceDisplayName } from '../src/shared/providerCatalog'

describe('provider instance helpers', () => {
  it('freellmapi 标记 repeatable', () => {
    expect(findCatalogEntry('freellmapi')?.repeatable).toBe(true)
    expect(findCatalogEntry('openai')?.repeatable).toBeFalsy()
  })
  it('baseProviderId 只剥离末尾数字后缀', () => {
    expect(baseProviderId('freellmapi')).toBe('freellmapi')
    expect(baseProviderId('freellmapi-2')).toBe('freellmapi')
    expect(baseProviderId('freellmapi-13')).toBe('freellmapi')
    expect(baseProviderId('baidu-cloud')).toBe('baidu-cloud')      // 非数字后缀不动
    expect(baseProviderId('zhipu-coding')).toBe('zhipu-coding')
  })
  it('nextInstanceId 首个裸 id,之后取最小空位', () => {
    expect(nextInstanceId('freellmapi', new Set())).toBe('freellmapi')
    expect(nextInstanceId('freellmapi', new Set(['freellmapi']))).toBe('freellmapi-2')
    expect(nextInstanceId('freellmapi', new Set(['freellmapi', 'freellmapi-2']))).toBe('freellmapi-3')
    // 填补空洞:占用 base 与 -3,应回 -2
    expect(nextInstanceId('freellmapi', new Set(['freellmapi', 'freellmapi-3']))).toBe('freellmapi-2')
  })
  it('instanceDisplayName:label 优先,否则 base / #N', () => {
    const e = findCatalogEntry('freellmapi')!
    expect(instanceDisplayName('freellmapi', '工作号', e)).toBe('FreeLLMAPI · 工作号')
    expect(instanceDisplayName('freellmapi', undefined, e)).toBe('FreeLLMAPI')
    expect(instanceDisplayName('freellmapi', '', e)).toBe('FreeLLMAPI')
    expect(instanceDisplayName('freellmapi-2', undefined, e)).toBe('FreeLLMAPI #2')
    expect(instanceDisplayName('freellmapi-2', '备用', e)).toBe('FreeLLMAPI · 备用')
    expect(instanceDisplayName('unknown-x', undefined, undefined)).toBe('unknown-x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/providerCatalog.test.ts`
Expected: FAIL —— `baseProviderId`/`nextInstanceId`/`instanceDisplayName` 未导出;`repeatable` 未定义。

- [ ] **Step 3: Implement**

In `providerCatalog.ts`, add `repeatable?` to the interface (after `builtin?`):

```ts
  builtin?: boolean
  repeatable?: boolean
  lobeIcon?: string
```

Add `repeatable: true` to the freellmapi entry:

```ts
  {
    id: 'freellmapi',
    displayName: 'FreeLLMAPI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.free-llm.top/v1',
    suggestedModels: ['auto'],
    builtin: true,
    repeatable: true,
  },
```

Append the three pure functions at the end of the file (after `findCatalogEntry`):

```ts
/** 去掉实例 id 末尾的 `-<数字>`(freellmapi-2 → freellmapi);非数字后缀(baidu-cloud)保持不变。 */
export function baseProviderId(id: string): string {
  return id.replace(/-\d+$/, '')
}

/** 为可重复 provider 铸造下一个实例 id:base 未占用→base;否则 base-N,N 从 2 起最小未占用。 */
export function nextInstanceId(baseId: string, configuredIds: Set<string>): string {
  if (!configuredIds.has(baseId)) return baseId
  let n = 2
  while (configuredIds.has(`${baseId}-${n}`)) n++
  return `${baseId}-${n}`
}

/** 实例显示名:label 优先 → `名称 · label`;否则 base → 名称、`-N` → `名称 #N`;entry 缺省回落 id。 */
export function instanceDisplayName(
  id: string,
  label: string | undefined,
  entry: ProviderCatalogEntry | undefined,
): string {
  const base = entry?.displayName ?? id
  if (label && label.trim()) return `${base} · ${label.trim()}`
  const m = id.match(/-(\d+)$/)
  return m ? `${base} #${m[1]}` : base
}
```

In `types.ts`, add `label?` to `ProviderView` (after `baseUrl?`):

```ts
export interface ProviderView {
  name: string
  model: string
  hasKey: boolean
  protocol?: string
  baseUrl?: string
  label?: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/providerCatalog.test.ts && npm run typecheck`
Expected: PASS(含新增用例)+ typecheck 无错。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/providerCatalog.ts desktop/src/shared/types.ts desktop/test/providerCatalog.test.ts
git commit -m "feat(provider): catalog repeatable 标记 + 实例 id/显示名纯函数 + ProviderView.label"
```

---

## Task 6: ProvidersPanel — 回填 + 测试连接 + freellmapi 多实例

**Files:**
- Modify: `desktop/src/renderer/components/ProvidersPanel.tsx`(整体重写渲染与表单逻辑)

**Interfaces:**
- Consumes: `window.wraith.modelList()`(providers 现含 baseUrl/protocol/label)、`window.wraith.setProvider({id,apiKey,model,baseUrl,protocol,label})`、`window.wraith.testProvider({id,apiKey,model,baseUrl,protocol})`、`window.wraith.removeProvider(id)`、`window.wraith.setDefaultProvider(id)`;`baseProviderId/nextInstanceId/instanceDisplayName/findCatalogEntry/PROVIDER_CATALOG`。
- Produces: 无下游消费者(叶子 UI)。

> 本任务无独立单元测试(面板为 UI;纯逻辑已在 Task 5 覆盖)。验证靠 `npm run typecheck` + `npm run build` + 真机眼验。

- [ ] **Step 1: Rewrite ProvidersPanel with prefill + test + multi-instance**

Replace the entire contents of `desktop/src/renderer/components/ProvidersPanel.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import {
  PROVIDER_CATALOG, findCatalogEntry,
  baseProviderId, nextInstanceId, instanceDisplayName,
} from '../../shared/providerCatalog'
import ProviderIcon from './ProviderIcon'
import type { ModelListResult, ProviderView } from '../../shared/types'

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; msg?: string }

export default function ProvidersPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [data, setData] = useState<ModelListResult | null>(null)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)   // 正在编辑的实例 id(可能是新铸造的)
  const [form, setForm] = useState({ apiKey: '', model: '', baseUrl: '', protocol: 'openai' as 'openai' | 'anthropic', label: '' })
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ status: 'idle' })

  const refresh = async (): Promise<void> => { try { setData(await window.wraith.modelList()) } catch { /* ignore */ } }
  useEffect(() => { void refresh() }, [])

  const configured = new Map<string, ProviderView>((data?.providers ?? []).map(p => [p.name, p]))
  const configuredIds = new Set(configured.keys())
  const defaultId = data?.default

  // 已配置实例(含动态 freellmapi-N):所有 hasKey 的条目
  const doneInstances = (data?.providers ?? []).filter(p => p.hasKey)

  // 编辑已存实例:用【已存值】兜底 catalog 默认(修回填 bug)
  const openEdit = (id: string): void => {
    const c = configured.get(id)
    const e = findCatalogEntry(baseProviderId(id))
    setForm({
      apiKey: '',
      model: c?.model || e?.suggestedModels[0] || '',
      baseUrl: c?.baseUrl || e?.defaultBaseUrl || '',
      protocol: (c?.protocol as 'openai' | 'anthropic') || e?.protocol || 'openai',
      label: c?.label || '',
    })
    setError(null); setTest({ status: 'idle' }); setEditing(id)
  }

  // 新增可重复 provider 的实例:铸造下一个 id,表单填 catalog 默认
  const openNew = (baseId: string): void => {
    const id = nextInstanceId(baseId, configuredIds)
    const e = findCatalogEntry(baseId)
    setForm({
      apiKey: '',
      model: e?.suggestedModels[0] || '',
      baseUrl: e?.defaultBaseUrl || '',
      protocol: e?.protocol || 'openai',
      label: '',
    })
    setError(null); setTest({ status: 'idle' }); setEditing(id)
  }

  const patchForm = (patch: Partial<typeof form>): void => {
    setForm({ ...form, ...patch })
    if (test.status !== 'idle') setTest({ status: 'idle' })   // 改字段即清测试结果
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    try {
      await window.wraith.setProvider({ id: editing, apiKey: form.apiKey, model: form.model, baseUrl: form.baseUrl, protocol: form.protocol, label: form.label })
      setEditing(null); void refresh()
    } catch (err) { setError((err as Error).message) }
  }
  const runTest = async (): Promise<void> => {
    if (!editing) return
    setTest({ status: 'testing' })
    try {
      const r = await window.wraith.testProvider({ id: editing, apiKey: form.apiKey, model: form.model, baseUrl: form.baseUrl, protocol: form.protocol })
      if (r.ok) setTest({ status: 'ok', msg: `连接成功 · ${r.model ?? form.model} · ${r.latencyMs ?? '?'}ms` })
      else setTest({ status: 'fail', msg: r.error || '连接失败' })
    } catch (err) { setTest({ status: 'fail', msg: (err as Error).message }) }
  }
  const remove = async (id: string): Promise<void> => {
    try { await window.wraith.removeProvider(id); setEditing(null); void refresh() }
    catch (err) { setError((err as Error).message) }
  }
  const setDefault = async (id: string): Promise<void> => {
    try { await window.wraith.setDefaultProvider(id); void refresh() }
    catch (err) { setError((err as Error).message) }
  }

  const matchQ = (id: string, name: string): boolean =>
    !q || name.toLowerCase().includes(q.toLowerCase()) || id.includes(q.toLowerCase())

  // 已配置组:每个 hasKey 实例一行(经 base entry 解析图标/显示名)
  const doneRows = doneInstances.filter(p => {
    const e = findCatalogEntry(baseProviderId(p.name))
    return matchQ(p.name, instanceDisplayName(p.name, p.label, e))
  })
  // 全部组:catalog 条目中 (未配置 或 repeatable) 的
  const restCatalog = PROVIDER_CATALOG.filter(e =>
    (!configured.get(e.id)?.hasKey || e.repeatable) && matchQ(e.id, e.displayName))

  const renderDoneRow = (p: ProviderView): JSX.Element => {
    const e = findCatalogEntry(baseProviderId(p.name))
    const name = instanceDisplayName(p.name, p.label, e)
    return (
      <div key={p.name} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface/60">
        <ProviderIcon id={baseProviderId(p.name)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-fg">{name}{defaultId === p.name && <span className="ml-1 text-[10px] text-accent">默认</span>}</div>
          <div className="truncate text-[10px] text-fg-subtle">{p.model || '已配置'}</div>
        </div>
        {defaultId !== p.name &&
          <button data-testid="provider-setdefault" onClick={() => void setDefault(p.name)} className="text-[10px] text-fg-muted hover:text-accent">设默认</button>}
        <button data-testid="provider-config" onClick={() => openEdit(p.name)} className="text-[11px] text-fg-muted hover:text-accent">编辑</button>
      </div>
    )
  }
  const renderCatalogRow = (e: typeof PROVIDER_CATALOG[number]): JSX.Element => {
    const alreadyConfigured = configured.get(e.id)?.hasKey
    // repeatable 且已配置 → 显示"＋配置"(再加一个);未配置 → "＋配置";非 repeatable 已配置不会进本列表
    const onClick = e.repeatable ? () => openNew(e.id) : () => openEdit(e.id)
    return (
      <div key={e.id} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface/60">
        <ProviderIcon id={e.id} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-fg">{e.displayName}</div>
          <div className="truncate text-[10px] text-fg-subtle">{e.repeatable && alreadyConfigured ? '可再加一个' : '未配置'}</div>
        </div>
        <button data-testid="provider-config" onClick={onClick} className="text-[11px] text-fg-muted hover:text-accent">＋配置</button>
      </div>
    )
  }

  const editBase = editing ? findCatalogEntry(baseProviderId(editing)) : undefined
  const showLabelField = !!editBase?.repeatable
  const editHasKey = editing ? !!configured.get(editing)?.hasKey : false

  return (
    <div data-testid="providers-panel" className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <button data-testid="providers-back" onClick={onBack} className="text-xs text-fg-muted">← 返回</button>
        <input data-testid="providers-search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索 provider…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs outline-none focus:border-accent" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {doneRows.length > 0 && <><div className="mt-2 px-2 text-[10px] uppercase tracking-wider text-fg-subtle">已配置</div>{doneRows.map(renderDoneRow)}</>}
        <div className="mt-3 px-2 text-[10px] uppercase tracking-wider text-fg-subtle">全部</div>
        {restCatalog.map(renderCatalogRow)}
      </div>
      {editing && (() => { const e = editBase; return (
        <div className="mt-2 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-fg"><ProviderIcon id={baseProviderId(editing)} /> {instanceDisplayName(editing, form.label, e)}
            {e?.consoleUrl && <a href={e.consoleUrl} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-accent">获取密钥 →</a>}</div>
          {showLabelField && (
            <label className="block text-[10px] text-fg-subtle">名称/备注
              <input data-testid="provider-label" value={form.label} onChange={ev => patchForm({ label: ev.target.value })} placeholder="可选,如:工作号"
                className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          )}
          <label className={`block text-[10px] text-fg-subtle ${showLabelField ? 'mt-2' : ''}`}>API Key{editHasKey ? '(已配置 · 留空=不改)' : ''}
            <input data-testid="provider-apikey" type="password" value={form.apiKey} onChange={ev => patchForm({ apiKey: ev.target.value })}
              placeholder={editHasKey ? '已配置 · 留空=不改' : ''}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          <label className="mt-2 block text-[10px] text-fg-subtle">模型
            <input data-testid="provider-model" list="pm-suggest" value={form.model} onChange={ev => patchForm({ model: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" />
            <datalist id="pm-suggest">{(e?.suggestedModels ?? []).map(m => <option key={m} value={m} />)}</datalist></label>
          <label className="mt-2 block text-[10px] text-fg-subtle">Base URL
            <input data-testid="provider-baseurl" value={form.baseUrl} onChange={ev => patchForm({ baseUrl: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          {test.status !== 'idle' && (
            <div data-testid="provider-test-result" className={`mt-2 text-[10px] ${test.status === 'ok' ? 'text-accent' : test.status === 'fail' ? 'text-danger' : 'text-fg-subtle'}`}>
              {test.status === 'testing' ? '测试中…' : test.status === 'ok' ? `✓ ${test.msg}` : `✗ ${test.msg}`}
            </div>
          )}
          {error && <div className="mt-2 text-[10px] text-danger">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button data-testid="provider-test" onClick={() => void runTest()} disabled={test.status === 'testing'}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-accent disabled:opacity-50">测试连接</button>
            <button data-testid="provider-save" onClick={() => void save()} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white">保存</button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted">取消</button>
            {editHasKey &&
              <button data-testid="provider-remove" onClick={() => { void remove(editing) }} className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-danger">删除</button>}
          </div>
        </div>
      )})()}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npx vitest run`
Expected: typecheck 无错;vitest 全绿(providerCatalog/providerIcon 用例不受影响)。
Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run build`
Expected: BUILD 成功(@lobehub 深路径导入无回归)。

- [ ] **Step 3: Commit**

```bash
git add desktop/src/renderer/components/ProvidersPanel.tsx
git commit -m "feat(provider): 面板回填已存值 + 测试连接 + freellmapi 多实例(命名/常驻)"
```

---

## 最终整支复审 + 门禁

- [ ] 全量 Java:`cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false test` → 0F/0E。
- [ ] 全量桌面:`cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npx vitest run && npm run build` → 全绿。
- [ ] 密钥红线:`git diff main...feat/llm-provider-config | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀 `sk-canary-test`/`sk-secret`)。
- [ ] whole-branch review(opus):跨层 id/label/protocol 一致性、testProvider 不回显 key、多实例路由(base bespoke vs `-N` generic)行为等价、回填不再回落 catalog 默认。
- [ ] 真机眼验(重启桌面 app 后):编辑已配置项 baseURL/model 正确回填;测试连接绿/红;freellmapi 连配两个(带备注名)各自出现在"已配置"、freellmapi 仍在"全部"可再加。
```
