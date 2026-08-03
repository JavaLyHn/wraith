// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ProvidersPanel from '../src/renderer/components/ProvidersPanel'
import { PROVIDER_CATALOG } from '../src/shared/providerCatalog'

afterEach(cleanup)

/**
 * 后端删掉 KNOWN_PROVIDERS 之后,model.list 的 providers 可能是空数组,
 * 且 default 可能指向一个不在 providers 里的 id(过渡期的 stale 值)。
 * 这两条是防御性回归锁:面板本来就按 hasKey 过滤,应当本来就扛得住 ——
 * 锁住它,是为了让「删 KNOWN_PROVIDERS 打断了桌面」这件事一旦发生就立刻可见。
 */
function stubModelList(result: unknown): void {
  ;(window as unknown as { wraith: unknown }).wraith = {
    modelList: vi.fn(async () => result),
    setProvider: vi.fn(async () => ({ ok: true })),
    removeProvider: vi.fn(async () => ({ ok: true })),
    setDefaultProvider: vi.fn(async () => ({ ok: true })),
    testProvider: vi.fn(async () => ({ ok: true })),
  }
}

describe('ProvidersPanel — provider 无关化后的载荷形态', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('providers 为空数组时不崩,「全部」组仍列出整份 catalog', async () => {
    stubModelList({ current: { provider: '', model: '' }, default: '', providers: [] })

    render(<ProvidersPanel onBack={vi.fn()} />)

    // catalog 是前端自带的,不受后端载荷影响。providers 为空 → doneRows 为空,
    // 于是 provider-config 按钮只来自 catalog 行。
    const rows = await screen.findAllByTestId('provider-config')
    expect(rows.length).toBe(PROVIDER_CATALOG.length)
  })

  it('default 指向 providers 里不存在的 id 时不崩(stale "glm" 的过渡期)', async () => {
    stubModelList({
      current: { provider: 'anthropic', model: 'claude-haiku-4-5' },
      default: 'glm',
      providers: [
        { name: 'anthropic', model: 'claude-haiku-4-5', hasKey: true, baseUrl: '', protocol: 'anthropic', label: '' },
      ],
    })

    render(<ProvidersPanel onBack={vi.fn()} />)

    expect(await screen.findByTestId('providers-panel')).toBeTruthy()
    // 必须限定 selector:'div'。「Anthropic」在 DOM 里出现两次 —— provider 行的显示名(div),
    // 以及 @lobehub/icons 的 AnthropicMono 为无障碍渲染的 <title>Anthropic</title>。
    // 不限定的 getByText 遇到多个匹配会直接抛,不是面板的 bug 也不是桩写错了。
    expect(screen.getByText('Anthropic', { selector: 'div' })).toBeTruthy()
  })
})
