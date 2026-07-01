import ReactMarkdown from 'react-markdown'
import type { Item } from '../../shared/transcriptReducer'
import ThinkingBlock from './ThinkingBlock'
import ToolCard from './ToolCard'

interface TranscriptProps {
  items: Item[]
}

export default function Transcript({ items }: TranscriptProps): JSX.Element {
  return (
    <div
      data-testid="transcript"
      className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4"
    >
      {items.map((item, idx) => {
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
        return null
      })}
    </div>
  )
}
