import { useCallback, useEffect, useRef, useState } from 'react'
import { blobToBase64, insertAtCursor } from './dictation'
import { VadSegmenter, DEFAULT_VAD } from './vadSegmenter'
import { OrderedAppender } from './orderedAppender'
import { micLevel } from './waveform'

export interface UseVoiceRecordingOptions {
  /** 当前输入值 */
  value: string
  /** 更新输入值 */
  onChange: (v: string) => void
  /** textarea 引用(用于获取光标位置、聚焦) */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export interface UseVoiceRecordingReturn {
  /** 是否正在录音 */
  recording: boolean
  /** 是否正在转写中(有段在飞行) */
  transcribing: boolean
  /** 录音/转写错误信息 */
  sttError: string | null
  /** MediaStream 引用(供 VoiceBars 可视化使用) */
  streamRef: React.MutableRefObject<MediaStream | null>
  /** 启动录音(VAD 分段) */
  startRecording: () => void
  /** 停止录音(等最后一段转写完成) */
  stopRecording: () => void
  /** 取消录音(丢弃所有段) */
  cancelRecording: () => void
}

/**
 * 语音分段录音 hook:MediaRecorder 按 VAD 静音切段,每段独立转写,
 * OrderedAppender 保证按序回填到 textarea 光标位置。
 *
 * 设计约束:
 * - 段间用单空格分隔,insertPosRef 随每段前移,确保连续写入不覆盖
 * - VAD 独立 AudioContext,与 VoiceBars 的可视化流并存
 * - 5 分钟会话总上限防跑飞,stopTimerRef 到点自动停
 * - transcribing 状态由 inFlightRef 驱动:任一段飞行中则 true
 */
export function useVoiceRecording(opts: UseVoiceRecordingOptions): UseVoiceRecordingReturn {
  const { value, onChange, textareaRef } = opts

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [sttError, setSttError] = useState<string | null>(null)

  // MediaRecorder / stream 引用
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cancelledRef = useRef(false)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // VAD 分段相关
  const vadCtxRef = useRef<AudioContext | null>(null)
  const vadRafRef = useRef<number | null>(null)
  const vadRef = useRef<VadSegmenter | null>(null)
  const appenderRef = useRef<OrderedAppender | null>(null)
  const segSeqRef = useRef(0)
  const stoppingRef = useRef(false)   // true=会话结束,onstop 不再 restart
  const insertPosRef = useRef<number | null>(null)
  const inFlightRef = useRef(0)

  // 清理:每次 mount 重置 mountedRef;cleanup 释放 VAD + stream
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current)
      void vadCtxRef.current?.close()
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  // 段落转写完成 → 按序 flush → 依次插入到追加点（段间空格分隔）
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
  }, [value, onChange, textareaRef])

  // 单段转写（fire-and-forget）：失败/空段当空处理
  const transcribeSegment = useCallback(async (seq: number, blob: Blob, mime: string) => {
    inFlightRef.current++
    setTranscribing(true)
    try {
      const b64 = await blobToBase64(blob)
      const { text } = await Promise.race([
        window.wraith.transcribe(b64, mime),
        new Promise<{ text: string }>((_, rej) => setTimeout(() => rej(new Error('转写超时')), 30_000)),
      ])
      flushSegment(seq, text)
    } catch (err) {
      console.warn('[stt] 段转写失败，跳过:', (err as Error).message)
      flushSegment(seq, '')
    } finally {
      inFlightRef.current--
      if (inFlightRef.current <= 0) { inFlightRef.current = 0; setTranscribing(false) }
    }
  }, [flushSegment])

  // 开启下一段录音：每段独立 MediaRecorder
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
      if (!stoppingRef.current && !cancelledRef.current) { startSegment(); return }
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    mr.start()
    mediaRef.current = mr
  }, [transcribeSegment])

  const stopVadLoop = useCallback(() => {
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null }
    void vadCtxRef.current?.close(); vadCtxRef.current = null
  }, [])

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null }
    stoppingRef.current = true
    stopVadLoop()
    mediaRef.current?.stop()
    setRecording(false)
  }, [stopVadLoop])

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true
    stopRecording()
  }, [stopRecording])

  const startRecording = useCallback(async () => {
    setSttError(null)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      cancelledRef.current = false
      stoppingRef.current = false
      segSeqRef.current = 0
      insertPosRef.current = textareaRef.current?.selectionStart ?? null
      appenderRef.current = new OrderedAppender()
      vadRef.current = new VadSegmenter(DEFAULT_VAD)

      // VAD 循环
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
          if (d?.cut) { vadRef.current?.reset(); mediaRef.current?.stop() }
          vadRafRef.current = requestAnimationFrame(tick)
        }
        vadRafRef.current = requestAnimationFrame(tick)
      } catch {
        // AudioContext 不可用 → 无 VAD，退化为单段
      }

      startSegment()
      setRecording(true)
      stopTimerRef.current = setTimeout(() => stopRecording(), 300_000)
    } catch {
      stream?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setSttError('无法访问麦克风，请在系统设置里授权')
    }
  }, [startSegment, stopRecording, textareaRef])

  return {
    recording,
    transcribing,
    sttError,
    streamRef,
    startRecording,
    stopRecording,
    cancelRecording,
  }
}
