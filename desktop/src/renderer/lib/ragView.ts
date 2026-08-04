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
