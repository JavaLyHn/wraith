// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import StatusChip from '../src/renderer/components/StatusChip'
import { TooltipProvider } from '../src/renderer/components/ui/tooltip'
import type { StatusData } from '../src/shared/types'
import type { ReactElement } from 'react'

afterEach(cleanup)

const withProvider = (el: ReactElement) => render(<TooltipProvider>{el}</TooltipProvider>)

const status = (over: Partial<StatusData> = {}): StatusData => ({
  model: 'DeepSeek-V4-Flash', totalTokens: 30000, contextWindow: 100000,
  inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
  estimatedCost: null, elapsedMillis: 0, phase: 'idle', ...over,
} as StatusData)

describe('StatusChip 渲染守卫', () => {
  it('有 status:显示 chip', () => {
    withProvider(<StatusChip status={status()} watermark={null} />)
    expect(screen.getByTestId('status-chip').textContent).toContain('30%')
  })

  it('无 status 但有 watermark(Plan/Team):仍显示 chip', () => {
    withProvider(<StatusChip status={null} watermark={{ ratio: 0.09, tier: 0, estimated: false, usedTokens: 11800, window: 128000 }} />)
    const chip = screen.getByTestId('status-chip')
    expect(chip.textContent).toContain('9%')
    expect(chip.textContent).not.toContain('~')   // 真实峰值水位,无估算标
  })

  it('status 与 watermark 皆无:不渲染', () => {
    const { container } = withProvider(<StatusChip status={null} watermark={null} />)
    expect(container.querySelector('[data-testid="status-chip"]')).toBeNull()
  })

  it('contextWindow<=0 且无 watermark:不渲染', () => {
    const { container } = withProvider(<StatusChip status={status({ contextWindow: 0 })} watermark={null} />)
    expect(container.querySelector('[data-testid="status-chip"]')).toBeNull()
  })
})
