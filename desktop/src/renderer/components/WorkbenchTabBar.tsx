import { MessageSquare, FileText, FileSpreadsheet, FileImage, FileType, File as FileIcon, X } from 'lucide-react'
import type { PreviewKind } from '../../shared/types'
import { previewKind } from '../lib/filePreviewKind'

export type WorkbenchTab =
  | { id: 'chat'; title: string }
  | { id: `file:${string}`; title: string; path: string; kind: PreviewKind }

interface Props {
  tabs: WorkbenchTab[]
  activeId: string
  onActivate: (id: WorkbenchTab['id']) => void
  onClose: (fileTabId: Extract<WorkbenchTab['id'], `file:${string}`>) => void
}

const ICON_FOR_KIND: Record<PreviewKind, typeof FileText> = {
  code: FileText,
  markdown: FileText,
  image: FileImage,
  pdf: FileType,
  binary: FileIcon,
}
void FileSpreadsheet   // 保留扩展位

export default function WorkbenchTabBar({ tabs, activeId, onActivate, onClose }: Props): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="工作区 Tab"
      className="flex flex-nowrap items-stretch gap-0 overflow-x-auto border-b border-border bg-bg-muted px-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {tabs.map((t) => {
        const active = t.id === activeId
        const isChat = t.id === 'chat'
        const Icon = isChat ? MessageSquare : ICON_FOR_KIND[(t as Extract<WorkbenchTab, { kind: PreviewKind }>).kind]
        const fileId = isChat ? null : (t.id as Extract<WorkbenchTab['id'], `file:${string}`>)
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            title={isChat ? '聊天' : (t as Extract<WorkbenchTab, { path: string }>).path}
            onClick={() => onActivate(t.id)}
            className={
              'group relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors ' +
              (active
                ? 'wb-tab-active text-fg bg-bg'
                : 'border-transparent text-fg-muted hover:bg-surface hover:text-fg')
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} aria-hidden />
            <span className="max-w-[160px] truncate">{t.title}</span>
            {!isChat && fileId && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`关闭 ${t.title}`}
                title={`关闭 ${t.title}`}
                onClick={(e) => { e.stopPropagation(); onClose(fileId) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClose(fileId) } }}
                className="wb-tab-close ml-1 inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-fg-subtle opacity-70 hover:opacity-100"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// 基于 absPath 构造 WorkbenchTab 的纯工厂 (App.tsx 与 FileTreePanel.onOpenFile 使用)
export function makeFileTab(absPath: string): Extract<WorkbenchTab, { id: `file:${string}` }> {
  const name = absPath.split(/[\\/]/).pop() ?? absPath
  const kind = previewKind(absPath)
  const id = `file:${absPath}` as const
  // @ts-ignore - TS 对模板字面量 id 的推断有时打结;运行时保证前缀正确
  return { id, title: name, path: absPath, kind }
}
