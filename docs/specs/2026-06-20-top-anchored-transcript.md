# Spec:对话顶部对齐(top-anchored transcript)

- 日期:2026-06-20
- 状态:设计已评审(经多轮澄清),待实现
- 背景:截图显示当前对话是**底部对齐**——banner 冻结在左上,中间一大片空白,
  消息 + Tips 紧贴底部输入框、缓慢向上累积。用户要的是**顶部对齐**:第一条消息
  出现在 banner 下方紧贴顶部,后续往下满满累积;消息填满终端后整体上滚(banner
  先滚出顶部)。Tips 在首次发送后去掉。

## 1. 评审结论(已澄清)

- **banner**:不再冻结。它是滚动内容的第一块,停在顶部;**只有当对话填满终端时
  才随整体上滚**(banner 先滚出)。
- **对话**:顶部对齐。第一条消息紧贴 banner 下方,往下铺;填满前不留顶部空白。
- **输入框 + 状态栏**:仍钉在底部(沿用现有 dock)。对话短时,**留白在对话与输入框
  之间**(对话在上、dock 在下),聊得越多留白越小;填满后整体上滚。
- **Tips 1/2/3**:启动时显示;**首次发送后去掉**。

## 2. 根因 / 为什么是大改

当前所有 transcript 输出走 `InlineRenderer.emit → LineReader.printAbove`。printAbove
的语义是"在输入行上方插入并把上方区域上滚"——**天生底部对齐**:内容紧贴输入行向上长,
区域顶部在填满前一直空着。要顶部对齐,必须换机制:**用绝对光标定位从顶部往下画**
(复用 `paintBanner` 已验证的 save/restore cursor + cursor_address 手法),填满后再
切回 printAbove 上滚。banner 从"冻结固定区"降级为"顶部对齐内容的第一块"。

## 3. 设计

### 3.1 内容模型
- 取消 banner 冻结:不再 `setTopReserved(bannerHeight)`,滚动区顶边回到 dock 之上的
  完整区域。banner 作为 transcript 的首块参与顶部对齐。
- `contentAreaHeight = 终端行数 - dock 预留行数(状态栏 + 输入行)`。
- `renderedRows` = 已画内容(banner + transcript)的物理行数(沿用现字段)。
- 新增 `topAnchored`(boolean):内容未填满 dock 之上区域时为 true(绝对定位画),
  填满后为 false(切 printAbove 上滚)。

### 3.2 emit(text)(顶部对齐画法)
```
rows = estimateRows(text)
if topAnchored && renderedRows + rows <= contentAreaHeight:
    绝对定位:save_cursor → cursor_address(renderedRows, 0) → 写 text → restore_cursor
    renderedRows += rows
else:
    topAnchored = false           // 区域已满(或本块越界)
    reader.printAbove(text)        // 切回上滚;此时内容已铺满 dock 之上,无缝衔接
```
- restore_cursor 把光标还给 JLine 的输入行(在 dock 之上),**绝对定位画顶部内容不
  触达输入行/状态栏**,故不打扰 JLine 输入重绘(与 paintBanner 同理)。
- 越界块的小瑕疵:`renderedRows + rows` 跨过 `contentAreaHeight` 的那一块整块走
  printAbove(略早一拍上滚),可接受;后续可再细分"先画满再滚余下"。

### 3.3 首次发送(beginTurn)
- 清当前内容区 → 释放 banner 冻结 → 重画:banner 在顶、第一条消息紧随其下,
  `topAnchored=true` 重置、`renderedRows` 从 banner 高度起算。
- **不含 Tips**(Tips 仅启动屏有)。

### 3.4 启动屏
- 启动时:banner + Tips 顶部对齐画在最上方,`topAnchored=true`。输入框/状态栏钉底,
  中间留白(符合评审预览)。

### 3.5 dock(输入框 + 状态栏)
- 完全不动:沿用 BottomStatusBar(JLine Status)+ 输入行钉底。绝对定位的顶部内容
  与 dock 互不重叠。

### 3.6 resize
- 内容区高度变化 → 顶部对齐重画(沿用现有 resizeWatcher 去抖,扩展为重画整内容区
  而非仅 banner)。

## 4. 风险与缓解(评审需知)

- **流式 + 代码块折叠**(`createTranscriptStream` 的 moveUp 把代码头改写成折叠头):
  这段直接对 `out` 做光标回退,假设底部对齐。顶部对齐下改为"按绝对行重画该行"。
  风险中等,需 pyte 核验流式态。
- **Ctrl+O 折叠切换**(`redrawTranscript`):顶部对齐下从顶重画整段。
- **补全菜单**(AUTO_LIST):JLine 在输入行附近画候选列表;短对话时它落在"对话与输入框
  之间的留白区"(无内容可破坏);填满后属瞬态(选中即清)。需 pyte 核验。
- **这是反复出过 bug 的区域**(banner 冻结、palette 漂移、滚动区)。逐步实现 + 每步
  pty/pyte 核验是硬约束。若某集成点(尤其流式折叠)代价过高,先交付"轮次间顶部对齐"
  (流式期间临时底部对齐、轮末 settle 到顶)作为降级,再迭代。

## 5. 验证计划(pty.fork + pyte)

- 启动屏:banner + Tips 在最顶,输入框/状态栏钉底,中间留白。
- 首次发送:Tips 消失;第一条消息紧贴 banner 下方(顶部),不在底部。
- 多条累积:逐条往下铺(顶部对齐),不在底部堆叠。
- 填满终端:继续发 → 整体上滚,banner 滚出顶部,输入框/状态栏仍钉底。
- 回归:`/resume` 历史回放、Ctrl+O 折叠、流式 markdown、git diff、resize 均不破版。
- 单测:`contentAreaHeight` / 顶部对齐 vs 滚动切换阈值等纯函数。

## 6. 非目标
- 不改输入框/状态栏钉底模型(评审已定)。
- 不做"输入框跟随对话"流式 REPL(评审否决)。
- 不改 PlainRenderer / Lanterna(仅 InlineRenderer)。
