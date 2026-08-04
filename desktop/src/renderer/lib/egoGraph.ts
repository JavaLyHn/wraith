import type { RagRelation } from '../../shared/types'

/**
 * 「点一个类 → 看它的邻居」的辐射布局（ego graph / 1 跳邻域）。
 *
 * 数据来自 `rag.graph {name}`（后端 `WHERE from_name=? OR to_name=?`，一跳，无递归）。
 *
 * <b>为什么不画「全图」</b>：wraith 自身索引有 55091 条边，画出来是一团毛线。
 * 而且按度数取 Top-K 也不行 —— 实测度数榜前列是
 * `file 2692 / assertEquals 2440 / get 1753 / append 1305`，全是 JDK 方法名与断言，
 * 那不是代码结构，是方法名词频统计。所以只画<b>以一个符号为中心的一跳</b>。
 *
 * <b>一个必须摆在明面上的数据事实</b>（量过的）：边的构成是
 * `calls 46630（85%）/ contains 5613 / imports 2687 / implements 99 / extends 62`，
 * 而 <b>`calls` 的目标 100% 是裸方法名</b>（`Hello.main → println`；含点的限定名 <b>0 条</b>）——
 * `CodeAnalyzer` 抽调用边时不做符号解析，于是任何 `.get()` 都指向同一个叫 `get` 的假节点。
 * 处理办法：<b>默认折叠这类目标，但把数目说出来</b> —— 既不假装我们有调用图，
 * 也不偷偷把 85% 的边扔掉不提。
 */

export interface EgoNode {
  id: string
  label: string
  /** 截短后的显示名（全限定签名会把图撑爆）。 */
  short: string
  x: number
  y: number
  relation: string
  direction: 'in' | 'out'
  resolved: boolean
  className: string
}

export interface EgoEdge {
  x1: number; y1: number; x2: number; y2: number
  type: string
  className: string
  dashed: boolean
}

export interface EgoGraph {
  center: { label: string; short: string; x: number; y: number }
  nodes: EgoNode[]
  edges: EgoEdge[]
  /** 因未解析而折叠掉的邻居数（默认行为）。 */
  hiddenUnresolved: number
  /** 因超过 maxNeighbors 而截断掉的邻居数。 */
  truncated: number
}

/**
 * 这条边的目标算「解析出来了」吗。
 *
 * 三种算：① 带 `toFile`（`contains` 100% 有）；② 名字是限定名（含 `.`）；
 * ③ <b>`extends` / `implements`</b> —— 它们的 `toFile` 实测都是空，但目标是真类型名
 * （`BaseService`、`LlmClient`），不是裸方法名。把它们当未解析折叠掉会把最有用的边藏起来。
 */
export function isResolvedTarget(r: RagRelation): boolean {
  if (r.toFile && r.toFile.trim() !== '') return true
  if ((r.toName ?? '').includes('.')) return true
  return r.relationType === 'extends' || r.relationType === 'implements'
}

/**
 * 这个<b>邻居节点</b>算解析出来了吗。布局用的是这个，不是上面那个。
 *
 * <b>区别很关键，第一版就写错了</b>：上面那个判的是「边的 `to` 端」。可对<b>入边</b>来说，
 * 邻居是 `from` 端，而 `to` 端是中心自己 —— 于是
 * `Caller.m --calls--> Sub` 里的 `Caller.m`（明明是限定名）会被判成未解析而折叠掉。
 *
 * 真实规律：<b>不可解析的只有「出边的 `calls` / `imports` 目标」</b>。
 * `from_name` 一侧总是分析器自己文件里的限定符号（`Hello.main`），所以入边一律算解析出来了。
 */
export function isResolvedNeighbor(name: string, r: RagRelation): boolean {
  if (name.includes('.')) return true
  if (r.relationType === 'extends' || r.relationType === 'implements') return true
  // 邻居在 from 一侧(入边):那是真符号
  if (r.fromName === name) return true
  return !!(r.toFile && r.toFile.trim() !== '')
}

/** 关系类型的画法。颜色走主题令牌 —— 写死调色板色阶只在一种主题下可读。 */
const STYLE: Record<string, { node: string; edge: string; dashed: boolean }> = {
  extends: { node: 'fill-accent', edge: 'stroke-accent', dashed: false },
  implements: { node: 'fill-accent', edge: 'stroke-accent', dashed: true },
  contains: { node: 'fill-fg-muted', edge: 'stroke-border', dashed: false },
  imports: { node: 'fill-fg-subtle', edge: 'stroke-border', dashed: true },
  calls: { node: 'fill-warn', edge: 'stroke-warn/60', dashed: false },
}
const FALLBACK = { node: 'fill-fg-subtle', edge: 'stroke-border', dashed: true }
const styleOf = (t: string) => STYLE[t] ?? FALLBACK

/** 截断优先级：类型层次 > 结构包含 > 其它。截断时先保住最有信息量的边。 */
const PRIORITY: Record<string, number> = { extends: 0, implements: 1, contains: 2, imports: 3, calls: 4 }

const MAX_LABEL = 24
function shorten(name: string): string {
  if (name.length <= MAX_LABEL) return name
  // 优先砍参数列表,再从左边砍包名式前缀 —— 尾部(方法名)信息量最大
  const noArgs = name.replace(/\(.*$/, '')
  if (noArgs.length <= MAX_LABEL) return noArgs
  return '…' + noArgs.slice(-(MAX_LABEL - 1))
}

export interface EgoOptions {
  width: number
  height: number
  maxNeighbors: number
  showUnresolved?: boolean
}

/**
 * 布局：中心一个点，邻居均匀铺在椭圆环上。
 *
 * <b>确定性</b>：角度只由「排序后的序号」决定，不用随机 —— 否则每次重渲染节点会乱跳，
 * 也没法写测试。
 */
export function egoGraph(centerName: string, relations: RagRelation[], opt: EgoOptions): EgoGraph {
  const cx = opt.width / 2
  const cy = opt.height / 2
  const center = { label: centerName, short: shorten(centerName), x: cx, y: cy }

  // 一跳邻居去重:同一个名字既 extends 又 contains 时只留优先级最高的那条关系
  const byName = new Map<string, { rel: RagRelation; dir: 'in' | 'out' }>()
  for (const r of relations) {
    const isOut = r.fromName === centerName
    const other = isOut ? r.toName : r.fromName
    if (!other || other === centerName) continue
    const prev = byName.get(other)
    if (!prev || PRIORITY[r.relationType] < PRIORITY[prev.rel.relationType]) {
      byName.set(other, { rel: r, dir: isOut ? 'out' : 'in' })
    }
  }

  let entries = [...byName.entries()]
  let hiddenUnresolved = 0
  if (!opt.showUnresolved) {
    const before = entries.length
    entries = entries.filter(([name, v]) => isResolvedNeighbor(name, v.rel))
    hiddenUnresolved = before - entries.length
  }

  // 排序:先按关系优先级(截断时保住类型层次),同级按名字保证确定性
  entries.sort((a, b) => {
    const pa = PRIORITY[a[1].rel.relationType] ?? 9
    const pb = PRIORITY[b[1].rel.relationType] ?? 9
    return pa !== pb ? pa - pb : a[0].localeCompare(b[0])
  })
  const truncated = Math.max(0, entries.length - opt.maxNeighbors)
  entries = entries.slice(0, opt.maxNeighbors)

  const pad = 46                          // 给标签留的边距
  const rx = Math.max(20, cx - pad)
  const ry = Math.max(16, cy - pad / 2)
  const nodes: EgoNode[] = entries.map(([name, v], i) => {
    // 从正上方开始顺时针铺;-π/2 让第一个节点在 12 点方向
    const a = (2 * Math.PI * i) / entries.length - Math.PI / 2
    const st = styleOf(v.rel.relationType)
    return {
      id: name,
      label: name,
      short: shorten(name),
      x: cx + rx * Math.cos(a),
      y: cy + ry * Math.sin(a),
      relation: v.rel.relationType,
      direction: v.dir,
      resolved: isResolvedNeighbor(name, v.rel),
      className: st.node,
    }
  })

  const edges: EgoEdge[] = nodes.map((n) => {
    const st = styleOf(n.relation)
    return { x1: cx, y1: cy, x2: n.x, y2: n.y, type: n.relation, className: st.edge, dashed: st.dashed }
  })

  return { center, nodes, edges, hiddenUnresolved, truncated }
}
