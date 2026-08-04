// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import RagPanel from '../src/renderer/components/RagPanel'
import type { RagScopeView, RagStatus } from '../src/shared/types'

afterEach(cleanup)

/**
 * 「索引范围」表单的三件事：
 * ① 勾选即写盘，但**不重建索引**（重建是一次整库扫描，实测 bge-m3 18 分钟，不该由一次勾选触发）；
 * ② 勾完立刻重拉 `rag.status`，让「范围不符」提示当场出现，而不是等下次进面板；
 * ③ **旧 jar 没有这两条 RPC 时不能把面板整块打挂** —— 拿不到就保持默认关。
 */
function mockWraith(scope: RagScopeView, status: RagStatus) {
  const w = {
    configGetEmbedding: vi.fn(async () => ({
      provider: 'ollama', model: 'bge-m3:latest', baseUrl: 'http://localhost:11434', hasKey: false,
    })),
    configSetEmbedding: vi.fn(async () => ({ ok: true })),
    configTestEmbedding: vi.fn(async () => ({ ok: true, dim: 1024 })),
    configGetRagScope: vi.fn(async () => scope),
    configSetRagScope: vi.fn(async (_s: RagScopeView) => ({ ok: true })),
    ragStatus: vi.fn(async () => status),
    ragIndex: vi.fn(async () => ({ chunkCount: 0, relationCount: 0 })),
    ragSearch: vi.fn(async () => ({ results: [] })),
    ragGraph: vi.fn(async () => ({ relations: [] })),
    onEvent: vi.fn(() => () => {}),
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

const baseStatus: RagStatus = { indexed: true, chunkCount: 9718, relationCount: 55091 }

describe('RagPanel 索引范围', () => {
  it('回填后端的当前设置', async () => {
    mockWraith({ excludeTests: true, excludeDocs: false }, baseStatus)
    render(<RagPanel onBack={() => {}} />)
    const t = await screen.findByTestId('rag-scope-tests') as HTMLInputElement
    const d = screen.getByTestId('rag-scope-docs') as HTMLInputElement
    await waitFor(() => expect(t.checked).toBe(true))
    expect(d.checked).toBe(false)
  })

  it('勾选即写盘,并且**不触发重建索引**', async () => {
    const w = mockWraith({ excludeTests: false, excludeDocs: false }, baseStatus)
    render(<RagPanel onBack={() => {}} />)
    fireEvent.click(await screen.findByTestId('rag-scope-tests'))

    await waitFor(() => expect(w.configSetRagScope).toHaveBeenCalled())
    expect(w.configSetRagScope.mock.calls[0][0]).toEqual({ excludeTests: true, excludeDocs: false })
    expect(w.ragIndex).not.toHaveBeenCalled()
  })

  it('勾完立刻重拉 status —— 范围不符提示要当场出现', async () => {
    const w = mockWraith({ excludeTests: false, excludeDocs: false }, baseStatus)
    render(<RagPanel onBack={() => {}} />)
    await waitFor(() => expect(w.ragStatus).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('rag-scope-tests'))
    await waitFor(() => expect(w.ragStatus).toHaveBeenCalledTimes(2))
  })

  it('范围不符时显示提示,并给出「重建索引」这个动作', async () => {
    mockWraith({ excludeTests: true, excludeDocs: false },
      { ...baseStatus, indexExcludeTests: false, indexExcludeDocs: false,
        excludeTests: true, excludeDocs: false })
    render(<RagPanel onBack={() => {}} />)
    const box = await screen.findByTestId('rag-scope-stale')
    expect(box.textContent ?? '').toMatch(/测试/)
    expect(box.textContent ?? '').toContain('重建')
  })

  it('索引没记过范围(老索引)时不显示提示 —— 宁可漏报', async () => {
    mockWraith({ excludeTests: true, excludeDocs: false },
      { ...baseStatus, excludeTests: true })   // 刻意不给 indexExclude*
    render(<RagPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('rag-scope-tests')).toBeTruthy())
    expect(screen.queryByTestId('rag-scope-stale')).toBeNull()
  })

  it('效果说明必须带实测数字,并说明要重建 —— 否则用户以为「都勾上更干净」', async () => {
    mockWraith({ excludeTests: false, excludeDocs: false }, baseStatus)
    render(<RagPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('rag-scope-tests')).toBeTruthy())
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/24%/)
    expect(text).toMatch(/重建/)
  })

  it('旧 jar 没有 config.getRagScope 时面板照常渲染,开关保持默认关', async () => {
    const w = mockWraith({ excludeTests: true, excludeDocs: true }, baseStatus)
    w.configGetRagScope = vi.fn(async () => { throw new Error('ragScopeGet not implemented') })
    render(<RagPanel onBack={() => {}} />)
    const t = await screen.findByTestId('rag-scope-tests') as HTMLInputElement
    expect(t.checked).toBe(false)
    // 也不该把这个当成面板级错误弹出来 —— 老后端不支持不是用户的问题
    expect(screen.queryByText(/not implemented/)).toBeNull()
  })

  /**
   * 用户实测踩到的:后端是旧 jar 时,`configGetRagScope` 静默失败(设计如此,为兼容),
   * 但 checkbox 仍然可点 —— 于是点下去吃到一句生的
   * `Error invoking remote method 'wraith:configSetRagScope': method not found: config.setRagScope`。
   *
   * **get 已经失败就已经知道后端不支持**,那时候就该把开关禁掉并说清怎么修,
   * 而不是让用户点一下再看一句它读不懂的话。
   */
  it('后端不支持时:开关**禁用** + 给出可行动提示,点了也不发 RPC', async () => {
    const w = mockWraith({ excludeTests: false, excludeDocs: false }, baseStatus)
    w.configGetRagScope = vi.fn(async () => { throw new Error('method not found: config.getRagScope') })
    render(<RagPanel onBack={() => {}} />)

    const t = await screen.findByTestId('rag-scope-tests') as HTMLInputElement
    await waitFor(() => expect(t.disabled).toBe(true))
    expect((screen.getByTestId('rag-scope-docs') as HTMLInputElement).disabled).toBe(true)

    // 提示必须可行动:说清是后端旧了,以及怎么修
    const hint = screen.getByTestId('rag-scope-unsupported').textContent ?? ''
    expect(hint).toMatch(/后端|jar/)
    expect(hint).toMatch(/重启|重新打包|更新/)

    // 禁用了还点(直接派发 change),也不该发出写请求
    fireEvent.click(t)
    expect(w.configSetRagScope).not.toHaveBeenCalled()
  })

  it('后端支持时不显示那条提示,开关可用', async () => {
    mockWraith({ excludeTests: false, excludeDocs: false }, baseStatus)
    render(<RagPanel onBack={() => {}} />)
    const t = await screen.findByTestId('rag-scope-tests') as HTMLInputElement
    await waitFor(() => expect(t.disabled).toBe(false))
    expect(screen.queryByTestId('rag-scope-unsupported')).toBeNull()
  })
})
