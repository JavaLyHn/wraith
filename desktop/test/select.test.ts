import { describe, it, expect } from 'vitest'
import { selectedLabel } from '../src/renderer/components/ui/select'

describe('selectedLabel', () => {
  const opts = [{ value: 'user', label: '用户' }, { value: 'project', label: '项目' }]
  it('命中返回对应 label', () => {
    expect(selectedLabel(opts, 'project')).toBe('项目')
  })
  it('未命中返回 null', () => {
    expect(selectedLabel(opts, 'nope')).toBeNull()
  })
  it('空 options 返回 null', () => {
    expect(selectedLabel([], 'user')).toBeNull()
  })
})
