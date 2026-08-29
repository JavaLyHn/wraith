// desktop/src/renderer/lib/useEventListener.ts
// 通用事件订阅 hook:自动在 effect 中 addEventListener 并在 cleanup 时 removeEventListener。
// 优势:
//   - 消除散落各处的 useEffect + addEventListener + removeEventListener 三件套
//   - 自动用 useCallback 保持 handler 引用稳定(除非依赖变化)
//   - 支持 window/document/任意 Element,默认 window
//   - target 为 null 时静默跳过(便于挂载条件下的 DOM 元素)

import { useCallback, useEffect, useRef } from 'react'

export interface UseEventListenerOptions {
  /** 事件目标,默认 window。传 null 跳过(conditional target)。 */
  target?: EventTarget | null
  /** capture 阶段监听,默认 false */
  capture?: boolean
  /** passive 监听(不阻止默认行为),默认 false */
  passive?: boolean
}

/**
 * 在 target(默认 window)上订阅一个 DOM 事件。
 * handler 是 ref-wrap 的,所以 target/type/options 稳定时不会重新订阅。
 */
export function useEventListener<K extends keyof WindowEventMap>(
  type: K,
  handler: (e: WindowEventMap[K]) => void,
  opts?: UseEventListenerOptions,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const { target = typeof window !== 'undefined' ? window : null, capture = false, passive = false } = opts ?? {}

  useEffect(() => {
    if (!target) return
    const wrapped = (e: Event): void => {
      handlerRef.current(e as WindowEventMap[K])
    }
    target.addEventListener(type, wrapped as EventListener, { capture, passive })
    return () => {
      target.removeEventListener(type, wrapped as EventListener, capture)
    }
  }, [target, type, capture, passive])
}

// 也支持 document 级事件 — 独立实现避免 WindowEventMap/DocumentEventMap 泛型不匹配
export function useDocumentEventListener<K extends keyof DocumentEventMap>(
  type: K,
  handler: (e: DocumentEventMap[K]) => void,
  opts?: Omit<UseEventListenerOptions, 'target'>,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const { capture = false, passive = false } = opts ?? {}
  useEffect(() => {
    if (typeof document === 'undefined') return
    const wrapped = (e: Event): void => { handlerRef.current(e as DocumentEventMap[K]) }
    document.addEventListener(type, wrapped as EventListener, { capture, passive })
    return () => { document.removeEventListener(type, wrapped as EventListener, capture) }
  }, [type, capture, passive])
}
