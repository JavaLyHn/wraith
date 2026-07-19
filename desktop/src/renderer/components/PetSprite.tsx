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
  /** 水平朝向:1=原朝向(右)、-1=水平镜像(左)。拖动时按拖动方向翻转,让宠物"向左/
   * 向右奔跑"。翻转的 transform 施加在**非动画的根层**(data-testid="pet-sprite"),
   * 与内层动画 className 各占各的 transform,不会互相覆盖(CSS 动画独占 transform)。
   * 仅拖动期间用(拖动中命中测试已挂起),静息恒为 1,故不影响点击穿透的命中反算。 */
  facing?: number
  /** 显式指定精灵行(优先于按 state 的映射),用于拖动时直接播 Run Right(1)/Run Left(2)
   * 真行——精灵表分绘了左右两向奔跑帧,比 scaleX 镜像更准。越界或 null 时回退状态映射。 */
  rowOverride?: number | null
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
export default function PetSprite({ previewUrl, sprite, state, motion: motionStyle, scale, onFrame, facing = 1, rowOverride = null }: PetSpriteProps): JSX.Element {
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

  // rowOverride(拖动方向奔跑传入 Run Right/Left 真行)优先于状态映射,但须在行数界内,
  // 否则回退到按状态映射的行(与无 override 一致)。
  const row = sprite
    ? (rowOverride != null && rowOverride >= 0 && rowOverride < sprite.rows ? rowOverride : spriteRowFor(state, sprite.rows))
    : 0
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

  // 渲染实际用的列必须 clamp 到 [0, frameCount-1](frameCounts 是异步检测出来的,
  // 行内真实帧数可能比 frame 的当前值小一拍;不 clamp 会在过渡的那一 tick 里让
  // backgroundPosition 指向该行尾部的透明补齐列)。onFrame 汇报的也必须是这个
  // clamp 后的值,而不是原始 frame——否则 PetWindowApp 的命中测试会在同一拍里对着
  // 跟画面不一致的列算,命中会短暂错位(尽管方向上是"多穿透"而非"误捕获",不算危险,
  // 但仍是真实的、该修的不一致)。
  const shownCol = Math.min(frame, frameCount - 1)

  // 把当前帧列号回报给调用方(PetWindowApp,Task 8 点击穿透命中测试用来定位当前展示
  // 帧的 sheet 偏移)。只报数字帧号,不暴露 canvas/ImageData 等内部解码状态。
  useEffect(() => {
    onFrame?.(shownCol)
  }, [shownCol, onFrame])

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
    <div data-testid="pet-sprite" style={{ transform: `scaleX(${facing})` }}>
      {!previewUrl ? null : sprite ? (
        <div
          aria-hidden="true"
          className={anim.className}
          style={{
            width: sprite.frameWidth * scale,
            height: sprite.frameHeight * scale,
            backgroundImage: `url(${previewUrl})`,
            backgroundSize: `${sprite.columns * sprite.frameWidth * scale}px ${sprite.rows * sprite.frameHeight * scale}px`,
            backgroundPosition: `-${shownCol * sprite.frameWidth * scale}px -${row * sprite.frameHeight * scale}px`,
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
