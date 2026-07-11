import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X, Folder } from 'lucide-react'
import { Switch } from './ui/switch'
import {
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'
import { blobToBase64, insertAtCursor } from '../lib/dictation'
import VoiceBars from './VoiceBars'
import { shouldSendOnEnter } from '../../shared/composerKeys'
import StatusChip from './StatusChip'
import ModelSwitcher from './ModelSwitcher'
import ModeSwitcher from './ModeSwitcher'
import type { StatusData, McpResourceView, RunMode } from '../../shared/types'
import { detectMention, filterMentionItems, insertMention } from '../../shared/mentionTrigger'
import type { MentionState } from '../../shared/mentionTrigger'
import { isImageMime, imageExtFromMime, pathsToAttachments } from '../lib/composerAttachments'
import { VadSegmenter, DEFAULT_VAD } from '../lib/vadSegmenter'
import { OrderedAppender } from '../lib/orderedAppender'
import { micLevel } from '../lib/waveform'

export interface AttachmentItem {
  path: string
  name: string
  kind: string
}

interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  running: boolean
  approvalAuto: boolean
  onToggleApproval: (auto: boolean) => void
  model: string
  workspace: string
  onSwitchWorkspace: () => void
  /** 欢迎态用居中窄版，对话态用贴底宽版。 */
  centered?: boolean
  status?: StatusData | null
  resources?: McpResourceView[]
  attachments?: AttachmentItem[]
  onPickAttachments?: () => void
  onRemoveAttachment?: (index: number) => void
  onAddAttachments?: (items: AttachmentItem[]) => void
  onModelSwitched?: (model: string) => void
  mode?: RunMode
  onModeChange?: (m: RunMode) => void
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  onInterrupt,
  running,
  approvalAuto,
  onToggleApproval,
  model,
  workspace,
  onSwitchWorkspace,
  centered = false,
  status,
  resources = [],
  attachments = [],
  onPickAttachments,
  onRemoveAttachment,
  onAddAttachments,
  onModelSwitched,
  mode = 'react',
  onModeChange,
}: ComposerProps): JSX.Element {
  const [mention, setMention] = useState<MentionState>({ active: false, start: 0, query: '' })
  const [mentionIndex, setMentionIndex] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const previewReqRef = useRef<Set<string>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [sttError, setSttError] = useState<string | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cancelledRef = useRef(false)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // 分段录音新增 ref
  const vadCtxRef = useRef<AudioContext | null>(null)
  const vadRafRef = useRef<number | null>(null)
  const vadRef = useRef<VadSegmenter | null>(null)
  const appenderRef = useRef<OrderedAppender | null>(null)
  const segSeqRef = useRef(0)
  const stoppingRef = useRef(false)   // true=会话结束，onstop 不再 restart
  const insertPosRef = useRef<number | null>(null)  // 追加插入点（随每段前移）
  const inFlightRef = useRef(0)                      // 飞行中转写段计数

  // 挂载/重挂载清理：每次 mount 重置 mountedRef；cleanup 释放 VAD + stream
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

  const items = mention.active ? filterMentionItems(resources, mention.query) : []
  const popoverOpen = mention.active && items.length > 0

  // 为图片附件按需拉取缩略图 data:URL(每条只拉一次)
  useEffect(() => {
    let cancelled = false
    for (const a of attachments) {
      if (a.kind !== 'image' || previewReqRef.current.has(a.path)) continue
      previewReqRef.current.add(a.path)
      void window.wraith.readImageDataUrl(a.path).then(url => {
        if (!cancelled && url) setPreviews(prev => ({ ...prev, [a.path]: url }))
      }).catch(() => { /* 读失败:退回只显示文件名 */ })
    }
    return () => { cancelled = true }
  }, [attachments])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // @-mention popover interception — before shouldSendOnEnter
      // IME guard: composing Enter must never select a mention
      if (popoverOpen && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % items.length); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + items.length) % items.length); return }
        if (e.key === 'Escape') { e.preventDefault(); setMention({ active: false, start: 0, query: '' }); return }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          const it = items[mentionIndex]
          if (it) {
            const r = insertMention(value, mention, it.insert)
            onChange(r.next)
            setMention(detectMention(r.next, r.caret))
            // restore caret to insertion point
            requestAnimationFrame(() => textareaRef.current?.setSelectionRange(r.caret, r.caret))
          }
          return
        }
      }
      // IME 选词确认的 Enter(isComposing/keyCode 229)绝不发送;running 中也不发送
      if (
        shouldSendOnEnter(
          { key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode },
          running,
        )
      ) {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit, running, popoverOpen, items, mentionIndex, mention, value, onChange],
  )

  // 粘贴图片:剪贴板含 image blob → 落临时文件成附件;纯文本粘贴不拦(照常插入)
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (running) return
    const imgItems = Array.from(e.clipboardData?.items ?? []).filter(
      it => it.kind === 'file' && isImageMime(it.type),
    )
    if (imgItems.length === 0) return
    e.preventDefault()
    setAttachError(null)
    const added: AttachmentItem[] = []
    for (const it of imgItems) {
      const file = it.getAsFile()
      const ext = file && imageExtFromMime(file.type)
      if (!file || !ext) continue
      try {
        const b64 = await blobToBase64(file)
        added.push(await window.wraith.saveTempImage(b64, ext))
      } catch (err) {
        setAttachError('图片粘贴失败:' + (err as Error).message)
      }
    }
    if (added.length > 0) onAddAttachments?.(added)
  }, [running, onAddAttachments])

  // 拖拽:OS 文件有磁盘路径(Electron 32 经 webUtils 取);无路径(如浏览器拖图)回退到 blob→临时文件
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (running) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return
    setAttachError(null)
    const paths: string[] = []
    const blobFallback: File[] = []
    for (const f of files) {
      let p = ''
      try { p = window.wraith.pathForFile(f) || '' } catch { p = '' }
      if (p) paths.push(p)
      else if (isImageMime(f.type)) blobFallback.push(f)  // 取不到路径的图:走 blob→临时文件
    }
    const added: AttachmentItem[] = pathsToAttachments(paths)
    for (const f of blobFallback) {
      const ext = imageExtFromMime(f.type)
      if (!ext) continue
      try {
        const b64 = await blobToBase64(f)
        added.push(await window.wraith.saveTempImage(b64, ext))
      } catch (err) {
        setAttachError('图片拖入失败:' + (err as Error).message)
      }
    }
    if (added.length > 0) onAddAttachments?.(added)
  }, [running, onAddAttachments])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (running) return
    if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }, [running])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 只在真正离开容器(而非进入子元素)时收起高亮
    if (e.currentTarget === e.target) setDragOver(false)
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
  }, [value, onChange])

  // 单段转写（fire-and-forget）：失败/空段当空处理，不弹全局错，不中断会话
  // inFlightRef 计数驱动 transcribing 状态：任一段飞行中则 true，全落地则 false
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
      flushSegment(seq, '')   // 失败当空段：推进序号，不插入、不弹全局错
    } finally {
      inFlightRef.current--
      if (inFlightRef.current <= 0) { inFlightRef.current = 0; setTranscribing(false) }
    }
  }, [flushSegment])

  // 开启下一段录音：每段独立 MediaRecorder，stop 时产出完整可解码 webm
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
      // 会话结束/取消：释放 stream（最后一段已在上面提交转写）
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
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }   // #1: 授权期间已卸载→释放
      streamRef.current = stream
      cancelledRef.current = false
      stoppingRef.current = false
      segSeqRef.current = 0
      insertPosRef.current = textareaRef.current?.selectionStart ?? null
      appenderRef.current = new OrderedAppender()
      vadRef.current = new VadSegmenter(DEFAULT_VAD)

      // VAD 循环：独立 AudioContext+Analyser（与 VoiceBars 并存）；算 level 喂 vad，cut→切段
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
          if (d?.cut) { vadRef.current?.reset(); mediaRef.current?.stop() }  // 切段：stop→onstop 转写+restart
          vadRafRef.current = requestAnimationFrame(tick)
        }
        vadRafRef.current = requestAnimationFrame(tick)
      } catch {
        // AudioContext 不可用 → 无 VAD，退化为单段（靠会话上限/手动停）
      }

      startSegment()
      setRecording(true)
      stopTimerRef.current = setTimeout(() => stopRec(), 300_000)   // 宽松会话总上限 5min 防跑飞
    } catch {
      stream?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setSttError('无法访问麦克风，请在系统设置里授权')
    }
  }, [startSegment, stopRec])

  return (
    <TooltipProvider delayDuration={200}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={
          'relative w-full rounded-2xl border bg-surface shadow-md transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 ' +
          (dragOver ? 'border-accent ring-2 ring-accent/40 ' : 'border-fg-subtle/40 ') +
          (centered ? 'max-w-2xl mx-auto' : '')
        }
      >
        {dragOver && (
          <div data-testid="drop-hint"
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-accent/5 text-xs font-medium text-accent">
            松手添加为附件
          </div>
        )}
        {/* @-mention popover */}
        {popoverOpen && (
          <div data-testid="mention-popover"
            className="absolute bottom-full left-3 z-40 mb-1 max-h-56 w-96 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md">
            {items.map((it, i) => (
              <button key={it.insert} data-testid="mention-item"
                onMouseDown={e => {
                  e.preventDefault() // 不丢 textarea 焦点
                  const r = insertMention(value, mention, it.insert)
                  onChange(r.next)
                  setMention(detectMention(r.next, r.caret))
                  requestAnimationFrame(() => textareaRef.current?.setSelectionRange(r.caret, r.caret))
                }}
                className={'flex w-full flex-col rounded-md px-2 py-1.5 text-left ' + (i === mentionIndex ? 'bg-bg' : 'hover:bg-bg/60')}>
                <span className="font-mono text-xs text-fg">{it.label}</span>
                <span className="text-2xs text-fg-subtle">{it.hint}</span>
              </button>
            ))}
          </div>
        )}

        {/* attachment chips row — 仅在有附件时显示(输入框上方) */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((a, i) => {
              const preview = a.kind === 'image' ? previews[a.path] : undefined
              return (
                <span
                  key={a.path + i}
                  data-testid="attachment-chip"
                  title={a.name}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg"
                >
                  {preview && (
                    <img
                      data-testid="attachment-thumb"
                      src={preview}
                      alt={a.name}
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  )}
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <button
                    data-testid="attachment-remove"
                    aria-label={`移除 ${a.name}`}
                    onClick={() => onRemoveAttachment?.(i)}
                    className="ml-0.5 shrink-0 text-fg-subtle hover:text-fg"
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {sttError && (
          <div data-testid="stt-error" className="px-3 pt-2 text-2xs text-danger">
            {sttError}
            {sttError.includes('未配置') && <span className="text-fg-subtle">（到 Provider 配置里填 SiliconFlow 的 key）</span>}
          </div>
        )}

        {attachError && (
          <div data-testid="attach-error" className="px-3 pt-2 text-2xs text-danger">{attachError}</div>
        )}

        {/* text row */}
        <textarea
          ref={textareaRef}
          data-testid="input"
          value={value}
          onChange={e => {
            onChange(e.target.value)
            setMention(detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length))
            setMentionIndex(0)
          }}
          onKeyDown={handleKeyDown}
          onPaste={e => { void handlePaste(e) }}
          placeholder="给 Wraith 一个目标… (Enter 发送, Shift+Enter 换行)"
          rows={centered ? 3 : 2}
          className="w-full resize-none bg-transparent px-4 pt-3 text-sm text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
        />

        {/* control row */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          {/* attach — functional */}
          <button
            data-testid="attach"
            disabled={running}
            aria-label="附件"
            onClick={onPickAttachments}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          {/* 语音听写 */}
          {!recording && !transcribing && (
            <button
              data-testid="stt-mic"
              disabled={running}
              aria-label="语音输入"
              title="按一下开始说话,再按停止转写"
              onClick={() => void startRec()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <VoiceBars active={false} streamRef={streamRef} />
            </button>
          )}
          {recording && (
            <div className="flex shrink-0 items-center gap-1">
              <button data-testid="stt-stop" onClick={stopRec} aria-label="停止并转写"
                className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-danger/10 px-2 text-xs text-danger">
                <VoiceBars active streamRef={streamRef} /> 停止
              </button>
              <button data-testid="stt-cancel" onClick={cancelRec} aria-label="取消"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:text-fg">
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          )}
          {transcribing && (
            <span data-testid="stt-transcribing" className="shrink-0 whitespace-nowrap text-xs text-fg-muted">转写中…</span>
          )}

          {/* model chip — interactive switcher */}
          <ModelSwitcher initialModel={model} running={running} onSwitched={onModelSwitched} />

          {/* token 状态 — status 事件驱动 */}
          <StatusChip status={status} />

          {/* workspace switch — functional */}
          <button
            data-testid="workspace-switch"
            onClick={onSwitchWorkspace}
            disabled={running}
            title="重选工作目录"
            className="flex min-w-0 max-w-[180px] items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Folder className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{baseName(workspace)}</span>
          </button>

          <div className="flex-1" />

          {/* 执行模式:下拉选择(逐条) */}
          <ModeSwitcher mode={mode} onModeChange={onModeChange} running={running} />

          {/* approve-mode toggle — functional */}
          <label className="flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
            替我审批
            <Switch
              data-testid="approval-toggle"
              checked={approvalAuto}
              onCheckedChange={onToggleApproval}
            />
          </label>

          {running && (
            <button
              data-testid="interrupt"
              onClick={onInterrupt}
              className="shrink-0 whitespace-nowrap rounded-lg border border-danger px-3 py-1 text-xs text-danger hover:bg-danger/10"
            >
              中断
            </button>
          )}

          <button
            onClick={onSubmit}
            disabled={running || recording || transcribing || !value.trim()}
            className="shrink-0 whitespace-nowrap rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}
