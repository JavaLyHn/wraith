import { describe, it, expect } from 'vitest'
import { petHtmlTarget } from '../src/main/petWindow'

describe('petHtmlTarget', () => {
  it('dev 用 ELECTRON_RENDERER_URL/pet.html,prod 用 file', () => {
    expect(petHtmlTarget('http://localhost:5873', '/x/out/main')).toEqual({ url: 'http://localhost:5873/pet.html' })
    expect(petHtmlTarget(undefined, '/x/out/main')).toEqual({ file: '/x/out/renderer/pet.html' })
  })
})
