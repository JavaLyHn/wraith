# 产物摘要(置顶摘要)悬浮卡 — 设计

**日期**:2026-07-22
**状态**:设计已通过,待写实现计划
**范围**:桌面端(Electron/renderer),**纯前端**,不改 Java 后端 / 不重打 jar

## 背景与目标

参照 Codex 的「切换置顶摘要」(顶栏按钮弹出的悬浮卡,汇总当前会话的输出/子智能体/浏览器/来源),
给 wraith 桌面端新增一个 **产物摘要** 悬浮卡,一眼看清「本会话 agent 产出了什么」并可点击直达。

用户诉求原话:「参照 codex 新增一个……能够展示当前输出产物」。

## 关键决策(brainstorming 已敲定)

1. **范围**:全量对标 Codex 四段 —— 输出 / 子智能体 / 浏览器 / 来源。
2. **「输出」段语义**:文件 + 服务都放(上半文件产物、下半探测到的服务/预览 URL)。
3. **放置/交互**:顶栏新增图标按钮 → 点开弹 `ui/popover` 悬浮卡(点外部 / ESC 关闭)。
4. **「浏览器」段语义**:反映 **agent 的浏览器工具活动**(最后导航 URL),**不是**用户在 RightDock
   里手动浏览的 tab —— 后者 state 是 `BrowserPane` 局部的,v1 不提升(留 v2)。
5. **「+」按钮(手动添加输出/来源)**:v1 **不做**(核心是「展示」;手动管理 YAGNI)。
6. **数据周期**:按 **会话** 聚合(transcript state 本就随 `resetSession` 重置,天然对齐「当前」)。

## 架构

零后端改动。三块:

- **`deriveArtifacts(items, workspace)`**(纯函数,`src/shared/` 或 `src/renderer/lib/`,可单测):
  把 `TranscriptState.items` 派生成结构化摘要 `ArtifactSummary`。唯一有状态输入是 transcript,输出纯数据。
- **`SummaryPopover.tsx`**(`src/renderer/components/`):用既有 `ui/popover` 渲染四段;
  接收 `ArtifactSummary` + open 回调。
- **顶栏按钮**:在 `App.tsx` 顶部工具条(压缩/导出/rightdock 开关同一簇)加一个图标按钮
  (列表/清单类图标),tooltip「产物摘要」,作为 popover 的 trigger。

open 动作复用既有 IPC:`window.wraith.openPath(path)`、`window.wraith.openExternal(url)`。

### 数据结构

```ts
interface ArtifactFile { path: string; kind: 'created' | 'modified' }
interface ArtifactServer { url: string }          // 归一化后的 http(s):// 或 //host:port
interface ArtifactSource { path: string; name: string; kind: string } // 复用 AttachmentRef 形态
interface ArtifactSummary {
  files: ArtifactFile[]
  servers: ArtifactServer[]
  subagents: { total: number; done: number; roles: string[] } | null  // 无 team → null
  browserUrl: string | null                                            // 无浏览器活动 → null
  sources: ArtifactSource[]
  workspace: string | null
  isEmpty: boolean   // 四段皆空 → true(弹出显示空态)
}
```

## 四段数据映射

| 段 | 来源(transcript) | 规则 | 点击动作 |
|---|---|---|---|
| **输出·文件** | `type:'diff'{filePath,before,after}` item(write_file 执行后产出) | 按 `filePath` 去重取最新;`before===''`→`created` 否则 `modified` | `openPath`(相对路径按 `workspace` 解析成绝对) |
| **输出·服务** | `type:'tool'` 且 `name==='execute_command'` 的 `output` | 正则抽 `localhost:port` / `127.0.0.1:port` / `http(s)://…`;归一化 + 去重 | `openExternal` |
| **子智能体** | `type:'team'` item 的 `agents[]` 与 `steps[]` | `total=steps.length`;`done=steps.filter(status==='done').length`;`roles=agents.map(role)`;无 team → `null` | —(纯展示) |
| **浏览器** | `type:'tool'` 且 `name` 以 `browser` 或 `mcp__chrome-devtools__` 开头的工具卡 | 从 `argsJson` 的 `url` 字段(无则从 `output` 抽 URL)取值,按出现顺序取**最后一个**;无 → `null` | `openExternal` |
| **来源** | 用户消息 item 的 `attachments[]`(`AttachmentRef`) + `workspace` | 附件按 `path` 去重;工作目录单列一行 | 附件→`openPath(path)`;文件夹→`openPath(workspace)` |

## 交互与呈现

- 按钮点开 = `ui/popover` 悬浮卡,锚定顶栏按钮;点外部 / ESC 关闭(popover 原语自带)。
- 卡片内容随 transcript 实时更新(纯派生 + React 响应式)。
- 每段:标题(灰色小字)+ 行列表;**空的段整段隐藏**(与 Codex 一致,不显示空标题)。
- 「来源」超过 5 行时默认折叠到 5 行 + 显示「查看全部」→ **就地展开/折叠**(v1 不跳新页面)。
- **空态**:`isEmpty` 时弹出显示一行「本会话暂无产物」。按钮本身常显(不因空而消失)。
- 图标与配色沿用现有顶栏按钮风格(`text-fg-muted` / hover `bg-fg/5`;激活态 `text-accent`)。

## 测试

**纯函数 `deriveArtifacts`(vitest,主战场)**:
- 文件:多次写同一路径 → 去重取最新;`before===''` 标 created,否则 modified;相对/绝对路径都能给出可 open 的路径。
- 服务:从 execute_command output 抽 `localhost:5173` / `http://127.0.0.1:3000` / `https://…`;去重;无匹配 → 空。
- 子智能体:team item → `{total, done, roles}` 正确计数;无 team → `null`。
- 浏览器:多次浏览器工具调用 → 取最后 URL;无 → `null`。
- 来源:附件去重;含 workspace;空 → 空数组。
- 空态:全空 items → `isEmpty===true`。

**组件 `SummaryPopover`(jsdom + testing-library)**:
- 四段渲染;空段隐藏;`isEmpty` 显示空态文案。
- 点文件行 → `openPath` 被以正确路径调用;点服务/浏览器行 → `openExternal`;点附件 → `openPath`。
- popover 开/关(trigger 点击、ESC)。

## 明确不做(YAGNI / v2)

- 「+」手动添加输出/来源。
- 「浏览器」段反映 RightDock 手动 tab(需提升 BrowserPane state)。
- 产物按 turn 分组(v1 按整会话聚合)。
- create_project 等非 write_file 写入的文件产物(v1 只认 `diff` item = write_file;其余按需再扩)。
