// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import SettingsPricing from '../src/renderer/components/SettingsPricing'

afterEach(cleanup)

const MODEL_LIST = {
  current: { provider: 'freellmapi-4', model: 'glm-4.7' },
  default: 'freellmapi-4',
  providers: [
    { name: 'freellmapi-4', model: 'glm-4.7', hasKey: true, baseUrl: '', protocol: 'openai', label: '' },
    { name: 'siliconflow', model: 'Qwen/Qwen3-8B', hasKey: true, baseUrl: '', protocol: 'openai', label: '' },
  ],
}

function stubWraith(entries: unknown[], setResult: { ok: boolean; error?: string } = { ok: true }): {
  configSetPricing: ReturnType<typeof vi.fn>
} {
  const configSetPricing = vi.fn().mockResolvedValue(setResult)
  ;(window as unknown as { wraith: unknown }).wraith = {
    configGetPricing: vi.fn().mockResolvedValue({ entries }),
    configSetPricing,
    modelList: vi.fn().mockResolvedValue(MODEL_LIST),
  }
  return { configSetPricing }
}

const USER_ROW = {
  modelPrefix: 'glm-4.7', cacheHitPerM: 20, cacheMissPerM: 20, outputPerM: 60,
  currency: 'CNY', seeded: false,
}
const SEED_ROW = {
  modelPrefix: 'glm-5', cacheHitPerM: 20, cacheMissPerM: 20, outputPerM: 60,
  currency: 'CNY', seeded: true,
}

describe('SettingsPricing', () => {
  it('渲染已有的用户条目与内置种子', async () => {
    stubWraith([USER_ROW, SEED_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    expect(screen.getByText(/glm-5/)).toBeTruthy()
  })

  it('种子行不可编辑 —— 门槛是「两个独立可信来源对得上」', async () => {
    stubWraith([SEED_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByText(/glm-5/)).toBeTruthy())
    // 种子渲染成静态文本,不是 input:找不到以它为值的输入框
    expect(screen.queryByDisplayValue('glm-5')).toBeNull()
  })

  it('保存只上传用户条目，种子不回传', async () => {
    const { configSetPricing } = stubWraith([USER_ROW, SEED_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
    const sent = configSetPricing.mock.calls[0][0] as { modelPrefix: string }[]
    expect(sent).toHaveLength(1)
    expect(sent[0].modelPrefix).toBe('glm-4.7')
  })

  it('加一行后保存传的是整表', async () => {
    const { configSetPricing } = stubWraith([USER_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-add'))
    fireEvent.change(screen.getByTestId('pricing-prefix-1'), { target: { value: 'Qwen/Qwen3-8B' } })
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
    const sent = configSetPricing.mock.calls[0][0] as { modelPrefix: string }[]
    expect(sent.map((e) => e.modelPrefix)).toEqual(['glm-4.7', 'Qwen/Qwen3-8B'])
  })

  it('删一行后保存传的是剩下的', async () => {
    const { configSetPricing } = stubWraith([USER_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-remove-0'))
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
    expect(configSetPricing.mock.calls[0][0]).toEqual([])
  })

  it('显示这条会命中哪几个模型 —— 前缀语义不再静默', async () => {
    stubWraith([{ ...USER_ROW, modelPrefix: 'glm' }])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm')).toBeTruthy())
    expect(screen.getByTestId('pricing-hits-0').textContent).toContain('glm-4.7')
  })

  it('命中 0 个时警示，但不阻止保存（可能在为还没配的模型预填价）', async () => {
    const { configSetPricing } = stubWraith([{ ...USER_ROW, modelPrefix: 'gpt-5' }])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('gpt-5')).toBeTruthy())
    expect(screen.getByTestId('pricing-hits-0').textContent).toMatch(/不命中|⚠/)

    fireEvent.click(screen.getByTestId('pricing-save'))
    await waitFor(() => expect(configSetPricing).toHaveBeenCalled())
  })

  it('前缀框挂 datalist，候选是已配置的模型名 —— 补掉「手敲敲错」这个代价', async () => {
    stubWraith([USER_ROW])
    const { container } = render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    const options = [...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))
    expect(options).toContain('glm-4.7')
    expect(options).toContain('Qwen/Qwen3-8B')
  })

  it('本地校验不过时不发 RPC，把错误显示出来', async () => {
    const { configSetPricing } = stubWraith([USER_ROW])
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.change(screen.getByTestId('pricing-output-0'), { target: { value: '-5' } })
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(screen.getByTestId('pricing-error').textContent).toMatch(/glm-4\.7/))
    expect(configSetPricing).not.toHaveBeenCalled()
  })

  it('后端回 ok:false 时把它的话显示出来，不吞掉', async () => {
    stubWraith([USER_ROW], { ok: false, error: '重复的模型前缀 glm-4.7' })
    render(<SettingsPricing />)

    await waitFor(() => expect(screen.getByDisplayValue('glm-4.7')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pricing-save'))

    await waitFor(() => expect(screen.getByTestId('pricing-error').textContent).toContain('重复的模型前缀'))
  })
})
