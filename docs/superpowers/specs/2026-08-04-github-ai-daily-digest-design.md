# GitHub AI 日报：每天 7 点，昨日谁在涨

**日期:** 2026-08-04 **状态:** 设计已定稿，未实现

用户需求原文：

> 每天七点获取 github 上前一日 star 量增长最高、涨粉最多的人、fork 最多的项目，项目包含 ai agent、ai 工程化、ai 规范、等等，我列不完整，请你帮我继续优化完整思考一下，然后我放到 wraith 的定时任务下。

「每天七点」这部分 wraith 已经有了（`AutomationTask` + `Scheduler`，`schedule.kind=daily`）。
本设计的交付物是**被定时任务调用的取数脚本**，以及它的配置契约。

---

## 1. 调查结论：一半指标官方 API 拿不到

需求里的三个指标全是**增量**，而 GitHub API 只暴露**当前绝对值**。下面四条全部实测过（2026-08-04，用 `gh auth token` 的 `gho_` token）。

| 指标 | 能否直接算昨日增量 | 实测证据 |
|---|---|---|
| ⭐ star 日增 | **不能** | `GET /repos/{o}/{r}/stargazers`（配 `Accept: application/vnd.github.star+json` 可拿 `starred_at`，倒排末页即最近加星者 —— star-history 的老套路）对**他人仓库一律 404**：`cli/cli`、`microsoft/vscode`、`BerriAI/litellm` 全 404，而自己的 `JavaLyHn/wraith` 返回 200。这条路已被掐 |
| 🍴 fork 日增 | **能，且精确** | `GET /repos/{o}/{r}/forks?sort=newest` 正常返回，每条带 `created_at`（实测 `browser-use/browser-use` 返回 `2026-08-04T05:23:11Z` 等）。翻页数出落在窗口内的条数 = 精确日增，零冷启动 |
| 👤 follower 日增 | **不能** | GitHub 从未提供 follower 历史接口。只能自建快照隔日做差 |
| 📊 批量取数成本 | 极低 | GraphQL 多 alias 批查实测 `rateLimit.cost = 1`（一次查了 2 个 repo 的 stars/forks/topics + 2 个 user 的 followers）。额度 5000 point/h |

两个外部源的实测：

- **GitHub Trending 页**（`https://github.com/trending?since=daily`）**还能抓**，HTML 里有 `1,085 stars today` 这种字样，也支持 `/trending/{language}`。**但只能按语言分，没有 topic 维度。**
- **OSSInsight**（`api.ossinsight.io/v1/trends/repos/?period=past_24_hours`）接口通、返回 100 条，**但数据明显不全**：榜首 `zhaoxuya520/reverse-skill` 只显示 `stars: 6`。**不可作为主源。**

主题池子的量级抽样（`search/repositories?q=topic:X` 的 `total_count`）：

| topic | 仓库数 | topic | 仓库数 |
|---|---|---|---|
| mcp | 57,765 | rag | 37,669 |
| ai-agent | 23,766 | agents | 14,507 |
| agentic | 2,638 | llmops | 2,460 |
| ai-engineering | 1,879 | | |

**池子足够大，反而噪声过滤才是主要工作量。**

### 1.1 由此推出的核心结论

star 榜与人物榜**必须自建「每日快照 + 隔日做差」**。这意味着脚本**有状态**，不是无状态的一次性拉取 —— 这是与需求原始设想最大的偏差，也是整个设计的地基。

---

## 2. 决策清单

编号供实现计划引用。

| # | 决策 | 理由 / 代价 |
|---|---|---|
| **D1** | **混合三源**：Search API 维护候选池 → GraphQL 每日快照 → 隔日 diff 得精确日增；Trending 页与 `forks?sort=newest` 作冷启动/兜底 | 纯快照方案第一天完全没有增量榜；纯 Trending 方案抓不到垂直领域的新秀、也做不了人物榜。混合的代价是逻辑最重 |
| **D2** | 窗口口径 = **过去 24 小时**（今日 07:00 快照 − 昨日 07:00 快照），不是严格日历日 | 单个定时任务即可完成；且包含今晨（美国白天，GitHub 高活跃期）的动静，情报更新鲜。严格日历日要额外加一个 00:05 快照任务，且报告时数据已滞后 7 小时 |
| **D3** | star 榜**分三层**：新星 `<3k` / 中坚 `3k–30k` / 巨头 `>30k`，各 Top N；外加一张**增速榜**（日增 ÷ 存量） | 单一总榜会被少数超大仓库和当天登上 HN 的爆款长期占满，新秀被绝对值压死。增速榜专抓黑马 |
| **D4** | 人物榜**出两张**：① 真 follower 日增（需快照，T+1 起有数据）② 昨日 star 归因作者（其名下仓库昨日 star 增量合计，零冷启动） | ② 其实更能回答「谁昨天火了」，且第一天就能出。① 严格对应用户原话 |
| **D5** | awesome / 教程 / 词典 / 提示词集合等**知识类仓库单独分栏**，不混主榜也不丢弃 | AI 领域这类仓库涨星极猛，混榜会霸榜；但 `agents.md`、`llms-txt` 这类「AI 规范」本质上也是文档仓库，直接剔除会丢掉用户明确要的一整类 |
| **D6** | 增强项做三件：**连续在榜天数**、**关注名单必报**、**首日开源新库单栏**。**不做**「与 wraith 的关系标注」 | 前三件都能从已有数据/低成本查询得出。第四件用户明确没选 |
| **D7** | **所有口径外置到配置文件**：主题分类法、关键词、黑名单、关注名单、分层阈值、Top N、保留天数。仓库内 `config.default.json` 为模板，首次运行复制到 `~/.wraith/`，**之后升级永不覆盖用户改动** | 用户原话：「这个应该可以手动配置，不应该固定」。调口径不该改代码 |
| **D8** | 脚本**零投递代码**。投递完全由 automation 的 `deliverTo` 决定 | 同上。投递目标要能在桌面面板里随时改，脚本不该知道飞书/QQ 的存在 |
| **D9** | 脚本产出 **JSON + Markdown 两份**；LLM 只负责读 Markdown 后做中文点评 | 脚本可离线复跑、可单测、零 token；JSON 供下游程序消费，Markdown 供人和 LLM 读。榜单数字不经模型，杜绝幻觉 |
| **D10** | 取数走 **GraphQL 批量**，100 个节点一批 | 实测一批 1 point。全池 2000–4000 仓库 + 约 1500 人 ≈ 35–55 point/天，占 5000/h 额度的 1%。REST 逐个查会是几千次请求 |
| **D11** | token 解析顺序：`GITHUB_TOKEN` 环境变量 → `gh auth token` → 报错退出。**绝不写入任何文件、绝不打印** | 本机 `gh` 已登录（scopes: `gist`/`read:org`/`repo`），零配置即可跑。日志里 token 一律不出现 |
| **D12** | automation 的 `approval` 只给 `execute_command` 开 `ALLOW`，`default` 保持 `DENY` | `ApprovalPolicy.resolve()` 默认返回 `DENY`（`ApprovalPolicy.java:16`）。无人值守的任务必须只放行它真正需要的那一个工具 |
| **D13** | 冷启动（无基线快照）时：star 榜退化用 Trending 页的 `stars today`；fork 榜用 `forks?sort=newest` 精确回溯；**follower 榜明写「T+1 起可用」，不假装有数据** | 第一天就有可读报告，同时不伪造数字 |
| **D14** | 副作用（网络、磁盘）只允许出现在 `github.js` / `snapshot.js`；分类、排名、渲染全是纯函数 | 单测不需要 mock 网络，喂假数据即可覆盖全部判定逻辑 |
| **D15** | 快照存 `JSONL.gz`，按 `snapshotRetainDays` 滚动清理 | 全池 gzip 后约 100–200 KB/天，一年 ~50 MB |

---

## 3. 结构

```
scripts/github-ai-daily/
  index.mjs             CLI 入口：编排 + 落盘（薄）
  config.js             配置加载、默认值合并、校验（D7）
  github.js             REST + GraphQL 客户端、限流、退避重试、token 解析（D10 D11）
  discover.js           候选池发现与增量维护（D1）
  classify.js           AI 主题判定 + 知识类/噪声识别（纯函数，D5 D14）
  snapshot.js           快照读写 JSONL.gz、基线选取、保留策略（D15）
  rank.js               三层分层、增速榜、连续在榜天数（纯函数，D3 D6）
  report.js             Markdown + JSON 渲染（纯函数，D9）
  config.default.json   配置模板（D7）
```

数据目录（不进 git）：

```
~/.wraith/reports/github-ai-daily/
  config.json                      用户配置，首次运行从模板复制
  pool.json                        候选池（仓库全名 + 元数据 + 首次发现日期）
  snapshots/2026-08-04T07.jsonl.gz 每次运行一份全池快照
  streaks.json                     连续在榜天数
  2026-08-04.md / .json            报告
```

## 4. 数据流（每天 07:00 单次运行）

1. **加载配置**（缺失则从模板复制），解析 token。
2. **发现**（`discover.js`）：按配置的 topic 与关键词多路 Search 召回，过滤 `stars>=minStars` 且 `pushed` 在 `activeWithinDays` 内 → 合并进 `pool.json`。池子**增量维护**，不每天重建：新命中的加入并记 `firstSeen`，连续 `activeWithinDays` 不活跃的移出。
   - Search API 硬限制：单 query 最多取 1000 条（10 页 × 100），额度 30 req/min → 请求间隔 ≥2.1s，串行节流。
3. **首日新库**：额外查 `created:>=<窗口起点>` 的 AI 主题库，用独立的 `newRepoMinStars`（默认 5）而非 `minStars` —— 新库绝对值必然低（D6）。
4. **快照**（`github.js` + `snapshot.js`）：GraphQL 批量取全池 `stargazerCount / forkCount / watchers / pushedAt / topics / owner / isArchived / isFork / primaryLanguage / description`，100 个一批，落 `snapshots/`。
5. **人物池**（定义必须是可数的，否则成本无界）：
   - 主体 = 池内仓库 owner 中 `__typename == "User"` 的去重集合。**组织不进人物榜**（「涨粉最多的人」是人）；组织的动态归 §7 关注名单栏。
   - 可选扩充 = 按本期 star 日增排序的前 `contributorPoolTopRepos` 个仓库（默认 50，设 0 即关闭），各取 REST `/contributors` 前 5 名。**上界 = 50 次请求/天**，可控。
   - 合并后 GraphQL 批量取 `followers.totalCount`，与仓库快照同批落盘。
6. **做差**：基线 = 最近一份**距今 ≥20h** 的快照。
   - 若昨天漏跑，自动跟更早的快照比，**并在报告头部标注真实窗口（如「本期窗口 48h」）**，不静默出错。
   - 若无任何基线 → 走 D13 冷启动路径。
7. **关注名单**（D6）：对配置里的 org/user 走 GraphQL 取其仓库列表（按 `pushedAt` 排序）+ `releases(last:1)`，凡窗口内有新 release、新建库或异常涨幅一律单独报，**不看是否上榜**。
8. **排名与渲染**：`rank.js` 出各榜 → 更新 `streaks.json` → `report.js` 渲染 → 写 `.md` + `.json` → 清理超期快照。

## 5. 判定规则（`classify.js`，纯函数）

**AI 相关性打分**：

- topic 命中配置里任一分组：**+3/命中，上限 6**（强信号）
- 名称或简介命中 `keywords.include`：**+1/命中，上限 3**（弱信号，覆盖不打 tag 的仓库）
- 阈值：**总分 ≥3 判定为 AI 相关**

**直接剔除**：`isFork` 为真、`isArchived` 为真、命中 `keywords.exclude`（镜像 / 翻译 / mirror 之类）。

**知识类判定**（→ D5 单独分栏，不进主榜）：名称或简介命中 `knowledgeRepoHints`（awesome / cookbook / handbook / roadmap / tutorial / 教程 …），**或** `primaryLanguage` 为空 / 为 Markdown。

## 6. 配置契约（`config.default.json`）

```json
{
  "topics": {
    "agent":       ["ai-agent","agents","agentic","multi-agent","autonomous-agents",
                    "agent-framework","coding-agent","computer-use","browser-use","swe-agent"],
    "engineering": ["llmops","rag","retrieval-augmented-generation","embeddings",
                    "vector-database","inference","llm-serving","evals","evaluation",
                    "observability","guardrails","fine-tuning","quantization","prompt-engineering"],
    "spec":        ["mcp","model-context-protocol","a2a","agent-protocol","agents-md",
                    "llms-txt","spec-driven-development","ai-governance","responsible-ai"],
    "context":     ["memory","context-engineering","long-context","knowledge-graph"],
    "security":    ["prompt-injection","jailbreak","ai-red-teaming","agent-security","sandbox"],
    "ecosystem":   ["local-llm","ollama","edge-ai","on-device","voice-agent",
                    "deep-research","multimodal","vlm","claude-code"]
  },
  "keywords": {
    "include": ["agent","LLM","RAG","MCP","prompt","inference","embedding","eval"],
    "exclude": ["mirror","镜像","翻译","fanyi"]
  },
  "knowledgeRepoHints": ["awesome","cookbook","handbook","roadmap","tutorial","教程","面试"],
  "watchlist":  { "orgs": ["anthropics","openai","google","langchain-ai"], "users": [] },
  "tiers":      { "rising": 3000, "mid": 30000 },
  "topN": 5,
  "minStars": 100,
  "newRepoMinStars": 5,
  "activeWithinDays": 90,
  "snapshotRetainDays": 400,
  "baselineMinAgeHours": 20,
  "contributorPoolTopRepos": 50
}
```

用户改过的 `config.json` 与新版模板的合并规则：**模板只补用户配置里缺失的键，绝不覆盖已存在的键。** 这条必须有单测。

## 7. 报告结构

头部：窗口起止时间、真实窗口时长（异常时显式标注）、池子规模、本次取数成本、失败计数。

- ⭐ **star 日增**：新星 / 中坚 / 巨头 各 Top N + 增速榜（日增 ÷ 存量）
- 🍴 **fork 日增** Top N —— fork 增长意味着有人真在动手改，比 star 更硬
- 👤 **人物榜**：真 follower 日增 Top N + 昨日 star 归因作者 Top N
- 🌱 **首日开源新库**
- 📌 **关注名单动态**
- 📚 **知识类**（小栏）

每条带 `🔥第 N 天在榜`。

## 8. 失败模式

| 情况 | 行为 |
|---|---|
| 命中限流（REST 403 / GraphQL `RATE_LIMITED`） | 读 `x-ratelimit-reset` 指数退避重试；超过重试上限则该批标记失败并继续 |
| GraphQL 部分节点报错（仓库改名/删除） | 保留成功节点，失败者从池中标记待清理，报告尾部列出失败计数 |
| 网络整体不可用 | **非零退出码** + stderr 写明原因。automation 侧会显示为失败，而不是静默投一份空报告 |
| 快照文件损坏 | 跳过该基线取更早的一份；全坏则退化为绝对值榜并在报告里明说 |
| 无任何基线快照（首次运行） | 走 D13 |
| 配置文件 JSON 语法错误 | 立即报错退出并指出行号，**不静默回落默认值**（否则用户以为改生效了） |

## 9. 测试策略

**测试放哪**：本仓库唯一的 Node 工程是 `desktop/`（唯一的 `package.json`，`vitest ^2.0.0`，**没有 vitest 配置文件**，靠默认 include 扫 `desktop/` 下的 `*.test.ts`）。所以脚本的单测文件放 **`desktop/test/githubAiDaily.*.test.ts`**，用相对路径 `import` 到 `../../scripts/github-ai-daily/*.mjs`。

这样做的理由：不引入第二个 Node 工程和第二个 test runner，脚本的测试直接进 `cd desktop && npm test` 这道既有闸门 —— 以后谁改坏了都会被现有回归拦住。代价是测试文件与被测文件不同目录，命名前缀 `githubAiDaily.` 用来点明归属。

单测全部针对纯函数，**不 mock 网络**：

- `classify.js`：AI 打分阈值边界、剔除规则、知识类判定（含 `primaryLanguage: null`）
- `rank.js`：三层切分边界值（正好 3000 / 30000）、增速榜除零保护、连续在榜天数（首次上榜 / 连续 / 断档重置）
- `snapshot.js`：基线选取（正常 24h / 漏跑 48h / 无基线）、保留期清理
- `config.js`：模板合并**不覆盖**用户键、JSON 语法错误报错而非回落
- `report.js`：Markdown 渲染快照测试，含各榜为空、冷启动标注、异常窗口标注

网络层（`github.js`、`discover.js`）不写单测，靠真实 CLI 跑一次眼验。

## 10. 接入 wraith 定时任务

```
name:      GitHub AI 日报
schedule:  daily 07:00
workspace: /Users/aa00945/Desktop/wraith
approval:  { default: DENY, tools: { execute_command: ALLOW } }
deliverTo: 用户在桌面面板勾选（飞书 / QQ / 桌面，随时改）
prompt:    跑 node scripts/github-ai-daily/index.mjs
           → 读它生成的 Markdown 报告
           → 用中文点评每张榜的 Top 3（为什么火、值不值得跟）
           → 输出全文
```

本机 `~/.wraith/config.json` 现有 `gateway.feishu` 与 `gateway.qq` 两个网关，`automations.json` 目前为空（`{"tasks":[]}`）。

## 11. 已知限制

- **窗口不是日历日**（D2 的自觉取舍）。跟第三方日历日榜单对不上账是预期行为。
- **池外爆款会漏**：不在候选池、又没登上全站 Trending 的垂直新秀抓不到。缓解手段是把它加进 `watchlist`。
- **follower 榜依赖人物池**：池外的人涨粉再多也统计不到。
- **Trending 页是 HTML 抓取**，GitHub 改版即失效。它只在冷启动路径上，失效后主链路不受影响，但要在报告里明写「Trending 兜底不可用」。
- **`stargazers` 404 是实测结论，不是文档结论。** 若 GitHub 哪天放开，可用它把 star 日增也做成零冷启动的精确回溯 —— 届时 D1 可简化。
