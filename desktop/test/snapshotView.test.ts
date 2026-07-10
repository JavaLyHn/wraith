import { describe, it, expect } from 'vitest'
import { phaseLabel } from '../src/renderer/lib/snapshotView'

describe('phaseLabel', () => {
  it('PRE_TURN → 轮前', () => expect(phaseLabel('PRE_TURN')).toBe('轮前'))
  it('POST_TURN → 轮后', () => expect(phaseLabel('POST_TURN')).toBe('轮后'))
  it('PRE_RESTORE → 恢复前', () => expect(phaseLabel('PRE_RESTORE')).toBe('恢复前'))
  it('未知 → 原值', () => expect(phaseLabel('WHATEVER')).toBe('WHATEVER'))
})
