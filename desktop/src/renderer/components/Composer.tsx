import { useCallback, useEffect, useRef, useState } from 'react'
import { Switch } from './ui/switch'
import {
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'
import { blobToBase64, insertAtCursor } from '../lib/dictation'
import { shouldSendOnEnter } from '../../shared/composerKeys'
import StatusChip from './StatusChip'
import ModelSwitcher from './ModelSwitcher'
import ModeSwitcher from './ModeSwitcher'
import type { StatusData, McpResourceView, RunMode } from '../../shared/types'
import { detectMention, filterMentionItems, insertMention } from '../../shared/mentionTrigger'
import type { MentionState } from '../../shared/mentionTrigger'

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
  mode = 'react',
  onModeChange,
}: ComposerProps): JSX.Element {
  const [mention, setMention] = useState<MentionState>({ active: false, start: 0, query: '' })
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [sttError, setSttError] = useState<string | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const items = mention.active ? filterMentionItems(resources, mention.query) : []
  const popoverOpen = mention.active && items.length > 0

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
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      cancelledRef.current = false
      mr.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        if (cancelledRef.current) { setRecording(false); return }
        setRecording(false); setTranscribing(true)
        try {
          const mime = mr.mimeType || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type: mime })
          const b64 = await blobToBase64(blob)
          const { text } = await window.wraith.transcribe(b64, mime)
          const ta = textareaRef.current
          const cur = ta?.value ?? value
          const s = ta?.selectionStart ?? cur.length
          const en = ta?.selectionEnd ?? cur.length
          const r = insertAtCursor(cur, s, en, text)
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
      stream?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setSttError('无法访问麦克风,请在系统设置里授权')
    }
  }, [value, onChange, stopRec])

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={
          'relative w-full rounded-2xl border border-fg-subtle/40 bg-surface shadow-md transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 ' +
          (centered ? 'max-w-2xl mx-auto' : '')
        }
      >
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
            {attachments.map((a, i) => (
              <span
                key={a.path + i}
                data-testid="attachment-chip"
                className="flex max-w-[200px] items-center gap-1 rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-fg"
              >
                <span className="truncate">{a.name}</span>
                <button
                  data-testid="attachment-remove"
                  aria-label={`移除 ${a.name}`}
                  onClick={() => onRemoveAttachment?.(i)}
                  className="ml-0.5 shrink-0 text-fg-subtle hover:text-fg"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {sttError && (
          <div data-testid="stt-error" className="px-3 pt-2 text-2xs text-danger">
            {sttError}
            {sttError.includes('未配置') && <span className="text-fg-subtle">（到 Provider 配置里填 SiliconFlow 的 key）</span>}
          </div>
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
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            +
          </button>

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

          {/* model chip — interactive switcher */}
          <ModelSwitcher initialModel={model} running={running} />

          {/* token 状态 — status 事件驱动 */}
          <StatusChip status={status} />

          {/* workspace switch — functional */}
          <button
            data-testid="workspace-switch"
            onClick={onSwitchWorkspace}
            disabled={running}
            title="重选工作目录"
            className="max-w-[180px] truncate rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            📁 {baseName(workspace)}
          </button>

          <div className="flex-1" />

          {/* 执行模式:下拉选择(逐条) */}
          <ModeSwitcher mode={mode} onModeChange={onModeChange} running={running} />

          {/* approve-mode toggle — functional */}
          <label className="flex select-none items-center gap-1.5 text-xs text-fg-muted">
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
              className="rounded-lg border border-danger px-3 py-1 text-xs text-danger hover:bg-danger/10"
            >
              中断
            </button>
          )}

          <button
            onClick={onSubmit}
            disabled={running || recording || transcribing || !value.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}
