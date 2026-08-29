// desktop/src/renderer/lib/useEventListener.ts
// 通用事件订阅 hook:自动 addEventListener 并在 cleanup 时 removeEventListener。
//
// 优势:
//   - 消除散落的 useEffect + addEventListener + removeEventListener 三件套
//   - handler 走 ref-wrap,target/type/options 不变就不会重新订阅
//   - 支持 window / document / 任意 EventTarget / React RefObject
//   - target 为 null 时静默跳过(条件挂载场景)

import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'

export interface UseEventListenerOptions {
  /** 事件目标,默认 window。传 null 跳过(conditional target)。也接受 React.RefObject */
  target?: EventTarget | RefObject<EventTarget | null> | null
  /** capture 阶段监听,默认 false */
  capture?: boolean
  /** passive 监听(不阻止默认行为),默认 false */
  passive?: boolean
}

function resolveTarget(t: EventTarget | RefObject<EventTarget | null> | null | undefined): EventTarget | null {
  if (!t) return null
  const maybeRef = t as { current?: EventTarget | null }
  // 区分 RefObject 和 EventTarget:只看是否有 .current 属性(EventTarget 没有这个字段)
  if (Object.hasOwn(maybeRef, 'current')) {
    return maybeRef.current ?? null
  }
  return t as EventTarget
}

/**
 * 在 target(默认 window)上订阅一个 window 级 DOM 事件。
 * handler 是 ref-wrap 的,所以 handler 变化不会触发重新订阅。
 */
export function useEventListener<K extends keyof WindowEventMap>(
  type: K,
  handler: (e: WindowEventMap[K]) => void,
  opts?: UseEventListenerOptions,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  // 默认 window;显式传 null 表示跳过;传 RefObject 则取 .current
  const target = opts && 'target' in opts
    ? resolveTarget(opts.target)
    : (typeof window !== 'undefined' ? window : null)
  const { capture = false, passive = false } = opts ?? {}

  useEffect(() => {
    if (!target) return
    const wrapped = (e: Event): void => { handlerRef.current(e as WindowEventMap[K]) }
    target.addEventListener(type, wrapped as EventListener, { capture, passive })
    return () => { target.removeEventListener(type, wrapped as EventListener, capture) }
  }, [target, type, capture, passive])
}

// —— 以下是 DOM 元素级别的重载 ——

/** 订阅任意 DOM 元素上的事件(如 div 上的 scroll)。type 走 keyof HTMLElementEventMap */
export function useElementEventListener<K extends keyof HTMLElementEventMap>(
  type: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  opts?: UseEventListenerOptions,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const target = opts && 'target' in opts
    ? resolveTarget(opts.target)
    : (typeof window !== 'undefined' ? window : null)
  const { capture = false, passive = false } = opts ?? {}

  useEffect(() => {
    if (!target) return
    const wrapped = (e: Event): void => { handlerRef.current(e as HTMLElementEventMap[K]) }
    target.addEventListener(type, wrapped as EventListener, { capture, passive })
    return () => { target.removeEventListener(type, wrapped as EventListener, capture) }
  }, [target, type, capture, passive])
}

// document 级 — 独立实现避免 WindowEventMap/DocumentEventMap 泛型不匹配
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
