# MCP server 详情增强 (Server Detail Enrich) 设计

**日期:** 2026-07-10
**分支:** feat/mcp-builtin-detail(依赖该分支的内置能力详情特性——② 复用/重构其 `BuiltinToolRowView`)
**状态:** 设计已获批,待用户复核 spec

## Goal

补齐 MCP 面板 server 详情页缺失的两类"参数"信息:
① 已添加 server 的**启动命令/参数**(command + args,如 `npx -y @modelcontextprotocol/server-filesystem <允许访问的目录>`)在详情页只读回显——今天只能点「编辑」才能看到;
② 外部 MCP server 的**工具入参 schema**(inputSchema)在 tools tab 显示——与内置能力详情的「▶ 参数」折叠一致,消除内置 vs 外部的不一致。

## 背景与问题

MCP 里「参数」是两个不同的东西,当前面板各缺一块:

1. **服务器启动命令/参数(command/args)**——怎么拉起 stdio MCP 进程。用户添加时在 `McpServerForm` 填,但**已添加 server 的详情页(只读)不回显**;想看配置只能点「编辑」。数据其实已有:`McpServerView.command?`/`args?` 由 `mcp.list` 回传(表单回填就靠它)。
2. **工具入参 schema(tool inputSchema)**——单个工具被模型调用时的入参定义。内置能力详情(本分支已实现)有「▶ 参数」折叠(数据走 `tools.list`);但**外部 server 的 tools tab 只显 name+description**——因为 `AppServerMcp.java:126-127` 构建 `mcp.list` 工具视图时只取了这两个字段,把 schema 丢了。上游数据链是完整的:`McpClient.listTools()`(McpClient.java:84)解析 `inputSchema` → `McpSchemaSanitizer.sanitize` → 存进 `McpToolDescriptor`(record 含 `JsonNode inputSchema` 字段)→ `McpServer.tools()` 持有 `List<McpToolDescriptor>`。只差最后一步序列化。

## 关键决策(来自设计对话)

| # | 决策 | 选择 |
|---|---|---|
| Q1 | ① 命令/参数回显形态 | **详情头部一块只读区**(「状态·transport·scope」行下方),仅 `transport==='stdio' && command` 时显示;`[command, ...args].join(' ')`,mono、可选中复制。不加 tab。 |
| — | ② 展示形态 | **复用内置那套「▶ 参数」折叠**,把 `BuiltinToolRowView` 抽成共享组件(DRY)。 |
| — | 范围 | ①+② 一次做(同为"server 详情信息补齐",改动内聚)。 |

## 架构

三部分,均为增量:

### Part ①:启动命令回显(纯前端)

`PluginsPanel.tsx` server 详情分支,头部「状态 · transport · scope」行之后、error 横幅之前,加只读块:

- 显示条件:`current.transport === 'stdio' && current.command`(http 型无命令,不显示)。
- 内容:标签「启动命令」+ 一行 mono 文本 `[current.command, ...(current.args ?? [])].join(' ')`,`select-text` 可选中复制,长命令 `break-all` 折行。
- 不可编辑(编辑仍走现有表单)。

### Part ②:外部工具入参 schema(后端 4 行 + 类型 + 前端)

1. **后端 `AppServerMcp.java`**(约 125-128 行):工具视图构建从 `Map.of("name",…,"description",…)` 改为 `LinkedHashMap`,`t.inputSchema()` 非 null 时补 `parameters` 字段:
   ```java
   List<Map<String, Object>> tools = new ArrayList<>();
   s.tools().forEach(t -> {
       Map<String, Object> tv = new java.util.LinkedHashMap<>();
       tv.put("name", t.name());
       tv.put("description", t.description() == null ? "" : t.description());
       if (t.inputSchema() != null) tv.put("parameters", t.inputSchema()); // sanitized JSON schema;null 省略
       tools.add(tv);
   });
   e.put("tools", tools);
   ```
2. **类型 `desktop/src/shared/types.ts`**:`McpToolView` += `parameters?: unknown`。
3. **前端**:server 详情 tools tab 的工具行改用共享组件(见下),传 `parameters`。

### 共享重构:`ToolDetailRow`(DRY)

把内置详情的 `BuiltinToolRowView`(现内联在 `PluginsPanel.tsx`)抽成通用组件:

- **新文件** `desktop/src/renderer/components/ToolDetailRow.tsx`:
  ```ts
  interface ToolDetailRowProps { name: string; description: string; parameters?: unknown; missing?: boolean }
  ```
  渲染 = 现 `BuiltinToolRowView` 的全部逻辑:mono 真名 + 描述(muted)+ `missing` 淡色「定义缺失 / 当前不可用」标记 + 参数非空时「▶ 参数」折叠(`type="button"`,展开 pretty-print JSON)。`missing` 缺省 false。
- **参数非空判定**抽成纯谓词并导出(供测试):
  ```ts
  export function hasToolParams(parameters: unknown): boolean
  // null/undefined/非对象/空对象 → false;非空对象 → true
  ```
- **消费方**:
  - 内置能力详情:`<ToolDetailRow name={row.name} description={row.description} parameters={row.parameters} missing={row.missing} />`(删除内联 `BuiltinToolRowView`)。
  - server tools tab:`<ToolDetailRow name={t.name} description={t.description} parameters={t.parameters} />`(替换现有 name+description 两行渲染)。

## 边界与错误

- ① `command` 缺失(http 型 / 旧数据)→ 整块不显示,无占位。
- ② 工具 `parameters` 为 null/空对象 → 不显折叠(`hasToolParams` 判定),行为与内置一致。
- ② 后端 `inputSchema` 已过 `McpSchemaSanitizer`,序列化直接放行,无需再清洗。
- 现有 tools tab 的「无工具(未就绪或空)」空态保留不动。
- resources/prompts/logs tab、概览、表单、内置详情的行为(除换用共享组件外)不变。

## Out of Scope(YAGNI)

- 环境变量名(envKeys)回显——本次只做命令/参数;env 名后续单独考虑。
- 详情页内编辑命令(编辑仍走现有表单)。
- http 型 server 的 URL 回显(数据面未回传 url,另一条链路)。

## 安全红线复核

- ① 回显的 command/args 本就是用户自己填的、`mcp.list` 已回传给编辑表单的内容(**env 值从不回传**,现状即如此,本次不碰 env)。
- ② `parameters` 是 MCP server 声明的公开工具 schema,不含凭证。
- 不新增密钥读写路径。提交前照常跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

## 测试策略

- **Java**:在现有承载 mcp.list 工具视图断言的测试文件里**新增两个用例**(计划阶段按现状钉死具体文件,AppServerMcpTest / AppServerMcpDispatchTest 之一):fake `McpToolDescriptor` 带 inputSchema 时 mcp.list 工具项含 `parameters`;inputSchema 为 null 时省略该字段。既有测试零回归。
- **前端**:
  - `hasToolParams` 纯谓词 vitest 覆盖(null/undefined/非对象/空对象→false;非空对象→true)。
  - `ToolDetailRow` 组件、命令回显块、两处接线:`npm run typecheck` + `npx vitest run`(既有全绿,含内置详情既有用例)+ `npm run build` + 眼验(无 RTL)。
- **眼验脚本**:
  1. MCP 面板 → 点一个已添加的 stdio server(如 filesystem)→ 详情头部显示「启动命令 npx -y @modelcontextprotocol/server-filesystem <目录>」,可选中复制;
  2. tools tab → 每个工具行有「▶ 参数」折叠(server ready 后),展开是 JSON schema;
  3. 点内置能力卡 → 详情行为与之前一致(共享组件重构无回归,「定义缺失」标记仍在);
  4. http 型 server(若有)→ 无命令块,不显示占位。
