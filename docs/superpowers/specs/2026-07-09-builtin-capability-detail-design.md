# 内置能力可点击查看详情 (Built-in Capability Detail View) 设计

**日期:** 2026-07-09
**分支:** 待定(建议 feat/mcp-builtin-detail,自 main 起)
**状态:** 设计已获批,待用户复核 spec

## Goal

让 MCP 面板「能力概览」里的 9 张「内置能力」卡片可点击,点进去查看该能力下每个内置工具的**真实定义**(真名 + 描述 + 参数 schema),数据来自后端 `ToolRegistry`(与模型实际看到的一致),消除"内置能力点不进去看具体内容"的问题。

## 背景与问题

`desktop/src/renderer/components/PluginsPanel.tsx` 的右侧详情已支持:左列点一个真实 MCP server → 右侧出 tools/resources/prompts/logs 四个 tab(数据来自后端)。

但「能力概览」(默认视图)里的 9 张「内置能力」卡片是**前端硬编码的静态展示卡**(`desktop/src/renderer/lib/pluginShowcase.ts` 的 `BUILTIN_CAPABILITIES`):

```ts
{ id: 'files', icon: '📄', name: '文件读写', desc: '读取与写入项目文件', tools: ['read_file', 'write_file'] }
```

它们渲染成不可点的 `<div>`,只有 hover tooltip 列一下工具名。每张只有 `{icon, name, 一句话描述, 工具名数组}`,**没有每个工具的真实描述/参数**。用户想点进去看"具体内容"却点不动。

后端已有权威数据源:`ToolRegistry.getToolDefinitions()`(`src/main/java/com/lyhn/wraith/tool/ToolRegistry.java:1143`)返回 `List<LlmClient.Tool>`,`Tool` 为 `record Tool(String name, String description, JsonNode parameters, ToolExecutor executor)`——正是发给模型的工具定义,只是没通过 RPC 暴露。当前 AppServer 无任何 `tool.*` RPC。

## 关键决策(来自设计对话)

| # | 决策 | 选择 |
|---|---|---|
| Q1 | 详情数据来源 | **后端权威数据**。新增只读 RPC 吐 `getToolDefinitions()`,与模型看到的一致、与真实 MCP server 详情一致、单一真相源,不漂移。 |
| Q2 | 详情展示形态 | **复用右侧详情面板**。点能力卡 → 右侧(现在显概览的同一区域)切成能力详情,顶部「← 概览」返回。只读,与现有 server 详情同区域同样式。 |

## 架构

reducer/流式/CLI 完全无关(纯 MCP 面板 + 一个只读后端 RPC)。三部分:
1. 后端只读 RPC `tools.list` 暴露内置工具目录(`getToolDefinitions()` 序列化)。
2. 前端纯函数把"能力的工具名数组"与"后端目录"join 成可渲染的工具行(含漂移标记)。
3. `PluginsPanel` 把内置能力卡片改为可点,右侧详情增第三态「能力详情」。

### 数据来源与连接键

- 后端 `getToolDefinitions()` 给**全量**内置工具定义(name/description/parameters)。
- 前端 `BUILTIN_CAPABILITIES` 是策展分组(9 类,每类含若干工具名)——分组留前端,**定义**取后端。
- 连接键 = **工具名**。前端按每张卡的 `tools: string[]` 到后端目录里查定义。

### 漂移处理(不静默)

- 能力声明的工具名在后端目录里**找不到** → 该行以淡色标记「定义缺失 / 当前不可用」,暴露 `BUILTIN_CAPABILITIES` 与 `ToolRegistry` 的漂移,而非静默隐藏。
- 后端目录里存在但不属于任何能力卡的工具 → 不在本特性范围(9 张卡为策展全集;若漂移,属单独维护项)。

## 后端改动(只读旁路)

1. **`AppServer.SessionRunner.builtinTools()`**(新 default 方法):
   ```java
   /** 内置工具目录(= 模型看到的定义)。默认空。供 UI 只读展示。 */
   default java.util.List<com.lyhn.wraith.llm.LlmClient.Tool> builtinTools() {
       return java.util.List.of();
   }
   ```
   Main.java 的 SessionRunner 实现覆写 → `return toolRegistry.getToolDefinitions();`。

2. **`AppServer` 新 RPC `tools.list`**(dispatch case + handler):
   - 调 `session.builtinTools()`,逐个序列化为 `{ name, description, parameters }`(`parameters` 为 `Tool.parameters()` 的 JsonNode,可能为 null;直接放进结果,序列化时保留 null 或省略);**丢弃** `executor`。
   - 返回 `{ tools: [...] }`。
   - 纯只读:不改 `sessionId`、不碰 agent。
   - 守卫:`session == null` → -32000 `no session`(与其它 handler 一致)。

## 前端改动

3. **preload / IPC**:`window.wraith.listBuiltinTools(): Promise<{ tools: BuiltinToolView[] }>` → ipcMain `wraith:listBuiltinTools` → JSON-RPC `tools.list`。

4. **类型**(`desktop/src/shared/types.ts`):
   ```ts
   export interface BuiltinToolView { name: string; description: string; parameters?: unknown }
   ```

5. **`desktop/src/renderer/lib/builtinCapabilityDetail.ts`(新纯模块)**:
   ```ts
   export interface BuiltinToolRow { name: string; description: string; parameters?: unknown; missing: boolean }
   /** 把某能力的工具名数组与后端目录 join;找不到的标 missing=true。 */
   export function joinBuiltinTools(capabilityToolNames: string[], catalog: BuiltinToolView[]): BuiltinToolRow[]
   ```
   纯函数,vitest 覆盖(命中/缺失/空目录/空名单)。

6. **`PluginsPanel.tsx`**:
   - `BUILTIN_CAPABILITIES` 卡片从 `<div>` 改为 `<button>`,点击 → `setSelected('builtin:' + c.id)`。
   - 新哨兵:`selected` 取值扩为 `OVERVIEW | 'builtin:<id>' | <serverName>`。派生一个 `selectedBuiltin`(从 `'builtin:'` 前缀解析出 capability id,再查 `BUILTIN_CAPABILITIES`)。
   - 右侧详情三态判定:`formMode!=='hidden'`(表单)→ 现有;否则 `selectedBuiltin` 有值 → **能力详情**(新);否则 `current`(server)有值 → 现有 server 详情;否则 → 现有概览。
   - **能力详情**渲染:标题(`icon` + `name` + `desc`)+「← 概览」按钮(`setSelected(OVERVIEW)`);工具行来自 `joinBuiltinTools(capability.tools, catalog)`:每行 = 真名(mono)+ 描述(muted)+ 若 `parameters` 非空显「▶ 参数」可折叠(展开 `JSON.stringify(parameters, null, 2)` pretty-print);`missing` 行显淡色「定义缺失 / 当前不可用」且无参数折叠。行样式复用现有 server tools tab(`rounded-lg bg-surface/60 px-3 py-2`)。
   - **catalog 获取**:新增 state `builtinCatalog: BuiltinToolView[] | null` + `builtinError: boolean`;**懒加载**——首次进入任一能力详情(`builtinCatalog === null` 且 `selectedBuiltin` 有值)时调 `listBuiltinTools()` 一次并缓存,后续复用缓存。失败置 `builtinError`。
   - busy 不影响(纯只读)。

## 边界与错误

- `listBuiltinTools()` 失败(`builtinError` 为真)→ 能力详情顶部显「无法加载内置工具定义」+ 重试按钮(重置 `builtinError` 并重新拉取);工具行以该能力声明的工具名逐行按 `missing` 样式呈现(即传给 `joinBuiltinTools` 的 catalog 为空数组 → 全部 `missing=true`),保证仍能看到该能力包含哪些工具。
- `parameters` 为 null/空对象 → 不显示「参数」折叠。
- 点「← 概览」/ 点左列 server / 点能力概览项 → 正常切换 `selected`,三态互斥,无残留。
- 现有 server 详情、概览、表单三条路径**一行不改**(只在"无 server 选中"分支前插入"能力详情"分支)。

## Out of Scope(YAGNI)

- 内置工具的启停/编辑/删除(内置能力恒在,不可增删——保持现状)。
- 内置能力的 resources/prompts/logs（内置工具无这些概念）。
- 后端目录里未被任何能力卡覆盖的工具的"未分类"兜底展示。
- 修改 `BUILTIN_CAPABILITIES` 的分组内容(除非漂移暴露出确需修正)。

## 安全红线复核

- `tools.list` 仅回传工具的 name/description/parameters(JSON schema),这些是发给模型的公开定义,**不含**任何密钥/凭证。
- 不新增密钥读写路径。提交前照常跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

## 测试策略

- **Java**:`AppServer` 测试(fake runner 覆写 `builtinTools()` 返回 2 个含 parameters 的 Tool)——`tools.list` 返回 `{tools:[...]}`,含 name/description/parameters,**不改** `sessionId`(对比一次 turn 的持久化归属或直接断言无副作用路径)。既有测试零回归。
- **前端**:`builtinCapabilityDetail.ts` 的 `joinBuiltinTools` 纯函数 vitest 全覆盖(全命中 / 部分缺失标 missing / 空目录全 missing / 空名单返回空)。PluginsPanel 接线(可点卡片、三态切换、参数折叠)靠 `npm run typecheck` + `npx vitest run` + `npm run build` + 眼验(无 RTL)。
- **眼验脚本**:打开 MCP 面板 → 能力概览 → 点任一「内置能力」卡 → 右侧显示该能力的工具(真名 + 真实描述 + 可折叠参数)→ 点「← 概览」返回 → 点真实 server 仍显 server 详情(回归)→(可选)造一个 `BUILTIN_CAPABILITIES` 里写错的工具名验证「定义缺失」标记。
