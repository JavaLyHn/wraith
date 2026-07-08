# 设计：VAD 分段伪流式语音输入(边说边出)+ 空结果修复

日期：2026-07-08
范围：桌面渲染层（分段录音 / VAD / 按序追加，为主）+ Java 后端（`SttClient` 空结果处理，一处微调）。分支 `feat/stt-chunked-streaming`（off main）。**含 Java → 眼验前重建部署 jar。**

## 问题

当前 STT 是**批处理**:录一整段 → 点停 → 整段 base64 → `window.wraith.transcribe` → SiliconFlow `/audio/transcriptions`（SenseVoice，Whisper 风格文件端点）→ 返回完整文本一次性插入。两个痛点:

1. **不能边说边出**:必须说完、停止,才看到全部内容。该端点天生不支持流式(非 WebSocket 实时 ASR)。
2. **空结果报错**:`SttClient.parseTranscription`（`SttClient.java:33`)在 API 返回 2xx 但 `text` 为空串时抛 `IllegalStateException("转写结果为空")`,静音/太短/没识别出语音时被当成硬错误弹给用户(`Error invoking remote method 'wraith:transcribe': ... 转写结果为空`)。

技术选型结论(已与用户确认):保持**免费**(复用 SiliconFlow 批处理,不引入 WS 实时 ASR / 不引入 provider key),做**分段伪流式**——持续录音,在停顿处切段,每段即时批处理转写、按序追加。

## 目标

1. 说话时**一段一段**出字(说一句停一下,那句就转写并追加到输入框),而非等全部说完。
2. 切段发生在**自然停顿**处,尽量不切断词。
3. **零新增成本**:复用现有 `transcribe` IPC 与 SiliconFlow 批处理。
4. 修复空结果:静音/无语音段**静默忽略**,不再报错(单段模式一并受益)。

## 非目标（YAGNI）

- 不做真·逐字流式(需 WebSocket 实时 ASR,已排除)。
- 不做浏览器 Web Speech(Electron 常不可用,已排除)。
- 不换 provider、不加 key、不加实时端点。
- 不做 interim/replace 文本(段落即 final,只追加,不回改已出文字)。

## 现有结构（锚点）

- `desktop/src/renderer/components/Composer.tsx`:录音状态机（`startRec`/`stopRec`/`cancelRec`、`mediaRef`/`streamRef`/`chunksRef`/`cancelledRef`/`stopTimerRef`、60s 上限、`onstop` → blob → `blobToBase64` → `window.wraith.transcribe` → `insertAtCursor`）。含 STT #1（unmount 清理 stream）/#2（转写超时兜底）。
- `desktop/src/renderer/lib/dictation.ts`:`blobToBase64`、`insertAtCursor(value, start, end, text) → {value, caret}`。
- `desktop/src/renderer/lib/waveform.ts` + `components/VoiceBars.tsx`:录音时的 Web Audio `AnalyserNode`（`getByteTimeDomainData` → RMS `micLevel`）驱动波形。VAD 复用同一套音量采样思路。
- `window.wraith.transcribe(audioBase64, mime) → { text }`（preload → `wraith:transcribe` → Java `stt.transcribe` → `SttClient.transcribe`）。
- `src/main/java/com/lyhn/wraith/stt/SttClient.java`:`parseTranscription(json)`（空 text 抛错）、`transcribe(audio, mime, apiKey, baseUrl, model)`。

## 设计

### §1 分段引擎（`desktop/src/renderer/lib/vadSegmenter.ts` — 纯逻辑,可测）

把 VAD 状态机抽成纯函数/纯类,与 MediaRecorder 解耦以便单测:

- 输入:每帧的音量 `level`（RMS，0..1）+ 帧时间步长（或调用节奏）。
- 状态:`hasSpeech`（本段是否已出现过语音）、`silenceMs`（连续静音累积）、`segmentMs`（本段总时长）。
- 阈值(可调常量):`SPEECH_LEVEL`（判定"有声"的 RMS 阈,如 0.02）、`SILENCE_HOLD_MS`（触发切段的静音时长，~700ms）、`MAX_SEGMENT_MS`（封顶强切，~8000ms）、`MIN_SEGMENT_MS`（太短不切，避免碎段，~400ms）。
- 输出决策(每帧):`{ cut: boolean, reason: 'silence'|'maxlen'|null }`。
  - `level ≥ SPEECH_LEVEL` → `hasSpeech=true`，`silenceMs=0`。
  - `level < SPEECH_LEVEL` → `silenceMs += step`。
  - `cut` 条件:`hasSpeech && segmentMs ≥ MIN_SEGMENT_MS && (silenceMs ≥ SILENCE_HOLD_MS || segmentMs ≥ MAX_SEGMENT_MS)`。
  - 切段后 reset(`hasSpeech=false, silenceMs=0, segmentMs=0`）。

### §2 录音驱动（Composer）

- 录音会话开始:`getUserMedia` → 建 `AudioContext` + `AnalyserNode`（挂在 stream 上，与 VoiceBars 并存,多个 analyser 可共用一个 source）→ `requestAnimationFrame`/定时器循环里算 `level`，喂给 vadSegmenter。
- **切段机制:MediaRecorder stop→restart**。收到 `cut` 决策 → `mr.stop()`（`onstop` 产出一个**完整可解码**的 webm blob）→ 立即 `mr.start()` 开启下一段（切点在静音处,丢的毫秒是静音、不丢字）。每段产出携带一个**递增序号 `seq`**。
- 每段 `onstop`:若 `cancelledRef` 直接丢弃;否则 blob → base64 → `transcribe`（**不 await 阻塞录音**,fire-and-forget 带 seq）。录制持续进行,多段转写可并行在途。
- 停止(用户点停 / 会话总上限）:`mr.stop()` flush 最后一段,不再 restart,停 analyser/AudioContext/stream。

### §3 按序追加（`desktop/src/renderer/lib/orderedAppender.ts` — 纯逻辑,可测 + Composer 接线）

多段异步转写可能后发先至,必须按说话顺序出字:

- 纯逻辑 `OrderedAppender`:`nextSeq` + `pending: Map<seq, text>`。`arrive(seq, text)` 存入,然后从 `nextSeq` 起连续 flush 所有已到达段,返回**本次可按序输出的文本片段数组**;缺口(某 seq 未到)则暂存等待。空文本段占位推进 `nextSeq` 但不产出文本(见 §4)。
- Composer 侧:收到 flush 出的文本,依次 `insertAtCursor`(维护一个前移的插入光标),`onChange` 更新输入框。

### §4 空结果修复（后端 + 前端）

- 后端 `SttClient.parseTranscription`:空 `text`(`s.isEmpty()`)从**抛 `IllegalStateException`** 改为**返回 `""`**;`transcribe` 相应返回 `""`（缺 text 字段/畸形 JSON 仍抛错——那是真异常，与"没听到话"区分）。
- 前端:`OrderedAppender` 收到空段 → 推进 `nextSeq` 但不产出;Composer 不插入、不弹错。
- 本设计**用分段替换整段批处理**,不保留独立的"单发"路径;空结果修复在后端,故任何调用 `transcribe` 的路径都受益。
- **既有测试更新**:`SttClientTest.java:17`（`{"text":"   "}` 现断言抛 `IllegalStateException`)改为断言返回 `""`;`:14`（缺 text 字段)与 `:20`（畸形 JSON)仍抛错(真异常,与"没听到话"区分)——这两条不动。

### §5 错误 / 取消 / 上限

- 单段 `transcribe` 失败(网络/HTTP 非 2xx)→ 该 seq 记为空产出(推进 `nextSeq`,不插入),`console.warn`,**不中断会话**、不弹全局错。可选:在输入框下方轻提示"部分片段转写失败"。
- 取消:`cancelledRef=true` → stop、丢在途段、清 analyser/ctx/stream(复用现有 cancel + #1 卸载防泄漏路径)。
- 上限:去掉原 60s 硬停,改为宽松**会话总上限**(如 5min)防跑飞;单段有 `MAX_SEGMENT_MS` 封顶。

### §6 状态与指示

- 录音中:VoiceBars 波形持续(不变)。
- 转写中:保留 `transcribing` 指示,但因分段,呈"间歇性"——有在途段时显示。轻量即可。

## 测试 / 门禁

- **vitest(纯逻辑)**:
  - `vadSegmenter`:静音累积到阈值触发 `cut(reason=silence)`;持续有声到 `MAX_SEGMENT_MS` 触发 `cut(reason=maxlen)`;太短(`< MIN_SEGMENT_MS`)不切;切后 reset;纯静音(从无语音)不切。
  - `orderedAppender`:顺序到达顺序出;乱序到达(seq 2 先于 1)缓存、待 1 到再按序出;空段推进不产出。
- **Java**:`SttClient.parseTranscription` 空 text → `""`(不抛);缺字段/畸形 → 仍抛。
- **UI**(分段录音/MediaRecorder 生命周期/analyser)靠 typecheck + build + 眼验(无 RTL)。
- **门禁**:桌面 typecheck 0 + vitest 全绿 + build;Java 针对性 `SttClientTest`(或现有 STT 测试)0F/0E。**含 Java → 重建部署 jar + 眼验**(说话分段出字、停顿处切、静音不报错、取消干净)。

## 风险

- **VAD 阈值调参**:`SPEECH_LEVEL`/`SILENCE_HOLD_MS` 因麦克风/环境噪声而异,需眼验微调;抽成常量便于调整。定位为 best-effort,不追求完美 VAD。
- **stop/restart 边界**:极小概率在 restart 瞬间漏掉起音;因切点在静音处,风险低。若眼验发现丢字,可改为"重叠一小段"或降低 restart 频率。
- **请求数上升**:分段 → 每段一次请求,量增(但 SiliconFlow 免费);MIN_SEGMENT_MS 防碎段控制总量。
- **空结果语义变更**:`parseTranscription` 空→"" 改了既有单段行为(空录音从报错变静默)——更优 UX,但属行为变更,靠单测锁定"缺字段仍抛、空串返空"的边界。

## 交付链路

`feat/stt-chunked-streaming` → 实现(TDD:vadSegmenter/orderedAppender/SttClient 纯逻辑先行)→ 桌面三门 + Java 针对性全绿 → 重建部署 jar → 眼验 → FF/merge + 推送(推送前点头)。

## 安全

无新增密钥面(复用现有 STT key 路径,key 仍只在 `~/.wraith/config.json`)。不新增网络端点(同一 `/audio/transcriptions`,只是分段多次调用)。音频仅在内存分段处理,不落盘。
