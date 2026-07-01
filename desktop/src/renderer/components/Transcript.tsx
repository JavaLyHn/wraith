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
      style={{
        flexGrow: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      {items.map((item, idx) => {
        if (item.type === 'message') {
          return (
            <div
              key={idx}
              style={{
                color: '#cdd6e0',
                lineHeight: 1.7,
                fontSize: '14px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              }}
            >
              <ReactMarkdown>{item.text}</ReactMarkdown>
            </div>
          )
        }
        if (item.type === 'thinking') {
          return (
            <ThinkingBlock
              key={idx}
              label={item.label}
              text={item.text}
              done={item.done}
            />
          )
        }
        if (item.type === 'tool') {
          return <ToolCard key={item.card.callId || idx} card={item.card} />
        }
        return null
      })}
    </div>
  )
}
