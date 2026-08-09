# 文件产物卡片 Hover Peek 预览设计

**日期**：2026-08-09
**主题**：桌面端 `FileArtifactCard` 增加鼠标 hover 浮动 popover 预览
**方案**：A（Radix Popover + 自定义 hover trigger）

## 背景与动机

桌面端每条助手消息末尾会渲染一组 `FileArtifactCard`（[FileArtifactCard.tsx](file:///c:/Users/LyHn/.trae-cn/worktrees/wraith/fix-wraith-slash-cmdlist-F9YW0J/desktop/src/renderer/components/FileArtifactCard.tsx)），当前只能通过 click 文件名按钮把内容打开到右侧 `RightDock` 的 `PreviewPane`（[PreviewPane.tsx](file:///c:/Users/LyHn/.trae-cn/worktrees/wraith/fix-wraith-slash-cmdlist-F9YW0J/desktop/src/renderer/components/PreviewPane.tsx)）。对「只想快速看一眼」的场景来说，click → 切右侧 dock → 占用主布局 的成本偏高。

Codex 桌面端的 hover 触发预览曾因过于敏感、阻碍侧栏导航被用户多次投诉（openai/codex#30275、#28734、#35589）——这些教训要内化进设计：必须加延迟、必须允许鼠标从卡片移到 popover 不关闭、必须支持 ESC/click outside 关闭。

## 目标

- 鼠标 hover 在 `FileArtifactCard` 上 300ms 后，弹出一个浮动 popover 显示文件内容
- popover 紧贴卡片右侧（fallback 上/下/左），不遮挡卡片本身
- 鼠标可以从卡片移到 popover 而不关闭（桥接区）
- click 文件名按钮的行为不变（仍打开右侧 dock 正式预览）
- 复用 `ArtifactPreview` 已有的渲染逻辑（.md 富文本 / 等宽 `<pre>` / 空文件占位）

## 非目标

- 不改 `SummaryPopover`（顶栏悬浮卡）—— 下一阶段再考虑
- 不改 transcript 里 @path 引用 —— 下一阶段再考虑
- 不加 keyboard shortcut 触发（依赖 Radix 默认 Tab 可达性即可）

## 架构

### 新增组件

`desktop/src/renderer/components/FileArtifactHoverPreview.tsx`：
- 外层 wrapper，用 Radix `Popover` 包住 `FileArtifactCard`
- 持有 `open` state + 两个 timer（enter 300ms / leave 200ms）
- trigger 用 `asChild` 把整个卡片作为 trigger
- PopoverContent 内：自定义 Header（文件名 + 大小 + 行数 + kind badge）+ 复用 `ArtifactPreviewBody`

### 重构 `ArtifactPreview.tsx`

把内容渲染部分（.md 富文本 / 等宽 `<pre>` / 空文件占位）提取为命名 export `ArtifactPreviewBody`：

- `ArtifactPreviewBody({ filePath, content })` —— 纯渲染，无 Header
- 原 `ArtifactPreview` 仍保留「· 快照」标题栏，内部改用 `ArtifactPreviewBody`

这样 hover popover 和右侧 dock 的 PreviewPane 共用同一份渲染逻辑，不会出现风格分裂。

### 修改 `FileArtifactCard.tsx`

把现有 default export 拆为两层：

- 命名 export `FileArtifactCardInner` —— 去掉外层 `<div>` 包装，把 props 透传给内部。供 `FileArtifactHoverPreview` 用 `asChild` 包裹（Radix 要求 trigger 是单一元素）。
- default export `FileArtifactCard` 仍是 `FileArtifactCardInner` + 外层 `<div>` 包装，保持向后兼容（测试和现有调用点不需改）。

### 修改 `Transcript.tsx`

`renderChips(idx)` 渲染时把每个 `FileArtifactCard` 替换为 `FileArtifactHoverPreview` 包住的版本：

```tsx
<FileArtifactHoverPreview key={f.path} file={f} workspace={workspace} editors={editors}
  onOpenPreview={onOpenArtifact} onOpenDiff={onOpenDiff} onUndo={onUndo}>
  <FileArtifactCard file={f} workspace={workspace} editors={editors}
    onOpenPreview={onOpenArtifact} onOpenDiff={onOpenDiff} onUndo={onUndo} />
</FileArtifactHoverPreview>
```

但实际上 `asChild` 模式下 children 会被 clone 注入 props，所以更干净的做法是 `FileArtifactHoverPreview` 直接渲染 `FileArtifactCardInner`，不需要外部传 children。最终 API：

```tsx
<FileArtifactHoverPreview key={f.path} file={f} workspace={workspace} editors={editors}
  onOpenPreview={onOpenArtifact} onOpenDiff={onOpenDiff} onUndo={onUndo} />
```

## 交互时序

| 事件 | 行为 |
|---|---|
| mouseenter 卡片 | 启动 enterTimer 300ms |
| 300ms 内 mouseleave | 取消 enterTimer，不显示 |
| 300ms 后仍 hover | `setOpen(true)`，popover 显示 |
| mouseleave 卡片 → mouseenter popover | 取消 leaveTimer，保持 open（桥接区） |
| mouseleave popover | 启动 leaveTimer 200ms |
| 200ms 内 mouseenter 卡片或 popover | 取消 leaveTimer |
| 200ms 后仍在外 | `setOpen(false)` |
| ESC | 立即关闭（Radix 自带） |
| click 文件名按钮 | 触发 `onOpenPreview`（右侧 dock），不影响 hover state |
| click「查看更改」「审核」「撤销」 | 正常工作，但点击后立即 `setOpen(false)` 防止 popover 挡住后续 UI |
| click「打开方式」 | 打开方式子菜单（内层 Popover），**不关外层**（intent 是进入子菜单，不是离开预览）；子菜单关闭后外层仍 open，鼠标移出时正常走 200ms 关闭流程 |

### Timer 实现细节

```tsx
const enterTimer = useRef<number | null>(null)
const leaveTimer = useRef<number | null>(null)
const [open, setOpen] = useState(false)

const clearEnter = () => { if (enterTimer.current) { clearTimeout(enterTimer.current); enterTimer.current = null } }
const clearLeave = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null } }

const onEnter = () => {
  clearLeave()
  if (open) return
  enterTimer.current = window.setTimeout(() => setOpen(true), 300)
}
const onLeave = () => {
  clearEnter()
  leaveTimer.current = window.setTimeout(() => setOpen(false), 200)
}
```

注意：Radix `Popover` 的 `onMouseEnter`/`onMouseLeave` 不能直接挂在 `PopoverTrigger` 上（因为 `asChild` 把事件合并到 children）。需要在外层 `<span onMouseEnter={onEnter} onMouseLeave={onLeave}>` 包一层，popover content 也要挂同样的 handler。

## Popover 定位与尺寸

- `placement="right-start"`（右侧上方对齐），`fallbackPlacements=["top", "bottom", "left"]`
- `collisionPadding={12}`（离窗口边缘 12px）
- 宽度：`min(560px, viewport.width - 24px)`
- 高度：`min(420px, content height)`，超出滚动
- `avoidCollisions=true`（Radix 自带，避免遮挡）

## Popover 内容

```
┌─────────────────────────────────────────────┐
│ 📄 spec.md  ·  12.3 KB ·  287 行 · 新建      │ ← Header
├─────────────────────────────────────────────┤
│ # 标题                                       │
│ 内容...                                       │ ← ArtifactPreviewBody
│                                               │   .md → react-markdown
│                                               │   其它 → <pre>
└─────────────────────────────────────────────┘
```

Header 字段：
- 文件图标（`FilePlus` for created / `FileDiff` for modified）
- `baseName(filePath)` —— 文件名
- 字节数（人类可读，如 `12.3 KB`，<1KB 显示字节数）
- 行数（content.split('\n').length）
- kind badge（`新建` 或 `已编辑`）

## 边界处理

| 场景 | 处理 |
|---|---|
| content > 50 KB | 截断显示前 50 KB + 底部固定条「内容过长，预览已截断，点击打开查看完整」 |
| content === '' | 显示「(空文件)」占位（复用 ArtifactPreviewBody 已有逻辑） |
| 卡片在可视区外 | popover 不显示（Radix 默认） |
| 多个卡片连续 hover | 各自独立 timer，互不干扰 |
| 已撤销（undone）状态 | 仍可 hover 预览（撤销只是把 `before` 写回，`content` 还在） |
| `Popover` 嵌套（外层 hover + 内层「打开方式」） | Radix 支持嵌套 Popover，内层打开时外层保持 open，但 z-index 内层高于外层 |
| 组件 unmount | useEffect cleanup 清两个 timer |

## 测试策略

新增 `desktop/test/fileArtifactHoverPreview.test.tsx`：

- hover 300ms 后 open（用 fake timers）
- mouseleave 200ms 后 close
- 鼠标从卡片移到 popover 内容不关闭
- ESC 关闭
- 超大内容（>50KB）截断 + 显示截断提示
- 空内容占位
- click 文件名按钮仍触发 onOpenPreview
- click 其它按钮后立即 close
- 组件 unmount 时清理 timer（无 leak warning）

`ArtifactPreview.test.tsx` 已有测试不应破坏（`ArtifactPreviewBody` 提取后行为等价）。

## 不在范围内

- 不改 `SummaryPopover`（顶栏悬浮卡）
- 不改 transcript 里 @path 引用
- 不加 keyboard shortcut 触发

## 参考教训

- openai/codex#30275：hover 触发必须加延迟，否则鼠标路径经过会被意外触发
- openai/codex#28734：hover 桥接区必须存在，否则鼠标从卡片移到 popover 时会关闭
- Wraith 仓库 `docs/superpowers/specs/2026-07-22-artifact-chips-under-reply-design.md` 的设计风格（chip + popover）
