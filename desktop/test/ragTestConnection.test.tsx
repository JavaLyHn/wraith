// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import RagPanel from '../src/renderer/components/RagPanel'
import type { EmbeddingTestResult } from '../src/shared/types'

afterEach(cleanup)

/**
 * 「测试连接」按钮在面板上的行为。
 *
 * <p>此前验证 embedding 后端唯一的办法是点「建立索引」—— 上千个代码块的整库扫描。
 * 配错一个字符就得等它跑完，或者盯着一句 OkHttp 原文猜。
 *
 * <p>这里钉三件容易做错的事：
 * ① 测的是**表单里的草稿值**，不是已保存的配置 —— 否则「改完先测一下」根本测不到改动；
 * ② 探测期间按钮要显示在跑（ollama 冷加载模型能到几十秒，静默就是「以为死机」）；
 * ③ 结果是结果、保存是保存 —— 点测试不该顺手把配置写进 config.json。
 */
type Draft = { provider: string; model: string; baseUrl: string; apiKey: string }

function mockWraith(test: EmbeddingTestResult | (() => Promise<EmbeddingTestResult>)) {
  const call = typeof test === 'function' ? test : async (): Promise<EmbeddingTestResult> => test
  const w = {
    configGetEmbedding: vi.fn(async () => ({
      provider: 'ollama', model: 'nomic-embed-text:latest',
      baseUrl: 'http://localhost:11434', hasKey: false,
    })),
    configSetEmbedding: vi.fn(async () => ({ ok: true })),
    // 显式声明参数:测试要断言「传下去的是表单草稿」,无参 mock 的 calls 类型是空元组
    configTestEmbedding: vi.fn(async (_cfg: Draft) => call()),
    ragStatus: vi.fn(async () => ({ indexed: false, chunkCount: 0, relationCount: 0 })),
    ragIndex: vi.fn(async () => ({ chunkCount: 0, relationCount: 0 })),
    ragSearch: vi.fn(async () => ({ results: [] })),
    ragGraph: vi.fn(async () => ({ relations: [] })),
    onEvent: vi.fn(() => () => {}),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

describe('RagPanel 测试连接', () => {
  it('用表单里的草稿值探测,而不是已保存的配置', async () => {
    const w = mockWraith({ ok: true, dim: 1024, latencyMs: 1762 })
    render(<RagPanel onBack={() => {}} />)
    // 等表单从后端回填完再改,否则 loadCfg 的 setDraft 会盖掉我们的输入
    await waitFor(() => expect(w.configGetEmbedding).toHaveBeenCalled())
    await waitFor(() =>
      expect((screen.getByDisplayValue('nomic-embed-text:latest') as HTMLInputElement).value)
        .toBe('nomic-embed-text:latest'))

    fireEvent.change(screen.getByDisplayValue('nomic-embed-text:latest'), {
      target: { value: 'bge-m3:latest' },
    })
    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => expect(w.configTestEmbedding).toHaveBeenCalled())
    expect(w.configTestEmbedding.mock.calls[0][0]).toMatchObject({ model: 'bge-m3:latest' })
    // 测试不写盘:点了测试却把一份没验过的配置存进去,是另一回事
    expect(w.configSetEmbedding).not.toHaveBeenCalled()
  })

  it('探测期间显示在跑 —— 冷加载模型能到几十秒,静默就是「以为死机」', async () => {
    let release: (r: EmbeddingTestResult) => void = () => {}
    const w = mockWraith(() => new Promise<EmbeddingTestResult>((r) => { release = r }))
    render(<RagPanel onBack={() => {}} />)
    await waitFor(() => expect(w.configGetEmbedding).toHaveBeenCalled())

    fireEvent.click(screen.getByText('测试连接'))
    await waitFor(() => expect(screen.getByText(/测试中/)).toBeTruthy())
    // 按钮同时要禁用,否则连点会打出一串并发探测
    expect((screen.getByTestId('rag-test-embedding') as HTMLButtonElement).disabled).toBe(true)

    release({ ok: true, dim: 768, latencyMs: 60 })
    await waitFor(() => expect(screen.queryByText(/测试中/)).toBeNull())
  })

  it('成功:摊出维度与耗时', async () => {
    mockWraith({ ok: true, dim: 768, latencyMs: 585, provider: 'ollama',
      model: 'nomic-embed-text:latest', baseUrl: 'http://localhost:11434' })
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('测试连接'))

    const box = await screen.findByTestId('rag-embedding-test-result')
    await waitFor(() => expect(box.textContent ?? '').toContain('768'))
    expect(box.textContent ?? '').toContain('nomic-embed-text:latest')
  })

  it('失败:诊断与 OkHttp 原文都在 —— 只给友好话会把人引到错的地方去查', async () => {
    mockWraith({
      ok: false,
      error: 'Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434',
      hint: '连不上本机的 embedding 服务（localhost:11434）。最常见的原因是 **ollama 没在运行**',
    })
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('测试连接'))

    const box = await screen.findByTestId('rag-embedding-test-result')
    await waitFor(() => expect(box.textContent ?? '').toContain('没在运行'))
    expect(box.textContent ?? '').toContain('Failed to connect to')
  })

  it('通了但与现有索引不兼容:不能只显示成功 —— 那条警告正是最容易被忽略的东西', async () => {
    mockWraith({
      ok: true, dim: 1024, latencyMs: 1762,
      warning: '当前索引是用 nomic-embed-text:latest（768 维）建的，这个后端给出 1024 维 ——'
        + ' 两者不兼容，直接检索会报错。请点「重建索引」。',
    })
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('测试连接'))

    const box = await screen.findByTestId('rag-embedding-test-result')
    await waitFor(() => expect(box.textContent ?? '').toContain('不兼容'))
    expect(box.textContent ?? '').toContain('1024')
    expect(box.textContent ?? '').toContain('768')
  })

  it('RPC 本身抛错(旧 jar 没有 config.testEmbedding)也要落到界面上,不能静默', async () => {
    const w = mockWraith(async () => { throw new Error('embeddingTest not implemented') })
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByText('测试连接'))

    await waitFor(() => expect(w.configTestEmbedding).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/not implemented/)).toBeTruthy())
  })
})
