# 设计：工具调用卡片默认折叠（智能）

日期：2026-07-07
范围：桌面渲染层。零后端。接在 `feat/resend-message` 分支。

## 问题

聊天里工具调用卡片（`ToolCard`：grep_code / glob_files 等）把**完整结果**默认全部展开（长文件列表等），刷屏、难读。要求：结果默认折叠，只显示卡头，点击展开。

## 目标（智能策略，经确认）

- 完成且成功的卡片：默认**折叠**（只显卡头：工具名 + 参数 + 徽章）。
- 运行中的卡片：默认**展开**（看实时输出），完成且成功后**自动收起**。
- 失败的卡片：默认**展开**（直接看到错误）。
- 用户点击卡头可随时手动展/收，手动选择固定、不再被自动策略覆盖。

## 非目标（YAGNI）

- 只动工具卡 `ToolCard`；不动 `ThinkingBlock` / `DiffCard` / `AgentMessage`。
- 不做「全部展开/折叠」批量操作。零后端改动。

## 现有结构

`desktop/src/renderer/components/ToolCard.tsx`：外层 div + 卡头行（`card.name` / `card.argsJson` / 徽章 `toolBadgeLabel(card)`）+ 始终渲染的 `<pre data-testid="tool-output" max-h-60 overflow-y-auto>{card.output}</pre>`。`card` 类型 `ToolCard`（`shared/transcriptReducer`），关键字段 `done: boolean`、`ok?: boolean`、`output: string`。组件按 `callId` keyed，实例跨流式更新持久。

## 设计

### 1. 纯函数（可测）

新建 `desktop/src/renderer/lib/toolCardExpand.ts`：
```ts
/** 智能默认:运行中或失败→展开;完成且成功→折叠。 */
export function toolCardDefaultExpanded(card: { done: boolean; ok?: boolean }): boolean {
  return !card.done || card.ok === false
}
```

### 2. ToolCard 状态与解析

- `const [userToggled, setUserToggled] = useState<boolean | null>(null)`（null=跟随自动）。
- `const expanded = userToggled ?? toolCardDefaultExpanded(card)`。
  - 运行中 userToggled=null → expanded=true；完成成功且未手动 → false（自动收起）；失败 → true；用户点过则固定其值。
  - 组件实例持久（callId keyed），故 running→done 转换时若 userToggled 仍 null，会自动从展开变折叠。

### 3. 交互 / 渲染

- 卡头行改为可点整行（`<button>` 或带 `onClick` 的行，`w-full`、`cursor-pointer`、hover 淡底、`aria-expanded={expanded}`）；`onClick: setUserToggled(!expanded)`。
- 卡头**左侧**加 chevron：`expanded ? '▾' : '▸'`（`text-fg-subtle`）。
- `<pre>` 结果区**仅在 `expanded` 时渲染**；折叠时只剩卡头一行。`data-testid="tool-output"` 保留（展开时）。
- 卡头原有元素（name/args/徽章）与样式不变，仅包进可点容器 + 加 chevron。

## 错误处理 / 边界

- `card.output` 为空：展开显示空 `<pre>`（无害，维持现 `card.output || ' '`）。
- 折叠不销毁 `card`（数据仍在 reducer），仅不渲染 pre；再展开即见最新 output。

## 测试 / 门禁

- **vitest**：`toolCardExpand.test.ts` 覆盖 `toolCardDefaultExpanded`——运行中(`done:false`)→true、完成成功(`done:true, ok:true`)→false、失败(`done:true, ok:false`)→true、done 但 ok 未定义(`done:true`)→false。
- **typecheck + build**：ToolCard 接线（state、chevron、可点卡头、条件渲染 pre）。
- **眼验**：卡片默认折叠只剩卡头；运行中展开、完成自动收起；失败展开；点卡头手动展/收生效。

## 交付链路

接 `feat/resend-message` → 实现 → typecheck + vitest + build 全绿 → 与 resend/markdown/composer 一起眼验 → FF-merge + 推送（推送前用户点头）。纯桌面，jar 不变。

## 安全

无密钥面，纯展示折叠。
