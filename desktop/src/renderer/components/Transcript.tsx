import { useEffect, useRef } from 'react'
import type { Item } from '../../shared/transcriptReducer'
import ThinkingBlock from './ThinkingBlock'
import ToolCard from './ToolCard'
import DiffCard from './DiffCard'
import UserMessage from './UserMessage'
import AgentMessage from './AgentMessage'

interface TranscriptProps {
  items: Item[]
  /** turn 运行中:禁用消息编辑/删除。 */
  busy: boolean
  onEditMessage: (ordinal: number, newText: string) => void
  onDeleteMessage: (ordinal: number) => void
  onResendMessage: (ordinal: number, text: string) => void
}

export default function Transcript({ items, busy, onEditMessage, onDeleteMessage, onResendMessage }: TranscriptProps): JSX.Element {
  let userOrdinal = 0 // 渲染期为 user 气泡计数(1-based),rewind 用
  const totalUsers = items.filter(i => i.type === 'user').length
  const containerRef = useRef<HTMLDivElement>(null)
  // 贴底跟随:初始 true(载入历史直接落底);用户上翻(离底 >80px)即停跟,不打断阅读
  const stickRef = useRef(true)

  const handleScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // 发送即强制贴底(最后一项是 user 气泡=刚提交/编辑重发);流式内容仅在贴底时跟随
    if (items[items.length - 1]?.type === 'user') stickRef.current = true
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  // [&>*]:shrink-0 必不可少:卡片类子项(tool/thinking/diff)带 overflow-hidden,
  // 其 flex 自动最小高度为 0——内容一旦溢出容器,flex 会把它们压成 2px 边框线
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-testid="transcript"
      className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4 [&>*]:shrink-0"
    >
      {items.map((item, idx) => {
        if (item.type === 'user') {
          userOrdinal++
          return (
            <UserMessage
              key={idx}
              text={item.text}
              ordinal={userOrdinal}
              isLastUser={userOrdinal === totalUsers}
              busy={busy}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
              onResend={onResendMessage}
            />
          )
        }
        if (item.type === 'message') {
          return <AgentMessage key={idx} text={item.text} />
        }
        if (item.type === 'thinking') {
          return <ThinkingBlock key={idx} label={item.label} text={item.text} done={item.done} />
        }
        if (item.type === 'tool') {
          return <ToolCard key={item.card.callId || idx} card={item.card} />
        }
        if (item.type === 'diff') {
          return <DiffCard key={idx} filePath={item.filePath} before={item.before} after={item.after} />
        }
        return null
      })}
    </div>
  )
}
