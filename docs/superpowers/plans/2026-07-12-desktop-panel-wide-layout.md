# 工具面板宽屏布局(内容居中定宽)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 折叠侧栏后主内容变宽时,12 个工具面板的内容不再靠左显空——给每个面板的内容区一个共享的 `max-width:1040px` 居中容器,头部保持全宽。

**Architecture:** 在 `tokens.css` 加一个共享类 `.panel-content`(单一真源),给每个 `*Panel.tsx` 头部下方的「内容区容器」追加该类。两种结构:单栏面板加在其 `overflow-y-auto` 滚动容器上;两栏面板(Settings/Plugins/Automations)加在其 `flex min-h-0 flex-1` 两栏 body 上。纯 className/CSS 改动,无功能/数据流变化。

**Tech Stack:** React 18 + TypeScript + Tailwind;`tokens.css` 自定义类;vitest。

## Global Constraints

- 所有命令在 `desktop/` 目录下执行。
- 类型检查:`npm run typecheck` 须 **exit 0 无输出**。
- 测试:`npm test` 基线 **646 passed** 须保持不降(本改动无新测试,纯布局)。
- 纯前端布局;不得读写 config/密钥/日志;不改任何面板的功能、数据流、事件;不动聊天视图、侧栏、RightDock、终端、主进程。
- **头部/横幅保持全宽**,只居中头部下方的内容区。
- 宽度单一真源:`max-width:1040px` 只写在 `.panel-content` 里。
- push 需用户单独点头(实现阶段只本地提交,不 push)。

---

### Task 1: `.panel-content` 共享类 + 12 面板内容区套用

**Files:**
- Modify: `desktop/src/renderer/styles/tokens.css`(追加 `.panel-content`)
- Modify(各追加 ` panel-content` 到内容区 div 的 className):
  - `desktop/src/renderer/components/SettingsPanel.tsx`
  - `desktop/src/renderer/components/PluginsPanel.tsx`
  - `desktop/src/renderer/components/AutomationsPanel.tsx`
  - `desktop/src/renderer/components/SkillsPanel.tsx`
  - `desktop/src/renderer/components/MemoryPanel.tsx`
  - `desktop/src/renderer/components/SnapshotPanel.tsx`
  - `desktop/src/renderer/components/TaskPanel.tsx`
  - `desktop/src/renderer/components/PolicyPanel.tsx`
  - `desktop/src/renderer/components/RagPanel.tsx`
  - `desktop/src/renderer/components/BrowserPanel.tsx`
  - `desktop/src/renderer/components/ImGatewayPanel.tsx`
  - `desktop/src/renderer/components/ProvidersPanel.tsx`

**Interfaces:** 无跨任务接口(单任务)。`.panel-content` = `width:100%; max-width:1040px; margin-inline:auto`,给内容区加它即在宽视口下居中定宽、窄视口下自然铺满。`max-width` 是 width 属性,与 flex 项的 `flex-1`(管主轴高度)不冲突,`margin-inline:auto` 覆盖 cross-axis stretch 实现水平居中。

- [ ] **Step 1: 加共享类**

在 `desktop/src/renderer/styles/tokens.css` 末尾追加:

```css
/* 工具面板内容区:宽视口下舒适定宽居中(头部仍全宽)。改宽度只改此处。 */
.panel-content { width: 100%; max-width: 1040px; margin-inline: auto; }
```

- [ ] **Step 2: 两栏面板(3 个)—— 给两栏 body 加 panel-content**

对以下三个文件,定位「头部(`border-b … px-4 py-3` 那块)之后」的两栏 body `<div>`(className 恰为 `flex min-h-0 flex-1`,注意**不是**面板根的 `flex min-h-0 flex-1 flex-col`),把其 className 改为追加 ` panel-content`:

- `SettingsPanel.tsx`:`<div className="flex min-h-0 flex-1">` → `<div className="flex min-h-0 flex-1 panel-content">`
- `PluginsPanel.tsx`:同样 `<div className="flex min-h-0 flex-1">` → `<div className="flex min-h-0 flex-1 panel-content">`
- `AutomationsPanel.tsx`:同样 `<div className="flex min-h-0 flex-1">` → `<div className="flex min-h-0 flex-1 panel-content">`

（Edit 时用足够唯一的上下文匹配到那一处;每个文件里 `flex min-h-0 flex-1"`(无 `flex-col`)只出现在两栏 body 处。）

- [ ] **Step 3: 单栏面板(9 个)—— 给滚动容器加 panel-content**

对以下文件,定位头部之后的滚动内容容器 `<div>`,把其 className 追加 ` panel-content`(逐字匹配现有串):

- `SkillsPanel.tsx`:`min-h-0 flex-1 overflow-y-auto p-4` → 追加 ` panel-content`
- `RagPanel.tsx`:`min-h-0 flex-1 overflow-y-auto p-4` → 追加 ` panel-content`
- `BrowserPanel.tsx`:`min-h-0 flex-1 overflow-y-auto p-4` → 追加 ` panel-content`
- `MemoryPanel.tsx`:`min-h-0 flex-1 overflow-y-auto px-4 py-3` → 追加 ` panel-content`
- `SnapshotPanel.tsx`:`min-h-0 flex-1 overflow-y-auto px-4 py-3` → 追加 ` panel-content`
- `TaskPanel.tsx`:`min-h-0 flex-1 overflow-y-auto px-4 py-3` → 追加 ` panel-content`
- `PolicyPanel.tsx`:`min-h-0 flex-1 overflow-y-auto px-4 py-3` → 追加 ` panel-content`
- `ImGatewayPanel.tsx`:`flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4` → 追加 ` panel-content`
- `ProvidersPanel.tsx`:`min-h-0 flex-1 overflow-y-auto` → 追加 ` panel-content`

（每个文件里这些串各只出现一处内容区;若某文件里该串还出现在别处,用「头部之后第一个 `overflow-y-auto` 容器」为准,并用上下文使 Edit 唯一。示例:`className="min-h-0 flex-1 overflow-y-auto p-4"` → `className="min-h-0 flex-1 overflow-y-auto p-4 panel-content"`。）

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: exit 0,无输出。

- [ ] **Step 5: 全量测试保持绿**

Run: `npm test`
Expected: 全部通过,不低于 646,无新增失败(纯布局改动)。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/styles/tokens.css desktop/src/renderer/components/SettingsPanel.tsx desktop/src/renderer/components/PluginsPanel.tsx desktop/src/renderer/components/AutomationsPanel.tsx desktop/src/renderer/components/SkillsPanel.tsx desktop/src/renderer/components/MemoryPanel.tsx desktop/src/renderer/components/SnapshotPanel.tsx desktop/src/renderer/components/TaskPanel.tsx desktop/src/renderer/components/PolicyPanel.tsx desktop/src/renderer/components/RagPanel.tsx desktop/src/renderer/components/BrowserPanel.tsx desktop/src/renderer/components/ImGatewayPanel.tsx desktop/src/renderer/components/ProvidersPanel.tsx
git commit -m "feat(desktop/panels): 工具面板内容区宽视口居中定宽(panel-content 1040px)"
```

**眼验清单(实现者不执行,交回控制者/用户,重启/刷新 `npm run dev`):**
- 折叠侧栏(宽视口)逐个进 12 个面板:内容居中、两侧留白均衡、不再靠左空。
- 展开侧栏(窄视口):内容 < 1040 自然铺满,与现状一致(无回退)。
- 头部(`← 返回对话`/标题/横幅)仍全宽;Settings 两栏(subnav+content)整块居中;两栏面板(Plugins/Automations)master-detail 居中不错位。
- 各面板滚动正常;深浅主题正常;聊天视图/侧栏/RightDock/终端不受影响。

---

## Self-Review(计划对 spec 的自查)

**1. Spec coverage:**
- `.panel-content` 共享类(width/max-width 1040/margin-inline auto)→ Step 1。✓
- 12 面板内容区套用、头部全宽 → Step 2(两栏 3 个)+ Step 3(单栏 9 个)。✓
- 窄视口自然铺满、无回退 → `.panel-content` 用 max-width(非固定 width),Step 1 保证。✓
- 不改功能/头部全宽/单一真源宽度 → Global Constraints + 各 Step。✓
- 测试:无单测,typecheck + 646 保绿 → Step 4/5。✓

**2. Placeholder scan:** 无 TBD/TODO;每处编辑给了确切 className 前后串。Step 2/3 用「追加 ` panel-content`」的机械规则,示例齐全,非占位。✓

**3. Type consistency:** 无类型/签名(纯 className/CSS)。`.panel-content` 类名在 tokens.css 定义、各面板引用一致。✓
