// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import CloseConfirmModal from '../src/renderer/components/CloseConfirmModal'

afterEach(cleanup)

type RespondFn = (mode: 'background' | 'quit', remember: boolean) => void
type CancelFn = () => void

function renderModal(over: { onRespond?: ReturnType<typeof vi.fn>; onCancel?: ReturnType<typeof vi.fn> } = {}) {
  const onRespond = (over.onRespond ?? vi.fn()) as ReturnType<typeof vi.fn> & RespondFn
  const onCancel = (over.onCancel ?? vi.fn()) as ReturnType<typeof vi.fn> & CancelFn
  render(<CloseConfirmModal onRespond={onRespond} onCancel={onCancel} />)
  return { onRespond, onCancel }
}

describe('CloseConfirmModal', () => {
  it('点击「挂后台」回调 (background, false)', () => {
    const { onRespond } = renderModal()
    fireEvent.click(screen.getByTestId('close-confirm-background'))
    expect(onRespond).toHaveBeenCalledWith('background', false)
  })

  it('点击「直接退出」回调 (quit, false)', () => {
    const { onRespond } = renderModal()
    fireEvent.click(screen.getByTestId('close-confirm-quit'))
    expect(onRespond).toHaveBeenCalledWith('quit', false)
  })

  it('勾选「下次别问」后点击选项传 remember=true', () => {
    const { onRespond } = renderModal()
    const checkbox = screen.getByTestId('close-confirm-remember').querySelector('input')!
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    fireEvent.click(screen.getByTestId('close-confirm-background'))
    expect(onRespond).toHaveBeenCalledWith('background', true)
  })

  it('Escape 键调用 onCancel', () => {
    const { onCancel } = renderModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('X 按钮调用 onCancel', () => {
    const { onCancel } = renderModal()
    fireEvent.click(screen.getByTestId('close-confirm-x'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('「取消」按钮调用 onCancel', () => {
    const { onCancel } = renderModal()
    // 取消按钮没有 testid,按文本查找
    const cancelBtn = screen.getByText('取消')
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalled()
  })

  it('Enter 键确认当前高亮项(默认 background)', () => {
    const { onRespond } = renderModal()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('background', false)
  })

  it('ArrowDown 切换高亮到 quit,Enter 确认', () => {
    const { onRespond } = renderModal()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('quit', false)
  })

  it('ArrowUp 从第二项回到第一项', () => {
    const { onRespond } = renderModal()
    fireEvent.keyDown(window, { key: 'ArrowDown' })  // → quit
    fireEvent.keyDown(window, { key: 'ArrowUp' })    // → background
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('background', false)
  })

  it('渲染两个选项 + 标题 + 描述', () => {
    renderModal()
    expect(screen.getByTestId('close-confirm-background')).toBeTruthy()
    expect(screen.getByTestId('close-confirm-quit')).toBeTruthy()
    expect(screen.getByTestId('close-confirm-remember')).toBeTruthy()
    expect(screen.getByText('关闭窗口')).toBeTruthy()
    expect(screen.getByText('选择关闭方式(可记住选择)')).toBeTruthy()
  })
})
