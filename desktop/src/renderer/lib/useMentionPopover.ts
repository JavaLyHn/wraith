import { useCallback, useMemo, useState } from 'react'
import { detectMention, filterMentionItems, insertMention } from '../../shared/mentionTrigger'
import type { MentionItem, MentionState } from '../../shared/mentionTrigger'
import type { McpResourceView } from '../../shared/types'

export interface UseMentionPopoverOptions {
  value: string
  onChange: (v: string) => void
  onValueChangeRef: React.MutableRefObject<(v: string) => void>
  resources: McpResourceView[]
}

export interface UseMentionPopoverReturn {
  mention: MentionState
  mentionIndex: number
  popoverOpen: boolean
  mentionItems: MentionItem[]
  /** textarea onChange 时调用,自动检测 mention */
  handleMentionChange: (v: string, caret: number) => void
  /** ↓ 键:向下选一项 */
  nextItem: () => void
  /** ↑ 键:向上选一项 */
  prevItem: () => void
  /** ESC:关闭弹出框 */
  closePopover: () => void
  /** Enter:确认插入当前选中项 */
  confirmInsert: () => boolean
  /** 在给定位置手动更新 mention 状态(外部用) */
  setMentionFromSelection: () => void
}

/**
 * @-mention 弹出框 hook:检测 @resource 输入、导航列表、确认插入。
 * 返回 confirmInsert 方法供 Composer 在 Enter 时判断是否拦截。
 */
export function useMentionPopover(opts: UseMentionPopoverOptions): UseMentionPopoverReturn {
  const { value, onChange, onValueChangeRef, resources } = opts

  const [mention, setMention] = useState<MentionState>({ active: false, start: 0, query: '' })
  const [mentionIndex, setMentionIndex] = useState(0)

  const mentionItems = useMemo<MentionItem[]>(() =>
    mention.active ? filterMentionItems(resources, mention.query) as unknown as MentionItem[] : [],
    [mention.active, mention.query, resources],
  )

  const popoverOpen = mention.active && mentionItems.length > 0

  const handleMentionChange = useCallback((v: string, caret: number) => {
    setMention(detectMention(v, caret))
    setMentionIndex(0)
  }, [])

  const nextItem = useCallback(() => {
    setMentionIndex(i => (i + 1) % Math.max(mentionItems.length, 1))
  }, [mentionItems.length])

  const prevItem = useCallback(() => {
    setMentionIndex(i => (i - 1 + Math.max(mentionItems.length, 1)) % Math.max(mentionItems.length, 1))
  }, [mentionItems.length])

  const closePopover = useCallback(() => {
    setMention({ active: false, start: 0, query: '' })
  }, [])

  const confirmInsert = useCallback((): boolean => {
    const item = mentionItems[mentionIndex]
    if (!item) return false
    const r = insertMention(value, mention, item.insert)
    onChange(r.next)
    setMention(detectMention(r.next, r.caret))
    setMentionIndex(0)
    // 恢复光标
    requestAnimationFrame(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="input"]')
      ta?.focus()
      ta?.setSelectionRange(r.caret, r.caret)
    })
    return true
  }, [value, mention, mentionIndex, mentionItems, onChange, onValueChangeRef])

  const setMentionFromSelection = useCallback(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="input"]')
    if (!ta) return
    setMention(detectMention(ta.value, ta.selectionStart ?? ta.value.length))
  }, [])

  return {
    mention,
    mentionIndex,
    popoverOpen,
    mentionItems,
    handleMentionChange,
    nextItem,
    prevItem,
    closePopover,
    confirmInsert,
    setMentionFromSelection,
  }
}
