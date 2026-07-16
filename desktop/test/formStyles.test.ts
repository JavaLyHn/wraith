import { describe, expect, it } from 'vitest'
import { isNarrowLayout, NARROW_LAYOUT_PX } from '../src/renderer/lib/formStyles'

describe('isNarrowLayout', () => {
  it('阈值 640', () => { expect(NARROW_LAYOUT_PX).toBe(640) })
  it('< 640 → 窄', () => { expect(isNarrowLayout(500)).toBe(true); expect(isNarrowLayout(639)).toBe(true) })
  it('>= 640 → 宽', () => { expect(isNarrowLayout(640)).toBe(false); expect(isNarrowLayout(900)).toBe(false) })
  it('0/负(未测量)→ 宽(不误切窄,避免初帧闪单栏)', () => { expect(isNarrowLayout(0)).toBe(false) })
})
