import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, FolderOpen, Plus, Search, Trash2, Check, FolderSearch,
  FileText, FileSpreadsheet, FileImage, FileType, File as FileIcon,
} from 'lucide-react'
import type { DocEntry } from '../../shared/types'
import { filterDocs, formatSize, docIconKind } from '../lib/documentsView'
// relativeTime(ms, nowMs = Date.now()) —— snapshotView.ts:36,签名与此处用法一致,直接复用
import { relativeTime } from '../lib/snapshotView'

/** 图标类别 → lucide 组件。与 documentsView.docIconKind 的返回值一一对应。 */
const ICONS = {
  pdf: FileType,
  doc: FileText,
  sheet: FileSpreadsheet,
  image: FileImage,
  text: FileText,
  file: FileIcon,
} as const

export default function DocumentsPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // 删除二次确认:记住当前待确认的文件名(同侧栏会话删除的就地确认,不弹 modal)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setDocs(await window.wraith.documents.list())
      setError(null)
    } catch (err) { setError((err as Error).message) }
  }, [])

  useEffect(() => { void load() }, [load])

  /** 入库并把失败项汇总成一条 inline 提示。paths 为空 → 走系统选择器。 */
  const doAdd = useCallback(async (paths?: string[]): Promise<void> => {
    setBusy(true)
    try {
      const r = paths ? await window.wraith.documents.add(paths) : await window.wraith.documents.add()
      // 先刷新列表,再落 error——load() 成功时会自带 setError(null),顺序反了会把这里的失败提示冲掉
      await load()
      setError(r.failed.length
        ? `${r.added.length} 个成功,${r.failed.length} 个失败:` +
          r.failed.map(f => `${f.name}(${f.reason})`).join('、')
        : null)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [load])

  const doRemove = useCallback(async (name: string): Promise<void> => {
    if (confirmDel !== name) { setConfirmDel(name); return }
    setConfirmDel(null)
    try { await window.wraith.documents.remove(name); await load() }
    catch (err) { setError((err as Error).message) }
  }, [confirmDel, load])

  const doOpen = useCallback(async (name: string): Promise<void> => {
    try { await window.wraith.documents.open(name) }
    catch (err) { setError((err as Error).message) }
  }, [])

  const doReveal = useCallback(async (name: string): Promise<void> => {
    try { await window.wraith.documents.reveal(name) }
    catch (err) { setError((err as Error).message) }
  }, [])

  const onDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    // Electron 32 已移除 File.path,取磁盘路径必须走 webUtils(preload 的 pathForFile)
    const paths = Array.from(e.dataTransfer.files).map(f => window.wraith.pathForFile(f)).filter(Boolean)
    if (paths.length) void doAdd(paths)
  }, [doAdd])

  const shown = filterDocs(docs, query)

  return (
    <div
      className={'flex min-h-0 flex-1 flex-col ' + (dragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent' : '')}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="documents-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.5} />文档
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* 只有一个文件时搜索框是多余 UI */}
          {docs.length > 1 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-fg/5 px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />
              <input
                data-testid="documents-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索"
                className="w-32 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
          )}
          <button data-testid="documents-add" disabled={busy} onClick={() => void doAdd()}
            className="flex items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-1.5 text-xs text-fg hover:bg-fg/10 hover:text-accent disabled:opacity-50">
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />添加
          </button>
        </div>
      </div>

      {error && (
        <div data-testid="documents-error"
          className="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-fg-muted">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {docs.length === 0 ? (
          <div data-testid="documents-empty"
            className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
            <FolderOpen className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
            <div className="text-xs text-fg-muted">把文件拖进来,或点右上角添加</div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5" onMouseLeave={() => setConfirmDel(null)}>
            {shown.map(d => {
              const Icon = ICONS[docIconKind(d.name)]
              return (
                <div key={d.name} data-testid={`documents-row-${d.name}`}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-fg/5">
                  <Icon className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
                  <button onClick={() => void doOpen(d.name)} data-testid={`documents-open-${d.name}`}
                    className="flex-1 truncate text-left text-xs text-fg" title={`打开 ${d.name}`}>
                    {d.name}
                  </button>
                  <span className="shrink-0 text-3xs text-fg-subtle">{formatSize(d.size)}</span>
                  <span className="w-16 shrink-0 text-right text-3xs text-fg-subtle">{relativeTime(d.addedAt)}</span>
                  <button data-testid={`documents-reveal-${d.name}`} onClick={() => void doReveal(d.name)}
                    title="在文件管理器中显示"
                    className="shrink-0 px-1 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100">
                    <FolderSearch className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button data-testid={`documents-delete-${d.name}`} onClick={() => void doRemove(d.name)}
                    title={confirmDel === d.name ? '确认删除?' : '删除'}
                    className={'shrink-0 px-1 opacity-0 group-hover:opacity-100 ' +
                      (confirmDel === d.name ? 'text-danger opacity-100' : 'text-fg-subtle hover:text-fg')}>
                    {confirmDel === d.name
                      ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                      : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  </button>
                </div>
              )
            })}
            {shown.length === 0 && (
              <div className="py-8 text-center text-xs text-fg-subtle">没有匹配「{query}」的文件</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
