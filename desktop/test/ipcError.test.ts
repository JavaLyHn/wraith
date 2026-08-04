import { describe, it, expect } from 'vitest'
import { ipcErrorText } from '../src/renderer/lib/ipcError'

describe('ipcErrorText', () => {
  it('剥掉 Electron 远程调用前缀,只留主进程那句话', () => {
    const err = new Error(
      "Error invoking remote method 'wraith:documents:open': Error: 文件已不存在",
    )
    expect(ipcErrorText(err)).toBe('文件已不存在')
  })

  it('前缀里没有第二层 "Error: " 时也能剥干净', () => {
    const err = new Error("Error invoking remote method 'wraith:documents:list': 磁盘不可读")
    expect(ipcErrorText(err)).toBe('磁盘不可读')
  })

  it('无前缀的普通错误原样透出', () => {
    expect(ipcErrorText(new Error('非法文件名:../etc/passwd'))).toBe('非法文件名:../etc/passwd')
  })

  it('非 Error 值也能给出字符串', () => {
    expect(ipcErrorText('炸了')).toBe('炸了')
  })

  it('消息为空时返回空串(不传 fallback),让调用方自己决定文案', () => {
    expect(ipcErrorText(new Error(''))).toBe('')
    expect(ipcErrorText(new Error("Error invoking remote method 'x': Error: "))).toBe('')
  })

  it('消息为空且给了 fallback 时用 fallback —— 否则界面上会「什么都没发生」', () => {
    expect(ipcErrorText(new Error(''), '打开失败')).toBe('打开失败')
    expect(ipcErrorText(new Error('文件已不存在'), '打开失败')).toBe('文件已不存在')
  })
})
