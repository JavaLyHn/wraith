// desktop/src/renderer/components/DiffView.tsx
import { useEffect, useRef, useState } from 'react'

type MonacoModule = typeof import('monaco-editor')

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

/**
 * 只读 inline DiffEditor:hideUnchangedRegions 原生 per-hunk 折叠;
 * 高度按内容 clamp(80~400px);Monaco 动态加载失败降级为纯文本双块。
 */
export default function DiffView({ filePath, before, after, onStats, fill, sideBySide }: DiffViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(160)

  useEffect(() => {
    let disposed = false
    let editor: import('monaco-editor').editor.IStandaloneDiffEditor | null = null
    let original: import('monaco-editor').editor.ITextModel | null = null
    let modified: import('monaco-editor').editor.ITextModel | null = null

    // props 变化重跑时先复位 failed 回正常渲染路径;时序依赖"失败过的 import 重试走真实异步 I/O,慢于 React 调度的重渲染提交",并非同步重渲染保证——勿基于此注释做进一步时序优化
    setFailed(false)

    void (async () => {
      let monaco: MonacoModule
      try {
        await import('../lib/monacoSetup')
        monaco = await import('monaco-editor')
      } catch (err) {
        console.error('[wraith] monaco load failed:', err)
        setFailed(true)
        return
      }
      if (disposed || !hostRef.current) return

      const uniq = `${++uriSeq}`
      // URI 末段保留文件名 → Monaco 按扩展名自动选择语言 tokenizer
      // 对 filePath 编码防止空格/#/? 生成畸形 URI
      const encodedPath = encodeURIComponent(filePath)
      original = monaco.editor.createModel(before, undefined, monaco.Uri.parse(`wraith-diff://${uniq}/before/${encodedPath}`))
      modified = monaco.editor.createModel(after, undefined, monaco.Uri.parse(`wraith-diff://${uniq}/after/${encodedPath}`))
      editor = monaco.editor.createDiffEditor(hostRef.current, {
        readOnly: true,
        renderSideBySide: !!sideBySide,
        hideUnchangedRegions: { enabled: true },
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        automaticLayout: true,
      })
      editor.setModel({ original, modified })
      editor.onDidUpdateDiff(() => {
        if (!editor) return
        const changes = editor.getLineChanges() ?? []
        let added = 0
        let removed = 0
        for (const c of changes) {
          if (c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1
          if (c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1
        }
        onStatsRef.current?.(added, removed)
        if (!fill) {
          const contentH = editor.getModifiedEditor().getContentHeight()
          setHeight(Math.min(Math.max(contentH, 80), 400))
        }
      })
    })()

    return () => {
      disposed = true
      // guard 之后全部是同步代码，JS 单线程保证 cleanup 不会插入 await 链中
      // 因此 models/editor 不会泄漏；维护者勿在 guard 之后引入 await
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
  return <div ref={hostRef} data-testid="diff-view" style={fill ? { height: '100%' } : { height }} />
}
