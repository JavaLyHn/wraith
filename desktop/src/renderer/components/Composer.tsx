import { useCallback, useRef, useState } from 'react'
import { Switch } from './ui/switch'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'
import { shouldSendOnEnter } from '../../shared/composerKeys'
import StatusChip from './StatusChip'
import type { StatusData, McpResourceView } from '../../shared/types'
import { detectMention, filterMentionItems, insertMention } from '../../shared/mentionTrigger'
import type { MentionState } from '../../shared/mentionTrigger'

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
}: ComposerProps): JSX.Element {
  const [mention, setMention] = useState<MentionState>({ active: false, start: 0, query: '' })
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={
          'relative w-full rounded-2xl border border-border bg-surface shadow-sm ' +
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
                <span className="text-[11px] text-fg-subtle">{it.hint}</span>
              </button>
            ))}
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
          {/* attach — disabled placeholder */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="attach"
                disabled
                aria-label="附件"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle opacity-50 disabled:cursor-not-allowed"
              >
                +
              </button>
            </TooltipTrigger>
            <TooltipContent>附件在后续阶段</TooltipContent>
          </Tooltip>

          {/* model chip — read only */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default rounded-lg border border-border px-2 py-1 text-xs text-fg-muted">
                {model || '—'}
              </span>
            </TooltipTrigger>
            <TooltipContent>模型/强度切换在后续阶段</TooltipContent>
          </Tooltip>

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
            disabled={running || !value.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}
