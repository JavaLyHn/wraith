import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatusView } from '../src/shared/types'
import type { WraithApi } from '../src/preload/index'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke },
  webUtils: { getPathForFile: vi.fn() },
}))

let wraith: WraithApi

beforeAll(async () => {
  await import('../src/preload/index')
  expect(electron.exposeInMainWorld).toHaveBeenCalledWith('wraith', expect.any(Object))
  wraith = electron.exposeInMainWorld.mock.calls[0][1] as WraithApi
})

beforeEach(() => {
  electron.invoke.mockReset()
})

describe('git status preload bridge', () => {
  it('只走窄 IPC，并原样保留 null、空列表与错误状态', async () => {
    const status: GitStatusView = {
      repo: true,
      root: null,
      name: null,
      state: null,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      insertions: 0,
      deletions: 0,
      untracked: 0,
      filesTotal: 0,
      files: [],
      remotes: [],
      error: 'git status timed out',
    }
    electron.invoke.mockResolvedValueOnce(status)

    const actual = await wraith.gitStatus()

    expect(electron.invoke).toHaveBeenCalledOnce()
    expect(electron.invoke).toHaveBeenCalledWith('wraith:gitStatus')
    expect(actual).toBe(status)
  })

  it('IPC/RPC 错误保持拒绝，不伪装成干净仓库', async () => {
    electron.invoke.mockRejectedValueOnce(new Error('git.status unavailable'))

    await expect(wraith.gitStatus()).rejects.toThrow('git.status unavailable')
  })
})
