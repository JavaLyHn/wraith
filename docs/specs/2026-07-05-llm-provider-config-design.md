# 桌面 LLM Provider 配置栏 — 设计

日期:2026-07-05
状态:待用户复核

## 1. 背景与现状

Wraith 桌面端目前**不能配置 LLM provider**:只能在已配好的 provider 间切换/设默认(`ModelSwitcher.tsx` → `model.list` / `session.setModel` / `config.setDefaultProvider`),要新增 provider 或填 API Key 必须手改 `~/.wraith/config.json`。

- Java 后端只硬编码 6 个 provider(`glm/deepseek/step/kimi/freellmapi/xfyun`,`LlmClientFactory`),全部 OpenAI-兼容(`AbstractOpenAiCompatibleClient` 的子类);`GLMClient` 有双端点、`XfyunMaaSClient` 带 `loraId`。
- 配置在 `~/.wraith/config.json`:`{ defaultProvider, providers: { <id>: { apiKey, baseUrl, model, loraId?, temperature, maxTokens } } }`。Key 只存此文件(仓库外),`ModelCatalog` 只报 `hasKey`,绝不外传明文。
- 无任何 provider 头像/图标系统。

参考仓库 `liliMozi/openhanako`(monorepo,项目名 hanako)`lib/providers/*.ts`:~26 个 provider,每条是纯元数据 `{ id, displayName, authType:"api-key", defaultBaseUrl, defaultApi }`,`defaultApi ∈ {openai-completions, anthropic-messages}`;`lib/default-models.json` 给出每个 provider 的建议模型。**该仓库不含 provider 头像**(provider 文件无 icon 字段、根/子包无图标库、无 assets 目录)。

## 2. 目标 / 非目标

**目标**
- 桌面新增"Provider 配置"面板:内置仿照 openhanako 完整集的 provider 目录(带官方 logo 头像),支持挑选 provider → 填 Key / 选 model / 改 baseURL → 保存启用 · 设默认 · 删除。
- 选中 provider 后 **baseURL / 建议模型自动预填**(来自 catalog),并提供"获取密钥"官网链接。
- 后端从"6 个硬编码"泛化为"**通用 OpenAI-兼容客户端 + Anthropic 原生客户端**",按协议路由,真正跑通目录内 provider。

**非目标(YAGNI)**
- 不做用量统计/计费、不做模型能力自动探测、不做 OAuth 类接入(如 openai-codex-oauth——目录可标注但 v1 只做 api-key)。
- 不做跨机同步。

## 3. Provider 目录(catalog —— TS 单一真源)

一份 TS 常量 `PROVIDER_CATALOG`(`desktop/src/shared/providerCatalog.ts`),每条:

```ts
interface ProviderCatalogEntry {
  id: string                 // openhanako 规范 id(canonical)
  displayName: string
  protocol: 'openai' | 'anthropic'   // 映射 openhanako defaultApi
  defaultBaseUrl: string     // 来自 openhanako defaultBaseUrl,选中后预填
  suggestedModels: string[]  // 种子自 openhanako default-models.json,可改
  consoleUrl?: string        // 官网/控制台"获取密钥"链接(人工整理)
  aliases?: string[]         // 兼容别名(见 §3 兼容)
  builtin?: boolean          // Wraith 独有(freellmapi/xfyun)
}
```

**目录来源与 4 条默认**(实现时逐个抓 openhanako provider 源文件如实录入):
1. **以 openhanako 完整集为准**:用它的 id / displayName / defaultBaseUrl / 协议。
2. **纯计费变体去重**:`minimax-token-plan`、`mimo-token-plan` 并入本体 `minimax`/`mimo`,不单列。
3. **`-coding` 变体保留单列**:`dashscope-coding`、`zhipu-coding`、`kimi-coding`、`volcengine-coding`(端点/模型不同,独立成条)。
4. **保留 Wraith 独有**:openhanako 无 `freellmapi`、`xfyun`(讯飞 MaaS,带 loraId),额外补进 catalog(`builtin:true`,回落头像)。

**canonical id 与向后兼容**:除有 bespoke 行为者外,canonical id 用 openhanako 的。两个例外:
- **`glm` 保持 canonical**(带 GLMClient 双端点 bespoke),openhanako 的 `zhipu` 作其 `aliases`;
- **`xfyun`**(Wraith 独有 builtin,带 loraId bespoke)。

其余退役 bespoke 的:`kimi`→canonical `moonshot`(别名 kimi)、`step`→canonical `stepfun`(别名 step),`deepseek` 同名。老 config 里的 `glm/kimi/step/deepseek/freellmapi/xfyun` 经别名解析后均不失效。别名解析复用/对齐 Java `LlmClientFactory.normalizeProvider`。

## 4. 后端泛化(方案 A:通用为主)

- 新增 `GenericOpenAiClient`:直接以 `(apiKey, model, baseUrl)` 实例化的 OpenAI-兼容客户端(现有 `AbstractOpenAiCompatibleClient` 已具备能力,补一个可直接 new 的具体类)。
- 新增 `AnthropicClient`:实现 anthropic-messages 协议(`{baseUrl}/v1/messages`,头 `x-api-key` + `anthropic-version`,messages/tool/stream 格式与 OpenAI 互转)。
- `LlmClientFactory.create(id, config)` 路由:
  - **仅** `glm`(双端点)、`xfyun`(loraId)保留原 bespoke 客户端(特殊行为);
  - 其余按该 provider 的 `protocol` → `GenericOpenAiClient`(openai)或 `AnthropicClient`(anthropic);
  - 协议与 baseUrl **从 config.json 读**(面板从 catalog 写入),Java 不再自维护一份目录 → 消除跨层漂移。
  - 退役 `DeepSeekClient/KimiClient/StepClient/FreeLlmApiClient` 等 bespoke(其行为=通用客户端+catalog 默认;别名仍解析到 canonical id 后走通用)。

## 5. 配置 schema

`ProviderConfig` 增可选字段 `protocol`(`"openai"|"anthropic"`;缺省 openai;旧条目无=openai,向后兼容)。其余字段不变。Key 仍只存 config.json、永不入日志/回传。

## 6. RPC + preload/IPC

- 新增 `config.setProvider { id, apiKey, model?, baseUrl?, protocol? }` → 写 config.json 该条目(`apiKey` 为空串=保留现有 key,不覆盖;传值=覆盖)。
- 新增 `config.removeProvider { id }` → 删该条目(若删的是 defaultProvider,回落到下一个有 key 的)。
- 复用 `config.setDefaultProvider`、`model.list`(报 configured/hasKey/current)。
- preload:`setProvider / removeProvider`;IPC:`wraith:setProvider / removeProvider` → `client.request('config.setProvider' / 'config.removeProvider', …)`。
- **安全铁律**:任何 RPC 回包**绝不含 apiKey 明文**(沿用 ModelCatalog 只报 `hasKey`);面板只发 key、不回读。

## 7. 桌面面板 UI(新 nav 项)

```
┌ Provider 配置 ───────────────────────────┐
│ [搜索…]                                    │
│ 已配置                                      │
│  🐋 DeepSeek     deepseek-…  ✔默认   编辑  │
│  🟣 智谱(GLM)   glm-…               编辑  │
│ ─────────────────────────                  │
│ 全部                                        │
│  ✳ Anthropic    未配置              ＋配置 │
│  ◯ OpenAI       未配置              ＋配置 │
│  … (~26,ProviderIcon 官方 logo 头像)       │
│  ⚙ 自定义(OpenAI 兼容)             ＋配置 │
└────────────────────────────────────────────┘
配置/编辑 → 表单:
  · API Key(密码框;编辑态留空=不改)
  · 模型(catalog 建议下拉 + 可自填)
  · Base URL(选中即预填 catalog defaultBaseUrl,可改)
  · [获取密钥 →](consoleUrl)
  · [设为默认]  · 保存 / 删除
```
- 每行左侧 `ProviderIcon`;已配置置顶成组 + 当前 model + 默认徽标;顶部搜索(~26 条)。
- `自定义`:填任意 id/baseUrl/model/protocol(OpenAI 兼容),用回落头像。

## 8. 头像:@lobehub/icons

- 加依赖 `@lobehub/icons`;`ProviderIcon`(`desktop/src/renderer/components/ProviderIcon.tsx`)按 catalog id → 对应 lobehub 图标组件(按需具名导入,利于 tree-shake)。
- 未命中/`builtin`/`custom` → 回落彩色圆 + 首字母。
- 一处 `id → lobehub 组件` 映射表,随 catalog 维护。

## 9. 测试策略

**Java**
- `AnthropicClient`:请求构造(头/端点/消息+工具转换)、响应解析、流式——mock HTTP,不打真网。
- `LlmClientFactory`:按 protocol 路由(openai→Generic / anthropic→Anthropic / glm·xfyun→bespoke);别名解析到 canonical。
- config `protocol` round-trip + 旧条目(无 protocol)兼容读。
- `AppServer` `config.setProvider/removeProvider` 端到端:写入生效、删除回落默认、**断言回包不含 apiKey**。

**桌面**
- catalog 完整性:id/别名不撞、每条(含 builtin/custom 回落)都有 avatar 解析、defaultBaseUrl 非空。
- `ProviderIcon` 回落逻辑;面板纯函数(分组/搜索)。
- typecheck + vitest。

## 10. 范围 / 分期(一个 spec,计划分 4 阶段)

1. **Java 泛化**:`GenericOpenAiClient` + `AnthropicClient` + `LlmClientFactory` 按协议路由 + config `protocol` 字段(+ 别名/back-compat)。
2. **RPC + 桥**:`config.setProvider/removeProvider` + preload/IPC(安全:不回传 key)。
3. **catalog + 头像**:`PROVIDER_CATALOG`(逐个抓 openhanako 录入)+ `@lobehub/icons` + `ProviderIcon`。
4. **面板 UI**:新 nav 项 + 列表/分组/搜索 + 配置表单(预填/获取密钥链接/设默认/删除)。

## 11. 门禁

- Java `mvn -DskipTests=false test` 0F/0E;桌面 `npm run typecheck` + `npx vitest run` 全绿。
- 每次提交前密钥红线:`git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指/测试金丝雀)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`。
- 分支:`feat/llm-provider-config`。
