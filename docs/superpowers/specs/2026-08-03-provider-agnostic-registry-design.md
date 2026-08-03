# Provider 注册表去硬编码：从「GLM 优先」到「任意 provider 对等」

- 日期：2026-08-03
- 范围：#3 启动回落 + #4 `model.list` 载荷 + #6 默认值/补全/文案
- 不在范围：#1 搜索对等、#2 Anthropic 多模态、#5 计价表（各自单独 spec，见 §7）

## 1. 起因

用户原话：

> 我最开始是面向 glm 的，但是我现在已经完全没这个要求了。对于任意的 llm provider 都能支持，
> 所以现在要设置为通用的。最开始是仅仅因为我只有 glm 的。**所以不应该出现只能用 glm 才能完成的事情。**

判定标准（用户选定）：**能力对等** —— 允许各 provider 走各自的实现，但不允许出现「只有 GLM 能做到」的能力。

## 2. 调查结论

### 2.1 「那 6 家」被硬编码了 4 遍，且互不一致

`{glm, deepseek, step, kimi, freellmapi, xfyun}` 这个列表在仓库里抄了四份：

| # | 位置 | 内容 | 后果 |
|---|---|---|---|
| 1 | `ModelCatalog.java:11` `KNOWN_PROVIDERS` | 6 个 provider | 死重（见 2.3） |
| 2 | `LlmClientFactory.java:52` 回落数组 | 6 个 provider | **真 bug**（见 2.2） |
| 3 | `WraithCompleter.java:91-98` `/model` 补全 | 5 provider + **2 个 GLM 模型名** | 首推 `glm-5.1` |
| 4 | `WraithCompleter.java:117-122` `/config provider` 补全 | 6 个 provider | 其余 provider 无补全 |

这是本仓库反复出现的「同一份内容抄多份、改一处修不干净」模式（此前已在 `bash -c`、Plan/Team 的 JSON 抽取、pet 窗口的 `resizable`/`movable` 上各栽一次）。

### 2.2 #3 是可达的真 bug，不是理论问题

链路：

1. `WraithConfig.java:38` —— `private String defaultProvider = "glm";` 硬编码初值
2. `WraithConfig.java:255` `save()` —— `mapper.writeValue(configFile(), this)` 整对象落盘，
   于是**全新安装第一次保存就把 `defaultProvider: "glm"` 写进了 `~/.wraith/config.json`**，
   哪怕用户配的是 anthropic
3. `Main.java:1477` `configSetProvider` —— 存 provider、`config.save()`、`ensureClient.get()`，
   **从不设置 defaultProvider**
4. `Main.java:1308` `ensureClient` → `LlmClientFactory.createFromConfig(config)`
5. `LlmClientFactory.java:47` —— 先试 `create(config.getDefaultProvider())` = `create("glm")` → glm 无 key → `null`
6. `LlmClientFactory.java:52` —— 回落遍历那 6 家 → **anthropic / openai / siliconflow / gemini… 全都不在列表里** → `null`

结果：**桌面里配好 anthropic、点保存，`ensureClient` 拿到 `null`，用户看到 `NoModelNotice`。**

两处注释在撒谎，需要一并修正：

- `Main.java:1304-1305`：「createFromConfig 本身会在 defaultProvider 拿不到时遍历六家兜底，
  **所以只要任意一家有 key 就能装上**」—— 后半句假，只有那 6 家
- `Main.java:1487-1488`：「首个 provider 落地后就地热装 …… 存完立刻可用，
  **不需要用户再去点一次「设默认」**」—— 对 6 家之外的 provider 全假

**用户自己的 config 就中了**：6 个 provider（`freellmapi`、`freellmapi-2..5`、`siliconflow`），
白名单里只有裸 `freellmapi` 一个 —— 另外 5 个对回落逻辑完全不可见。
（`freellmapi-N` 实例名也不在列表里，白名单连自家的多实例都覆盖不到。）

**「挑一个有 key 的」这条规则仓库里已经有了**，就在 `Main.java:1494-1500` 的
`configRemoveProvider` 里 —— 只装在了删除路径上。本设计不发明新规则，只是把它推广。

### 2.3 #4 是死重，不是 UI 问题（修正我先前的判断）

`KNOWN_PROVIDERS` 会给 `model.list` 塞 6 条 `hasKey:false` 的空壳。但桌面每个消费者都按
`hasKey` 过滤：

- `ProvidersPanel.tsx:30` `doneInstances` —— `.filter(p => p.hasKey)`
- `ProvidersPanel.tsx:90` `restCatalog` —— `!configured.get(e.id)?.hasKey`
- `modelSwitcher.ts:9-11` `configuredProviders` —— `providers.filter(p => p.hasKey)`

所以那 6 条**在 UI 里根本看不见**。它的实际代价是：每次 `model.list` 多发 6 条空载荷，
外加 `ModelCatalogTest.java:164` 一条钉死「`providers.size() == KNOWN_PROVIDERS.length`」的测试
—— **那条测试在断言这个 bug**，本次必须改。

桌面面板本来就是双源设计：`model.list` 的 providers = 「已配置」组，
`providerCatalog.ts` 的 31 条 `PROVIDER_CATALOG`（其中 2 条 `protocol: 'anthropic'`）= 「全部」组。
删掉 `KNOWN_PROVIDERS` 不影响「全部」组。

### 2.4 env 取值层已经通用，枚举层不通用

`WraithConfig.java:203` `getApiKey(provider)` 在 `providers` map 里找不到时回落
`loadApiKeyFromEnv(provider)`（:309），而后者的兜底是：

```java
default -> provider.toUpperCase() + "_API_KEY";
```

所以 `getApiKey("anthropic")` **就是**读 `ANTHROPIC_API_KEY`；那 6 个 `case` 只是不规则名的别名
（`xfyun` → `XFYUN_MAAS_API_KEY`）。`loadBaseUrlFromEnv`（:355）同构，兜底 `NAME_BASE_URL`。

**取值是通用的，枚举不是**：`providers` 里没有条目时，没有任何代码知道该去探哪个名字。
于是 env-only 的 glm 用户能起来（在白名单里），env-only 的 anthropic 用户起不来。
按「能力对等」标准，这条不对等必须补 —— 见 §3.3。

### 2.5 虚警（已排除，不要重复调查）

- **RAG embedding** —— `EmbeddingClient` 默认 `ollama` + `nomic-embed-text`（本地、免费），
  `zhipu`/`glm` 只是 `switch` 的一个 case，且走的是通用 OpenAI-compatible 分支。不是 GLM 依赖。
- **桌面 `PROVIDER_CATALOG`** —— 31 条、双协议（openai/anthropic），这一层早已通用。
- **`web_fetch`** —— 零配置，与 provider 无关。

## 3. 设计

### 3.1 D1 —— 一个 resolver，两个消费者

新增 `com.lyhn.wraith.config.ProviderResolver`，纯函数、无 I/O、可单测：

```java
/** 生产入口:扫真实 env + ./.env + ~/.env,key/baseUrl 走 config 自带的取值链。 */
public static List<String> candidates(WraithConfig config)

/** 可测入口:三个查询全注入,不碰真实环境。 */
static List<String> candidates(WraithConfig config,
                               Set<String> envVarNames,                    // 发现:环境里存在的变量名
                               Function<String, String> keyLookup,         // 判定:provider 有没有 key
                               Function<String, String> baseUrlLookup)     // 护栏:能不能定 baseUrl
```

**必须注入，不能内部读真实环境。** 现有 `LlmClientFactoryRoutingTest`
的 `unknownProviderWithoutKeyReturnsNull` 断言 `create("openai", new WraithConfig())` 为 null
——而 `getApiKey("openai")` 会回落读真实 `OPENAI_API_KEY`，**那条测试是靠机器上恰好没设那个变量
才绿的**。resolver 若在内部读真实环境，新测试会继承同一个缺陷：在设了
`ANTHROPIC_API_KEY` 的开发机上通过、在 CI 上失败（或反之）。注入是这仓库既有做法
（`SearchProviderFactory.resolveKey` 就是这么写的）。

顺序：

1. `config.getDefaultProvider()` —— 若非空且 `getApiKey` 拿得到 key
2. `config.getProviders().keySet()` 中其余有 key 的 —— 保持 `LinkedHashMap` 插入序（＝用户添加序）
3. env 发现的（§3.3），去重后附在末尾

两个消费者**必须共用这一个函数**：

- `LlmClientFactory.createFromConfig` —— 遍历候选，返回第一个 `create(id, config)` 非 null 的
- `ModelCatalog.result` 的 `"default"` 字段 —— 报 `candidates` 的首项（**有效**默认），而非
  `config.getDefaultProvider()` 的原始值

第二项是必须的：stale `"glm"` 下 `ProvidersPanel.tsx:101` 的 `defaultId === p.name` 匹配不上任何行，
面板会**一个「默认」标都不显示**。

为什么强调共用：§2.1 刚证明这仓库会把同一份逻辑抄四遍。两个消费者各写一遍必然漂移。

### 3.2 D2 —— 四份白名单全删

| 位置 | 改成 |
|---|---|
| `ModelCatalog.KNOWN_PROVIDERS` | 删除。`providers()` 只报 `config.getProviders().keySet() ∪ env 发现的` |
| `LlmClientFactory` 回落数组 | `ProviderResolver.candidates(config)` |
| `WraithCompleter` 两处 | 注入 `Supplier<WraithConfig>`，从已配 provider 现算 |
| `WraithConfig.defaultProvider = "glm"` | `= null` |
| `App.tsx:578` 「请切到支持视觉的模型(如 glm-5v-turbo)」 | 去掉 GLM 举例（改为不点名具体模型） |

`WraithCompleter` 用 `Supplier` 而非快照：本仓库已四次栽在 snapshot-vs-live-signal 上
（沙箱护盾、动作卡…）。补全必须反映**当下**的 config —— 用户刚在面板里加完 provider，
不该等重启才能补全出来。

`/model` 补全同时要去掉混进 provider 列表的两个模型名（`glm-5.1`、`glm-5v-turbo`）：
`/model` 接受 provider 名，模型名由各 provider 的 config 决定，混在一起本身就是错的。

### 3.3 D3 —— env-only 发现

扫 `System.getenv()` + `./.env` + `~/.env`，取形如 `<NAME>_API_KEY` 的变量名 →
候选 provider `lowercase(NAME)`；外加沿用 `loadApiKeyFromEnv` 现有 switch 的不规则别名
（`XFYUN_MAAS_API_KEY` → `xfyun` 等）。

**护栏 —— env 发现的候选只在能确定 baseUrl 时才有效**，即满足其一：

- `<NAME>_BASE_URL` 在 env/.env 里有值
- 该 provider 落在「端点可确定」集合内（下表，经逐个 client 类核实）

| provider | 端点来源 |
|---|---|
| `glm` | `GLMClient` 内置（构造器不收 baseUrl） |
| `deepseek` | `DeepSeekClient` 内置（构造器不收 baseUrl） |
| `step` | `StepClient.DEFAULT_BASE_URL` |
| `kimi` | `KimiClient.DEFAULT_BASE_URL` |
| `freellmapi` | `FreeLlmApiClient.DEFAULT_BASE_URL` |
| `xfyun` | `XfyunMaaSClient.DEFAULT_BASE_URL` |
| `anthropic` | `AnthropicClient.DEFAULT_BASE` |
| `openai` | `GenericOpenAiClient` 的兜底就是 `https://api.openai.com/v1` |

**为什么必须有这道护栏**：`GenericOpenAiClient.java:21` 在 baseUrl 为空时兜底
`https://api.openai.com/v1`。所以一个无关的 `MY_SERVICE_API_KEY` 不会「连不上」——
它会**静默指向 api.openai.com 并把那个 key 发过去**。这比失败更糟。

这张表是「哪个 client 类烧死了哪个端点」的事实记录，不是偏好排序；它的作用与被删掉的四份白名单
**相反**——白名单是*限制*谁能被创建，这张表是*允许* env-only 发现，不在表里的 provider 依然可用，
只是需要显式给 `<NAME>_BASE_URL` 或写进 config.json。

**排除清单（全仓扫描 `[A-Z][A-Z0-9_]*_API_KEY` 得出，非猜测）**：

| 变量 | 会被误判成 | 实际是什么 |
|---|---|---|
| `EMBEDDING_API_KEY` | provider `embedding` | RAG 的 embedding 后端（`EmbeddingClient`） |
| `WRAITH_RUNTIME_API_KEY` | provider `wraith_runtime` | **wraith 自己的** Runtime HTTP API 认证 key |

规则写成：排除 `EMBEDDING_`，以及任何 `WRAITH_` 前缀（wraith 自身的配置命名空间，
将来新增 `WRAITH_*_API_KEY` 自动被挡，不必回来补名单）。

`SEARCH_PROVIDER` / `SERPAPI_KEY` / `SEARXNG_URL` / `REMOTE_TOKEN` 不匹配 `<NAME>_API_KEY`
模式，天然不会被误收。

**候选名必须是发现到的原始名，不能预先 normalize。** `MOONSHOT_API_KEY` 是活证据：
`normalizeProvider("moonshot")` → `"kimi"`，而 `getApiKey("kimi")` 读的是 `KIMI_API_KEY`（不存在）。
它之所以仍能工作，靠的是 `LlmClientFactory.java:20-23` 的双查 —— normalized 名拿不到 key 时
再用原始名查一次。resolver 若吐 `kimi`，这条双查就失去输入，`MOONSHOT_API_KEY` 用户会启动失败。

### 3.4 D4 —— 老 config.json 里 stale 的 `"glm"`

**不静默改写用户文件。** 靠两个用户已在主动操作的写入点自愈：

- `Main.java:1477` `configSetProvider` —— 存完后，若当前 `defaultProvider` 拿不到 key，
  设为刚存的这个 id。这才让 :1487 那句注释成真。
- `Main.java:1492` `configRemoveProvider` —— 已有的 :1494-1500 回落逻辑改成调 `ProviderResolver`，
  不要写第五份。

读路径由 D1 报有效默认，所以 stale `"glm"` 退化为惰性字段，不影响任何行为。

## 4. 行为变化（须明确认可）

1. **`model.list` 的 `providers` 从「恒含 6 条空壳」变成「只报真有的」。**
   config 与 env 都没有任何 provider 时是空数组；env 里有 key 的会带 `hasKey:true` 出现。
   桌面无影响（「全部」组靠前端 31 条 catalog）。`KNOWN_PROVIDERS` 经核实只有 `ModelCatalog`
   一个消费者，故影响面止于这一个 RPC 的载荷。
2. **`model.list` 的 `default` 从「config 原始字段」变成「有效默认」。**
   stale `"glm"` 的用户会第一次看到「默认」标出现在真正在用的 provider 上。
3. **新 config.json 不再写 `defaultProvider: "glm"`**（写 `null` 或省略）。
   老文件不动，由 §3.4 自愈。
4. **env-only 非白名单 provider 现在能被发现并启动**（新增能力，D3）。

## 5. 测试（RED 先行）

Java：

- `ProviderResolverTest`（新）—— 候选顺序 / default 有 key 时置首 / default 无 key 时跳过 /
  插入序保持 / env-only 发现 / env 无 baseUrl 被护栏挡 / 空配置返回空表 /
  不因 config 异常抛出 / config 与 env 同名时只出现一次（去重）
- `ProviderResolverTest` 排除项 —— `EMBEDDING_API_KEY` 与 `WRAITH_RUNTIME_API_KEY` 不产出候选；
  且**任意** `WRAITH_FOO_API_KEY` 都被挡（验的是前缀规则，不是硬编码两个名字）
- `ProviderResolverTest` 原始名 —— env 里只有 `MOONSHOT_API_KEY` 时，候选是 `moonshot` 而非
  `kimi`，且 `LlmClientFactory.create("moonshot", config)` 拿得到 `KimiClient`
  （守住 §3.3 末尾那条双查依赖）
- `LlmClientFactoryTest` —— **只配 anthropic 且 `defaultProvider` 为 stale `"glm"` → 拿得到
  `AnthropicClient`**。这条现在是红的，就是 §2.2 那个 bug。另加：只配 `siliconflow` →
  拿得到 `GenericOpenAiClient`；只配 `freellmapi-5` → 拿得到 client
- `ModelCatalogTest:159` `providersListContainsAllKnownProviders` —— **必须改写**，
  它在断言 bug。改为：零配置 → 空表；配了 N 个 → 恰好报 N 个
- `WraithCompleterTest` —— `/model` 与 `/config provider` 的补全来自 config；
  config 变更后补全随之变（验 Supplier 不是快照）；补全里不再出现模型名

桌面 vitest：

- `providers: []` 时 `ProvidersPanel` 不崩、「全部」组仍渲染 31 条
- `default` 指向一个不在 providers 里的 id 时不崩（防御 stale 值的过渡期）
- `App.tsx` 图片拦截文案不再点名 `glm-5v-turbo`

红线：**不得读写真实 `~/.wraith/config.json`**（此前 WeCom 的 set 测试写过真实 config，已修）。
所有测试用 `@TempDir` 或注入的 config 对象。

## 6. 我验不了什么

- **env 发现的真实行为**依赖具体机器的环境变量。单测注入 env lookup 函数，
  真机上「`.env` 里只放 `ANTHROPIC_API_KEY` 就能起来」这条需用户眼验。
- **`configSetProvider` 的热装**要真后端 + 桌面联调。单测只能验 resolver 的返回，
  不能验 `ensureClient` 真的装上了。
- 本设计不触碰 Windows 相关路径，无新增跨平台不可验项。

## 7. 明确不做

| 项 | 为什么另开 |
|---|---|
| #1 搜索对等（`providerForKey` 只映射 GLM） | 含新 provider 实现（Anthropic 服务端 `web_search`），是功能不是去硬编码 |
| #2 Anthropic 多模态（`AnthropicClient` 自述「图片退化为文本占位符」） | 协议实现活；`modelVision.ts` 只认 `glm-5v*` 需同步改 |
| #5 `PricingTable` 补 anthropic/openai 牌价 | 需两个独立可信来源核对（该文件既有注释已立此规矩），是查证活不是编码活 |
| 把 31 条 catalog 搬到后端共用 | 收益（单一真相）与本次目标不重合；`lobeIcon` 是纯前端概念，需新增跨端 RPC。YAGNI |
