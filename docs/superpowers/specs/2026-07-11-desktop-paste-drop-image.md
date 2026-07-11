# 桌面 Composer 粘贴 / 拖拽图片

- 日期:2026-07-11
- 状态:draft → 实现中
- 关联:CLI 的 `@clipboard` / Ctrl+V 粘贴截图(`ImageReferenceParser`、`Main.java:3069 bindCtrlVToClipboardImage`)

## 背景 / 动机

CLI 有两个高频图片入口:**Ctrl+V 粘贴剪贴板截图**、手打 `@image:<路径>` / `@clipboard`。
桌面版目前**只有** 📎 附件选择器能加图片(走 `pickAttachments` → 文件对话框),
**无法粘贴、无法拖拽**——而「截图即贴」恰恰是桌面用户最自然的期待。全渲染层无
`onPaste` / `onDrop` 处理(已核实)。本 spec 补齐这块,做到与 CLI 能力对齐。

## 目标

1. 在 Composer 输入框 **Ctrl/Cmd+V 粘贴图片** → 自动成为一个 image 附件。
2. 把图片文件(或任意文件)**拖拽进 Composer** → 自动成为附件(图片 image / 其它 text)。
3. **零 Java 后端改动**:两条都汇入现有附件通道
   `AttachmentItem{path,name,kind}` → `submitTurn` → `TurnAttachments.resolve` → base64 imageParts。

## 非目标

- 不做 `@image:` 文本 token 的自动补全(桌面用附件面板范式,不复刻 CLI 的打字 token)。
- 不改 `TurnAttachments` 的校验/上限逻辑(桌面沿用后端既有的 4MB/图、2MB/轮上限)。
- 不做粘贴富文本/HTML 转图。只认剪贴板里的 image blob。

## 关键约束(为什么要落临时文件)

现有附件通道 `TurnAttachments.resolve`(Java)是**按 `path` 从磁盘读文件**的。
- **拖拽**的 OS 文件本身有磁盘路径 → 直接取路径即可(Electron 32 用 `webUtils.getPathForFile`,`File.path` 已移除)。
- **粘贴**的截图是内存 blob、**没有路径** → 必须先写到临时文件,再造 `AttachmentItem{path}`。
  这与 CLI 一致:`ClipboardImage.grab()` 也是抓图落临时文件返回 `grab.path()`。

## 设计

### 数据流

```
粘贴:onPaste → clipboardData 里的 image blob → base64
      → IPC wraith:saveTempImage(base64, ext) → 主进程写 os.tmpdir()/wraith-paste/xxx.png
      → 返回 AttachmentItem{path,name,kind:'image'} → onAddAttachments

拖拽:onDrop → dataTransfer.files → 每个 File 经 preload webUtils.getPathForFile → 磁盘路径
      → attachmentKind(path) → AttachmentItem → onAddAttachments
      (无路径的极端情况,如从浏览器拖图 → 回退到「粘贴」的 blob→saveTempImage 分支)

两条最终都进 attachments state,发送时与 📎 选中的附件同路走 submitTurn。
```

### 改动面

1. **主进程 `src/main/index.ts`** — 新增 IPC `wraith:saveTempImage`
   - 入参 `(base64: string, ext: string)`;`ext` 白名单 `png/jpg/jpeg/gif/webp`,非法则抛友好中文。
   - 解码 `Buffer.from(base64,'base64')`,粗上限(如 20MB,后端会再按 4MB 复核)。
   - 写 `path.join(os.tmpdir(), 'wraith-paste', tempImageName(ext, seq))`,目录不存在则建。
   - 返回 `{ path, name, kind: 'image' }`(name = basename)。
   - 文件名用 `Date.now()` + 进程内自增 seq,无随机密钥、无敏感信息。

2. **preload `src/preload/index.ts`**
   - `import { ..., webUtils } from 'electron'`
   - `saveTempImage(base64, ext) → invoke('wraith:saveTempImage', ...)`
   - `pathForFile(file: File): string → webUtils.getPathForFile(file)`(官方 Electron 32 迁移写法)
   - `WraithApi` 接口补两条签名。

3. **共享纯函数 `src/renderer/lib/composerAttachments.ts`(可单测)**
   - `imageExtFromMime(mime: string): string | null` — `image/png`→`png` 等,未知 → null
   - `isImageMime(type: string): boolean`
   - `pathsToImageOrTextAttachments(paths: string[]): AttachmentItem[]` — 复用 `attachmentKind` 造条目
   - 事件里只做「取 blob / 取路径」的薄胶水,判定逻辑全在这里,便于测试隔离。

4. **`src/renderer/components/Composer.tsx`**
   - textarea 加 `onPaste`:剪贴板含 image blob 时 `preventDefault` 并加附件;**纯文本粘贴不拦**(照常插入)。
   - 容器加 `onDragOver`(preventDefault + 高亮态)/ `onDragLeave` / `onDrop`。
   - 新增 `dragOver` state → 拖拽时给容器一圈 accent ring 视觉反馈。
   - 新增 prop `onAddAttachments?(items: AttachmentItem[])`。
   - `running` 时与现有 📎 按钮一致:粘贴/拖拽 no-op(不加附件)。
   - 轻量错误提示复用现有 `sttError` 同款样式的一行 `attachError`(超限/非图报友好中文)。

5. **`src/renderer/App.tsx`**
   - `handleAddAttachments = (items) => setAttachments(prev => [...prev, ...items])`
   - 作为 `onAddAttachments` 传给 Composer。
   - 全窗兜底:`useEffect` 里对 window 的 `dragover`/`drop` `preventDefault`,防 Electron 拖文件进窗口触发 `file://` 导航。

### 安全红线

- 临时图片文件不含任何密钥;IPC 只传 base64 图像数据 + 扩展名。
- 异常只报 `e` 的简单类名 / 友好中文,不回传路径细节。
- 不写真实 config / 索引 / 审计 / memory。

## 测试(TDD,遵守测试隔离铁律)

- `desktop/test/composerAttachments.test.ts`(vitest,纯函数):
  - `imageExtFromMime`:各 mime 映射 + 未知 → null
  - `isImageMime`:image/* → true,text/plain → false
  - `pathsToImageOrTextAttachments`:图片路径 → kind image;`.md` → kind text;basename 正确
- 主进程 `tempImageName(ext, seq)` / `validImageExt` 抽成纯函数,单测(不碰真实 fs)。
- typecheck / vitest / build 全绿;jar 无需重打(纯前端 + Electron 主进程 TS)。

## 验收

- 截图后在输入框 Cmd+V → 出现一个图片附件 chip → 发送后模型能看到图。
- 从 Finder 拖一张 png 进输入框 → 附件 chip;拖一个 .ts → text 附件 chip。
- 纯文本 Cmd+V 仍正常插入文字,不被拦。
- 拖文件到窗口空白处不再导致界面跳 `file://`。
