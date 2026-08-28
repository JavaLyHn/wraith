// desktop/src/renderer/components/DiffView.tsx
import { useEffect, useRef, useState } from 'react'
import { logger } from '../lib/logger'

interface DiffViewProps {
  filePath: string
  before: string
  after: string
  /** diff 计算完成后回报 +added/-removed 行数(可选)。 */
  onStats?: (added: number, removed: number) => void
  /** true 时 host 高度跟随父容器(style.height:'100%'),跳过 80~400 的内容自适应钳制。 */
  fill?: boolean
  /** true 时两列并排显示(类 git side-by-side);默认 false 为行内 diff。 */
  sideBySide?: boolean
}

let uriSeq = 0 // 同一文件多张卡片时保证 model URI 唯一

// 从 monaco-editor 获取类型(types 声明完整)
type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor
type TextModel = import('monaco-editor').editor.ITextModel
// eslint-disable-next-line @typescript-eslint/no-redeclare
type MonacoEditorModule = typeof import('monaco-editor')

/**
 * 只读 inline DiffEditor:hideUnchangedRegions 原生 per-hunk 折叠;
 * 高度按内容 clamp(80~400px);Monaco 动态加载失败降级为纯文本双块。
 *
 * runtime 使用 editor.api.js 而非 monaco-editor 主入口,
 * 避免加载 70+ 语言贡献和 12MB+ 语言 worker。
 */
export default function DiffView({ filePath, before, after, onStats, fill, sideBySide }: DiffViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [height, setHeight] = useState(160)

  useEffect(() => {
    let disposed = false
    let editor: DiffEditor | null = null
    let original: TextModel | null = null
    let modified: TextModel | null = null

    setFailed(false)
    setLoading(true)

    void (async () => {
      try {
        // 注册 MonacoEnvironment(只配 editor.worker,不加载语言 worker)
        await import('../lib/monacoSetup')
        // 加载 editor.api.js:纯 API 层,零语言贡献
        // 类型桥接:MonacoEditorModule 类型来自 monaco-editor 主入口(d.ts 完整),
        // runtime 加载 editor.api.js(接口兼容,不含语言贡献)
        // @ts-expect-error Monaco 子路径无类型声明,但 Vite runtime 可正确解析
        const monaco = (await import('monaco-editor/esm/vs/editor/editor.api')) as unknown as MonacoEditorModule
        if (disposed || !hostRef.current) return

        const uniq = `${++uriSeq}`
        const encodedPath = encodeURIComponent(filePath)
        const uriBefore = monaco.Uri.parse(`wraith-diff://${uniq}/before/${encodedPath}`)
        const uriAfter = monaco.Uri.parse(`wraith-diff://${uniq}/after/${encodedPath}`)
        const origModel = monaco.editor.createModel(before, undefined, uriBefore)
        const modModel = monaco.editor.createModel(after, undefined, uriAfter)
        if (!origModel || !modModel) throw new Error('Monaco createModel returned null')
        original = origModel
        modified = modModel

        const diffEditor = monaco.editor.createDiffEditor(hostRef.current, {
          readOnly: true,
          renderSideBySide: !!sideBySide,
          hideUnchangedRegions: { enabled: true },
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
          automaticLayout: true,
        })
        if (!diffEditor) throw new Error('Monaco createDiffEditor returned null')
        editor = diffEditor
        editor!.setModel({ original: original!, modified: modified! })
        setLoading(false)

        editor!.onDidUpdateDiff(() => {
          const changes = editor!.getLineChanges() ?? []
          let added = 0
          let removed = 0
          for (const c of changes) {
            if (c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1
            if (c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1
          }
          onStatsRef.current?.(added, removed)
          if (!fill) {
            const contentH = editor!.getModifiedEditor().getContentHeight()
            setHeight(Math.min(Math.max(contentH, 80), 400))
          }
        })
      } catch (err) {
        logger.error('wraith', 'monaco load failed:', err)
        setFailed(true)
        setLoading(false)
      }
    })()

    return () => {
      disposed = true
      editor?.dispose()
      original?.dispose()
      modified?.dispose()
    }
  }, [filePath, before, after, sideBySide])

  if (failed) {
    return (
      <div data-testid="diff-fallback" className="grid h-full grid-cols-2 gap-2 overflow-auto p-2 font-mono text-xs">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-danger/5 p-2">{before}</pre>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-ok/5 p-2">{after}</pre>
      </div>
    )
  }
  if (loading) {
    return (
      <div data-testid="diff-loading" className="flex h-full items-center justify-center bg-bg text-xs text-fg-subtle">
        加载 Diff 编辑器…
      </div>
    )
  }
  return <div ref={hostRef} data-testid="diff-view" style={fill ? { height: '100%' } : { height }} />
}
