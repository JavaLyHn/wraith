import ReactMarkdown from 'react-markdown'
import type { Item } from '../../shared/transcriptReducer'
import ThinkingBlock from './ThinkingBlock'
import ToolCard from './ToolCard'
import DiffCard from './DiffCard'
import UserMessage from './UserMessage'

interface TranscriptProps {
  items: Item[]
  /** turn 运行中:禁用消息编辑/删除。 */
  busy: boolean
  onEditMessage: (ordinal: number, newText: string) => void
  onDeleteMessage: (ordinal: number) => void
}

export default function Transcript({ items, busy, onEditMessage, onDeleteMessage }: TranscriptProps): JSX.Element {
  let userOrdinal = 0 // 渲染期为 user 气泡计数(1-based),rewind 用
  // [&>*]:shrink-0 必不可少:卡片类子项(tool/thinking/diff)带 overflow-hidden,
  // 其 flex 自动最小高度为 0——内容一旦溢出容器,flex 会把它们压成 2px 边框线
  return (
    <div
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
              busy={busy}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
            />
          )
        }
        if (item.type === 'message') {
          return (
            <div key={idx} className="text-sm leading-7 text-fg [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/[0.04] [&_pre]:p-3">
              <ReactMarkdown>{item.text}</ReactMarkdown>
            </div>
          )
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
