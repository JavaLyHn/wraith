// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import RagPanel from '../src/renderer/components/RagPanel'
import type { BackendEvent, RagIndexResult, RagStatus } from '../src/shared/types'

afterEach(cleanup)

/**
 * 建索引的进度可视化在面板上的行为。用户原话：「没有清晰的图表示出来」。
 *
 * 截图里还暴露了第二个问题（更要紧）：重建期间上面那行显示的是
 * `已索引 9718 块 · 55091 关系` —— 那是**上一份**索引的数字，摆在实时进度旁边
 * 会被读成「已经索引了 9718 块」。这是 snapshot-vs-live 的又一次。
 */
type Listener = (e: BackendEvent) => void

function mockWraith(indexResult: RagIndexResult, status: RagStatus) {
  let listener: Listener = () => {}
  let resolveIndex: (r: RagIndexResult) => void = () => {}
  const w = {
    configGetEmbedding: vi.fn(async () => ({
      provider: 'ollama', model: 'bge-m3:latest', baseUrl: 'http://localhost:11434', hasKey: false,
    })),
    configSetEmbedding: vi.fn(async () => ({ ok: true })),
    configTestEmbedding: vi.fn(async () => ({ ok: true, dim: 1024 })),
    configGetRagScope: vi.fn(async () => ({ excludeTests: false, excludeDocs: false })),
    configSetRagScope: vi.fn(async () => ({ ok: true })),
    ragStatus: vi.fn(async () => status),
    ragIndex: vi.fn(() => new Promise<RagIndexResult>((res) => { resolveIndex = res })),
    ragSearch: vi.fn(async () => ({ results: [] })),
    ragGraph: vi.fn(async () => ({ relations: [] })),
    onEvent: vi.fn((cb: Listener) => { listener = cb; return () => {} }),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return {
    w,
    emit: (message: string) => act(() => {
      listener({ kind: 'notification', method: 'rag.index.progress', params: { message } })
    }),
    finish: (r: RagIndexResult) => act(() => { resolveIndex(r) }),
  }
}

const status: RagStatus = { indexed: true, chunkCount: 9718, relationCount: 55091 }
const done: RagIndexResult = {
  chunkCount: 6283, relationCount: 26415, fileCount: 871, javaFileCount: 344,
  excludedTests: 482, excludedDocs: 0, elapsedMs: 868_930, embeddingModel: 'bge-m3:latest',
  message: '索引完成：6283 个代码块，26415 条关系',
}

describe('RagPanel 索引进度', () => {
  it('点建立索引后出现进度条,并显示阶段名', async () => {
    const h = mockWraith(done, status)
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('重建索引'))

    const box = await screen.findByTestId('rag-index-progress')
    expect(screen.getByTestId('rag-index-bar')).toBeTruthy()
    // 起始阶段是扫描,还没有百分比 → 不确定态
    expect(box.textContent ?? '').toMatch(/扫描/)
  })

  it('收到向量化进度后条宽跟着走,并显示 n/m 与当前文件', async () => {
    const h = mockWraith(done, status)
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('重建索引'))
    h.emit('   进度 37%  2325/6283 块 · 刚完成 paths.ts')

    const bar = await screen.findByTestId('rag-index-bar') as HTMLElement
    await waitFor(() => expect(bar.style.width).toBe('37%'))
    const box = screen.getByTestId('rag-index-progress')
    expect(box.textContent ?? '').toContain('2325 / 6283')
    expect(box.textContent ?? '').toContain('paths.ts')
    expect(box.textContent ?? '').toMatch(/向量化/)
  })

  it('**重建期间不把上一份索引的统计当成当前进度** —— 要显式标出「上一份」', async () => {
    mockWraith(done, status)
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('重建索引'))

    await waitFor(() => expect(screen.getByTestId('rag-index-progress')).toBeTruthy())
    const text = document.body.textContent ?? ''
    // 9718 仍可以出现,但必须带「上一份 / 正在重建」这样的限定语
    if (text.includes('9718')) {
      expect(text).toMatch(/上一份|正在重建/)
    }
    // 绝不能出现无限定的「已索引 9718 块」
    expect(text).not.toMatch(/^已索引 9718 块/m)
  })

  it('一直显示已用时长 —— ETA 不可用时它是唯一诚实的信息', async () => {
    const h = mockWraith(done, status)
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('重建索引'))
    h.emit('   进度 1%  5/6283 块 · 刚完成 a.ts')

    const box = await screen.findByTestId('rag-index-progress')
    expect(box.textContent ?? '').toMatch(/已用/)
    // 样本太少(5 块) → 不许给剩余时间
    expect(box.textContent ?? '').not.toMatch(/剩余/)
  })

  it('建完后进度块消失,出现构成条(把范围开关的效果画出来)', async () => {
    const h = mockWraith(done, status)
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('重建索引'))
    h.emit('   进度 99%  6200/6283 块 · 刚完成 z.ts')
    h.finish(done)

    await waitFor(() => expect(screen.queryByTestId('rag-index-progress')).toBeNull())
    const comp = await screen.findByTestId('rag-index-composition')
    expect(comp.textContent ?? '').toContain('871')
    expect(comp.textContent ?? '').toContain('482')
  })

  it('没有排除任何东西时不画构成条 —— 一条单色满格条没有信息量', async () => {
    const h = mockWraith({ ...done, excludedTests: 0, excludedDocs: 0 }, status)
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('重建索引'))
    h.finish({ ...done, excludedTests: 0, excludedDocs: 0 })

    await waitFor(() => expect(screen.getByTestId('rag-index-summary')).toBeTruthy())
    expect(screen.queryByTestId('rag-index-composition')).toBeNull()
  })
})
