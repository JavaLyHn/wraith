# 设计：语音听写波形图标（音频驱动「海浪」）+ 两个延后修复

日期：2026-07-07
范围：桌面渲染层。分支 `feat/stt-waveform`（off main，main 已含 STT 本地合并）。零后端，jar 不变。

## 问题 / 目标

STT 听写按钮当前是 🎙 emoji。要求换成**几根竖线的波形图标**：静止时是静态竖条；**录音时竖条随实时音量起伏、呈流动的「海浪」感**。同时把 STT 终审延后的两个修复一并做掉：
- **#1**：`getUserMedia` 授权期间组件 unmount → 后到的麦克风流不释放（窄泄漏）。
- **#2**：`transcribing` 无渲染层超时上限（仅靠 Java 60s/15s 兜底，RPC 层卡死则无限）。

## 非目标（YAGNI）

- 不做频谱/多色炫技可视化；就是 N 根竖条的行波。
- 不改转写后端 / RPC / 配置。
- 不做录音波形回放、不存音频。

## 现有结构（锚点）

`desktop/src/renderer/components/Composer.tsx`（main 上的 STT 版）：
- refs：`streamRef`（录音中持有 MediaStream，`startRec` 里 `setRecording(true)` 前已赋值）、`mediaRef`、`stopTimerRef`、`cancelledRef`；unmount `useEffect` 已停 stream + 清 timer（:70-73）。
- `startRec`（:124-164）：`getUserMedia` → `streamRef.current = stream` → `MediaRecorder` → `onstop` 转写；外层 catch 停流。
- mic 按钮 JSX（:254-274）：`!recording && !transcribing` 显 🎙 按钮；`recording` 显「录音中·停止」+ × 取消；`transcribing` 显「转写中…」。

## 设计

### 1. `lib/waveform.ts`（纯函数,可测）
```ts
/** 时域数据(0-255,中心128)→ RMS 音量 [0,1]。 */
export function micLevel(timeData: Uint8Array): number
/** 行波竖条高度:sin 沿竖条空间偏移 + 随 phase 推进 = 海浪;振幅随 level 涨。返回 n 个 [0.1,1]。 */
export function waveBars(level: number, phase: number, n: number): number[]
/** 静止态图案:n 个固定高度 (0,1]。 */
export function idleBars(n: number): number[]
```
- `micLevel`：`sqrt(mean(((v-128)/128)^2))`,clamp [0,1]。
- `waveBars`：每根 `h = 0.2 + amp * (0.5 + 0.5*sin(phase + i*spacing))`,`amp = 0.15 + level*0.85`（保证录音时始终有基础流动),clamp [0.1,1]。
- `idleBars`：对称柔和图案(如 n=5 → [.4,.7,1,.6,.45])。

### 2. `components/VoiceBars.tsx`
Props：`{ active: boolean; getStream: () => MediaStream | null; barCount?: number }`（默认 5）。
- 渲染 `barCount` 根 `<span>` 竖条,各持 ref;颜色 `bg-current`（继承父按钮文字色）,底部对齐、圆角。
- **静止**（active=false）：高度取 `idleBars`,无动画。
- **录音**（active=true）：`useEffect` 读 `getStream()` → `new AudioContext()` + `AnalyserNode`(fftSize 小,如 256) + `createMediaStreamSource(stream)`;`requestAnimationFrame` 循环:`getByteTimeDomainData` → `micLevel` → `waveBars(level, phase, n)` → **直接写各 bar ref 的 `style.height`**（不每帧 setState）;`phase += ~0.15`/帧。
- **清理**：`active` 变 false / unmount → `cancelAnimationFrame` + `audioCtx.close()`;不触碰 stream（stream 生命周期归 Composer 的录音逻辑）。
- getStream 失败/AudioContext 不可用 → 静默回落到静止竖条（不报错）。

### 3. Composer 接线 + #1 + #2
- import `VoiceBars`。mic 按钮内容 🎙 → `<VoiceBars active={false} getStream={() => null} />`;录音按钮内「脉冲点」→ `<VoiceBars active getStream={() => streamRef.current} />`（× 取消保留）。按钮尺寸/testid（`stt-mic`/`stt-stop`/`stt-cancel`）不变。
- **#1**：加 `const mountedRef = useRef(true)`;unmount `useEffect` 里置 `mountedRef.current = false`;`startRec` 中 `await getUserMedia` 后：`if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }`。
- **#2**：`onstop` 里 transcribe 调用改
  ```ts
  const { text } = await Promise.race([
    window.wraith.transcribe(b64, mime),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('转写超时,请重试')), 30_000)),
  ])
  ```

## 测试 / 门禁

- **vitest `waveform.test.ts`**：`micLevel`（全 128→~0;大偏差→接近 1）;`waveBars`（返回 n 个、全在 [0.1,1]、level 越大跨度越大、给定输入确定）;`idleBars`（n 个、(0,1]）。
- **typecheck + build**：VoiceBars + Composer 接线;AudioContext/rAF 类型。
- **眼验**：静止显静态竖条;点录音 → 竖条随说话起伏、有行波海浪感、停顿时浪平;停止/取消/卸载不残留动画或麦克风;#2 断网/后端卡死时 30s 后转写态自动解除报错。

## 风险

- 每帧 setState 会卡 → 用 ref 直写 `style.height` 规避（已在设计里）。
- `AudioContext` 未 close 会泄漏音频资源 → active=false/unmount 必 close（设计已含）。
- Electron/Chromium `AudioContext` + `getByteTimeDomainData` 支持完整,低风险。

## 安全
无密钥面,纯前端可视化。不新增网络/存储。
