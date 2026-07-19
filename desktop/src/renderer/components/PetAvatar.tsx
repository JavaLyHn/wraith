import { useEffect, useRef, useState } from 'react'
import type { PetState, PetView } from '../../shared/pets'
import type { PetPrefs } from '../settings/prefs'
import { clampPoint, detectFrameCounts, dragBounds, motionFor, spriteRowFor, type DragBounds } from '../lib/petMotion'

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

// 浮件锚点(对应外层 className 的 bottom-3 / right-4,单位 px)与拖拽留白。
// 拖拽边界据此按定位容器实测算出,替代旧的固定 ±160 死夹(那会把宠物锁死在离
// 右下角很近的一小块,高窗口下根本拖不上去)。
const BOTTOM_ANCHOR = 12
const RIGHT_ANCHOR = 16
const DRAG_MARGIN = 8

// 精灵表逐格 alpha 采样步长与阈值:一次性检测每行真实帧数用,越大越快、越小越准;
// 4px 步长足以判「该格是否有非透明像素」。
const ALPHA_SAMPLE_STRIDE = 4
const ALPHA_THRESHOLD = 16

/**
 * 聊天列内的悬浮宠物浮件。绝对定位、展示用:外层 pointer-events-none,
 * 唯一可交互面是 data-testid="chat-pet-drag-handle" 的拖拽手柄(仅顶部窄带)——
 * 不在图片/精灵本体上挂任何事件,不发命令、不弹层、不发气泡/toast。拖动只即时
 * 改本地偏移,pointer-up 才经 onPositionChange 落盘,并按定位容器实测边界逐轴夹。
 */
export default function PetAvatar({ pet, state, prefs, onPositionChange }: PetAvatarProps): JSX.Element | null {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const motion = motionFor(state, prefs.motion, reduced)
  const sprite = pet.sprite
  const outerRef = useRef<HTMLDivElement | null>(null)

  // 精灵表每行真实帧数:固定网格 + 透明列补齐,各行帧数不一(idle 6/failed 4/…)。
  // 一次性把精灵表画进离屏 canvas、逐格采样 alpha,推出每行真实帧数;帧循环只跑
  // 真实帧,绝不循环到尾部透明列(否则宠物会周期性"消失一段时间")。检测不可用
  // (无 canvas / 图片加载失败)时回退 null,动画退回按 columns 循环的旧行为。
  const [frameCounts, setFrameCounts] = useState<number[] | null>(null)
  useEffect(() => {
    if (!sprite || !pet.previewUrl) { setFrameCounts(null); return }
    let alive = true
    const img = new Image()
    img.onload = (): void => {
      if (!alive) return
      try {
        const sheetW = sprite.columns * sprite.frameWidth
        const sheetH = sprite.rows * sprite.frameHeight
        const canvas = document.createElement('canvas')
        canvas.width = sheetW
        canvas.height = sheetH
        const ctx = canvas.getContext('2d')
        if (!ctx) { setFrameCounts(null); return }
        ctx.drawImage(img, 0, 0)
        const { data } = ctx.getImageData(0, 0, sheetW, sheetH)
        const grid: boolean[][] = []
        for (let r = 0; r < sprite.rows; r++) {
          const cells: boolean[] = []
          for (let c = 0; c < sprite.columns; c++) {
            let has = false
            for (let y = r * sprite.frameHeight; y < (r + 1) * sprite.frameHeight && !has; y += ALPHA_SAMPLE_STRIDE) {
              for (let x = c * sprite.frameWidth; x < (c + 1) * sprite.frameWidth; x += ALPHA_SAMPLE_STRIDE) {
                if (data[(y * sheetW + x) * 4 + 3]! > ALPHA_THRESHOLD) { has = true; break }
              }
            }
            cells.push(has)
          }
          grid.push(cells)
        }
        if (alive) setFrameCounts(detectFrameCounts(grid, sprite.columns))
      } catch {
        if (alive) setFrameCounts(null)
      }
    }
    img.onerror = (): void => { if (alive) setFrameCounts(null) }
    img.src = pet.previewUrl
    return () => { alive = false }
  }, [sprite, pet.previewUrl])

  const row = sprite ? spriteRowFor(state, sprite.rows) : 0
  const frameCount = sprite ? Math.max(1, frameCounts?.[row] ?? sprite.columns) : 1

  // 精灵表帧动画:仅在允许动效且确有精灵表时用 rAF 推进当前行内的真实帧;
  // reduced/static 或静态图片一律停在第 0 帧。frameCount 随行(状态)与检测结果变化,
  // 入依赖以便切状态/检测就绪时重启节拍。
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!sprite || reduced || motion.durationMs === 0) {
      setFrame(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const frameMs = motion.durationMs / frameCount
    const tick = (now: number): void => {
      const elapsed = now - start
      setFrame(Math.floor((elapsed % motion.durationMs) / frameMs) % frameCount)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sprite, reduced, motion.durationMs, state, frameCount])

  // 拖拽边界:由定位容器(offsetParent)与宠物自身渲染尺寸实测。挂载/窗口 resize/
  // 缩放或图片变化时重测,用于把持久化的偏移夹回当前可视区——防止「大窗口拖很高→
  // 缩窗后宠物落到屏外、连拖拽手柄都够不着」的死局。
  const [bounds, setBounds] = useState<DragBounds | null>(null)
  const measureBounds = (): DragBounds | null => {
    const el = outerRef.current
    if (!el) return null
    const parent = el.offsetParent as HTMLElement | null
    const rect = el.getBoundingClientRect()
    const pw = parent?.clientWidth ?? window.innerWidth
    const ph = parent?.clientHeight ?? window.innerHeight
    if (pw <= 0 || ph <= 0 || rect.width <= 0 || rect.height <= 0) return null
    return dragBounds(pw, ph, rect.width, rect.height, RIGHT_ANCHOR, BOTTOM_ANCHOR, DRAG_MARGIN)
  }
  useEffect(() => {
    const update = (): void => setBounds(measureBounds())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet.previewUrl, prefs.scale, sprite, frameCount])

  // 拖拽:本地偏移即时跟手,pointer-up 才提交;dragRef 存起点(而非增量)+ 本次拖拽
  // 冻结的边界,防止连续 move 事件累计误差、并让整程夹到同一套边界。
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; bounds: DragBounds | null } | null>(null)

  const rawPosition = dragPosition ?? prefs.position
  const position = bounds ? clampPoint(rawPosition, bounds) : rawPosition

  const onDragStart = (e: React.PointerEvent): void => {
    const b = measureBounds()
    // 以「当前显示位置」(已夹过)为起点,避免持久化偏移被夹小后一按就跳。
    const start = b ? clampPoint(prefs.position, b) : position
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: start.x, baseY: start.y, bounds: b }
    setDragPosition(start)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const next = { x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) }
    setDragPosition(d.bounds ? clampPoint(next, d.bounds) : next)
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    // 直接用本次事件坐标算落点(与 onDragMove 同一套公式),不读回 dragPosition state——
    // 避免 pointerup 抢在上一次 pointermove 的 setState 提交前触发时读到过期闭包。
    const raw = { x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) }
    const next = d.bounds ? clampPoint(raw, d.bounds) : raw
    setDragPosition(null)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    onPositionChange(next)
  }

  if (!prefs.enabled || !pet.available || !pet.previewUrl) return null

  return (
    // 外层只管定位/可见性(inline transform: translate+scale)+ testid,
    // 承拖拽手柄——两层各管自己的 transform,CSS 动效(内层 motion.className)
    // 不会覆盖这里的 inline transform,拖动/缩放才总能生效。
    <div
      ref={outerRef}
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
            backgroundPosition: `-${Math.min(frame, frameCount - 1) * sprite.frameWidth}px -${row * sprite.frameHeight}px`,
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
