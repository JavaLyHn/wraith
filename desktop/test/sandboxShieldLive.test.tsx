// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import PolicyPanel from '../src/renderer/components/PolicyPanel'
import TopBar from '../src/renderer/components/TopBar'
import { sandboxChipView } from '../src/renderer/lib/topBar'
import { initialState, setSandbox } from '../src/shared/transcriptReducer'

/**
 * 顶栏护盾「不管怎么拨都不变」。
 *
 * 用户报的是 Windows，但根因跟平台无关，是两个独立缺陷叠在一起：
 *
 * <b>缺陷 A —— 又是一次性快照。</b>`state.sandbox` 只在 `initialize` 时 dispatch 过一次；
 * 面板里 `sandbox.set` 拿回的新状态只写进 PolicyPanel 的局部 state。
 * 于是顶栏那枚盾从开机起就冻住了，整个会话内不可能再变。
 * （同一个模式今年已经踩了四次：无模型提示条、AppContainer 缓存、后台任务 null client，现在是它。）
 *
 * <b>缺陷 B —— 盾根本没看联网位。</b>`sandboxChipView` 只吃 kind。
 * 而面板里用户唯一能拨的沙箱控件就是「命令沙箱联网」——
 * 拨它 kind 不变，所以哪怕修好了 A，盾还是纹丝不动。
 * 用户说的「有没有开启沙箱」指的就是这个开关，他没说错。
 *
 * 判据：**联网放行是一个可见的、弱化的姿态**，不是「没沙箱」（文件仍然被关着），
 * 也不该跟「全关着」长得一模一样。
 */

const noop = (): void => {}

describe('缺陷 B:盾必须反映联网位', () => {
  it('Seatbelt 断网 vs 放行网络 —— 图标口径不同', () => {
    const off = sandboxChipView('macos-seatbelt', 'darwin', false)
    const on = sandboxChipView('macos-seatbelt', 'darwin', true)
    expect(off.kind).toBe('ok')
    expect(on.kind).toBe('ok-net')
  })

  it('AppContainer 同理 —— 这正是用户在 Windows 上拨的那个开关', () => {
    const off = sandboxChipView('windows-appcontainer', 'win32', false)
    const on = sandboxChipView('windows-appcontainer', 'win32', true)
    expect(off.kind).toBe('ok')
    expect(on.kind).toBe('ok-net')
    expect(off.label).not.toBe(on.label)
    expect(off.title).not.toBe(on.title)
  })

  it('放行网络是**弱化**不是**故障**:用 warn 不用 danger', () => {
    const on = sandboxChipView('windows-appcontainer', 'win32', true)
    expect(on.tone).toContain('text-warn')
    expect(on.tone).not.toContain('danger')
  })

  it('放行网络仍然是有沙箱 —— 文案不能出现「未启用」', () => {
    for (const k of ['macos-seatbelt', 'windows-appcontainer'] as const) {
      const v = sandboxChipView(k, 'win32', true)
      expect(v.label).not.toContain('未启用')
      expect(v.title).toContain('网络')
    }
  })

  it('没有沙箱时联网位无意义 —— none/unknown 不受它影响', () => {
    for (const p of ['darwin', 'win32', 'linux']) {
      expect(sandboxChipView('none', p, true)).toEqual(sandboxChipView('none', p, false))
      expect(sandboxChipView('unknown', p, true)).toEqual(sandboxChipView('unknown', p, false))
    }
  })

  it('省略第三参 = 断网(最强姿态),不会把未知当成放行', () => {
    expect(sandboxChipView('macos-seatbelt', 'darwin')).toEqual(
      sandboxChipView('macos-seatbelt', 'darwin', false))
  })
})

describe('缺陷 B:顶栏真的换了图标', () => {
  // win32 下顶栏会挂 WindowControls,它在 effect 里读 window.wraith.windowControls;
  // 读不到会把整棵树掀了。这里只关心盾,给个最小桩。
  beforeEach(() => {
    ;(window as unknown as { wraith: unknown }).wraith = {
      windowControls: {
        minimize: noop, maximize: noop, close: noop,
        isMaximized: async () => false,
        onMaximizeChange: () => noop,
      },
    }
  })
  afterEach(cleanup)

  const base = {
    platform: 'win32', sidebarCollapsed: false, onToggleSidebar: noop, showChat: true,
    terminalOpen: false, onToggleTerminal: noop, rightDockOpen: false, onToggleRightDock: noop,
    onOpenPolicy: noop,
  }

  it('断网 → 打勾盾;放行 → 半盾。两者 SVG 不同', () => {
    const { container: a } = render(
      <TopBar {...base} sandbox="windows-appcontainer" sandboxNet={false} />)
    const offSvg = a.querySelector('[data-testid="sandbox-badge"] svg')?.innerHTML
    cleanup()
    const { container: b } = render(
      <TopBar {...base} sandbox="windows-appcontainer" sandboxNet />)
    const onSvg = b.querySelector('[data-testid="sandbox-badge"] svg')?.innerHTML

    expect(offSvg).toBeTruthy()
    expect(onSvg).toBeTruthy()
    expect(offSvg).not.toBe(onSvg)   // 「始终不变」就是在这里被用户看见的
  })

  it('aria-label 也要跟着变,否则读屏用户拿不到这个区别', () => {
    render(<TopBar {...base} sandbox="windows-appcontainer" sandboxNet />)
    expect(screen.getByTestId('sandbox-badge').getAttribute('aria-label')).toContain('网络')
  })
})

describe('缺陷 A:状态要能从面板流回顶栏', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('reducer 同时存 kind 与联网位', () => {
    const s = setSandbox(initialState, 'windows-appcontainer', true)
    expect(s.sandbox).toBe('windows-appcontainer')
    expect(s.sandboxNet).toBe(true)
    expect(setSandbox(initialState, 'none', false).sandboxNet).toBe(false)
  })

  function stubPolicy(net: boolean) {
    const sandboxSet = vi.fn(async (allowed: boolean) => ({
      available: true, kind: 'windows-appcontainer', networkAllowed: allowed, degradedReason: null,
    }))
    ;(window as unknown as { wraith: unknown }).wraith = {
      policyStatus: vi.fn().mockResolvedValue({ projectRoot: '/w', auditDir: '/a', dangerousTools: [] }),
      auditList: vi.fn().mockResolvedValue({ entries: [] }),
      sandboxGet: vi.fn().mockResolvedValue({
        available: true, kind: 'windows-appcontainer', networkAllowed: net, degradedReason: null,
      }),
      sandboxSet,
    }
    return { sandboxSet }
  }

  it('拨联网开关 → 通过 onSandboxChange 把新状态交出去(顶栏才可能跟着动)', async () => {
    stubPolicy(false)
    const onSandboxChange = vi.fn()
    await act(async () => { render(<PolicyPanel onBack={noop} onSandboxChange={onSandboxChange} />) })
    onSandboxChange.mockClear()

    await act(async () => { fireEvent.click(screen.getByTestId('sandbox-net-toggle')) })

    expect(onSandboxChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'windows-appcontainer', networkAllowed: true }))
  })

  it('面板首次加载也上报 —— 否则开机后后端状态变了(装回 PowerShell 之类)顶栏永远陈旧', async () => {
    stubPolicy(true)
    const onSandboxChange = vi.fn()
    await act(async () => { render(<PolicyPanel onBack={noop} onSandboxChange={onSandboxChange} />) })

    expect(onSandboxChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'windows-appcontainer', networkAllowed: true }))
  })

  it('不传 onSandboxChange 也不能崩 —— 面板在别处被独立渲染过', async () => {
    stubPolicy(false)
    await act(async () => { render(<PolicyPanel onBack={noop} />) })
    expect(screen.getByTestId('sandbox-net-toggle')).toBeTruthy()
  })
})
