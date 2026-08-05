// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import SnapshotPanel from '../src/renderer/components/SnapshotPanel'
import type { SnapshotSettingsView } from '../src/shared/types'

/**
 * 快照总开关（面板右上角那颗）。
 *
 * <p>用户要的是「一个按钮，表示为开启和关闭快照功能」。做这个之前关快照**只有环境变量**
 * 一条路，而且没有任何持久化位置 —— 按钮点完没地方存。
 *
 * <p>这里守两条容易做错的语义：
 * <ul>
 *   <li>点了要**又生效又记住**（写盘 + 运行期立即生效）。</li>
 *   <li>被环境变量压住时**不许装作能改**：取值链是 env → 属性 → config.json，
 *       按钮写的是最后那层。不说清的话用户下次启动会以为按钮坏了。</li>
 * </ul>
 */

function stub(over: Record<string, unknown> = {}): {
  setEnabled: ReturnType<typeof vi.fn>
} {
  const setEnabled = vi.fn(async () => ({ ok: true, enabled: false }))
  ;(window as unknown as { wraith: unknown }).wraith = {
    snapshotList: async () => ({ snapshots: [], enabled: true }),
    snapshotSettings: async (): Promise<SnapshotSettingsView> =>
      ({ enabled: true, source: 'default', locked: false, available: true }),
    snapshotSetEnabled: setEnabled,
    snapshotClean: async () => ({ ok: true }),
    snapshotRestoreCommit: async () => ({ ok: true }),
    ...over,
  }
  return { setEnabled }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { wraith?: unknown }).wraith
  vi.clearAllMocks()
})

const settings = (over: Partial<SnapshotSettingsView> = {}): SnapshotSettingsView =>
  ({ enabled: true, source: 'default', locked: false, available: true, ...over })

describe('快照总开关', () => {
  it('**开关在面板上** —— 用户要的就是这颗按钮', async () => {
    stub()
    render(<SnapshotPanel onBack={() => {}} />)

    const toggle = await screen.findByTestId('snapshot-toggle')
    await waitFor(() => expect(toggle.getAttribute('data-enabled')).toBe('true'))
    expect(toggle.textContent).toContain('已开')
  })

  it('关着时显示「已关」', async () => {
    stub({ snapshotSettings: async () => settings({ enabled: false, source: 'config' }) })
    render(<SnapshotPanel onBack={() => {}} />)

    const toggle = await screen.findByTestId('snapshot-toggle')
    await waitFor(() => expect(toggle.getAttribute('data-enabled')).toBe('false'))
    expect(toggle.textContent).toContain('已关')
  })

  it('点一下把相反的值发给后端,并提示「已记住」', async () => {
    const { setEnabled } = stub()
    render(<SnapshotPanel onBack={() => {}} />)

    const toggle = await screen.findByTestId('snapshot-toggle')
    await waitFor(() => expect(toggle.getAttribute('data-enabled')).toBe('true'))
    fireEvent.click(toggle)

    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false))
    await waitFor(() => expect(document.body.textContent).toContain('已记住'))
  })

  it('关着的时候点它是开启', async () => {
    const { setEnabled } = stub({
      snapshotSettings: async () => settings({ enabled: false, source: 'config' }),
    })
    render(<SnapshotPanel onBack={() => {}} />)

    const toggle = await screen.findByTestId('snapshot-toggle')
    await waitFor(() => expect(toggle.getAttribute('data-enabled')).toBe('false'))
    fireEvent.click(toggle)

    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(true))
  })

  it('**被环境变量压住时要标出来** —— 否则用户下次启动会以为按钮坏了', async () => {
    stub({ snapshotSettings: async () => settings({ enabled: false, source: 'env', locked: true }) })
    render(<SnapshotPanel onBack={() => {}} />)

    const toggle = await screen.findByTestId('snapshot-toggle')
    await waitFor(() => expect(toggle.getAttribute('data-locked')).toBe('true'))
    expect(screen.queryByTestId('snapshot-toggle-locked')).not.toBeNull()
    expect(toggle.getAttribute('title')).toContain('环境变量')
    expect(toggle.getAttribute('title')).toContain('下次启动')
  })

  it('后端带 warning 时把那句话贴出来,不吞掉', async () => {
    stub({
      snapshotSettings: async () => settings({ source: 'env', locked: true }),
      snapshotSetEnabled: vi.fn(async () => ({
        ok: true, enabled: false, warning: '环境变量 WRAITH_SNAPSHOT_ENABLED 优先级更高',
      })),
    })
    render(<SnapshotPanel onBack={() => {}} />)

    fireEvent.click(await screen.findByTestId('snapshot-toggle'))

    await waitFor(() => expect(document.body.textContent)
        .toContain('WRAITH_SNAPSHOT_ENABLED 优先级更高'))
  })

  it('后端没有快照服务时不摆一颗点不动的按钮', async () => {
    stub({ snapshotSettings: async () => settings({ available: false }) })
    render(<SnapshotPanel onBack={() => {}} />)

    await waitFor(() => expect(screen.queryByTestId('snapshot-toggle-unavailable')).not.toBeNull())
    expect(screen.queryByTestId('snapshot-toggle')).toBeNull()
  })

  it('状态还没拉到时按钮是禁用的 —— 不能拿默认值去猜然后切错方向', async () => {
    stub({ snapshotSettings: () => new Promise(() => {}) })   // 永不 resolve
    render(<SnapshotPanel onBack={() => {}} />)

    const toggle = await screen.findByTestId('snapshot-toggle')
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
  })
})
