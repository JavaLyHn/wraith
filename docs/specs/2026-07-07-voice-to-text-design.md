# 设计：语音转文字（听写 / STT）

日期：2026-07-07
范围：桌面渲染层 + Electron main + Java 后端 + config。分支 `feat/voice-to-text`（off main）。**含 Java 改动 → 需重建并部署 jar 后眼验。**

## 问题

Wraith 目前只能打字输入。移动/口述场景下希望能**按住麦克风说话 → 转成文字填进输入框**，用户确认后再发送。项目当前**无任何音频/麦克风/ASR 基建**（全新地基）。

## 目标

1. 在 Composer 增加麦克风入口：录音 → 云端转写 → 文本插入输入框光标处（**不自动发送**，用户复核后自行发）。
2. 复用现有 provider 密钥体系与网络出口（Java 层），零新增第三方库。
3. 后端可插拔：v1 云端；日后本地 whisper.cpp 能挂同一 `stt.transcribe` 接口。

## 选型结论（已与用户确认，锁定）

- **听写 only，无 TTS/语音回复**。
- **云端 · 批量**（录完整段一次性转写，HTTP multipart；非流式）。
- 引擎 **SiliconFlow `FunAudioLLM/SenseVoiceSmall`**（免费模型，中文强，OpenAI 兼容音频端点 `POST /v1/audio/transcriptions`）。
- 语言：中文为主 + 中英混。

## 非目标（YAGNI）

- 不做 TTS、不做流式实时出字、不做自动发送、不做语音指令。
- v1 不做本地 whisper.cpp（预留接口，二期）。
- 不做多引擎切换 UI（config 里可改 providerId/model，但不做面板）。
- 不引第三方音频/ASR 库（录音用浏览器 `MediaRecorder`，转写用现有 HTTP 客户端栈）。

## 现有结构（锚点）

- `desktop/src/renderer/components/Composer.tsx`：输入框组件（麦克风钮落这里）。
- 跨层链路：渲染层 `window.wraith.X` → `desktop/src/preload/index.ts`（`ipcRenderer.invoke('wraith:X')`）→ `desktop/src/main/index.ts`（`ipcMain.handle('wraith:X')` → `client.request('rpc.method', params)`）→ Java `AppServer` JSON-RPC dispatch（`case "rpc.method"`）。
- `src/main/java/com/lyhn/wraith/config/WraithConfig.java`：`providers: Map<String, ProviderConfig{apiKey,baseUrl,model,…}>` + 嵌套 `gateway: GatewayConfig`（STT 配置照此样式加 `stt` 块）。
- 现有 LLM 客户端栈（`llm/*Client.java` + `LlmClientFactory`）：HTTP 客户端与密钥读取的既有模式，SttClient 复用其风格。

## 设计

### 1. 配置（复用 provider 密钥）

`WraithConfig` 新增嵌套块（照 `gateway` 样式）：
```java
private SttConfig stt;   // 可空;为空时用内置默认
static class SttConfig {
    private String providerId;   // 借用哪个 providers 条目的 key/baseUrl;默认 "siliconflow"
    private String model;        // 默认 "FunAudioLLM/SenseVoiceSmall"
    // getter/setter
}
```
解析规则：STT 用的 **apiKey/baseUrl 从 `providers.get(providerId)` 借用**（用户像配普通 provider 一样把 SiliconFlow 配一次即可）；`model` 用 `stt.model` 或默认。若目标 provider 未配置或无 key → 返回结构化错误 `stt_not_configured`，渲染层引导去 Provider 配置页。

### 2. Java 后端

- 新增 `stt/SttClient.java`：`transcribe(byte[] audio, String mime, String apiKey, String baseUrl, String model) → String`。以 multipart/form-data POST 到 `<baseUrl>/audio/transcriptions`，字段 `file`（按 mime 定文件名，如 `audio.webm`）+ `model`；`Authorization: Bearer <apiKey>`。解析响应 JSON 的 `text` 字段返回。
- `AppServer` 新增 SessionRunner 默认 `sttTranscribe(...)` + dispatch `case "stt.transcribe"`：入参 `{ audioBase64, mime }`；解 base64 → 读 `stt` 配置解析 provider → 调 SttClient → 返 `{ text }`。缺 key → IAE→`-32602` 或专用错误码；网络/上游失败 → `-32000` 带简短 message（**不含密钥**）。`Main.java` 覆盖注入真实 `WraithConfig` + SttClient。

### 3. Electron main + preload

- preload：`transcribe(audioBase64: string, mime: string): Promise<{ text: string }>` → `ipcRenderer.invoke('wraith:transcribe', { audioBase64, mime })`。
- main：`ipcMain.handle('wraith:transcribe', …)` → `client.request('stt.transcribe', { audioBase64, mime })`。
- **macOS 麦克风权限**：`Info.plist` 加 `NSMicrophoneUsageDescription`；Electron `session.setPermissionRequestHandler` 放行 `media`（仅麦克风）。

### 4. 渲染层（录音 + UI）

- 纯逻辑抽到 `desktop/src/renderer/lib/dictation.ts`：`blobToBase64(blob) → Promise<string>`（去掉 dataURL 前缀）、`insertAtCursor(text, value, selStart, selEnd) → { value, caret }`（把转写文本插入输入框光标处，可测）。
- `Composer.tsx` 加 🎙 钮 + 录音 hook：`getUserMedia({audio:true})` → `MediaRecorder`（默认 `audio/webm;codecs=opus`）；**点击切换**：点→录（脉冲动画 + 计时 + ×取消），再点→停并转写；**60s 自动停**兜住 payload。停后 → `blobToBase64` → `window.wraith.transcribe` →「转写中…」态 → 成功则 `insertAtCursor` 填入、失败则 toast 且不动输入框。录音/转写期间禁用发送。

### 5. 数据流

```
🎙点击 → getUserMedia+MediaRecorder 录制(webm/opus)
 → 再次点击/60s → stop → blob → base64
 → window.wraith.transcribe(base64, mime)         [renderer]
 → ipc wraith:transcribe                           [main]
 → rpc stt.transcribe {audioBase64, mime}          [Java AppServer]
 → 解析 stt 配置→providers[providerId] 取 key/baseUrl
 → SttClient multipart POST /audio/transcriptions
 → { text } 回传 → insertAtCursor 填入输入框
```

## 错误处理

| 情况 | 表现 |
|---|---|
| STT provider 未配置/无 key | 结构化错误 → 渲染层提示「先在 Provider 配置里配好 SiliconFlow」+ 跳转入口 |
| 麦克风权限被拒 | 提示授权指引（macOS 系统设置路径） |
| 网络/上游失败 | toast 简短错误（脱敏,不含 key）；输入框不变 |
| 转写结果为空 | 提示「没听清,请重试」；输入框不变 |
| 录音超 60s | 自动停并进入转写 |

## 测试 / 门禁

- **vitest**：`dictation.ts` 的 `blobToBase64`（喂构造 Blob 验前缀剥离）、`insertAtCursor`（空输入/光标居中/选区替换三例）。
- **Java**：`SttClientTest`——喂 canned JSON 验 `text` 解析（含缺 `text` 字段的降级）；`AppServerSkillsTest` 同款风格加 `stt.transcribe` dispatch 用例（缺 key→错误码;happy path 用假 SttClient）。
- **typecheck + build**：Composer 接线 + preload/main IPC。
- **门禁**：桌面 `npm run typecheck`(0) + `npm run test`(vitest 全绿) + `npm run build`;Java 针对性 `SttClientTest` + appserver 测试 0F/0E。
- **眼验（需重建并部署 jar）**：配好 SiliconFlow key → Composer 点 🎙 说一句中文（含个英文词）→ 转写文本插入输入框；未配 key/拒权限/断网三条错误路径提示正确。

## 风险

1. **音频格式**：`MediaRecorder` 出 webm/opus，SenseVoice 端点可能只收 wav/mp3。策略：先直传 webm（SttClient 按 mime 定文件名）；若端点拒收，渲染层用 `AudioContext` 解码后编 16k 单声道 WAV 再传（`dictation.ts` 加 `encodeWav`，同样可测）。接入首日先验端点接受度再决定是否加 WAV 分支。
2. **免费条款**：SiliconFlow 免费模型的额度/限速/模型 id 可能变，以接入时官方文档为准（model id、端点路径先按本 spec，实测校正）。
3. **jar 部署**：含 Java 改动，眼验前须 `mvn package` 重建并部署到 `~/.wraith/wraith.jar`（同 skill-scope-move 流程）。

## 交付链路

`feat/voice-to-text` → 实现（TDD）→ 桌面三门 + Java 针对性测试全绿 → 重建部署 jar → 真机眼验（麦克风）→ FF-merge + 推送（推送前用户点头）。

## 安全

- **密钥红线**：STT 复用 SiliconFlow 的 `apiKey`，只存 `~/.wraith/config.json`，绝不进日志/回传/错误 message；提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
- **数据出口**：音频会上传到 SiliconFlow 转写（与现有 LLM 调用同类的云端出口）；在设计上明示，无本地留存。
- SttClient 错误信息脱敏，不回显 Authorization 头/上游原始响应中的敏感片段。
