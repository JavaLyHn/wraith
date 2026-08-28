import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X, Folder } from 'lucide-react'
import { Switch } from './ui/switch'
import {
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'
import { blobToBase64 } from '../lib/dictation'
import VoiceBars from './VoiceBars'
import { shouldSendOnEnter } from '../../shared/composerKeys'
import StatusChip from './StatusChip'
import ModelSwitcher from './ModelSwitcher'
import ModeSwitcher from './ModeSwitcher'
import type { StatusData, McpResourceView, RunMode } from '../../shared/types'
import type { WatermarkView } from './StatusChip'
import { isImageMime, imageExtFromMime, pathsToAttachments } from '../lib/composerAttachments'
import { useInputHistory } from '../lib/useInputHistory'
import { useVoiceRecording } from '../lib/useVoiceRecording'
import { useMentionPopover } from '../lib/useMentionPopover'

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
  watermark?: WatermarkView | null
  onOpenContextPanel?: () => void
  resources?: McpResourceView[]
  attachments?: AttachmentItem[]
  onPickAttachments?: () => void
  onRemoveAttachment?: (index: number) => void
  onAddAttachments?: (items: AttachmentItem[]) => void
  onModelSwitched?: (model: string) => void
  mode?: RunMode
  onModeChange?: (m: RunMode) => void
  focusSignal?: number
  /** 当前会话 ID:用于输入历史按会话隔离存储 */
  sessionId?: string
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
  watermark = null,
  onOpenContextPanel,
  resources = [],
  attachments = [],
  onPickAttachments,
  onRemoveAttachment,
  onAddAttachments,
  onModelSwitched,
  mode = 'react',
  onModeChange,
  focusSignal,
  sessionId,
}: ComposerProps): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const previewReqRef = useRef<Set<string>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange

  // @-mention 弹出框
  const mentionHook = useMentionPopover({
    value,
    onChange,
    onValueChangeRef: onChangeRef,
    resources,
  })

  // 语音分段录音
  const voice = useVoiceRecording({ value, onChange, textareaRef })

  // 输入历史:↑/↓ 回显之前提交过的文本
  const {
    isBrowsing,
    goOlder,
    goNewer,
    exitBrowsing,
    addToHistory,
  } = useInputHistory({
    sessionId: sessionId ?? '',
    onValueChange: onChange,
  })

  // 首页示例卡「填入并聚焦」:信号变化即聚焦输入框(首帧 0 不触发)
  useEffect(() => { if (focusSignal) textareaRef.current?.focus() }, [focusSignal])

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
      if (mentionHook.popoverOpen && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        if (e.key === 'ArrowDown') { e.preventDefault(); mentionHook.nextItem(); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); mentionHook.prevItem(); return }
        if (e.key === 'Escape') { e.preventDefault(); mentionHook.closePopover(); return }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (mentionHook.confirmInsert()) {
            // restore caret
            requestAnimationFrame(() => textareaRef.current?.focus())
          }
          return
        }
      }

      // 历史浏览:↑/↓ 回显(仅在 @-mention 弹出框未打开时)
      if (!mentionHook.popoverOpen && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          exitBrowsing()
          goOlder()
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          goNewer()
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
        // 提交时将当前文本追加到历史
        addToHistory(value)
        exitBrowsing()
        onSubmit()
      }
    },
    [onSubmit, running, mentionHook, value,
     goOlder, goNewer, exitBrowsing, addToHistory],
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

  // 语音分段录音逻辑已提取到 useVoiceRecording hook

  return (
    <TooltipProvider delayDuration={200}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={
          'relative w-full rounded-2xl border bg-surface shadow-sm transition-shadow focus-within:shadow-lg focus-within:border-fg-subtle/50 ' +
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
        {mentionHook.popoverOpen && (
          <div data-testid="mention-popover"
            className="absolute bottom-full left-3 z-40 mb-1 max-h-56 w-96 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md">
            {mentionHook.mentionItems.map((it, i) => (
              <button key={it.insert} data-testid="mention-item"
                onMouseDown={e => {
                  e.preventDefault() // 不丢 textarea 焦点
                  mentionHook.confirmInsert()
                }}
                className={'flex w-full flex-col rounded-md px-2 py-1.5 text-left ' + (i === mentionHook.mentionIndex ? 'bg-bg' : 'hover:bg-bg/60')}>
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

        {voice.sttError && (
          <div data-testid="stt-error" className="px-3 pt-2 text-2xs text-danger">
            {voice.sttError}
            {voice.sttError.includes('未配置') && <span className="text-fg-subtle">（到 Provider 配置里填 SiliconFlow 的 key）</span>}
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
            // 历史浏览模式下用户开始输入 → 自动退出浏览
            if (isBrowsing) exitBrowsing()
            onChange(e.target.value)
            mentionHook.handleMentionChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
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
          {!voice.recording && !voice.transcribing && (
            <button
              data-testid="stt-mic"
              disabled={running}
              aria-label="语音输入"
              title="按一下开始说话,再按停止转写"
              onClick={() => void voice.startRecording()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <VoiceBars active={false} streamRef={voice.streamRef} />
            </button>
          )}
          {voice.recording && (
            <div className="flex shrink-0 items-center gap-1">
              <button data-testid="stt-stop" onClick={voice.stopRecording} aria-label="停止并转写"
                className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-danger/10 px-2 text-xs text-danger">
                <VoiceBars active streamRef={voice.streamRef} /> 停止
              </button>
              <button data-testid="stt-cancel" onClick={voice.cancelRecording} aria-label="取消"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:text-fg">
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          )}
          {voice.transcribing && (
            <span data-testid="stt-transcribing" className="shrink-0 whitespace-nowrap text-xs text-fg-muted">转写中…</span>
          )}

          {/* model chip — interactive switcher */}
          <ModelSwitcher initialModel={model} running={running} onSwitched={onModelSwitched} />

          {/* token 状态 — status 事件驱动,四档色 + 点击打开右侧上下文面板 */}
          <StatusChip status={status} watermark={watermark} onOpenPanel={onOpenContextPanel} />

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
            disabled={running || voice.recording || voice.transcribing || !value.trim()}
            className="shrink-0 whitespace-nowrap rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}
