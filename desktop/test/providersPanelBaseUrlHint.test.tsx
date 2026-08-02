// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import ProvidersPanel from '../src/renderer/components/ProvidersPanel'

afterEach(cleanup)

const MODEL_LIST = {
  current: { provider: '', model: '' },
  default: '',
  providers: [{ name: 'freellmapi', model: '', hasKey: false, baseUrl: '', protocol: 'openai', label: '' }],
}

function stubWraith(testResult: { ok: boolean; error?: string; model?: string; latencyMs?: number }): void {
  ;(window as unknown as { wraith: unknown }).wraith = {
    modelList: vi.fn(async () => MODEL_LIST),
    setProvider: vi.fn(async () => ({ ok: true })),
    removeProvider: vi.fn(async () => ({ ok: true })),
    setDefaultProvider: vi.fn(async () => ({ ok: true })),
    testProvider: vi.fn(async () => testResult),
  }
}

/** 打开某个 provider 的编辑表单。 */
async function openEditor(): Promise<void> {
  render(<ProvidersPanel onBack={vi.fn()} />)
  const btn = await screen.findAllByTestId('provider-config')
  fireEvent.click(btn[0]!)
  await screen.findByTestId('provider-baseurl')
}

describe('Base URL 的 /v1 提示', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('输入框 placeholder 提前说清 /v1 属于 Base URL', async () => {
    stubWraith({ ok: true })
    await openEditor()
    expect(screen.getByTestId('provider-baseurl').getAttribute('placeholder')).toContain('/v1')
  })

  it('404 路径错 → 面板上真的渲染出可照抄的建议', async () => {
    stubWraith({
      ok: false,
      error: 'API请求失败: 404 - {"error":{"message":"Invalid URL (POST /chat/completions)"}}',
    })
    await openEditor()
    fireEvent.change(screen.getByTestId('provider-baseurl'), {
      target: { value: 'https://cdn.rkapi.com' },
    })
    fireEvent.click(screen.getByTestId('provider-test'))

    const hint = await screen.findByTestId('provider-baseurl-hint')
    expect(hint.textContent).toContain('https://cdn.rkapi.com/v1')
  })

  it('401 密钥错 → 不出提示(乱猜 /v1 会把人带偏)', async () => {
    stubWraith({ ok: false, error: 'API请求失败: 401 - Unauthorized' })
    await openEditor()
    fireEvent.change(screen.getByTestId('provider-baseurl'), {
      target: { value: 'https://cdn.rkapi.com' },
    })
    fireEvent.click(screen.getByTestId('provider-test'))

    await screen.findByTestId('provider-test-result')   // 确实测过了
    expect(screen.queryByTestId('provider-baseurl-hint')).toBeNull()
  })

  it('测试成功 → 不出提示', async () => {
    stubWraith({ ok: true, model: 'gpt-5.4', latencyMs: 120 })
    await openEditor()
    fireEvent.change(screen.getByTestId('provider-baseurl'), {
      target: { value: 'https://cdn.rkapi.com' },
    })
    fireEvent.click(screen.getByTestId('provider-test'))

    await waitFor(() =>
      expect(screen.getByTestId('provider-test-result').textContent).toContain('连接成功'))
    expect(screen.queryByTestId('provider-baseurl-hint')).toBeNull()
  })
})
