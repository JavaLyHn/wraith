import { useState, useEffect, useMemo, useRef } from 'react'
import { FileText, Eye, FolderOpen, ExternalLink } from 'lucide-react'
import hljs from 'highlight.js'
import type { PreviewKind } from '../../shared/types'
import { previewKind as inferKind, MAX_TEXT_BYTES } from '../lib/filePreviewKind'

interface Props {
  path: string
  kind?: PreviewKind
  onPathChange?: (path: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`
  if (bytes < 1024*1024*1024) return `${(bytes/(1024*1024)).toFixed(1)} MB`
  return `${(bytes/(1024*1024*1024)).toFixed(2)} GB`
}

function fmtMtime(ms: number): string {
  if (!ms) return '-'
  try {
    const d = new Date(ms)
    const pad = (n:number)=> String(n).padStart(2,'0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '-' }
}

export default function FilePreviewPanel({ path, kind, onPathChange }: Props): JSX.Element {
  const k = kind ?? inferKind(path)
  const name = useMemo(() => path.split(/[\\/]/).pop() ?? path, [path])

  const [meta, setMeta] = useState<{size:number; mtime:number} | null>(null)
  const [text, setText] = useState<{content:string; truncated:boolean; size:number} | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  void onPathChange

  useEffect(() => {
    setErr(null); setText(null); setMeta(null)
    if (k === 'binary') return
    window.wraith.fs.stat(path).then(m => setMeta({ size: m.size ?? 0, mtime: m.mtime ?? 0 }))
      .catch(e => setErr('stat: ' + String(e?.message ?? e)))
    if (k === 'code' || k === 'markdown') {
      window.wraith.fs.readText(path, MAX_TEXT_BYTES)
        .then(t => setText(t))
        .catch(e => setErr('read: ' + String(e?.message ?? e)))
    }
  }, [path, k])

  const lang = useMemo(() => {
    if (k !== 'code') return null
    const dot = name.lastIndexOf('.')
    if (dot < 0) return null
    const ext = name.slice(dot+1).toLowerCase()
    const aliases: Record<string,string> = { md:'markdown', ts:'typescript', tsx:'typescript', js:'javascript', jsx:'javascript', py:'python', yml:'yaml' }
    return aliases[ext] ?? ext
  }, [name, k])

  let body: JSX.Element
  if (err) {
    body = (
      <div className="m-4 rounded-md border border-danger/30 bg-danger/5 p-4 text-xs text-danger">
        <div className="mb-1 font-semibold">预览失败</div>
        <div className="whitespace-pre-wrap break-words">{err}</div>
      </div>
    )
  } else if (k === 'code' || k === 'markdown') {
    body = text ? (
      <CodeView content={text.content} truncated={text.truncated} language={k === 'markdown' ? 'markdown' : lang} />
    ) : (
      <div className="p-3 text-xs text-fg-subtle">读取文件…</div>
    )
  } else if (k === 'image') {
    body = (
      <div className="flex h-full min-h-0 items-start justify-center overflow-auto bg-bg-muted/50 p-6">
        <img
          ref={imgRef}
          src={`file://${path.replace(/\\/g, '/')}`}
          alt={name}
          className="max-w-full rounded border border-border bg-bg object-contain shadow-sm"
          onError={() => setErr('图片加载失败 (可能路径编码问题或不支持的格式)')}
        />
      </div>
    )
  } else if (k === 'pdf') {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-xs text-fg-muted">
        <FileText className="h-10 w-10 text-fg-subtle" strokeWidth={1.3} aria-hidden />
        <div>PDF 预览未内联渲染</div>
        <div className="text-[11px] text-fg-subtle">请用「外部打开」在本机 PDF 阅读器查看</div>
      </div>
    )
  } else {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-xs text-fg-muted">
        <FileText className="h-10 w-10 text-fg-subtle" strokeWidth={1.3} aria-hidden />
        <div>二进制文件 — 不支持预览</div>
        <div className="text-[11px] text-fg-subtle">大小 {meta ? formatSize(meta.size) : '…'}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Eye className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.6} aria-hidden />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={path}>{name}</div>
        <button
          type="button" title="在文件夹中显示" aria-label="在文件夹中显示"
          onClick={() => window.wraith.fs.reveal(path)}
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-fg-muted hover:bg-surface hover:text-fg"
        >
          <FolderOpen className="h-3 w-3" strokeWidth={1.7} /><span>所在文件夹</span>
        </button>
        <button
          type="button" title="用外部应用打开" aria-label="用外部应用打开"
          onClick={() => window.wraith.fs.openExternal(path)}
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-fg-muted hover:bg-surface hover:text-fg"
        >
          <ExternalLink className="h-3 w-3" strokeWidth={1.7} /><span>外部打开</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      <div className="flex shrink-0 items-center justify-between border-t border-border bg-bg-muted px-3 py-1 text-[11px] text-fg-subtle">
        <div className="min-w-0 truncate" title={path}>{path}</div>
        <div className="flex shrink-0 gap-3">
          <span>大小 {meta ? formatSize(meta.size) : (text ? formatSize(text.size) : '…')}</span>
          <span>修改 {meta ? fmtMtime(meta.mtime) : '…'}</span>
          {text?.truncated && <span className="text-amber-500">已截断 ({'>'}{formatSize(MAX_TEXT_BYTES)})</span>}
        </div>
      </div>
    </div>
  )
}

function CodeView({ content, truncated, language }: { content: string; truncated: boolean; language: string | null }): JSX.Element {
  const lines = useMemo(() => content.replace(/\r\n/g, '\n').split('\n'), [content])
  const highlighted = useMemo(() => {
    if (!language) return null
    try {
      const res = hljs.highlight(content, { language, ignoreIllegals: true })
      return res.value
    } catch { return null }
  }, [content, language])

  if (highlighted) {
    const hlLines = highlighted.split('\n')
    return (
      <pre className="preview-code m-0 h-full min-h-0 w-full p-0 pt-2 pb-4">
        <code className={`hljs language-${language}`}>
          {hlLines.map((ln, i) => (
            <span key={i} className="preview-line">
              <span className="preview-ln">{i + 1}</span>
              <span dangerouslySetInnerHTML={{ __html: ln || '&nbsp;' }} />
            </span>
          ))}
          {truncated && (
            <div className="mt-2 ml-14 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500">
              文件过大,仅显示前 {formatSize(MAX_TEXT_BYTES)} 内容
            </div>
          )}
        </code>
      </pre>
    )
  }

  return (
    <pre className="preview-code m-0 h-full min-h-0 w-full p-0 pt-2 pb-4">
      <code>
        {lines.map((ln, i) => (
          <span key={i} className="preview-line">
            <span className="preview-ln">{i + 1}</span>
            <span>{ln || '\u00A0'}</span>
          </span>
        ))}
        {truncated && (
          <div className="mt-2 ml-14 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500">
            文件过大,仅显示前 {formatSize(MAX_TEXT_BYTES)} 内容
          </div>
        )}
      </code>
    </pre>
  )
}
