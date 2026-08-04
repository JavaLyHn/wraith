# GitHub AI 日报 · 接线与排障

每天自动产出「昨日 AI 领域 star 涨最多 / fork 涨最多 / 涨粉最多的人」的报告，投递到你选的渠道。

- **脚本**：`scripts/github-ai-daily/index.mjs`（零依赖，Node 22+）
- **数据与报告**：`~/.wraith/reports/github-ai-daily/`
- **配置**：`~/.wraith/reports/github-ai-daily/config.json`（首次运行自动从模板生成）

---

## 1. 为什么是两个定时任务，不是一个

`execute_command` 这个工具**硬编码 60 秒超时**（`ToolRegistry.java:67`，`DEFAULT_COMMAND_TIMEOUT_SECONDS = 60`，没有任何系统属性能覆盖它），而本脚本真机实测一次要跑 **25 分钟以上**。

所以不能让 agent 直接前台跑脚本——每天都会在第 60 秒被强杀。

拆成两个任务：

| | 任务甲：抢起来 | 任务乙：出日报 |
|---|---|---|
| 干什么 | 把脚本丢到后台，立刻返回 | 读今天的报告，中文点评，投递 |
| 耗时 | < 1 秒 | 几十秒（一次 LLM 调用） |
| 撞不撞 60 秒 | 不撞 | 不撞 |

## 2. 任务甲：后台启动

**Schedule**：daily，时刻自选（见 §4）
**Workspace**：`/Users/aa00945/Desktop/wraith`
**Approval**：`default` = DENY，仅 `execute_command` = ALLOW
**deliverTo**：不用选（这个任务没有可投递的内容）

**Prompt**（原样粘贴，不要改动那条命令）：

```
把 GitHub AI 日报的取数脚本丢到后台跑起来，然后立刻结束这一轮，不要等它跑完。
执行这一条命令，原样执行、不要改写：

mkdir -p ~/.wraith/reports/github-ai-daily && nohup node /Users/aa00945/Desktop/wraith/scripts/github-ai-daily/index.mjs >> ~/.wraith/reports/github-ai-daily/run.log 2>&1 &

命令返回后直接回报「已在后台启动」即可，不要再跑别的命令去查看进度。
```

### 那个重定向是承重的，不是为了好看

`>> run.log 2>&1` 必须留着。不重定向的话，后台子进程会继续持有从父进程继承来的 stdout 管道，Java 那边的 `Process.waitFor(60, SECONDS)` 会一直等到管道关闭——于是你以为放了后台，实际照样撞 60 秒超时。

**已实测**：带重定向时外层命令 0 秒返回，子进程活到跑完并把日志写全。

## 3. 任务乙：出日报

**Schedule**：daily，时刻自选，**必须晚于任务甲超过一次完整运行的时长**（见 §4）
**Workspace**：`/Users/aa00945/Desktop/wraith`
**Approval**：`default` = DENY，仅 `execute_command` = ALLOW
**deliverTo**：在桌面「自动化」面板里勾（飞书 / QQ / 桌面，随时改）

**Prompt**：

```
读今天的 GitHub AI 日报并点评。

先执行：cat ~/.wraith/reports/github-ai-daily/$(date +%Y-%m-%d).md

如果文件不存在，说明取数脚本还没跑完或者失败了。这种情况下不要编造内容，
执行 tail -30 ~/.wraith/reports/github-ai-daily/run.log 把最后的日志贴出来，
明确告诉我「今天没有报告」以及日志里的原因，然后结束。

如果文件存在：原样保留它的所有榜单和数字（一个数字都不要改、不要重算），
在每张榜的后面用中文补三行点评，讲清楚 Top 3 为什么火、值不值得跟。
最后把报告全文连同你的点评一起输出。
```

**为什么强调「一个数字都不要改」**：榜单数字全部由脚本算出，不经模型，就是为了杜绝幻觉。模型只负责解读。

## 4. 时刻怎么定

两个时刻都由你自己设，代码里没有写死任何时间。唯一的硬约束：

> **任务乙的时刻 − 任务甲的时刻 > 一次完整运行的时长**

实测数据（用来估这个间隔）：

| 项 | 实测值 |
|---|---|
| 完整一次运行 | **25 分钟以上**（当时词表 66 条查询；现已增到 71 条，会更久） |
| 其中「发现候选池」阶段 | 约 14 分钟 |
| 为什么这么慢 | Search API 硬限 **30 次/分**，词表有 71 条查询、每条最多翻 3 页 |
| GraphQL 消耗 | 约 66 点（额度 5000/小时，占 1.3%） |

**推荐**：任务甲 06:00，任务乙 07:00（留 60 分钟余量，是实测时长的两倍多）。

第一次跑完后，用 `run.log` 里的时间戳量一下你机器上的真实耗时，再决定要不要缩。**留余量比卡点重要**——间隔不够时任务乙只会读不到报告（它会明确告诉你，不会编），但你就白等一天。

## 5. 配置：所有口径都在这里

文件：`~/.wraith/reports/github-ai-daily/config.json`。改完下次运行生效，不用重启任何东西。

### 决定「什么算 AI 项目」

| 键 | 默认 | 作用 |
|---|---|---|
| `topics` | 7 组共 60+ 词 | topic 命中一个 **+3 分**（上限 6）。分组只是给人看的，代码不区分组 |
| `keywords.include` | 15 词 | 名称/简介/fullName/**topics** 命中一个 **+1 分**（上限 3） |
| `keywords.exclude` | mirror/镜像/翻译/fanyi | 命中即整个仓库剔除 |
| `aiThreshold` | `2` | 总分 ≥ 这个数才算 AI 相关。**嫌噪声就调到 3，嫌漏就调到 1** |
| `knowledgeRepoHints` | awesome/cookbook/教程… | 命中即归「知识类」单独一栏，不进主榜 |

**调这块之前先知道两件实测过的事：**

1. **最重要的仓库往往标得最少。** `ggml-org/llama.cpp` 只打了一个 `ggml` tag，`ggml-org/whisper.cpp` 一个通用 AI 词都没打。所以关键词要扫 topics、门槛才敢定在 2——纯靠 topic 强信号会漏掉这一整类。
2. **删词的代价可能大一个量级。** 曾经删掉 5 个「看起来很通用」的 topic（`observability`/`evaluation`/`inference`/`memory`/`sandbox`），实测掉了 **540 个仓库**，其中包括 `huggingface/evaluate`、`huggingface/lighteval`、`LMCache`。删词前先量，别凭感觉。

### 榜单形状

| 键 | 默认 | 作用 |
|---|---|---|
| `tiers.rising` / `tiers.mid` | 3000 / 30000 | 三层切分：新星 `<3000`、中坚 `<30000`、巨头以上 |
| `topN` | 5 | 每张榜取几条 |
| `minStars` | 100 | 进候选池的最低 star |
| `newRepoMinStars` | 5 | 「首日开源」榜专用的低门槛（新库不可能有 100 星） |
| `activeWithinDays` | 90 | 超过这么久没被召回就踢出池子 |

### 关注名单

| 键 | 默认 | 作用 |
|---|---|---|
| `watchlist.orgs` | anthropics/openai/google/langchain-ai | 这些 org 下的 release、新建库、异常涨幅单独一栏 |
| `watchlist.users` | 空 | 同上，按人 |
| `watchlistMinScore` | `1` | 关注名单的 AI 门槛，**故意比主榜低** |
| `watchlistReposPerOwner` | 20 | 每个 org 最多看多少个最近推送的仓库 |

**为什么关注名单的门槛更低**：`anthropics/claude-code` 一个 topic 都没打、描述里的 "agentic" 又不命中关键词 `agent`（词边界差一个字母），按主榜标准它 0 分。关注名单存在的意义恰恰是兜住打分器兜不住的仓库。

**`google` 这种巨型 org 会带噪声**（`boringssl`、`xls` 之类）。已经用 AI 门槛滤过一遍，仍嫌吵就把它换成 `google-deepmind`。

### 时间与成本

| 键 | 默认 | 作用 |
|---|---|---|
| `streakTtlDays` | 30 | 「连续在榜 N 天」的记录多久没上榜就清掉 |
| `windowNominalHours` / `windowToleranceHours` | 24 / 1 | 窗口偏离标称值超过容差就在报告头部标「退化」 |
| `baselineMinAgeHours` | 20 | 至少多久之前的快照才能当基线 |
| `snapshotRetainDays` | 400 | 快照保留天数（gzip 后约 200KB/天） |
| `searchThrottleMs` | 2100 | Search 请求间隔。**别调小**，30 次/分是 GitHub 的硬限 |
| `graphqlMaxRetries` | 3 | GraphQL 限流/5xx 的重试次数 |
| `contributorPoolTopRepos` | 50 | 从涨得最多的前 N 个仓库里扒贡献者补进人物池；设 0 关闭 |
| `contributorsPerRepo` | 5 | 每个仓库扒几个贡献者 |

### ⚠ 改配置的一个坑

模板升级时**只补缺失的键，绝不覆盖你已有的键**——这是故意的（你删掉的 topic 不该被下次升级偷偷加回来）。副作用是：

> **数组是整体替换语义。** 新版模板往 `topics` 或 `keywords.include` 里加了词，你**已经存在**的 `config.json` 不会自动拿到。想要就手工补，或者把 `config.json` 删掉让它重新生成（会丢掉你的自定义）。

标量新键（比如 `aiThreshold`）会自动补上，不受此限。

## 6. 排障

### 退出码

| 码 | 含义 | 怎么办 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 配置文件语法错 | stderr 会指出文件路径。**故意不回退默认值**——静默回退会让你以为改生效了 |
| 2 | 拿不到 token | `gh auth status` 看登录是否还在；或设环境变量 `GITHUB_TOKEN` |
| 3 | 网络整体失败 | 看 `run.log`。**失败时绝不写报告**，宁可让你看见失败也不投一份看着正常的空报告 |

### 常见症状

**任务乙说「今天没有报告」**
按顺序查：① 任务甲是不是没跑（看 `automation-runs.json`）；② 间隔够不够（§4）；③ `tail -50 run.log` 看脚本是不是退了非零码。

**报告头部写着「窗口 48 小时」**
这不是 bug，是降级提示：昨天漏跑了，所以基线是前天的快照，所有「日增」实际覆盖 48 小时。脚本刻意不把它折算成一天，也刻意不假装是 24 小时。

**涨粉榜一直空白，写着「T+1 起可用」**
第一次运行必然如此——GitHub 没有任何 follower 历史接口，只能靠自建快照隔日做差。第二天起就有了。如果第三天还空，查 `snapshots/` 里是不是只有一份文件。

**榜单里出现明显不是 AI 的项目**
把它的 topics 抄出来，对照 §5 看是哪个词把它捞进来的，然后从 `config.json` 的 `topics` 里删掉那个词。**删之前先看 §5 那条「删词代价可能大一个量级」的实测记录。**

**报告里 star 日增全挤在一个很窄的区间**
说明基线快照被人为改过（例如测试时伪造过）。删掉 `snapshots/` 下可疑的那份，让它重新自然积累。

**磁盘涨得快**
`snapshotRetainDays` 调小。gzip 后约 200KB/天，默认 400 天约 80MB。

### 有用的开关

| 参数 | 用途 |
|---|---|
| `--data-dir <path>` | 换数据目录。**排障时务必用它**，别拿真实目录做实验 |
| `--skip-discover` | 跳过 14 分钟的候选池发现，只做快照+做差+出报告。复跑排障时用 |
| `--dry-run` | 只发现和快照，不出报告。**注意：它和完整运行一样慢**，它在跑完整个人物池之后才返回，省下的只有渲染 |

## 7. 已知限制

- **窗口不是日历日**，是「过去 24 小时」（今天 07:00 减昨天 07:00）。这是刻意取舍：单个任务就能完成，且包含美国白天那段 GitHub 高活跃期。跟第三方的「日历日榜」对不上账是预期行为。
- **池外的爆款会漏**：不在候选池、又没登上 GitHub 全站 Trending 的垂直新秀抓不到。缓解办法是把它加进 `watchlist`。
- **涨粉榜只覆盖人物池**：池外的人涨粉再多也统计不到。人物池 = 池内仓库的 owner（只算 `User`，组织归关注名单栏）+ 涨得最多的前 N 个仓库的贡献者。
- **Trending 兜底是 HTML 抓取**，GitHub 改版即失效。它只在冷启动路径上，失效后主链路不受影响，但报告里会明写「Trending 兜底不可用」。
- **`stargazers` 接口对他人仓库返回 404**（实测），所以 star 日增没法零冷启动精确回溯，只能靠快照做差。哪天 GitHub 放开，这套可以大幅简化。
- **一批 GraphQL 失败会丢掉整次运行**：约 44 个批次里任一批在 4 次尝试后仍失败就抛出。真机单次运行里观测到过 3 次真实 502/504 重试，所以这不是假设。目前的取舍是「宁可失败也不出空报告」。
