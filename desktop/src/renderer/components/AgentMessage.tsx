import ReactMarkdown from 'react-markdown'
import Logo from './Logo'

/** Agent 消息:左侧主题感知 Wraith logo 头像+名字,右侧全宽 markdown 正文。 */
export default function AgentMessage({ text }: { text: string }): JSX.Element {
  return (
    <div data-testid="agent-msg" className="flex gap-2.5">
      <Logo className="mt-0.5 h-6 w-6 shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-2xs font-semibold text-fg-muted">Wraith</div>
        <div className="text-sm leading-7 text-fg [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface [&_pre]:p-3">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
