// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SummaryContent } from '../src/renderer/components/SummaryPopover'
import type { ArtifactSummary } from '../src/shared/artifactSummary'

afterEach(() => cleanup())

const EMPTY: ArtifactSummary = { files: [], servers: [], subagents: null, browserUrl: null, sources: [], workspace: '/proj', isEmpty: true }

function full(): ArtifactSummary {
  return {
    files: [{ path: 'README.md', kind: 'created', content: '你好' }, { path: 'src/a.ts', kind: 'modified', content: 'x=1' }],
    servers: [{ url: 'http://localhost:5173' }],
    subagents: { total: 3, done: 2, roles: ['coder'] },
    browserUrl: 'https://b.com',
    sources: [{ path: '/i/1.png', name: '1.png', kind: 'image' }],
    workspace: '/proj',
    isEmpty: false,
  }
}

describe('SummaryContent', () => {
  it('空态显示文案', () => {
    render(<SummaryContent summary={EMPTY} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} onOpenArtifact={vi.fn()} />)
    expect(screen.getByTestId('summary-empty')).toBeTruthy()
  })

  it('点文件行调用 onOpenArtifact(path, content)', () => {
    const onOpenArtifact = vi.fn()
    render(<SummaryContent summary={full()} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} onOpenArtifact={onOpenArtifact} />)
    const files = screen.getAllByTestId('summary-file')
    expect(files).toHaveLength(2)
    fireEvent.click(files[1]!) // src/a.ts
    expect(onOpenArtifact).toHaveBeenCalledWith('src/a.ts', 'x=1')
  })

  it('服务/浏览器行调用 onOpenExternal', () => {
    const onOpenExternal = vi.fn()
    render(<SummaryContent summary={full()} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={onOpenExternal} onOpenArtifact={vi.fn()} />)
    fireEvent.click(screen.getByTestId('summary-server'))
    expect(onOpenExternal).toHaveBeenCalledWith('http://localhost:5173')
    fireEvent.click(screen.getByTestId('summary-browser'))
    expect(onOpenExternal).toHaveBeenCalledWith('https://b.com')
  })

  it('子智能体显示完成计数', () => {
    render(<SummaryContent summary={full()} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} onOpenArtifact={vi.fn()} />)
    expect(screen.getByTestId('summary-subagents').textContent).toContain('2/3 完成')
  })

  it('来源含附件与工作目录;>5 行时可展开', () => {
    const many: ArtifactSummary = { ...full(), files: [], servers: [], subagents: null, browserUrl: null,
      sources: Array.from({ length: 6 }, (_, i) => ({ path: `/i/${i}.png`, name: `${i}.png`, kind: 'image' })) }
    render(<SummaryContent summary={many} workspace="/proj" onOpenPath={vi.fn()} onOpenExternal={vi.fn()} onOpenArtifact={vi.fn()} />)
    // 6 附件 + 1 工作目录 = 7 行 > 5,默认只显 5
    expect(screen.getAllByTestId('summary-source')).toHaveLength(5)
    fireEvent.click(screen.getByTestId('summary-sources-toggle'))
    expect(screen.getAllByTestId('summary-source')).toHaveLength(7)
  })
})
