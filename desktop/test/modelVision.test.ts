import { describe, it, expect } from 'vitest'
import { imageSupport, shouldBlockImageSend } from '../src/shared/modelVision'

describe('imageSupport', () => {
  it('glm-5v-turbo → supported', () => expect(imageSupport('glm-5v-turbo')).toBe('supported'))
  it('GLM-5V(大小写) → supported', () => expect(imageSupport('GLM-5V')).toBe('supported'))
  it('deepseek-v4-flash → unsupported', () => expect(imageSupport('deepseek-v4-flash')).toBe('unsupported'))
  it('deepseek-v4-pro → unsupported', () => expect(imageSupport('deepseek-v4-pro')).toBe('unsupported'))
  it('glm-4.6(非 5v)→ unknown', () => expect(imageSupport('glm-4.6')).toBe('unknown'))
  it('gpt-4o → unknown(放行)', () => expect(imageSupport('gpt-4o')).toBe('unknown'))
  it('空 → unknown', () => expect(imageSupport('')).toBe('unknown'))
})

describe('shouldBlockImageSend', () => {
  it('deepseek → 拦', () => expect(shouldBlockImageSend('deepseek-v4-flash')).toBe(true))
  it('glm-5v → 不拦', () => expect(shouldBlockImageSend('glm-5v-turbo')).toBe(false))
  it('未知 → 不拦', () => expect(shouldBlockImageSend('gpt-4o')).toBe(false))
})
