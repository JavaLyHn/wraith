# Sidebar Session Row — Double-click Rename + Loop Marquee

日期: 2026-08-13
状态: 已批准

## 1. 背景与现状

会话侧栏 `SessionRow` 组件 (`desktop/src/renderer/components/Sidebar.tsx:20-95`) 的当前交互存在两个可改进点:

1. **改名路径偏长**:用户必须先 hover 会话行 → 点击铅笔图标 → 才能进入改名模式。对于频繁重命名的操作来说,这个交互链路偏长。
2. **长会话名被截断后无反馈**:当前使用 `truncate` 类截断过长的会话名,截断后用户无法在列表中看到完整标题,只能靠 tooltip (`title={sessionDisplayName(s)}`) 或点击进入会话后查看。

### 2. 目标

1. **双击会话行任意位置直接进入改名模式** — 省掉 hover + 点铅笔两步
2. **长会话名 hover 时循环滚动展示** — 鼠标移上去后文字向左持续滚动,完整揭示被截断的内容

### 3. 非目标

- 不增加新的改名入口(右键菜单、F2 快捷键等)
- 不改现有点击选中逻辑
- 不动"重点"/"归档"等右侧按钮的 hover 显隐行为
- 不引入 framer-motion 等动画库
- 不修改 Java 后端的 SessionStore 数据模型

---

## 4. 双击改名设计

### 4.1 实现

在 `SessionRow` 的最外层 `<div>`(或其内部交互元素)添加 `onDoubleClick` 处理器,调用已有的 `startEdit()` 函数。

```tsx
<div
  className="group mb-0.5 flex items-center gap-1 rounded-lg px-1 ..."
  onDoubleClick={startEdit}
>
```

### 4.2 行为说明

- **单击**:选中该会话(现有行为不变,`onClick={() => onSelect(s.id)}`)
- **双击**:进入改名模式(`onDoubleClick={startEdit}`)
- **改名完成后**:Enter/Blur → 保存新名;Escape → 放弃(现有行为不变)
- 铅笔图标的单击改名按钮保留,作为显式可发现性入口

### 4.3 冲突处理

双击触发顺序为:click → click → dblclick。这意味着双击时会先触发两次选中,然后触发一次进入编辑。由于进入编辑后该行变成 `<input>`,选中的视觉反馈不会有问题(编辑态用 `bg-fg/10` 背景)。这是可接受的行为。

---

## 5. 循环滚动(Marquee)设计

### 5.1 方案选择

采用 **CSS keyframes + 文本复制法**(Approach A):

- 用 `ResizeObserver` 检测标题是否溢出(`scrollWidth > clientWidth`)
- 溢出时,hover 后显示复制两份的文本,通过 `translateX(-50%)` 实现无缝循环
- 一份 `@keyframes` 搞定,纯 CSS class toggle,不需要 JS 计时或宽度计算

**不用 Approach B(动态时长)的理由**:Approach B 需要 `useLayoutEffect` + `getBoundingClientRect` 测量宽度,再动态设置 `animation-duration`。实现复杂、易受字体加载影响,而 Approach A 用固定 30s 线性循环,体验足够好。

### 5.2 DOM 结构变化

**修改前:**
```
<button data-testid="conversation-item" onClick={...}
  className="flex-1 truncate px-2 py-2 text-left text-xs text-fg">
  {sessionDisplayName(s)}
</button>
```

**修改后:**
```
<button data-testid="conversation-item" onClick={...}
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
  className="flex-1 overflow-hidden px-2 py-2 text-left text-xs text-fg"
  title={isOverflowing ? undefined : sessionDisplayName(s)}  // 溢出时不显示原生 tooltip(由 marquee 代替)
  aria-label={sessionDisplayName(s)}>
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

### 5.3 溢出检测

```tsx
const titleRef = useRef<HTMLDivElement>(null)
const [isOverflowing, setIsOverflowing] = useState(false)
const [hovered, setHovered] = useState(false)

useEffect(() => {
  const el = titleRef.current
  if (!el) return
  const check = () => {
    setIsOverflowing(el.scrollWidth > el.clientWidth + 1) // +1 容差,防亚像素误差
  }
  check()
  const ro = new ResizeObserver(check)
  ro.observe(el)
  return () => ro.disconnect()
}, [s.name, s.title])
```

**检测逻辑**:
- `scrollWidth > clientWidth + 1`:加 1px 容差,避免亚像素误差导致的抖动
- `ResizeObserver`:容器宽度变化时(如侧栏拖拽)自动重检测
- 依赖 `s.name` 和 `s.title`:标题变化时重新检测

### 5.4 CSS 动画

在 `desktop/src/renderer/styles/tokens.css` 末尾追加:

```css
/* Session row hover marquee */
@keyframes sessionMarquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
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

**关键点**:
- `translateX(-50%)`:因为文本复制了两份,-50% 正好等于一份文本的宽度,实现无缝衔接
- `pr-8`(32px)作为两份文本之间的间距,防止视觉跳动
- `30s linear`:30 秒线性循环,足够慢以阅读,又不会太慢引起等待
- `prefers-reduced-motion`:尊重系统设置,降低动画

### 5.5 交互状态

| 场景 | 行为 |
|---|---|
| 短标题 + 无 hover | 静态截断(同现状) |
| 短标题 + hover | 静态截断(不触发 marquee,因为 `isOverflowing === false`) |
| 长标题 + 无 hover | 静态截断(鼠标移上去才滚动) |
| 长标题 + hover | **左向循环滚动**,持续展示完整标题 |
| 长标题 + hover → 离开 | 停止滚动,回到截断状态(立即复位,无需等动画结束) |
| 进入编辑模式 | 不显示 marquee(`editing === true` 时整个组件走另一条 return 分支) |

### 5.6 无障碍

- `aria-label={sessionDisplayName(s)}`:确保屏幕阅读器始终能读到完整标题
- `aria-hidden="true"`:复制的第二份文本标记为装饰性,不被屏幕阅读器重复朗读
- `prefers-reduced-motion`:尊重系统设置

---

## 6. 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `desktop/src/renderer/styles/tokens.css` | 追加 `@keyframes sessionMarquee` + `.animate-marquee` + reduced-motion 降级 |
| 2 | `desktop/src/renderer/components/Sidebar.tsx` | `SessionRow` 添加 `onDoubleClick={startEdit}`;改标题 DOM 结构(复制文本 + overflow 检测);新增 `isOverflowing` / `hovered` state + `ResizeObserver`;`truncate` → `overflow-hidden` |

**总计 2 个文件,无新建文件,无新依赖。**

---

## 7. 测试策略

### 7.1 自动化测试

`desktop/test/sidebarSearch.test.ts` 扩展:
- **T1**:双击会话行触发改名输入框出现(`data-testid="session-rename-input"`)
- **T2**:长标题 hover 时 `data-testid="conversation-item"` 内存在两个相同的 `<span>` 节点(复制文本)
- **T3**:短标题 hover 时不复制文本(`isOverflowing` 为 false)

### 7.2 手工验收清单

1. 双击任意会话 → 进入改名模式,原有单击选中不受影响
2. 长标题会话(>40 字符)hover → 文字向左循环滚动,30s 一个周期
3. 长标题移开鼠标 → 立即停止并回到截断状态
4. 短标题会话 hover → 不滚动,保持静态截断
5. 编辑模式 → 不显示 marquee(显示 `<input>`)
6. 系统设置 reduced-motion → marquee 不生效
7. 侧栏宽度拖拽 → 溢出检测正确刷新(ResizeObserver)
8. active 行 + hover → marquee 正常运行,背景高亮仍可见
9. 改名保存后 → 新标题立刻参与溢出检测(依赖变化触发 useEffect)

### 7.3 回归保护

- `npm run typecheck` → 0 errors
- `npm test -- --run` → 全量测试通过(重点: `sidebarSearch.test.ts`、`sessionView.test.ts` 或其他 Sidebar 相关测试)

---

## 8. 硬约束

1. **不改现有行为**:现有单击选中、hover 显隐右侧按钮、改名 Enter/Escape 逻辑全部保留
2. **零新依赖**:只用 React hooks + Tailwind 已有的 CSS 工具类
3. **不碰 Java 代码**:纯前端改动
4. **不改视觉尺寸**:SessionRow 的 padding、文字大小、图标大小保持不变
5. **无障碍**:aria-label / aria-hidden 正确使用
6. **prefers-reduced-motion**:强制降级
