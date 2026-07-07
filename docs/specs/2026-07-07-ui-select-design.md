# 设计：统一下拉选择组件 ui/Select（替换原生 select）

日期：2026-07-07
范围：桌面渲染层。零后端。接在 `feat/skill-scope-move` 分支（该分支已改 SkillEditor，避免冲突）。

## 问题

应用里 6 个下拉是**原生 `<select>`**：闭合框可描边，但**展开的选项列表由操作系统渲染、无法主题化**，与应用内 popover 式下拉（`ModelSwitcher`/`ProjectSwitcher`）观感割裂，"不好看"。光调 className 治标不治本。

## 目标

- 建一个可复用、全主题化的 `ui/Select` 组件（套用现有 `ui/popover`，与 ModelSwitcher 同一套审美）。
- 把 6 个原生 `<select>` 全部迁移到 `ui/Select`：`SkillEditor`（来源，1）+ `AutomationForm`（项目/计划类型/星期/审批默认/工具覆盖，5）。
- 深浅色随 token 自适应；交互（键盘/点击）可用；保留原 `data-testid`。

## 非目标（YAGNI）

- 不做多选、不做可搜索 combobox、不做分组。
- 不改各表单的业务逻辑/校验，只换控件。
- 不引第三方下拉库（复用自有 popover）。

## 现有结构（锚点）

- `ui/popover.tsx`：`Popover` / `PopoverTrigger`(`asChild`) / `PopoverContent`（已用于 ModelSwitcher/ProjectSwitcher）。
- `ModelSwitcher.tsx`：样板——触发器 `<button>`（border/bg、hover:border-accent）+ `PopoverContent` 内选项 `<button>`（hover `bg-surface/60`、选中 `bg-surface`+`✓`）。
- 原生 select 现状：
  - `SkillEditor.tsx:74` 来源（user/project），`disabled={lockScope}`，`className={inputCls}`。
  - `AutomationForm.tsx`：`automation-form-project`(:164)、`automation-form-schedule-kind`(:173)、`automation-form-schedule-weekday`(:190，值为 number)、`automation-form-approval-default`(:244)、`automation-form-tool-override-mode-${idx}`(:263)。

## 设计

### 1. 组件 ui/Select（`desktop/src/renderer/components/ui/select.tsx`）

受控组件，API：
```ts
interface SelectOption { value: string; label: string }
interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string          // value 不匹配任何 option 时显示;默认 '请选择'
  testId?: string               // 落到触发器 button 的 data-testid
  className?: string            // 触发器额外样式(宽度等)
  contentClassName?: string     // 弹层宽度等
}
```
- 内部 `useState(open)`，`<Popover open onOpenChange>`。
- **触发器**：`<PopoverTrigger asChild><button data-testid={testId} disabled … className=…>` 显示 `selectedLabel(options,value) ?? placeholder` + 右侧 chevron `▾`。样式走 token：`rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50`（与 inputCls/ModelSwitcher 一致，深浅色自适应）。
- **选项列表**：`<PopoverContent>` 内 `options.map` 成 `<button>`：`onClick={() => { onChange(o.value); setOpen(false) }}`，选中项(`o.value===value`)加 `bg-surface`+尾部 `✓`，其余 `hover:bg-surface/60`；`text-xs`、圆角、padding 与 ModelSwitcher 对齐。选项按钮带 `data-testid={testId + '-option'}`（多选项用 value 区分：`role="option"` + `data-value`）。
- 空 options：弹层显示 `无可选项`（`text-fg-subtle`）。

### 2. 纯函数（可测）

`ui/select.tsx` 内导出 `selectedLabel(options, value): string | null`（找到匹配 option 的 label，否则 null）——供触发器显示 + 单测。

### 3. 迁移 6 处

各调用点把 `<select>…<option>…</select>` 换成 `<Select value=… options=… onChange=… disabled=… testId=… />`：
- `SkillEditor` 来源：options `[{value:'user',label:'用户(~/.wraith/skills)'},{value:'project',label:'项目(<项目>/.wraith/skills)'}]`，`disabled={lockScope}`，`onChange={v => set('scope', v as 'user'|'project')}`，`testId` 沿用。
- `AutomationForm` 5 处：options 由各自现有 `<option>` 列表转成 `{value,label}`；`weekday`（number）→ `value={String(weekday)}` + `onChange={v => setWeekday(Number(v))}`；其余字符串直传。`data-testid` 逐一沿用。

## 测试 / 门禁

- **vitest**：`select` 的 `selectedLabel`——命中返 label、未命中返 null、空 options 返 null。
- **typecheck + build**：组件 + 6 处迁移接线。
- **眼验**：各下拉展开为主题化弹层（非系统样式）、选中项有 ✓、hover 高亮、disabled 生效、深浅色可读；SkillEditor 来源仍受 lockScope 控制（编辑态可选、锁态禁用）；AutomationForm 各项选择后表单值正确（星期数字转换对）。

## 风险

- 若有 playwright e2e 用原生 `selectOption()` 驱动这些下拉，迁移后交互变为"点触发→点选项"，相关 e2e 需同步更新（本 spec 迁移时若发现 e2e 引用这些 testid，改为点击式）。vitest 层无 DOM 测试碰这些 select，不受影响。

## 交付链路

`feat/skill-scope-move`（接续）→ 实现 → typecheck + vitest + build 全绿 → 与该分支其它改动一起眼验 → FF-merge + 推送（推送前用户点头）。纯桌面，jar 不变。

## 安全

无密钥面，纯 UI 控件。
