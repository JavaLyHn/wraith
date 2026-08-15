import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronRight, Folder, FolderOpen, FileText, File as FileIcon, Link2 } from 'lucide-react'
import { buildTreeFromFlat, insertSubtree, type TreeNode } from '../lib/fileTreeModel'
import type { FsNode } from '../../shared/types'
import { previewKind } from '../lib/filePreviewKind'

interface Props {
  rootPath?: string
  onOpenFile: (absPath: string) => void
  onError?: (err: Error) => void
}

type TreeUiState = { expanded: Set<string>; loadedDirs: Set<string> }

export default function FileTreePanel({ rootPath, onOpenFile, onError }: Props): JSX.Element {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [flatIndex, setFlatIndex] = useState<Map<string, FsNode>>(new Map())
  const [ui, setUi] = useState<TreeUiState>(() => ({ expanded: new Set(), loadedDirs: new Set() }))
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const resolveRootPath = useCallback((nodes: FsNode[], fallback?: string): string => {
    if (fallback) return fallback
    const rootNode = nodes.find(n => !n.parentPath)
    return rootNode?.path ?? ''
  }, [])

  const loadRoot = useCallback(async () => {
    try {
      const data = await window.wraith.fs.tree(rootPath ?? '', { maxDepth: 1 })
      const actualRoot = resolveRootPath(data.nodes, rootPath)
      const { root: built, flatIndex: idx } = buildTreeFromFlat(data.nodes, actualRoot)
      setTree(built)
      setFlatIndex(idx)
      setUi({ expanded: new Set([built.node.path]), loadedDirs: new Set([built.node.path]) })
      setErr(null)
    } catch (e: any) {
      setErr(String(e?.message ?? e))
      onError?.(e instanceof Error ? e : new Error(String(e)))
    }
  }, [rootPath, onError, resolveRootPath])

  useEffect(() => { void loadRoot() }, [loadRoot])

  const toggleExpand = useCallback(async (node: TreeNode) => {
    if (node.node.kind !== 'dir') return
    const path = node.node.path
    let needsFetch = false
    setUi(prev => {
      const nextExpanded = new Set(prev.expanded)
      const nextLoaded = new Set(prev.loadedDirs)
      if (nextExpanded.has(path)) {
        nextExpanded.delete(path)
      } else {
        nextExpanded.add(path)
      }
      if (!nextLoaded.has(path)) {
        nextLoaded.add(path)
        needsFetch = true
      }
      return { expanded: nextExpanded, loadedDirs: nextLoaded }
    })
    if (needsFetch) {
      try {
        const sub = await window.wraith.fs.tree(path, { maxDepth: 1 })
        setFlatIndex(prevFlat => {
          const newIdx = new Map(prevFlat)
          insertSubtree(newIdx, path, sub.nodes)
          const newRootPath = tree?.node.path ?? resolveRootPath(Array.from(newIdx.values()), rootPath)
          const { root: rebuilt, flatIndex: rebuiltIdx } = buildTreeFromFlat(Array.from(newIdx.values()), newRootPath)
          setTree(rebuilt)
          return rebuiltIdx
        })
      } catch (e: any) { setErr(String(e?.message ?? e)) }
    }
  }, [tree, rootPath, resolveRootPath])

  const handleDirAction = useCallback((node: TreeNode, action: 'toggle' | 'expand' | 'collapse') => {
    if (node.node.kind !== 'dir') return
    const path = node.node.path
    let needsFetch = false
    setUi(prev => {
      const nextExpanded = new Set(prev.expanded)
      const nextLoaded = new Set(prev.loadedDirs)
      const isExpanded = nextExpanded.has(path)
      if (action === 'toggle') {
        if (isExpanded) nextExpanded.delete(path)
        else nextExpanded.add(path)
      } else if (action === 'expand') {
        if (!isExpanded) nextExpanded.add(path)
      } else if (action === 'collapse') {
        if (isExpanded) nextExpanded.delete(path)
      }
      const willExpand = nextExpanded.has(path)
      if (willExpand && !nextLoaded.has(path)) {
        nextLoaded.add(path)
        needsFetch = true
      }
      return { expanded: nextExpanded, loadedDirs: nextLoaded }
    })
    if (needsFetch) {
      (async () => {
        try {
          const sub = await window.wraith.fs.tree(path, { maxDepth: 1 })
          setFlatIndex(prevFlat => {
            const newIdx = new Map(prevFlat)
            insertSubtree(newIdx, path, sub.nodes)
            const newRootPath = tree?.node.path ?? resolveRootPath(Array.from(newIdx.values()), rootPath)
            const { root: rebuilt, flatIndex: rebuiltIdx } = buildTreeFromFlat(Array.from(newIdx.values()), newRootPath)
            setTree(rebuilt)
            return rebuiltIdx
          })
        } catch (e: any) { setErr(String(e?.message ?? e)) }
      })()
    }
  }, [tree, rootPath, resolveRootPath])

  const handleOpen = (absPath: string) => {
    setSelectedPath(absPath)
    onOpenFile(absPath)
  }

  const rootNode = tree?.node
  void useMemo(() => rootNode?.name, [rootNode])

  if (err) return <div className="p-3 text-xs text-danger">加载文件树失败:{err}</div>
  if (!tree) return <div className="p-3 text-xs text-fg-subtle">加载中…</div>

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Folder className="h-3.5 w-3.5 text-brand" strokeWidth={1.6} aria-hidden />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={tree.node.path}>
          {tree.node.name}
        </div>
        <button
          type="button"
          title="刷新"
          onClick={() => void loadRoot()}
          className="h-6 w-6 shrink-0 rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg"
          aria-label="刷新文件树"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 pr-1">
        {tree.children.length === 0
          ? <div className="px-3 py-2 text-xs text-fg-subtle">工作区为空</div>
          : tree.children.map(c => (
            <TreeRow
              key={c.node.path}
              depth={0}
              node={c}
              expanded={ui.expanded}
              selectedPath={selectedPath}
              onToggle={toggleExpand}
              onDirAction={handleDirAction}
              onOpen={handleOpen}
            />
          ))
        }
      </div>
    </div>
  )
}

function TreeRow(props: {
  node: TreeNode; depth: number; expanded: Set<string>; selectedPath: string | null
  onToggle: (n: TreeNode) => void
  onDirAction: (n: TreeNode, action: 'toggle' | 'expand' | 'collapse') => void
  onOpen: (path: string) => void
}): JSX.Element {
  const { node, depth, expanded, selectedPath, onToggle, onDirAction, onOpen } = props
  const isDir = node.node.kind === 'dir'
  const isLink = node.node.kind === 'symlink'
  const isExpanded = expanded.has(node.node.path)
  const isSelected = selectedPath === node.node.path

  const DirIcon = isExpanded ? FolderOpen : Folder
  const isCode = !isDir && !isLink && previewKind(node.node.path) !== 'binary'
  const Icon = isDir ? DirIcon : (isLink ? Link2 : (isCode ? FileText : FileIcon))

  const handleRowClick = () => {
    if (isDir) onToggle(node)
    else if (isLink) { /* symlink no-op */ }
    else onOpen(node.node.path)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isLink) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault() }
      return
    }
    if (!isDir && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onOpen(node.node.path)
    }
    if (isDir) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onDirAction(node, 'toggle')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onDirAction(node, 'expand')
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onDirAction(node, 'collapse')
      }
    }
  }

  const rowTitle = isLink ? `符号链接:不自动导航\n${node.node.path}` : node.node.path

  return (
    <div>
      <div
        role={isDir ? 'button' : 'treeitem'}
        aria-selected={isSelected}
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className={
          'ft-row relative flex cursor-pointer select-none items-center gap-0.5 rounded px-1.5 py-1 text-xs text-fg ' +
          (isSelected ? 'ft-row-selected ' : 'hover:bg-fg/5 ') +
          (isLink ? 'ft-row-link ' : '')
        }
        style={{ paddingLeft: 6 + depth * 14 }}
        title={rowTitle}
      >
        {isDir
          ? <ChevronRight className={'h-3 w-3 shrink-0 text-fg-subtle transition-transform ' + (isExpanded ? 'rotate-90' : '')} strokeWidth={2} aria-hidden />
          : <span className="inline-block h-3 w-3 shrink-0" aria-hidden />
        }
        <Icon className={'h-3.5 w-3.5 shrink-0 ' + (isLink ? 'text-brand' : 'text-fg-subtle')} strokeWidth={1.5} aria-hidden />
        <span className="ml-1 min-w-0 flex-1 truncate">{node.node.name}</span>
      </div>
      {isDir && isExpanded && node.children.length > 0 && (
        <div>
          {node.children.map(c => (
            <TreeRow
              key={c.node.path}
              depth={depth + 1}
              node={c}
              expanded={expanded}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onDirAction={onDirAction}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
