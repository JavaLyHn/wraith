# Embedding「测试连接」：验一个后端不该要跑一遍整库索引

**日期:** 2026-08-04 **状态:** 已实现（`6f1261b`，`feat/windows-parity-block1`，未 merge 未 push）

> **这是补记，不是事前规格。** 实现先落地，本文随后补上 —— 用户在实现完成后要求补一份纸面记录。
> 所以下文的「设计」全部是**已经这么做了**的决定与理由，不是待实施的方案；
> §5 的数字是真实跑出来的，§6 是真的没验。把它写成事前规格的样子就是伪造纸面记录，
> 那比没有文档更糟。

---

## 1. 起因

用户在「代码检索」面板截图上直接说：「加一个测试连接功能吧」。

面板的「Embedding 后端」那一节有 provider / model / baseUrl / apiKey 四个字段和一个「保存配置」按钮 —— **保存之后没有任何办法知道这套配置是不是对的**。唯一的验证方式是点「建立索引」：那是一次成百上千个代码块的整库扫描（用户截图里那次是 326 块；每块一次 embedding 调用，量级见 §2.3）。

于是配错一个字符的代价是：要么等整库跑完，要么盯着一句

```
索引失败:embedding 后端探测失败:Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434
```

猜。这句话本身在同一批工作里已经被 `EmbeddingErrorHint` 翻译过了（`fbeee84` / `9954922`），但**诊断得等到你决定跑整库之后才出现** —— 这是个时机问题，不是话术问题。

---

## 2. 调查结论

### 2.1 先例是完整的，不需要发明任何机制

LLM 那边早就有一个同形状的按钮：`config.testProvider`。它踩过的坑与配套件全在：

| 机制 | 位置 | 为什么存在 |
|---|---|---|
| `dispatchAsync` | `AppServer` | 探测同步执行会冻住整个 app-server（见 2.2） |
| `awaitProbe` | `Main` | 给探测套超时上限，超时返回 `{ok:false,error}` 而不是吊死调用方 |
| `probeTimeoutSeconds()` | `Main` | 上限可用系统属性覆盖，非法值退回默认 |
| `redactKey` | `Main` | 红线：回包绝不含 key |
| 用**表单值**探测 | `configTestProvider` | 「改完先测一下」必须测得到改动 |
| apiKey 空=沿用已存 | `configTestProvider` | KEY 框不回填，不继承就永远 401 |
| `PROBE_POOL` 是守护线程 | `Main` | 被放弃的调用不能拖住 JVM 退出 |

**结论：embedding 版照抄这七件，一件都不能漏。** 本次没有新增任何基础设施，只复用。

### 2.2 同步执行是已经踩过的坑，不是理论风险

`dispatch` 跑在 `serve()` 那条**唯一的** reader 线程上（`while ((line = in.readLine()) != null)`）。`config.testProvider` 当初就是同步的，症状是「点了测试连接，整个桌面端都没反应」—— 不只是那个按钮，**任何** RPC 都处理不了。守门测试是 `AppServerTestProviderAsyncTest`。

embedding 的时间尺度**更糟**，见 2.3。

### 2.3 embedding 探测的时间尺度与 LLM ping 不同（实测）

ollama 的**首次**请求要把模型载进内存，这是 LLM ping 没有的成本。本机实测（M 系列 + NVMe，先 `ollama stop` 卸载再计时）：

```
nomic-embed-text:latest   冷 0.6s   热 0.06s   dim 768
bge-m3:latest             冷 2.2s   热 0.16s   dim 1024
```

**这台机器上 20 秒绰绰有余 —— 而那正是不该按它定上限的理由。** 用户跑的是 Windows，`qwen3-embedding:8b` 有 4.7GB，落在机械盘上冷加载几十秒是常态。

### 2.4 维度是这个仓库最阴的一类故障，而它有两种形态

同一批工作里已经处理过两次：

- `VectorStore.search()` 现在会在**索引维度 ≠ 查询维度**时抛出带指引的 `SQLException`（在此之前 `cosineSimilarity` 对长度不等的向量直接返回 `0.0` —— 实测 768 维索引 + 1024 维查询给出 3 条结果、相关度全 `0.0000`、不报任何错）。
- `ragView.staleIndexWarning` 在面板上比较**已保存的模型名**与索引记录的模型名。

但这两层都在「已经出事之后」：一个在检索时抛错，一个依赖你先把配置**存下来**。**没有任何东西在你决定建索引之前告诉你会撞。**

而且两种不兼容的后果不同，不能用一句话盖过去：

| 形态 | 后果 | 用户会看到什么 |
|---|---|---|
| 维度不同 | `VectorStore.search` 抛错 | 一条明确的失败 |
| **维度相同、模型不同** | **不抛任何错** | 每一步都「成功」，只是相关度是纯噪声 |

后者更需要提前说 —— 用户会一直等一个永远不来的报错。

### 2.5 面板的 KEY 框从不回填，这是个硬约束

`embeddingGet` 只回 `{provider, model, baseUrl, hasKey}`，**key 不回**（密钥红线）。`embeddingSet` 的语义是「apiKey 空 = 保留旧 key」。

于是探测**必须**继承已存的 key，否则云端后端的「测试连接」永远是 401，而「保存」却是好的 —— 那种自相矛盾比没有这个按钮更糟。

### 2.6 `redactKey` 在 `cli` 包，而抹 key 的需求出现在 `rag` 包

`rag` 不该依赖 `cli`。而把那三行 `contains/replace` 复制一份到 `rag` 也不行：**同一段安全逻辑存两份就会漂**，一边修了另一边没修，而漂的后果是把 key 打到界面上。

### 2.7 六层链路

`EmbeddingProbe`（Java 逻辑）→ `config.testEmbedding` RPC → `shared/types.ts` → `preload/index.ts` → `main/index.ts` → `renderer/lib/embeddingTestView.ts`（纯函数）→ `RagPanel.tsx`。与 `embedding` / `search` / `pricing` 三节同构。

---

## 3. 设计（已实现）

### 3.1 D1 —— RPC 形状：`config.testEmbedding`

```
config.testEmbedding { provider, model, baseUrl, apiKey }
  → 成功 { ok:true, dim, latencyMs, provider, model, baseUrl, warning? }
  → 失败 { ok:false, error, latencyMs, hint? }
```

`provider`/`model`/`baseUrl` **回显实际生效的那套**（表单留空时 `EmbeddingClient.of` 会填默认值），不是表单里那套 —— 用户填空时，回显的才是真在跑的。

除 `ok` 外全部可选：字段随成败而不同，桌面端还可能跑在旧 jar 上。

### 3.2 D2 —— 必须 `dispatchAsync`

理由见 §2.2 / §2.3。守门测试 `AppServerTestEmbeddingAsyncTest`：让探测阻塞住，后面那条 `model.list` 仍必须回得来。

### 3.3 D3 —— 超时 60 秒，走独立的系统属性

`wraith.embed.probe.timeout.seconds`，默认 **60**，**刻意宽于** LLM 探测的 20 秒。

> **取舍摆明**：宁可让人多等，也不要对一个**好的**后端报「没有响应」—— 后者会让人去改一份本来没错的配置。等待期间按钮有转圈，等是看得见的；误报不是。

两个属性各走各的（`EmbedProbeTimeoutTest` 有一条专门钉这个：调宽一个不该把另一个带着变）。

### 3.4 D4 —— `effectiveKey` 与 `embeddingSet` 严格同义，且探测不写盘

```java
public static String effectiveKey(String savedKey, String formKey) {
    if (formKey != null && !formKey.isBlank()) return formKey.trim();
    return savedKey == null ? "" : savedKey;
}
```

**测的必须正是保存会落盘的那套。** 理由见 §2.5。

同时：点「测试连接」**不写 config.json**。把一份没验过的配置存进去是另一回事，两个按钮各干一件事。

### 3.5 D5 —— 与已有索引比，两种不兼容分开说

`compatibilityWarning(indexMeta, currentModel, currentDim)`，返回 `null` = 不必警告：

- 维度不同 → 「…不兼容，**直接检索会报错**。请点『重建索引』。」
- 同维度不同模型 → 「…这种情况**不会报错**，只是相关度全无意义。」

**任一侧未知就不比较。** 老索引没记过模型（`index_meta` 是后加的表），宁可漏报也不要对着一份可能没问题的索引喊「快重建」。模型名比较容忍大小写与首尾空格（ollama 的 tag 不区分大小写，不该逼人重建整库）。

索引元信息由 `Main.embeddingTest` 经 `CodeRetriever.getStats()` 取；**打不开索引库不该让「测试连接」失败** —— 那是两件独立的事。

### 3.6 D6 —— 回了空向量算**失败**，不算成功

`EmbeddingClient.embed` 对空输入返回 `float[0]`，而 0 维向量会让相关度恒为 0，且这一路**不抛任何异常**。所以：

- 探测文本 `PROBE_TEXT` 不能为空（否则好后端会被判成坏的，有一条测试专门钉这个）；
- 后端回了 0 维 → `{ok:false}`，并说明多半是模型名不对或那不是个 embedding 模型。

### 3.7 D7 —— `error` 与 `hint` 是**两个字段**，不合并；顺带补一条 404 诊断

原文一律保留。「连不上」「401 key 错」「429 限流」是三件不同的事，只给一句友好话会把人引到错的地方去查。`hint` 说不出话时**该字段不出现** —— 不知道就不说。

本次给 `EmbeddingErrorHint` 加了一条新形态：**404 但不是 `model not found` → 那说明那个路径不存在**。

真实复现：provider 选 `openai` 却填 ollama 的地址，打到 `/embeddings` 上，ollama 只回一句 `404 page not found`。原文没错，但没人看得出问题在哪。这个推断是**确定**的（服务回了 404，所以它在听；不是 model-not-found，所以是路径），因此这里敢说话；至于到底哪一处写错了不猜，把两种协议的真实路径都给出来让人对照。

顺序上 `model not found` 先判，不能被这条抢掉（有测试钉住）。

### 3.8 D8 —— `redactKey` 提取到 `config.SecretRedaction`

`Main.redactKey` 改成委托（调用点与 `RedactKeyTest` 都不动）。理由见 §2.6。

该类的 javadoc 写明能力边界：这是**防御性**的一层，判据只有「已知的那串字符出现在文本里」，抹不掉服务端变形过的形态（截断 / 大小写 / URL 编码）。真正的保证在上游 —— 别把凭证放进任何回包字段。这一层是兜底，不是许可。

### 3.9 D9 —— 前端三态，不是两态

`embeddingTestTone` 返回 `'ok' | 'warn' | 'error'`。

> `warn` = **后端是通的，但与现有索引不兼容**。这一态必须与 `ok` 分开：给个绿勾加一行小字，用户只会看见绿勾，然后带着不兼容的索引去检索。

`embeddingTestLines` 的两条纪律与后端一致：**缺的字段整行不出现**（旧 jar 不回这些字段，绝不显示「维度 undefined」）；失败时**诊断在前、原文在后，两个都在**。

---

## 4. 行为变化

1. 「Embedding 后端」一节多一个「测试连接」按钮，位于「保存配置」右侧。
2. 新增 RPC `config.testEmbedding`。旧桌面 + 新 jar 无影响；**新桌面 + 旧 jar** 会拿到 `UnsupportedOperationException("embeddingTest not implemented")`，界面把它显示成错误（有测试钉住不能静默）。
3. `EmbeddingErrorHint` 对**任何**带 `[404]` 且非 model-not-found 的失败开始说话 —— 这也影响索引失败路径的话术（同一个 hint 类被两处复用）。
4. `Main.redactKey` 变成委托，行为不变。

---

## 5. 测试与验证（真实结果）

### 5.1 判别力自证 —— 七处打断实现，逐一确认变红

| 打断 | 变红的测试 |
|---|---|
| 不抹 key | `EmbeddingProbeTest#apiKeyNeverLeaksIntoTheResult` |
| `PROBE_TEXT` 置空 | `EmbeddingProbeTest#probeTextIsNotBlank` |
| 维度冲突不警告 | `EmbeddingProbeTest#dimensionConflictWithExistingIndexWarns` |
| `testEmbedding` 改回同步 | `AppServerTestEmbeddingAsyncTest` |
| 传已存配置而非表单草稿 | `ragTestConnection` 第 1 条 |
| 按钮不禁用 | `ragTestConnection` 第 2 条 |
| `warning` 也算 `ok` / 失败不带原文 | `embeddingTestView` 4 条 + `ragTestConnection` 1 条 |

全部恢复后复跑变绿。

### 5.2 真 ollama 上量了五种形态

正常（768 / 586ms）、换模型撞维度（1024 + 警告）、模型名打错一个字（404 → `ollama pull`）、端口打错（连不上 → 「没在运行」+ IPv6 澄清）、协议配错（404 → 路径诊断）。

### 5.3 整条 RPC 链路走过一遍

用 app-server stdio NDJSON 驱动（`-Dwraith.config.dir` / `-Dwraith.rag.dir` 指到临时目录，**没碰真实 config 与真实索引库**）：

- 建索引（nomic，768 维，6 块 6 关系）→ 换 bge-m3 测试连接 → `warning` 带出「768 维 vs 1024 维」；
- 同一份索引用 nomic 测试 → 无 warning；
- 三条并发探测**回帧乱序**返回 —— 这是 `dispatchAsync` 真在生效的直接证据。

### 5.4 全量

Java **2171 / 0F / 0E**（+23）。桌面 `tsc` 0、vitest **166 文件 / 1453 测试**（+2 文件 / +15 测试）。

### 5.5 测试隔离

Java 侧没有任何单测触碰真实 `~/.wraith` 或真实索引库：`EmbeddingProbeTest` 全用桩客户端（不发网络），`IndexFailureHintTest` / `IndexProgressDetailTest` 走 `@TempDir` + `-Dwraith.rag.dir`。真 ollama 的那次测量用的是临时 JUnit 文件，验完即删。

---

## 6. 我验不了什么

- **界面本身没眼验过。** 按钮的位置、三态配色、长诊断在窄面板里的换行，都要 `mvn package` + 拷到 `~/.wraith/wraith.jar` + 重启 App 才看得见。我没做这一步 —— 那会动用户的运行环境。
- **Windows 上的一切。** 冷加载耗时是否真的落在 60 秒内、`%USERPROFILE%` 路径话术、NSIS 包里的行为。
- **云端后端。** 全部测量都在本机 ollama 上做的。zhipu / openai 的真实 401 / 402 / 429 响应体形态没验过 —— 那些路径靠 `EmbeddingErrorHint` 的「不确定就返回空串」兜住（只给原文，不硬凑建议）。
- **服务端回显 key 的变形形态。** `SecretRedaction` 只抹逐字匹配，见 D8。

---

## 7. 明确不做

- **不自动重建索引。** 探测到维度冲突只提示，不代替用户决定跑一次整库。
- **不把维度写进 config。** 维度是后端的属性而不是配置项，缓存它就又造一个 snapshot-vs-live。
- **不批量测多个模型。** 一次探测对应一套表单值，够了。
- **不在探测里做「猜测哪个字段写错了」。** 404 那条只给两种协议的真实路径让人对照，不猜。
- **不补一份事后编造的 implementation plan。** 本文如实记录已实现的设计；再补一份写成「待实施」的任务分解，那是伪造过程记录。
