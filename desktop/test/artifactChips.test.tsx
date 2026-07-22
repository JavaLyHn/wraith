// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ArtifactChips from '../src/renderer/components/ArtifactChips'
import type { ArtifactFile } from '../src/shared/artifactSummary'

afterEach(() => cleanup())

const files: ArtifactFile[] = [
  { path: 'src/README.md', kind: 'created', content: '你好' },
  { path: 'a/b/main.ts', kind: 'modified', content: 'x' },
]

describe('ArtifactChips', () => {
  it('每个文件渲染一个 chip,显示 baseName', () => {
    render(<ArtifactChips files={files} onOpenArtifact={vi.fn()} />)
    const chips = screen.getAllByTestId('artifact-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.textContent).toContain('README.md')
    expect(chips[1]!.textContent).toContain('main.ts')
  })

  it('点 chip 调 onOpenArtifact(path, content)', () => {
    const onOpen = vi.fn()
    render(<ArtifactChips files={files} onOpenArtifact={onOpen} />)
    fireEvent.click(screen.getAllByTestId('artifact-chip')[0]!)
    expect(onOpen).toHaveBeenCalledWith('src/README.md', '你好')
  })

  it('空数组 → 不渲染', () => {
    const { container } = render(<ArtifactChips files={[]} onOpenArtifact={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
