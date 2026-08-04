import type { RagIndexResult } from '../../shared/types'

/**
 * 建索引的可视化。用户原话：「没有清晰的图表示出来」。
 *
 * 改之前是一行纯文本 `进度 7% 500/6293 块 · 刚完成 paths.ts` —— 有百分比没有条，
 * 而且**没有 ETA**：这个库实测 14 分 29 秒，只给「7%」等于让人干等。
 */

export type IndexPhase = 'scanning' | 'chunking' | 'embedding' | 'persisting' | 'done'

export interface IndexProgress {
  phase: IndexPhase
  /** 只有向量化阶段有这三个；前置阶段**缺省**（不是 0 —— 0 会让条从满格或空格开始） */
  done?: number
  total?: number
  percent?: number
  file?: string
}

/** 后端消息里的向量化进度行：`   进度 7%  500/6293 块 · 刚完成 paths.ts` */
const PROGRESS_RE = /进度\s+(\d+)%\s+(\d+)\s*\/\s*(\d+)\s*块\s*·\s*刚完成\s*(.+?)\s*$/

/**
 * 从后端消息解析进度。
 *
 * <b>这是个有意识的耦合，不是偷懒</b>：`rag.index.progress` 事件目前只带一个
 * `message` 字符串（`CodeIndex.ProgressListener` 的签名就是 `String`），
 * 要拿到结构化进度只有两条路 —— 改那个接口（波及 CLI 与一批调用点），
 * 或者在这里解析显示串。选了后者。
 *
 * <b>代价与它的对冲</b>：改进度文案会静默打坏进度条。所以 Java 侧有
 * `IndexProgressDetailTest#progressLineShapeIsParsedByDesktop` 钉住这一行的形状，
 * 并在注释里指向本文件 —— 改文案会让那条测试变红。
 * 真正的修法（给事件加结构化字段）记在
 * `docs/superpowers/plans/2026-08-04-rag-retrieval-backlog.md`。
 *
 * 认不出来时返回 `null`（不猜）。
 */
export function parseIndexProgress(message: string): IndexProgress | null {
  if (!message) return null
  const m = PROGRESS_RE.exec(message)
  if (m) {
    return {
      phase: 'embedding',
      percent: Number(m[1]),
      done: Number(m[2]),
      total: Number(m[3]),
      file: m[4],
    }
  }
  if (message.includes('开始索引') || message.includes('个文件待索引')) return { phase: 'scanning' }
  if (message.includes('开始向量化') || message.includes('切出')) return { phase: 'chunking' }
  if (message.includes('索引完成')) return { phase: 'done' }
  return null
}

const PHASE_LABEL: Record<IndexPhase, string> = {
  scanning: '扫描文件',
  chunking: '分块与关系分析',
  embedding: '向量化',
  persisting: '写入索引库',
  done: '完成',
}

export interface IndexProgressView {
  phaseLabel: string
  /** 条宽百分比；`null` = 不确定态（前置阶段没有总数） */
  barPercent: number | null
  indeterminate: boolean
  /** 剩余时间；样本不足时为 `null`（见下） */
  etaText: string | null
  rateText: string | null
  elapsedText: string
  detail: string | null
}

/** 给 ETA 的最低样本门槛。低于此不出数字。 */
const MIN_DONE_FOR_ETA = 30
const MIN_PERCENT_FOR_ETA = 2
const MIN_ELAPSED_MS_FOR_ETA = 3_000

function human(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`
}

/**
 * 条宽 + ETA + 速率。
 *
 * **ETA 由渲染层自己计时**（后端不带时间）：`速率 = done / 已用秒`，`ETA = 剩余 / 速率`。
 *
 * **样本不足时返回 `null` 而不是一个数字**：前 1% 算出来的 ETA 抖动能到几倍，
 * 给一个错的剩余时间比不给更糟 —— 用户会按它安排自己的时间。门槛是
 * `done ≥ 30 且 percent ≥ 2 且 已用 ≥ 3 秒`，三个都要满足。
 * 在此之前只显示「已用时长」，那是唯一诚实的信息。
 */
export function indexProgressView(p: IndexProgress & {
  startedAtMs: number; nowMs: number
}): IndexProgressView {
  const elapsedMs = Math.max(0, p.nowMs - p.startedAtMs)
  const hasTotal = typeof p.total === 'number' && p.total > 0
  const barPercent = typeof p.percent === 'number'
    ? Math.max(0, Math.min(100, p.percent))
    : null

  let etaText: string | null = null
  let rateText: string | null = null
  if (hasTotal && typeof p.done === 'number' && p.done >= MIN_DONE_FOR_ETA
      && (p.percent ?? 0) >= MIN_PERCENT_FOR_ETA && elapsedMs >= MIN_ELAPSED_MS_FOR_ETA) {
    const rate = p.done / (elapsedMs / 1000)
    if (rate > 0) {
      rateText = `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)} 块/秒`
      etaText = human(Math.max(0, (p.total! - p.done) / rate))
    }
  }

  return {
    phaseLabel: PHASE_LABEL[p.phase],
    barPercent,
    indeterminate: barPercent === null,
    etaText,
    rateText,
    elapsedText: human(elapsedMs / 1000),
    detail: hasTotal && typeof p.done === 'number' ? `${p.done} / ${p.total} 块` : null,
  }
}

export interface CompositionBar {
  label: string
  count: number
  pct: number
  /** 主题令牌类名。**不许写死 Tailwind 调色板色阶** —— 那种颜色只在一种主题下可读。 */
  className: string
}

/**
 * 建完之后的构成条：已索引的文件 vs 按范围排掉的。
 *
 * 这是**把范围开关的效果画出来**的地方 —— 光看「6283 块」看不出「排掉了 482 个测试文件」。
 * 计数为 0 的段整段不出现（不画宽度为 0 的色块）；老后端不回这些字段时返回空数组，
 * 面板据此整块不渲染（而不是画一条空条）。
 */
export function indexCompositionBars(r: RagIndexResult): CompositionBar[] {
  const indexed = r.fileCount
  if (typeof indexed !== 'number') return []
  const tests = r.excludedTests ?? 0
  const docs = r.excludedDocs ?? 0
  const total = indexed + tests + docs
  if (total <= 0) return []
  const seg = (label: string, count: number, className: string): CompositionBar | null =>
    count > 0 ? { label, count, pct: (100 * count) / total, className } : null
  return [
    seg(`已索引 ${indexed} 个文件`, indexed, 'bg-accent'),
    seg(`排除测试 ${tests}`, tests, 'bg-warn/70'),
    seg(`排除文档 ${docs}`, docs, 'bg-fg-subtle/60'),
  ].filter((x): x is CompositionBar => x !== null)
}
