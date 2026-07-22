# 已编辑/新建 文件卡 —— 查看更改 / 审核 / 撤销 设计(子项 ②+③ 合并)

**日期**:2026-07-22
**状态**:设计待用户审阅
**范围**:桌面端(Electron renderer + 主进程)。撤销走**文件级写回**,**不改 Java 后端、不重打 jar**;主进程新增 IPC → 需重启 dev App。

## 背景

参照 Codex(Image #61)把"被 agent 改过的文件"在回复下方呈现为**一张统一卡**:`± 已编辑 <file>` / `查看更改 ↗` + `撤销 ↩` + `审核`。当前实现里同一个文件有**两个割裂的东西**——内联 `DiffCard`(diff 事件位置)+ 子项① 的 `FileArtifactCard`(消息下方)。本项目把它们**合并成一张卡**,并补齐 diff 预览与撤销。

这是 Codex 式文件输出三子项的收尾:①(文件卡+打开方式,已合入 main)已完成;本 spec 合并原计划的 ②(审核→右侧 diff)与 ③(编辑卡+撤销)为一个 feature 一次交付。

## 关键决策(已与用户敲定)

1. **②③ 合并**成一个 feature 一次做完(#61 那张卡本就把 diff/审核/撤销 焊在一起)。
2. **撤销走文件级写回 `before`**(不走快照):diff item 自带 `before` 内容,撤销 = 把这一个文件写回编辑前内容;`created`(before==='')→ 删除该文件。**精确到单文件、所有模式可用、不依赖快照、不需 turnId 关联**。
   - 之所以不走快照:桌面普通对话(react)根本不存快照(`Main.java:1253` 直接 `agent.run`,未包 `snap.runTurn`),且快照是**整轮工作区**粒度、transcript item 无 turnId 无法关联。文件级写回绕开这三个坑。
3. **保留**子项① 的「打开方式」下拉(复用 `OpenWithMenu`),新卡上与 查看更改/审核/撤销 并存。
4. **撤销是破坏性写**:经 Electron 主进程新 IPC 落盘,主进程用 `resolvePersistedWorkspace(userDataDir)` **独立校验目标路径在工作区内**,绝不信任 renderer 传入的绝对路径;写入前 renderer 弹 `window.confirm`(照 `SnapshotPanel` 既有模式)。
5. **移除内联 `DiffCard`**:每个 diff 文件都已被 `filesUnderMessages` 归到消息下方渲染成卡,内联块与新卡重复,去掉。

## 架构

renderer + Electron 主进程;零 Java、零 jar 重打。

### 数据层:`before` 贯通 `ArtifactFile`(`src/shared/artifactSummary.ts`)

```ts
export interface ArtifactFile {
  path: string
  kind: 'created' | 'modified'
  content: string          // 编辑后(after)
  before: string | null    // 编辑前;diff item 有则取之,仅 write_file 卡(无 diff/no-op)则 null
}
```

- `deriveFiles`:diff item → `before = item.before`,`kind = item.before==='' ? 'created' : 'modified'`(created 不降级);write_file 卡(无对应 diff)→ `before = null`。同 path 合并时 **diff 为权威**(定 before/kind),content 取最新。
- `before === null`(仅 no-op 重写):本就无变化 → 卡上 **查看更改/撤销 置灰或不显示**,只保留 打开方式 + 内容预览。这是正确降级,不是缺陷。
- `PreviewArtifact` 保留;新增右侧 diff 预览类型见下。

### 右侧预览 pane:内容 | diff 二选一(`src/renderer/App.tsx` + `RightDock.tsx`)

把①的 `previewArtifact` 升级为判别联合,一个「预览」段既能显示完整内容、也能显示 diff:

```ts
export type RightPreview =
  | { kind: 'content'; filePath: string; content: string }
  | { kind: 'diff'; filePath: string; before: string; after: string }
```

- App:`rightPreview: RightPreview | null`;`openArtifact(path, content)` → set `{kind:'content'}`;新增 `openDiff(path, before, after)` → set `{kind:'diff'}`;切换 sessionId 时清空(沿用①)。
- `RightDock`:`preview: RightPreview | null` prop。`kind==='content'` → `ArtifactPreview`(现状);`kind==='diff'` → 头部 `baseName · 更改` + `<DiffView filePath before after />`(复用现成组件,只读、行内、per-hunk 折叠)。

### 撤销 IPC(`src/main/index.ts` + `src/preload/index.ts`)

| IPC | 行为 | 安全 |
|---|---|---|
| `undoFileEdit({ path, before, kind }): Promise<{ ok: boolean; message?: string }>` | `kind==='modified'` → 把 `before` 写回 `path`;`kind==='created'` → 删除 `path`。成功返回 `{ok:true}`,失败返回 `{ok:false, message}` | 主进程取 `resolvePersistedWorkspace(userDataDir)`;`isPathWithinWorkspace(path, ws)` 为真才动手;`before` 5MB 上限;删除仅对 `kind==='created'` |

**纯函数(可单测,`src/main/fileOpen.ts` 或新文件)**:
`isPathWithinWorkspace(target: string, workspace: string): boolean` —— 归一化(`path.resolve`)两侧,判断 `target` 是否等于或位于 `workspace` 之下(用 `path.relative` 不以 `..` 开头、且非绝对路径判定);workspace 为空 → false。

### renderer 组件

- **`OpenWithMenu`**:从 `FileArtifactCard.tsx` **抽到独立文件** `src/renderer/components/OpenWithMenu.tsx`(内容不变,继续无 Radix、可单测),供新卡与后续复用。
- **`FileArtifactCard.tsx` 重写为统一卡**(`EditedFileCard` 语义,文件名沿用不改以省 import 面):
  - props:`{ file: ArtifactFile; workspace; editors; onOpenPreview; onOpenDiff; onUndo }`。
  - 头部:`kind==='created'` → `＋ 新建 <file>`;`kind==='modified'` → `± 已编辑 <file>`(lucide `FilePlus` / `FileDiff`)。文件名下一行:`查看更改 ↗`(`before!==null` 时可点 → `onOpenDiff`;为 null 置灰)。
  - 右侧按钮区:`打开方式`(Radix popover 包 `OpenWithMenu`,保留)、`审核`、`撤销 ↩`。
  - `审核` 与 `查看更改` v1 **同行为**(都 → `onOpenDiff` 右侧 diff);保留两个入口以对齐 #61,预留未来 review 差异化(spec 明确其 v1 等价,非疏漏)。
  - `撤销`:点击先 `window.confirm`(文案随 kind:"把 <file> 恢复到编辑前?" / "删除新建的 <file>?"),确认后 `onUndo(file)`;成功后卡进入「已撤销」态(禁用撤销、按钮变灰标签)。`before===null` 时撤销不显示/置灰。
- **`Transcript.tsx`**:消息下方 chip 区改渲染新卡(接 `onOpenDiff`/`onUndo`);**删除 `item.type === 'diff'` 的内联 `DiffCard` 分支**。
- **`App.tsx`**:`rightPreview` 联合态 + `openDiff` + `handleUndo`(封装 `window.wraith.undoFileEdit`,失败弹提示);透传给 Transcript,`preview` 给 RightDock。

### 删除

- 内联 `DiffCard` 用法移除后,`DiffCard.tsx` 若无其他引用 → 连同其测试删除(`DiffView` 保留,右侧 pane 仍用)。实现时以 `rg` 确认无残余引用再删。

## 呈现

- 卡沿用①的圆角边框 + 轻背景、AgentMessage 两列缩进(`w-6` spacer);多文件纵向堆叠。
- `新建` 用中性/绿色调,`已编辑` 用中性调;`查看更改 ↗` 小字链接;`撤销` 破坏性 → hover 危险色。
- 右侧 diff pane 与内容预览共用「预览」段,后开者覆盖前者。

## 测试

- `artifactSummary`:diff → `before` 正确、created(before==='')/modified 判定;write_file-only → `before===null`;diff 与 write_file 卡合并时 diff 定 before/kind、content 取最新。
- `isPathWithinWorkspace`:工作区内文件 → true;`../` 逃逸 → false;workspace 为空 → false;target === workspace 边界。
- `undoFileEdit`(主进程,jsdom/node):modified 写回 before;created 删除;越界路径拒绝并 `{ok:false}`;>5MB before 拒绝。
- `FileArtifactCard`(jsdom):created 显「新建」/ modified 显「已编辑」;`before!==null` 点查看更改/审核 → `onOpenDiff(path, before, after)`;`before===null` → 查看更改/撤销 置灰;点撤销确认后 → `onUndo`;保留「打开方式」展开含 editors + Finder/下载。
- `OpenWithMenu`:抽文件后原 3 个用例照过。
- `RightDock`:`kind==='diff'` 渲染 DiffView(host)、`kind==='content'` 渲染 ArtifactPreview。

## 明确不做(YAGNI / 后续)

- 走快照的整轮撤销(本项目改用文件级写回;快照体系不动)。
- 审核作为独立于 diff 的 review 流程(v1 审核 == 查看更改)。
- 撤销后的"重做"。
- created 撤销时区分"原为空文件"vs"原不存在"(靠 confirm 弹窗兜底,用户可取消)。
- 顶栏「产物」摘要接入这些动作(维持现状)。
- 非 macOS 路径细节(本项目 macOS-only)。
