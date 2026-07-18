import { describe, expect, it } from 'vitest'
import { motionFor } from '../src/renderer/lib/petMotion'

describe('motionFor', () => {
  it('在减少动态效果或静态风格时不提供动画', () => {
    expect(motionFor('tool', 'static', false)).toEqual({ className: '', durationMs: 0 })
    expect(motionFor('success', 'calm', true)).toEqual({ className: '', durationMs: 0 })
  })

  it('为短暂结果和工具状态提供确定的动画', () => {
    expect(motionFor('success', 'calm', false)).toEqual({ className: 'pet-success', durationMs: 560 })
    expect(motionFor('error', 'float', false)).toEqual({ className: 'pet-error', durationMs: 420 })
    expect(motionFor('tool', 'lively', false)).toEqual({ className: 'pet-tool', durationMs: 900 })
  })

  it('仅让活泼风格使用活泼思考动作，并为浮动风格提供浮动待机', () => {
    expect(motionFor('thinking', 'lively', false)).toEqual({ className: 'pet-thinking-lively', durationMs: 1400 })
    expect(motionFor('thinking', 'float', false)).toEqual({ className: 'pet-thinking', durationMs: 1400 })
    expect(motionFor('idle', 'float', false)).toEqual({ className: 'pet-idle-float', durationMs: 2200 })
  })
})
