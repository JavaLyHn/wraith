# Provider 配置面板 — 三项精修(测试连接 / 编辑回填 / freellmapi 多实例)设计

日期:2026-07-05
状态:已批准(待写实现计划)
分支:`feat/llm-provider-config`(在既有 provider 配置特性上追加,不新开分支)

## 1. 背景

Provider 配置面板(`ProvidersPanel.tsx` + Java `config.setProvider/removeProvider` + `ModelCatalog`)已实现:可挑 provider → 填 key/model/baseURL → 保存/设默认/删除。使用中暴露三个缺口:

1. **编辑不回填**:点「编辑」时 baseURL/protocol 显示的是 catalog 默认值而非已保存的值。
2. **无法自测**:填完不知道 key/model/baseURL 是否真能出话,只能存了去对话里试。
3. **freellmapi 无法多配**:freellmapi 是免费聚合网关,用户可能有多把 key / 多个预设,但面板每个 provider 只能配一份。

三项都是对同一面板的精修,一个 spec、一个计划。

## 2. 现状核对(已读代码)

- `ProvidersPanel.openEdit`(`desktop/src/renderer/components/ProvidersPanel.tsx:19`):`baseUrl` 取 `e?.defaultBaseUrl`(catalog 默认)、`protocol` 取 `e?.protocol`(catalog),**均非已存值**;`model` 取 `configured.get(id)?.model`(已回填正确)。
- `ModelCatalog.providers`(`src/main/java/com/lyhn/wraith/runtime/appserver/ModelCatalog.java:18`):每条只报 `{name, model, hasKey}`,javadoc 写明"NEVER includes apiKey **or baseUrl**"。→ 前端拿不到已存 baseUrl/protocol 是回填 bug 的直接根因。
- `LlmClientFactory.create`(`src/main/java/com/lyhn/wraith/llm/LlmClientFactory.java:29`):`switch(normalized)` 命中 `glm/deepseek/step/kimi/freellmapi/xfyun` 走 bespoke,`default` 按 `config.getProtocol` → `AnthropicClient` 或 `GenericOpenAiClient(baseUrl 来自 config)`。`normalizeProvider` 只归一固定别名,**`freellmapi-2` 不被归一、不命中 case → 落 default → generic**。
- `WraithConfig.providers` 是 `Map<String,ProviderConfig>`,多 key 天然共存(`freellmapi` + `freellmapi-2` 并列合法)。

## 3. 目标 / 非目标

**目标**
- 编辑时表单回填**已保存的** baseURL / protocol / model(apiKey 因红线不回传,留空=不改)。
- 编辑表单加「测试连接」:用当前表单值走**真实客户端路径**发一条极小对话,回连通/失败及原因。
- freellmapi 支持**配置多个实例**,每实例有可读显示名(可选备注名 + 自动编号兜底)。

**非目标(YAGNI)**
- 不做"任意 provider 都可重复"——仅 freellmapi(catalog `repeatable` 标记),其余 provider 行为不变。
- 测试连接不做流式、不做多轮、不做用量统计;仅一次极小 chat 探连通。
- 不回传/不日志任何 apiKey(沿用既有红线)。

## 4. 安全红线(不变 + 一处澄清)

- 红线对象是 **apiKey**:任何 RPC 回包、任何日志绝不含 apiKey 明文。
- **澄清**:`baseUrl` / `protocol` / `label` 均非密钥,ModelCatalog 回报它们是安全的、也是回填所必需的。本 spec 显式放开 ModelCatalog 回报 baseUrl/protocol/label(此前 javadoc 过度收紧到"连 baseUrl 都不报",直接导致回填 bug)。apiKey 仍只报 `hasKey`。
- `config.testProvider` 接收表单 apiKey(与 `setProvider` 同),但回包只含 `{ok, model?, latencyMs?, error?}`,绝不回显 key。

## 5. A — 编辑回填(bug 修复)

**Java** `ModelCatalog.providers(config)`:每条 entry 增两字段:
- `baseUrl`:`config.getBaseUrl(p)`,null → `""`。
- `protocol`:`config.getProtocol(p)`(缺省 `"openai"`)。
- javadoc 改注:红线只管 apiKey;baseUrl/protocol 非密钥,回报安全。

**TS** `desktop/src/shared/types.ts` 的 `ModelListResult.providers[]` 元素增可选 `baseUrl?: string`、`protocol?: 'openai' | 'anthropic'`。

**前端** `ProvidersPanel.openEdit(id)`:
```ts
const c = configured.get(id)
setForm({
  apiKey: '',
  model: c?.model || e?.suggestedModels[0] || '',
  baseUrl: c?.baseUrl || e?.defaultBaseUrl || '',
  protocol: (c?.protocol as 'openai' | 'anthropic') || e?.protocol || 'openai',
})
```
apiKey 输入框:`hasKey` 时 `placeholder="已配置 · 留空=不改"`。

**测试**
- Java:`ModelCatalog` 回报含 baseUrl/protocol,且**仍不含 apiKey**(断言 key 不出现)。
- 桌面 vitest:纯函数 —— 给定 configured 项(带 baseUrl/protocol),`openEdit` 后 form 用已存值而非 catalog 默认。

## 6. B — 测试连接

**Java** SessionRunner 新增 `config.testProvider`:

参数 `{ id, apiKey?, model?, baseUrl?, protocol? }`。实现:
1. 复制当前 `WraithConfig`(或构造仅含该 id 的临时 config);把表单传入的 model/baseUrl/protocol 覆写到 `providers[id]`;`apiKey` 传值则覆写,空串/缺省则沿用已存 key。
2. `LlmClient client = LlmClientFactory.create(id, tmpConfig)`。`client == null` → 回 `{ok:false, error:"缺少 API Key"}`(不打网络)。
3. 否则计时,`client.chat(List.of(<user:"ping">), List.of())`(非流式、极小)。成功 → `{ok:true, model:<解析出的/请求的 model>, latencyMs:<long>}`;抛异常 → `{ok:false, error:<e.getMessage(),截断>}`。
4. 回包**绝不含 apiKey**。

> 实现须核对 `LlmClient.chat(messages, tools)` 与 `Message` 的确切构造(记录类型),按现有调用点照抄。
> 超时:优先给测试调用一个有界超时(避免坏 baseURL 挂死 UI);若 `SHARED_HTTP_CLIENT` 无便捷 per-call 超时,v1 可依赖其默认超时并在计划中记录为已知点(不阻塞)。

**桥**
- preload(`desktop/src/preload/index.ts`):`testProvider(p): Promise<{ok:boolean; model?:string; latencyMs?:number; error?:string}>`。
- IPC(`desktop/src/main/index.ts`):`wraith:testProvider` → `client.request('config.testProvider', p)`;`!client` 抛 "Backend not connected"(照现有 handler 模式)。

**前端** 编辑表单:
- 「测试连接」按钮(置于 保存 旁)。状态机:`idle` → 点击 `testing`(按钮禁用、显示"测试中…")→ `ok`(绿:`✓ 连接成功 · <model> · <ms>ms`)/ `fail`(红:`✗ <reason>`)。
- 任一表单字段 onChange → 状态回 `idle`(清除上次结果,避免误导)。

**测试**
- Java:`AppServer`/SessionRunner 分发 `config.testProvider`;blank-key 路径回 `{ok:false, error 含"API Key"}`;**断言回包不含 apiKey 字段**(不打真网)。
- 桌面 vitest:按钮状态机纯逻辑(testing/ok/fail、字段变更清态);IPC 转发形状。

## 7. C — freellmapi 多实例 + 命名

**catalog** `desktop/src/shared/providerCatalog.ts`:
- `ProviderCatalogEntry` 增 `repeatable?: boolean`。
- freellmapi 条目加 `repeatable: true`。

**config schema** `WraithConfig.ProviderConfig`:
- 增 `private String label;` + `getLabel()/setLabel()`(非密钥;`@JsonIgnoreProperties` 已容忍旧文件无此字段)。
- `ModelCatalog.providers` 每条增 `label`:`pc != null ? pc.getLabel() : null`,null → `""`(或省略;实现取其一,测试对齐)。

**TS** `ModelListResult.providers[]` 增 `label?: string`。

**实例 id 铸造(前端,纯函数)**
`nextInstanceId(baseId: string, configuredIds: Set<string>): string`:
- 若 `baseId` 未占用 → 返回 `baseId`(首个实例用裸 id,兼容既有单配置)。
- 否则返回 `${baseId}-N`,N 从 2 起取最小未占用整数(匹配 `^${baseId}-(\d+)$`)。

**显示名(前端,纯函数)**
`instanceDisplayName(id, label, entry): string`:
- `label` 非空 → `${entry.displayName} · ${label}`(如 `FreeLLMAPI · 工作号`)。
- 否则 id === entry.id(base)→ `entry.displayName`(`FreeLLMAPI`);id 形如 `${base}-N` → `${entry.displayName} #${N}`(`FreeLLMAPI #2`)。

**列表渲染** `ProvidersPanel`:
- **已配置组** = 所有 `hasKey` 的已配置项 —— 含 catalog 直配项 **和** 动态实例(`freellmapi-2` 等,catalog 无对应条目,用其 base 的 catalog entry 解析图标/协议:实例 id 去尾号 → base id → `findCatalogEntry`)。
- **全部组** = catalog 条目中 `(!hasKey) 或 (repeatable)`。→ freellmapi 永远留在"全部"显示「＋配置」,可反复新增实例。
- 每个已配置实例一行,显示 `instanceDisplayName`;点该行「编辑」进编辑该实例(id 为实例 id)。
- 点 repeatable 条目「＋配置」→ `openNew(baseId)`:`editing = nextInstanceId(baseId, configuredIds)`,表单空白 + 显示「名称/备注」框。

**表单**:
- 仅当 `editing` 对应 repeatable 条目/实例时,显示「名称/备注」输入(绑 `form.label`),占位"可选,如:工作号"。
- 保存:`setProvider({ id: editing, label: form.label, apiKey, model, baseUrl, protocol })`。
- 非 repeatable provider 表单**不显示** label 框,保持原样。

**删除**:`removeProvider(实例id)` 已按 key 删,无需改;默认回落逻辑不变。

**已知良性不对称**:base `freellmapi` 命中 factory `case "freellmapi"` 走 `FreeLlmApiClient`(bespoke);`freellmapi-N` 落 `default` 走 `GenericOpenAiClient(baseUrl 来自 config)`。二者同为纯 OpenAI-兼容、同 baseUrl,行为等价(generic 正是 bespoke 的去重目标)。不改动 base 路由以免回归既有单配置行为。spec 记录备考。

**测试**
- 桌面 vitest 纯函数:`nextInstanceId`(首个裸 id / 后续最小空位)、`instanceDisplayName`(label / base / #N)、列表分组(repeatable 留"全部" + 实例入"已配置" + 实例图标经 base 解析)。
- Java:`ProviderConfig.label` JSON round-trip + 旧文件(无 label)兼容读;`ModelCatalog` 回报 label。

## 8. 触点清单

| 层 | 文件 | 改动 |
|---|---|---|
| A Java | `runtime/appserver/ModelCatalog.java` | providers 每条 +baseUrl +protocol(+label,见 C) |
| A TS | `desktop/src/shared/types.ts` | providers[] +baseUrl? +protocol? (+label?) |
| A 前端 | `desktop/src/renderer/components/ProvidersPanel.tsx` | openEdit 用已存值兜底 + apiKey 占位 |
| B Java | `cli/Main.java`(SessionRunner)+ `runtime/appserver/AppServer.java` | +`config.testProvider` 实现 + 分发 |
| B 桥 | `desktop/src/preload/index.ts`、`desktop/src/main/index.ts` | +`testProvider` / `wraith:testProvider` |
| B 前端 | `ProvidersPanel.tsx` | 测试按钮 + 状态机 |
| C catalog | `desktop/src/shared/providerCatalog.ts` | +`repeatable?`;freellmapi `repeatable:true` |
| C config | `config/WraithConfig.java` | ProviderConfig +label;ModelCatalog +label |
| C 前端 | `ProvidersPanel.tsx` | nextInstanceId / instanceDisplayName / 分组 / label 框 |

## 9. 门禁

- Java `mvn -DskipTests=false test` 0F/0E;桌面 `npm run typecheck` + `npx vitest run` 全绿;`npm run build` PASS。
- 每次提交前密钥红线:`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`。
- 分支:`feat/llm-provider-config`。
