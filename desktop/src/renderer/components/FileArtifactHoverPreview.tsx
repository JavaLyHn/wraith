import { useEffect, useRef, useState } from 'react'
import { FileDiff, FilePlus } from 'lucide-react'
import { Popover, PopoverContent } from './ui/popover'
import { FileArtifactCardInner } from './FileArtifactCard'
import { ArtifactPreviewBody } from './ArtifactPreview'
import { baseName } from '../lib/paths'
import type { FileArtifactCardProps } from './FileArtifactCard'

const ENTER_DELAY = 300
const LEAVE_DELAY = 200
const MAX_BYTES = 50 * 1024 // 50KB

/** 字节数 → 人类可读字符串 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 文件产物卡 hover peek 预览。
 * 鼠标移到卡片上 300ms 后弹出浮动 popover,显示文件内容 + 元数据标题。
 * 鼠标可从卡片移到 popover 不关闭(桥接区),200ms 后关闭。
 * click 文件名按钮仍触发 onOpenPreview(右侧 dock),不影响 hover state。
 */
export default function FileArtifactHoverPreview(props: FileArtifactCardProps): JSX.Element {
  const { file } = props
  const [open, setOpen] = useState(false)
  const enterTimer = useRef<number | null>(null)
  const leaveTimer = useRef<number | null>(null)

  const clearEnter = (): void => {
    if (enterTimer.current !== null) {
      clearTimeout(enterTimer.current)
      enterTimer.current = null
    }
  }
  const clearLeave = (): void => {
    if (leaveTimer.current !== null) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  useEffect(() => {
    return () => { clearEnter(); clearLeave() }
  }, [])

  const onEnter = (): void => {
    clearLeave()
    if (open) return
    enterTimer.current = window.setTimeout(() => { setOpen(true) }, ENTER_DELAY)
  }
  const onLeave = (): void => {
    clearEnter()
    leaveTimer.current = window.setTimeout(() => { setOpen(false) }, LEAVE_DELAY)
  }

  const contentBytes = new Blob([file.content]).size
  const truncated = contentBytes > MAX_BYTES
  const displayContent = truncated ? file.content.slice(0, MAX_BYTES) : file.content
  const lineCount = file.content === '' ? 0 : file.content.split('\n').length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClickCapture={(e) => {
          // 点击「查看更改」「审核」「撤销」后立即关闭 popover
          const target = e.target as HTMLElement
          const testId = target.getAttribute('data-testid')
          if (testId === 'file-artifact-viewdiff' || testId === 'file-artifact-review' || testId === 'file-artifact-undo') {
            setOpen(false)
          }
        }}
        className="inline-block"
        data-testid="artifact-hover-trigger-wrapper"
      >
        <FileArtifactCardInner {...props} />
      </span>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        data-testid="artifact-hover-popover"
        className="w-[min(560px,calc(100vw-24px))] p-0"
      >
        <div className="flex max-h-[420px] min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
            {file.kind === 'created'
              ? <FilePlus className="h-3.5 w-3.5 shrink-0 text-ok" strokeWidth={1.5} />
              : <FileDiff className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.5} />}
            <span className="truncate font-mono font-semibold" title={file.path}>{baseName(file.path)}</span>
            <span className="shrink-0 text-2xs text-fg-subtle">· {formatBytes(contentBytes)} · {lineCount} 行 · {file.kind === 'created' ? '新建' : '已编辑'}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            <ArtifactPreviewBody filePath={file.path} content={displayContent} />
            {truncated && (
              <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-surface/95 px-3 py-1.5 text-2xs text-fg-subtle">
                内容过长,预览已截断,点击打开查看完整
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
