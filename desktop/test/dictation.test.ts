import { describe, it, expect } from 'vitest'
import { bytesToBase64, insertAtCursor } from '../src/renderer/lib/dictation'

describe('bytesToBase64', () => {
  it('编码为标准 base64(无 dataURL 前缀)', () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=')          // "hi"
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
  })
})

describe('insertAtCursor', () => {
  it('空输入插入', () => {
    expect(insertAtCursor('', 0, 0, '你好')).toEqual({ value: '你好', caret: 2 })
  })
  it('光标居中插入', () => {
    expect(insertAtCursor('ab', 1, 1, 'X')).toEqual({ value: 'aXb', caret: 2 })
  })
  it('替换选区', () => {
    expect(insertAtCursor('abc', 0, 2, 'Z')).toEqual({ value: 'Zc', caret: 1 })
  })
  it('越界光标夹紧到长度', () => {
    expect(insertAtCursor('ab', 99, 99, 'X')).toEqual({ value: 'abX', caret: 3 })
  })
})
