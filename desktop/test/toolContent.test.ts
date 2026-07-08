import { describe, it, expect } from 'vitest'
import { prettyArgs, stripDsml } from '../src/renderer/lib/toolContent'

describe('prettyArgs', () => {
  it('合法 JSON → 缩进', () => {
    expect(prettyArgs('{"a":1}')).toBe('{\n  "a": 1\n}')
  })
  it('非法 JSON → 原样返回', () => {
    expect(prettyArgs('{"a":"x"步}')).toBe('{"a":"x"步}')
  })
  it('空 → 空', () => { expect(prettyArgs('')).toBe('') })
})

describe('stripDsml', () => {
  it('去除 <|DSML|…> 标记', () => {
    expect(stripDsml('<|DSML|invoke name="t">你好')).toBe('你好')
  })
  it('普通文本原样', () => {
    expect(stripDsml('正常消息')).toBe('正常消息')
  })
})
