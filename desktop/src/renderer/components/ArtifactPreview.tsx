import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MARKDOWN_COMPONENTS } from './AgentMessage'
import { baseName } from '../lib/paths'
import type { PreviewArtifact } from '../../shared/artifactSummary'

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/**
 * 产物正文渲染(纯展示,可单测,供 ArtifactPreview 和 hover popover 复用)。
 * .md/.markdown → react-markdown 富文本(复用 AgentMessage 的 MARKDOWN_COMPONENTS);
 * 其它扩展名 → 等宽 <pre>;空内容 → 占位。
 */
export function ArtifactPreviewBody({ filePath, content }: { filePath: string; content: string }): JSX.Element {
  if (content === '') {
    return <div data-testid="artifact-empty" className="text-xs text-fg-subtle">(空文件)</div>
  }
  if (isMarkdown(filePath)) {
    return (
      <div data-testid="artifact-markdown" className="agent-markdown text-sm leading-7 text-fg">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
      </div>
    )
  }
  return <pre data-testid="artifact-code" className="whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">{content}</pre>
}

/**
 * 右侧「预览」pane 正文:渲染产物完整内容(带标题栏)。
 * 内容为 agent 最后写入的原文,不 stripDsml。
 */
export default function ArtifactPreview({ filePath, content }: PreviewArtifact): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-fg">
        <span className="truncate font-mono font-semibold" title={filePath}>{baseName(filePath)}</span>
        <span className="shrink-0 text-2xs font-normal text-fg-subtle" title="agent 写入时的内容,非实时磁盘">· 快照</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <ArtifactPreviewBody filePath={filePath} content={content} />
      </div>
    </div>
  )
}
