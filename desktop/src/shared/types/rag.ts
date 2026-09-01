/** Embedding config, RAG status/index/search/graph, search, git, pricing. */

export interface EmbeddingConfigView {
  provider: string
  model: string
  baseUrl: string
  hasKey: boolean
}

/**
 * 索引范围设置（`config.getRagScope` / `config.setRagScope`）。
 *
 * 两个开关**效果方向相反，实测**（24 条冻结查询集，`scripts/rag-eval/`）：
 * 排除测试 MRR +24%（好 10 差 1）；排除文档 MRR −24%（好 1 差 4）。
 * 所以分开而不合并；默认都关（行为不变）。
 */
export interface RagScopeView {
  excludeTests: boolean
  excludeDocs: boolean
}

/**
 * 「测试连接」的回包（`config.testEmbedding` / 后端 `EmbeddingProbe`）。
 *
 * 除 `ok` 外全是可选的：字段随成败而不同，而桌面端还可能跑在旧 jar 上。
 * `error` 是**原文**，`hint` 是可行动诊断 —— 两个字段，界面上都要显示。
 * 回包里**绝不含 apiKey**（后端会把它从错误原文里抹掉）。
 */
export interface EmbeddingTestResult {
  ok: boolean
  /** 向量维度 = 后端回的向量真实长度。与索引维度不一致时检索会报错。 */
  dim?: number
  latencyMs?: number
  /** 实际生效的那套（表单留空时后端会填默认值），不是表单里那套。 */
  provider?: string
  model?: string
  baseUrl?: string
  /** 与已有索引不兼容时的提示（维度不同 / 同维度不同模型）。 */
  warning?: string
  /** 失败原文，一个字都不改。 */
  error?: string
  /** 失败的可行动诊断；后端说不出话时这个字段不出现。 */
  hint?: string
}

/**
 * 搜索后端的实时状态（`config.getSearch` 回包）。
 *
 * 只读状态查询，**不含任何 key**。后端问的是 agent 真正会用的那个 SearchProvider 对象，
 * 所以面板不会出现「面板说就绪、agent 说未配置」这种分裂。
 */
export interface SearchStatusView {
  /** zhipu / serpapi / searxng / duckduckgo / unconfigured —— **实际生效**的那个 */
  provider: string
  ready: boolean
  /**
   * 已存配置里有没有 key。**永远只是布尔，不含 key 本身。**
   *
   * 表单要能区分「没配过」和「配过但不给看」—— 否则输入框显示成空的，
   * 用户以为清空了，一保存就把好 key 覆盖没了。
   */
  hasKey?: boolean
  /** 已存的实例地址（SearXNG 用）。不是密钥，可以回显，否则改端口要重打一遍 */
  baseUrl?: string
  /**
   * 已存配置里写的那个 provider —— 可能与 `provider` 不同（环境变量优先级更高）。
   * 表单靠它判断「那个 hasKey 属不属于我现在选的这家」。
   */
  savedProvider?: string
}

/** porcelain v2 的一条变更记录。 */
export interface GitFileEntry {
  path: string
  /** 两字符 XY：X=暂存区相对 HEAD，Y=工作区相对暂存区。 */
  xy: string
  staged: boolean
}

export interface GitRemote {
  name: string
  url: string
}

/**
 * 用户真实仓库的只读状态；与 Side-Git 快照刻意分开。
 *
 * null 与 error 都是有意义的后端状态，不能补成空串或“干净”，否则 renderer 会误报。
 */
export interface GitStatusView {
  repo: boolean
  root: string | null
  name: string | null
  state: string | null
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  insertions: number
  deletions: number
  untracked: number
  filesTotal: number
  files: GitFileEntry[]
  remotes: GitRemote[]
  error: string | null
}

/**
 * 快照开关状态（`snapshot.settings` 回包）。
 *
 * 取值链是 环境变量 → 系统属性 → config.json → 默认开，所以按钮**可能压不过前两层**。
 * `locked` 为真时面板要如实说明，而不是让用户点了没反应。
 */
export interface SnapshotSettingsView {
  enabled: boolean
  /** 这个值是谁决定的 */
  source: 'env' | 'property' | 'config' | 'default'
  /** 被 env / 系统属性压住了 —— 写盘改不了下次启动的结果 */
  locked: boolean
  /** 后端有没有快照服务（没有时开关无意义） */
  available: boolean
}

/** 搜索后端「测试连接」的结果（`config.testSearch` 回包）。不含任何 key。 */
export interface SearchTestResult {
  ok: boolean
  provider?: string
  /** 拿到几条结果。0 条**算失败** —— 连得上但搜不出东西，对用户没区别 */
  results?: number
  latencyMs?: number
  /** 第一条结果的标题，用来一眼确认「搜到的是真东西」 */
  sample?: string
  /** 失败原文（key 已抹除）。「连不上」「401」「429」是三件不同的事，不合并成一句 */
  error?: string
}

/** 一条模型计价。seeded=内置种子（不可编辑）；价格单位是「每百万 token」。 */
export interface PricingEntryView {
  modelPrefix: string
  cacheHitPerM: number
  cacheMissPerM: number
  outputPerM: number
  currency: string
  seeded?: boolean
}

export interface PricingListResult {
  entries: PricingEntryView[]
}

export interface RagStatus {
  indexed: boolean
  chunkCount: number
  relationCount: number
  /**
   * 建这份索引时用的 embedding 模型。**老索引没记过 → 缺省**（不是空串），
   * 前端据此显示「未知」而不是编一个默认模型名。
   *
   * 用途:换了模型却没重建索引时,检索会安静地返回一堆 0 分结果 —— 面板要靠这个字段
   * 在「保存 Embedding 配置」那一刻就提示重建,而不是等用户搜出一堆无关结果。
   */
  embeddingModel?: string
  embeddingDim?: number
  /**
   * 这份索引**建时**的范围设置。老索引没记过 → 两个字段都缺省，
   * 前端据此**不比较、不猜**（宁可漏报，也不要对一份可能没问题的索引喊「快重建」）。
   */
  indexExcludeTests?: boolean
  indexExcludeDocs?: boolean
  /** **当前**配置里的范围设置（用于与上面两个比对，得出「范围不符」）。 */
  excludeTests?: boolean
  excludeDocs?: boolean
  error?: string
}

export interface RagIndexResult {
  chunkCount?: number
  relationCount?: number
  message?: string
  error?: string
  /** >0 表示索引残缺:这些代码块向量化失败,搜不到 */
  failedChunks?: number
  failedFiles?: number
  /** 扫到并索引的文件数。面板据此说明「索引了什么」,而不是只报块数。 */
  fileCount?: number
  /**
   * 其中 `.java` 文件数。
   *
   * **关系图谱只从 `.java` 提取**,所以非 Java 项目必然是 0 关系 —— 面板要靠这个字段
   * 把「0 关系」解释成正常现象,而不是让用户以为索引失败了。
   */
  javaFileCount?: number
  elapsedMs?: number
  /** 本次索引实际用的 embedding 模型(与 rag.status 的 embeddingModel 同源)。 */
  embeddingModel?: string
  /**
   * 被范围设置排掉的文件数。**必须显示** —— 打开开关后块数会明显下降
   * （实测 wraith 自身排除测试后 9718→6283 块），不说的话用户会以为索引出错了。
   */
  excludedTests?: number
  excludedDocs?: number
}

export interface RagSearchItem {
  filePath: string
  chunkType: string
  name: string
  content: string
  similarity: number
}

export interface RagSearchResult {
  results: RagSearchItem[]
  error?: string
}

export interface RagRelation {
  fromName: string
  toName: string
  relationType: string
  fromFile: string
  toFile: string
}

export interface RagGraphResult {
  relations: RagRelation[]
  error?: string
}
