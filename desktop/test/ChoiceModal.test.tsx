// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ChoiceModal from '../src/renderer/components/ChoiceModal'
import type { ChoiceOption } from '../src/shared/types'

afterEach(cleanup)

const options: ChoiceOption[] = [
  { label: '方案A', description: '描述A' },
  { label: '方案B', description: null },
  { label: '方案C', description: '描述C' },
]

describe('ChoiceModal', () => {
  it('renders title and all options with descriptions', () => {
    render(
      <ChoiceModal
        title="选择方案"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(screen.getByText('选择方案')).toBeTruthy()
    expect(screen.getByText('方案A')).toBeTruthy()
    expect(screen.getByText('描述A')).toBeTruthy()
    expect(screen.getByText('方案B')).toBeTruthy()
    expect(screen.getByText('方案C')).toBeTruthy()
    expect(screen.getByText('描述C')).toBeTruthy()
  })

  it('clicking an option calls onRespond with that index', () => {
    const onRespond = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={onRespond}
        onReject={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('方案B'))
    expect(onRespond).toHaveBeenCalledWith(1)
  })

  it('arrow down moves highlight, Enter confirms highlighted', () => {
    const onRespond = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={onRespond}
        onReject={vi.fn()}
      />
    )
    // 默认高亮第 0 项,按一次下 → 高亮第 1 项,Enter 确认
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith(1)
  })

  it('arrow up wraps to last item', () => {
    const onRespond = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={onRespond}
        onReject={vi.fn()}
      />
    )
    // 默认高亮第 0 项,按上 → 循环到最后一项(index 2),Enter 确认
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith(2)
  })

  it('ESC calls onReject when allowCancel=true', () => {
    const onReject = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={vi.fn()}
        onReject={onReject}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onReject).toHaveBeenCalled()
  })

  it('ESC does nothing when allowCancel=false', () => {
    const onReject = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={false}
        hint={null}
        onRespond={vi.fn()}
        onReject={onReject}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onReject).not.toHaveBeenCalled()
  })

  it('shows hint when provided', () => {
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint="自定义提示"
        onRespond={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(screen.getByText('自定义提示')).toBeTruthy()
  })
})
