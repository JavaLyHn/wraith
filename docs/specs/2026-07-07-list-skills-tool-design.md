# 设计：list_skills 工具（技能枚举方案 B）

日期：2026-07-07
分支：`fix/skill-list-prompt`（承接同一 bug 的方案 A → B 升级）

## 背景 / 问题

新增 skill 后，用户问"有哪些 skill"，模型回避作答（"我目前可用的 Skill 定义在系统提示词的 Skills 部分"），不肯把清单转述给用户。

根因（已在方案 A 定位）：skill 清单虽已注入每轮 system prompt 的"## 可用 Skills"段，但提示只教模型"何时 `load_skill`"，从未给模型一个"用户问技能时该执行的确定动作"，于是模型倾向回避、让用户自己去看系统提示。

方案 A（已提交 `5e1ea84`）补了一句"直接依据上面的清单列出"的文案引导。方案 B 更进一步：给模型一个**确定可调用的动作** `list_skills`，让"回答技能询问"从"复述系统提示"（模型不情愿）变成"调用工具再转述工具结果"（模型乐于执行且结果新鲜可信）。

## 目标

- 用户问"有哪些技能 / 你会做什么 / 列出 skill"时，模型稳定地列出当前启用 skill 的名称 + 简介。
- 权威来源是工具结果，而非模型对系统提示的复述。

## 非目标（YAGNI）

- 不加 `include_disabled` 参数、不分页。
- 不改 `/skill list` CLI 命令。
- 不改三层覆盖（builtin→project→user，user 胜）逻辑。

## 设计

### 1. 工具本体

在 `ToolRegistry.registerSkillTools()` 内，紧挨 `load_skill` 追加 `tools.put("list_skills", …)`：

- **参数**：无参（`createParameters()`）。
- **面向模型的描述**：
  > 当用户问"你有哪些技能 / 会做什么 / 列出 skill"时调用，返回当前启用的 skill 清单（名称 + 简介）。这是回答此类问题的权威来源，直接把结果转述给用户，不要回避、也不要让用户自己去看系统提示。
- **handler 逻辑**（`args -> String`）：
  1. `skillRegistry == null` → 返回 `list_skills 失败: Skill 系统未初始化`。
  2. 取 `skillRegistry.enabledSkills()`。
  3. 空 → 返回 `当前没有启用任何 skill。`
  4. 非空 → 逐条渲染 `- **<name>**（<displaySource>）：<desc>`，其中 `<desc>` 复用 `SkillIndexFormatter.truncateByCodepoint(description.trim(), 500)`。
  5. 若 `allSkills().size() > enabledSkills().size()`，末尾追加 `\n另有 <N> 个 skill 已禁用，可用 /skill on <name> 启用。`（N = 差值）。

### 2. 复用而非复制

description 截断复用 `SkillIndexFormatter.truncateByCodepoint(String, int)`（已 `static`，包内可见）。不新造截断代码。

### 3. 方案 A 提示重指向

将方案 A 在 `SkillIndexFormatter.format()` 追加的那句从"直接依据上面的清单向用户列出…"改为指向工具：

> 当用户询问你有哪些技能 / 会做什么 / 让你列出技能时，调用 `list_skills` 获取当前启用清单并转述给用户，不要回避、也不要让用户自己去看系统提示。

理由：留着"直接列出"与新工具会形成两条并行指令，模型可能各行其是；改成指向工具后，提示与工具合成一条确定动作。`SkillIndexFormatterTest.includesUserFacingListingInstruction` 断言的是"用户询问"和"名称与简介"两个子串——重指向后文案仍含"用户询问"，但不再含"名称与简介"，故该测试断言需同步更新为校验"list_skills"子串（见测试节）。

## 测试（TDD，先红后绿）

### ToolRegistry 层（新建 `ToolRegistryTest` 或复用既有）

- `list_skills` 已注册，且参数为空。
- 有启用 skill 时，输出含其 name 与 description。
- 存在禁用 skill 时，输出含"另有 N 个 skill 已禁用"尾注。
- `skillRegistry == null`（未 set）时，返回"未初始化"提示。

> 注：`ToolRegistry` 构造/依赖注入较重，测试需先探明其最小可实例化路径（`setSkillRegistry` 注入一个用内存 `SkillStateStore` + 临时目录构造的 `SkillRegistry`）。若实例化成本过高，退化为对 handler 逻辑抽取的小测试——落地计划阶段据实探明后决定。

### SkillIndexFormatter 层（更新既有测试）

- `includesUserFacingListingInstruction`：断言从"名称与简介"改为校验输出含 `list_skills`（与重指向后的文案一致），保留"用户询问"断言。

## 交付链路

分支续用 `fix/skill-list-prompt` → 红 → 绿 → 全量跑 skill + tool 相关单测无回归 → `mvn -q -DskipTests package` 重建 jar → 部署 `~/.wraith/wraith.jar` → 用户完全重启桌面 App，问"有哪些 skill"肉眼验证 → FF-merge 回 main + 推送（推送前用户点头）。

## 安全

无密钥面。提交前照例 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
