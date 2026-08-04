import { describe, it, expect } from 'vitest'
import { indexSummaryLines, relationHint } from '../src/renderer/lib/ragView'
import type { RagIndexResult } from '../src/shared/types'

/**
 * 用户实测两件事:
 * ① 建索引时只有一行「进度：36/326 块」——「仅仅是数字变化,没有详细的内容」
 * ② 建完之后「没有结果展示」,只剩「已索引 326 块 · 0 关系」
 *
 * ① 在后端修(进度消息带上百分比与当前文件);② 是这里:把 rag.index 的回包摊成几行看得懂的明细。
 *
 * 而那个 **0 关系**本身需要解释:关系图谱只从 `.java` 提取,非 Java 项目必然是 0。
 * 界面一个字不说的话读起来就像失败了。
 */

const r = (over: Partial<RagIndexResult> = {}): RagIndexResult => ({
  chunkCount: 326, relationCount: 0, fileCount: 84, javaFileCount: 0,
  elapsedMs: 96_000, embeddingModel: 'nomic-embed-text:latest', ...over,
})

describe('indexSummaryLines', () => {
  it('把文件数 / 块数 / 关系数 / 模型 / 耗时都摊出来', () => {
    const lines = indexSummaryLines(r()).join('\n')
    expect(lines).toContain('84')      // 文件
    expect(lines).toContain('326')     // 块
    expect(lines).toContain('nomic-embed-text:latest')
    expect(lines).toMatch(/1\s*分|96\s*秒|1m36s|96s/)   // 耗时以某种可读形式出现
  })

  it('缺字段时那一行整条不出现 —— 不显示「文件 undefined 个」', () => {
    const lines = indexSummaryLines({ chunkCount: 5 }).join('\n')
    expect(lines).not.toContain('undefined')
    expect(lines).not.toContain('NaN')
    expect(lines).toContain('5')
  })

  it('空回包给空数组,不给一堆占位行', () => {
    expect(indexSummaryLines({})).toEqual([])
  })

  it('残缺索引要显式点出来 —— 那批代码永远搜不到', () => {
    const lines = indexSummaryLines(r({ failedChunks: 12, failedFiles: 3 })).join('\n')
    expect(lines).toContain('12')
    expect(lines).toMatch(/失败|不完整|搜不到/)
  })
})

describe('relationHint', () => {
  it('0 关系 + 0 个 Java 文件 → 解释成正常现象,并点明只从 .java 提取', () => {
    const h = relationHint(r())!
    expect(h).toContain('.java')
    expect(h).toMatch(/没有|不含|0 个/)
  })

  it('0 关系但**有** Java 文件 → 这才是异常,要说成异常', () => {
    const h = relationHint(r({ javaFileCount: 12 }))!
    expect(h).toMatch(/异常|不正常|应当|预期/)
    expect(h).toContain('12')
  })

  it('关系数 > 0 → 不用解释', () => {
    expect(relationHint(r({ relationCount: 21, javaFileCount: 3 }))).toBeNull()
  })

  it('javaFileCount 未知(老后端不回这个字段)→ 不猜,不解释', () => {
    expect(relationHint({ relationCount: 0 })).toBeNull()
  })
})
