# 桌面 RAG 检索 + 代码图谱 + Embedding 后端配置(roadmap #2 & #3)

**日期:** 2026-07-11 **状态:** 设计定稿(基于全量 API 取证) **依赖:** roadmap #2 #3

## 目标

打通桌面的语义代码检索(#2)与代码关系图谱(#3)。二者都需 embedding 后端 —— 故先补**可配置的 embedding 后端**(存 config、app-server 内直接读,免 env / 免重启),再加 RAG/graph RPC + 面板。

## 后端事实基线(已核验)

- Embedding:`EmbeddingClient` 默认 Ollama(`nomic-embed-text` @ `localhost:11434`),可切 openai/zhipu/glm(OpenAI 兼容,zhipu 默认 `https://open.bigmodel.cn/api/paas/v4`)。4-arg 构造 `(provider, model, baseUrl, apiKey)`。
- 存储:SQLite `~/.wraith/rag/codebase.db`;向量 JSON 存 TEXT,**内存算余弦** + 关键词混合。表 `code_chunks` + `code_relations`。
- `CodeIndex(EmbeddingClient, ProgressListener).index(path) → IndexResult(chunkCount, relationCount, message)`;`ProgressListener.onProgress(String)`。
- `CodeRetriever(projectPath, EmbeddingClient)`:`hybridSearch(q, topK) → List<SearchResult(filePath, chunkType, name, content, double similarity)>`;`getRelationGraph(name) → List<CodeRelation(fromFile, fromName, toFile, toName, relationType)>`;`getStats() → IndexStats(chunkCount, relationCount)`;`close()`。
- WraithConfig:`SttConfig` 式嵌套类 + get/set + `load()`/`save()`。app-server lambda 有 `writer`/`root`(workspace)/`agent`。
- app-server 有 `dispatchAsync`(browser 死锁修复引入)→ 复用于长索引。

## 设计

### A. Embedding 后端配置(基础)

1. `WraithConfig.EmbeddingConfig { provider, model, baseUrl, apiKey }` + getEmbedding/setEmbedding(仿 SttConfig)。
2. `EmbeddingClient.of(provider, model, baseUrl, apiKey)` 静态工厂:空则填默认(provider→ollama;model/baseUrl 按 provider 默认——ollama: nomic-embed-text/11434,zhipu: embedding-2/bigmodel,openai: text-embedding-3-small/api.openai.com)。索引/检索统一用它,读 WraithConfig。
3. RPC `config.getEmbedding` → `{provider, model, baseUrl, hasKey}`(**key 不回**);`config.setEmbedding {provider, model, baseUrl, apiKey}` → 写 config(apiKey 空=保留旧)。密钥红线:key 只进 config.json,不回包/不日志。

### B. RAG / graph RPC(均针对当前会话 workspace 的 projectPath)

| method | 异步 | result |
|---|---|---|
| `rag.status` | 否 | `{ indexed, chunkCount, relationCount }` |
| `rag.index` | **是(dispatchAsync)** | `{ chunkCount, relationCount, message }` 或 `{ error }` |
| `rag.search` `{query, topK?}` | 否(查询含 1 次 embedding,快) | `{ results: [{filePath, chunkType, name, content(截断 500), similarity}] }` |
| `rag.graph` `{name}` | 否 | `{ relations: [{fromName, toName, relationType, fromFile, toFile}] }` |

- index 用 `EmbeddingClient.of(config)`;完成后 `getToolRegistry().setProjectPath(projectPath)`(确保 search_code 工具同库)。
- embedding 端点不可达 → CodeIndex/hybridSearch 抛异常 → RPC 返回 `{error: e.getClass().getSimpleName()}`,面板提示「检查 embedding 配置/后端」。
- **实现**:Session 接口 + dispatch(index 走 dispatchAsync)+ Main.java 匿名类;CodeRetriever try-with-resources(AutoCloseable)。

### C. 桌面

- 侧栏「工具」组新增「**代码检索**」(lucide `ScanSearch`);`RagPanel.tsx` 四段:
  1. **Embedding 后端**:provider 下拉(ollama/openai/zhipu)+ model + baseUrl + apiKey(密码,占位「留空=保留」)+ 保存。占位/默认提示由纯函数给。
  2. **索引**:状态(已索引 N 块 · M 关系 / 未索引)+ [建立/重建索引](busy 转圈,「大库可能数分钟」)。
  3. **检索**:搜索框 → 结果卡(file:name · score + 代码片段)。
  4. **图谱**:类名输入 → 关系列表(from ─[type]→ to)。
- IPC×6 + preload×6 + shared 类型(EmbeddingConfigView / RagStatus / RagSearchResult / RagGraphResult 等)。
- 纯函数 `ragView.ts`:`embeddingDefaults(provider) → {model, baseUrl}`(与后端 of() 对齐,供表单占位)+ 单测。

## 索引进度

本切片**不推进度事件**(dispatchAsync 已避免阻塞其它 RPC;面板转圈 + 完成回填状态)。进度事件留作后续增强。

## 测试隔离铁律

RAG RPC 会写 SQLite 索引库 + config;Java 侧不写触碰真实库/config 的单测,靠 mvn package + 眼验。桌面纯函数(ragView)走 vitest。密钥红线:setEmbedding 的 key 只落 config,getEmbedding 只回 hasKey。

## 验证

`mvn -q clean package` ✓ + 同步 `~/.wraith/wraith.jar` · typecheck · vitest 全绿 · build ✓ · 红线 CLEAN。手动:桌面重启 → 「代码检索」→ 配 embedding(本地 Ollama 或 zhipu key)→ 建索引 → 搜索 / 图谱。
