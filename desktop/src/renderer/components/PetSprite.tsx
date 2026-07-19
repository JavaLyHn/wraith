import { useEffect, useState } from 'react'
import type { PetMotionStyle, PetSprite as PetSpriteType, PetState } from '../../shared/pets'
import { detectFrameCounts, motionFor, spriteRowFor } from '../lib/petMotion'

export interface PetSpriteProps {
  previewUrl: string | null
  sprite: PetSpriteType | null
  state: PetState
  motion: PetMotionStyle
  scale: number
}

// 单张静态图片的紧凑固定尺寸上限(与精灵表 192×208 量级一致);精灵路径已有
// 自己的固定 frameWidth/frameHeight,不走这个上限。抽自 PetAvatar.tsx。
const STATIC_IMAGE_MAX_PX = 112

// 精灵表逐格 alpha 采样步长与阈值:一次性检测每行真实帧数用,越大越快、越小越准;
// 4px 步长足以判「该格是否有非透明像素」。抽自 PetAvatar.tsx。
const ALPHA_SAMPLE_STRIDE = 4
const ALPHA_THRESHOLD = 16

/**
 * PetSprite — 纯展示的宠物精灵/单图渲染,从 PetAvatar.tsx 抽出(spec Task 7)。
 * 不含任何拖拽/定位/testid-chat-pet 逻辑——那些属于旧聊天内浮件,全局常驻宠物窗
 * 由主进程(petWindow.ts)负责位置与窗口尺寸;本组件只管"给定状态该画成什么样"。
 * 整只铺满窗口(窗口尺寸即缩放后的精灵尺寸),缩放经 root 上的 CSS transform 实现,
 * 不改变内部的精灵帧/单图布局尺寸。
 */
export default function PetSprite({ previewUrl, sprite, state, motion: motionStyle, scale }: PetSpriteProps): JSX.Element {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const anim = motionFor(state, motionStyle, reduced)

  // 精灵表每行真实帧数:固定网格 + 透明列补齐,各行帧数不一(idle 6/failed 4/…)。
  // 一次性把精灵表画进离屏 canvas、逐格采样 alpha,推出每行真实帧数;帧循环只跑
  // 真实帧,绝不循环到尾部透明列(否则宠物会周期性"消失一段时间")。检测不可用
  // (无 canvas / 图片加载失败)时回退 null,动画退回按 columns 循环的旧行为。
  const [frameCounts, setFrameCounts] = useState<number[] | null>(null)
  useEffect(() => {
    if (!sprite || !previewUrl) { setFrameCounts(null); return }
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
    img.src = previewUrl
    return () => { alive = false }
  }, [sprite, previewUrl])

  const row = sprite ? spriteRowFor(state, sprite.rows) : 0
  const frameCount = sprite ? Math.max(1, frameCounts?.[row] ?? sprite.columns) : 1

  // 精灵表帧动画:仅在允许动效且确有精灵表时用 rAF 推进当前行内的真实帧;
  // reduced/static 或静态图片一律停在第 0 帧。frameCount 随行(状态)与检测结果变化,
  // 入依赖以便切状态/检测就绪时重启节拍。
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!sprite || reduced || anim.durationMs === 0) {
      setFrame(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const frameMs = anim.durationMs / frameCount
    const tick = (now: number): void => {
      const elapsed = now - start
      setFrame(Math.floor((elapsed % anim.durationMs) / frameMs) % frameCount)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sprite, reduced, anim.durationMs, state, frameCount])

  return (
    <div data-testid="pet-sprite" style={{ transform: `scale(${scale})` }}>
      {!previewUrl ? null : sprite ? (
        <div
          aria-hidden="true"
          className={anim.className}
          style={{
            width: sprite.frameWidth,
            height: sprite.frameHeight,
            backgroundImage: `url(${previewUrl})`,
            backgroundSize: `${sprite.columns * sprite.frameWidth}px ${sprite.rows * sprite.frameHeight}px`,
            backgroundPosition: `-${Math.min(frame, frameCount - 1) * sprite.frameWidth}px -${row * sprite.frameHeight}px`,
          }}
        />
      ) : (
        <img
          alt=""
          className={anim.className}
          style={{ maxWidth: STATIC_IMAGE_MAX_PX, maxHeight: STATIC_IMAGE_MAX_PX }}
          src={previewUrl}
        />
      )}
    </div>
  )
}
