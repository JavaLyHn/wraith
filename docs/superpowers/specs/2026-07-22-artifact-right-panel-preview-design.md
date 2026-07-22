# 产物 → 右侧完整预览 设计

**日期**:2026-07-22
**状态**:设计已通过,待写实现计划
**范围**:桌面端(Electron/renderer),**纯前端**,不改 Java 后端 / 不重打 jar

## 背景与目标

参照 Claude.ai 的 artifact/画布交互:agent 产出文件后,对话里的产物卡(以及顶栏「产物」摘要里的文件)
点一下,右半屏渲染该文件的**完整内容**(`.md` 渲染成富文本)。取代当前"只能在对话内联看一小段 diff"。

用户原话:「能直接将产物输出出来,然后点击以后,屏幕的右半部分就能显示出来完整内容」。

## 关键决策(brainstorming 已敲定)

1. **触发入口**:两处都支持 —— ①对话里的内联 `DiffCard`;②顶栏「产物」摘要 popover 的「输出·文件」行。
2. **右侧内容**:渲染后的完整内容 —— `.md/.markdown` 渲染成富文本,其它文件等宽纯文本。
3. **内联卡命运**:保留现有可展开 diff 卡,仅新增一个「在右侧打开」入口(向后兼容,改动最小)。
4. **内容来源**:transcript `diff` 事件里已带的**完整 `after` 全文**(即 agent 最后写入的内容),**不读实时磁盘**。
5. **代码高亮**:v1 等宽纯文本、**无**语法高亮(仓库无高亮依赖;后续再加 shiki/prism)。
6. **只产物文件走右侧**:摘要里的 服务 URL / 浏览器 / 来源附件 维持现状(外部 openExternal/openPath 不变)。

## 架构

零后端改动。数据链路已就绪:`write_file` → 后端 `diff` 事件 → reducer 存 `{type:'diff';filePath;before;after}` 到
transcript;`after` 就是要在右侧渲染的完整内容。

组件/状态:

- **`ArtifactPreview`**(新,`src/renderer/components/`):纯展示组件,props `{ filePath, content }`。
  `.md/.markdown` → `react-markdown` + `remark-gfm` + 复用 `AgentMessage` 已导出的 `MARKDOWN_COMPONENTS`
  (加 `.agent-markdown` 容器类);其它扩展名 → 等宽 `<pre className="whitespace-pre-wrap">`。空内容 → 占位文案。
- **`deriveArtifacts` 扩字段**(`src/shared/artifactSummary.ts`):`ArtifactFile` 增 `content: string`
  = 该路径**最后一次** `diff` 的 `after`(注意:文件去重仍"首个 diff 定 kind",但 content 取最后一次,
  因为要展示最新产物内容)。摘要 popover 据此开预览。
- **`App` 预览状态**(`src/renderer/App.tsx`):`previewArtifact: { filePath: string; content: string } | null`
  + `openArtifact(filePath, content)`:设状态 → `setRightDockPane('artifact')` → `setRightDockOpen(true)`。
  向下传给 `Transcript`(→`DiffCard`)与 `SummaryPopover`。
- **`RightDock` 新 pane**(`src/renderer/components/RightDock.tsx`):`RightDockPane` 增 `'artifact'`;
  分段器加 `seg('artifact', '预览')`;pane 区渲染 `<ArtifactPreview .../>`;新增 prop `artifact: {filePath;content}|null`。
- **入口接线**:
  - `DiffCard`(`src/renderer/components/DiffCard.tsx`):头部加一个「在右侧打开」小图标按钮(如 `PanelRight`),
    `onClick` 调 `onOpenArtifact(filePath, after)`;**现有展开/收起 diff 逻辑不动**。新增可选 prop `onOpenArtifact`。
  - `Transcript`:透传 `onOpenArtifact` 给 `DiffCard`。
  - `SummaryPopover`:`SummaryContent` 新增回调 prop `onOpenArtifact(path, content)`;「输出·文件」行 onClick
    从 `onOpenPath(resolveArtifactPath(f.path, workspace))` 改为 `onOpenArtifact(f.path, f.content)`。
    **`onOpenPath` 保留**——「来源」附件与工作目录行仍用它(外部打开);**`onOpenExternal` 保留**(服务/浏览器)。
    薄壳 `SummaryPopover` 里 `onOpenArtifact` 接 `App` 的 `openArtifact`。
  - **移除 `resolveArtifactPath` 及其 3 个单测**:它此前仅供「输出·文件」行拼绝对路径外部打开,现文件改走右侧预览,
    该函数成死代码(来源行用的是附件自带的绝对 `path`,不经它)。

## 数据结构变化

```ts
// artifactSummary.ts
interface ArtifactFile { path: string; kind: 'created' | 'modified'; content: string }  // +content
// App
type PreviewArtifact = { filePath: string; content: string } | null
```

## 渲染规则(ArtifactPreview)

| 扩展名 | 渲染 |
|---|---|
| `.md` / `.markdown` | `react-markdown`(remark-gfm + `MARKDOWN_COMPONENTS`),外套 `.agent-markdown` |
| 其它(.ts/.py/.txt/…) | 等宽 `<pre className="whitespace-pre-wrap break-words">`(无语法高亮) |
| content 为空串 | 占位:「(空文件)」 |

顶部显示文件名(`baseName(filePath)`,复用 `lib/paths`)。

## 测试

**`ArtifactPreview`(jsdom)**:
- `.md` 内容 → 渲染出对应 DOM(如 `# 标题` → `<h1>`,`data-testid="artifact-markdown"`);容器带 `.agent-markdown`。
- 非 md(`.ts`)→ 原文进 `<pre data-testid="artifact-code">`,不经 markdown 处理(特殊字符不被解释)。
- 空 content → 占位文案。
- 文件名显示 `baseName`。

**`deriveArtifacts`(扩字段)**:
- `ArtifactFile` 带 `content`,同路径多次写 → kind 取首个、content 取**最后一次** `after`。

**布线(jsdom + testing-library)**:
- `SummaryContent` 点「输出·文件」行 → `onOpenArtifact(path, content)` 以正确参数被调(取代旧的 onOpenPath)。
- `DiffCard` 点「在右侧打开」按钮 → `onOpenArtifact(filePath, after)` 被调;且**不影响**展开/收起(点收起仍只切 diff)。

**RightDock**:`pane==='artifact'` 且有 `artifact` 时渲染 `ArtifactPreview`(可作组件测或纳入现有 RightDock 测试)。

## 明确不做(YAGNI / 后续)

- 读实时磁盘内容(需新增读文件 IPC);v1 用 transcript 里的 `after`。
- 代码语法高亮(需 shiki/prism 依赖)。
- 来源附件/图片在右侧预览(附件是输入非产物;维持外部打开)。
- 右侧「预览/源码」切换、编辑、下载按钮。
- 非 write_file 产物(create_project 等)——v1 只认 `diff` item。
