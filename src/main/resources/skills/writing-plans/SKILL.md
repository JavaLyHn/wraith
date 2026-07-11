---
name: writing-plans
description: |
  当你拿到一份 spec 或多步骤任务的需求、动代码之前使用:把任务拆成「假设执行者对本代码库零上下文」也能照做的、有序、可测试的小步计划。
  触发场景:有了 spec/需求,准备实现一个多步骤任务时。先 load_skill。
version: "1.0.0"
author: Wraith CLI
tags: [process, planning, spec]
---

# 写实现计划(Writing Plans)

## 概述

写全面的实现计划,**假设执行工程师对我们的代码库零上下文、品味存疑**。把他们需要知道的一切都写清楚:每个任务动哪些文件、代码、测试、可能要查的文档、怎么测。把整个计划拆成一口一个的小任务。DRY、YAGNI、TDD、频繁提交。

假设他们是熟练开发者,但几乎不了解我们的工具链和问题域。假设他们不太懂好的测试设计。

**开始时声明:**「我在用 writing-plans 技能创建实现计划。」

**保存到:** `docs/superpowers/plans/YYYY-MM-DD-<功能名>.md`
- (用户对计划位置的偏好覆盖此默认)

## 范围检查

如果 spec 覆盖多个独立子系统,它本应在 brainstorming 阶段就拆成子项目 spec。若没拆,建议拆成多份计划——每个子系统一份。每份计划应能独立产出可运行、可测试的软件。

## 文件结构

在定义任务之前,先规划出会创建/修改哪些文件、各自负责什么。分解决策在这里定下来。

- 用清晰边界、定义良好的接口来设计单元。每个文件一个清晰职责。
- 你对「能一次装进上下文」的代码推理最好,文件聚焦时编辑更可靠。宁可小而聚焦,不要大而全。
- 一起改动的文件放一起。**按职责拆,不按技术分层拆。**
- 既有代码库里遵循既定模式。若代码库用大文件,别擅自重构——但你正在改的文件若已臃肿,把「拆分」纳入计划是合理的。

这个结构决定任务分解。每个任务应产出能独立理解的自包含改动。

## 任务定尺寸

一个任务是「能自带一次测试循环、值得一次新评审员把关」的最小单元。画任务边界时:把 setup、配置、脚手架、文档步骤折进「其交付物需要它们」的那个任务;只在「评审员可能否决这个任务却批准邻居」的地方切分。每个任务以一个可独立测试的交付物收尾。

## 一口一个的步骤粒度

**每步是一个动作(2-5 分钟):**
- 「写会失败的测试」——一步
- 「跑它确认失败」——一步
- 「写最少实现让测试通过」——一步
- 「跑测试确认通过」——一步
- 「提交」——一步

## 计划文档头

**每份计划必须以这个头开始:**

```markdown
# [功能名] 实现计划

> **给 agent 执行者:** 必用子技能:用 subagent-driven-development(推荐)或 executing-plans 逐任务实现本计划。步骤用复选框(`- [ ]`)语法跟踪。

**目标:** [一句话:这构建什么]

**架构:** [2-3 句:方法]

**技术栈:** [关键技术/库]

## 全局约束

[spec 里的项目级要求——版本下限、依赖限制、命名与文案规则、平台要求——每条一行,值从 spec 逐字照抄。每个任务的要求都隐含包含本节。]

---
```

## 任务结构

````markdown
### Task N: [组件名]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Interfaces:**
- Consumes: [本任务用到的前置任务产物——精确签名]
- Produces: [后续任务依赖的——精确函数名、参数与返回类型。任务实现者只看得到
  自己的任务;这一块是他们得知邻居任务用了哪些名字/类型的唯一途径。]

- [ ] **Step 1: 写会失败的测试**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: 写最小实现**

```python
def function(input):
    return expected
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## 不许占位符

每一步都必须含工程师真正需要的实际内容。以下是**计划失败**——永远别写:
- "TBD"、"TODO"、"稍后实现"、"填细节"
- "加上适当的错误处理" / "加校验" / "处理边界情况"
- "为上面写测试"(却没有实际测试代码)
- "类似 Task N"(重复代码——工程师可能乱序读任务)
- 只说做什么、不给怎么做的步骤(代码步骤必须有代码块)
- 引用任何任务里都没定义的类型/函数/方法

## 记住
- 永远给精确文件路径
- 每步都给完整代码——改代码的步骤就把代码写出来
- 精确命令 + 预期输出
- DRY、YAGNI、TDD、频繁提交

## 自审

写完整份计划后,用新眼光对照 spec 检查。这是你自己跑的清单——不是派子 agent。

**1. spec 覆盖:** 扫 spec 每节/每条需求。能指到实现它的任务吗?列出缺口。
**2. 占位符扫描:** 在计划里搜上面「不许占位符」的红旗模式,修掉。
**3. 类型一致性:** 后续任务用的类型/方法签名/属性名,和前面任务定义的对得上吗?Task 3 叫 `clearLayers()`、Task 7 叫 `clearFullLayers()` 就是 bug。

发现问题就地修,不必再审。发现有 spec 需求没对应任务,补任务。

## 执行交接

存好计划后,给出执行选择:

> **「计划已完成并存到 `docs/superpowers/plans/<文件>.md`。两种执行方式:**
> **1. 子 agent 驱动(推荐)** —— 每任务派新子 agent,任务间评审,快速迭代
> **2. 内联执行** —— 本会话执行,带检查点的批量执行
> **选哪种?」**

## wraith 说明

- wraith 的多步执行有 `/plan`(Plan-and-Execute)与 `/team`(多 agent)模式;上文的「子 agent 驱动 / 内联执行」对应到 wraith 即这两种路径。
- 项目铁律:验证含 typecheck / vitest / mvn;改 Java 需重打 jar。

---
> 本技能完整翻译自 obra/superpowers(MIT)`writing-plans`;末节为 wraith 说明。references/ 下附「计划文档评审 prompt」。
