# 侧栏墨系选中语言 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏选中/悬停从白瓷砖(bg-surface 系)换半透明墨系(bg-fg/N)+ 选中项左缘 2px accent 灵条;sticky 表头硬带改渐隐纱并与行文本对齐;内容列顶行/工具条按钮白上白悬停改墨系可见。

**Architecture:** 单任务纯类名+CSS 替换。已批准 spec:`docs/superpowers/specs/2026-07-17-sidebar-ink-language-design.md`(commit e24848e)。依赖磨砂 v3 的 alpha 修复(bg-fg/N 可用)。

## Global Constraints

- 布局结构/行为/数据/testid 零变更;只动 className 字符串与 `.sidebar-sticky` CSS。
- typecheck 0;vitest 678 全绿(纯类名,无测试引用)。
- push 需用户单独点头。

**工作目录**:命令在 `desktop/` 下执行;git 在仓库根。眼验 HMR 即可(纯 renderer 类名/CSS)。

---

## Task 1: 墨系语言 + 灵条 + 渐隐纱

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx`
- Modify: `desktop/src/renderer/styles/tokens.css`
- Modify: `desktop/src/renderer/App.tsx`

**灵条类组(下文用 `SPECTRAL` 指代,逐字):**

```
relative bg-fg/10 before:absolute before:left-1 before:top-1/2 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent
```

- [ ] **Step 1: Sidebar.tsx 选中/悬停换墨** —
  1. SessionRow 主容器(约 :61-62):`(active ? 'bg-surface' : 'hover:bg-surface/60')` → `(active ? 'SPECTRAL 展开' : 'hover:bg-fg/5')`(即 active 分支放灵条类组全文)。
  2. SessionRow 改名容器(约 :47):`bg-surface` → `bg-fg/10`(内部 input 的 `bg-bg` 不动)。
  3. 草稿行 session-draft(约 :391):`bg-surface` → 灵条类组全文。
  4. 搜索 nav-search(约 :244)与工具组 nav-tools-toggle(约 :253):`hover:bg-surface/60` → `hover:bg-fg/5`。
  5. 12 个导航项(nav-plugins/automations/im-gateway/providers/skills/memory/snapshots/tasks/policy/browser/rag,约 :270-375):`(activeNav === 'x' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')` → `(activeNav === 'x' ? '灵条类组 text-fg' : 'text-fg-muted hover:bg-fg/5')`。
  6. 设置 nav-settings(约 :450):`hover:bg-surface hover:text-accent` → `hover:bg-fg/5 hover:text-accent`。
  7. 折叠键 sidebar-collapse(约 :199):`hover:bg-surface/60` → `hover:bg-fg/5`。
  8. sticky 类串(约 :406-407):headerCls 与 groupLabelCls 均去掉 ` backdrop-blur-sm`;`px-3` → `pl-5 pr-3`;headerCls 的 `py-1` → `pb-1.5 pt-2`(groupLabelCls 的 py-1 不动)。

- [ ] **Step 2: tokens.css 渐隐纱** — `.sidebar-sticky` 三条整体替换为:

```css
/* 会话列表 sticky 表头:上实下透渐隐纱,滚动内容从纱下淡出(无硬边) */
.sidebar-sticky { background: linear-gradient(180deg, rgb(var(--bg-rgb) / .95) 55%, rgb(var(--bg-rgb) / 0)); }
html.is-mac .sidebar-sticky { background: linear-gradient(180deg, rgba(255,255,255,.72) 55%, rgba(255,255,255,0)); }
html.is-mac[data-theme="dark"] .sidebar-sticky { background: linear-gradient(180deg, rgba(22,27,34,.72) 55%, rgba(22,27,34,0)); }
```

- [ ] **Step 3: App.tsx 顶行/工具条悬停可见** —
  1. sidebar-expand:`hover:bg-surface/60` → `hover:bg-fg/5`;
  2. terminal-toggle 与 rightdock-toggle:`hover:bg-surface` → `hover:bg-fg/5`;
  3. chat-compact 与 chat-export:`hover:bg-surface` → `hover:bg-fg/5`。

- [ ] **Step 4: 全仓核销** — `grep -n "bg-surface" desktop/src/renderer/components/Sidebar.tsx`:预期仅剩 0 处(ProjectSwitcher 是独立文件不在本任务)。
- [ ] **Step 5: typecheck 0** — `cd desktop && npm run typecheck`
- [ ] **Step 6: vitest 全绿** — `npx vitest run`,Expected: 678。
- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/styles/tokens.css desktop/src/renderer/App.tsx
git commit -m "feat(desktop): 侧栏墨系选中语言——bg-fg墨块+accent灵条替代白瓷砖,表头渐隐纱对齐,白上白悬停修复"
```

---

## 收尾:门禁 + opus 审查(单任务,任务审查与全分支终审合一)+ 眼验

- opus 读全 diff:灵条类组逐点一致、墨系替换无漏(Sidebar 内 bg-surface 清零)、sticky 渐隐三主题、App 五按钮、testid/行为零变更、YAGNI。
- 眼验清单(spec)交用户。**push 需用户单独点头**。

## 执行说明

- 单任务;实现者 sonnet;审查 opus(合并任务审查+终审)。
