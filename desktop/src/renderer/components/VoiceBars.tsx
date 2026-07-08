import { useEffect, useRef } from 'react'
import { micLevel, waveBars, idleBars } from '../lib/waveform'

interface VoiceBarsProps {
  /** true=录音中,竖条随麦克风音量起伏(海浪);false=静止图案。 */
  active: boolean
  /** 录音中的麦克风流(Composer 持有);active 时用它建 AnalyserNode。 */
  streamRef: { current: MediaStream | null }
  barCount?: number
}

/**
 * 竖条波形图标。静止显 idleBars;active 时接麦克风流,rAF 循环把 waveBars 高度
 * 直写各竖条 style.height(不每帧 setState),呈流动的「海浪」。
 */
export default function VoiceBars({ active, streamRef, barCount = 5 }: VoiceBarsProps): JSX.Element {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([])

  const applyHeights = (heights: number[]): void => {
    barsRef.current.forEach((el, i) => {
      if (el && heights[i] != null) el.style.height = `${Math.round(heights[i] * 100)}%`
    })
  }

  // 静止态:挂载 / 退出录音时铺一次固定图案
  useEffect(() => {
    if (!active) applyHeights(idleBars(barCount))
  }, [active, barCount])

  // 录音态:AudioContext + AnalyserNode + rAF 驱动
  useEffect(() => {
    if (!active) return
    const stream = streamRef.current
    if (!stream) return
    let raf = 0
    let phase = 0
    let ctx: AudioContext | null = null
    try {
      ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = (): void => {
        analyser.getByteTimeDomainData(data)
        applyHeights(waveBars(micLevel(data), phase, barCount))
        phase += 0.15
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    } catch {
      return   // AudioContext 不可用 → 保持静止竖条,不报错
    }
    return () => {
      if (raf) cancelAnimationFrame(raf)
      void ctx?.close()
    }
  }, [active, streamRef, barCount])

  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: barCount }, (_, i) => (
        <span
          key={i}
          ref={el => { barsRef.current[i] = el }}
          className="w-[2px] rounded-full bg-current"
          style={{ height: '40%' }}
        />
      ))}
    </span>
  )
}
