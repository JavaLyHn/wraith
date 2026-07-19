import { useEffect, useState } from 'react'
import type { PetMotionStyle, PetSprite as PetSpriteType, PetState } from '../../shared/pets'
import { detectFrameCounts, motionFor, spriteRowFor } from '../lib/petMotion'
import { STATIC_IMAGE_MAX_PX, containScale } from '../../shared/petWindow'

export interface PetSpriteProps {
  previewUrl: string | null
  sprite: PetSpriteType | null
  state: PetState
  motion: PetMotionStyle
  scale: number
  /** 当前动画帧列号(精灵表场景下的 frame index,单图场景不触发)变化时回调——
   * 供 PetWindowApp(Task 8 点击穿透)独立反算指针命中的 sheet 像素时定位当前帧,
   * 不必读取本组件任何内部 ref/state(canvas ImageData 等仍完全私有)。 */
  onFrame?: (frame: number) => void
}

// 精灵表逐格 alpha 采样步长与阈值:一次性检测每行真实帧数用,越大越快、越小越准;
// 4px 步长足以判「该格是否有非透明像素」。抽自 PetAvatar.tsx。
const ALPHA_SAMPLE_STRIDE = 4
const ALPHA_THRESHOLD = 16

/**
 * PetSprite — 纯展示的宠物精灵/单图渲染,从 PetAvatar.tsx 抽出(spec Task 7)。
 * 不含任何拖拽/定位/testid-chat-pet 逻辑——那些属于旧聊天内浮件,全局常驻宠物窗
 * 由主进程(petWindow.ts)负责位置与窗口尺寸;本组件只管"给定状态该画成什么样"。
 * 整只铺满窗口(窗口尺寸即缩放后的精灵尺寸),从窗口左上角原点起画——精灵/图片盒子
 * 精确是 `frameW*scale × frameH*scale`(CSS 宽高/背景尺寸直接乘 scale),不再用
 * `transform: scale`(那样 transform-origin 默认居中,scale≠1 时窗口坐标与实际像素
 * 的对应关系会随 scale 漂移,既说不清居中裁切该往哪边留白,也没法给点击穿透的命中
 * 测试一个唯一反算公式——这是 Task 7 留下的遗留问题,在这里连带修掉;点击穿透的
 * 反算公式见 shared/petWindow.ts 的 spriteHitPixel,必须和这里的渲染盒子保持同一套
 * 换算,否则命中会跟视觉画面对不上)。
 */
export default function PetSprite({ previewUrl, sprite, state, motion: motionStyle, scale, onFrame }: PetSpriteProps): JSX.Element {
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

  // 把当前帧列号回报给调用方(PetWindowApp,Task 8 点击穿透命中测试用来定位当前展示
  // 帧的 sheet 偏移)。只报数字帧号,不暴露 canvas/ImageData 等内部解码状态。
  useEffect(() => {
    onFrame?.(frame)
  }, [frame, onFrame])

  // 单图路径的原始像素尺寸,onLoad 时取 naturalWidth/Height 显式算出「等比收缩到
  // STATIC_IMAGE_MAX_PX、再乘 scale」后的渲染尺寸(见 containScale)——不能再用 CSS
  // max-width/max-height 隐式收缩,因为 PetWindowApp 的命中测试反算需要一份跟渲染
  // 结果严格一致、可预先算出的缩放比,浏览器的 auto 布局算法给不出这个数。previewUrl
  // 切换(换宠物/换单图)时清空,避免短暂拿旧图尺寸套在新图上。
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    setImgSize(null)
  }, [previewUrl])
  const capRatio = imgSize ? containScale(imgSize.w, imgSize.h, STATIC_IMAGE_MAX_PX) : null

  return (
    <div data-testid="pet-sprite">
      {!previewUrl ? null : sprite ? (
        <div
          aria-hidden="true"
          className={anim.className}
          style={{
            width: sprite.frameWidth * scale,
            height: sprite.frameHeight * scale,
            backgroundImage: `url(${previewUrl})`,
            backgroundSize: `${sprite.columns * sprite.frameWidth * scale}px ${sprite.rows * sprite.frameHeight * scale}px`,
            backgroundPosition: `-${Math.min(frame, frameCount - 1) * sprite.frameWidth * scale}px -${row * sprite.frameHeight * scale}px`,
          }}
        />
      ) : (
        <img
          alt=""
          className={anim.className}
          style={
            imgSize && capRatio !== null
              ? { width: imgSize.w * capRatio * scale, height: imgSize.h * capRatio * scale }
              : { maxWidth: STATIC_IMAGE_MAX_PX * scale, maxHeight: STATIC_IMAGE_MAX_PX * scale }
          }
          onLoad={(e) => setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          src={previewUrl}
        />
      )}
    </div>
  )
}
