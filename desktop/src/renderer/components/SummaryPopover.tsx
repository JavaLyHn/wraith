import { useMemo, useState } from 'react'
import { FileText, Folder, Globe, Image as ImageIcon, ListChecks, Users } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { deriveArtifacts } from '../../shared/artifactSummary'
import type { ArtifactSummary, ArtifactSource } from '../../shared/artifactSummary'
import type { Item } from '../../shared/transcriptReducer'

/** 相对路径按 workspace 拼绝对(供 openPath);绝对路径(/… 或 Windows 盘符)原样。 */
export function resolveArtifactPath(path: string, workspace: string | null): string {
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return path
  return workspace ? workspace.replace(/\/+$/, '') + '/' + path : path
}

const ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg-muted hover:bg-surface/60'
const LABEL = 'mb-1 mt-2 text-3xs uppercase tracking-wider text-fg-subtle first:mt-0'
const SOURCES_FOLD = 5

function SourcesSection({ sources, workspace, onOpenPath }: {
  sources: ArtifactSource[]; workspace: string | null; onOpenPath: (p: string) => void
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const rows: { key: string; kind: 'img' | 'folder'; label: string; path: string }[] =
    sources.map(a => ({ key: 'a-' + a.path, kind: 'img' as const, label: a.name, path: a.path }))
  if (workspace) rows.push({ key: 'ws', kind: 'folder', label: workspace.split('/').filter(Boolean).pop() ?? workspace, path: workspace })
  if (rows.length === 0) return null
  const shown = expanded ? rows : rows.slice(0, SOURCES_FOLD)
  return (
    <>
      <div className={LABEL}>来源</div>
      {shown.map(r => (
        <button key={r.key} data-testid="summary-source" onClick={() => onOpenPath(r.path)} className={ROW}>
          {r.kind === 'img'
            ? <ImageIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            : <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />}
          <span className="min-w-0 flex-1 truncate">{r.label}</span>
        </button>
      ))}
      {rows.length > SOURCES_FOLD && (
        <button data-testid="summary-sources-toggle" onClick={() => setExpanded(v => !v)}
          className="px-2 py-1 text-3xs text-fg-subtle hover:text-fg">
          {expanded ? '收起' : `查看全部 (${rows.length})`}
        </button>
      )}
    </>
  )
}

/** 悬浮卡正文(纯展示,无 Radix,便于单测)。四段:输出(文件+服务)/子智能体/浏览器/来源。 */
export function SummaryContent({ summary, workspace, onOpenPath, onOpenExternal }: {
  summary: ArtifactSummary
  workspace: string | null
  onOpenPath: (p: string) => void
  onOpenExternal: (u: string) => void
}): JSX.Element {
  if (summary.isEmpty) {
    return <div data-testid="summary-empty" className="px-2 py-3 text-xs text-fg-subtle">本会话暂无产物</div>
  }
  return (
    <div className="flex flex-col">
      {(summary.files.length > 0 || summary.servers.length > 0) && <div className={LABEL}>输出</div>}
      {summary.files.map(f => (
        <button key={'f-' + f.path} data-testid="summary-file"
          onClick={() => onOpenPath(resolveArtifactPath(f.path, workspace))} className={ROW}>
          <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{f.path}</span>
          <span className="shrink-0 text-3xs text-fg-subtle">{f.kind === 'created' ? '新建' : '改动'}</span>
        </button>
      ))}
      {summary.servers.map(sv => (
        <button key={'s-' + sv.url} data-testid="summary-server"
          onClick={() => onOpenExternal(sv.url)} className={ROW}>
          <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{sv.url}</span>
        </button>
      ))}

      {summary.subagents && (
        <>
          <div className={LABEL}>子智能体</div>
          <div data-testid="summary-subagents" className="flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
            <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span>
              {summary.subagents.done}/{summary.subagents.total} 完成
              {summary.subagents.roles.length > 0 ? ' · ' + summary.subagents.roles.join('、') : ''}
            </span>
          </div>
        </>
      )}

      {summary.browserUrl && (
        <>
          <div className={LABEL}>浏览器</div>
          <button data-testid="summary-browser" onClick={() => onOpenExternal(summary.browserUrl!)} className={ROW}>
            <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="min-w-0 flex-1 truncate">{summary.browserUrl}</span>
          </button>
        </>
      )}

      <SourcesSection sources={summary.sources} workspace={workspace} onOpenPath={onOpenPath} />
    </div>
  )
}

/** 顶栏「产物摘要」按钮 + 悬浮卡薄壳:派生摘要 + Radix popover + 接 window.wraith。 */
export default function SummaryPopover({ items, workspace }: { items: readonly Item[]; workspace: string | null }): JSX.Element {
  const [open, setOpen] = useState(false)
  // popover 关闭时不派生:SummaryPopover 常驻顶栏,流式期间 items 每个 delta 都变,
  // 关着还全量扫 execute_command 输出跑正则纯属浪费;关闭态内容也不渲染,给空摘要即可。
  const summary = useMemo(() => (open ? deriveArtifacts(items, workspace) : deriveArtifacts([], workspace)), [open, items, workspace])
  const onOpenPath = (p: string): void => { void window.wraith.openPath(p).catch(() => {}) }
  const onOpenExternal = (u: string): void => { void window.wraith.openExternal(u).catch(() => {}) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid="summary-toggle" title="产物摘要"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-fg/5 hover:text-fg">
          <ListChecks className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />产物
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
        <SummaryContent summary={summary} workspace={workspace} onOpenPath={onOpenPath} onOpenExternal={onOpenExternal} />
      </PopoverContent>
    </Popover>
  )
}
