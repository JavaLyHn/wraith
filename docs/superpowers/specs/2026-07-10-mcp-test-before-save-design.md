# MCP 表单保存前测试 (Test Before Save) 设计

**日期:** 2026-07-10
**分支:** feat/mcp-builtin-detail(继续堆:改动触及本分支已改的 `AppServerMcp.java`,从 main 另起会制造冲突)
**状态:** 设计已获批,待用户复核 spec

## Goal

MCP 添加/编辑表单里加「测试」按钮:用表单当前填写的 command/args/env 拉一个**临时** MCP 进程 → 握手 → `tools/list` → 报告「连接成功 · N 个工具 · XXms」或具体错误(含 stderr 尾行)→ 杀掉临时进程。**不落盘、与保存独立**,让用户加 server 前就知道配置能不能用。

## 背景与现状信号

面板已有被动信号:状态点(starting/ready/error)、`ready` 语义(进程起+握手成功+tools/list 拉到)、error 红横幅、logs tab、重启按钮。缺的是**保存前**的主动验证——填完只能保存了才知道起不起得来。Provider 配置已有对等先例 `configTestProvider`(发极小请求探连通再保存),本设计是 MCP 侧的对等物。

## 已验证的可行性事实

- `StdioTransport(String command, List<String> args, Map<String,String> env, Path workingDir)`(StdioTransport.java:32)构造即 `ProcessBuilder.start()` 拉进程——可直接用于临时探测,**无需注册进 `McpServerManager`**,与 live server 零干扰。
- `McpClient(serverName, transport)` → `initialize()`(超时走现有 `wraith.mcp.initialize.timeout.seconds` 属性/环境变量机制)→ `listTools()`(30s 超时)→ `close()`(级联关 rpc→transport→进程)。
- `StdioTransport.stderrLines()`(:69)留存子进程 stderr——"npx 包名打错/缺依赖/key 无效"类错误的真相所在,可注入错误报文。
- **env 空值先例**:`McpConfigWriter.upsert`(:41-43)已定义「空串 = 保留现值(密钥编辑语义);原无此 key 则忽略」。编辑态表单回填 envKeys 时值为空串,保存走此合并——测试沿用同一语义,行为与保存一致。
- `mcp.*` RPC dispatch 样板:`case "mcp.config.upsert" -> handleMcp(msg, ops -> {...})`(AppServer.java:228),参数解析可照搬。

## 架构

### 1. 后端探测 op

`McpOps` 接口加方法(带默认抛 UnsupportedOperationException,与既有风格一致),`AppServerMcp` 实现:

```java
/** 用给定配置拉临时 MCP 进程探连通:握手+tools/list。回包不含 env 值。 */
Map<String, Object> test(String scope, String name, String command,
                         List<String> args, Map<String, String> env) throws IOException;
```

探测流程:
1. **env 空值合并**:env 中值为空串的 key,若 `scopePath(scope)` 的 mcp.json 里 `name` 对应条目的 env 有该 key 的非空值 → 用存值;查不到(新增场景/无此 key)→ 原样传空串。合并逻辑抽成**包内可见静态方法**(便于单测):
   `static Map<String,String> mergeEnvForTest(Map<String,String> formEnv, JsonNode savedEntry)`
2. `new StdioTransport(command, args, mergedEnv, workingDir)`——`workingDir` 用当前 workspace(`currentWorkspace`,null 则 `Path.of(".")`)。
3. `new McpClient("__test__", transport)` → `initialize()` → `listTools()`,计总耗时 ms。
4. 成功 → `{ok:true, toolCount:N, latencyMs:ms}`。
5. 任何异常 → `{ok:false, error: 异常消息 + stderr 尾部(最多 5 行,拼接后截断至 500 字符)}`。
6. **finally 必 `client.close()`**(client 建成前失败则 `transport.close()`),临时进程绝不残留。

### 2. RPC + IPC

- `AppServer` dispatch 新 case(插在 `mcp.config.upsert` case 附近):
  `case "mcp.test" -> handleMcp(msg, ops -> { ...解析 scope/name/command/args/env(照 upsert 样板)...; writer.result(msg.id(), ops.test(...)); });`
- preload:`window.wraith.mcpTest(v: McpUpsertPayload): Promise<{ok:boolean; toolCount?:number; latencyMs?:number; error?:string}>` → ipcMain `wraith:mcpTest` → `mcp.test`。payload 复用现有 `McpUpsertPayload`(scope/name/command/args/env),不新造类型;回包类型新增 `McpTestResult` 进 `shared/types.ts`。

### 3. 表单 UI(`McpServerForm.tsx`)

- 「保存」旁加**「测试」**按钮(`data-testid="mcp-form-test"`):
  - 点击前先走与保存相同的必填校验(name/command 空 → 同样的错误提示,不发请求)。
  - 测试中:按钮文案「测试中…」,测试+保存+取消一起禁用(防测试中变更/保存)。
  - 结果行(表单底部,`data-testid="mcp-form-test-result"`):
    - 成功:绿色 `✅ 连接成功 · {toolCount} 个工具 · {latencyMs}ms`
    - 失败:红色 `❌ 连接失败:{error}`,等宽字体、`break-words` 折行(stderr 可能长)。
  - 表单任意字段变更 → 清空上次结果(旧结果对新配置无效)。
- 测试**不落盘**;测完可改再测、或直接保存。

### 4. 边界与并发

- **慢包**:npx 首次下载可能十几秒——按钮禁用态覆盖;超时走 initialize/listTools 现有超时,超时异常如实报。
- **连点**:测试中按钮禁用,天然防并发探测;单飞行探测,无需队列。
- **http 型**:表单本就 stdio-only(command 必填),不涉及。
- **turn 运行中**:测试是只读探测(不改工具集),不受 `busy` 限制?——**受限**:保持与表单提交一致(表单在 busy 时整体禁用已是现状),不单独放行,避免"测试进程与运行中 turn 抢资源"的心智负担。
- **进程清理**:finally 关闭;`StdioTransport.close()` 是既有代码(会销毁进程),依赖其既有行为。

## 安全红线复核

- env 值走 `mcp.config.upsert` 同一条既有通道(renderer→main→JSON-RPC stdin),不新增暴露面;**不落日志**。
- 回包只含 `ok/toolCount/latencyMs/error`,**绝不回显 env 值**;error 由异常消息+stderr 构成——stderr 是子进程自己的输出,若子进程自己回显了 key 那是该 server 的问题,不在本设计控制面(与 logs tab 现状一致)。
- 提交前照常跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

## Out of Scope(YAGNI)

- 详情页对运行中 server 的探活/ping(另一形态,未选)。
- MCP 协议 `ping` 方法实现。
- 真实拉起外部包的集成测试(依赖 npx/网络,CI 不稳)。
- http transport 的测试。

## 测试策略

- **Java**(按既有分工放置:op 实现测试进 `AppServerMcpTest`,dispatch 测试进 `AppServerMcpDispatchTest`——后者已是 fake-McpOps 测 `mcp.*` 路由的所在):
  - (a) `AppServerMcpTest`:`test()` 用不存在的命令(如 `/nonexistent-cmd-xyz`)→ `ok:false`、error 非空(StdioTransport 构造即抛 IOException 的路径,无进程产生)。
  - (b) `AppServerMcpTest`:`mergeEnvForTest` 静态方法单测:空串+有存值→合并;空串+无存值→保持空;非空→原样。
  - (c) `AppServerMcpDispatchTest`:`mcp.test` dispatch 用例(fake McpOps 记录参数、回固定 map,断言透传与回包)。
- **前端**:结果行文案格式化若抽纯函数(`formatMcpTestResult(r): {kind:'ok'|'err', text}`)则 vitest 覆盖;表单接线 typecheck + 全量 vitest + build + 眼验。
- **眼验**:填 filesystem 真实命令(`npx -y @modelcontextprotocol/server-filesystem /tmp`)→ 测试 → 绿色成功+工具数;把包名改错 → 测试 → 红色失败含 stderr;测试中按钮禁用;改字段后旧结果消失;全程 `ps` 查无残留 node 进程。
