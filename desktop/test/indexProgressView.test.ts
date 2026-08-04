import { describe, it, expect } from 'vitest'
import {
  parseIndexProgress, indexProgressView, indexCompositionBars,
} from '../src/renderer/lib/indexProgressView'
import type { RagIndexResult } from '../src/shared/types'

/**
 * 建索引的可视化。用户原话：「没有清晰的图表示出来」。
 *
 * 现状是一行纯文本 `进度 7% 500/6293 块 · 刚完成 paths.ts` —— 有百分比没有条，
 * 而且**没有 ETA**：这个库实测要 14 分钟，只给「7%」等于让人干等。
 *
 * 三层纯函数：
 * ① `parseIndexProgress` —— 从后端消息里取出结构化进度。**这是回退路径**：
 *    新后端会在事件里直接带 `done/total/percent/file`，但旧 jar 只有 `message`，
 *    解析显示串能让 UI 在不换 jar 的情况下立刻可用。
 * ② `indexProgressView` —— 条宽 + ETA + 速率。ETA 由**渲染层自己计时**算出。
 * ③ `indexCompositionBars` —— 建完之后的构成条，把范围开关的效果画出来。
 */

describe('parseIndexProgress（回退解析后端消息）', () => {
  it('取出百分比 / 已完成 / 总数 / 当前文件', () => {
    const r = parseIndexProgress('   进度 7%  500/6293 块 · 刚完成 paths.ts')!
    expect(r.percent).toBe(7)
    expect(r.done).toBe(500)
    expect(r.total).toBe(6293)
    expect(r.file).toBe('paths.ts')
    expect(r.phase).toBe('embedding')
  })

  it('识别前置阶段 —— 那些阶段没有 done/total,只有阶段名', () => {
    expect(parseIndexProgress('🔍 开始索引: /Users/x/wraith')!.phase).toBe('scanning')
    expect(parseIndexProgress('📁 发现 871 个文件待索引(按范围设置排除 482 个测试文件、0 个文档文件)')!.phase).toBe('scanning')
    expect(parseIndexProgress('✂️ 切出 6283 个代码块，开始向量化（并发 8）')!.phase).toBe('chunking')
    expect(parseIndexProgress('✅ 索引完成：6283 个代码块，26415 条关系')!.phase).toBe('done')
  })

  it('前置阶段没有 total —— **不许编一个 0/0 出来**,那会让条从满格开始', () => {
    const r = parseIndexProgress('📁 发现 871 个文件待索引')!
    expect(r.total).toBeUndefined()
    expect(r.percent).toBeUndefined()
  })

  it('认不出的消息返回 null,不猜', () => {
    expect(parseIndexProgress('   ⚠️ 分块失败: /x/y.java - boom')).toBeNull()
    expect(parseIndexProgress('')).toBeNull()
    expect(parseIndexProgress(null as unknown as string)).toBeNull()
  })

  it('文件名里带空格 / 中文也要完整取出', () => {
    expect(parseIndexProgress('   进度 50%  1/2 块 · 刚完成 我的 文件.java')!.file).toBe('我的 文件.java')
  })
})

describe('indexProgressView（条宽 + ETA + 速率）', () => {
  const at = (over = {}) => indexProgressView({
    phase: 'embedding', done: 500, total: 6293, percent: 7, file: 'paths.ts',
    startedAtMs: 1000, nowMs: 1000 + 60_000, ...over,
  })

  it('条宽用后端给的百分比', () => {
    expect(at().barPercent).toBe(7)
  })

  it('ETA 由渲染层自己计时算 —— 60 秒做了 500/6293,剩下约 11.6 分钟', () => {
    const v = at()
    // 500 块/60s → 8.33 块/s;剩 5793 块 → 约 695 秒 ≈ 11.6 分
    expect(v.etaText).toMatch(/11 分|12 分/)
    expect(v.rateText).toMatch(/8(\.\d)? *块\/秒|8 块\/秒/)
  })

  it('**样本太少时不给 ETA** —— 前 1% 算出来的数字是垃圾,给了比不给更糟', () => {
    expect(at({ done: 3, percent: 0, nowMs: 1000 + 500 }).etaText).toBeNull()
    expect(at({ done: 20, percent: 1, nowMs: 1000 + 1_000 }).etaText).toBeNull()
  })

  /**
   * 三道门槛必须**各自**被检验。上一条用例里 `percent` 那道先失败了,
   * 于是把 `done >= 30` 改成 `done >= 0` 时**测试不红** —— 变异测试抓到的覆盖缺口。
   * 每条只放宽被测那一道,其余两道都满足。
   */
  it('done 那道门槛单独生效(percent 与已用时长都够)', () => {
    expect(at({ done: 10, percent: 5, nowMs: 1000 + 10_000 }).etaText).toBeNull()
    expect(at({ done: 30, percent: 5, nowMs: 1000 + 10_000 }).etaText).not.toBeNull()
  })

  it('percent 那道门槛单独生效(done 与已用时长都够)', () => {
    expect(at({ done: 100, percent: 1, nowMs: 1000 + 10_000 }).etaText).toBeNull()
    expect(at({ done: 100, percent: 2, nowMs: 1000 + 10_000 }).etaText).not.toBeNull()
  })

  it('已用时长那道门槛单独生效(done 与 percent 都够)', () => {
    expect(at({ done: 100, percent: 5, nowMs: 1000 + 1_000 }).etaText).toBeNull()
    expect(at({ done: 100, percent: 5, nowMs: 1000 + 3_000 }).etaText).not.toBeNull()
  })

  it('前置阶段是**不确定态** —— 没有总数就没有百分比,条要走脉冲而不是停在 0', () => {
    const v = indexProgressView({ phase: 'scanning', startedAtMs: 1000, nowMs: 5000 })
    expect(v.indeterminate).toBe(true)
    expect(v.barPercent).toBeNull()
    expect(v.etaText).toBeNull()
  })

  it('每个阶段都有人话标签 —— 「7%」不告诉人此刻在干什么', () => {
    expect(indexProgressView({ phase: 'scanning', startedAtMs: 0, nowMs: 0 }).phaseLabel).toMatch(/扫描|收集/)
    expect(indexProgressView({ phase: 'chunking', startedAtMs: 0, nowMs: 0 }).phaseLabel).toMatch(/分块|切/)
    expect(at().phaseLabel).toMatch(/向量化|嵌入/)
    expect(indexProgressView({ phase: 'persisting', startedAtMs: 0, nowMs: 0 }).phaseLabel).toMatch(/写入|保存/)
  })

  it('已用时长一直显示 —— 它是 ETA 不可用时唯一诚实的信息', () => {
    expect(at({ nowMs: 1000 + 90_000 }).elapsedText).toMatch(/1 分 30 秒|90 秒/)
  })

  it('百分比越界要夹住 —— 后端算错不该让条溢出容器', () => {
    expect(at({ percent: 140 }).barPercent).toBe(100)
    expect(at({ percent: -5 }).barPercent).toBe(0)
  })
})

describe('indexCompositionBars（建完之后的构成条）', () => {
  const r: RagIndexResult = {
    chunkCount: 6283, relationCount: 26415, fileCount: 871, javaFileCount: 344,
    excludedTests: 482, excludedDocs: 0, elapsedMs: 868_930,
  }

  it('把「索引了多少 / 按范围排掉多少」画成同一条 —— 这才看得出开关的效果', () => {
    const bars = indexCompositionBars(r)
    const labels = bars.map((b) => b.label).join(' ')
    expect(labels).toMatch(/已索引/)
    expect(labels).toMatch(/测试/)
    // 871 + 482 = 1353;已索引占 64.4%
    const indexed = bars.find((b) => b.label.includes('已索引'))!
    expect(indexed.count).toBe(871)
    expect(Math.round(indexed.pct)).toBe(64)
  })

  it('没有排除任何东西时只有一段,占满 100%', () => {
    const bars = indexCompositionBars({ fileCount: 100, excludedTests: 0, excludedDocs: 0 })
    expect(bars).toHaveLength(1)
    expect(bars[0].pct).toBe(100)
  })

  it('计数为 0 的段整段不出现 —— 不画宽度为 0 的色块', () => {
    const bars = indexCompositionBars(r)
    expect(bars.some((b) => b.count === 0)).toBe(false)
    expect(bars.some((b) => b.label.includes('文档'))).toBe(false)
  })

  it('老后端不回这些字段时返回空数组,面板据此整块不渲染', () => {
    expect(indexCompositionBars({ chunkCount: 100 })).toEqual([])
  })

  it('每段都带一个主题令牌类名 —— 不许写死调色板色阶(亮色主题下不可读)', () => {
    const palette = /-(?:emerald|amber|red|green|yellow|slate|gray|zinc|blue|sky)-\d{2,3}\b/
    for (const b of indexCompositionBars(r)) {
      expect(b.className, b.label).not.toMatch(palette)
      expect(b.className, b.label).toMatch(/bg-/)
    }
  })
})
