# 桌面端「文档」面板 —— 设计说明

- 日期：2026-08-04
- 状态：设计确认，待实现
- 分支：`feat/windows-parity-block1`
- 触发：用户要求「在左侧工具栏专门设计一个文档功能，存放文件（暂时就做存放）」

---

## 0. 一句话

在桌面端左侧栏新增「资料 › 文档」面板，把用户手动放进来的参考资料**拷贝**进 `~/.wraith/documents/` 扁平存放，提供添加/列表/搜索/打开/定位/删除六件事，**全部在 Electron 侧实现，不改 Java 后端**。

---

## 1. 需求边界

### 1.1 做什么

| 能力 | 说明 |
|---|---|
| 添加 | 拖拽入库 + 点按钮走系统文件选择器 |
| 列表 | 类型图标、文件名、大小、入库时间 |
| 搜索 | 按文件名实时过滤 |
| 打开 | 调系统默认程序 |
| 定位 | 在访达 / 资源管理器中显示 |
| 删除 | 二次确认后删除库内实体文件 |

### 1.2 明确不做（这一版）

- **不做检索**：不切片、不做 embedding、不进 RAG 索引。
- **不做 agent 访问**：不加 `documents_*` 工具，LLM 这一版看不见这些文件。
- **不做子目录 / 标签 / 备注**：扁平列表。
- **不做版本 / 同步**：拷进来就是快照，源文件后续修改不回流。
- **不做在线预览**：打开一律交给系统默认程序。

### 1.3 用途定位

这是**用户自己的资料库**，全局所有，与当前打开哪个项目无关。区别于既有的三个近邻：

| 面板 | 装什么 | 谁写入 |
|---|---|---|
| 代码检索（rag） | 当前项目源码索引 | 程序建索引 |
| 记忆（memory） | 提炼出的事实条目 | agent 提取 + 用户批准 |
| **文档（本设计）** | **原始资料文件** | **用户手动放** |

---

## 2. 现状盘点（读码确认，非推测）

### 2.1 左侧栏结构

`desktop/src/renderer/components/Sidebar.tsx:112` 的 `TOOL_GROUPS` 现有三组共 11 项，分组依据写在 `:103-111` 的注释里 —— 依据是**什么时候会点它**，不是功能相似：

| 组 | 语义 | 现有项 |
|---|---|---|
| 配置 | 装好一次，几周不动 | MCP、Provider 配置、技能 |
| 运行 | 后台跑着，有状态、可能带红点 | 自动化、IM 网关、后台任务 |
| 观察 | 出事了回头查，只读为主 | 记忆、快照、安全、浏览器、代码检索 |

### 2.2 新增一个面板要动的地方

| 文件 | 改动 |
|---|---|
| `renderer/components/Sidebar.tsx` | `ToolNav` 类型（`:100`）+ `TOOL_GROUPS`（`:112`）+ props 的 `onOpenXxx` |
| `renderer/lib/panelActions.ts` | `PanelId` 联合类型 + `PANEL_LABELS` |
| `renderer/App.tsx` | `view` 状态联合类型（`:187`）+ 渲染分支（`:1089` 起）+ 传 handler（`:1042` 起） |
| `renderer/lib/commandPalette.ts` | `NAV_ITEMS` —— ⌘K「导航」组的注册表 |
| `tool/ToolRegistry.java` | `open_panel` 的 `panels` 白名单 + 工具描述/参数描述里枚举的面板名 |
| `resources/prompts/capabilities.md` | 「Wraith 产品能力」表格加一行 |

> 前三处是「面板能不能打开」，后三处是**已交付的不变量**，漏了不会报错、只会静默退化，
> 本次 final review 三条都中了：
>
> - 漏 `NAV_ITEMS` → 其余 11 个面板都能从 ⌘K 到达，只有新面板不行，用户当成 bug。
>   `NAV_ITEMS.view` 从前是裸 `string`，tsc 抓不到；现已收紧成 `PanelId` 并加了一条
>   编译期「每个 PanelId 都必须登记」断言，下次会直接编译失败。
> - 漏 `open_panel` 白名单 → 模型传新 panel 只拿到「未知面板」，**动作卡永远不出现**，
>   「聊天↔面板对等」被悄悄破掉。
> - 漏 `capabilities.md` → agent 不知道这个面板存在；用户问「能不能存资料」时它甚至会
>   按那段 prompt 去 `grep_code` 用户项目代码。
>
> 后两处要 `mvn package` + `cp` 到 `~/.wraith/wraith.jar` + 重启 App 才生效（纯 List /
> 资源文件改动，不涉及逻辑），这个「Java 税」是加面板的固定成本，不是可选项。

### 2.3 可复用的既有能力

- `main/fileOpen.ts` —— 已有跨平台「用系统默认程序 / 探测到的编辑器打开」逻辑，含 Windows 分支。
- `ipcMain.handle('wraith:openPath')`（`main/index.ts:1427`）—— `shell.openPath` 已接好。
- `dialog.showOpenDialog` 在 `main/index.ts` 有多处既有用法可照抄（含 `mainWindow` 为空时的降级）。
- 所有 IPC **统一注册在 `main/index.ts`**，无分文件注册的先例。

---

## 3. 存储模型

### 3.1 目录布局

```
~/.wraith/documents/
  ├── 需求文档.pdf
  ├── 需求文档 (1).pdf        ← 重名自动加序号，不覆盖
  └── API 设计.md
```

扁平，与 `~/.wraith/` 下既有的 `memory/ rag/ skills/ sessions/` 平级。

### 3.2 没有索引文件

**目录本身就是唯一真相源。** 列表数据全部从文件系统现算：

| 字段 | 来源 |
|---|---|
| `name` | 文件名 |
| `size` | `lstat.size` |
| `addedAt` | `lstat.birthtime`；为 0 或无效时退回 `lstat.mtime` |
| 类型图标 | 扩展名映射（渲染侧算，不落盘） |

理由三条：

1. 用户手动往目录里扔文件立刻能被认出来，不需要"重建索引"这种操作。
2. 不存在索引与实体不同步、索引损坏的失败模式。
3. 将来 Java 侧要读，`ls` 一下就完事，不必解析任何私有格式 —— 这是「目录即契约」的核心。

代价是存不了标签、备注这类附加元数据。这一版不需要；真要加时再引入索引文件，届时目录里的实体文件不受影响。

### 3.3 列目录规则

- 只列**普通文件**，跳过子目录**与符号链接** —— 用 `lstat` 而非 `stat`（软链的 `lstat().isFile()` 为 false，自然跳过）。
- 跳过 `.` 开头的隐藏文件（挡 `.DS_Store` 一类噪音）。
- 跳过名字含反斜杠的文件（POSIX 上合法，从 Windows 拷来就能产生）。
- 默认按 `addedAt` 倒序（最近放进来的在最上面）。

**列举口径必须与 `resolveInVault`（§4.2）的「什么算库内条目」逐条对齐**，否则面板里会出现**看得见却删不掉**的死行 —— 列出来了，但 `open`/`reveal`/`remove` 三个动作全抛，用户只能去访达删。首版实现用了跟随软链的 `stat`，final review 实测复现了两个实例：

| 条目 | 列表侧（曾） | 三个动作侧 | 用户看到 |
|---|---|---|---|
| 库内软链 → 库外文件 | `stat().isFile()` 为 true → 列出 | realpath 越界校验 → 抛 | 一行删不掉，点开还弹「路径越界」（听着像安全事故） |
| 名字含反斜杠的普通文件 | 列出 | 名字合法性校验 → 抛 | 一行删不掉，报「非法文件名」 |

两条各有一个用例钉在 `test/documents.test.ts` 里，且同时断言 `resolveInVault` 对同一个名字**确实是抛的** —— 这样两侧口径一旦再次分叉就会红。

### 3.4 重名消歧

**直接复用既有的 `uniqueDownloadName(existing, base)`**（`main/fileOpen.ts:28`，「下载副本」走的就是它，`test/fileOpen.test.ts:28` 已有测试覆盖）。目标名已存在时在扩展名前插入 ` (n)`，n 从 **2** 起递增：

```
a.pdf → a (2).pdf → a (3).pdf
无扩展名的 README → README (2)
```

**绝不覆盖已有文件。** 序号从 2 而非 1 起是既有实现的既定行为，跟着它走以保持全应用一致，不为这一个面板另造一套。

---

## 4. 模块边界

五个单元，每个职责单一：

| 文件 | 职责 | 依赖 | 可测性 |
|---|---|---|---|
| `main/documents.ts` | 目录解析、重名消歧、路径安全校验、列目录、拷贝、删除 | `fs`/`path`，**不 import electron** | 纯 vitest |
| `main/index.ts` | 注册 5 个 IPC handler，接 `dialog`/`shell` | 调用上者 | 走既有 e2e |
| `preload/index.ts` | 暴露 `wraith.documents.*` | — | — |
| `renderer/lib/documentsView.ts` | 过滤、排序、大小格式化、扩展名→图标 | 纯函数 | 纯 vitest |
| `renderer/components/DocumentsPanel.tsx` | 渲染 + 拖拽区 | preload + 上者 | vitest + RTL |

`main/documents.ts` 不 import electron 是硬约束 —— 这样它能在纯 Node 环境下被 vitest 直接测，路径逃逸那组用例才好写。

### 4.1 IPC 面

```ts
wraith.documents.list()                 → Promise<DocEntry[]>
wraith.documents.add(paths?: string[])  → Promise<AddResult>   // 无参弹选择器；有参走拖拽
wraith.documents.remove(name: string)   → Promise<void>
wraith.documents.open(name: string)     → Promise<void>
wraith.documents.reveal(name: string)   → Promise<void>
```

```ts
interface DocEntry { name: string; size: number; addedAt: number }
// added:  入库后的最终文件名（可能带 " (1)" 后缀）
// failed: name 为源文件的 basename，reason 面向用户可读
interface AddResult { added: string[]; failed: { name: string; reason: string }[] }
```

### 4.2 入参是文件名，不是路径

`remove` / `open` / `reveal` 一律只接**库内文件名**，主进程负责拼回绝对路径 —— 这三个（尤其 `remove`）是库内的破坏性/外泄面，渲染进程不该有能力对它们指定任意路径。

⚠ 别把这句读成「整条 IPC 面都拿不到任意路径」：`documents:add` **本来就收渲染进程给的任意绝对路径**（拖拽必须如此），仓库既有的 `wraith:openPath` / `wraith:downloadCopy` 也早就接受任意路径。这里成立的是收窄后的那句：**库内的破坏性写操作只接受文件名。**

主进程侧校验（`resolveInVault`），**顺序不可调换**：

1. **名字合法性**：拒绝含路径分隔符（`/`、`\`）、等于 `.` / `..`、或为空的名字 → 抛「非法文件名」。
2. **存在性**：`path.resolve(VAULT, name)` 若不存在 → 返回「不存在」而非抛错，由调用方决定语义（`remove` 幂等成功，`open`/`reveal` 报「文件已不存在」）。这一步必须在 realpath 之前，因为 `realpathSync` 对不存在的路径直接抛 ENOENT，混在一起就分不清「文件没了」和「路径越界」。
3. **越界校验**：对存在的路径 `fs.realpathSync`，断言结果仍在 `realpath(VAULT)` 之内，否则抛「路径越界」。

第 3 步用 realpath 而非字符串前缀比较，是为了挡住**符号链接**：库内一个指向 `~/.ssh/` 的软链，字符串上看在库内，realpath 之后就露馅了。这是 `remove` 唯一真正危险的操作面。

---

## 5. UI

### 5.1 侧栏位置

`TOOL_GROUPS` 新增第四组「资料」，排在三组之后，目前仅「文档」一项：

```
配置  MCP / Provider 配置 / 技能
运行  自动化 / IM 网关 / 后台任务
观察  记忆 / 快照 / 安全 / 浏览器 / 代码检索
资料  文档                              ← 新增
```

理由：前三组讲的都是「agent 怎么工作」，文档讲的是「我的东西」，塞进任何一组都会让那组的分类依据失效。为一项开一组的代价是多一行小标题，可接受 —— 且这一组天然还能长（将来的剪藏、导出归档都属于这里）。

图标用 lucide 的 `FolderOpen`（与「技能」的 `BookOpen`、「记忆」的 `Brain` 区分度够）。

### 5.2 面板布局

```
┌──────────────────────────────────────────────┐
│ ← 文档                     [🔍 搜索  ] [+ 添加] │
├──────────────────────────────────────────────┤
│ 📄  需求文档.pdf          2.4 MB   3 天前      │   ← 未悬停:右侧留白
│ 📝  API 设计.md            18 KB   昨天   🔍 🗑 │   ← 悬停:图标淡入
│ 📊  竞品分析.xlsx         840 KB   刚刚       │
└──────────────────────────────────────────────┘
```

- 整个面板是 drop zone，拖到任意位置都收；拖拽悬停时整块高亮。
  - 只在 `dataTransfer.types` 含 `Files` 时才亮 —— 拖选中的文本把整块点亮是个假承诺。
  - `dragleave` 只在 `e.currentTarget === e.target` 时收起高亮，否则鼠标在文件行之间移动（`dragleave` 冒泡）会让高亮抖。两条都照 `Composer.tsx:230/237` 的既有写法。
- **拖拽取磁盘路径必须走既有的 `window.wraith.pathForFile(file)`**（内部是 `webUtils.getPathForFile`）—— Electron 32 已移除 `File.path`，直接读会拿到 `undefined`。Composer 的附件拖拽用的就是这个。
- 行内动作是**悬停淡入的图标**（打开 = 点文件名本身，定位 = `FolderSearch`，删除 = `Trash2`），不做 `⋯` 下拉菜单：
  - 与侧栏会话行的既有交互一致（那里也是 hover 出图标 + 就地确认），不给应用多引入一套菜单模式；
  - 只有三个动作，其中「打开」还落在文件名上，套一层菜单是多一次点击换来零收益。
- 删除走二次确认：第一次点击把图标换成 ✓ 并变红，再点一次才真删（复用侧栏会话删除那种就地模式，不弹 modal）；鼠标移出列表即取消待确认态。
- 空态：虚线框 + 「把文件拖进来，或点右上角添加」。
- 搜索框在库内文件 ≤ 1 个时不显示（省掉多余 UI），**但只要过滤词非空就照样渲染** —— 否则「3 个文件→输过滤词→删到只剩 1 个且不匹配」会把输入框卸载掉而 `query` 仍在生效，用户看到「没有匹配「xxx」」却无处可清，只能退出面板重进。

---

## 6. 错误处理

原则：**单条失败不影响整批，错误就地显示不弹窗。**

| 情况 | 行为 |
|---|---|
| 批量添加时某文件读不了 | 其余继续拷；结尾 inline 提示「3 个成功，1 个失败：xxx 无读取权限」 |
| 拖进来的是文件夹 | 跳过，计入 `failed`，理由「暂不支持文件夹」 |
| 目标磁盘写满 | 该条计入 `failed`，理由带原始 errno |
| 删除时文件已不在 | 幂等成功，刷新列表 |
| `~/.wraith/documents/` 不存在 | 首次访问自动 `mkdir -p`，不报错 |
| 打开失败（无默认程序） | inline 错误条 |
| 名字校验不过（含分隔符等） | 主进程直接抛，渲染侧显示「非法文件名」 |

两条实现约束：

1. **`failed[].reason` 必须是中文。** 直接透传 Node 的 `err.message` 会得到 `ENOENT: no such file or directory, stat '/…'` 这种一整串英文 + 完整源路径，与同函数里已有的「暂不支持文件夹」不是一个口径。`documents.ts` 里的 `copyFailReason` 做 errno → 中文映射（ENOENT / EACCES / EPERM / ENOSPC / EISDIR），**未收录的 errno 保留原文** —— 罕见故障宁可原样透出也别吞掉（上表「磁盘写满」要的就是能查到 errno，故那条中文里也带着 `ENOSPC`）。
2. **渲染侧显示前必须过 `ipcErrorText`。** `list`/`open`/`reveal`/`remove` 的错误全来自主进程 `throw`，经 `ipcRenderer.invoke` 回来后 message 被 Electron 套了一层 `Error invoking remote method '<channel>': Error: ` 前缀 —— 直接贴出来，上表里精心写的「文件已不存在」全都变成半截英文包装串。该函数是从 `automationLabels.saveErrorText` 里抽出来的共享件（那边现已复用它，不是两份正则）。反过来，`add` 的 `failed[].reason` 是**当数据回传**、本来就干净，**不要**给它套这个函数。

---

## 7. 测试

| 测试文件 | 覆盖 |
|---|---|
| `test/documents.test.ts` | **路径逃逸拦截**（`../` 相对路径、绝对路径、库内软链指向库外）；**「文件不存在」与「路径越界」两条分支不混淆**；隐藏文件与子目录过滤；birthtime 为 0 时回退 mtime；重复添加走 `uniqueDownloadName` 不覆盖（消歧算法本身已由 `fileOpen.test.ts` 覆盖，此处只测接线）；**列举口径与 `resolveInVault` 对齐**（软链、含反斜杠的名字都不出现在列表里，见 §3.3）；`copyFailReason` 的 errno → 中文映射与「未收录 errno 保留原文」 |
| `test/ipcError.test.ts` | `ipcErrorText` 剥 Electron IPC 前缀（含无第二层 `Error: ` 的形态）、无前缀原样透出、空消息走 fallback |
| `test/documentsView.test.ts` | 搜索过滤（大小写不敏感）；默认倒序；大小格式化（B/KB/MB 边界）；扩展名→图标映射含未知扩展名兜底 |
| `test/documentsPanel.test.tsx` | 空态渲染；列表渲染；删除二次确认（首次点击不触发删除）；添加失败时 inline 提示；主进程错误的 IPC 包装前缀被剥掉；过滤词非空时保留搜索框；拖拽只认 `Files` 且 `dragleave` 冒泡不熄灭高亮 |
| `test/commandPalette.test.ts`（改） | 按 `action` **点名断言 12 个面板都能从 ⌘K 到达** —— 纯数量断言挡不住漏登记（改个数字就绿了） |
| `test/sidebarToolGroups.test.tsx`（改） | 四组断言，「资料」组含文档项 |
| `test/panelActions.test.ts`（改） | `documents` 在 `PANEL_LABELS` 内，`normalizePanel('documents')` 有效 |

路径逃逸那组是重点，三种输入各一条用例，断言**抛错而非静默跳过** —— 静默跳过会让调用方误以为删成功了。

不加 playwright e2e：既有 e2e 有一簇负载相关抖动，为一个纯本地文件面板增加 e2e 面不划算；vitest + RTL 已能覆盖到交互层。

---

## 8. 取舍记录

| 决定 | 备选 | 为什么这样选 |
|---|---|---|
| 拷贝进库 | 只存路径引用 | 引用会因源文件移动/删除大面积断链，列表里堆死条目；拷贝换来的是稳定 |
| 无索引文件 | `index.json` 存元数据 | 目录即真相源，无同步/损坏失败模式；这一版不需要标签备注 |
| 纯 Electron 实现 | 走 Java app-server RPC | 改 Java 要 `mvn package` + `cp` 到 `~/.wraith/wraith.jar` + 重启 App 才生效，为「暂时就做存放」付这个税太早；目录契约保证将来接后端无需重构 |
| 新增「资料」组 | 塞进「观察」组 | 前三组分类依据是「agent 怎么工作」，文档是「我的东西」，混入会让分类依据失效 |
| **库内的破坏性写操作**（`remove`/`open`/`reveal`）只接文件名 | 一律传绝对路径 | 渲染进程不该有能力对库内条目指定任意路径，尤其对 `remove`。注意这条**只覆盖这三个**：`add` 收的就是渲染进程给的任意绝对路径（拖拽必须如此），`wraith:openPath` / `wraith:downloadCopy` 亦然 —— 写宽了会让后来人以为整条 IPC 面都有这个性质 |

---

## 9. 将来的扩展点（本版不实现）

留好接口形状，不写代码：

- **喂 RAG**：`~/.wraith/documents/` 作为一个索引 scope 加进现有 RAG 面板。因为是扁平真实目录，直接指过去即可。
- **带进对话**：面板里选中文件 → 走既有 `submitTurn(input, attachments)` 的 attachments 通道，格式已经是 `{ path, kind }`。
- **agent 访问**：加 `documents_list` / `documents_read` 工具，Java 侧读同一目录。
