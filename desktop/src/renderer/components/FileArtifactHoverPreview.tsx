import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { FileArtifactCardInner } from './FileArtifactCard'
import { ArtifactPreviewBody } from './ArtifactPreview'
import type { FileArtifactCardProps } from './FileArtifactCard'

const ENTER_DELAY = 300
const LEAVE_DELAY = 200
const MAX_BYTES = 50 * 1024 // 50KB

/**
 * 文件产物卡 hover peek 预览。
 * 鼠标移到卡片上 300ms 后弹出浮动 popover,直接显示文件内容(无标题栏,卡片本身已有文件名)。
 * popover 优先在卡片下方显示,空间不足时由 Radix avoidCollisions + sticky="partial" 翻到上方。
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        sticky="partial"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        data-testid="artifact-hover-popover"
        className="w-[min(560px,calc(100vw-24px))] p-0"
      >
        <div className="max-h-[420px] min-h-0 overflow-auto px-3 py-2">
          <ArtifactPreviewBody filePath={file.path} content={displayContent} />
          {truncated && (
            <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-surface/95 px-3 py-1.5 text-2xs text-fg-subtle">
              内容过长,预览已截断,点击打开查看完整
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
