// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, act } from '@testing-library/react'
import PetSprite from '../src/renderer/components/PetSprite'
import type { PetSprite as PetSpriteType } from '../src/shared/pets'
import { spriteRowFor } from '../src/renderer/lib/petMotion'

const SPRITE: PetSpriteType = { columns: 8, rows: 9, frameWidth: 192, frameHeight: 208 }
const ANIMATION_CLASS_RE = /pet-(idle|thinking|tool|approval|success|error)/

afterEach(() => {
  cleanup()
})

describe('PetSprite', () => {
  it('单张静态图 + motion=static → 视觉元素上没有 pet-* 动效 class', () => {
    render(
      <PetSprite previewUrl="data:image/png;base64,AAAA" sprite={null} state="idle" motion="static" scale={1} />
    )
    const root = screen.getByTestId('pet-sprite')
    const img = root.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.className).not.toMatch(ANIMATION_CLASS_RE)
  })

  it('精灵表 + state=tool → backgroundPosition 的行位移用 spriteRowFor("tool", rows)', () => {
    render(
      <PetSprite previewUrl="data:image/png;base64,AAAA" sprite={SPRITE} state="tool" motion="calm" scale={1} />
    )
    const root = screen.getByTestId('pet-sprite')
    const cel = root.querySelector('[aria-hidden="true"]') as HTMLElement | null
    expect(cel).not.toBeNull()
    const row = spriteRowFor('tool', SPRITE.rows)
    const expectedY = `-${row * SPRITE.frameHeight}px`
    // canvas 在 jsdom 下不可用,帧检测回退到 columns——这里只断言行(row)位移,不断言列(frame)位移。
    const match = cel!.style.backgroundPosition.match(/^(-?\d+px)\s+(-?\d+px)$/)
    expect(match).not.toBeNull()
    expect(match![2]).toBe(expectedY)
  })

  it('scale=1.5(精灵路径)→ 宽/高、backgroundSize、backgroundPosition(行+列)全部按 1.5 缩放', () => {
    // 回归锁:scale=1 时 row*frameHeight 恰好等于 row*frameHeight*scale,乘 scale 这一步会被
    // "巧合地"掩盖过去——必须在 scale≠1 时断言才能真正锁住 *scale 乘法(Task 8 code review flag)。
    // frame(列)只能靠 rAF 推进,jsdom 下不会自动 tick;这里手动接管 requestAnimationFrame/
    // performance.now,直接调一次 tick(不依赖 fake timer 的内部 rAF/clock 语义),把 frame 推到
    // 非 0 列,让 backgroundPosition 的 X 分量也真正带上非零值可供断言 *scale。
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000)
    try {
      render(
        <PetSprite previewUrl="data:image/png;base64,AAAA" sprite={SPRITE} state="tool" motion="calm" scale={1.5} />
      )
      const root = screen.getByTestId('pet-sprite')
      const cel = root.querySelector('[aria-hidden="true"]') as HTMLElement | null
      expect(cel).not.toBeNull()

      // mount 时的动效 effect 排了第一帧 rAF;取出那次调用传入的 tick 回调,手动喂一个
      // "200ms 后" 的时间戳(start=1000,now=1200→elapsed=200)。frameCount 在 jsdom 回退到
      // sprite.columns(8),state=tool 的 anim.durationMs=900 → frameMs=112.5 →
      // floor(200/112.5)%8 = 1(非 0、非最后一帧,足以证明列位移也乘了 scale)。
      expect(rafSpy).toHaveBeenCalled()
      const tick = rafSpy.mock.calls[0]![0] as (now: number) => void
      act(() => { tick(1200) })

      const row = spriteRowFor('tool', SPRITE.rows)
      const expectedCol = 1
      expect(cel!.style.width).toBe(`${SPRITE.frameWidth * 1.5}px`)
      expect(cel!.style.height).toBe(`${SPRITE.frameHeight * 1.5}px`)
      expect(cel!.style.backgroundSize).toBe(`${SPRITE.columns * SPRITE.frameWidth * 1.5}px ${SPRITE.rows * SPRITE.frameHeight * 1.5}px`)
      expect(cel!.style.backgroundPosition).toBe(
        `-${expectedCol * SPRITE.frameWidth * 1.5}px -${row * SPRITE.frameHeight * 1.5}px`
      )
    } finally {
      rafSpy.mockRestore()
      nowSpy.mockRestore()
    }
  })
})
