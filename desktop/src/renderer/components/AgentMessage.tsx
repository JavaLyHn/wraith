import { GitBranch } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Logo from './Logo'
import { stripDsml } from '../lib/toolContent'
import { absoluteTime } from '../lib/memoryView'
import { cn } from '../lib/utils'

/** Agent 消息 markdown 正文的自定义渲染:表格外包横向滚动容器、链接走系统浏览器。
 *  导出供其它面板(如上下文「活摘要」预览)复用同一套 markdown 渲染口径。 */
export const MARKDOWN_COMPONENTS: Components = {
  table: ({ node, children, ...props }) => (
    <div className="agent-md-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
  a: ({ node, href, children, ...props }) => (
    <a
      href={href}
      onClick={e => {
        e.preventDefault()
        if (href) void window.wraith.openExternal(href)
      }}
      {...props}
    >
      {children}
    </a>
  ),
}

interface AgentMessageProps extends HTMLAttributes<HTMLDivElement> {
  text: string
  /** 消息完成时刻(ms 时间戳);悬停时显示绝对时间。未设置(如历史恢复)则不显示。 */
  timestampMs?: number
  /** 在该回复处创建新会话分支:复制当前对话历史到新会话,基于此回复继续。 */
  onBranch?: () => void
  /** 分支操作执行中(禁用按钮,防重复点击)。 */
  branching?: boolean
}

/** Agent 消息:左侧主题感知 Wraith logo 头像+名字,右侧全宽 markdown 正文(GFM + 主题样式)。
 * 悬停时显示消息完成时间与「分支」按钮。 */
export default function AgentMessage({ text, timestampMs, onBranch, branching, className: incomingClass, ...rest }: AgentMessageProps): JSX.Element {
  const title = timestampMs != null ? `回答时间: ${absoluteTime(timestampMs)}` : undefined
  return (
    <div data-testid="agent-msg" title={title} className={cn(incomingClass, "group flex gap-2.5")} {...rest}>
      <Logo className="mt-0.5 h-6 w-6 shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between">
          <div className="text-2xs font-semibold text-fg-muted">Wraith</div>
          {onBranch && (
            <button
              data-testid="msg-branch"
              onClick={(e) => { e.stopPropagation(); onBranch() }}
              disabled={branching}
              title="在此回复处创建新会话分支(复制当前历史,基于此继续对话)"
              className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-2xs text-fg-muted opacity-0 transition-opacity hover:border-accent hover:text-accent group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-3 w-3" />
              {branching ? '分支中…' : '分支'}
            </button>
          )}
        </div>
        <div className="agent-markdown text-sm leading-7 text-fg">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {stripDsml(text)}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
