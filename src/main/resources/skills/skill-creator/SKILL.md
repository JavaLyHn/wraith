---
name: skill-creator
description: |
  创建新技能、修改改进已有技能、衡量技能表现。当用户想从零创建技能、编辑/优化已有技能、跑评测测试技能、做带方差分析的基准、或优化技能 description 以提升触发准确度时使用。务必在用户提到「做个技能/写 SKILL.md/优化技能触发」时使用。
  触发场景:用户想新建/编辑/优化一个 skill 时。先 load_skill。
version: "1.0.0"
author: Wraith CLI
tags: [meta, skill, authoring]
---

# Skill Creator

一个用于创建新技能并迭代改进它们的技能。

> ⚠️ **wraith 环境说明**:本文档大量描述上游 Anthropic 的「技能评测流水线」(子 agent 并行跑测试、`eval-viewer/generate_review.py`、benchmark 聚合、`run_loop.py` description 优化、`package_skill.py` 打包等)。**这些脚本在 wraith 里不运行**(见 scripts/eval-viewer/agents 目录及其 README)。对 wraith 用户真正适用的是下面「创建技能 / 技能写作指南 / 写作风格」等章节;评测流水线部分为完整性与溯源保留、已翻译,按需参考即可。

高层看,创建一个技能的流程是这样:

- 决定你想让技能做什么、大致怎么做
- 写一份技能草稿
- 造几个测试 prompt,用「带该技能的 claude」跑它们
- 帮用户从定性和定量两方面评估结果
  - 跑的同时,若还没有定量评测就起草一些(有的话按需用或改)。然后向用户解释它们
  - 用 `eval-viewer/generate_review.py` 脚本把结果展示给用户看,也让他们看定量指标
- 根据用户对结果的评估反馈(以及定量基准暴露的明显缺陷)重写技能
- 重复直到满意
- 扩大测试集,更大规模再来一遍

你用这个技能时的工作,是搞清用户处在流程哪一步,然后跳进去帮他推进。比如他说「我想做个关于 X 的技能」,你可以帮他缩小含义、写草稿、写测试用例、搞清他想怎么评估、跑完所有 prompt,再重复。

反过来,也许他已经有草稿了。那就直接进「评测/迭代」那段循环。

当然要灵活——如果用户说「我不用跑一堆评测,跟我随便聊聊就行」,那就那样。

技能做好后(顺序灵活),你还能跑 description 改进器(有单独脚本),优化技能的触发。

行吧?行。

## 和用户沟通

skill-creator 的使用者编程术语熟悉度差异很大。现在有个趋势:Claude 的能力让水管工也打开终端、让父母祖辈去搜「怎么装 npm」。但大部分用户大概还算懂电脑。

所以请注意上下文线索来决定怎么措辞!默认情况给你个概念:
- "evaluation"、"benchmark" 处于边界,但 OK
- "JSON"、"assertion" 这种,得看到用户明显懂的线索再不解释地用

拿不准时简短解释术语无妨。

---

## 创建技能

### 捕捉意图

先理解用户意图。当前对话可能已含用户想固化的工作流(如「把这个变成技能」)。若是,先从对话历史里提取答案——用了什么工具、步骤顺序、用户做的纠正、观察到的输入/输出格式。用户可能要补空,并应在进下一步前确认。

1. 这个技能应让 Claude 能做什么?
2. 它该何时触发?(什么用户措辞/上下文)
3. 期望输出格式是什么?
4. 要不要建测试用例验证技能有效?输出可客观验证的技能(文件转换、数据提取、代码生成、固定工作流步骤)受益于测试用例;输出主观的(写作风格、艺术)通常不需要。按技能类型建议合适默认,但让用户定。

### 访谈与调研

主动问边界情况、输入/输出格式、示例文件、成功标准、依赖。这部分敲定前先别写测试 prompt。

查可用 MCP——若对调研有用(搜文档、找相似技能、查最佳实践),有子 agent 就并行调研,否则内联。带着上下文来,减轻用户负担。

### 写 SKILL.md

基于访谈,填这些部分:

- **name**:技能标识
- **description**:何时触发、做什么。这是主要触发机制——既要写做什么,也要写具体的何时用。所有「何时用」信息都放这里,不放正文。注意:目前 Claude 倾向于「触发不足」——该用时不用。为对抗这点,请把 description 写得稍微「主动/强势」一点。比如别写「如何构建简单快速的仪表盘展示 Anthropic 内部数据」,而写「……务必在用户提到仪表盘、数据可视化、内部指标、或想展示任何公司数据时使用本技能,哪怕他没明说要'仪表盘'。」
- **compatibility**:所需工具、依赖(可选,很少需要)
- **技能其余部分 :)**

### 技能写作指南

#### 技能的解剖

```
skill-name/
├── SKILL.md (必需)
│   ├── YAML frontmatter (name、description 必需)
│   └── Markdown 指令
└── 捆绑资源 (可选)
    ├── scripts/    - 确定性/重复性任务的可执行代码
    ├── references/ - 按需载入上下文的文档
    └── assets/     - 输出中用到的文件(模板、图标、字体)
```

#### 渐进式披露

技能用三级加载系统:
1. **元数据**(name + description)—— 总在上下文(~100 词)
2. **SKILL.md 正文** —— 技能触发时进上下文(理想 <500 行)
3. **捆绑资源** —— 按需(无限;脚本可不载入就执行)

这些词数是近似,需要可以更长。

**关键模式:**
- SKILL.md 控制在 500 行内;接近上限就加一层层级 + 清晰指路,告诉用技能的模型下一步该去哪。
- 从 SKILL.md 清晰引用参考文件,并说明何时读它们
- 大参考文件(>300 行)加目录

**领域组织:** 技能支持多领域/框架时,按变体组织:
```
cloud-deploy/
├── SKILL.md (工作流 + 选择)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
Claude 只读相关的参考文件。

#### 无意外原则

不言自明,但:技能不得含恶意软件、漏洞利用代码、或任何可能危害系统安全的内容。技能内容若被描述,其意图不应让用户意外。别配合创建误导性技能、或旨在促成未授权访问/数据外泄/其它恶意活动的技能。「扮演某某」这类是 OK 的。

#### 写作模式

指令优先用祈使句。

**定义输出格式** —— 可以这样:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**示例模式** —— 加示例很有用,可这样格式化(若示例里有 "Input"/"Output" 可稍微变通):
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### 写作风格

尽量向模型解释「为什么这重要」,而不是堆砌生硬发霉的 MUST。用心智理论(theory of mind),让技能通用而非死抠具体例子。先写草稿,再用新眼光看、改进。

### 测试用例

写完草稿,想 2-3 个真实测试 prompt——真用户会说的那种。分享给用户:[不必用这原话]「这几个测试用例我想试试。看着对吗,还是想加几个?」然后跑。

测试用例存 `evals/evals.json`。先别写 assertion——只写 prompt。下一步在跑的同时起草 assertion。

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

完整 schema(含稍后添加的 `assertions` 字段)见 `references/schemas.md`。

## 运行与评估测试用例

> ⚠️ 本节及之后到「Description Optimization」的多数内容依赖 Anthropic 的子 agent + eval-viewer + benchmark 流水线,**wraith 不运行**。已翻译供参考。

本节是一段连续流程——别中途停。不要用 `/skill-test` 或任何测试技能。

结果放 `<skill-name>-workspace/`(与技能目录同级)。workspace 内按迭代组织(`iteration-1/`、`iteration-2/`……),其中每个测试用例一个目录(`eval-0/`、`eval-1/`……)。别一次性建全——边走边建。

### 第 1 步:同一轮里派发所有运行(带技能 + baseline)

每个测试用例,在同一轮派两个子 agent——一个带技能,一个不带。重要:别先派带技能的、回头再补 baseline。一次全启动,让它们差不多同时完成。

**带技能运行:**
```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- Outputs to save: <what the user cares about — e.g., "the .docx file", "the final CSV">
```

**baseline 运行**(同 prompt,baseline 视上下文而定):
- **创建新技能**:完全不带技能。同 prompt、无 skill path,存到 `without_skill/outputs/`。
- **改进已有技能**:旧版本。编辑前快照技能(`cp -r <skill-path> <workspace>/skill-snapshot/`),让 baseline 子 agent 指向快照,存到 `old_skill/outputs/`。

给每个测试用例写 `eval_metadata.json`(assertion 现在可空)。给每个 eval 起个描述性名字(不只是 "eval-0")。目录也用这名字。若本迭代用新/改过的 eval prompt,为每个新 eval 目录建这些文件——别假设从上次迭代自动带过来。

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": []
}
```

### 第 2 步:运行进行中,起草 assertion

别干等——利用这时间。为每个测试用例起草定量 assertion 并向用户解释。若 `evals/evals.json` 已有 assertion,复审并解释它们查什么。

好的 assertion 客观可验证、有描述性名字——在 benchmark 查看器里读起来清晰,让人一眼懂每条查什么。主观技能(写作风格、设计质量)更适合定性评估——别硬给需要人判断的东西套 assertion。

起草后更新 `eval_metadata.json` 和 `evals/evals.json`。也向用户解释他们在查看器里会看到什么——定性输出 + 定量 benchmark。

### 第 3 步:运行完成时,捕获时序数据

每个子 agent 任务完成,你会收到含 `total_tokens` 和 `duration_ms` 的通知。立即存到该运行目录的 `timing.json`:

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

这是唯一捕获机会——它随任务通知来、别处不持久化。通知一到就处理,别攒着批。

### 第 4 步:评分、聚合、启动查看器

全部跑完后:

1. **给每个运行评分** —— 派 grader 子 agent(或内联)读 `agents/grader.md`,对照输出评估每条 assertion。结果存各运行目录的 `grading.json`。expectations 数组必须用字段 `text`、`passed`、`evidence`(不是 `name`/`met`/`details` 等)——查看器依赖这些确切字段名。可编程检查的 assertion,写脚本跑而非肉眼看——脚本更快、更可靠、可跨迭代复用。
2. **聚合成 benchmark** —— 从 skill-creator 目录跑聚合脚本:
   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```
   产出 `benchmark.json` 和 `benchmark.md`,含各配置的 pass_rate、时间、token,带 mean ± stddev 和 delta。手动生成 benchmark.json 时,查看器期望的确切 schema 见 `references/schemas.md`。把每个 with_skill 版放在其 baseline 之前。
3. **做一遍分析** —— 读 benchmark 数据,揭示聚合统计可能掩盖的模式。见 `agents/analyzer.md`(「Analyzing Benchmark Results」节)——如「不管有无技能都通过的 assertion(不区分)」「高方差 eval(可能 flaky)」「时间/token 权衡」。
4. **启动查看器**(带定性输出 + 定量数据):
   ```bash
   nohup python <skill-creator-path>/eval-viewer/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "my-skill" \
     --benchmark <workspace>/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```
   迭代 2+ 还要传 `--previous-workspace <workspace>/iteration-<N-1>`。

   **Cowork / 无头环境:** 若 `webbrowser.open()` 不可用或无显示,用 `--static <output_path>` 写独立 HTML 而非起服务。用户点「Submit All Reviews」时反馈会下载成 `feedback.json`;下载后把它拷进 workspace 供下一迭代读取。

   注意:请用 generate_review.py 建查看器,不必手写 HTML。
5. **告诉用户** 类似:「我在你浏览器里打开了结果。两个标签——『Outputs』逐个点开测试用例留反馈,『Benchmark』看定量对比。看完回来告诉我。」

### 用户在查看器里看到什么

「Outputs」标签一次显示一个测试用例:Prompt、Output(尽量内联渲染)、Previous Output(迭代 2+,折叠)、Formal Grades(若评过分,折叠)、Feedback(输入即自动保存)、Previous Feedback(迭代 2+)。

「Benchmark」标签显示统计摘要:各配置的通过率/时序/token,带逐 eval 拆解和分析观察。

用 prev/next 按钮或方向键导航。完成后点「Submit All Reviews」,把所有反馈存到 `feedback.json`。

### 第 5 步:读反馈

用户说完成后,读 `feedback.json`:

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "the chart is missing axis labels", "timestamp": "..."},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..."},
    {"run_id": "eval-2-with_skill", "feedback": "perfect, love this", "timestamp": "..."}
  ],
  "status": "complete"
}
```

空反馈 = 用户觉得没问题。把改进聚焦在用户有具体抱怨的用例上。

用完杀掉查看器:
```bash
kill $VIEWER_PID 2>/dev/null
```

---

## 改进技能

这是循环的核心。你跑了测试、用户审了结果,现在要根据反馈把技能做得更好。

### 怎么想改进

1. **从反馈里泛化。** 大局是:我们想造能被用一百万次(也许字面意义上,甚至更多)、跨很多不同 prompt 的技能。这里你和用户只在几个例子上反复迭代,因为这样更快。用户对这些例子门儿清、评新输出很快。但如果技能只对这几个例子有效,它就没用。别做琐碎的过拟合改动、或压迫式的 MUST;有个顽固问题时,不妨换个比喻、或推荐不同的工作模式。试错很便宜,也许就撞上好东西。
2. **保持 prompt 精简。** 删掉不出力的部分。一定要读 transcript,不只看最终输出——若技能让模型浪费时间做无用功,试着去掉那部分看看。
3. **解释为什么。** 尽力解释你要模型做的每件事**背后的原因**。今天的 LLM 很**聪明**,有好的心智理论,给个好 harness 就能超越死板指令真正把事做成。哪怕用户反馈简短或沮丧,也试着真正理解任务、理解用户为何那么写,把这份理解注入指令。若你发现自己在全大写写 ALWAYS/NEVER、或用超死板结构,那是黄旗——尽量重构、解释理由,让模型明白你要求的东西为何重要。那更人性、更强大、更有效。
4. **找测试用例间重复的活。** 读测试运行的 transcript,注意子 agent 是不是都独立写了相似的 helper 脚本或走了同样的多步法。若 3 个用例都让子 agent 写了 `create_docx.py` 或 `build_chart.py`,那是强信号:技能该捆绑那个脚本。写一次,放 `scripts/`,让技能用它,省得每次调用重新造轮子。

这任务挺重要(我们在这儿是想创造每年数十亿的经济价值!),你的思考时间不是瓶颈;慢慢来、好好琢磨。建议写份修订草稿,再用新眼光看、改进。真的尽力钻进用户脑子里,理解他要什么、需要什么。

### 迭代循环

改进技能后:
1. 把改进应用到技能
2. 把所有测试用例重跑进新的 `iteration-<N+1>/` 目录,含 baseline。新建技能的 baseline 永远是 `without_skill`(跨迭代不变);改进已有技能的,凭判断选 baseline:用户带来的原版、或上一迭代。
3. 用 `--previous-workspace` 指向上一迭代启动查看器
4. 等用户审完
5. 读新反馈、再改进、重复

一直到:用户说满意 / 反馈全空(都挺好)/ 你没在做有意义的进展。

---

## 进阶:盲对比

想更严格地对比两个版本时(如用户问「新版真更好吗?」),有盲对比系统。细节见 `agents/comparator.md` 和 `agents/analyzer.md`。基本思路:把两份输出给独立 agent、不告诉它谁是谁,让它判质量;再分析赢家为何赢。可选、需子 agent,多数用户用不上——人审循环通常够了。

---

## Description 优化

SKILL.md frontmatter 的 description 是决定 Claude 是否调用技能的主要机制。创建/改进技能后,可提议优化 description 以提升触发准确度。

### 第 1 步:生成触发评测 query

造 20 个 eval query——should-trigger 与 should-not-trigger 混合。存为 JSON:
```json
[
  {"query": "the user prompt", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

query 必须真实、是 Claude Code 或 Claude.ai 用户真会打的。不是抽象请求,而是具体、有细节的:文件路径、用户工作/处境的个人上下文、列名与值、公司名、URL、一点背景故事。有的可小写、含缩写/错字/口语。用不同长度混合,聚焦边界而非一目了然的(用户会有机会过目)。

坏:`"Format this data"`、`"Extract text from PDF"`、`"Create a chart"`
好:`"ok so my boss just sent me this xlsx file (its in my downloads, called something like 'Q4 sales final FINAL v2.xlsx') and she wants me to add a column that shows the profit margin as a percentage. The revenue is in column C and costs are in column D i think"`

**should-trigger**(8-10 个):考虑覆盖。同一意图的不同措辞——有正式有随意;含用户没明说技能名/文件类型但明显需要的情况;塞点少见用例和「与别技能竞争但本技能该赢」的情况。

**should-not-trigger**(8-10 个):最有价值的是「差一点命中」——与技能共享关键词/概念但实际需要别的东西的 query。想邻近领域、朴素关键词匹配会误触发的歧义措辞、以及触及技能所做但更适合别的工具的上下文。要避免:别把 should-not-trigger 做得明显无关。给 PDF 技能配「写个 fibonacci 函数」当负例太简单、测不出东西。负例应真正刁钻。

### 第 2 步:与用户复审

用 HTML 模板把 eval 集给用户复审:
1. 读模板 `assets/eval_review.html`
2. 替换占位符:`__EVAL_DATA_PLACEHOLDER__` → eval 项的 JSON 数组(不加引号——它是 JS 变量赋值);`__SKILL_NAME_PLACEHOLDER__` → 技能名;`__SKILL_DESCRIPTION_PLACEHOLDER__` → 当前 description
3. 写到临时文件(如 `/tmp/eval_review_<skill-name>.html`)并打开:`open /tmp/eval_review_<skill-name>.html`
4. 用户可编辑 query、切换 should-trigger、增删项,再点「Export Eval Set」
5. 文件下载到 `~/Downloads/eval_set.json`——查 Downloads 里最新版(可能有 `eval_set (1).json`)

这步重要——坏 eval query 导致坏 description。

### 第 3 步:跑优化循环

告诉用户:「这会花点时间——我在后台跑优化循环,定期查看。」
把 eval 集存到 workspace,后台跑:
```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```
用你 system prompt 里的 model ID(驱动当前会话的那个),使触发测试匹配用户实际体验。跑时定期 tail 输出,给用户更新到第几轮、分数如何。

它自动跑完整优化循环:把 eval 集分 60% 训练 / 40% 留出测试,评估当前 description(每 query 跑 3 次得可靠触发率),再让 Claude 基于失败项提改进,在训练+测试上重评,最多迭代 5 次。完成后浏览器开 HTML 报告,返回含 `best_description` 的 JSON——按测试分而非训练分选,避免过拟合。

### 触发如何工作

理解触发机制有助设计更好的 eval query。技能出现在 Claude 的 `available_skills` 列表(名字+description),Claude 据此决定是否查阅。要点:Claude 只对「自己不易搞定」的任务查技能——「读这个 PDF」这类简单一步 query 可能不触发(哪怕 description 完美),因为基础工具就能直接处理。复杂、多步或专门的 query 在 description 匹配时可靠触发。所以你的 eval query 应足够实质,让 Claude 真能从查技能中获益。像「读文件 X」这种简单 query 是差的测试用例。

### 第 4 步:应用结果

取 JSON 输出的 `best_description` 更新技能 SKILL.md frontmatter。给用户看前后对比,报告分数。

---

### 打包与呈现(仅当有 `present_files` 工具)

查是否有 `present_files` 工具。没有就跳过。有就打包并把 .skill 文件呈现给用户:
```bash
python -m scripts.package_skill <path/to/skill-folder>
```
打包后,把结果 `.skill` 文件路径指给用户以便安装。

---

## Claude.ai 专属说明

在 Claude.ai,核心工作流一样(草稿 → 测试 → 复审 → 改进 → 重复),但因为 Claude.ai 无子 agent,部分机制变化:

**跑测试用例:** 无子 agent = 无并行。每个用例,读技能 SKILL.md,再自己照其指令完成测试 prompt。一次一个。这不如独立子 agent 严格(你既写又跑技能,有完整上下文),但是有用的 sanity check——人审步骤补足。跳过 baseline——直接用技能完成任务。
**复审结果:** 打不开浏览器就整个跳过浏览器查看器,直接在对话里呈现。每个用例展示 prompt 和输出。输出是用户要看的文件(如 .docx/.xlsx)就存到文件系统告诉路径。内联问反馈:「这样如何?想改什么?」
**基准:** 跳过定量基准——它靠 baseline 对比,无子 agent 没意义。聚焦用户定性反馈。
**迭代循环:** 同前——改进、重跑、问反馈——只是中间没浏览器查看器。
**description 优化:** 需 `claude` CLI(尤其 `claude -p`),仅 Claude Code 有。Claude.ai 上跳过。
**盲对比:** 需子 agent。跳过。
**打包:** `package_skill.py` 在任何有 Python + 文件系统处都能跑。
**更新已有技能:** 用户可能要你更新已有技能而非新建:保留原名(目录名和 `name` 字段不变);编辑前拷到可写位置(装好的路径可能只读,拷到 `/tmp/skill-name/` 编辑并从副本打包);手动打包先在 `/tmp/` 暂存再拷到输出目录。

---

## Cowork 专属说明

在 Cowork:有子 agent,主工作流(并行派测试、跑 baseline、评分等)都能用(超时严重时可改串行);无浏览器/显示,生成查看器用 `--static <output_path>` 写独立 HTML,再给用户可点的链接;Cowork 里 Claude 似乎不爱在跑完测试后生成查看器,所以重申(全大写):**跑完测试后、自己评估输入【之前】,永远先用 `generate_review.py` 生成 eval 查看器**,尽快把例子摆到人面前!反馈:无运行服务,查看器「Submit All Reviews」会把 `feedback.json` 下载成文件,你从那读(可能要先请求访问);打包能用;description 优化(`run_loop.py`/`run_eval.py`)在 Cowork 应能用(经 subprocess 用 `claude -p`),但请等技能完全做好、用户认可后再跑;更新已有技能:按上面 Claude.ai 节的指引。

---

## 参考文件

agents/ 目录含专门子 agent 的指令,需要派相应子 agent 时读:
- `agents/grader.md` —— 如何对照输出评估 assertion
- `agents/comparator.md` —— 如何盲 A/B 对比两份输出
- `agents/analyzer.md` —— 如何分析一个版本为何胜过另一个

references/ 目录:
- `references/schemas.md` —— evals.json、grading.json 等的 JSON 结构

---

再强调一遍核心循环:

- 搞清技能是关于什么的
- 起草或编辑技能
- 用带技能的 claude 跑测试 prompt
- 和用户一起评估输出:建 benchmark.json、跑 `eval-viewer/generate_review.py` 帮用户复审;跑定量评测
- 重复直到你和用户都满意
- 打包最终技能返给用户

如果你有 TodoList,请把这些步骤加进去别忘。Cowork 里请特别加「建 evals JSON 并跑 `eval-viewer/generate_review.py` 让人复审测试用例」。

祝好运!

---
> 本技能 SKILL.md 与 references/schemas.md 完整翻译自 anthropics/skills `skill-creator`(见 LICENSE.txt);评测流水线(agents/scripts/eval-viewer/assets)为上游原文保留、wraith 不运行。wraith 里写技能主要参考上文「创建技能 / 技能写作指南」。
