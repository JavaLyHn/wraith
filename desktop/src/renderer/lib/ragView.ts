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
