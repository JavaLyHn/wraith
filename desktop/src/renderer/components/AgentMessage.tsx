import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Logo from './Logo'
import { stripDsml } from '../lib/toolContent'

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

/** Agent 消息:左侧主题感知 Wraith logo 头像+名字,右侧全宽 markdown 正文(GFM + 主题样式)。 */
export default function AgentMessage({ text }: { text: string }): JSX.Element {
  return (
    <div data-testid="agent-msg" className="flex gap-2.5">
      <Logo className="mt-0.5 h-6 w-6 shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-2xs font-semibold text-fg-muted">Wraith</div>
        <div className="agent-markdown text-sm leading-7 text-fg">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {stripDsml(text)}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
