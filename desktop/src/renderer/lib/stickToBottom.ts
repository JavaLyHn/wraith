import { useEffect, useRef } from 'react'

/**
 * 流式输出框的自动贴底。
 *
 * 团队卡里的三个流式框（planner / worker / reviewer）都是
 * `max-h-48 overflow-y-auto`，而**没有任何滚动跟随**。内容一超过这个高度，可见区就冻在
 * 最前面几行，后面几千字全长在视野外；又因为框有高度上限，外层 Transcript 的自动贴底
 * 也没得可滚 —— 整张卡片彻底静止，用户以为死机了。
 *
 * 与 Transcript 的差别：这些框小、内容只增长，所以不需要那套手势时间戳
 * （内容增长本身不改 scrollTop、不触发 scroll 事件；唯一的 scroll 事件来源是
 * 用户手动滚 与 我们自己的钉底，两者读到的 atBottom 都是对的）。
 * 但浏览器的 scroll anchoring 会在内容增长时自己动 scrollTop，所以框上必须带
 * `[overflow-anchor:none]` —— 同 Transcript 的理由。
 */

/** 贴底判定容差（px）：亚像素与滚动惯性下差一点点仍算贴底。 */
const BOTTOM_SLACK = 32

export function shouldStickToBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK
}

/**
 * 内容（`dep`）变化后把容器钉到底，除非用户自己往上翻过。
 *
 * @param dep 每次流式增量都会变的值（如累积文本本身）
 */
export function useStickToBottom<T extends HTMLElement>(dep: unknown): React.RefObject<T> {
  const ref = useRef<T>(null)
  const stick = useRef(true)   // 默认跟随:框刚出现时用户还没表达过意图

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => { stick.current = shouldStickToBottom(el) }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [dep])

  return ref
}
