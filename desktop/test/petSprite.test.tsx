// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
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
})
