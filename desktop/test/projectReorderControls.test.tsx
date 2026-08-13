// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ProjectRowMenu from '../src/renderer/components/ProjectRowMenu'
import ProjectRow from '../src/renderer/components/ProjectRow'
import type { ProjectRowData } from '../src/renderer/lib/projectsView'

function row(over: Partial<ProjectRowData> = {}): ProjectRowData {
  return {
    view: { path: '/p/a', lastUsedAt: 1, exists: true },
    displayName: 'a', sessionCount: 0, lastSessionAt: null, ...over,
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

afterEach(() => cleanup())

describe('project reorder menu', () => {
  it('calls move with adjacent group indexes', () => {
    const onMove = vi.fn()
    render(<ProjectRowMenu row={row()} active={false} onRename={vi.fn()} onArchiveChats={vi.fn()} onRemove={vi.fn()} canMoveUp canMoveDown moveIndex={2} onMove={onMove} />)
    fireEvent.click(screen.getByTestId('project-row-menu'))
    fireEvent.click(screen.getByTestId('project-menu-up'))
    fireEvent.click(screen.getByTestId('project-menu-down'))
    expect(onMove).toHaveBeenNthCalledWith(1, '/p/a', 1)
    expect(onMove).toHaveBeenNthCalledWith(2, '/p/a', 3)
  })

  it('disables both controls at a one-item boundary', () => {
    render(<ProjectRowMenu row={row()} active={false} onRename={vi.fn()} onArchiveChats={vi.fn()} onRemove={vi.fn()} />)
    fireEvent.click(screen.getByTestId('project-row-menu'))
    expect((screen.getByTestId('project-menu-up') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('project-menu-down') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('project reorder drag', () => {
  it('moves a dragged project to a same-group target index', () => {
    const onMove = vi.fn()
    render(<ProjectRow row={row()} active={false} busy={false} now={Date.now()} onOpen={vi.fn()} onNewConversation={vi.fn()} onToggleStar={vi.fn()} onOpenSession={vi.fn()} moveIndex={1} group="rest" onMove={onMove} />)
    const target = screen.getByTestId('project-row')
    const dataTransfer = { setData: vi.fn(), getData: vi.fn((kind: string) => kind === 'text/plain' ? '/p/source' : 'rest') }
    fireEvent.dragStart(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(onMove).toHaveBeenCalledWith('/p/source', 1)
  })

  it('ignores a dragged project from another group', () => {
    const onMove = vi.fn()
    render(<ProjectRow row={row({ view: { path: '/p/a', lastUsedAt: 1, exists: true, starred: true } })} active={false} busy={false} now={Date.now()} onOpen={vi.fn()} onNewConversation={vi.fn()} onToggleStar={vi.fn()} onOpenSession={vi.fn()} moveIndex={0} group="starred" onMove={onMove} />)
    const target = screen.getByTestId('project-row')
    const dataTransfer = { setData: vi.fn(), getData: vi.fn((kind: string) => kind === 'text/plain' ? '/p/source' : 'rest') }
    fireEvent.drop(target, { dataTransfer })
    expect(onMove).not.toHaveBeenCalled()
  })
})
