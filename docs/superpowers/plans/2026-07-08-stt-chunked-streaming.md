# VAD 分段伪流式语音输入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让语音输入边说边出——持续录音,在停顿处切段,每段即时批处理转写并按序追加到输入框;顺带把"转写结果为空"从报错改成静默忽略。

**Architecture:** 复用免费 SiliconFlow 批处理 `transcribe` IPC(不引入 WS 实时 ASR / 不加 key)。前端两个纯逻辑单元——`VadSegmenter`(音量→切段决策状态机)、`OrderedAppender`(乱序段结果→按序 flush)——加 Composer 的分段录音驱动(MediaRecorder per-segment stop→restart,切点在静音处)。后端一处:`SttClient.parseTranscription` 空 text → 返回 `""`(不抛)。

**Tech Stack:** Electron + React + TypeScript(vitest);Web Audio `AnalyserNode`;MediaRecorder;Java 17/Maven(pkg `com.lyhn.wraith`)。

## Global Constraints

- 免费方向:不引入新 provider / 不加 key / 不新增网络端点;复用现有 `window.wraith.transcribe(audioBase64, mime) → { text }` 与 `/audio/transcriptions`。
- 桌面:组件 `): JSX.Element`;**不引入 React Testing Library**;纯逻辑抽 lib + vitest,UI 靠 typecheck/build/eyeverify;npm 用 `--legacy-peer-deps`(通常无需 install)。
- 段落即 final,只**追加**,不回改已出文字(无 interim/replace)。
- 空 text 语义:`parseTranscription` 缺 text 字段 / 畸形 JSON **仍抛** `IllegalStateException`;仅"有 text 字段但 trim 后为空串"→ 返回 `""`。
- Chinese 注释,匹配周围风格。
- 含 Java → 收尾 `mvn -DskipTests=false package` 重建 fat jar → 部署 `~/.wraith/wraith.jar` → 眼验。
- 每次提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`
- 分支 `feat/stt-chunked-streaming`(off main,已建)。

---

## 文件结构

- Modify `src/main/java/com/lyhn/wraith/stt/SttClient.java` — `parseTranscription` 空 text → `""`。
- Modify `src/test/java/com/lyhn/wraith/stt/SttClientTest.java` — 空/空白 text 断言从抛错改 `""`;缺字段/畸形仍抛。
- Create `desktop/src/renderer/lib/vadSegmenter.ts` — VAD 切段状态机(纯逻辑)。
- Create `desktop/test/vadSegmenter.test.ts`。
- Create `desktop/src/renderer/lib/orderedAppender.ts` — 按序 flush(纯逻辑)。
- Create `desktop/test/orderedAppender.test.ts`。
- Modify `desktop/src/renderer/components/Composer.tsx` — 分段录音驱动(替换单段 startRec/onstop)。

---

### Task 1: 后端 `SttClient` 空结果 → `""`(不抛)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/stt/SttClient.java`
- Test: `src/test/java/com/lyhn/wraith/stt/SttClientTest.java`

**Interfaces:**
- Produces: `SttClient.parseTranscription(String json)` — 行为变更:有 `text` 字段但 trim 后为空 → 返回 `""`;缺 `text` 字段 / 非法 JSON → 仍抛 `IllegalStateException`。

- [ ] **Step 1: 改测试(TDD RED)**

`SttClientTest.java` 现有第 17 行:
```java
assertThrows(IllegalStateException.class, () -> SttClient.parseTranscription("{\"text\":\"   \"}"));
```
改为(空白 text → 空串,不抛):
```java
assertEquals("", SttClient.parseTranscription("{\"text\":\"   \"}"));
assertEquals("", SttClient.parseTranscription("{\"text\":\"\"}"));
```
保留第 14 行(缺字段抛)、第 20 行(畸形 JSON 抛)不动。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=SttClientTest -DfailIfNoTests=false test`
Expected: FAIL(当前实现对空白 text 抛 IllegalStateException,新断言期望 `""`)。

- [ ] **Step 3: 改实现**

`SttClient.java` `parseTranscription` 末尾:
```java
        JsonNode t = n == null ? null : n.get("text");
        if (t == null || t.isNull()) throw new IllegalStateException("转写响应无 text 字段");
        return t.asText().trim();   // 空/空白 → "";由调用方(前端)决定忽略,不再当错误
```
即删除 `if (s.isEmpty()) throw new IllegalStateException("转写结果为空");`,直接返回 trim 结果。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=SttClientTest -DfailIfNoTests=false test`
Expected: PASS(含缺字段/畸形仍抛的用例)。

- [ ] **Step 5: 提交**

```bash
git add src/main/java/com/lyhn/wraith/stt/SttClient.java src/test/java/com/lyhn/wraith/stt/SttClientTest.java
git commit -m "fix(stt): 空转写结果返回 \"\" 而非抛错(缺字段/畸形仍抛)——根治「转写结果为空」"
```

---

### Task 2: `VadSegmenter`(纯逻辑切段状态机)

**Files:**
- Create: `desktop/src/renderer/lib/vadSegmenter.ts`
- Test: `desktop/test/vadSegmenter.test.ts`

**Interfaces:**
- Produces:
  - `interface VadConfig { speechLevel: number; silenceHoldMs: number; maxSegmentMs: number; minSegmentMs: number }`
  - `const DEFAULT_VAD: VadConfig`
  - `interface VadDecision { cut: boolean; reason: 'silence' | 'maxlen' | null }`
  - `class VadSegmenter { constructor(cfg?: VadConfig); feed(level: number, dtMs: number): VadDecision; reset(): void }`

- [ ] **Step 1: 写失败测试**

`desktop/test/vadSegmenter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { VadSegmenter, DEFAULT_VAD } from '../src/renderer/lib/vadSegmenter'

const feedN = (seg: VadSegmenter, level: number, totalMs: number, stepMs = 100): (ReturnType<VadSegmenter['feed']>)[] => {
  const out = []
  for (let t = 0; t < totalMs; t += stepMs) out.push(seg.feed(level, stepMs))
  return out
}

describe('VadSegmenter', () => {
  it('有语音后静音累积到 silenceHoldMs → cut(silence)', () => {
    const s = new VadSegmenter()
    feedN(s, 0.5, 1000)                         // 1s 有声(> minSegmentMs)
    const during = feedN(s, 0.0, DEFAULT_VAD.silenceHoldMs - 100)  // 静音还不够
    expect(during.some(d => d.cut)).toBe(false)
    const d = s.feed(0.0, 200)                  // 再补静音越过阈值
    expect(d).toEqual({ cut: true, reason: 'silence' })
  })

  it('持续有声到 maxSegmentMs → cut(maxlen)', () => {
    const s = new VadSegmenter()
    const decisions = feedN(s, 0.5, DEFAULT_VAD.maxSegmentMs + 200)
    const cut = decisions.find(d => d.cut)
    expect(cut?.reason).toBe('maxlen')
  })

  it('太短(< minSegmentMs)即使静音也不 cut', () => {
    const s = new VadSegmenter()
    s.feed(0.5, 100)                            // 100ms 有声,远小于 minSegmentMs
    const d = s.feed(0.0, DEFAULT_VAD.silenceHoldMs + 100)
    expect(d.cut).toBe(false)
  })

  it('从未出现语音(纯静音)→ 不 cut', () => {
    const s = new VadSegmenter()
    const decisions = feedN(s, 0.0, DEFAULT_VAD.maxSegmentMs + 500)
    expect(decisions.every(d => !d.cut)).toBe(true)
  })

  it('reset 后重新计数', () => {
    const s = new VadSegmenter()
    feedN(s, 0.5, 1000); s.feed(0.0, DEFAULT_VAD.silenceHoldMs + 200)
    s.reset()
    const d = s.feed(0.0, DEFAULT_VAD.silenceHoldMs + 200)  // reset 后无语音 → 不 cut
    expect(d.cut).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/vadSegmenter.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`desktop/src/renderer/lib/vadSegmenter.ts`:
```typescript
export interface VadConfig {
  speechLevel: number   // 判定"有声"的 RMS 阈(0..1)
  silenceHoldMs: number // 触发切段的连续静音时长
  maxSegmentMs: number  // 单段封顶,强切
  minSegmentMs: number  // 太短不切,防碎段
}

export const DEFAULT_VAD: VadConfig = {
  speechLevel: 0.02,
  silenceHoldMs: 700,
  maxSegmentMs: 8000,
  minSegmentMs: 400,
}

export interface VadDecision {
  cut: boolean
  reason: 'silence' | 'maxlen' | null
}

/** 音量帧序列 → 切段决策。纯状态机,不碰 MediaRecorder / DOM。 */
export class VadSegmenter {
  private hasSpeech = false
  private silenceMs = 0
  private segmentMs = 0
  constructor(private readonly cfg: VadConfig = DEFAULT_VAD) {}

  /** 喂一帧:level 为该帧 RMS(0..1),dtMs 为距上帧毫秒。 */
  feed(level: number, dtMs: number): VadDecision {
    this.segmentMs += dtMs
    if (level >= this.cfg.speechLevel) { this.hasSpeech = true; this.silenceMs = 0 }
    else { this.silenceMs += dtMs }

    if (this.hasSpeech && this.segmentMs >= this.cfg.minSegmentMs) {
      if (this.silenceMs >= this.cfg.silenceHoldMs) return { cut: true, reason: 'silence' }
      if (this.segmentMs >= this.cfg.maxSegmentMs) return { cut: true, reason: 'maxlen' }
    }
    return { cut: false, reason: null }
  }

  reset(): void {
    this.hasSpeech = false
    this.silenceMs = 0
    this.segmentMs = 0
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/vadSegmenter.test.ts`
Expected: PASS(5 个用例)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/vadSegmenter.ts desktop/test/vadSegmenter.test.ts
git commit -m "feat(stt): VadSegmenter 纯逻辑切段状态机(静音/封顶/防碎段)"
```

---

### Task 3: `OrderedAppender`(乱序段结果 → 按序 flush)

**Files:**
- Create: `desktop/src/renderer/lib/orderedAppender.ts`
- Test: `desktop/test/orderedAppender.test.ts`

**Interfaces:**
- Produces: `class OrderedAppender { arrive(seq: number, text: string): string[] }` — seq 从 0 起;返回本次可按序输出的非空文本片段数组;空串段推进序号但不产出;缺口段暂存,待补齐再连续 flush。

- [ ] **Step 1: 写失败测试**

`desktop/test/orderedAppender.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { OrderedAppender } from '../src/renderer/lib/orderedAppender'

describe('OrderedAppender', () => {
  it('顺序到达顺序出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(0, 'hello')).toEqual(['hello'])
    expect(a.arrive(1, 'world')).toEqual(['world'])
  })

  it('乱序到达:后段先到先缓存,前段补齐后按序一起出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(1, 'world')).toEqual([])          // seq 1 先到 → 缓存
    expect(a.arrive(0, 'hello')).toEqual(['hello', 'world'])
  })

  it('空串段推进序号但不产出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(0, '')).toEqual([])               // 空段:静默跳过
    expect(a.arrive(1, 'hi')).toEqual(['hi'])         // 不被 seq 0 卡住
  })

  it('空段夹在中间也能让后段按序流出', () => {
    const a = new OrderedAppender()
    expect(a.arrive(2, 'c')).toEqual([])
    expect(a.arrive(0, 'a')).toEqual(['a'])
    expect(a.arrive(1, '')).toEqual(['c'])            // seq1 空 → 跳过,seq2 'c' 顺势流出
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/orderedAppender.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`desktop/src/renderer/lib/orderedAppender.ts`:
```typescript
/**
 * 分段转写结果按说话顺序 flush。段落带递增 seq(从 0);
 * arrive 存入并从 nextSeq 起连续输出已到达段的非空文本;空串段推进但不产出。
 */
export class OrderedAppender {
  private nextSeq = 0
  private readonly pending = new Map<number, string>()

  arrive(seq: number, text: string): string[] {
    this.pending.set(seq, text)
    const out: string[] = []
    while (this.pending.has(this.nextSeq)) {
      const t = this.pending.get(this.nextSeq) as string
      this.pending.delete(this.nextSeq)
      this.nextSeq++
      if (t) out.push(t)   // 空段:跳过,不产出
    }
    return out
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/orderedAppender.test.ts`
Expected: PASS(4 个用例)。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/orderedAppender.ts desktop/test/orderedAppender.test.ts
git commit -m "feat(stt): OrderedAppender 分段结果按序 flush(乱序缓存/空段跳过)"
```

---

### Task 4: Composer 分段录音驱动(替换单段录音)

**Files:**
- Modify: `desktop/src/renderer/components/Composer.tsx`

**Interfaces:**
- Consumes: `VadSegmenter`/`DEFAULT_VAD`(Task 2);`OrderedAppender`(Task 3);`micLevel`(`../lib/waveform`);`blobToBase64`/`insertAtCursor`(`../lib/dictation`);`window.wraith.transcribe`。
- Produces:(无对外导出;改 Composer 内部录音行为)。

**背景(当前代码,你要替换的部分):** `startRec` 建单个 `MediaRecorder`,`onstop` 里整段 base64→`transcribe`(带 30s 超时 race)→`insertAtCursor`,并有 60s 硬停 `stopTimerRef`。`stopRec` 停 `mediaRef`;`cancelRec` 置 `cancelledRef` 后停。`mountedRef`(#1)在授权返回后判卸载。保留 `mountedRef`/`streamRef`/`textareaRef`/`cancelledRef`、VoiceBars 接线、`setRecording`/`setTranscribing`/`setSttError`。

- [ ] **Step 1: 加导入 + 新 ref**

在 import 区加:
```typescript
import { VadSegmenter, DEFAULT_VAD } from '../lib/vadSegmenter'
import { OrderedAppender } from '../lib/orderedAppender'
import { micLevel } from '../lib/waveform'
```
在其它 ref 旁加:
```typescript
  const vadCtxRef = useRef<AudioContext | null>(null)
  const vadRafRef = useRef<number | null>(null)
  const vadRef = useRef<VadSegmenter | null>(null)
  const appenderRef = useRef<OrderedAppender | null>(null)
  const segSeqRef = useRef(0)
  const stoppingRef = useRef(false)   // true=会话结束,onstop 不再 restart
  const insertPosRef = useRef<number | null>(null)  // 追加插入点(随每段前移)
```
把 unmount 清理 effect 扩展为一并清 VAD:
```typescript
  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current)
    void vadCtxRef.current?.close()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])
```

- [ ] **Step 2: 段结果按序追加 helper**

在组件内加(把一段转写结果按序写进输入框):
```typescript
  // 段落转写完成 → 按序 flush → 依次插入到追加点(段间空格分隔)
  const flushSegment = useCallback((seq: number, text: string) => {
    const ready = (appenderRef.current ??= new OrderedAppender()).arrive(seq, text.trim())
    if (ready.length === 0) return
    const ta = textareaRef.current
    let cur = ta?.value ?? value
    let pos = insertPosRef.current ?? (ta?.selectionStart ?? cur.length)
    for (const piece of ready) {
      const prefix = pos > 0 && !/\s$/.test(cur.slice(0, pos)) ? ' ' : ''
      const r = insertAtCursor(cur, pos, pos, prefix + piece)
      cur = r.value; pos = r.caret
    }
    insertPosRef.current = pos
    onChange(cur)
    requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(pos, pos) })
  }, [value, onChange])
```

- [ ] **Step 3: 单段转写(fire-and-forget,带 seq + 超时兜底 + 失败当空段)**

```typescript
  const transcribeSegment = useCallback(async (seq: number, blob: Blob, mime: string) => {
    try {
      const b64 = await blobToBase64(blob)
      const { text } = await Promise.race([
        window.wraith.transcribe(b64, mime),
        new Promise<{ text: string }>((_, rej) => setTimeout(() => rej(new Error('转写超时')), 30_000)),
      ])
      flushSegment(seq, text)
    } catch (err) {
      console.warn('[stt] 段转写失败,跳过:', (err as Error).message)
      flushSegment(seq, '')   // 失败当空段:推进序号,不插入、不弹全局错
    }
  }, [flushSegment])
```

- [ ] **Step 4: 开一段录音(每段一个完整 MediaRecorder)**

```typescript
  // 开启下一段录音:每段独立 MediaRecorder,stop 时产出完整可解码 webm。
  const startSegment = useCallback(() => {
    const stream = streamRef.current
    if (!stream || stoppingRef.current) return
    const mr = new MediaRecorder(stream)
    const seq = segSeqRef.current++
    const chunks: Blob[] = []
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = () => {
      const mime = mr.mimeType || 'audio/webm'
      if (!cancelledRef.current && chunks.length > 0) {
        void transcribeSegment(seq, new Blob(chunks, { type: mime }), mime)
      }
      if (!stoppingRef.current && !cancelledRef.current) startSegment()   // 继续下一段
    }
    mr.start()
    mediaRef.current = mr
  }, [transcribeSegment])
```

- [ ] **Step 5: VAD 循环 + 会话开始/停止/取消**

替换现有 `startRec`/`stopRec`/`cancelRec`:
```typescript
  const stopVadLoop = useCallback(() => {
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null }
    void vadCtxRef.current?.close(); vadCtxRef.current = null
  }, [])

  const stopRec = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null }
    stoppingRef.current = true            // onstop 不再 restart
    stopVadLoop()
    mediaRef.current?.stop()              // flush 最后一段
    setRecording(false)
  }, [stopVadLoop])

  const cancelRec = useCallback(() => {
    cancelledRef.current = true
    stopRec()
  }, [stopRec])

  const startRec = useCallback(async () => {
    setSttError(null)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }   // #1
      streamRef.current = stream
      cancelledRef.current = false
      stoppingRef.current = false
      segSeqRef.current = 0
      insertPosRef.current = textareaRef.current?.selectionStart ?? null
      appenderRef.current = new OrderedAppender()
      vadRef.current = new VadSegmenter(DEFAULT_VAD)

      // VAD 循环:独立 AudioContext+Analyser(与 VoiceBars 并存);算 level 喂 vad,cut→切段
      try {
        const ctx = new AudioContext()
        vadCtxRef.current = ctx
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        src.connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        let last = performance.now()
        const tick = (): void => {
          const now = performance.now()
          const dt = now - last; last = now
          analyser.getByteTimeDomainData(data)
          const d = vadRef.current?.feed(micLevel(data), dt)
          if (d?.cut) { vadRef.current?.reset(); mediaRef.current?.stop() }  // 切段:stop→onstop 转写+restart
          vadRafRef.current = requestAnimationFrame(tick)
        }
        vadRafRef.current = requestAnimationFrame(tick)
      } catch {
        // AudioContext 不可用 → 无 VAD,退化为单段(靠会话上限/手动停)
      }

      startSegment()
      setRecording(true)
      stopTimerRef.current = setTimeout(() => stopRec(), 300_000)   // 宽松会话总上限 5min 防跑飞
    } catch {
      stream?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setSttError('无法访问麦克风,请在系统设置里授权')
    }
  }, [startSegment, stopRec])
```

**注意:stream 释放。** 原单段 `onstop` 里 `streamRef.current?.getTracks().forEach(stop)` 会在**每段**结束时杀掉 stream——分段模式绝不能这样,否则第二段没麦克风。stream 只在**会话结束/取消/卸载**时释放。在 `stopRec` 之后(会话真正结束)释放:把 stream 清理移到一个"最终段结束"点——最简做法:在 `startSegment` 的 `mr.onstop` 里,当 `stoppingRef.current` 为真(不再 restart)时,才释放 stream:
```typescript
    mr.onstop = () => {
      const mime = mr.mimeType || 'audio/webm'
      if (!cancelledRef.current && chunks.length > 0) {
        void transcribeSegment(seq, new Blob(chunks, { type: mime }), mime)
      }
      if (!stoppingRef.current && !cancelledRef.current) { startSegment(); return }
      // 会话结束/取消:释放 stream(最后一段已在上面提交转写)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
```
(采用此版 `mr.onstop`;删除原单段 onstop 里"每段杀 stream"的逻辑。)

- [ ] **Step 6: 门禁(UI 无单测,靠类型+构建+眼验)**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: typecheck 0;vitest 全绿(含 Task 2/3 新测);build ✓。
(录音/MediaRecorder 生命周期无法在 vitest 验,靠收尾眼验。)

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/Composer.tsx
git commit -m "feat(stt): Composer 分段录音——VAD 停顿切段 + 逐段转写按序追加(边说边出)"
```

---

## 收尾:重建部署 jar + 眼验

- [ ] **Step 1: 全量门禁**
```bash
cd desktop && npm run typecheck && npx vitest run && npm run build
cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=SttClientTest -DfailIfNoTests=false test
```
- [ ] **Step 2: 重建 + 部署**
```bash
cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar
```
- [ ] **Step 3: 眼验清单**(重启桌面)
  - 点麦克风开始 → 说一句、停一下 → 那句**在停顿后不久出现在输入框**;继续说下一句 → 逐段追加、顺序正确。
  - 长句不停顿 → ~8s 自动切段出字。
  - 中间静默/没说话 → 不插入、**不再弹「转写结果为空」**。
  - 点停止 → 最后一段 flush;取消 → 不插入、麦克风释放(状态栏/系统麦克风指示灯灭)。
  - VAD 阈值观感:若切得太碎或太迟,调 `DEFAULT_VAD` 的 `silenceHoldMs`/`speechLevel`(记为眼验后微调项)。

---

## Self-Review

**Spec coverage:** §1 总览→Task4;§2 分段引擎→Task2(VAD)+Task4(stop/restart 驱动);§3 按序追加→Task3+Task4 flushSegment;§4 空结果→Task1(后端)+Task4(失败/空当空段);§5 错误/取消/上限→Task4(transcribeSegment catch、cancelRec、5min 会话上限);§6 指示→保留 setTranscribing/VoiceBars(Task4 未破坏)。测试→Task1(SttClientTest)+Task2/3 vitest。全覆盖。

**Placeholder scan:** 无 TBD/TODO;所有 step 有完整代码或精确命令。Task4 的 stream 释放注意点给了具体 onstop 版本,非占位。

**Type consistency:** `VadSegmenter.feed(level,dtMs)→VadDecision{cut,reason}`、`DEFAULT_VAD`、`OrderedAppender.arrive(seq,text)→string[]`、`micLevel(Uint8Array)→number`、`transcribeSegment(seq,blob,mime)`、`flushSegment(seq,text)`、`startSegment()`、`stoppingRef`/`cancelledRef`/`segSeqRef`/`insertPosRef`/`appenderRef`/`vadRef`/`vadCtxRef`/`vadRafRef` 跨 step 一致。`window.wraith.transcribe→{text}` 与现有一致。
