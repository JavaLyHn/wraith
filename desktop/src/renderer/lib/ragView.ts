import type { RagStatus, RagIndexResult } from '../../shared/types'

/** RAG embedding 后端的每 provider 默认(与后端 EmbeddingClient.of 对齐,供表单占位)。 */
export function embeddingDefaults(provider: string): { model: string; baseUrl: string } {
  switch ((provider || '').toLowerCase()) {
    case 'zhipu':
    case 'glm':
      return { model: 'embedding-2', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }
    case 'openai':
      return { model: 'text-embedding-3-small', baseUrl: 'https://api.openai.com/v1' }
    default: // ollama 及未知
      return { model: 'nomic-embed-text:latest', baseUrl: 'http://localhost:11434' }
  }
}

/**
 * 「索引是旧模型建的」提示。返回 `null` 表示不必提示。
 *
 * 换了 embedding 模型却没重建索引时，检索会**安静地返回一堆 0 分结果**
 * （实测:768 维索引 + 1024 维查询 = 3 条结果、相关度全 0.0000、不报错）。
 * 检索时抛错是兜底，但那已经晚了 —— 雷是在「保存 Embedding 配置」那一刻埋下的。
 *
 * 判据只有一条:**索引记录的模型 ≠ 当前配置的模型**。老索引没记过模型时不提示 ——
 * 不知道就说不知道，宁可漏报也不要对着一份可能没问题的索引喊「快重建」。
 */
export function staleIndexWarning(
  status: { indexed: boolean; embeddingModel?: string } | null,
  currentModel: string,
): string | null {
  if (!status || !status.indexed) return null
  const indexed = (status.embeddingModel ?? '').trim()
  const current = (currentModel ?? '').trim()
  // 任一侧未知就无从比较:老索引没记过 / 配置里 model 留空(用后端默认)
  if (!indexed || !current) return null
  // ollama 的 tag 不区分大小写;首尾空格更不该逼人重建整库
  if (indexed.toLowerCase() === current.toLowerCase()) return null
  return `索引是用 ${indexed} 建的，当前 Embedding 模型是 ${current}。`
    + `不同模型的向量维度不同 —— 不重建索引就检索，相关度会全为 0（等于搜不到）。请点「重建索引」。`
}

/** 毫秒 → 人读的时长。 */
function humanMs(ms: number): string {
  if (ms < 1000) return `${ms} 毫秒`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分 ${s % 60} 秒`
}

/**
 * 建完索引后的明细行。
 *
 * 用户实测:建完只剩「已索引 326 块 · 0 关系」——「没有结果展示」。这里把 rag.index 的回包
 * 摊成几行看得懂的东西。**缺的字段整行不出现**（老后端不回这些字段），
 * 绝不显示「文件 undefined 个」。
 */
export function indexSummaryLines(r: {
  chunkCount?: number; relationCount?: number; fileCount?: number
  javaFileCount?: number; elapsedMs?: number; embeddingModel?: string
  failedChunks?: number; failedFiles?: number
}): string[] {
  const lines: string[] = []
  if (typeof r.fileCount === 'number') lines.push(`扫描文件 ${r.fileCount} 个`)
  if (typeof r.chunkCount === 'number') lines.push(`切出代码块 ${r.chunkCount} 个`)
  if (typeof r.relationCount === 'number') lines.push(`代码关系 ${r.relationCount} 条`)
  if (r.embeddingModel) lines.push(`向量化模型 ${r.embeddingModel}`)
  if (typeof r.elapsedMs === 'number' && r.elapsedMs > 0) lines.push(`耗时 ${humanMs(r.elapsedMs)}`)
  if ((r.failedChunks ?? 0) > 0) {
    lines.push(`⚠ ${r.failedChunks} 个代码块向量化失败`
      + (typeof r.failedFiles === 'number' ? `（涉及 ${r.failedFiles} 个文件）` : '')
      + ' —— 这些代码搜不到，建议重试')
  }
  return lines
}

/**
 * 「0 关系」要不要解释、怎么解释。返回 `null` = 不必解释。
 *
 * **关系图谱只从 `.java` 提取**（`CodeIndex` 里 `endsWith(".java")` 那一句），
 * 所以非 Java 项目必然是 0 —— 那是正常现象。但**有** Java 文件却仍然 0 关系，
 * 那才是异常，得说成异常，不能被上一句借口盖过去。
 *
 * `javaFileCount` 未知（老后端）时不猜、不解释。
 */
export function relationHint(r: {
  relationCount?: number; javaFileCount?: number
}): string | null {
  if (typeof r.relationCount !== 'number' || r.relationCount > 0) return null
  if (typeof r.javaFileCount !== 'number') return null
  if (r.javaFileCount === 0) {
    return '关系图谱目前只从 .java 文件提取，本次没有扫到 Java 文件 —— 所以 0 条关系是正常的，'
      + '语义检索不受影响。'
  }
  return `扫到了 ${r.javaFileCount} 个 Java 文件却没有解析出任何关系，这不正常 —— `
    + '可能是解析失败（进度里应有「分块失败」字样），建议重试或查看日志。'
}

/**
 * 「索引是在不同范围设置下建的」提示。返回 `null` = 不必提示。
 *
 * **这是范围开关最容易漏的一环**：范围变了但 embedding 模型没变时，已有的
 * `staleIndexWarning`（比模型）与后端 `EmbeddingProbe.compatibilityWarning`（比模型/维度）
 * **都不会响**。用户打开「排除测试」却没重建，索引里测试还在、检索照样返回测试，
 * 而界面一个字都不说 —— 本仓库第 9 次 snapshot-vs-live，只不过陈旧的是「范围」不是「模型」。
 *
 * 判据与模型比较同一条纪律：**任一侧未知就不比较**。老索引没记过范围
 * （`indexExclude*` 缺省）时不提示 —— 宁可漏报，也不要对着一份可能没问题的索引喊「快重建」。
 */
export function scopeMismatchWarning(status: RagStatus | null): string | null {
  if (!status || !status.indexed) return null
  const parts: string[] = []
  if (typeof status.indexExcludeTests === 'boolean'
      && status.indexExcludeTests !== !!status.excludeTests) {
    parts.push(status.excludeTests
      ? '当前设置要排除测试，但这份索引里含测试'
      : '当前设置要包含测试，但这份索引建时排除了测试')
  }
  if (typeof status.indexExcludeDocs === 'boolean'
      && status.indexExcludeDocs !== !!status.excludeDocs) {
    parts.push(status.excludeDocs
      ? '当前设置要排除文档，但这份索引里含文档'
      : '当前设置要包含文档，但这份索引建时排除了文档')
  }
  if (parts.length === 0) return null
  return parts.join('；') + '。检索结果会与设置不符 —— 请点「重建索引」。'
}

/**
 * 范围开关的效果说明（表单下面那行小字）。
 *
 * **必须带实测数字**：两个开关的效果**方向相反**，只写「可能影响检索质量」会让人
 * 误以为「都勾上更干净」。数字来自 24 条冻结查询集（`scripts/rag-eval/`）。
 */
export function scopeEffectNote(): string {
  return '实测（24 条查询集）：排除测试 MRR +24%（检索质量明显变好）；'
    + '排除文档 MRR −24%（变差——「为什么这么设计」类问题的答案只在 docs 里，'
    + '这个开关适合「只想省索引时间/磁盘」）。改完需要点「重建索引」才生效。'
}

/**
 * 「本次索引按范围排除了多少」的一行。返回 `null` = 没排除任何东西，整行不出现。
 *
 * 不报的话，用户看到块数从 9718 掉到 6283 会以为索引出错了。
 */
export function scopeSummaryLine(r: RagIndexResult): string | null {
  const t = r.excludedTests ?? 0
  const d = r.excludedDocs ?? 0
  if (t + d === 0) return null
  const bits: string[] = []
  if (t > 0) bits.push(`${t} 个测试文件`)
  if (d > 0) bits.push(`${d} 个文档文件`)
  return `按范围设置排除 ${bits.join('、')}`
}
