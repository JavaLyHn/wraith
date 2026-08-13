# 桌面端 Transcript 尺子时间轴（Codex 风格）

**日期:** 2026-08-12 **状态:** 设计已定稿，未实现

用户需求原文（附 Codex 截图）：

> 这是codex的设计 左边一列的很多小横线就是我要的设计
> 而且整体划过有丝滑的动画(突出线条)显示

Codex 视觉特征：
- 左侧一列**密集的短横线条**（像一把竖直的尺子），每根横线代表一行内容
- hover 任意气泡时，**该气泡对应的整段范围内的横线同时变粗、变亮、变长**
- 当前阅读位置有一条**粗实线**（游标感）
- 重要节点（用户提问、Agent 首答、写操作工具）有**圆点 / 方块 / 菱形** 叠加标记

---

## 0. 现场调查结论：不能用 Grid 双列布局（原始方案 ❌）

盘点 `Transcript.tsx`（[L110-L209](file:///d:/wraith/desktop/src/renderer/components/Transcript.tsx#L110-L209)）真实渲染路径后，发现**CSS Grid 左列放尺子、右列放 items 的方案与现有布局有 5 处硬冲突**：

| 冲突点 | 实际代码 | Grid 方案会怎样 |
|---|---|---|
| diff item 返回 `null` | [Transcript.tsx:171](file:///d:/wraith/desktop/src/renderer/components/Transcript.tsx#L171) `if (item.type === 'diff') return null` | 左列 tick 存在但右列无内容 → 下一个 item 的右子元素**错位**到上一行，整条尺子错行 |
| system-event 是 `self-center` 居中胶囊 | [Transcript.tsx:178-184](file:///d:/wraith/desktop/src/renderer/components/Transcript.tsx#L178-L184) | Grid 右列容器强制左对齐，破坏胶囊居中视觉 |
| WorkingIndicator 在 `groupToolRuns().map` 之后单独渲染 | [Transcript.tsx:205](file:///d:/wraith/desktop/src/renderer/components/Transcript.tsx#L205) | 不参与 RenderNode 分组，Grid 没法配对；要么缺一个 tick、要么得单独处理 |
| ToolGroup 合并连续 tool → 渲染节点数 ≠ items 数 | [groupToolRuns.ts:37-59](file:///d:/wraith/desktop/src/renderer/lib/groupToolRuns.ts#L37-L59) | 如果按 items 数生成 segments，连续 N 个 tool 被合成 1 个 ToolGroup 后，tick 数 (N) ≠ 气泡数 (1) → **永远错行** |
| ToolGroup / ThinkingBlock 可折叠（高度变化不经过 items prop） | [ToolGroup.tsx:47-53](file:///d:/wraith/desktop/src/renderer/components/ToolGroup.tsx#L47-L53) [ThinkingBlock.tsx:36-40](file:///d:/wraith/desktop/src/renderer/components/ThinkingBlock.tsx#L36-L40) | Grid 行高同步没问题，但 fold/unfold 后**后续节点的纵向位置需重新计算，直尺刻度是静态背景不是 DOM**，只能 ResizeObserver 解决——不如直接独立尺子 |

所以**尺子必须与 flex 列完全解耦**：绝对定位在 scroll 容器内的左边缘，背景伪造密集短横线，节点标记绝对定位，hover 时整段范围丝滑高亮。

### 0.1 wraith 桌面端 Transcript 真实布局（对齐依据）

```
App.tsx [L1374-1392]
  └── Transcript 组件接收 items[] + 回调 + editors + workspace
       └── <div ref=containerRef>                 ← scroll 层
           class="flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none]"
           └── <div ref=contentRef>               ← flex 渲染层
               class="flex flex-col gap-1 [&>*]:shrink-0"
               ├── <UserMessage />    type=user    self-end w-85%
               ├── <AgentMessage />   type=message flex gap-2.5 (avatar + md)
               ├── <ThinkingBlock />  type=thinking 左竖线引用
               ├── <ToolGroup />      连续 tools  合并为可折叠卡片
               ├── <ToolCard />       单 tool     rounded-xl
               ├── <PlanChecklist />  type=plan    清单卡片
               ├── <PlanReviewCard /> type=planReview
               ├── <TeamCard />       type=team
               ├── <ActionCard />     type=action
               ├── <ImConnectCard />  type=im-bind
               ├── <TaskDonePill />   type=task-done
               ├── <system-event />   self-center pill
               ├── <error />          self-start 红框
               ├── renderChips()      (UserMessage/AgentMessage 下面的文件卡,
               │                       Fragment 里与气泡并行的另一个 flex child)
               └── <WorkingIndicator />  (在 map 之外,单独最后渲染)
```

关键观察：
- `contentRef` 是纯 flex 单列，**每个直接子元素就是一个渲染节点**
- `renderChips(originalIdx)` 与父消息是**同级 flex child**（不是嵌套在气泡内），它们各自占一个独立行——尺子上应该单独有刻度
- `groupToolRuns()` 输出 `RenderNode[]`，长度 ≤ items.length

---

## 1. 方案选型：X2 绝对定位尺子

| | X1 Grid 双列（✗ 淘汰） | **X2 绝对定位尺子（✓ 选定）** | X3 逐行 DOM tick |
|---|---|---|---|
| 布局改造量 | 大（整个 Transcript 重构为 grid） | 极小（只改 padding + 加 absolute 子元素） | 中（每个渲染节点要包装一层 Fragment） |
| diff return null 兼容性 | ✗ 错行 | ✓（尺子只看真实 DOM 节点，return null 不进 DOM → 自动跳过） | ⚠ 需在包装层特判 |
| ToolGroup 合并 | ✗ tick 数 ≠ DOM 数 | ✓（尺子遍历 `contentRef.children`，就是合并后的数量） | ⚠ 需包装层过滤 |
| WorkingIndicator | ✗ 不参与 groupToolRuns，无配对 | ✓（不加 `data-tl-node`，尺子看不见它） | ✓ |
| 折叠 / 展开 | ⚠ 需 ResizeObserver 重算后续位置 | ✓（同样 ResizeObserver，但尺子是独立组件，封装在内部） | ✓ |
| codex 观感 | 差（每个气泡一段 tick，稀疏） | **极好**（CSS 背景伪造每 28px 一根横线 + 绝对定位范围高亮） | 好（但 DOM 数量翻倍，性能差） |
| 性能 | 好（纯浏览器布局） | 好（背景 0 成本 DOM，只有 N 个节点标记是绝对定位 span） | 差（几百个 tick div + N 个 ResizeObserver） |

**选定 X2**。

---

## 2. 组件结构与文件边界

新增 2 个文件 + 修改 3 个文件：

| 文件 | 角色 | 变更类型 |
|---|---|---|
| [RulerTimeline.tsx](file:///d:/wraith/desktop/src/renderer/components/RulerTimeline.tsx) | 纯展示组件：绝对定位尺子，接受 `marks[]` + `hoveredHid` + `contentEl` | 新增 |
| [timelineMarks.ts](file:///d:/wraith/desktop/src/renderer/lib/timelineMarks.ts) | 纯函数：`RenderNode[] → RulerMark[]` + hid 分配 | 新增 |
| [Transcript.tsx](file:///d:/wraith/desktop/src/renderer/components/Transcript.tsx) | 宿主：pl-10 + relative + `<RulerTimeline>` 首个子元素 + 给每个渲染节点挂 data-tl-* 属性 + 维护 hoveredHid 状态 | 修改 |
| [tokens.css](file:///d:/wraith/desktop/src/renderer/styles/tokens.css) | 追加尺子样式：背景线、节点标记、高亮段、入场 keyframes、prefers-reduced-motion 降级 | 修改 |

### 2.1 数据流（单向）

```
RenderNode[]  (groupToolRuns 结果)
    ↓  timelineMarks(nodes)   ← 纯函数, useMemo 缓存
RulerMark[]  (nodeIndex + type + hid)
    ↓  Transcript hoveredHid state (mouse enter/leave)
<RulerTimeline marks= hoveredHid= contentEl=contentRef.current />
    ↓  内部:
       - CSS 背景渲染密集横线条 (0 DOM)
       - useEffect: 为每个 mark 计算 offsetTop → 绝对定位 span
       - ResizeObserver(contentRef): 重新计算所有 mark 位置
       - render hoveredHid 对应范围的 <div class="ruler-highlight">
```

### 2.2 为什么 Transcript 宿主不直接写内部 DOM（而是拆分 RulerTimeline + timelineMarks）

- Transcript 已经 210 行，管 scroll 跟随、手势判定、ResizeObserver 贴底、item 分发。继续塞尺子计算逻辑会让它同时管「贴底」和「尺子位置」两件事
- `timelineMarks` 是纯函数，**可独立单测**（与 `groupToolRuns.test.ts` 同风格）——它只关心 RenderNode 语义，不依赖 DOM
- `RulerTimeline` 是纯展示组件，**可独立单测**：给 marks + 假 contentEl + 已知 getBoundingClientRect 值，断言输出的节点标记位置和高亮段 top/height

---

## 3. 数据模型

### 3.1 类型

```ts
// src/renderer/lib/timelineMarks.ts
export type RulerMarkType = 'dot' | 'square' | 'diamond'

export interface RulerMark {
  /** groupToolRuns 后的 RenderNode 下标 = contentRef.children 索引
   *  （renderChips 的文件卡片也会加 data-tl-node，nodeIndex 就是它在 children 里的位置）
   */
  nodeIndex: number
  /** 节点类型：圆点 / 方块 / 菱形 */
  type: RulerMarkType
  /** hover 分组 id：同一 hid 的节点所在范围一起点亮 */
  hid: string
}
```

### 3.2 节点判定规则（timelineMarks 纯函数）

**输入**：`RenderNode[]`（groupToolRuns 结果）  
**输出**：`RulerMark[]`

规则与顺序：

```
初始化:
  userOrdinal = 0    // user 序号 (1-based)
  hidForAgent = null // 当前轮次回答的 hid = "a${userOrdinal}"
  agentFirstMsg = true  // 本轮是否还没出现 type=message
  writeEmphasisCount = 0  // 本轮已标过的写操作工具数 (上限 3)

遍历每个 renderNode, idx=i:
  kind=item, item.type=user:
    userOrdinal++
    hidForAgent = `a${userOrdinal}`
    agentFirstMsg = true
    writeEmphasisCount = 0
    emit { nodeIndex=i, type='dot', hid=`u${userOrdinal}` }

  kind=item, item.type=message:
    if agentFirstMsg:
      agentFirstMsg = false
      emit { nodeIndex=i, type='square', hid=hidForAgent }
    // 后续 message 不标,归属于 hidForAgent 范围

  kind=item, item.type=tool:  // 单工具(非 group)
    card = item.card
    if card.name in {'write_file','execute_command','create_project'}
       AND writeEmphasisCount < 3:
      writeEmphasisCount++
      emit { nodeIndex=i, type='diamond', hid=hidForAgent }

  kind=toolGroup:
    // 一个 ToolGroup 最多给 1 个 diamond（首张白名单卡）
    // 避免一个折叠组展开后 3 张菱形叠一起，视觉混乱
    firstWriteCard = cards.find(c => c.name in {'write_file','execute_command','create_project'})
    if firstWriteCard AND writeEmphasisCount < 3:
      writeEmphasisCount++
      emit { nodeIndex=i, type='diamond', hid=hidForAgent }

  其它（kind=item + thinking/error/plan/planReview/team/action/im-bind/system-event/task-done/diff）:
    不 emit，hid 归属于 hidForAgent（若无 user 则 hid="prelude"）
```

**关键边界**：

| 情况 | 处理 |
|---|---|
| transcript 开头没有 user（直接是 message / tool，比如加载后端历史里的「绑定成功」伪 user 已转 system-event） | `hidForAgent = "prelude"`（固定值），所有项归这个 hid |
| 连续多个 user（rewind 后重发） | 每个都开启新一轮 hid，`writeEmphasisCount` 重置——符合用户直觉 |
| user 之后直接 thinking（还没有 message），thinking 里就出 tool | 正常走：square 还没 emit 不影响，diamond 正常计数；hid 归属正确 |
| ToolGroup 有 5 张 write_file（超过 3） | 整个 Group 只给 1 个 diamond（firstWriteCard），不消费 3 个配额——本质是「一个 ToolGroup 是一个工作过程块，标 1 次足够」 |
| 单 tool 白名单工具直接出现（不进 ToolGroup） | 直接走 diamond 分支，正常计数 |
| `mcp__*` 工具 | 不在白名单（语义不明，可能读可能写），不标 diamond |

---

## 4. 视觉与动画

### 4.1 颜色与尺寸（复用 tokens.css 现有 token）

| 属性 | 值（light / dark） | 来源 token |
|---|---|---|
| 尺子宽度 | 36px | 硬编码（对应 pl-10 = 40px padding）|
| 横线条间隔 | 28px 一根 | ≈ AgentMessage 的 leading-7 = 28px 行高 |
| 横线条尺寸 | 宽 6px × 高 3px，圆角 2px | 硬编码 |
| 横线颜色 | `rgb(var(--fg-subtle-rgb) / 0.4)` | `--fg-subtle` |
| 节点 dot (user) | 8px 圆，`background: var(--accent)` | `--accent: #0ea5b7 / #2dd4bf` |
| 节点 square (agent) | 7px 方，`background: var(--fg-muted)` | `--fg-muted` |
| 节点 diamond (write tool) | 7px 方转 45°，`background: var(--accent)` + `drop-shadow(0 0 2px var(--accent))` 高亮描边 | `--accent` |
| hover 高亮段 | 宽 8px（比线粗），高 = hid 范围，`background: rgb(var(--accent-rgb) / 0.6)`，圆角 2px | `--accent` |
| 所有过渡 | `180ms cubic-bezier(0.22, 1, 0.36, 1)` | 与 [tokens.css 全局缓动](file:///d:/wraith/desktop/src/renderer/styles/tokens.css) 一致（可复用 tokens 的 pet 缓动常量或直接硬编码）|
| prefers-reduced-motion | 关闭 transition、关闭 animation | 全局一致 |

### 4.2 实现 CSS（追加到 tokens.css）

```css
/* =======================================================================
 * Transcript Ruler Timeline — 尺子时间轴
 * ======================================================================= */

.ruler-timeline {
  position: absolute;
  left: 0;
  top: 16px;           /* 与 containerRef py-4 对齐 */
  bottom: 0;
  width: 36px;
  pointer-events: none; /* 横线条不拦截点击；mark 单独开 pointer-events */
  /* 密集横线条：CSS 背景伪造，每 28px 一根 3px 横线 */
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 15px,
    rgb(var(--fg-subtle-rgb) / 0.4) 15px,
    rgb(var(--fg-subtle-rgb) / 0.4) 18px,
    transparent 18px,
    transparent 28px
  );
  background-position: 9px 0;   /* 36px 宽度内，线条居中（15px 内边距 + 6px 线）*/
  background-size: 6px 28px;
  background-repeat: repeat-y;
  background-repeat-x: no-repeat;
}

.ruler-highlight {
  position: absolute;
  left: 8px;
  width: 10px;
  border-radius: 2px;
  background: rgb(var(--accent-rgb) / 0.55);
  transition:
    top 180ms cubic-bezier(0.22, 1, 0.36, 1),
    height 180ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 120ms ease;
  opacity: 0;
}
.ruler-highlight--visible { opacity: 1; }

.ruler-mark {
  position: absolute;
  left: 10px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  transition:
    top 180ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ruler-mark::after {
  content: '';
  background: var(--accent);
  transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1),
              filter 120ms ease;
}
.ruler-mark--dot::after       { width: 8px; height: 8px; border-radius: 50%; }
.ruler-mark--square::after    { width: 7px; height: 7px; border-radius: 1px; background: var(--fg-muted); }
.ruler-mark--diamond::after   { width: 7px; height: 7px; transform: rotate(45deg); }

/* hover/高亮态：节点轻微放大 + 描边发光 */
.ruler-mark--on::after {
  transform: scale(1.3);
  filter: drop-shadow(0 0 2px var(--accent));
}
.ruler-mark--diamond.ruler-mark--on::after {
  transform: scale(1.3) rotate(45deg);
}

/* 节点入场：新到达的节点从 scale(0)→1 淡入；只播一次，后续位置变化走 transition 不重播 */
.ruler-mark--in { animation: ruler-mark-in 100ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes ruler-mark-in {
  from { opacity: 0; transform: scale(0); }
  to   { opacity: 1; transform: scale(1); }
}
.ruler-mark--diamond.ruler-mark--in { animation-name: ruler-mark-diamond-in; }
@keyframes ruler-mark-diamond-in {
  from { opacity: 0; transform: scale(0) rotate(45deg); }
  to   { opacity: 1; transform: scale(1) rotate(45deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ruler-highlight, .ruler-mark { transition: none; }
  .ruler-mark--in { animation: none; }
}
```

### 4.3 RulerTimeline 组件实现要点（伪代码）

```tsx
// components/RulerTimeline.tsx
export default function RulerTimeline({
  marks, hoveredHid, contentEl,
}: {
  marks: RulerMark[]
  hoveredHid: string | null
  contentEl: HTMLElement | null
}): JSX.Element {

  // mark 的 top 值（相对于 ruler 根 = contentEl.offsetParent 根）
  // 计算方式: childEl.offsetTop（相对 contentEl）+ contentEl.offsetTop（相对 containerRef）
  // + 16px（contentRef py-4 的 padding-top）— 等等:
  // 实际上 ruler 是 absolute top:16px 放的(与 containerRef py-4 对齐)，
  // child 是 contentRef.children[i]，相对 ruler 根（= containerRef 根）的
  // top = contentEl.offsetTop + child.offsetTop — contentEl.offsetTop=0
  // 因为 ruler 和 contentRef 同一个父 containerRef，ruler top:16px = containerRef.py-4
  // contentRef 在 py-4 容器里, 首项 y = containerRef 内 padding-top = 16px
  // 所以  child 相对 ruler y = child.offsetTop
  // ✅ 直接用 offsetTop
  const [tops, setTops] = useState<Record<number, number>>({})

  const recalc = useCallback(() => {
    if (!contentEl) return
    const children = contentEl.children
    const next: Record<number, number> = {}
    marks.forEach(m => {
      const el = children[m.nodeIndex] as HTMLElement | undefined
      if (el) next[m.nodeIndex] = el.offsetTop
    })
    setTops(next)
  }, [marks, contentEl])

  // 挂载 / contentEl 变化 → 初始化
  useLayoutEffect(() => { recalc() }, [recalc])

  // ToolGroup / ThinkingBlock 折叠展开 → 重算所有 mark 位置
  useLayoutEffect(() => {
    if (!contentEl || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recalc())
    ro.observe(contentEl)
    return () => ro.disconnect()
  }, [contentEl, recalc])

  // 计算 hover 高亮范围
  const highlight = useMemo(() => {
    if (!hoveredHid) return null
    const relatedMarks = marks.filter(m => m.hid === hoveredHid)
    if (relatedMarks.length === 0) return null
    // 但高亮应该覆盖 **整个 hid 范围**（所有属于该 hid 的 DOM 节点），不仅是有 mark 的那些
    // 做法：找到 min/max 的 nodeIndex（包括无 mark 的范围节点）
    // 所以 marks[] 信息不够 → 额外从 marks.hid → 对应 children 的 min/max
    // 但 Transcript 是把 data-tl-hid 挂在每个 child 上的，所以：
    const children = contentEl?.children as HTMLCollectionOf<HTMLElement> | undefined
    if (!children) return null
    let minIdx = Infinity, maxIdx = -1
    for (let i = 0; i < children.length; i++) {
      if (children[i].dataset.tlHid === hoveredHid) {
        minIdx = Math.min(minIdx, i); maxIdx = Math.max(maxIdx, i)
      }
    }
    if (!isFinite(minIdx)) return null
    const firstEl = children[minIdx] as HTMLElement
    const lastEl = children[maxIdx] as HTMLElement
    return {
      top: firstEl.offsetTop,
      height: lastEl.offsetTop + lastEl.offsetHeight - firstEl.offsetTop,
    }
  }, [hoveredHid, marks, contentEl])

  return (
    <div className="ruler-timeline">
      {/* hover 整段范围高亮（丝滑滑过） */}
      {highlight && (
        <div
          className={'ruler-highlight' + (hoveredHid ? ' ruler-highlight--visible' : '')}
          style={{ top: `${highlight.top}px`, height: `${Math.max(4, highlight.height)}px` }}
        />
      )}
      {/* 节点标记 */}
      {marks.map(m => {
        const top = tops[m.nodeIndex] ?? 8
        return (
          <div
            key={`${m.hid}-${m.nodeIndex}-${m.type}`}
            className={`ruler-mark ruler-mark--${m.type}`
              + (m.hid === hoveredHid ? ' ruler-mark--on' : '')}
            style={{ top: `${top + 8}px` }}
          />
        )
      })}
    </div>
  )
}
```

### 4.4 Transcript 宿主改造要点

```tsx
// Transcript.tsx —— 修改点：

// 1. 导入
+ import RulerTimeline from './RulerTimeline'
+ import { timelineMarks } from '../lib/timelineMarks'
+ import { useState, useMemo } from 'react'

// 2. containerRef 加样式
- className="flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none]"
+ className="flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none] pl-10 relative"
                                    // ^^^^ 给尺子留 40px;  ^ 尺子 absolute 基准

// 3. 内部新增 state + memo
  const [hoveredHid, setHoveredHid] = useState<string | null>(null)
  const renderNodes = useMemo(() => groupToolRuns(items), [items])
  const marks = useMemo(() => timelineMarks(renderNodes), [renderNodes])

// 4. contentRef 结构改造：
//    - 先放 RulerTimeline 作为首个子元素
//    - 每个渲染节点包装一层 div（不加任何视觉样式，只加 data-tl-* 属性 + hover）
//    - 因为 Transcript 原来的很多子项有 self-* / flex 属性，直接包 div 会让 self-* 失效（变成父 div self-*）
//    - ⚠ 这是一个大坑：必须 **直接把 data-tl-* 挂到现有根元素上，不能额外包 div**

//    → 具体做法：
//      现有每个 return <Component /> 的分支，给它加 data-tl-node / data-tl-mark / data-tl-hid
//      用 componentWrapper 属性做不到（React 不让），需要对每个组件的 return <jsx> 直接加 attrs
//      注意大部分现有组件是接受 className 的，用 <UserMessage class="..." data-tl-hid="a1" /> 就行
//      UserMessage / AgentMessage 等自定义组件如果不转发 data-* 属性到根 DOM，需要在组件内
//      让根 div 接受 {...props}（这是另一个小的改动点）

//      → 更简单的替代：**每个 Item 外再包一个 Fragment，第一个元素是 <span style="display:none" data-tl-* />**
//      但这样 span 在 contentRef.children 里占一个位置，RulerTimeline 的 nodeIndex 计算会错
//      → ❌ 不可行

//      → ✅ 正确方案：给 UserMessage / AgentMessage 等各自定义气泡组件的根 div 加转发 data-* 属性
//         （它们是 function component，只要给 JSX 根 div 加 {...props} 或直接 data-tl-hid={hid} ）
//         内置的普通 div（system-event / error / TaskDonePill / plan card / etc）直接加在本 div 上

//      为了 nodeIndex 精确，renderChips 生成的文件卡片（FilesArtifact 兄弟 div）也必须带 data-tl-hid=父消息的 hid
//      且不单独 emit mark（它的 nodeIndex 让 hid 范围计算更精确）

//    - groupToolRuns 后的 map 索引 vs contentRef.children 索引
//      现在的 code 是 map 里 UserMessage return <Fragment><UM/><chips/></Fragment>
//      => Fragment 展开后 UM 是 children[2k]，chips 是 children[2k+1]
//      ✅ 所以 timelineMarks 的 nodeIndex 也要基于「展开后的 children 索引」计算
//         而不是 RenderNode 索引。需要 timelineMarks 返回「相对 renderNodes[i] 在最终 DOM 里
//         的第一个子元素的 domStartIndex（单倍或双倍，取决于该 node 是否渲染 chips）」
//
//      → 更简单的做法：**不用 timelineMarks 预先算 nodeIndex 硬编码值**
//         改为给每个渲染出的 DOM 根元素直接设置属性 data-tl-mark-type + data-tl-hid
//         RulerTimeline 不依赖 marks[].nodeIndex，而是**遍历 contentRef.querySelectorAll('[data-tl-mark-type]')**
//         读 dataset 找到 mark 位置，得到  { type, hid, el } → top = el.offsetTop
//
//         这样 timelineMarks 的唯一职责就是**决定某个 renderNode 应该 emit 什么 type + hid**
//         Transcript 在 map 里拿到「这个 renderNode 的 { markType, hid, chipsHid }」
//         然后直接把属性挂到对应的 DOM 根上
//
//         ✅ 这是最稳健的实现：解耦了 renderNodes 索引 vs DOM 实际子元素索引的对应关系
//
//  (下文 §4.5 详述 data 属性挂载方案)
```

### 4.5 Transcript map 里实际挂载 data 属性的代码结构

```tsx
// 在 Transcript.tsx 的 groupToolRuns(items).map(...) 外层先算：
const nodeAttrs = useMemo(() => timelineMarksAttrs(groupToolRuns(items)), [items])
// nodeAttrs: Array<{ hid: string, markType: null | 'dot'|'square'|'diamond' }>
// length = renderNodes.length，一一对应

// 实际 map 内部（以 user + message + toolGroup 三个分支为例）：
return groupToolRuns(items).map((node, nodeIdx) => {
  const attr = nodeAttrs[nodeIdx]
  const wrapAttrs = {  // 给 DOM 根元素挂属性
    'data-tl-hid': attr.hid,
    ...(attr.markType ? { 'data-tl-mark-type': attr.markType } : {}),
    // hover 事件双向：item 与 segment 都能触发整段高亮
    onMouseEnter: () => setHoveredHid(attr.hid),
    onMouseLeave: () => setHoveredHid(prev => prev === attr.hid ? null : prev),
  } as Record<string, unknown>

  if (node.kind === 'toolGroup') {
    // ToolGroup / ToolCard 根已接受 className 会转发 data-* 属性到 <div>
    if (node.cards.length === 1)
      return <ToolCard key={firstCallId} card={node.cards[0]} {...wrapAttrs} />
    return <ToolGroup key={firstCallId} cards={node.cards} {...wrapAttrs} />
  }

  const { item, originalIdx } = node
  if (item.type === 'user') {
    userOrdinal++
    return (
      <Fragment key={`user-${userOrdinal}`}>
        <UserMessage {...} {...wrapAttrs} />
        {renderChips(originalIdx, attr.hid)}  {/* ← chips 也带同一 hid */}
      </Fragment>
    )
  }
  if (item.type === 'message') {
    return (
      <Fragment key={`msg-${originalIdx}`}>
        <AgentMessage text={item.text} {...wrapAttrs} />
        {renderChips(originalIdx, attr.hid)}
      </Fragment>
    )
  }
  // ... error / thinking / action / im-bind / system-event / task-done
  // plan / planReview / team / diff return null 的
  // 每个 return <div> 的分支都把 wrapAttrs 展开到根 div 上
})
```

注意 `UserMessage`、`AgentMessage`、`PlanChecklist`、`TeamCard`、`ActionCard`、`ImConnectCard`、`TaskDonePill` 这些自定义组件都必须把 `data-*` 和 `onMouseEnter/Leave` 事件转发到根 DOM 元素。做法：在各组件的函数签名里补 `...rest` 或显式 props，然后把 `...rest` 展开到根 `<div>` 上。

```tsx
// AgentMessage.tsx 示例改造：
- export default function AgentMessage({ text }: { text: string }): JSX.Element {
+ interface AgentMessageProps extends React.HTMLAttributes<HTMLDivElement> { text: string }
+ export default function AgentMessage({ text, ...rest }: AgentMessageProps): JSX.Element {
    return (
-     <div data-testid="agent-msg" className="flex gap-2.5">
+     <div data-testid="agent-msg" className="flex gap-2.5" {...rest}>
        ...
      </div>
    )
  }
```

---

## 5. 测试策略

### 5.1 纯函数单测（新增）

```
test/ ✅  vitest (jsdom/同 groupToolRuns.test.ts)
  └── timelineMarks.test.ts
```

用例清单（对应 3.2 规则每条一条）：

1. 空 `[]` → `[]`
2. 单个 `user` → `[{ nodeIndex:0, type:'dot', hid:'u1' }]`，agentFirstMsg=true，writeEmphasisCount=0
3. `user → message(第一个)` → `dot(u1) + square(a1)`
4. `user → message → message` → `dot(u1) + square(a1)`（第 2 个 message 不标 square，但 hid=a1）
5. `user → toolGroup(1 卡 write_file)` → `dot(u1) + diamond(a1)`
6. `user → tool(单卡 execute_command)` → `dot(u1) + diamond(a1)`
7. `user → toolGroup(3 张 write_file)` → `dot(u1) + diamond(a1)`（一个 Group 只标 1 个 diamond，不消费 3 个配额）
8. `user → tool(write_file) → tool(write_file) → tool(write_file)` → 3 个单独 tool 被合成 1 个 ToolGroup → 同上（只 1 个 diamond）
9. **配额耗尽**：`user → tool(wf) → msg → tool(wf) → msg → tool(wf) → msg → tool(wf)`，其中 tool 被 3 次不同 group 打断 → 前 3 个标 diamond，第 4 个不标
10. 连续两个 user：`user1 → msg1 → user2 → msg2` → `dot(u1) square(a1) dot(u2) square(a2)`，中间 hid 切换正确
11. 无根 user（直接 message 开头）→ `square(prelude)`（hid=prelude）
12. 只读工具（`read_file` / `grep_code` / `mcp__xxx` / 连续 10 个）→ 不标 diamond
13. 混合：`user → thinking → tool(read_file) → tool(wf) → msg → tool(exec_cmd)` → `dot(u1) + diamond(a1)[tool wf 占第 1 次] + square(a1) + diamond(a1)[exec 第 2 次]`
14. ToolGroup 首张是 read_file、第 2 张是 write_file、第 3 张 write_file → 整个 Group 标 1 个 diamond（首张白名单 = 第 2 张）
15. diff return null：不进 RenderNode，timelineMarks 看不见 → 自动不产生条目

### 5.2 组件渲染测试（新增，vitest jsdom）

```
test/
  ├── rulerTimeline.test.tsx     (Transcript 注入)
  └── transcriptRuler.test.tsx   (端到端 items → DOM 属性 + mark 位置)
```

`transcriptRuler.test.tsx` 用例：

1. 渲染 Transcript，给定 `[user, msg, tool(wf), msg]` → 断言 `contentRef.querySelectorAll('[data-tl-mark-type]').length === 3`（dot + square + diamond），类型分别对
2. 所有 DOM 根元素都带 `data-tl-hid`，hid 分配正确（u1 / a1 / a1 / a1）
3. fireEvent.mouseEnter 到 user 气泡 → `setHoveredHid('u1')` 断言被调用，RulerTimeline 的 highlight 段范围 = user 气泡高度
4. fireEvent.mouseEnter 到 tool(wf) 气泡 → highlight 段范围覆盖整个 a1 hid（msg+tool+msg，从第一个 a1 元素 top 到最后一个 a1 元素 top+height）
5. 空 items → RulerTimeline 渲染（只有背景），mark 为空
6. `item.type=diff` → 不产生 DOM 节点，marks 长度 = renderNodes 实际 emit 数（不包含 diff 的行）
7. **自定义组件 data 属性转发**：单独测 UserMessage / AgentMessage 接受 `data-tl-hid="a1"` 后根 div `dataset.tlHid === 'a1'`

`rulerTimeline.test.tsx` 用例：

1. 假 contentEl + 已知 offsetTop → marks 的 top 计算正确（mock `getBoundingClientRect` / 设 style.offsetTop）
2. hoveredHid 变化 → highlight div 的 top/height 在 180ms 后变化（用 fakeTimers advance）
3. prefers-reduced-motion 设置 → transition 样式仍被应用但**不测试 duration**（浏览器行为），只测样式类存在
4. ResizeObserver 触发（模拟 contentEl 高度增长 100px）→ marks 位置被重新计算（触发 setTops）

### 5.3 回归测试（必跑，已有）

| 命令 | 覆盖 |
|---|---|
| `npm run typecheck` | 新增类型不破坏 `tsc --noEmit` |
| `npm test -- --run transcriptHoverPreview transcript.actionCard transcriptReducer groupToolRuns` | Transcript 的现有 hover / item 分发 / reducer / group 逻辑不被打破（包括 `data-tl-*` 属性不影响 `data-testid` 查询） |
| 重点：`transcriptHoverPreview.test.tsx` | 它依赖 `file-artifact-card` 的 DOM 结构，外层加 data 属性不应破坏 screen.getByTestId |
| 重点：`groupToolRuns.test.ts` | 纯函数，不受影响，但作为 timelineMarks 的前置依赖验证 |

### 5.4 手工验证清单（真机必跑，写进 changelog 前的 QA）

1. **空态**：新建会话只有欢迎卡片 → 尺子不显示或只有短横线（WelcomeEmptyState 那条路径 Transcript 不渲染）
2. **基础对话**：user → agent → tool → agent → user → agent，每段 hid 正确：hover user 高亮 u1 的用户气泡 1 段高度；hover agent 首段高亮整个回答范围（包括 thinking + tool + messages）
3. **折叠/展开 ToolGroup**：展开后后面节点的 mark 位置**没有错位**（ResizeObserver 生效），节点放大微移 180ms
4. **折叠/展开 ThinkingBlock**：同上
5. **写操作工具多的长对话**：一轮回答里 write_file 超过 3 个 → 只标前 3 个，视觉不拥挤
6. **暗色主题切换**：横线颜色（--fg-subtle / 0.4）、方块颜色（--fg-muted）、dot/diamond（--accent）自动跟随
7. **prefers-reduced-motion**：入场不播放 scale 动画、高亮段无平滑过渡（跳到目标位置）
8. **贴底跟随**：工具输出流式追加时，自动贴底行为不因尺子的 ResizeObserver 额外触发 scrollTop 而被误关（与 stickRef 逻辑一致）
9. **diff 条目**：出现 return null 的 diff 时，后续节点的 mark 与 tick 对齐仍正确（DOM 里不产出元素，尺子直接看不见）
10. **WorkingIndicator 显示时**：没有对应 mark，但尺子最后一段不会错位（WorkingIndicator 是 flex 最后一个 child，不参与 groupToolRuns → 不加 data-tl 属性 → 尺子看不见它，自动正确）

---

## 6. 改动清单

### 6.1 文件级

| # | 文件 | 变更内容 | 影响面 |
|---|---|---|---|
| 1 | `src/renderer/lib/timelineMarks.ts` | 新增纯函数 `timelineMarksAttrs(RenderNode[]): Array<{hid, markType}>`，一一对应 RenderNode；包含节点判定规则 + hid 分配逻辑 | 0 耦合，独立测试 |
| 2 | `src/renderer/components/RulerTimeline.tsx` | 新增组件：absolute 定位尺子（背景重复线 + highlight 段 + mark 绝对定位）；接受 contentEl、marks、hoveredHid；内部 ResizeObserver + useLayoutEffect 计算位置 | 纯 props 驱动 |
| 3 | `src/renderer/components/Transcript.tsx` | (a) 外层 container 加 `relative pl-10`；(b) 作为首个子元素渲染 RulerTimeline；(c) 新增 `useState(hoveredHid)` + `useMemo(nodeAttrs)`；(d) 每个渲染节点挂 data-tl-* 属性 + mouseEnter/Leave；(e) renderChips 签名加 `hid` 参数并把 data 属性挂到 chips 根 div | **主要改动**（~40 行） |
| 4 | `src/renderer/components/UserMessage.tsx` | props 扩展 `React.HTMLAttributes<HTMLDivElement>`，根 `<div>` 展开 `...rest`，让 data 属性和事件上 DOM | 小改动 |
| 5 | `src/renderer/components/AgentMessage.tsx` | 同上（同 4） | 小改动 |
| 6 | `src/renderer/components/PlanCard.tsx` → `PlanChecklist` | 同上（PlanChecklist 根 div 转发）| 小改动 |
| 7 | `src/renderer/components/TeamCard.tsx` | 同上 | 小改动 |
| 8 | `src/renderer/components/ActionCard.tsx` | 同上 | 小改动 |
| 9 | `src/renderer/components/ImConnectCard.tsx` | 同上 | 小改动 |
| 10 | `src/renderer/components/TaskDonePill.tsx` | 同上 | 小改动 |
| 11 | `src/renderer/components/ToolCard.tsx` | 同上（根 `<div>` 外层） | 小改动 |
| 12 | `src/renderer/components/ToolGroup.tsx` | 同上（根 `<div>` 外层） | 小改动 |
| 13 | `src/renderer/components/ThinkingBlock.tsx` | 同上（根 `<div>`） | 小改动 |
| 14 | `src/renderer/components/FileArtifactHoverPreview.tsx` | 同上（文件卡片根 div 接受 data 属性转发，renderChips 里会给它传 hid） | 小改动 |
| 15 | `src/renderer/styles/tokens.css` | 追加 §4.2 的 ruler-timeline 样式段 + keyframes + prefers-reduced-motion 降级 | 仅追加 |
| 16 | `test/timelineMarks.test.ts` | 新增 15 条纯函数用例（§5.1） | 新增 |
| 17 | `test/transcriptRuler.test.tsx` | 新增 7 条组件测试（§5.2） | 新增 |
| 18 | `test/rulerTimeline.test.tsx` | 新增 4 条组件位置计算测试（§5.2） | 新增 |

### 6.2 数据契约（纯内部，无跨进程/跨模块 IPC）

- `timelineMarksAttrs(RenderNode[]): { hid: string; markType: null \| 'dot'\|'square'\|'diamond' }[]`
- DOM 属性协议（Transcript 根元素与子元素）：
  ```
  data-tl-hid="<hid>"        所有元素都有 —— hover 范围计算依据
  data-tl-mark-type="<type>" 仅 emit mark 的元素有 —— mark 查找依据
  ```

### 6.3 非目标（Scope / Explicitly Not Doing）

- **不实现：滚动位置游标（codex 截图里的粗实线）**——codex 里那条粗实线代表「当前鼠标 hover 或当前滚动阅读位置」，本期只做 hover 高亮，滚动位置指示留到后续迭代（避免一次性动画过多）
- **不实现：点击 mark 跳转滚动**——纯显示效果，无点击交互
- **不实现：MCP 写工具自动识别**——`mcp__*` 语义不明，不猜测是读是写，全部按 rail 处理
- **不改变：任何现有渲染的视觉样式**——气泡颜色、间距、圆角、字体全部不动；尺子是新增视觉层，不与现有 CSS 类名冲突
- **不引入：framer-motion 等动画库**——用原生 CSS transition + keyframes，与项目现有 pet 动画、panel 动画技术栈一致
- **不改：Desktop App.tsx 的 Transcript 外层容器结构**——padding 只在 Transcript.containerRef 内部调整，App 层零感知

### 6.4 硬约束

1. **Transcript.containerRef 仍是 overflow-y-auto + scroll 事件**：尺子是 absolute 子元素，随内容一起滚动（absolute 默认受 overflow 约束裁剪）——✅ scroll 时尺子跟气泡同步移动，无错位
2. **ResizeObserver 只观察 contentRef**，不观察每个子元素：折叠/展开会让 contentRef 高度变化，触发一次统一重算，比 N 个 ResizeObserver 省
3. **scroll 事件和 stickRef 逻辑原封不动**：尺子不引入任何 scroll 监听（位置计算是 static + offsetTop，scroll 时浏览器会自动重绘 absolute 元素在新视口中的位置 —— 因为尺子是 containerRef 内的 absolute 子元素，containerRef 滚动时尺子整体内容向上滚出/拉入视口，无需 JS 做 scroll 跟随）
4. **diff return null 不影响 DOM 索引**：因为我们不用 nodeIndex 预设值，只靠 `querySelectorAll('[data-tl-mark-type]')` 找有标记的真实 DOM 元素 —— diff 不产生 DOM 就不影响找元素
5. **不引入新依赖**：只用 React + Tailwind utility + 原生 CSS。项目里没有 animation 库，不加。
6. **TypeScript `strict` 通过**（`npm run typecheck`）：所有自定义组件新增 props 要显式类型，不 any。

---

## 附：为什么不是每段气泡一段竖线（原 X1 想法）

原设计里每个渲染节点对应一根连续轨道段（dashed border-left），然后节点叠加其上。实际实现时会遇到：

- ToolGroup 展开时高度剧烈变化（可能从 32px 变 600px），dashed border 高度由容器撑，但短线疏密 = height/dashPattern，height 翻倍后短线密度**不会跟着翻倍**，视觉出现大片空白——破坏「尺子密集横线」观感
- 而 CSS 背景 `repeating-linear-gradient` 的密度是固定每 28px 一根，无论容器怎么变高，短横线密度始终一致，永远像尺子

这是选择 X2 背景伪造的核心视觉理由。
