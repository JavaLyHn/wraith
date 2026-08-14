import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/utils'

export interface RulerTimelineProps {
  contentRef: React.RefObject<HTMLElement | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  activeHid: string | null
  onHover: (hid: string | null) => void
  className?: string
}

interface MeasuredMark {
  top: number
  mid: number
  hid: string
  markType: null | 'dot'
}

interface HighlightSeg {
  hid: string
  top: number
  bottom: number
}

const GROUP_GAP = 8

export default function RulerTimeline({
  contentRef,
  scrollRef,
  activeHid,
  onHover,
  className,
}: RulerTimelineProps): JSX.Element {
  const [, setTick] = useState(0)
  const forceRender = (): void => setTick(t => (t + 1) % 1_000_000)
  const roRef = useRef<ResizeObserver | null>(null)
  const moRef = useRef<MutationObserver | null>(null)

  useEffect(() => {
    return () => {
      roRef.current?.disconnect()
      moRef.current?.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return
    const ro = new ResizeObserver(() => { forceRender() })
    ro.observe(el)
    roRef.current = ro
    const mo = new MutationObserver(() => { forceRender() })
    mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true })
    moRef.current = mo
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentRef.current])

  const measured = useMemo<MeasuredMark[]>(() => {
    const container = scrollRef.current
    if (!container) return []
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-tl-hid]'))
    if (items.length === 0) return []
    const containerRect = container.getBoundingClientRect()
    const marks: MeasuredMark[] = []
    for (const el of items) {
      const rect = el.getBoundingClientRect()
      const top = rect.top - containerRect.top + container.scrollTop
      const height = rect.height
      const hid = el.getAttribute('data-tl-hid') ?? ''
      const markAttr = el.getAttribute('data-tl-mark-type') as null | 'dot'
      const markType = markAttr === 'dot' ? 'dot' : null
      marks.push({ top, mid: top + height / 2, hid, markType })
    }
    return marks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef.current, contentRef.current, activeHid])

  const segments = useMemo<HighlightSeg[]>(() => {
    if (measured.length === 0) return []
    const segs: HighlightSeg[] = []
    let current: HighlightSeg | null = null
    for (const m of measured) {
      if (!current) {
        current = { hid: m.hid, top: m.top, bottom: m.top + 1 }
      } else if (current.hid === m.hid) {
        current.bottom = m.top + 1
      } else {
        segs.push(current)
        current = { hid: m.hid, top: m.top, bottom: m.top + 1 }
      }
    }
    if (current) segs.push(current)
    for (let i = 0; i < segs.length; i++) {
      const next = segs[i + 1]
      const lastInGroup = [...measured].reverse().find(m => m.hid === segs[i].hid)
      const estBottom = (lastInGroup?.top ?? segs[i].top) + 24
      if (next) segs[i].bottom = Math.min(estBottom, next.top - GROUP_GAP)
      else segs[i].bottom = estBottom
      if (segs[i].bottom < segs[i].top + 4) segs[i].bottom = segs[i].top + 4
    }
    return segs
  }, [measured])

  /** 点击标记 → 滚动到对应对话轮次的起始位置 */
  const scrollToHid = useCallback((hid: string): void => {
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(`[data-tl-hid="${hid}"]`)
    if (!target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const offset = targetRect.top - containerRect.top + container.scrollTop - 16
    container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
  }, [scrollRef])

  return (
    <div
      className={cn('ruler-timeline', className)}
      aria-hidden="true"
      data-testid="ruler-timeline"
    >
      {segments.map((seg, i) => (
        <div
          key={`seg-${seg.hid}-${i}`}
          className={cn('ruler-highlight', activeHid === seg.hid && 'ruler-highlight--visible')}
          style={{
            top: seg.top,
            height: seg.bottom - seg.top,
          }}
          onMouseEnter={() => { onHover(seg.hid) }}
          onMouseLeave={() => { onHover(null) }}
          onClick={() => { scrollToHid(seg.hid) }}
        />
      ))}
      {measured.map((m, i) => (
        m.markType && (
          <div
            key={`mark-${m.hid}-${i}`}
            className={cn(
              'ruler-mark',
              `ruler-mark--${m.markType}`,
              activeHid === m.hid && 'ruler-mark--on',
            )}
            style={{ top: m.mid - 8 }}
            onMouseEnter={() => { onHover(m.hid) }}
            onMouseLeave={() => { onHover(null) }}
            onClick={() => { scrollToHid(m.hid) }}
            data-tl-ruler-mark={m.markType}
          />
        )
      ))}
    </div>
  )
}
