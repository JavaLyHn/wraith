import { describe, it, expect } from 'vitest'
import { gitPillView } from '../src/renderer/lib/gitPill'
import type { GitStatusView } from '../src/shared/types'

// base 取「干净工作区的正常分支」—— 其余用例在它之上覆写单个字段,
// 避免每个用例都把 14 个字段抄一遍。字段对齐 GitStatusView(types.ts)。
const base: GitStatusView = {
  repo: true, root: '/r/wraith', name: 'wraith', state: 'normal',
  branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0,
  insertions: 0, deletions: 0, untracked: 0, filesTotal: 0,
  files: [], remotes: [], error: null,
}

describe('gitPillView', () => {
  it('没有仓库时不可见', () => {
    expect(gitPillView({ ...base, repo: false }).visible).toBe(false)
  })

  it('status 还没拉回来时不可见 —— 不显示占位,免得顶栏闪一下', () => {
    expect(gitPillView(null).visible).toBe(false)
  })

  it('干净工作区只显示分支名,整段行数省略', () => {
    const v = gitPillView(base)
    expect(v.visible).toBe(true)
    expect(v.branch).toBe('main')
    expect(v.suffix).toBe('')
  })

  it('有改动时显示 +N −M', () => {
    expect(gitPillView({ ...base, insertions: 295, deletions: 18 }).suffix)
      .toBe('+295 −18')
  })

  it('未跟踪数只在大于 0 时出现', () => {
    expect(gitPillView({ ...base, insertions: 295, deletions: 18, untracked: 3 }).suffix)
      .toBe('+295 −18 · 3 未跟踪')
    expect(gitPillView({ ...base, untracked: 2 }).suffix).toBe('· 2 未跟踪')
  })

  it('游离态显示短 sha 加标记', () => {
    const v = gitPillView({ ...base, state: 'detached', branch: 'a1b2c3d', upstream: null })
    expect(v.branch).toBe('a1b2c3d')
    expect(v.title).toContain('游离')
  })

  it('新仓库无提交时标出来', () => {
    expect(gitPillView({ ...base, state: 'unborn' }).title).toContain('无提交')
  })
})
