import { describe, it, expect } from 'vitest'
import { shouldShowPet } from '../src/shared/petWindow'

describe('shouldShowPet', () => {
  it('enabled 且有可用宠物才显示', () => {
    expect(shouldShowPet({ enabled: true }, true)).toBe(true)
    expect(shouldShowPet({ enabled: true }, false)).toBe(false)
    expect(shouldShowPet({ enabled: false }, true)).toBe(false)
  })
})
