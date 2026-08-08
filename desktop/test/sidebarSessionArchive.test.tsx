// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionRow } from '../src/renderer/components/Sidebar'
import type { SessionMeta } from '../src/shared/types'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1', cwd: '/a', createdAt: 'c', updatedAt: 'u',
    provider: 'p', model: 'm', title: '当前代码有多少分支', turns: 2, ...over,
  }
}

function props(over: Partial<React.ComponentProps<typeof SessionRow>> = {}) {
  return {
    s: meta(), active: false, running: false,
    onSelect: vi.fn(), onToggleStar: vi.fn(), onRename: vi.fn(), onArchive: vi.fn(),
    ...over,
  }
}

afterEach(() => cleanup())

describe('SessionRow 归档', () => {
  it('有归档按钮', () => {
    render(<SessionRow {...props()} />)
    expect(screen.getByTestId('session-archive')).toBeTruthy()
  })

  it('单击即归档,不需要二次确认', () => {
    const p = props()
    render(<SessionRow {...p} />)
    fireEvent.click(screen.getByTestId('session-archive'))
    expect(p.onArchive).toHaveBeenCalledWith('s1')
  })

  it('删除按钮已从侧栏移除', () => {
    render(<SessionRow {...props()} />)
    expect(screen.queryByTestId('session-delete')).toBeNull()
  })

  it('运行中的会话不可归档', () => {
    render(<SessionRow {...props({ running: true })} />)
    expect((screen.getByTestId('session-archive') as HTMLButtonElement).disabled).toBe(true)
  })

  it('重点与改名按钮不受影响', () => {
    render(<SessionRow {...props()} />)
    expect(screen.getByTestId('session-star')).toBeTruthy()
    expect(screen.getByTestId('session-rename')).toBeTruthy()
  })

  it('改名仍是行内输入框', () => {
    const p = props()
    render(<SessionRow {...p} />)
    fireEvent.click(screen.getByTestId('session-rename'))
    expect(screen.getByTestId('session-rename-input')).toBeTruthy()
  })
})
