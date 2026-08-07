// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import GitPill from '../src/renderer/components/GitPill'
import type { GitStatusView } from '../src/shared/types'

afterEach(() => cleanup())

const s: GitStatusView = {
  repo: true, root: '/r/wraith', name: 'wraith', state: 'normal',
  branch: 'feat/x', upstream: 'origin/feat/x', ahead: 3, behind: 0,
  insertions: 295, deletions: 18, untracked: 3, filesTotal: 25,
  files: [{ path: 'src/A.java', xy: '.M', staged: false }],
  remotes: [{ name: 'origin', url: 'github.com/JavaLyHn/wraith' }],
  error: null,
}

describe('GitPill', () => {
  it('没有仓库时整块不渲染 —— 断言什么都没渲染,而不是断言某句文案', () => {
    // 用 container.firstChild → toBeNull(),**不要用 toBeEmptyDOMElement()**:
    // 本项目没装 @testing-library/jest-dom,那个匹配器不存在。
    // 既有写法见 test/accountRowAndSandboxChip.test.tsx。
    const { container } = render(<GitPill status={{ ...s, repo: false }} onRefresh={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('弹出层默认关着,点 pill 才开', () => {
    render(<GitPill status={s} onRefresh={() => {}} />)
    expect(screen.queryByTestId('git-pill-popover')).toBeNull()
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(screen.getByTestId('git-pill-popover')).toBeTruthy()
  })

  it('点开时强刷一次', () => {
    const onRefresh = vi.fn()
    render(<GitPill status={s} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('手动刷新键再调一次', () => {
    const onRefresh = vi.fn()
    render(<GitPill status={s} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    fireEvent.click(screen.getByTestId('git-pill-refresh'))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('文件列表被截断时说出总数', () => {
    render(<GitPill status={s} onRefresh={() => {}} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(screen.getByTestId('git-pill-popover').textContent).toContain('25')
  })

  it('取数失败时明写出来,不静默拿旧数据当新的', () => {
    render(<GitPill status={{ ...s, error: 'git status 退出码 128' }} onRefresh={() => {}} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(screen.getByTestId('git-pill-stale').textContent).toContain('128')
  })

  it('必须写明这是真实 .git,与快照面板互不影响', () => {
    render(<GitPill status={s} onRefresh={() => {}} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    const text = screen.getByTestId('git-pill-popover').textContent ?? ''
    expect(text).toContain('快照')
    expect(text).toContain('只读')
  })
})
