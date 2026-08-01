// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import RagPanel from '../src/renderer/components/RagPanel'
import type { RagIndexResult } from '../src/shared/types'

afterEach(cleanup)

/**
 * 残缺索引最坏的形态是**静默**:整库索引有上千次 embedding 调用,免费额度撞上 429 时
 * CodeIndex 会跳过那些块继续跑完。面板只报「✅ 已索引 N 块」的话,用户以为搜得全,
 * 实际有一批代码永远搜不到 —— 而这种缺失不会以任何方式表现出来,只会让检索结果莫名其妙地少。
 */
function mockWraith(indexResult: RagIndexResult) {
  const w = {
    configGetEmbedding: vi.fn(async () => ({ provider: 'openai', model: 'BAAI/bge-m3', baseUrl: 'https://api.siliconflow.cn/v1', hasKey: true })),
    configSetEmbedding: vi.fn(async () => ({ ok: true })),
    ragStatus: vi.fn(async () => ({ indexed: false, chunkCount: 0, relationCount: 0 })),
    ragIndex: vi.fn(async () => indexResult),
    ragSearch: vi.fn(async () => ({ results: [] })),
    ragGraph: vi.fn(async () => ({ relations: [] })),
    onEvent: vi.fn(() => () => {}),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

describe('RagPanel 索引结果', () => {
  it('有块向量化失败 → 明确说「不完整」并给出失败块数/文件数,不能只报成功数', async () => {
    mockWraith({
      chunkCount: 6800,
      relationCount: 2100,
      failedChunks: 373,
      failedFiles: 41,
      message: '索引完成但不完整：6800 个代码块……；首个失败原因：Embedding API 请求失败 [429]: rate limited',
    })
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('建立索引'))

    await waitFor(() => expect(screen.getByText(/不完整/)).toBeTruthy())
    const text = screen.getByText(/不完整/).textContent ?? ''
    expect(text).toContain('373')          // 失败块数
    expect(text).toContain('41')           // 涉及文件数
    expect(text).toContain('429')          // 首个原因,用户才知道是限流而非 key 错
    // 不能同时给出一条「✅ 已索引」的成功提示 —— 那会把不完整读成完成
    expect(screen.queryByText(/✅ 已索引/)).toBeNull()
  })

  it('全部成功 → 走原来的成功提示,不出现「不完整」字样', async () => {
    mockWraith({ chunkCount: 7173, relationCount: 2200, failedChunks: 0, failedFiles: 0, message: '索引完成：7173 个代码块，2200 条关系' })
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('建立索引'))

    await waitFor(() => expect(screen.getByText(/✅ 已索引 7173 块/)).toBeTruthy())
    expect(screen.queryByText(/不完整/)).toBeNull()
  })

  it('后端缺 failedChunks 字段(旧 jar)时不误报不完整', async () => {
    // 桌面可能跑在旧 jar 上:字段缺失 ≠ 失败
    mockWraith({ chunkCount: 100, relationCount: 10, message: '索引完成：100 个代码块，10 条关系' })
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('建立索引'))

    await waitFor(() => expect(screen.getByText(/✅ 已索引 100 块/)).toBeTruthy())
    expect(screen.queryByText(/不完整/)).toBeNull()
  })
})
