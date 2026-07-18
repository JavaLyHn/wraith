import { useEffect, useRef, useState } from 'react'
import type { PetState, PetView } from '../../shared/pets'
import type { PetPrefs } from '../settings/prefs'
import { motionFor, spriteRowFor } from '../lib/petMotion'

function clampAxis(value: number): number {
  return Math.max(-160, Math.min(160, value))
}

export interface PetAvatarProps {
  pet: PetView
  state: PetState
  prefs: PetPrefs
  onPositionChange: (position: { x: number; y: number }) => void
}

// 拖拽手柄的高度:只占浮件顶部一条窄带,不是 inset-0 整块——锚点 bottom-3 right-4
// 落在聊天列内,几何上会盖到 Composer 的发送/中断/审批控件,若手柄铺满整只宠物,
// 点击会被当成拖拽而不是穿透到下面的按钮。窄带之外的区域(含图片/精灵本体)全部
// pointer-events-none,点击照常穿透到 composer。
const DRAG_HANDLE_HEIGHT = 22

// 单张静态图片的紧凑固定尺寸上限(与精灵表 192×208 量级一致);精灵路径已有
// 自己的固定 frameWidth/frameHeight,不走这个上限。
const STATIC_IMAGE_MAX_PX = 112

/**
 * 聊天列内的悬浮宠物浮件。绝对定位、展示用:外层 pointer-events-none,
 * 唯一可交互面是 data-testid="chat-pet-drag-handle" 的拖拽手柄(仅顶部窄带)——
 * 不在图片/精灵本体上挂任何事件,不发命令、不弹层、不发气泡/toast。拖动只即时
 * 改本地偏移,pointer-up 才经 onPositionChange 落盘,并按 [-160,160] 逐轴 clamp。
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
  const row = sprite ? spriteRowFor(state, sprite.rows) : 0

  return (
    // 外层只管定位/可见性(inline transform: translate+scale)+ testid,
    // 承拖拽手柄——两层各管自己的 transform,CSS 动效(内层 motion.className)
    // 不会覆盖这里的 inline transform,拖动/缩放才总能生效。
    <div
      data-testid="chat-pet"
      className="pointer-events-none absolute bottom-3 right-4 z-20"
      style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${prefs.scale})` }}
    >
      {sprite ? (
        <div
          aria-hidden="true"
          className={'pointer-events-none ' + motion.className}
          style={{
            width: sprite.frameWidth,
            height: sprite.frameHeight,
            backgroundImage: `url(${pet.previewUrl})`,
            backgroundSize: `${sprite.columns * sprite.frameWidth}px ${sprite.rows * sprite.frameHeight}px`,
            backgroundPosition: `-${frame * sprite.frameWidth}px -${row * sprite.frameHeight}px`,
          }}
        />
      ) : (
        <img
          alt=""
          className={'pointer-events-none object-contain ' + motion.className}
          style={{ maxWidth: STATIC_IMAGE_MAX_PX, maxHeight: STATIC_IMAGE_MAX_PX }}
          src={pet.previewUrl}
        />
      )}
      {/* 拖拽手柄:只占顶部一条窄带,而非整只宠物——其余区域(含图片/精灵本体)
          pointer-events-none,点击穿透到下面可能几何重叠的 composer 控件。 */}
      <div
        data-testid="chat-pet-drag-handle"
        className="pointer-events-auto absolute inset-x-0 top-0 cursor-grab active:cursor-grabbing"
        style={{ height: DRAG_HANDLE_HEIGHT }}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      />
    </div>
  )
}
