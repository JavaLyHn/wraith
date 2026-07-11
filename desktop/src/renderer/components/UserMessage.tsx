import { useEffect, useState } from 'react'
import { useSettings } from '../settings/SettingsContext'
import { userAvatarGlyph } from '../lib/chatIdentity'
import type { AttachmentRef } from '../../shared/transcriptReducer'

interface UserMessageProps {
  text: string
  /** 随该条消息发出的附件(图片显示缩略图,其它显示文件名)。 */
  attachments?: AttachmentRef[]
  /** 该气泡是第几条用户消息(1-based),rewind 用。 */
  ordinal: number
  /** 是否为最后一条用户消息:是则重发一键直发(重新生成),否则两击确认(丢弃其后内容)。 */
  isLastUser: boolean
  /** turn 运行中禁用编辑/删除。 */
  busy: boolean
  onEdit: (ordinal: number, newText: string) => void
  onDelete: (ordinal: number) => void
  onResend: (ordinal: number, text: string) => void
}

/** 用户气泡:hover 浮现编辑/删除;编辑就地展开;删除二次点击确认(真回溯,裁掉之后全部)。 */
export default function UserMessage({ text, attachments, ordinal, isLastUser, busy, onEdit, onDelete, onResend }: UserMessageProps): JSX.Element {
  const { prefs } = useSettings()
  const glyph = userAvatarGlyph(prefs.profile)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [confirming, setConfirming] = useState(false)
  const [resendConfirming, setResendConfirming] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})

  // 图片附件按需拉缩略图 data:URL(临时文件在会话内始终可读)
  useEffect(() => {
    let cancelled = false
    for (const a of attachments ?? []) {
      if (a.kind !== 'image' || previews[a.path]) continue
      void window.wraith.readImageDataUrl(a.path).then(url => {
        if (!cancelled && url) setPreviews(prev => ({ ...prev, [a.path]: url }))
      }).catch(() => { /* 读失败:退回文件名 */ })
    }
    return () => { cancelled = true }
  }, [attachments, previews])

  if (editing) {
    return (
      <div className="self-end w-[85%] rounded-2xl border border-accent/40 bg-accent/5 p-2">
        <textarea
          data-testid="msg-edit-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          autoFocus
          className="w-full resize-none bg-transparent px-1 text-sm text-fg outline-none"
        />
        <div className="mt-1 flex justify-end gap-2">
          <button
            data-testid="msg-edit-cancel"
            onClick={() => { setEditing(false); setDraft(text) }}
            className="rounded-lg border border-border px-3 py-1 text-xs text-fg-muted hover:bg-black/[0.03]"
          >
            取消
          </button>
          <button
            data-testid="msg-edit-save"
            onClick={() => {
              if (!draft.trim()) return
              // 先复位再回调:裁剪+重发后新 user 项落在同一 key,React 复用实例,editing 残留会把新气泡渲染成编辑框
              setEditing(false)
              onEdit(ordinal, draft.trim())
            }}
            disabled={!draft.trim()}
            title="丢弃此消息及之后的全部内容,以修改后的文本重新发送"
            className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存并重发
          </button>
        </div>
      </div>
    )
  }

  const imgs = (attachments ?? []).filter(a => a.kind === 'image')
  const files = (attachments ?? []).filter(a => a.kind !== 'image')

  return (
    <div className="group flex items-start justify-end gap-1.5 self-end max-w-[85%]">
      {!busy && (
        <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            data-testid="msg-edit"
            onClick={() => { setDraft(text); setEditing(true); setConfirming(false); setResendConfirming(false) }}
            title="编辑并从此处重发(丢弃之后的内容)"
            className="rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-accent hover:text-accent"
          >
            ✏️ 编辑
          </button>
          <button
            data-testid="msg-resend"
            onClick={() => {
              if (isLastUser || resendConfirming) {
                setResendConfirming(false)
                onResend(ordinal, text)
              } else {
                setResendConfirming(true)
              }
            }}
            onBlur={() => setResendConfirming(false)}
            title={isLastUser ? '以原文本重新发送(重新生成回复)' : '丢弃此条之后的全部内容并以原文本重发'}
            className={
              'rounded-lg border px-2 py-1 text-2xs ' +
              (resendConfirming
                ? 'border-accent bg-accent/10 font-semibold text-accent'
                : 'border-border text-fg-muted hover:border-accent hover:text-accent')
            }
          >
            {resendConfirming ? '确认重发?' : '🔄 重新发送'}
          </button>
          <button
            data-testid="msg-delete"
            onClick={() => (confirming ? onDelete(ordinal) : setConfirming(true))}
            onBlur={() => setConfirming(false)}
            title="删除此消息及之后的全部内容"
            className={
              'rounded-lg border px-2 py-1 text-2xs ' +
              (confirming
                ? 'border-danger bg-danger/10 font-semibold text-danger'
                : 'border-border text-fg-muted hover:border-danger hover:text-danger')
            }
          >
            {confirming ? '确认删除?' : '🗑 删除'}
          </button>
        </span>
      )}
      <div className="flex min-w-0 flex-col items-end gap-1.5">
        {(imgs.length > 0 || files.length > 0) && (
          <div data-testid="user-attachments" className="flex flex-wrap justify-end gap-1.5">
            {imgs.map((a, i) => (
              previews[a.path]
                ? <img key={a.path + i} data-testid="user-attach-thumb" src={previews[a.path]} alt={a.name} title={a.name}
                    className="h-20 w-20 rounded-lg border border-border object-cover" />
                : <span key={a.path + i} title={a.name}
                    className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-bg text-3xs text-fg-subtle">🖼 {a.name}</span>
            ))}
            {files.map((a, i) => (
              <span key={a.path + i} title={a.name}
                className="flex max-w-[160px] items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg">
                <span className="truncate">📄 {a.name}</span>
              </span>
            ))}
          </div>
        )}
        {text && (
          <div data-testid="user-msg" className="rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg shadow-sm">
            {text}
          </div>
        )}
      </div>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-xs font-medium text-fg" aria-hidden>{glyph}</div>
    </div>
  )
}
