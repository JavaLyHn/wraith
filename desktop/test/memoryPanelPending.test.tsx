// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import MemoryPanel from '../src/renderer/components/MemoryPanel'
import type { PendingFactView } from '../src/shared/types'

afterEach(cleanup)

const PENDING: PendingFactView[] = [
  { id: 'cand-1', fact: '用户偏好 Java 17', type: 'FACT', scope: 'project', nearestExistingId: null, sourceSessionId: 's1', project: '/proj', createdAt: '2026-07-23T00:00:00Z' },
  { id: 'cand-2', fact: '用户住在旧金山', type: 'FACT', scope: 'global', nearestExistingId: 'fact-old99', sourceSessionId: 's1', project: null, createdAt: '2026-07-23T00:00:00Z' },
]

function mockWraith(over: Record<string, unknown> = {}) {
  const w = {
    memoryList: vi.fn(async () => ({ project: '/proj', entries: [], wraithMdExists: false, wraithMdPath: '' })),
    memorySearch: vi.fn(async () => ({ project: '/proj', entries: [] })),
    memoryPendingList: vi.fn(async () => ({ project: '/proj', pending: PENDING })),
    memoryPendingApprove: vi.fn(async () => ({ ok: true })),
    memoryPendingApproveReplacing: vi.fn(async () => ({ ok: true })),
    memoryPendingReject: vi.fn(async () => ({ ok: true })),
    memoryPendingClear: vi.fn(async () => ({ ok: true })),
    memoryExtractNow: vi.fn(async () => ({ enqueued: 2 })),
    ...over,
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

describe('MemoryPanel 待确认区', () => {
  it('渲染候选 + 批准调 memoryPendingApprove(id)', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('memory-pending-section')).toBeTruthy())
    expect(screen.getByText('用户偏好 Java 17')).toBeTruthy()
    expect(screen.getByText('用户住在旧金山')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pending-approve-cand-1'))
    await waitFor(() => expect(w.memoryPendingApprove).toHaveBeenCalledWith('cand-1'))
  })

  it('nearestExistingId 存在 → 有替换键,调 memoryPendingApproveReplacing(id, oldId)', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('pending-replace-cand-2')).toBeTruthy())
    expect(screen.queryByTestId('pending-replace-cand-1')).toBeNull() // cand-1 无 nearest → 无替换键
    fireEvent.click(screen.getByTestId('pending-replace-cand-2'))
    await waitFor(() => expect(w.memoryPendingApproveReplacing).toHaveBeenCalledWith('cand-2', 'fact-old99'))
  })

  it('驳回调 memoryPendingReject(id)', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('pending-reject-cand-1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pending-reject-cand-1'))
    await waitFor(() => expect(w.memoryPendingReject).toHaveBeenCalledWith('cand-1'))
  })

  it('无候选 → 不渲染待确认区', async () => {
    mockWraith({ memoryPendingList: vi.fn(async () => ({ project: '/proj', pending: [] })) })
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('memory-back')).toBeTruthy()) // 面板已挂载
    expect(screen.queryByTestId('memory-pending-section')).toBeNull()
  })

  it('整理记忆键 → 调 memoryExtractNow 并刷新候选', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('memory-extract-now')).toBeTruthy())
    fireEvent.click(screen.getByTestId('memory-extract-now'))
    await waitFor(() => expect(w.memoryExtractNow).toHaveBeenCalled())
    // 触发后会再次拉候选(memoryPendingList 至少被调 2 次:挂载 + 整理后)
    await waitFor(() => expect((w.memoryPendingList as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(2))
  })
})
