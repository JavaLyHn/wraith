import { describe, it, expect } from 'vitest'
import { grabOffset, originFromPointer, clampToDisplay } from '../src/shared/petWindow'

// 症状(Windows):宠物拖着拖着就跳到屏幕最顶端,然后往下也拖不动。
// 根因:抓取偏移原来在渲染层用 window.screenX/screenY 算,而窗口位置是主进程 setBounds
// 改的 —— Chromium 那份认知不保证跟着更新,几次移动后就陈旧。dy 偏大 → y 变负 →
// 被 clampToDisplay 钳到 workArea.y,且继续往下拖仍为负 → 卡死在顶上。
// 修法:偏移改由主进程用自己的 getBounds() 算。这里守住那套算术 + 复现旧症状。
describe('宠物拖动的抓取偏移', () => {
  const WA = { x: 0, y: 0, width: 1920, height: 1040 }
  const SIZE = { width: 300, height: 300 }

  it('偏移 = 指针 − 窗口左上角；换算回去得到原点', () => {
    const bounds = { x: 500, y: 400, ...SIZE }
    const grab = grabOffset({ x: 560, y: 450 }, bounds)
    expect(grab).toEqual({ dx: 60, dy: 50 })
    expect(originFromPointer({ x: 700, y: 600 }, grab)).toEqual({ x: 640, y: 550 })
  })

  it('用权威 bounds 算出的偏移，往下拖真的能往下走', () => {
    const bounds = { x: 500, y: 400, ...SIZE }
    const grab = grabOffset({ x: 560, y: 450 }, bounds)
    // 取 y=600(不触底):max y = 0+1040-300 = 740,再往下会被正常钳住
    const moved = clampToDisplay({ ...originFromPointer({ x: 560, y: 600 }, grab), ...SIZE }, WA)
    expect(moved.y).toBe(550)
  })

  it('复现旧 bug：拿陈旧的窗口顶算偏移 → y 变负 → 被钳在最顶端且拖不下来', () => {
    // 窗口真实在 y=400,按下点 y=450,所以正确的 dy 是 50。
    // 但渲染层那份 window.screenY 陈旧/报 0 时,dy 被算成 450 —— 偏大 400。
    const badGrab = { dx: 60, dy: 450 - 0 }
    // 于是任何 pointerY < 450 的位置都换算出负 y,一律被钳到最顶端:
    const y1 = clampToDisplay({ ...originFromPointer({ x: 560, y: 300 }, badGrab), ...SIZE }, WA).y
    const y2 = clampToDisplay({ ...originFromPointer({ x: 560, y: 440 }, badGrab), ...SIZE }, WA).y
    expect(y1).toBe(WA.y)  // 顶端
    expect(y2).toBe(WA.y)  // 往下拖了 140px,还在顶端 —— 正是用户说的「往下也不行」
    // 对照:同一段拖动用权威 bounds 算的偏移(dy=50)是能往下走的
    const good = { dx: 60, dy: 50 }
    expect(clampToDisplay({ ...originFromPointer({ x: 560, y: 440 }, good), ...SIZE }, WA).y).toBe(390)
  })
})
