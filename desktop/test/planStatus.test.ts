import { describe, it, expect } from 'vitest'
import { planStatusIcon } from '../src/renderer/lib/planStatus'

describe('planStatusIcon', () => {
  it('映射四态', () => {
    expect(planStatusIcon('pending')).toBe('○')
    expect(planStatusIcon('running')).toBe('◐')
    expect(planStatusIcon('done')).toBe('✓')
    expect(planStatusIcon('failed')).toBe('✗')
  })
})
