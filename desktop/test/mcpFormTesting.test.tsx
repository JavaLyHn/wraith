// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import McpServerForm from '../src/renderer/components/McpServerForm'

afterEach(cleanup)

/** mcpTest 的 promise 由测试掌控何时 resolve —— 这样才能断言「进行中」那一瞬间的界面。 */
function stubWraith(): { resolve: (r: unknown) => void; mcpTest: ReturnType<typeof vi.fn> } {
  let resolve!: (r: unknown) => void
  const pending = new Promise((r) => { resolve = r as (r: unknown) => void })
  const mcpTest = vi.fn().mockReturnValue(pending)
  ;(window as unknown as { wraith: unknown }).wraith = { mcpTest }
  return { resolve, mcpTest }
}

/** 必填 props 一处给全 —— McpServerFormProps 要求 initial 与 busy。 */
function renderForm(): ReturnType<typeof render> {
  return render(<McpServerForm mode="add" initial={null} busy={false} onSubmit={vi.fn()} onCancel={vi.fn()} />)
}

function fillAndTest(): void {
  fireEvent.change(screen.getByTestId('mcp-form-name'), { target: { value: 'filesystem' } })
  fireEvent.change(screen.getByTestId('mcp-form-command'), { target: { value: 'npx' } })
  fireEvent.click(screen.getByTestId('mcp-form-test'))
}

describe('McpServerForm 测试连接的进行中反馈', () => {
  it('测试进行中要有一条看得见的进行中行 —— 只靠按钮上几个字变化,用户感知不到', async () => {
    // MCP 的 initialize 可能一直等到超时(用户截图里就是 TimeoutException),
    // 这段时间里界面必须明确说「在连」,否则分不清是卡住了还是在跑。
    stubWraith()
    renderForm()

    fillAndTest()

    await waitFor(() => expect(screen.getByTestId('mcp-form-testing')).toBeTruthy())
    expect(screen.getByTestId('mcp-form-testing').textContent).toMatch(/连接|测试/)
  })

  it('进行中行里要有一个转动的图标（animate-spin），不是纯文字', async () => {
    stubWraith()
    const { container } = renderForm()

    fillAndTest()

    await waitFor(() => expect(screen.getByTestId('mcp-form-testing')).toBeTruthy())
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('测试按钮上也带 spinner，且禁用', async () => {
    stubWraith()
    renderForm()

    fillAndTest()

    await waitFor(() => {
      const btn = screen.getByTestId('mcp-form-test') as HTMLButtonElement
      expect(btn.disabled).toBe(true)
      expect(btn.querySelector('.animate-spin')).not.toBeNull()
    })
  })

  it('结果回来后进行中行消失，换成结果行', async () => {
    const { resolve } = stubWraith()
    renderForm()

    fillAndTest()
    await waitFor(() => expect(screen.getByTestId('mcp-form-testing')).toBeTruthy())

    resolve({ ok: true, toolCount: 3, latencyMs: 120 })

    await waitFor(() => expect(screen.getByTestId('mcp-form-test-result')).toBeTruthy())
    expect(screen.queryByTestId('mcp-form-testing')).toBeNull()
  })

  it('失败时进行中行同样消失 —— 不能两条并排让人猜哪条是真的', async () => {
    const { resolve } = stubWraith()
    renderForm()

    fillAndTest()
    await waitFor(() => expect(screen.getByTestId('mcp-form-testing')).toBeTruthy())

    resolve({ ok: false, error: 'JSON-RPC request timed out: initialize' })

    await waitFor(() => expect(screen.getByTestId('mcp-form-test-result').textContent)
      .toContain('timed out'))
    expect(screen.queryByTestId('mcp-form-testing')).toBeNull()
  })

  it('没在测时不该有进行中行', () => {
    stubWraith()
    renderForm()

    expect(screen.queryByTestId('mcp-form-testing')).toBeNull()
  })
})
