import { describe, it, expect } from 'vitest'
import { scopeMismatchWarning, scopeEffectNote, scopeSummaryLine } from '../src/renderer/lib/ragView'
import type { RagStatus, RagIndexResult } from '../src/shared/types'

/**
 * 索引范围开关在面板上的三件事。
 *
 * ① **范围不符提示**：范围变了但模型没变时，已有的 `staleIndexWarning` 与后端的
 *    `compatibilityWarning` **都不会响**（它们比的是模型和维度）。用户开了开关却没重建，
 *    索引里测试还在、检索照样返回测试，而界面一个字都不说 —— 本仓库第 9 次 snapshot-vs-live。
 * ② **效果说明**：两个开关效果方向相反（实测排除测试 MRR +24%、排除文档 −24%），
 *    界面必须说清哪个是正的，否则用户会误以为「都勾上更干净」。
 * ③ **排除数**：打开后块数会明显下降（9718→6283），不报会被读成索引出错。
 */

const st = (over: Partial<RagStatus> = {}): RagStatus => ({
  indexed: true, chunkCount: 9718, relationCount: 55091, ...over,
})

describe('scopeMismatchWarning', () => {
  it('索引含测试而当前设置要排除 → 提示,并给出动作', () => {
    const w = scopeMismatchWarning(st({ indexExcludeTests: false, excludeTests: true }))!
    expect(w).toMatch(/测试/)
    expect(w).toContain('重建')
  })

  it('索引排除了测试而当前设置要包含 → 反方向也要提示', () => {
    const w = scopeMismatchWarning(st({ indexExcludeTests: true, excludeTests: false }))!
    expect(w).toMatch(/测试/)
  })

  it('一致时一个字都不加', () => {
    expect(scopeMismatchWarning(st({ indexExcludeTests: true, excludeTests: true }))).toBeNull()
    expect(scopeMismatchWarning(st({ indexExcludeTests: false, excludeTests: false }))).toBeNull()
  })

  it('**索引没记过范围(老索引)时不比较、不猜** —— 宁可漏报', () => {
    // indexExcludeTests 缺省 = 不知道。当成 false 就会对每一份老索引误报「快重建」
    expect(scopeMismatchWarning(st({ excludeTests: true }))).toBeNull()
    expect(scopeMismatchWarning(st({ excludeDocs: true }))).toBeNull()
  })

  it('没索引 / 状态未知时不提示', () => {
    expect(scopeMismatchWarning(null)).toBeNull()
    expect(scopeMismatchWarning(st({ indexed: false, indexExcludeTests: false, excludeTests: true }))).toBeNull()
  })

  it('两个开关都不符时都点名 —— 用户才知道该动哪个', () => {
    const w = scopeMismatchWarning(st({
      indexExcludeTests: false, indexExcludeDocs: false, excludeTests: true, excludeDocs: true,
    }))!
    expect(w).toMatch(/测试/)
    expect(w).toMatch(/文档/)
  })
})

describe('scopeEffectNote', () => {
  it('必须说清两个开关的效果方向相反,并且带上实测数字', () => {
    const n = scopeEffectNote()
    expect(n).toMatch(/测试/)
    expect(n).toMatch(/文档/)
    // 数字是这个特性存在的全部理由,不能只写「可能影响检索质量」
    expect(n).toMatch(/24%|\+24|−24|-24/)
  })

  it('必须说明改完要重建才生效 —— 否则用户勾完以为立刻起作用', () => {
    expect(scopeEffectNote()).toMatch(/重建/)
  })
})

describe('scopeSummaryLine', () => {
  it('有排除时报出两个数字', () => {
    const r: RagIndexResult = { chunkCount: 6283, excludedTests: 482, excludedDocs: 0 }
    const line = scopeSummaryLine(r)!
    expect(line).toContain('482')
  })

  it('没排除任何东西时整行不出现 —— 不显示「排除 0 个」', () => {
    expect(scopeSummaryLine({ chunkCount: 100, excludedTests: 0, excludedDocs: 0 })).toBeNull()
  })

  it('老后端不回这两个字段时不显示,也不显示 undefined', () => {
    expect(scopeSummaryLine({ chunkCount: 100 })).toBeNull()
  })
})
