// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PetSprite from '../src/renderer/components/PetSprite'

afterEach(cleanup)

// 症状(用户截图):设置里的「当前预览」框显示「一只完整的宠物 + 下面多出来一截」。
// 根因:预览用裸 <img src={previewUrl}> 把**整张精灵图**(所有帧)缩进 80×80 的框,
// 那一截就是下一帧/下一行。修法:精灵图走 PetSprite,用 backgroundPosition 只截第 0 帧,
// 与桌宠窗里实际显示的是同一套算法。这里守住「只显示一帧」这个不变量。
describe('精灵图只显示一帧', () => {
  const SPRITE = { columns: 8, rows: 9, frameWidth: 192, frameHeight: 208 }

  it('容器盒子只有一帧大，不是整张图', () => {
    render(<PetSprite previewUrl="data:image/png;base64,AAAA" sprite={SPRITE}
      state="idle" motion="static" scale={1} />)

    const frame = screen.getByTestId('pet-sprite').firstElementChild as HTMLElement
    expect(frame.style.width).toBe('192px')
    expect(frame.style.height).toBe('208px')
    // 背景图按整张铺开(8×192 × 9×208),再靠 backgroundPosition 把视口移到某一帧 ——
    // 若容器等于整张图的尺寸,就会像 <img> 那样把所有帧都露出来
    expect(frame.style.backgroundSize).toBe('1536px 1872px')
  })

  it('第 0 帧的位移是 0,0 —— 预览不该从半帧开始', () => {
    render(<PetSprite previewUrl="data:image/png;base64,AAAA" sprite={SPRITE}
      state="idle" motion="static" scale={1} />)

    const frame = screen.getByTestId('pet-sprite').firstElementChild as HTMLElement
    // jsdom 会把 -0px 规范成 0px,所以不比字面量,只断言「不是非零位移」
    expect(frame.style.backgroundPosition.replace(/-0px/g, '0px')).toBe('0px 0px')
  })
})
