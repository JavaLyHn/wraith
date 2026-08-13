# Sidebar Session Row — Double-click Rename + Loop Marquee

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧边栏会话行实现双击改名和长标题 hover 循环滚动效果。

**Architecture:** 纯前端改动。在 `tokens.css` 追加 marquee keyframes；在 `SessionRow` 组件中添加 `onDoubleClick` 处理器、`ResizeObserver` 溢出检测、复制文本 + CSS `translateX(-50%)` 无缝循环。

**Tech Stack:** React 18 + Tailwind CSS + TypeScript (strict) + Vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-08-13-sidebar-session-doubleclick-marquee-design.md`

## Global Constraints

1. 不改现有行为:单击选中、hover 显隐右侧按钮、改名 Enter/Escape 逻辑全部保留
2. 零新依赖:只用 React hooks + Tailwind 已有的 CSS 工具类 + 原生 ResizeObserver
3. 不碰 Java 代码:纯前端改动
4. 不改视觉尺寸:SessionRow 的 padding、文字大小、图标大小保持不变
5. 无障碍:`aria-label` / `aria-hidden` 正确使用;`prefers-reduced-motion` 强制降级
6. `npm run typecheck` 必须 0 errors
7. `npm test -- --run` 全量通过

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `desktop/src/renderer/styles/tokens.css` | 追加 `@keyframes sessionMarquee` + `.animate-marquee` class + reduced-motion 降级 |
| Modify | `desktop/src/renderer/components/Sidebar.tsx` | `SessionRow` 添加双击改名 + marquee DOM 结构 + 溢出检测 |
| Modify | `desktop/test/sidebarSearch.test.ts` (或新建) | 新增双击改名和 marquee 的单元测试 |

---

### Task 1: tokens.css — 追加 marquee 动画 CSS

**Files:**
- Modify: `desktop/src/renderer/styles/tokens.css` (追加到文件末尾)

**Interfaces:**
- Produces: CSS class `.animate-marquee` 和 `@keyframes sessionMarquee`,供 SessionRow 在 Task 2 使用

- [ ] **Step 1: 打开 tokens.css 末尾,确认追加位置**

查看 `desktop/src/renderer/styles/tokens.css` 文件最后 5 行,找到合适的追加位置(文件末尾,在已有 CSS 之后)。

- [ ] **Step 2: 在文件末尾追加 marquee CSS**

在 `desktop/src/renderer/styles/tokens.css` 文件**最末尾**追加以下内容:

```css
/* Session row hover marquee — double-click rename + long-title reveal */
@keyframes sessionMarquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}

.animate-marquee {
  animation: sessionMarquee 30s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .animate-marquee {
    animation: none;
  }
}
```

- [ ] **Step 3: 验证 CSS 语法正确**

Run:
```bash
cd desktop
npx tailwindcss --help > /dev/null 2>&1 && echo "tailwindcss available"
```

确认 Tailwind 能正常解析 tokens.css(不会报错)。

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/styles/tokens.css
git commit -m "style(tokens): add sessionMarquee keyframes + animate-marquee class with reduced-motion fallback"
```

---

### Task 2: SessionRow — 双击改名 + marquee DOM

**Files:**
- Modify: `desktop/src/renderer/components/Sidebar.tsx` (SessionRow 函数)

**Interfaces:**
- Consumes: Task 1 的 `.animate-marquee` CSS class
- Produces: 改造后的 SessionRow,支持双击改名 + 长标题 hover 循环滚动

- [ ] **Step 1: 阅读 SessionRow 当前完整实现**

Read: `desktop/src/renderer/components/Sidebar.tsx:20-95`

确保理解以下细节:
- `SessionRow` 的 Props 签名
- 编辑态(`editing === true`)和正常态的 return 分支
- 现有 `startEdit` / `finishEdit` 逻辑
- 行级 `<div>` 的 className(含 active / running / hover 态)
- 标题 `<button>` 的结构和 className

- [ ] **Step 2: 添加新的 state 和 ref**

在 SessionRow 函数体**开头**(现有 `editing` / `draft` / `editRef` 声明之后)添加:

```tsx
const titleRef = useRef<HTMLDivElement>(null)
const [isOverflowing, setIsOverflowing] = useState(false)
const [hovered, setHovered] = useState(false)
```

- [ ] **Step 3: 添加溢出检测 useEffect**

在现有 `useEffect(() => { if (editing) ... }, [editing])` **之后**添加:

```tsx
useEffect(() => {
  const el = titleRef.current
  if (!el) return
  const check = (): void => {
    setIsOverflowing(el.scrollWidth > el.clientWidth + 1)
  }
  check()
  const ro = new ResizeObserver(check)
  ro.observe(el)
  return () => { ro.disconnect() }
}, [s.name, s.title])
```

注意:ResizeObserver 在 jsdom 测试环境中不存在。添加守卫:

```tsx
useEffect(() => {
  const el = titleRef.current
  if (!el) return
  const check = (): void => {
    setIsOverflowing(el.scrollWidth > el.clientWidth + 1)
  }
  check()
  if (typeof ResizeObserver === 'undefined') return
  const ro = new ResizeObserver(check)
  ro.observe(el)
  return () => { ro.disconnect() }
}, [s.name, s.title])
```

- [ ] **Step 4: 添加 `cn` 工具函数导入**

在文件顶部的 import 列表中添加:

```tsx
import { cn } from '../lib/utils'
```

- [ ] **Step 5: 改造双击 + marquee DOM**

将 SessionRow 的**正常态 return 分支**(`editing === false` 的那个 return,即第 60-93 行区域)改造。

**5a.** 给外层 `<div>` 添加 `onDoubleClick`:

找到外层 `<div className={'group mb-0.5 ...'}>`(第 61-62 行区域),在其后添加 `onDoubleClick={startEdit}`:

```tsx
return (
  <div
    className={'group mb-0.5 flex items-center gap-1 rounded-lg px-1 ' +
      (active ? ... : 'hover:bg-fg/5')}
    onDoubleClick={startEdit}
  >
```

**5b.** 改造标题 `<button>` 内部结构:

找到标题 `<button>`(第 69-73 行),将:
```tsx
<button data-testid="conversation-item" onClick={() => onSelect(s.id)}
  className={'flex-1 truncate px-2 py-2 text-left text-xs ' + (active ? 'text-fg' : 'text-fg-muted')}
  title={sessionDisplayName(s)}>
  {sessionDisplayName(s)}
</button>
```

改造为:
```tsx
<button
  data-testid="conversation-item"
  onClick={() => onSelect(s.id)}
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
  aria-label={sessionDisplayName(s)}
  className={'flex-1 overflow-hidden px-2 py-2 text-left text-xs ' + (active ? 'text-fg' : 'text-fg-muted')}
>
  <div ref={titleRef} className="relative overflow-hidden">
    <div className={cn(
      'inline-flex whitespace-nowrap',
      isOverflowing && hovered && 'animate-marquee'
    )}>
      <span className="pr-8">{sessionDisplayName(s)}</span>
      {isOverflowing && hovered && (
        <span className="pr-8" aria-hidden="true">{sessionDisplayName(s)}</span>
      )}
    </div>
  </div>
</button>
```

关键变化:
- `truncate` → `overflow-hidden`(溢出由内层 div 控制)
- 添加 `onMouseEnter` / `onMouseLeave` 控制 hovered state
- 添加 `aria-label` 保证屏幕阅读器可读
- 标题文本包裹在三层 div 中:`relative overflow-hidden` → `inline-flex whitespace-nowrap` + 可选 `animate-marquee` → `<span>` 文本
- 第二份文本仅在 `isOverflowing && hovered` 时渲染,并标记 `aria-hidden="true"`

- [ ] **Step 6: typecheck 验证**

```bash
cd desktop
npm run typecheck
```

Expected: Exit 0, 0 errors。

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(sidebar): add double-click rename + loop marquee on long session title hover"
```

---

### Task 3: 单元测试 + 全量回归

**Files:**
- Modify: `desktop/test/sidebarSearch.test.ts` (追加测试用例) 或在 `desktop/test/` 下新建文件 `sidebarSessionRow.test.tsx`

**Interfaces:**
- Consumes: Task 1 + Task 2 的实现
- Produces: 3 条新测试 + 全量回归通过

- [ ] **Step 1: 确认测试文件位置**

检查是否已有 `Sidebar` / `SessionRow` 相关的渲染测试:

```bash
cd desktop
find test/ -name "*sidebar*" -o -name "*Sidebar*" -o -name "*session*" -o -name "*Session*"
```

如果已有 `test/sidebarSearch.test.ts`(纯函数测试),则在其中追加渲染测试;如果没有现成的 SessionRow 渲染测试,则新建 `test/sidebarSessionRow.test.tsx`。

- [ ] **Step 2: 编写测试**

在合适的测试文件中追加以下 3 条用例。如果新建文件,需包含正确的 import 和 wrapper(SessionRow 可能依赖的 SettingsContext 等)。

```tsx
// T1: 双击触发改名
it('双击会话行 → 显示改名输入框', async () => {
  render(<SessionRow s={s} active={false} running={false}
    onSelect={vi.fn()} onToggleStar={vi.fn()}
    onRename={vi.fn()} onArchive={vi.fn()} />)
  const row = screen.getByTestId('conversation-item')
  fireEvent.doubleClick(row)
  expect(screen.getByTestId('session-rename-input')).toBeInTheDocument()
})

// T2: 长标题 hover → 复制文本出现
it('长标题 hover → 渲染两份文本节点', async () => {
  // 构造 60 字符的长标题 session
  const longS = { ...s, title: '这是一个非常非常非常非常非常非常非常非常非常非常非常长的会话标题' }
  render(<SessionRow s={longS} ... />)
  const item = screen.getByTestId('conversation-item')
  fireEvent.mouseEnter(item)
  // 第二份文本的 span 应该出现
  const spans = item.querySelectorAll('span[aria-hidden="true"]')
  expect(spans.length).toBeGreaterThan(0)
})

// T3: 短标题 hover → 不复制
it('短标题 hover → 不复制文本', async () => {
  const shortS = { ...s, title: '短标题' }
  render(<SessionRow s={shortS} ... />)
  const item = screen.getByTestId('conversation-item')
  fireEvent.mouseEnter(item)
  const spans = item.querySelectorAll('span[aria-hidden="true"]')
  expect(spans.length).toBe(0)
})
```

> **注意**:如果 SessionRow 在脱离 Sidebar 上下文时无法正常渲染(依赖 Provider),则需要:
> 1. 检查 `SessionRow` 是否依赖 Sidebar 的某个上下文(Hook)
> 2. 如果有依赖,在测试中包裹必要的 Provider
> 3. 参考 `test/sidebarSearch.test.ts` 或其他现有 Sidebar 相关测试的测试 setup

- [ ] **Step 3: 运行新测试**

```bash
cd desktop
npm test -- --run sidebarSessionRow
```

Expected: 3 条用例全部通过。如果 FAIL,进入 Step 4 修复。

- [ ] **Step 4: 修复问题(如有)**

常见问题:
- `ResizeObserver is not defined`:jsdom 不存在,Task 2 已加 `typeof` 守卫,不应报错
- `SessionRow 依赖的 Context 未提供`:需要在测试中包裹对应 Provider
- `fireEvent.doubleClick` 没有正确触发 `onDoubleClick`:确保 fireEvent 的 target 是 SessionRow 的外层 div(不是内部 button)

- [ ] **Step 5: 全量回归**

```bash
cd desktop
npm test -- --run
```

Expected: 所有原有测试 + 新测试全部通过。

- [ ] **Step 6: typecheck 最终验证**

```bash
cd desktop
npm run typecheck
```

Expected: 0 errors。

- [ ] **Step 7: Commit**

```bash
git add desktop/test/
git commit -m "test(sidebar): add double-click rename + marquee overflow detection tests"
```

---

### Task 4: 最终验证 + 推送

- [ ] **Step 1: 确认所有 changes 已提交**

```bash
git log --oneline -5
git status --short
```

Expected: 3 个 commit(Task 1/2/3),工作区干净。

- [ ] **Step 2: 推送到远程**

```bash
git push origin main
```

- [ ] **Step 3: 总结交付**

向用户汇报:
- 改动文件清单
- 测试结果(通过数)
- Commit messages
- 手工验收清单指引
