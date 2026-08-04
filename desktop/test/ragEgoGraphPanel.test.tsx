// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import RagPanel from '../src/renderer/components/RagPanel'
import type { RagRelation, RagStatus } from '../src/shared/types'

afterEach(cleanup)

/**
 * 「点一个类 → 看它的邻居」在面板上的行为。
 *
 * 用户原话：「没有效果展示啊，用户都不知道有哪些索引，能不能用节点和边的形式表示出来」。
 * 做成 1 跳辐射图（复用已有的 `rag.graph`），而**不是全图** —— 55091 条边画出来是毛线团，
 * 而按度数取 Top-K 也不行（实测榜首是 `file 2692 / assertEquals 2440 / get 1753`，
 * 全是 JDK 方法名与断言）。
 */
const rel = (from: string, to: string, type: string, toFile = ''): RagRelation => ({
  fromName: from, toName: to, relationType: type, fromFile: '/x/From.java', toFile,
})

function mockWraith(byName: Record<string, RagRelation[]>) {
  const w = {
    configGetEmbedding: vi.fn(async () => ({
      provider: 'ollama', model: 'bge-m3:latest', baseUrl: 'http://localhost:11434', hasKey: false,
    })),
    configSetEmbedding: vi.fn(async () => ({ ok: true })),
    configTestEmbedding: vi.fn(async () => ({ ok: true, dim: 1024 })),
    configGetRagScope: vi.fn(async () => ({ excludeTests: false, excludeDocs: false })),
    configSetRagScope: vi.fn(async () => ({ ok: true })),
    ragStatus: vi.fn(async () => ({ indexed: true, chunkCount: 49, relationCount: 268 } as RagStatus)),
    ragIndex: vi.fn(async () => ({ chunkCount: 0, relationCount: 0 })),
    ragSearch: vi.fn(async () => ({ results: [] })),
    ragGraph: vi.fn(async (name: string) => ({ relations: byName[name] ?? [] })),
    onEvent: vi.fn(() => () => {}),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

async function query(name: string) {
  const input = await screen.findByPlaceholderText(/类名 \/ 方法名/)
  fireEvent.change(input, { target: { value: name } })
  fireEvent.click(screen.getByText('查询'))
}

describe('RagPanel 一跳邻域图', () => {
  it('查到关系后画出 SVG,中心是查询的符号', async () => {
    mockWraith({ GLMClient: [rel('GLMClient', 'LlmClient', 'implements'), rel('GLMClient', 'GLMClient.chat', 'contains', '/x/GLMClient.java')] })
    render(<RagPanel onBack={() => {}} />)
    await query('GLMClient')

    const g = await screen.findByTestId('rag-ego-graph')
    expect(g.querySelectorAll('circle').length).toBeGreaterThanOrEqual(3)   // 2 邻居 + 中心
    expect(g.querySelectorAll('line').length).toBe(2)
    expect(g.textContent ?? '').toContain('LlmClient')
  })

  it('**点节点跳到它的邻居** —— 用那个名字重查,并回填输入框', async () => {
    const w = mockWraith({
      GLMClient: [rel('GLMClient', 'LlmClient', 'implements')],
      LlmClient: [rel('DeepSeekClient', 'LlmClient', 'implements')],
    })
    render(<RagPanel onBack={() => {}} />)
    await query('GLMClient')
    await screen.findByTestId('rag-ego-graph')

    // 点 LlmClient 那个节点(SVG <g> 上挂的 click)
    const label = [...document.querySelectorAll('text')].find((t) => t.textContent === 'LlmClient')!
    fireEvent.click(label.parentElement!)

    await waitFor(() => expect(w.ragGraph).toHaveBeenCalledWith('LlmClient'))
    await waitFor(() => expect((screen.getByPlaceholderText(/类名 \/ 方法名/) as HTMLInputElement).value).toBe('LlmClient'))
    // 新中心是 LlmClient,邻居变成 DeepSeekClient
    await waitFor(() => expect(screen.getByTestId('rag-ego-graph').textContent ?? '').toContain('DeepSeekClient'))
  })

  it('**裸方法名目标默认折叠,并把数目摆出来** —— 不假装我们有调用图', async () => {
    mockWraith({
      'A.run': [
        rel('A.run', 'B.go', 'calls'),
        rel('A.run', 'println', 'calls'),
        rel('A.run', 'get', 'calls'),
      ],
    })
    render(<RagPanel onBack={() => {}} />)
    await query('A.run')

    const note = await screen.findByTestId('rag-ego-note')
    expect(note.textContent ?? '').toContain('2')
    expect(note.textContent ?? '').toMatch(/裸方法名|未做符号解析/)
    // 图里只有那一个解析得出来的
    expect(screen.getByTestId('rag-ego-graph').textContent ?? '').toContain('B.go')
    expect(screen.getByTestId('rag-ego-graph').textContent ?? '').not.toContain('println')
  })

  it('点「展开」后未解析的也画出来', async () => {
    mockWraith({ 'A.run': [rel('A.run', 'println', 'calls'), rel('A.run', 'get', 'calls')] })
    render(<RagPanel onBack={() => {}} />)
    await query('A.run')

    fireEvent.click(await screen.findByText(/已折叠 · 展开/))
    await waitFor(() => expect(screen.getByTestId('rag-ego-graph').textContent ?? '').toContain('println'))
  })

  it('**邻居超上限时必须报出截断量** —— 静默截断会被读成「就这么多」', async () => {
    mockWraith({
      Big: Array.from({ length: 30 }, (_, i) => rel('Big', `N${i}.m`, 'contains', '/f')),
    })
    render(<RagPanel onBack={() => {}} />)
    await query('Big')

    const note = await screen.findByTestId('rag-ego-note')
    expect(note.textContent ?? '').toMatch(/16 个邻居未画/)
  })

  it('没有关系时不画空图,给一句人话', async () => {
    mockWraith({ Nope: [] })
    render(<RagPanel onBack={() => {}} />)
    await query('Nope')

    await waitFor(() => expect(screen.getByText(/无关系/)).toBeTruthy())
    expect(screen.queryByTestId('rag-ego-graph')).toBeNull()
  })

  it('文字列表仍然保留 —— 图看趋势,列表看准确的每一条', async () => {
    mockWraith({ GLMClient: [rel('GLMClient', 'LlmClient', 'implements')] })
    render(<RagPanel onBack={() => {}} />)
    await query('GLMClient')

    await screen.findByTestId('rag-ego-graph')
    expect(document.body.textContent ?? '').toContain('─[implements]→')
  })
})
