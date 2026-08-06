import { describe, expect, it, vi } from 'vitest'
import { requestGitStatus } from '../src/main/gitStatusBridge'

describe('git status main bridge', () => {
  it('请求固定 RPC，并逐字段保留 null、error 与嵌套条目', async () => {
    const request = vi.fn().mockResolvedValue({
      repo: true,
      root: null,
      name: 'wraith',
      state: null,
      branch: null,
      upstream: null,
      ahead: 2,
      behind: 1,
      insertions: 295,
      deletions: 18,
      untracked: 3,
      filesTotal: 1,
      files: [{ path: 'desktop/src/main/index.ts', xy: 'M.', staged: true }],
      remotes: [{ name: 'origin', url: 'github.com/JavaLyHn/wraith' }],
      error: 'git status timed out',
      internal: 'must not cross IPC',
    })

    const actual = await requestGitStatus({ request })

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('git.status', {})
    expect(actual).toEqual({
      repo: true,
      root: null,
      name: 'wraith',
      state: null,
      branch: null,
      upstream: null,
      ahead: 2,
      behind: 1,
      insertions: 295,
      deletions: 18,
      untracked: 3,
      filesTotal: 1,
      files: [{ path: 'desktop/src/main/index.ts', xy: 'M.', staged: true }],
      remotes: [{ name: 'origin', url: 'github.com/JavaLyHn/wraith' }],
      error: 'git status timed out',
    })
  })

  it('空 files/remotes 保持为空，不生成占位条目', async () => {
    const request = vi.fn().mockResolvedValue({
      repo: false,
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
      error: null,
    })

    const actual = await requestGitStatus({ request })

    expect(actual.files).toEqual([])
    expect(actual.remotes).toEqual([])
  })

  it('RPC rejection 原样传播给既有 IPC 错误处理', async () => {
    const failure = new Error('git.status unavailable')
    const request = vi.fn().mockRejectedValue(failure)

    await expect(requestGitStatus({ request })).rejects.toBe(failure)
  })
})
