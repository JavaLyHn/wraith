# 交互式选择器设计文档

## 背景与问题

当前 wraith 在需要用户做选择时，存在四套并行的交互机制，体验不一致且部分场景只能靠手动输入数字：

1. **SlashPalette** — 方向键导航的选择列表，但仅在会话续接和 `/config` 两处使用
2. **InlineApprovalPrompter** — HITL 审批用单字符热键（y/a/n/s/m）
3. **PlainRenderer** — 降级模式下用编号列表 + 手动输入数字
4. **Plan 审阅** — 单字符快捷键（Enter/Ctrl+O/ESC/I）

此外，AI 在对话中需要用户从多个方案中选择时（如 brainstorming 技能给出 2-3 个方案），只能用纯文本写出选项，用户需手动输入文字回复 — 没有结构化的交互式选择能力。

## 目标

- 统一所有选择场景为方向键导航的交互式选择器
- 新增 `present_options` 工具，让 AI 能在对话中结构化地呈现可交互选项
- 保持 PlainRenderer 降级能力（编号列表 + 数字输入）
- 不破坏现有交互流程的语义，只改善交互方式

## 非目标

- 不实现模糊搜索（留作后续增强）
- 不改造斜杠命令提示（`printAbove` 静态清单，是只读提示非选择场景）
- 不改动桌面端 Electron UI 组件（CommandPalette / ApprovalModal 等保持独立）

## 架构设计

### 组件关系

```
Agent ReAct 循环
    │
    ├── present_options 工具 ──→ renderer.promptChoice(ChoiceRequest)
    │
    ├── HITL 审批 ──→ renderer.promptChoice(选择动作) → 文本输入(子流程)
    │
    ├── Plan 审阅 ──→ renderer.promptChoice(选择动作) → 文本输入(子流程)
    │
    └── CLI 命令(/resume, /config) ──→ renderer.promptChoice(选择列表)
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
              InlineRenderer      PlainRenderer      LanternaRenderer
              InteractiveSelector  编号列表+数字      ListSelectDialog
              (方向键导航)          (降级)            (已有)
```

### 数据模型

#### ChoiceRequest

```java
public record ChoiceRequest(
    String title,              // 选择器标题
    List<ChoiceOption> options, // 2-9 个选项
    boolean allowCancel,       // 是否允许 Esc 取消，默认 true
    String hint                // 可选自定义底部提示
) {}
```

#### ChoiceOption

```java
public record ChoiceOption(
    String label,              // 显示文本（必填，≤200 字符）
    String description         // 可选描述（≤500 字符）
) {}
```

#### ChoiceResult

```java
public record ChoiceResult(
    int selectedIndex,         // 选中项下标，取消时为 -1
    boolean cancelled          // 是否取消
) {}
```

### 通用选择器组件：InteractiveSelector

基于现有 `SlashPalette` 增强，提取为独立类。

**文件位置**：`src/main/java/com/lyhn/wraith/render/inline/InteractiveSelector.java`

**与 SlashPalette 的差异**：
- SlashPalette 只接受 `List<String>`，InteractiveSelector 接受 `List<ChoiceOption>`（支持 description）
- 渲染时若选项有 description，在 label 下方用浅色显示描述
- SlashPalette 的 `open(title, items)` 方法保留，内部委托给 InteractiveSelector

**交互方式**（延续 SlashPalette 已有行为）：
- `↑↓` / `j/k` 切换高亮项
- `Enter` 确认当前高亮项
- `Esc` / `q` 取消（当 `allowCancel=true`）
- `1-9` 数字键直接选择对应项

**渲染样式**：
```
┌─ 选择实现方案 ─
│ ▶ [1] 方案A
│      用 JLine widget 实现
│   [2] 方案B
│      用独立 raw mode 实现
└─ ↑↓ 切换  Enter 确认  Esc 取消  数字键直选
```

无 description 时紧凑显示（与当前 SlashPalette 一致）：
```
┌─ 请选择 ─
│ ▶ [1] 批准
│   [2] 全部放行
│   [3] 拒绝
└─ ↑↓ 切换  Enter 确认  Esc 取消  数字键直选
```

### Renderer 接口扩展

在 `Renderer.java` 新增方法：

```java
/**
 * 同步阻塞地呈现交互式选项列表，等待用户选定。
 * 统一替代 openPalette + HITL 首选项 + Plan 审阅首选项。
 */
ChoiceResult promptChoice(ChoiceRequest request);
```

`openPalette` 标记 `@Deprecated`，内部改为委托 `promptChoice`：
```java
@Deprecated
default int openPalette(String title, List<String> items) {
    List<ChoiceOption> opts = items.stream()
        .map(ChoiceOption::new)
        .toList();
    return promptChoice(new ChoiceRequest(title, opts, true, null)).selectedIndex();
}
```

**三种渲染器实现**：

| 渲染器 | promptChoice 实现 |
|--------|-------------------|
| InlineRenderer | `InteractiveSelector.open(request)` |
| PlainRenderer | 编号列表 `[1] label\n description` + `BufferedReader` 读数字 |
| LanternaRenderer | `ListSelectDialogBuilder`（已有，适配 ChoiceOption） |
| EventStreamRenderer | 转发到桌面端（v2，v1 先 return cancelled） |

### present_options 工具

**工具名**：`present_options`

**注册位置**：`ToolRegistry.java`

**参数 schema**：
```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "选择器标题，如'选择实现方案'"
    },
    "options": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": {"type": "string", "description": "选项显示文本"},
          "description": {"type": "string", "description": "选项的补充说明"}
        },
        "required": ["label"]
      },
      "minItems": 2,
      "maxItems": 9
    },
    "hint": {
      "type": "string",
      "description": "可选的自定义底部提示文本"
    }
  },
  "required": ["title", "options"]
}
```

**返回值**：用户选中的选项 label 字符串。用户取消时返回 `"__cancelled__"`。

**执行流程**：
1. AI 在 ReAct 循环中调用 `present_options`
2. 工具执行器调用 `renderer.promptChoice(request)`，阻塞等待用户选择
3. 用户选择后，结果作为工具返回值传回 AI
4. AI 根据用户选择继续对话

**与 HITL 的区别**：
- HITL 是"是否允许执行某个工具调用"（安全审批）
- `present_options` 是"让用户从 AI 给的选项里选一个"（内容选择）
- 两者独立，不互相依赖

**安全边界**：
- 选项数量 2-9（SlashPalette 数字键直选的上限）
- label ≤ 200 字符，description ≤ 500 字符
- 各选项 label 必须唯一（工具执行器校验，重复则返回错误给 AI）
- 无副作用，纯交互

### System Prompt 引导

在 system prompt 中新增指引：

> 当你需要用户从多个方案中选择时，调用 `present_options` 工具呈现结构化选项，而非用纯文本列出。选项的 label 简洁（≤50 字符），详细说明放 description。

### 现有场景迁移

#### 1. HITL 审批（InlineApprovalPrompter）

**现状**：`> [y] approve [a] all [n] reject [s] skip [m] modify` 单字符读取

**迁移后**：
- 先用 `out.println` 显示审批详情（工具名、参数、风险描述、敏感提示），保持现有 `request.toDisplayText()` 逻辑
- 然后调 `promptChoice`，选项为：
  - `[批准] [全部放行](非敏感) [拒绝] [跳过] [修改参数]`
- 用户选"拒绝" → 文本输入拒绝原因（保持现有逻辑）
- 用户选"修改参数" → 文本输入新 JSON（保持现有逻辑）
- 用户选"全部放行" → `promptChoice` 选择范围 `[仅本工具] [整个 MCP server]`
- 敏感操作时隐藏"全部放行"选项

**影响文件**：
- `InlineApprovalPrompter.java` — 重写 `prompt` 方法
- `PlainRenderer.java` — `promptApproval` 首选项改用 `promptChoice`
- `LanternaRenderer.java` — 已有 dialog，适配选项列表

#### 2. Plan 审阅（Main.java:3231 createPlanReviewHandler）

**现状**：`Enter=执行 Ctrl+O=展开 ESC=取消 I=补充` 单字符

**迁移后**：
- 调 `promptChoice`，选项为：
  - `[执行计划] [展开/折叠详情] [取消] [补充指令重新规划]`
- 用户选"补充指令" → 文本输入补充内容（保持现有逻辑）
- 用户选"展开/折叠" → 执行折叠/展开后重新弹出选择器

**影响文件**：
- `Main.java` — `createPlanReviewHandler` 方法
- `PlanReviewInputParser.java` — 保留作为降级解析

#### 3. 会话续接（Main.java:1181）

**现状**：已用 `openPalette` → 内部委托 `promptChoice`，行为不变。

#### 4. 配置选择（Main.java:3726）

**现状**：已用 `openPalette` → 内部委托 `promptChoice`，行为不变。

#### 5. 斜杠命令提示（Main.java:3556）

**不迁移**：这是只读提示，非交互选择场景。

## 错误处理

- **raw mode 不可用**（如管道输入）：InteractiveSelector 降级为编号列表 + 数字读取，与 PlainRenderer 行为一致
- **选项为空或只有 1 个**：直接返回，不弹选择器
- **用户连续无操作**：不设超时，持续等待（与当前 SlashPalette 行为一致）
- **present_options 参数校验失败**：返回错误信息给 AI，AI 自行修正

## 测试策略

### 单元测试

1. **InteractiveSelector**
   - 方向键导航：↑↓ 正确移动高亮项，循环到首尾
   - 数字键直选：1-9 正确映射到对应项
   - Enter 确认：返回当前高亮项
   - Esc 取消：返回 cancelled=true
   - 选项有/无 description 的渲染
   - CJK 字符截断正确

2. **ChoiceRequest/ChoiceResult**
   - record 字段正确性
   - openPalette 委托 promptChoice 的下标映射

3. **present_options 工具**
   - 参数校验：选项数量 2-9，label 非空，label 唯一
   - 返回值：选中 label / cancelled
   - 与 mock renderer 的交互

4. **HITL 审批迁移**
   - 选项列表正确（敏感/非敏感）
   - 子流程（拒绝原因、修改参数）在选对应项后触发
   - 全部放行范围选择

5. **Plan 审阅迁移**
   - 选项列表正确
   - 展开/折叠后重新弹出
   - 补充指令文本输入

### 集成测试

- 在真实终端中手动验证各场景的交互体验
- PlainRenderer 降级路径正确
- present_options 在 ReAct 循环中正确阻塞和返回

## 文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `render/inline/InteractiveSelector.java` | 通用交互式选择器 |
| 新增 | `render/ChoiceRequest.java` | 选择请求数据模型 |
| 新增 | `render/ChoiceOption.java` | 选项数据模型 |
| 新增 | `render/ChoiceResult.java` | 选择结果数据模型 |
| 新增 | `tool/PresentOptionsTool.java` | present_options 工具实现 |
| 修改 | `render/Renderer.java` | 新增 promptChoice 方法 |
| 修改 | `render/inline/InlineRenderer.java` | 实现 promptChoice |
| 修改 | `render/PlainRenderer.java` | 实现 promptChoice + 迁移 promptApproval |
| 修改 | `render/inline/InlineApprovalPrompter.java` | 迁移到 promptChoice |
| 修改 | `tui/LanternaRenderer.java` | 适配 promptChoice |
| 修改 | `cli/Main.java` | Plan 审阅迁移到 promptChoice |
| 修改 | `tool/ToolRegistry.java` | 注册 present_options 工具 |
| 修改 | `agent/Agent.java` | system prompt 引导使用 present_options |
| 修改 | `render/inline/SlashPalette.java` | 委托给 InteractiveSelector |
| 新增 | `test/.../InteractiveSelectorTest.java` | 选择器单元测试 |
| 新增 | `test/.../PresentOptionsToolTest.java` | 工具单元测试 |
