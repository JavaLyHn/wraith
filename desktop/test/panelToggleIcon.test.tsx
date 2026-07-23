// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PanelToggleIcon from '../src/renderer/components/PanelToggleIcon'

afterEach(() => cleanup())

describe('PanelToggleIcon', () => {
  it('open=true → fill/divider 的 data-open=true', () => {
    render(<PanelToggleIcon side="left" open={true} />)
    expect(screen.getByTestId('panel-fill').getAttribute('data-open')).toBe('true')
    expect(screen.getByTestId('panel-divider').getAttribute('data-open')).toBe('true')
  })

  it('open=false → fill/divider 的 data-open=false', () => {
    render(<PanelToggleIcon side="left" open={false} />)
    expect(screen.getByTestId('panel-fill').getAttribute('data-open')).toBe('false')
    expect(screen.getByTestId('panel-divider').getAttribute('data-open')).toBe('false')
  })

  it.each(['left', 'right', 'bottom'] as const)('side=%s → data-side 对应且窗口轮廓 rect 存在', (side) => {
    const { container } = render(<PanelToggleIcon side={side} open={false} />)
    expect(screen.getByTestId('panel-fill').getAttribute('data-side')).toBe(side)
    expect(screen.getByTestId('panel-divider').getAttribute('data-side')).toBe(side)
    // 窗口轮廓 = svg 下唯一无 data-testid 的 rect
    expect(container.querySelector('svg > rect:not([data-testid])')).toBeTruthy()
  })

  it('className 透传到 svg', () => {
    const { container } = render(<PanelToggleIcon side="right" open className="h-5 w-5" />)
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('h-5 w-5')
  })
})
