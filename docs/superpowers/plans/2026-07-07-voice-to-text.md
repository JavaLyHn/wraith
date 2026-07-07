# 语音转文字（听写 / STT）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composer 加麦克风入口:录音 → 云端 SiliconFlow SenseVoice 转写 → 文本插入输入框光标处(不自动发送)。

**Architecture:** 渲染层 `getUserMedia`+`MediaRecorder` 录音 → base64 → `wraith:transcribe` IPC → Java `stt.transcribe` RPC → `SttClient` multipart POST `/audio/transcriptions`(key/baseUrl 借用 `providers[siliconflow]`)→ 回传 `{text}` → 插入 textarea。后端可插拔(日后本地 whisper.cpp 挂同一 RPC)。

**Tech Stack:** Java 17 / `java.net.http` / Jackson;TypeScript / React / Electron / vitest;浏览器 `MediaRecorder`(无新增依赖)。

## Global Constraints

- **密钥红线**:STT 复用 SiliconFlow 的 `apiKey`,只存 `~/.wraith/config.json`,绝不进日志/回传/错误 message;`SttClient`/Main 错误经 `redactKey` 脱敏。每次提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- **无新增依赖**:录音用浏览器内置 `MediaRecorder`;不加 npm/maven 依赖(不跑 `npm install`)。
- 组件签名沿用既有约定(`Composer` 用 `JSX.Element`);Java 沿用现有 `AppServer`/`Main` 风格。
- **含 Java 改动 → 眼验前必须** `mvn -q -DskipTests package` 重建并把 `target/*.jar` 部署到 `~/.wraith/wraith.jar`。
- 门禁:桌面(`desktop/`)`npm run typecheck`(0)+ `npm run test`(vitest 全绿)+ `npm run build`;Java 针对性 `mvn -DskipTests=false -Dtest='WraithConfigSttTest,SttClientTest,AppServerSkillsTest' test` 0F/0E。
- 提交 trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- STT 默认:providerId=`siliconflow`,model=`FunAudioLLM/SenseVoiceSmall`,baseUrl 兜底 `https://api.siliconflow.cn/v1`。

---

### Task 1: Java — WraithConfig.SttConfig + 有效值解析

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/config/WraithConfig.java`
- Test: `src/test/java/com/lyhn/wraith/config/WraithConfigSttTest.java`

**Interfaces:**
- Consumes: 现有 `getApiKey(provider)` / `getBaseUrl(provider)`。
- Produces: `WraithConfig.SttConfig{providerId,model}`;`getStt()/setStt()`;`getSttProviderId(): String`(默认 `"siliconflow"`);`getSttModel(): String`(默认 `"FunAudioLLM/SenseVoiceSmall"`)。

- [ ] **Step 1: 写失败测试**

新建 `src/test/java/com/lyhn/wraith/config/WraithConfigSttTest.java`:
```java
package com.lyhn.wraith.config;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WraithConfigSttTest {
    @Test void defaultsWhenSttNull() {
        WraithConfig c = new WraithConfig();
        assertEquals("siliconflow", c.getSttProviderId());
        assertEquals("FunAudioLLM/SenseVoiceSmall", c.getSttModel());
    }
    @Test void overridesWhenSet() {
        WraithConfig c = new WraithConfig();
        WraithConfig.SttConfig s = new WraithConfig.SttConfig();
        s.setProviderId("xfyun");
        s.setModel("some/model");
        c.setStt(s);
        assertEquals("xfyun", c.getSttProviderId());
        assertEquals("some/model", c.getSttModel());
    }
    @Test void blankFieldsFallBackToDefaults() {
        WraithConfig c = new WraithConfig();
        WraithConfig.SttConfig s = new WraithConfig.SttConfig();
        s.setProviderId("  "); s.setModel("");
        c.setStt(s);
        assertEquals("siliconflow", c.getSttProviderId());
        assertEquals("FunAudioLLM/SenseVoiceSmall", c.getSttModel());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=WraithConfigSttTest test`
Expected: 编译失败(`SttConfig`/`getSttProviderId`/`getSttModel` 不存在)。

- [ ] **Step 3: 实现**

在 `WraithConfig` 类里,`gateway` 字段之后加字段与嵌套类(仿 `GatewayConfig` 样式):
```java
    private SttConfig stt;

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SttConfig {
        private String providerId;   // 借用哪个 providers 条目的 key/baseUrl
        private String model;
        public String getProviderId() { return providerId; }
        public void setProviderId(String v) { this.providerId = v; }
        public String getModel() { return model; }
        public void setModel(String v) { this.model = v; }
    }
```
在 getter 区(`getGateway`/`setGateway` 附近)加:
```java
    public SttConfig getStt() { return stt; }
    public void setStt(SttConfig stt) { this.stt = stt; }

    /** STT 借用的 provider id;缺省 siliconflow。 */
    public String getSttProviderId() {
        return (stt != null && stt.getProviderId() != null && !stt.getProviderId().isBlank())
            ? stt.getProviderId().trim() : "siliconflow";
    }
    /** STT 模型;缺省 SenseVoiceSmall。 */
    public String getSttModel() {
        return (stt != null && stt.getModel() != null && !stt.getModel().isBlank())
            ? stt.getModel().trim() : "FunAudioLLM/SenseVoiceSmall";
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=WraithConfigSttTest test`
Expected: `Tests run: 3, Failures: 0, Errors: 0` BUILD SUCCESS。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/config/WraithConfig.java src/test/java/com/lyhn/wraith/config/WraithConfigSttTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || true
git commit -m "$(printf 'feat(stt): WraithConfig.SttConfig + STT provider/model 有效值解析(默认 siliconflow/SenseVoiceSmall)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

### Task 2: Java — SttClient(multipart POST + 响应解析)

**Files:**
- Create: `src/main/java/com/lyhn/wraith/stt/SttClient.java`
- Test: `src/test/java/com/lyhn/wraith/stt/SttClientTest.java`

**Interfaces:**
- Produces: `SttClient.parseTranscription(String json): String`(纯,取 `text` 字段;缺/空→`IllegalStateException`);`new SttClient().transcribe(byte[] audio, String mime, String apiKey, String baseUrl, String model): String`(multipart POST,返回文本)。

- [ ] **Step 1: 写失败测试**

新建 `src/test/java/com/lyhn/wraith/stt/SttClientTest.java`:
```java
package com.lyhn.wraith.stt;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SttClientTest {
    @Test void parsesTextField() {
        assertEquals("你好 world", SttClient.parseTranscription("{\"text\":\"你好 world\"}"));
    }
    @Test void trimsWhitespace() {
        assertEquals("hi", SttClient.parseTranscription("{\"text\":\"  hi \"}"));
    }
    @Test void missingTextThrows() {
        assertThrows(IllegalStateException.class, () -> SttClient.parseTranscription("{\"foo\":1}"));
    }
    @Test void emptyTextThrows() {
        assertThrows(IllegalStateException.class, () -> SttClient.parseTranscription("{\"text\":\"   \"}"));
    }
    @Test void malformedJsonThrows() {
        assertThrows(IllegalStateException.class, () -> SttClient.parseTranscription("not json"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=SttClientTest test`
Expected: 编译失败(`SttClient` 不存在)。

- [ ] **Step 3: 实现**

新建 `src/main/java/com/lyhn/wraith/stt/SttClient.java`:
```java
package com.lyhn.wraith.stt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** 云端 STT 客户端:multipart POST &lt;baseUrl&gt;/audio/transcriptions,解析 {text}。 */
public final class SttClient {

    private static final ObjectMapper M = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15)).build();

    /** 取响应 JSON 的 text 字段(trim);缺字段/空/畸形 → IllegalStateException。 */
    public static String parseTranscription(String json) {
        JsonNode n;
        try {
            n = M.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException("转写响应解析失败", e);
        }
        JsonNode t = n == null ? null : n.get("text");
        if (t == null || t.isNull()) throw new IllegalStateException("转写响应无 text 字段");
        String s = t.asText().trim();
        if (s.isEmpty()) throw new IllegalStateException("转写结果为空");
        return s;
    }

    /** 录音字节 → 转写文本。 */
    public String transcribe(byte[] audio, String mime, String apiKey, String baseUrl, String model)
            throws Exception {
        String boundary = "----wraithstt" + Long.toHexString(System.nanoTime());
        String fileName = mime != null && mime.contains("wav") ? "audio.wav"
                        : mime != null && mime.contains("mp3") ? "audio.mp3" : "audio.webm";
        String ct = (mime == null || mime.isBlank()) ? "application/octet-stream" : mime;

        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(("Content-Disposition: form-data; name=\"model\"\r\n\r\n" + model + "\r\n")
                .getBytes(StandardCharsets.UTF_8));
        body.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\n")
                .getBytes(StandardCharsets.UTF_8));
        body.write(("Content-Type: " + ct + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(audio);
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

        String url = baseUrl.replaceAll("/+$", "") + "/audio/transcriptions";
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (resp.statusCode() / 100 != 2) {
            throw new IllegalStateException("STT 上游 HTTP " + resp.statusCode());
        }
        return parseTranscription(resp.body());
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=SttClientTest test`
Expected: `Tests run: 5, Failures: 0, Errors: 0` BUILD SUCCESS。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/stt/SttClient.java src/test/java/com/lyhn/wraith/stt/SttClientTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || true
git commit -m "$(printf 'feat(stt): SttClient —— multipart 音频转写 + text 响应解析\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

### Task 3: Java — AppServer `stt.transcribe` dispatch + Main override

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`（SessionRunner 默认方法 + dispatch case）
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（匿名 SessionRunner 加 `sttTranscribe` 覆盖）
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java`（加 stt dispatch 用例）

**Interfaces:**
- Consumes: Task 1 `getSttProviderId/getSttModel`、现有 `getApiKey/getBaseUrl`;Task 2 `SttClient`;`Main` 的 `config`(WraithConfig)、`redactKey`。
- Produces: `SessionRunner.sttTranscribe(String audioBase64, String mime): Map<String,Object>`(默认抛 UOE);RPC `stt.transcribe {audioBase64, mime} → {text}`。

- [ ] **Step 1: 写失败测试**

在 `AppServerSkillsTest` 顶部 `run(...)` 的假 `SessionRunner` 里(第 14–26 行那个匿名类)追加一个覆盖:
```java
            public Map<String,Object> sttTranscribe(String audioBase64, String mime) {
                return Map.of("text", "你好 world");
            }
```
再在类内加两个测试:
```java
    @Test void sttTranscribeReturnsText() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"stt.transcribe\",\"params\":{\"audioBase64\":\"YWJj\",\"mime\":\"audio/webm\"}}");
        assertEquals("你好 world", byId(r, 2).path("result").path("text").asText());
    }
    @Test void sttTranscribeMissingAudioIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"stt.transcribe\",\"params\":{\"mime\":\"audio/webm\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=AppServerSkillsTest test`
Expected: `sttTranscribeReturnsText` 失败(dispatch 无 `stt.transcribe`,返回 method-not-found 错误而非 result)。

- [ ] **Step 3: AppServer 加默认方法 + dispatch**

在 `SessionRunner` 接口里(`skillsExistsInScope` 默认方法之后,第 129 行 `}` 之前)加:
```java
        /** 云端语音转写:audioBase64=录音字节的 base64,mime=音频 MIME。默认抛出。 */
        default java.util.Map<String, Object> sttTranscribe(String audioBase64, String mime) {
            throw new UnsupportedOperationException("sttTranscribe not implemented");
        }
```
在 dispatch switch 里(`case "skills.existsInScope"` 那块之后)加:
```java
            case "stt.transcribe" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String audioBase64 = textParam(p, "audioBase64");
                String mime = textParam(p, "mime");
                if (audioBase64 == null || audioBase64.isBlank()) { writer.error(msg.id(), -32602, "缺 audioBase64"); return true; }
                try { writer.result(msg.id(), session.sttTranscribe(audioBase64, mime)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 4: Main 覆盖 sttTranscribe**

在 `Main.java` 匿名 `SessionRunner`(约 1200 行起)里,仿 `configSetProvider` 风格加一个方法(与其它 `public java.util.Map<...>` 覆盖同级):
```java
                    public java.util.Map<String, Object> sttTranscribe(String audioBase64, String mime) {
                        String pid = config.getSttProviderId();
                        String apiKey = config.getApiKey(pid);
                        if (apiKey == null || apiKey.isBlank())
                            throw new IllegalArgumentException("STT 未配置:请先在 Provider 配置里为 " + pid + " 填好 API Key");
                        String baseUrl = config.getBaseUrl(pid);
                        if (baseUrl == null || baseUrl.isBlank()) baseUrl = "https://api.siliconflow.cn/v1";
                        String model = config.getSttModel();
                        byte[] audio = java.util.Base64.getDecoder().decode(audioBase64);
                        try {
                            String text = new com.lyhn.wraith.stt.SttClient()
                                    .transcribe(audio, mime, apiKey, baseUrl, model);
                            return java.util.Map.of("text", text);
                        } catch (IllegalArgumentException e) {
                            throw e;
                        } catch (Exception e) {
                            String em = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                            em = redactKey(em, apiKey);
                            if (em.length() > 300) em = em.substring(0, 300);
                            throw new RuntimeException(em);
                        }
                    }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=AppServerSkillsTest test`
Expected: 全绿(含新增 2 例)`Failures: 0, Errors: 0`。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || true
git commit -m "$(printf 'feat(stt): RPC stt.transcribe —— AppServer dispatch + Main 接 SttClient(缺 key→IAE,错误脱敏)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

### Task 4: 渲染层纯逻辑 — dictation.ts

**Files:**
- Create: `desktop/src/renderer/lib/dictation.ts`
- Test: `desktop/test/dictation.test.ts`

**Interfaces:**
- Produces: `bytesToBase64(bytes: Uint8Array): string`;`blobToBase64(blob: Blob): Promise<string>`;`insertAtCursor(value, selStart, selEnd, text): { value: string; caret: number }`。

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/dictation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { bytesToBase64, insertAtCursor } from '../src/renderer/lib/dictation'

describe('bytesToBase64', () => {
  it('编码为标准 base64(无 dataURL 前缀)', () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=')          // "hi"
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
  })
})

describe('insertAtCursor', () => {
  it('空输入插入', () => {
    expect(insertAtCursor('', 0, 0, '你好')).toEqual({ value: '你好', caret: 2 })
  })
  it('光标居中插入', () => {
    expect(insertAtCursor('ab', 1, 1, 'X')).toEqual({ value: 'aXb', caret: 2 })
  })
  it('替换选区', () => {
    expect(insertAtCursor('abc', 0, 2, 'Z')).toEqual({ value: 'Zc', caret: 1 })
  })
  it('越界光标夹紧到长度', () => {
    expect(insertAtCursor('ab', 99, 99, 'X')).toEqual({ value: 'abX', caret: 3 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npm run test -- --run dictation`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

新建 `desktop/src/renderer/lib/dictation.ts`:
```ts
/** Uint8Array → 标准 base64(无 dataURL 前缀)。纯函数,可测。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** 录音 Blob → base64(渲染层调用)。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

/** 把 text 插入 value 的 [selStart,selEnd),返回新值 + 新光标。 */
export function insertAtCursor(
  value: string, selStart: number, selEnd: number, text: string,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selStart, value.length))
  const end = Math.max(start, Math.min(selEnd, value.length))
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npm run test -- --run dictation`
Expected: PASS(5 例)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/dictation.ts desktop/test/dictation.test.ts
git commit -m "$(printf 'feat(stt): dictation.ts 纯逻辑(bytesToBase64/blobToBase64/insertAtCursor)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

### Task 5: IPC 接线 + 麦克风权限

**Files:**
- Modify: `desktop/src/preload/index.ts`（接口声明 + 实现）
- Modify: `desktop/src/main/index.ts`（`wraith:transcribe` handle + 媒体权限放行）

**Interfaces:**
- Consumes: Task 3 RPC `stt.transcribe`。
- Produces: `window.wraith.transcribe(audioBase64: string, mime: string): Promise<{ text: string }>`。

- [ ] **Step 1: preload 加接口声明**

在 `desktop/src/preload/index.ts` 的接口(WraithApi)里,`openExternal(...)` 附近加一行:
```ts
  transcribe(audioBase64: string, mime: string): Promise<{ text: string }>
```

- [ ] **Step 2: preload 加实现**

在暴露对象实现区(仿 `skillExistsInScope` 实现,约 320 行)加:
```ts
  transcribe(audioBase64, mime) {
    return ipcRenderer.invoke('wraith:transcribe', audioBase64, mime) as Promise<{ text: string }>
  },
```

- [ ] **Step 3: main 加 handle**

在 `desktop/src/main/index.ts` 的 ipc handle 区(仿 `wraith:skillExistsInScope`,约 510 行)加:
```ts
ipcMain.handle('wraith:transcribe', async (_e, audioBase64: string, mime: string) => {
  const client = requireClient()
  return client.request('stt.transcribe', { audioBase64, mime })
})
```
（`requireClient()` / 取 client 的方式与相邻 handle 保持一致——照抄同文件里 `wraith:skillExistsInScope` 取 client 的写法。）

- [ ] **Step 4: main 放行麦克风权限**

在 `desktop/src/main/index.ts` 顶部 import 补 `session`:
```ts
import { app, BrowserWindow, ipcMain, dialog, Notification, shell, session } from 'electron'
```
在 `app.whenReady()` 之后 / 创建窗口附近加一次性设置:
```ts
  // 仅放行麦克风(媒体)权限,供语音听写用
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
```

- [ ] **Step 5: typecheck + build**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: typecheck 0;build 成功。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || true
git commit -m "$(printf 'feat(stt): IPC wraith:transcribe 接线 + 放行麦克风(媒体)权限\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

> **打包备注(非本任务代码步):** 打包(electron-builder/forge)的 mac 配置需加 `NSMicrophoneUsageDescription`;dev 眼验时若系统未弹麦克风授权,到「系统设置 → 隐私与安全性 → 麦克风」手动给 Electron 授权。

---

### Task 6: Composer 麦克风 UI + 录音

**Files:**
- Modify: `desktop/src/renderer/components/Composer.tsx`

**Interfaces:**
- Consumes: Task 4 `blobToBase64`/`insertAtCursor`;Task 5 `window.wraith.transcribe`;现有 `textareaRef`/`value`/`onChange`。

- [ ] **Step 1: 引入依赖 + 录音状态**

顶部 import 加:
```ts
import { blobToBase64, insertAtCursor } from '../lib/dictation'
```
在组件内(`textareaRef` 之后)加状态与 ref:
```tsx
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [sttError, setSttError] = useState<string | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

- [ ] **Step 2: 录音控制函数**

在 `handleKeyDown` 之后加:
```tsx
  const stopRec = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null }
    mediaRef.current?.stop()
  }, [])

  const cancelRec = useCallback(() => {
    cancelledRef.current = true
    stopRec()
    setRecording(false)
  }, [stopRec])

  const startRec = useCallback(async () => {
    setSttError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      cancelledRef.current = false
      mr.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (cancelledRef.current) { setRecording(false); return }
        setRecording(false); setTranscribing(true)
        try {
          const mime = mr.mimeType || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type: mime })
          const b64 = await blobToBase64(blob)
          const { text } = await window.wraith.transcribe(b64, mime)
          const ta = textareaRef.current
          const s = ta?.selectionStart ?? value.length
          const en = ta?.selectionEnd ?? value.length
          const r = insertAtCursor(value, s, en, text)
          onChange(r.value)
          requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(r.caret, r.caret) })
        } catch (err) {
          setSttError((err as Error).message || '转写失败')
        } finally { setTranscribing(false) }
      }
      mr.start()
      mediaRef.current = mr
      setRecording(true)
      stopTimerRef.current = setTimeout(() => stopRec(), 60_000)   // 60s 上限
    } catch {
      setSttError('无法访问麦克风,请在系统设置里授权')
    }
  }, [value, onChange, stopRec])
```

- [ ] **Step 3: 控制行加麦克风钮**

在 control row(`{/* attach */}` 按钮之后、`<ModelSwitcher .../>` 之前)插入:
```tsx
          {/* 语音听写 */}
          {!recording && !transcribing && (
            <button
              data-testid="stt-mic"
              disabled={running}
              aria-label="语音输入"
              title="按一下开始说话,再按停止转写"
              onClick={() => void startRec()}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              🎙
            </button>
          )}
          {recording && (
            <div className="flex items-center gap-1">
              <button data-testid="stt-stop" onClick={stopRec} aria-label="停止并转写"
                className="flex h-7 items-center gap-1 rounded-lg bg-danger/10 px-2 text-xs text-danger">
                <span className="h-2 w-2 animate-pulse rounded-full bg-danger" /> 录音中·停止
              </button>
              <button data-testid="stt-cancel" onClick={cancelRec} aria-label="取消"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle hover:text-fg">×</button>
            </div>
          )}
          {transcribing && (
            <span data-testid="stt-transcribing" className="text-xs text-fg-muted">转写中…</span>
          )}
```

- [ ] **Step 4: 错误提示**

在最外层容器内、attachment chips 行附近(输入框上方)加:
```tsx
        {sttError && (
          <div data-testid="stt-error" className="px-3 pt-2 text-2xs text-danger">
            {sttError}
            {sttError.includes('未配置') && <span className="text-fg-subtle">（到 Provider 配置里填 SiliconFlow 的 key）</span>}
          </div>
        )}
```

- [ ] **Step 5: 发送/录音互斥**

把发送按钮的 `disabled` 从 `running || !value.trim()` 改为:
```tsx
            disabled={running || recording || transcribing || !value.trim()}
```

- [ ] **Step 6: typecheck + build**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: typecheck 0;build 成功。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/Composer.tsx
git commit -m "$(printf 'feat(stt): Composer 麦克风听写 —— 录音/停止/取消 + 转写插入光标处 + 60s 上限\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

## 最终门禁 + 部署 + 眼验

- [ ] 桌面三门:`cd desktop && npm run typecheck && npm run test && npm run build` 全绿。
- [ ] Java 针对性:`mvn -DskipTests=false -Dtest='WraithConfigSttTest,SttClientTest,AppServerSkillsTest' test` 0F/0E。
- [ ] **重建部署 jar**:`mvn -q -DskipTests package` → 把产物 jar 覆盖到 `~/.wraith/wraith.jar`。
- [ ] 眼验(需麦克风 + 已配 SiliconFlow key):Composer 点 🎙 → 说一句中文含英文词 → 停止 → 「转写中…」→ 文本插入输入框光标处、不自动发送;错误路径(未配 key / 拒麦克风 / 断网)提示正确。

## Self-Review

- **Spec 覆盖**:配置复用(T1)、SttClient(T2)、RPC(T3)、录音纯逻辑(T4)、IPC+权限(T5)、UI(T6);错误处理(缺 key IAE→提示、麦克风失败、网络、空转写、60s 上限)散落 T3/T6;音频格式先 webm(T2 按 mime 定文件名),WAV 兜底列为 spec 风险(未纳入 v1 任务,端点实测后再决定)。✓
- **占位符**:无 TBD;每步含完整代码/命令。✓
- **类型一致**:`transcribe(audioBase64,mime)→{text}` 在 preload/main/RPC/Main 四处签名一致;`insertAtCursor`/`blobToBase64` 签名 T4 定义、T6 消费一致;`sttTranscribe(String,String)` AppServer 默认与 Main 覆盖一致。✓
- **安全**:key 只在 config.json;错误经 `redactKey` + 截断;无回传 key;secret scan 每步。✓
