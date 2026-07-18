import { useEffect, useRef, useState } from 'react'
import type { PetState, PetView } from '../../shared/pets'
import type { PetPrefs } from '../settings/prefs'
import { motionFor } from '../lib/petMotion'

// 精灵表按状态分行取帧:仅决定读哪一行,不影响 tokens.css 里管位移/缩放的 pet-* keyframes。
const SPRITE_ROWS: PetState[] = ['idle', 'thinking', 'tool', 'approval', 'success', 'error']

function clampAxis(value: number): number {
  return Math.max(-160, Math.min(160, value))
}

export interface PetAvatarProps {
  pet: PetView
  state: PetState
  prefs: PetPrefs
  onPositionChange: (position: { x: number; y: number }) => void
}

/**
 * 聊天列内的悬浮宠物浮件。绝对定位、展示用:外层 pointer-events-none,
 * 唯一可交互面是 data-testid="chat-pet-drag-handle" 的拖拽手柄——不在图片/精灵
 * 本体上挂任何事件,不发命令、不弹层、不发气泡/toast。拖动只即时改本地偏移,
 * pointer-up 才经 onPositionChange 落盘,并按 [-160,160] 逐轴 clamp。
 */
export default function PetAvatar({ pet, state, prefs, onPositionChange }: PetAvatarProps): JSX.Element | null {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const motion = motionFor(state, prefs.motion, reduced)
  const sprite = pet.sprite

  // 精灵表帧动画:仅在允许动效且确有精灵表时用 rAF 推进当前行内的列;
  // reduced/static 或静态图片一律停在第 0 帧。
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!sprite || reduced || motion.durationMs === 0) {
      setFrame(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const frameMs = motion.durationMs / sprite.columns
    const tick = (now: number): void => {
      const elapsed = now - start
      setFrame(Math.floor((elapsed % motion.durationMs) / frameMs) % sprite.columns)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sprite, reduced, motion.durationMs, state])

  // 拖拽:本地偏移即时跟手,pointer-up 才提交;dragRef 存起点(而非增量),防止连续 move 事件累计误差。
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const onDragStart = (e: React.PointerEvent): void => {
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: prefs.position.x, baseY: prefs.position.y }
    setDragPosition(prefs.position)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    setDragPosition({ x: clampAxis(d.baseX + (e.clientX - d.startX)), y: clampAxis(d.baseY + (e.clientY - d.startY)) })
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    // 直接用本次事件坐标算落点(与 onDragMove 同一套公式),不读回 dragPosition state——
    // 避免 pointerup 抢在上一次 pointermove 的 setState 提交前触发时读到过期闭包。
    const next = { x: clampAxis(d.baseX + (e.clientX - d.startX)), y: clampAxis(d.baseY + (e.clientY - d.startY)) }
    setDragPosition(null)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    onPositionChange(next)
  }

  if (!prefs.enabled || !pet.available || !pet.previewUrl) return null

  const position = dragPosition ?? prefs.position
  const row = sprite ? SPRITE_ROWS.indexOf(state) % sprite.rows : 0

  return (
    <div
      data-testid="chat-pet"
      className={'pointer-events-none absolute bottom-3 right-4 z-20 ' + motion.className}
      style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${prefs.scale})` }}
    >
      {sprite ? (
        <div
          aria-hidden="true"
          className="pointer-events-none"
          style={{
            width: sprite.frameWidth,
            height: sprite.frameHeight,
            backgroundImage: `url(${pet.previewUrl})`,
            backgroundSize: `${sprite.columns * sprite.frameWidth}px ${sprite.rows * sprite.frameHeight}px`,
            backgroundPosition: `-${frame * sprite.frameWidth}px -${row * sprite.frameHeight}px`,
          }}
        />
      ) : (
        <img alt="" className="pointer-events-none" src={pet.previewUrl} />
      )}
      {/* 拖拽手柄:覆盖浮件可视区的唯一可交互层;事件永远落在手柄上而不是图片/精灵本体 */}
      <div
        data-testid="chat-pet-drag-handle"
        className="pointer-events-auto absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      />
    </div>
  )
}
