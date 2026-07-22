# 文件产物卡 + 「打开方式」设计(子项 ①)

**日期**:2026-07-22
**状态**:设计已通过,待写实现计划
**范围**:桌面端(Electron renderer + 主进程),**不改 Java 后端 / 不重打 jar**;主进程改动 → 需重启 dev App

## 背景

参照 Codex 的文件输出卡(Image #56/#58),把当前回复下方"简单 pill"(`ArtifactChips`)升级成信息更全、更好看的**文件产物卡**:文件名 + 类型标签 + 「打开方式」下拉。这是 Codex 式文件输出体验三子项(①卡+打开方式 / ②审核→右侧diff / ③已编辑卡+撤销)中的**第一项**;②③ 各自后续单独 spec。

用户原话:当前"不好看",要像 Codex 那样,「打开方式」见 #58。

## 关键决策(已敲定)

1. **只改回复下方产物卡**;顶栏「产物」摘要维持现状(打开方式后续再加)。
2. **点卡体/文件名 → 右侧内容预览**(复用现有 `openArtifact`,保留;②再统一右侧 diff 口径)。
3. **编辑器自动探测**:主进程扫 `/Applications`(+`~/Applications`)探测常见编辑器,只列已装的。
4. 固定项恒有:默认程序 / 在 Finder 中显示 / 下载副本(到 `~/Downloads`);Terminal 视作探测项之一(几乎必在)。

## 架构

renderer + Electron 主进程;零 Java。

### 主进程新增 IPC(`src/main/index.ts` + `src/preload/index.ts`)

| IPC | 行为 | 安全 |
|---|---|---|
| `revealInFinder(path): Promise<void>` | `shell.showItemInFolder(path)` | path 来自 transcript(agent 写过的文件),与现有 openPath 同信任级 |
| `openWithApp(path, appPath): Promise<void>` | spawn `open -a <appPath> <path>`(macOS),shell:false 定长参数 | appPath **必须**是 `listEditors()` 返回过的真实 `.app`(主进程侧校验存在且以 `.app` 结尾);path 同上 |
| `downloadCopy(path): Promise<string>` | 复制到 `~/Downloads/<basename>`,重名则 `name (2).ext` 递增;返回目标绝对路径;成功后 `shell.showItemInFolder(dest)` | 只读源 + 写入固定 Downloads 目录 |
| `listEditors(): Promise<EditorApp[]>` | 探测已装编辑器,返回 `{name, appPath}[]` | 只读 /Applications;结果缓存 |

`EditorApp = { name: string; appPath: string }`。

### editors 探测(主进程纯函数,可单测)

`detectEditors(appDirEntries: string[]): EditorApp[]`(`src/main/editors.ts`):
- 已知编辑器表(bundle 名 → 展示名):`Terminal.app`→Terminal、`Visual Studio Code.app`→VS Code、`Cursor.app`→Cursor、`Xcode.app`→Xcode、`IntelliJ IDEA.app`/`IntelliJ IDEA CE.app`→IntelliJ IDEA、`Sublime Text.app`→Sublime Text、`Zed.app`→Zed。
- 输入 = `/Applications` 与 `~/Applications` 的 entry 名合并;输出 = 命中已知表的、按已知表顺序去重(appPath 拼绝对路径)。
- 主进程 handler 用 `fs.readdirSync` 取 entries 注入该纯函数;探测结果进程内缓存一次。

### downloadCopy 目标名(主进程纯函数,可单测)

`uniqueDownloadName(existing: Set<string>, base: string): string`:base 不冲突则原名;否则 `name (2).ext`、`name (3).ext`… 直到不冲突。

### renderer

- **`FileArtifactCard`**(`src/renderer/components/FileArtifactCard.tsx`,纯展示,可单测):
  props `{ file: ArtifactFile; editors: EditorApp[]; onOpenPreview: (f) => void; onOpenPath; onRevealInFinder; onOpenWith; onDownloadCopy }`。
  渲染:📄 + 文件名(点→onOpenPreview)+ 类型标签 + 「打开方式」`ui/popover`(默认程序 / editors 各项 / 分隔 / 在 Finder 中显示 / 下载副本)。
- **类型标签**`fileTypeLabel(path): string`(`src/renderer/lib/fileType.ts` 纯函数):按扩展名映射 文档/代码/配置/样式/文件,返回 `<类别> · <EXT>`;无扩展名 → `文件`。
- **editors 获取**:App 层 `useEffect` 调 `window.wraith.listEditors()` 存 state,传给 Transcript → FileArtifactCard(拉一次,失败则空数组,只留固定项)。
- **Transcript**:把命中消息下方渲染的 `ArtifactChips` 换成「每文件一张 `FileArtifactCard`」。回调接 App 的既有 `openArtifact`(预览)+ 新 IPC 封装。
- **移除** `ArtifactChips.tsx` 及其测试 `test/artifactChips.test.tsx`(被 `FileArtifactCard` 取代)。`filesUnderMessages`(决定哪些文件挂哪条消息)**保留不变**。

## 呈现

- 卡:圆角边框 + 轻背景,与 DiffCard/现有卡风格一致;左对齐正文(沿用 AgentMessage 两列布局或缩进)。
- 「打开方式」下拉右对齐;每项带小图标(lucide);分隔线区隔「用 X 打开」与「Finder/下载」。
- 多文件 → 多张卡纵向堆叠。

## 测试

- `fileTypeLabel`:md→`文档 · MD`、ts→`代码 · TS`、json→`配置 · JSON`、无扩展→`文件`。
- `detectEditors`:给定含 `Visual Studio Code.app`/`Xcode.app`/`未知.app` 的列表 → 只返回已知项、按表序、appPath 正确;`~/Applications` 也纳入。
- `uniqueDownloadName`:无冲突原名;冲突 → `(2)`；多次冲突递增;无扩展名也正确。
- `FileArtifactCard`(jsdom):渲染文件名 + 类型标签;点文件名 → onOpenPreview;展开「打开方式」→ 含默认程序/在 Finder 显示/下载副本 + 传入的 editors;点各项 → 对应回调以正确参数被调。

## 明确不做(留 ②③ / 后续)

- 「审核」→ 右侧 diff(②)。
- 「已编辑卡 +N -M」+ 撤销(③)。
- 顶栏「产物」摘要的打开方式(后续)。
- 非 macOS 的 openWithApp(本项目 macOS-only)。
- 编辑器"用命令行工具打开"(如 `code`/`idea` CLI);v1 一律 `open -a <app>`。
