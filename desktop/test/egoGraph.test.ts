import { describe, it, expect } from 'vitest'
import { egoGraph, isResolvedTarget, isResolvedNeighbor } from '../src/renderer/lib/egoGraph'
import type { RagRelation } from '../src/shared/types'

/**
 * 「点一个类 → 看它的邻居」的辐射布局（ego graph / 1 跳邻域）。
 *
 * 数据来自已有的 `rag.graph {name}` RPC（`WHERE from_name=? OR to_name=?`，一跳）。
 *
 * **必须先说清一个数据事实**（量过的）：这个索引里 55091 条边的构成是
 * `calls` 46630（85%）/ `contains` 5613 / `imports` 2687 / `implements` 99 / `extends` 62，
 * 而 **`calls` 的目标 100% 是裸方法名**（`Hello.main → println`，含点的限定名 0 条）。
 * 所以查 `AppServer.dispatch` 会得到几十个 `get` / `put` / `append` 这样的假节点。
 *
 * 这套布局对此的处理是**默认折叠、但把数目说出来**——既不假装我们有调用图，
 * 也不偷偷把 85% 的边扔掉不提。
 */

const rel = (from: string, to: string, type: string, toFile = ''): RagRelation => ({
  fromName: from, toName: to, relationType: type, fromFile: '/x/From.java', toFile,
})

describe('isResolvedTarget（目标解析得出来吗）', () => {
  it('带 toFile 的算解析出来了（contains 100% 有）', () => {
    expect(isResolvedTarget(rel('Hello', 'Hello.main', 'contains', '/x/Hello.java'))).toBe(true)
  })

  it('限定名（含点）算解析出来了', () => {
    expect(isResolvedTarget(rel('A.run', 'B.go', 'calls'))).toBe(true)
  })

  it('裸方法名不算 —— `println` / `get` / `assertEquals` 都是假节点', () => {
    expect(isResolvedTarget(rel('Hello.main', 'println', 'calls'))).toBe(false)
    expect(isResolvedTarget(rel('X.y', 'assertEquals', 'calls'))).toBe(false)
  })

  it('**extends / implements 的目标虽然没有 toFile,也算有意义** —— 那是类型名', () => {
    // 实测:extends 62 条、implements 99 条,toFile 都是空,但 `BaseService`、`LlmClient`
    // 这种目标是真类型名,不是裸方法名。把它们当未解析折叠掉会把最有用的边藏起来。
    expect(isResolvedTarget(rel('SampleService', 'BaseService', 'extends'))).toBe(true)
    expect(isResolvedTarget(rel('GLMClient', 'LlmClient', 'implements'))).toBe(true)
  })
})

describe('isResolvedNeighbor（判的是邻居节点,不是边的 to 端）', () => {
  /**
   * 第一版把这两个搞混了,导致**入边的邻居被折叠**:
   * `Caller.m --calls--> Sub` 里邻居是 `Caller.m`(限定名,真符号),
   * 但边的 to 端是中心 `Sub`(裸名) → 按 to 端判就被判成未解析。
   */
  it('入边的邻居一律算解析出来了 —— from_name 总是分析器自己文件里的限定符号', () => {
    const r = rel('Caller.m', 'Sub', 'calls')
    expect(isResolvedTarget(r)).toBe(false)          // 边的 to 端(=中心)确实是裸名
    expect(isResolvedNeighbor('Caller.m', r)).toBe(true)   // 但邻居是真符号
  })

  it('出边的裸方法名目标仍然算未解析', () => {
    const r = rel('A.run', 'println', 'calls')
    expect(isResolvedNeighbor('println', r)).toBe(false)
  })
})

describe('egoGraph 布局', () => {
  const box = { width: 400, height: 260, maxNeighbors: 12 }

  it('中心节点在画布正中', () => {
    const g = egoGraph('Hello', [rel('Hello', 'Hello.main', 'contains', '/x/Hello.java')], box)
    expect(g.center.label).toBe('Hello')
    expect(g.center.x).toBe(200)
    expect(g.center.y).toBe(130)
  })

  it('邻居均匀分布在圆环上,且**确定性** —— 同输入同输出(否则测不了,也会每次重渲染乱跳)', () => {
    const rs = [rel('A', 'B.x', 'contains', '/f'), rel('A', 'C.y', 'contains', '/f'), rel('A', 'D.z', 'contains', '/f')]
    const g1 = egoGraph('A', rs, box)
    const g2 = egoGraph('A', rs, box)
    expect(g1.nodes.map((n) => [n.label, Math.round(n.x), Math.round(n.y)]))
      .toEqual(g2.nodes.map((n) => [n.label, Math.round(n.x), Math.round(n.y)]))
    expect(g1.nodes).toHaveLength(3)
  })

  it('节点全部落在画布内（含边距）—— 否则标签会被裁掉', () => {
    const rs = Array.from({ length: 10 }, (_, i) => rel('A', `N${i}.m`, 'contains', '/f'))
    for (const n of egoGraph('A', rs, box).nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(box.width)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(box.height)
    }
  })

  it('每条边连中心与对应邻居,并带上关系类型与方向', () => {
    const g = egoGraph('Sub', [
      rel('Sub', 'Base', 'extends'),
      rel('Caller.m', 'Sub', 'calls'),
    ], box)
    const out = g.nodes.find((n) => n.label === 'Base')!
    expect(out.direction).toBe('out')
    expect(out.relation).toBe('extends')
    const inc = g.nodes.find((n) => n.label === 'Caller.m')!
    expect(inc.direction).toBe('in')
    expect(g.edges).toHaveLength(2)
    for (const e of g.edges) {
      expect([e.x1, e.y1]).toEqual([g.center.x, g.center.y])
    }
  })

  it('**默认折叠未解析的调用目标,但把数目说出来** —— 不假装有调用图,也不偷偷丢 85% 的边', () => {
    const rs = [
      rel('A.run', 'B.go', 'calls'),
      rel('A.run', 'println', 'calls'),
      rel('A.run', 'get', 'calls'),
      rel('A.run', 'assertEquals', 'calls'),
    ]
    const g = egoGraph('A.run', rs, box)
    expect(g.nodes.map((n) => n.label)).toEqual(['B.go'])
    expect(g.hiddenUnresolved).toBe(3)
  })

  it('显式要求时也能把未解析的画出来', () => {
    const rs = [rel('A.run', 'println', 'calls'), rel('A.run', 'get', 'calls')]
    const g = egoGraph('A.run', rs, { ...box, showUnresolved: true })
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes.every((n) => n.resolved === false)).toBe(true)
    expect(g.hiddenUnresolved).toBe(0)
  })

  it('邻居过多时截断,并**报出截断量** —— 静默截断会被读成「就这么多」', () => {
    const rs = Array.from({ length: 40 }, (_, i) => rel('A', `N${i}.m`, 'contains', '/f'))
    const g = egoGraph('A', rs, box)
    expect(g.nodes).toHaveLength(12)
    expect(g.truncated).toBe(28)
  })

  it('截断时保留**度数高的、以及类型层次那类边** —— 不是随手取前 12 个', () => {
    const rs = [
      ...Array.from({ length: 20 }, (_, i) => rel('A', `M${i}.m`, 'contains', '/f')),
      rel('A', 'BaseClass', 'extends'),
      rel('A', 'SomeInterface', 'implements'),
    ]
    const g = egoGraph('A', rs, { ...box, maxNeighbors: 5 })
    const kinds = g.nodes.map((n) => n.relation)
    expect(kinds).toContain('extends')
    expect(kinds).toContain('implements')
  })

  it('同一个邻居出现多次(既 extends 又 calls)只画一个节点', () => {
    const g = egoGraph('A', [rel('A', 'B', 'extends'), rel('A', 'B.m', 'contains', '/f'), rel('A', 'B', 'implements')], box)
    expect(g.nodes.filter((n) => n.label === 'B')).toHaveLength(1)
  })

  it('空关系表返回空图,不抛', () => {
    const g = egoGraph('A', [], box)
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.center.label).toBe('A')
  })

  it('每类关系一个主题令牌类名 —— 不许写死调色板色阶', () => {
    const palette = /-(?:emerald|amber|red|green|yellow|slate|gray|zinc|blue|sky)-\d{2,3}\b/
    const g = egoGraph('A', [
      rel('A', 'B', 'extends'), rel('A', 'C', 'implements'),
      rel('A', 'A.m', 'contains', '/f'), rel('A.m', 'D.n', 'calls'),
    ], box)
    for (const e of g.edges) expect(e.className, e.type).not.toMatch(palette)
    for (const n of g.nodes) expect(n.className, n.label).not.toMatch(palette)
  })

  it('长标签要截短 —— 全限定方法签名会把图撑爆', () => {
    const long = 'SomeVeryLongClassName.someExtremelyLongMethodName(WithParameters, AndMore)'
    const g = egoGraph('A', [rel('A', long, 'contains', '/f')], box)
    expect(g.nodes[0].short.length).toBeLessThanOrEqual(24)
    expect(g.nodes[0].label).toBe(long)   // 完整名仍留着(tooltip / 点击导航用)
  })
})
