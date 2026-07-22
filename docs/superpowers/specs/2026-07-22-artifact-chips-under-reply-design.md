# 回复下方「本回合产物」文件 chip 设计

**日期**:2026-07-22
**状态**:设计已通过,待写实现计划
**范围**:桌面端(Electron/renderer),**纯前端**,不改 Java 后端 / 不重打 jar

## 背景与目标

agent 产出文件后(尤其内容未变的 no-op 重写,没有内联 diff 卡),对话里缺少一个直达该文件的入口。
参照 Claude.ai 把产物 chip 挂在消息下方:每个回合最后一条 agent 回复下方,渲染本回合写过的文件 chip,
点击在右侧「预览」pane 渲染完整内容。让"agent 生成了文件"这件事在对话流里可见、可点。

用户原话:「在这个回复下面 能不能加一个 readme.md 文件,类似的操作都能这样」。

## 关键决策(brainstorming 已敲定)

1. **范围**:列本回合(上一条 user 之后)`write_file` 写过的**所有**文件(去重),挂在该回合**最后一条** `message` 下方。
2. **与 diff 卡并存**:改动型写入已有内联 diff 卡(带「在右侧打开」),回复下仍显示该文件 chip —— 体验统一(no-op / 改动一致)。
3. **点击动作**:复用既有 `openArtifact(filePath, content)` → 右侧「预览」pane。
4. **内容源**:与 `deriveArtifacts` 同源(write_file 工具卡 argsJson 的 content,或 diff 的 after),**不读实时磁盘**。
5. **无最终回复的回合**:某回合只产文件、无 `message` 项 → v1 不挂 chip(罕见;仍可从顶栏「产物」摘要看)。

## 架构

零后端改动。

- **`deriveFiles(items): ArtifactFile[]`**(`src/shared/artifactSummary.ts`,从现有 `deriveArtifacts` 抽出的纯函数):
  只做文件提取(`write_file` 工具卡 `{path,content}`,`ok!==false` 才计;+ `diff` item 合并决定 created/modified;
  content 取最新;按 path 去重保序)。`deriveArtifacts` 内部改为调用它得到 `files`,**行为零变化**(现有测试须仍绿)。
- **`filesUnderMessages(items): Map<number, ArtifactFile[]>`**(`src/shared/artifactSummary.ts`,新纯函数):
  按 `user` 边界分回合;每回合用 `deriveFiles(该回合 items 切片)` 得文件,挂到该回合**最后一条 `message` 项的下标**;
  回合无 message 或无文件 → 不产生条目。key = items 数组里 message 项的**绝对下标**(与 Transcript 的 `originalIdx` 一致)。
- **`ArtifactChips`**(`src/renderer/components/ArtifactChips.tsx`,新纯展示组件):
  props `{ files: ArtifactFile[]; onOpenArtifact: (filePath: string, content: string) => void }`;
  渲染一排 pill(📄 `baseName(path)`),点击调 `onOpenArtifact(f.path, f.content)`。空数组不渲染。
- **`Transcript`**(`src/renderer/components/Transcript.tsx`):
  渲染前 `const chipsByMsg = useMemo(() => filesUnderMessages(items), [items])`;
  渲染 `message` 项时(`item.type === 'message'`,`originalIdx` 已在作用域),若 `chipsByMsg.has(originalIdx)`,
  在 `<AgentMessage>` 之后渲染 `<ArtifactChips files={chipsByMsg.get(originalIdx)!} onOpenArtifact={onOpenArtifact} />`
  (两者包在一个 `<Fragment key>` 里)。`onOpenArtifact` 已是 Transcript 的现有 prop(Task 4 加过)。

### filesUnderMessages 算法

```
turnStart = 0; lastMsgIdx = -1; out = Map
for i in [0, items.length):
  if items[i].type === 'user':   flush(i);  turnStart = i;  lastMsgIdx = -1
  else if items[i].type === 'message':  lastMsgIdx = i
flush(items.length)

flush(endExclusive):
  if lastMsgIdx >= 0:
    files = deriveFiles(items.slice(turnStart, endExclusive))
    if files.length > 0:  out.set(lastMsgIdx, files)
```

(`deriveFiles` 忽略 user/message 项,故切片含 user/message 无害。)

## 呈现

- chip 行紧贴 AgentMessage 下方,左侧与正文对齐(缩进与 AgentMessage 正文一致)。
- 每 chip:小 pill,`📄 baseName`,`title=filePath`,hover 高亮,点击进右侧预览。
- 多文件横向 wrap;文件名过长 truncate。

## 测试

**`deriveFiles`(vitest)**:write_file 卡计入(含 no-op)、与 diff 合并成一条、ok=false 不计、多文件按 path 去重保序、content 取最新。(等价于把现有 deriveArtifacts 文件用例的核心迁到 deriveFiles;deriveArtifacts 自身用例保持不变、仍绿。)

**`filesUnderMessages`(vitest)**:
- 单回合 user→write_file→message:文件挂到 message 下标。
- 一回合多文件:全挂同一 message。
- 两回合:各自的文件挂各自 message,不串。
- 回合有文件但无 message:不产生条目。
- 回合有 message 但无文件:不产生条目。

**`ArtifactChips`(jsdom)**:渲染 N 个 pill(`data-testid="artifact-chip"`);点某 pill → `onOpenArtifact(path, content)` 以正确参数被调;空数组 → 不渲染(返回 null)。

## 明确不做(YAGNI / 后续)

- 无最终回复回合的 chip 归属(v1 跳过)。
- chip 上的删除/重命名/在 Finder 打开等操作(只做"点开预览")。
- 非 write_file 产物(create_project 等)。
- 按 chip 区分 created/modified 徽标(v1 只显文件名;kind 已在顶栏摘要体现)。
