## Wraith v1.4.0 — Windows 落地 + 文档资料库 + GitHub AI 日报

自 v1.3.0 起 **340 个提交**。本版最大的变化是 **Windows 从「代码完成」走到了「真机跑通」**。

### 安装

**macOS（Apple Silicon）**：下载 `Wraith-1.4.0-arm64.dmg`，拖进「应用程序」。

安装包**未签名**，首次打开会被 Gatekeeper 拦住：

```bash
xattr -cr /Applications/Wraith.app
```

然后正常打开即可。（或者右键 →「打开」→ 再点「打开」。）

**Windows**：本次**没有出安装包**。Windows 的 NSIS 包只能在 Windows 机器上构建
（jlink 只能产出宿主平台的 JRE，交叉构建会静默产出一个跑不起来的包，所以项目里把它硬拒绝了）。
需要的话按 [`docs/windows-release.md`](docs/windows-release.md) 在 Windows 上自行构建，
或直接从源码跑 [`docs/windows-quickstart.md`](docs/windows-quickstart.md)。

装完首次启动要先配一个模型：左侧栏 **配置 → Provider 配置** → 填 API Key → **测试连接** → 保存 → 设默认。

---

### ✅ Windows：从「代码完成」到「真机跑通」

v1.3.0 的时候 Windows 对等的代码写完了，但**一行都没在真 Windows 上跑过**。这一版补上了。

真机验证的主链路：安装启动 · 配模型 · 对话 · MCP · **命令沙箱（AppContainer）** · IM 网关 · 定时任务。

**真机立刻证明了这件事非做不可**——它抓出了代码审查抓不到的缺陷：

> **AppContainer 的管道 DACL 漏了创建者，沙箱其实从来没真正起来过。**
> 也就是说在真机跑之前，这一整块的「代码完成」是**假绿**。

同批在真机上修掉的还有：CLI 行编辑失灵（JLine 的 jni provider 被 JDK 的 native access 检查挡住）、
「终端不支持 ANSI」是探测逻辑自身误判、GBK 吞 emoji、思考流被两层缓冲各吞一半、
提交后 8.26 秒零反馈（同步的 pre-turn 快照卡在提交路径上）。诊断入口：`wraith terminal doctor`。

> ⚠️ **诚实边界**：「主链路已验」**不等于**「124 条验收清单全部通过」。
> 桌宠 FFI、部分面板的边角情况尚未逐项确认，清单见 [`docs/windows-dev.md`](docs/windows-dev.md)。

---

### 📄 文档资料库（新面板）

左侧栏「资料」组新增**文档**面板：一个跨项目的扁平知识存放处（`~/.wraith/documents/`）。

- **目录本身是唯一真相源** —— 不建索引文件，列表由 readdir + stat 现算，往目录里丢个文件它就出现
- 路径安全走三步校验（拒绝分隔符 / `..` / 绝对路径，再验父目录）
- **agent 也读得到** —— 新增 `documents_list` / `documents_read` 两个只读工具。
  此前资料库只有桌面 UI 读得到，agent 在任何项目里都读不到；而 `read_file` 被
  `PathGuard` 锁在当前项目内，跨项目的知识存放处天然够不着

---

### 📊 GitHub AI 日报（新特性）

每天自动产出「昨日 AI 领域 star 涨最多 / fork 涨最多 / 涨粉最多的人」，投递到你选的渠道。

- **快照做差**：GitHub 没有任何 star/follower 的历史接口（`stargazers` 对他人仓库直接 404），
  所以自建每日快照、隔日做差。GraphQL 批量把取数成本压到**每天约 40 point**（额度 5000/小时）
- **取数由系统调度跑，不挂在自动化面板**：面板任务的 `execute_command` 有 60 秒硬超时且沙箱禁网，
  而一次完整取数要 31 分钟、全程调 GitHub API —— 挂在面板里永远跑不起来
- **prompt 就一句「生成今天的 GitHub AI 日报」**：怎么做写在内置 skill 里，不写在 prompt 里
- **失败就退非零码，绝不产出一份空报告**

安装与排障见 [`docs/runbooks/github-ai-daily.md`](docs/runbooks/github-ai-daily.md)（Windows 侧 cmd / PowerShell 双轨）。

---

### 🔍 RAG 索引：这一版唯一有实测数字的优化

新增**索引范围开关**，效果是量出来的（24 条冻结查询集，`scripts/rag-eval/`）：

| 配置 | MRR | R@10 |
|---|---|---|
| 全索引 | 0.2693 | 54.2% |
| **排除测试** | **0.3337（+24%）** | **66.7%** |

原因很具体：本仓库的测试方法名本身就在描述被测行为（`void thinExtractionSaysFetchSucceeded()`），
语义上与「这功能怎么实现的」高度相似，于是测试块压住主代码。

**两个开关必须分开**——合并成一个「排除测试和文档」会把 +24% 拖成 +9%，
因为「为什么这么设计」这类问题的答案**只在 `docs/` 里**。

其余 RAG 改进：一跳关系辐射图、索引进度带 ETA 与当前文件、**embedding「测试连接」按钮**
（此前验证后端唯一的办法是跑一次上千块的整库扫描）、索引记住自己用的是哪个 embedding 模型、
换模型后面板立刻提示重建。

---

### 其他

- **搜索后端终于能在桌面端配了** —— 此前只有读没有写（`config.getSearch` 有、`config.setSearch` 没有），
  只能去 CLI 敲 `/config search`
- **模型计价**：`设置 → 模型计价` 表单 + `/config pricing` CLI 写入口，成本按 cacheHit / cacheMiss / output 分档
- **快照能关了**：启动参数 / 运行期命令 / 桌面按钮三条路
- **思考型模型的 `reasoning_content` 回传**：不回传会导致**下一轮** 400，而且症状延迟一轮出现

---

### 已知限制

- **安装包未签名**，macOS 需 `xattr -cr`，Windows 会触发 SmartScreen
- **只出 arm64 mac 包**（与 v1.3.0 一致），Intel Mac 请从源码构建
- **Windows 无安装包**，需在 Windows 上自行构建
- Windows 的 124 条验收清单**未逐条走完**
- 无 agent 端到端评测（RAG 检索层有窄口指标，见上）
