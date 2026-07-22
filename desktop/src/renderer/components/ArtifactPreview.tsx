import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MARKDOWN_COMPONENTS } from './AgentMessage'
import { baseName } from '../lib/paths'

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/**
 * 右侧「预览」pane 正文:渲染产物完整内容(纯展示,可单测)。
 * .md/.markdown → react-markdown 富文本(复用 AgentMessage 的 MARKDOWN_COMPONENTS + .agent-markdown);
 * 其它扩展名 → 等宽 <pre>(v1 无语法高亮);空内容 → 占位。内容为 agent 最后写入的原文,不 stripDsml。
 */
export default function ArtifactPreview({ filePath, content }: { filePath: string; content: string }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold text-fg">
        <span className="truncate font-mono" title={filePath}>{baseName(filePath)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {content === ''
          ? <div data-testid="artifact-empty" className="text-xs text-fg-subtle">(空文件)</div>
          : isMarkdown(filePath)
            ? (
              <div data-testid="artifact-markdown" className="agent-markdown text-sm leading-7 text-fg">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
              </div>
            )
            : <pre data-testid="artifact-code" className="whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">{content}</pre>}
      </div>
    </div>
  )
}
