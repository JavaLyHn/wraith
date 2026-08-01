// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import ModelSwitcher from '../src/renderer/components/ModelSwitcher'
import type { ModelListResult } from '../src/shared/types'

afterEach(() => cleanup())

// 真实形态:Sophnet 为当前默认(余额已耗尽),会话临时切到 newapi。
const LIST: ModelListResult = {
  current: { provider: 'freellmapi-2', model: 'deepseek-v4-pro' },
  default: 'freellmapi',
  providers: [
    { name: 'freellmapi', model: 'DeepSeek-V4-Flash', hasKey: true, label: 'Sophnet' },
    { name: 'freellmapi-2', model: 'deepseek-v4-pro', hasKey: true, label: 'newapi' },
    { name: 'siliconflow', model: 'Qwen/Qwen3-8B', hasKey: true, label: '' },
    // 无 key:既不该出现在列表里,也就更不该有「设为默认」
    { name: 'openai', model: 'gpt-4o', hasKey: false, label: '' },
  ] as ModelListResult['providers'],
}

const setDefaultProvider = vi.fn(() => Promise.resolve({ ok: true }))

beforeEach(() => {
  setDefaultProvider.mockClear()
  ;(window as unknown as { wraith: unknown }).wraith = {
    modelList: vi.fn(() => Promise.resolve(LIST)),
    setModel: vi.fn(() => Promise.resolve({ model: 'deepseek-v4-pro' })),
    setDefaultProvider,
  }
})

/** 打开下拉并等 model.list 落地。 */
async function openMenu(): Promise<void> {
  render(<ModelSwitcher initialModel="deepseek-v4-pro" running={false} />)
  await act(async () => { fireEvent.click(screen.getByTestId('model-chip')) })
  await act(async () => { await Promise.resolve() })
}

describe('ModelSwitcher 设为默认', () => {
  it('非默认且已配置的 provider 都常驻一个「设为默认」按钮', async () => {
    await openMenu()
    const btns = screen.getAllByTestId('model-set-default')
    // freellmapi 是当前默认 → 无按钮;openai 无 key → 不入列。剩 freellmapi-2 与 siliconflow。
    expect(btns).toHaveLength(2)
    for (const b of btns) expect(b.textContent).toBe('设为默认')
  })

  it('按钮不再靠悬停才出现(className 不含 hidden / group-hover)', async () => {
    await openMenu()
    for (const b of screen.getAllByTestId('model-set-default')) {
      expect(b.className).not.toContain('hidden')
      expect(b.className).not.toContain('group-hover')
    }
  })

  it('当前默认项不给「设为默认」,只保留「默认」徽章', async () => {
    await openMenu()
    const rows = screen.getAllByTestId('model-option')
    const defaultRow = rows.find(r => r.textContent?.includes('DeepSeek-V4-Flash'))
    expect(defaultRow?.textContent).toContain('默认')
    // 该行所在容器内不应有设为默认按钮
    expect(defaultRow?.parentElement?.querySelector('[data-testid="model-set-default"]')).toBeNull()
  })

  it('点「设为默认」发 config.setDefaultProvider 且不触发会话切换', async () => {
    await openMenu()
    const siliconRow = screen.getAllByTestId('model-option')
      .find(r => r.textContent?.includes('Qwen/Qwen3-8B'))!
    const btn = siliconRow.parentElement!.querySelector('[data-testid="model-set-default"]') as HTMLElement
    await act(async () => { fireEvent.click(btn) })
    expect(setDefaultProvider).toHaveBeenCalledWith('siliconflow')
    // stopPropagation 生效:不应连带调用 session.setModel
    expect((window as unknown as { wraith: { setModel: ReturnType<typeof vi.fn> } }).wraith.setModel)
      .not.toHaveBeenCalled()
  })

  it('设默认成功后徽章迁移到新行,旧默认行长出「设为默认」', async () => {
    await openMenu()
    const siliconRow = screen.getAllByTestId('model-option')
      .find(r => r.textContent?.includes('Qwen/Qwen3-8B'))!
    await act(async () => {
      fireEvent.click(siliconRow.parentElement!.querySelector('[data-testid="model-set-default"]') as HTMLElement)
    })
    await act(async () => { await Promise.resolve() })

    const rows = screen.getAllByTestId('model-option')
    const silicon = rows.find(r => r.textContent?.includes('Qwen/Qwen3-8B'))!
    const oldDefault = rows.find(r => r.textContent?.includes('DeepSeek-V4-Flash'))!
    expect(silicon.textContent).toContain('默认')
    expect(silicon.parentElement?.querySelector('[data-testid="model-set-default"]')).toBeNull()
    expect(oldDefault.parentElement?.querySelector('[data-testid="model-set-default"]')).not.toBeNull()
  })
})
