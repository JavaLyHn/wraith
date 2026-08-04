// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import DocumentsPanel from '../src/renderer/components/DocumentsPanel'
import type { DocEntry } from '../src/shared/types'

afterEach(cleanup)

const DOCS: DocEntry[] = [
  { name: '需求文档.pdf', size: 2_517_000, addedAt: Date.now() - 86_400_000 },
  { name: 'API 设计.md', size: 18_000, addedAt: Date.now() - 3_600_000 },
]

function mockWraith(over: Record<string, unknown> = {}) {
  const documents = {
    list: vi.fn(async () => DOCS),
    add: vi.fn(async () => ({ added: ['新文件.pdf'], failed: [] })),
    remove: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined),
    ...over,
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = { documents }
  return documents
}

describe('DocumentsPanel', () => {
  it('加载后渲染文件行,含大小', async () => {
    mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-row-需求文档.pdf')).toBeTruthy())
    expect(screen.getByText('API 设计.md')).toBeTruthy()
    expect(screen.getByText('2.4 MB')).toBeTruthy()
  })

  it('库为空时显示空态,且不显示搜索框', async () => {
    mockWraith({ list: vi.fn(async () => []) })
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-empty')).toBeTruthy())
    expect(screen.queryByTestId('documents-search')).toBeNull()
  })

  it('点添加按钮调 documents.add() 且不传参(走系统选择器)', async () => {
    const d = mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(d.list).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('documents-add'))
    await waitFor(() => expect(d.add).toHaveBeenCalledWith())
  })

  it('搜索过滤掉不匹配的行', async () => {
    mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-search')).toBeTruthy())
    fireEvent.change(screen.getByTestId('documents-search'), { target: { value: '设计' } })
    expect(screen.queryByTestId('documents-row-需求文档.pdf')).toBeNull()
    expect(screen.getByTestId('documents-row-API 设计.md')).toBeTruthy()
  })

  it('删除要点两次:首次只进确认态,不调 remove', async () => {
    const d = mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-delete-API 设计.md')).toBeTruthy())
    fireEvent.click(screen.getByTestId('documents-delete-API 设计.md'))
    expect(d.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('documents-delete-API 设计.md'))
    await waitFor(() => expect(d.remove).toHaveBeenCalledWith('API 设计.md'))
  })

  it('打开与定位分别调 open/reveal,入参是文件名', async () => {
    const d = mockWraith()
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-open-API 设计.md')).toBeTruthy())
    fireEvent.click(screen.getByTestId('documents-open-API 设计.md'))
    await waitFor(() => expect(d.open).toHaveBeenCalledWith('API 设计.md'))
    fireEvent.click(screen.getByTestId('documents-reveal-API 设计.md'))
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith('API 设计.md'))
  })

  it('add 有 failed 时 inline 显示失败条目,不弹窗', async () => {
    const d = mockWraith({
      add: vi.fn(async () => ({ added: ['ok.md'], failed: [{ name: 'bad.md', reason: '无读取权限' }] })),
    })
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(d.list).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('documents-add'))
    await waitFor(() => expect(screen.getByTestId('documents-error')).toBeTruthy())
    expect(screen.getByTestId('documents-error').textContent).toContain('bad.md')
    expect(screen.getByTestId('documents-error').textContent).toContain('无读取权限')
  })

  it('list 抛错时 inline 显示错误', async () => {
    mockWraith({ list: vi.fn(async () => { throw new Error('磁盘不可读') }) })
    render(<DocumentsPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('documents-error').textContent).toContain('磁盘不可读'))
  })

  it('点返回调 onBack', async () => {
    mockWraith()
    const onBack = vi.fn()
    render(<DocumentsPanel onBack={onBack} />)
    await waitFor(() => expect(screen.getByTestId('documents-back')).toBeTruthy())
    fireEvent.click(screen.getByTestId('documents-back'))
    expect(onBack).toHaveBeenCalled()
  })
})
