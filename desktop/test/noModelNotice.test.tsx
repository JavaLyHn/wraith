// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import NoModelNotice from '../src/renderer/components/NoModelNotice'
import WelcomeEmptyState from '../src/renderer/components/WelcomeEmptyState'
import { needsModelSetup, showNoModelNotice } from '../src/renderer/lib/modelReady'

afterEach(cleanup)

/**
 * 首次运行死锁修复的前端一半。
 *
 * 后端此前无 API Key 就 System.exit(1),而配 provider 又必须经过后端 —— 死锁。
 * 后端改成「无模型也启动」之后还剩一个问题:那个状态在界面上**完全没有表达**。
 * 用户只看到一个输入框,打字发出去没反应,而 `未找到可用 API Key` 只在控制台。
 */
describe('needsModelSetup', () => {
  it('后端明说没配 → 提示', () => {
    expect(needsModelSetup({ modelConfigured: false })).toBe(true)
  })

  it('后端明说配了 → 不提示', () => {
    expect(needsModelSetup({ modelConfigured: true })).toBe(false)
  })

  it('拿到非空 provider → 不提示(存完 provider 后的收起判据)', () => {
    expect(needsModelSetup({ currentProvider: 'deepseek' })).toBe(false)
    expect(needsModelSetup({ modelConfigured: false, currentProvider: 'deepseek' })).toBe(false)
  })

  it('拿到空 provider → 提示', () => {
    expect(needsModelSetup({ currentProvider: '' })).toBe(true)
    expect(needsModelSetup({ currentProvider: '   ' })).toBe(true)
  })

  it('旧后端(没有 modelConfigured 字段)且无 provider 信息 → **保持沉默**', () => {
    // 误报一次,用户就再也不信这条提示了。宁可不提示,也不要对一个其实配好了的
    // 旧版本天天弹「你还没配模型」。
    expect(needsModelSetup({})).toBe(false)
  })
})

/**
 * 用户实测撞到的:模型明明已经配上(composer 显示 claude-haiku-4-5-...),
 * 引导条还挂在首页。
 *
 * 根因是 `needsModelSetup` 的结果是**快照** —— 只在 initialize 与「存完 provider 回查」
 * 两处采样。重启后从 config 读到模型、在别处设默认、切模型、后端热装,都不经过采样点,
 * 快照就一直停在「没有模型」。所以最终显示还要与活信号 state.model 取交集。
 */
describe('showNoModelNotice：与活信号取交集', () => {
  it('快照说没有 + 确实没有模型名 → 显示', () => {
    expect(showNoModelNotice(true, '')).toBe(true)
    expect(showNoModelNotice(true, undefined)).toBe(true)
    expect(showNoModelNotice(true, '   ')).toBe(true)
  })

  it('**快照说没有,但已经有模型名 → 不显示**(就是用户撞到的那一幕)', () => {
    expect(showNoModelNotice(true, 'claude-haiku-4-5-20251001')).toBe(false)
  })

  it('快照说有 → 一律不显示', () => {
    expect(showNoModelNotice(false, '')).toBe(false)
    expect(showNoModelNotice(false, 'gpt-5.4')).toBe(false)
  })
})

describe('NoModelNotice', () => {
  it('说清现状并给出一键入口', () => {
    const onConfigure = vi.fn()
    render(<NoModelNotice onConfigure={onConfigure} />)
    expect(screen.getByTestId('no-model-notice').textContent).toContain('还没有配置模型')
    fireEvent.click(screen.getByTestId('no-model-configure'))
    expect(onConfigure).toHaveBeenCalled()
  })

  it('挂进首页空态的 notices 槽,不挤掉示例入口', () => {
    render(
      <WelcomeEmptyState
        categories={[{ label: '了解这个项目', prompts: ['梳理目录结构', '主要模块有哪些'] }]}
        onPickExample={vi.fn()}
        notices={<NoModelNotice onConfigure={vi.fn()} />}
      >
        <div data-testid="composer">composer</div>
      </WelcomeEmptyState>,
    )
    expect(screen.getByTestId('no-model-notice')).toBeTruthy()
    // 引导条不该把空态的主职责挤走
    expect(screen.getByText('了解这个项目')).toBeTruthy()
    expect(screen.getByTestId('composer')).toBeTruthy()
  })
})
