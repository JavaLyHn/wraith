# Task 8 Report: AutomationsPanel + AutomationForm

## automationLabels import 路径

**走了直接 import 路线(主路)**。

`desktop/src/renderer/lib/automationLabels.ts` 直接 import `../../main/automationSchedule`。

验证依据:
- `desktop/tsconfig.json` 的 `include` 为 `src/**/*`，无路径白名单限制，`moduleResolution: "bundler"` 允许跨 src 子目录
- `automationSchedule.ts` 仅依赖 `../shared/types`，无任何 Node built-in import
- `npx tsc --noEmit` 0 错误确认

备选方案(移至 `shared/`)未触发。

## testid 清单落实情况

| testid | 文件 | 状态 |
|--------|------|------|
| `automations-back` | AutomationsPanel.tsx | ✅ |
| `automation-item` | AutomationsPanel.tsx | ✅ |
| `automation-toggle` | AutomationsPanel.tsx | ✅ |
| `automation-add` | AutomationsPanel.tsx | ✅ |
| `automation-tab-def` | AutomationsPanel.tsx | ✅ |
| `automation-tab-runs` | AutomationsPanel.tsx | ✅ |
| `automation-runs` | AutomationsPanel.tsx | ✅ (占位 div) |
| `automation-form` | AutomationForm.tsx | ✅ |
| `automation-form-name` | AutomationForm.tsx | ✅ |
| `automation-form-prompt` | AutomationForm.tsx | ✅ |
| `automation-form-project` | AutomationForm.tsx | ✅ |
| `automation-form-schedule-kind` | AutomationForm.tsx | ✅ |
| `automation-form-schedule-minutes` | AutomationForm.tsx | ✅ (interval only) |
| `automation-form-schedule-time` | AutomationForm.tsx | ✅ (daily/weekly only) |
| `automation-form-schedule-weekday` | AutomationForm.tsx | ✅ (weekly only) |
| `automation-save` | AutomationForm.tsx | ✅ |
| `automation-run-now` | AutomationForm.tsx | ✅ |
| `automation-remove` | AutomationForm.tsx | ✅ (编辑态, 二次确认) |

placeholder `automations-panel-placeholder` 已从 App.tsx 删除(替换为 AutomationsPanel)。

## 门禁输出

### tsc --noEmit
```
(no output = 0 errors)
```

### vitest run
```
 Test Files  16 passed (16)
      Tests  135 passed (135)
   Duration  768ms
```

## 提交信息
```
feat(desktop): 自动化整页面板+任务表单(三档调度/项目下拉/立即运行/删除确认)
```
Commit: `16cb76f`

## 变更文件
- **新建** `desktop/src/renderer/components/AutomationForm.tsx`
- **新建** `desktop/src/renderer/components/AutomationsPanel.tsx`
- **新建** `desktop/src/renderer/lib/automationLabels.ts`
- **修改** `desktop/src/renderer/App.tsx`(import + placeholder → AutomationsPanel)

---

## Phase E-2 Task 8 修复:I1 + I2 (评审轮)

### I1 立即运行全链防重

**问题**:原 `save()` 函数在 `onSave` 完成后立即 `setSaving(false)`,而 `onRunNow` 异步期间 `saving` 已回 false,导致按钮重新可点,双击可触发两次 IPC。

**修复方案**:拆分 `save()` 为两条路径:

- `saveOnly()`:纯保存按钮专用。`setSaving(true)` → `await onSave` → `finally setSaving(false)`。保存完成即恢复可点,语义不变。
- `saveForRun()`:立即运行路径。`setSaving(true)` → `await onSave` → 若失败 `setSaving(false)` 并返回 null;若成功**不清 saving**,返回 task。
- `handleRunNow()`:调用 `saveForRun()` 成功后 `await onRunNow(t)`,在 `finally` 中统一 `setSaving(false)`。

**saving 链路**:整个 save→runNow 链中 `saving === true`,两个按钮(`automation-save` / `automation-run-now`)均 `disabled={saving}`,任何阶段均不可点。`AutomationsPanel.tsx` 无需改动。

### I2 daily/weekly 时间格式校验

**问题**:`buildTask()` 的 daily/weekly 分支未校验 `time` 字段格式,非法值(如空串、`9:0`)可写入 store。

**修复**:在 daily 和 weekly 分支各加一行:
```ts
if (!/^\d{2}:\d{2}$/.test(time)) { setError('时间格式错误'); return null }
```
错误通过现有 `error` state 展示(`<div className="text-xs text-danger">`),与 interval 分支的错误机制一致。

### 门禁输出(修复后)

**tsc --noEmit**
```
(no output = 0 errors)
```

**vitest run**
```
 Test Files  16 passed (16)
      Tests  135 passed (135)
   Duration  762ms
```

### 变更文件
- **修改** `desktop/src/renderer/components/AutomationForm.tsx`(仅 I1/I2,不动 testid/其他逻辑)
