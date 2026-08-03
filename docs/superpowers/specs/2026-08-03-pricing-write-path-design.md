# 计价写入口：`pricing` 节从「只能手改 config.json」到 CLI + 图形界面都能写

- 日期：2026-08-03
- 前置：`docs/superpowers/specs/2026-08-03-provider-agnostic-registry-design.md`（那条线把 #5 计价表列为「明确不做」）、`docs/superpowers/specs/2026-08-03-search-parity-design.md`（同一个缺陷类的上一例）
- 范围：`/config pricing` CLI 写入口 + 桌面「设置 → 模型计价」表单 + 两条 RPC + **配置改完立刻生效**
- 不在范围：见 §7

## 1. 起因

用户在整条工作线定的判定标准是：

> 我最开始是面向 glm 的，但是我现在已经完全没这个要求了。**所以不应该出现只能用 glm 才能完成的事情。**

按这条标准审计 `PricingTable` 时，我先给了一个**错误的结论方向**，随后自己纠正：种子表里 4 条有 2 条是 GLM（`glm-4.5` / `glm-5`），看着像偏心，但**照「给别家也塞牌价」去做是错的**——种子表的原则是「核不到就不加」，注释里连 `glm-5.1`（本仓库自己的默认模型）都因为多源矛盾而缺席：

```java
// PricingTable.java:46-52
- GLM-5.1(本仓库 GLMClient 的默认模型!):**核不到,不加种子**。多次 WebSearch/WebFetch
  互相矛盾——有来源报 ¥4/百万、有来源报 ¥20/百万(疑与 GLM-5 混淆或历史价);
  ...没有任何两个独立可信来源对得上,视为核不到,glm-5.1 在种子层缺席。
```

中转站的实付价**只有用户自己知道**（官方牌价 ≠ 实付价，换算率由掌握合同的人提供——这正是 `PricingEntry` 存在的理由）。所以真缺口不是「表里该塞谁」，而是：

**`pricing` 节从来没有写入口。** `config.json` 里有这一节、`PricingTable` 会读它、`WraithConfig` 有 `getPricing()/setPricing()`，但**没有任何 CLI 命令或界面能写它**——用户只能手改 JSON 文件。

用户的实际处境让这条更尖锐：6 个 provider 全是中转站，模型是 `glm-4.7` / `deepseek-v4-pro` / `DeepSeek-V4-Flash` / `Qwen/Qwen3-8B` / `Doubao-Seed-1.6-vision`，**种子表 4 条一条都不命中**，所以状态栏对他永远不显示费用估算。

用户裁决（2026-08-03）：**做，并且图形界面也配上**。落点选「设置 → 模型计价」单开一节，CRUD 全做。

## 2. 调查结论

### 2.1 写入口的缺失是**不对称**的，不是「都没有」

| 节 | CLI 写入口 | 桌面写入口 |
|---|---|---|
| `providers` | `/config provider …` | ProvidersPanel |
| `embedding` | 无 | RagPanel（`config.getEmbedding` / `setEmbedding`） |
| `search` | `/config search …`（今天刚加） | 无（本次前一条线里明确缓了） |
| `stt` / `gateway` | 部分 | 部分 |
| **`pricing`** | **无** | **无** |

`pricing` 是唯一**两边都没有**的一节。

### 2.2 第 6 次 snapshot-vs-live —— 写了也不生效

`setPricingTable` 只在三处被调，且都是**构造 Agent 时一次性**注入：

```java
Main.java:348   reactAgent.setPricingTable(new PricingTable(config.getPricing()));  // 交互 CLI
Main.java:1326  agent.setPricingTable(new PricingTable(config.getPricing()));      // app-server 会话(桌面后端)
Main.java:2403  agent.setPricingTable(new PricingTable(WraithConfig.load().getPricing()));  // headless 任务
```

第三处每次都重新 `load()`，本来就是活的。**前两处是快照**：用户写完 `pricing` 后，本次会话的状态栏依然不显示费用，必须重启。

这是本仓库第六次栽在同一个坑上（前五次：沙箱护盾、动作卡、pet 窗口、补全、`web_search` 的 provider 缓存）。上一条线刚用 `ToolRegistry.invalidateSearchProvider()` 修了第五次——**这一次必须在同一个提交里带上**，否则「加了写入口」对用户而言等于没加。

### 2.3 前缀语义是个陷阱，而且用户选的落点会放大它

`PricingTable.resolve`（:75-85）里 **config 条目与种子的匹配规则不同**：

```java
// Entry.exact=true(种子): modelName 必须与 modelKey 完全相等
// Entry.exact=false(config): modelName 以 modelKey 为前缀即命中
```

于是用户在表单里填 `glm`，会让 `glm-4.7`、`glm-5v-turbo`、`glm-4v-plus` **全部套用同一个价**。这不是 bug（前缀是 config 条目刻意的语义，注释写明了「前缀的模糊范围是用户自己的选择，由用户承担」），但它是**静默的**。

用户选择把表单放进「设置」而不是 Providers 面板时，我提示过代价：**模型名要手敲，敲错就静默不生效**。用户接受了这个落点。所以设计上必须在这个落点里把风险补掉——见 §3.4。

### 2.4 七层链路：`embedding` 是唯一完整的同构先例

要照抄的这条链（每一层的确切位置都核过）：

| # | 层 | `embedding` 的位置 |
|---|---|---|
| 1 | `AppServer.Session` 接口 default 方法 | `AppServer.java:271-277` |
| 2 | RPC 名与 dispatch | `AppServer.java:786-802`（`config.getEmbedding` / `config.setEmbedding`） |
| 3 | session 实现 | `Main.java:1868-1885` |
| 4 | 桌面主进程 IPC | `desktop/src/main/index.ts:1132-1139` |
| 5 | preload 桥 | `desktop/src/preload/index.ts:115-116`（类型）、`:522-527`（实现） |
| 6 | 共享类型 | `desktop/src/shared/types.ts:408-413`（`EmbeddingConfigView`） |
| 7 | 渲染层 | `RagPanel.tsx:25,48` 调 `window.wraith.configGetEmbedding/SetEmbedding` |

**但 `pricing` 与 `embedding` 不同构的一点**：`embedding` / `search` 是单个对象（一套表单填一次），`pricing` 是 `List<PricingEntry>`。这决定了 §3.1 的 RPC 形状。

### 2.5 `SettingsPanel` 的结构正好容得下

`SettingsPanel.tsx` 只有 47 行，是个 nav 壳：4 个 `NAV` 项各对应一个独立组件文件（`SettingsMe` / `SettingsInterface` / `PetsSettings` / `SettingsAbout`）。加一节 = 加一个 `NAV` 项 + 一个新组件文件，**不动壳的结构**。

### 2.6 已配置模型名拿得到 —— 下拉不需要新 RPC

`ModelCatalog.providers`（:37-58）每条已经带 `model` 字段，`model.list` 的载荷里就有。桌面 `ProvidersPanel` 已经在调它。所以 §3.4 的「已配置模型名下拉」**不需要加 RPC**，复用现成载荷。

## 3. 设计

### 3.1 D1 —— RPC 是「整表替换」，不是逐条 CRUD

```
config.getPricing  → { entries: [{ modelPrefix, cacheHitPerM, cacheMissPerM, outputPerM, currency, seeded }] }
config.setPricing  ← { entries: [{ modelPrefix, cacheHitPerM, cacheMissPerM, outputPerM, currency }] }
```

**为什么整表替换而不是 add/update/delete 三条**：`PricingEntry` 没有 id，`modelPrefix` 是天然主键但**用户会改它**——「把 `glm` 改成 `glm-4.7`」在逐条 API 里是「删一条 + 加一条」还是「改一条」有歧义，而歧义会在两个客户端之间分叉。整表替换让增/改/删都是同一次调用，UI 持有一份草稿数组，保存时整体覆盖。

代价：两个客户端同时改 → 后写覆盖先写。对一个低频配置可以接受（`embedding` 也是同样的取舍）。

`getPricing` 的回包**带种子**并标 `seeded: true`；`setPricing` 只收用户条目，**种子永不可写**（§3.6）。为此给 `PricingTable` 加只读视图：

```java
/** 只读视图:给 /config pricing --list 与桌面面板用。seeded=内置种子(不可写)。 */
public record View(String modelKey, Price price, boolean seeded) {}
public List<View> view() { … }   // entries 的不可变映射,Entry.exact → View.seeded
```

（`Entry` 是 private record，不外泄；`Price` 已经是 public。）

### 3.2 D2 —— 写路径的校验，两端共用同一套规则

CLI 与 GUI 必须拒绝同一批输入，否则用户在一边被拒、在另一边写进去。规则：

| 规则 | 理由 |
|---|---|
| `modelPrefix` 非空、trim 后非空 | 空前缀会命中**所有**模型 |
| 三个价格 ≥ 0、非 NaN/Inf | 负价算出负成本，比不显示更糟 |
| `currency` ∈ `{CNY, USD}` | `formatCost`（:96）只认 `USD` → `$`，**其余一律渲染成 `¥`**。允许任意串会让填 `EUR` 的人看到 `¥` |
| 同一份表内 `modelPrefix` 不得重复（忽略大小写） | 最长前缀相同时哪条胜出是任意的 |

**不校验** `cacheHit ≤ cacheMiss`：DeepSeek Flash 的实际牌价就是 0.0028 vs 0.14，但反过来也可能存在，这不是 wraith 该管的。

校验落在**一个纯函数**里（Java 侧 `PricingConfigUpdate` 的解析，TS 侧 `pricingView.ts` 的 `validateEntries`），两边各自单测。

### 3.3 D3 —— CLI 形状

```
/config pricing --list
/config pricing <modelPrefix> --cache-hit 20 --cache-miss 20 --output 60 [--currency CNY]
/config pricing --remove <modelPrefix>
```

- 路由进 `handleConfigCommand`（`args[0] == "pricing"`），与今天刚加的 `search` 分支并列
- `--list` 输出 config 条目与种子两段，种子标注 `(内置)`，并对每条 config 条目显示**它会命中你哪几个已配置模型**（§3.4 的同一份逻辑）
- `--remove` 找不到该前缀时报「没有这条」，不静默成功
- 单条写入是**增或改**：前缀已存在则覆盖那条（这是整表替换在 CLI 侧的自然投影）

### 3.4 D4 —— 把「静默不生效」补掉（用户选的落点里最要紧的一件）

用户选了「设置」这个落点，代价是模型名手敲。两个补法，都在表单内：

1. **前缀输入框挂 `datalist`**，候选是 `model.list` 里所有已配置 provider 的 `model` 字段（§2.6，不需要新 RPC）。敲一半就能选中 `Qwen/Qwen3-8B` 这种容易打错的串。
2. **每行实时显示「这条会命中：…」**，由纯函数给出：

```ts
// pricingView.ts
export function matchedModels(prefix: string, configuredModels: string[]): string[]
```

命中 0 个时那一行显示警示（**不阻止保存**——用户可能在为一个还没配的模型预填价；但必须让他看见）。命中 >1 个时把全部列出来，这样填 `glm` 的人立刻看到「会命中 glm-4.7、glm-5v-turbo」而不是事后困惑。

`matchedModels` 的匹配规则**必须与 Java 侧 `Entry.matches(exact=false)` 一致**：小写化后 `startsWith`。这是一处刻意的双端重复实现，理由与桌面既有的 `embeddingDefaults`（`ragView.ts:2`，与 `EmbeddingClient.of` 对齐）相同：为了不为一次 keystroke 发一趟 RPC。测试里写明「改一边必须改另一边」。

### 3.5 D5 —— 写完立刻生效（第 6 次 snapshot-vs-live）

给 `Agent` 加：

```java
/** 计价配置变更后调用;否则本次会话的 usage 行仍用旧表(第六次 snapshot-vs-live)。 */
public void reloadPricingTable(WraithConfig config) {
    setPricingTable(new com.lyhn.wraith.context.PricingTable(config.getPricing()));
}
```

（`setPricingTable` 已经把表往 `curator` 里传一遍——`Agent.java:141`——所以 curator 侧自动跟上，不必单独接。）

两个写路径各自接线：

- **CLI**：`handleConfigCommand` 的 pricing 分支写完后调 `reactAgent.reloadPricingTable(config)`。`handleConfigCommand` 现在的第三参是 `ToolRegistry`（search 那条线加的），这次要再穿一个 `Agent`——**签名改成收一个小的回调接口**而不是继续加参数：

```java
/** /config 写完后要刷新的活对象。search 与 pricing 各刷一样,别再往签名上加参数。 */
interface ConfigReloadHook {
    void afterConfigWrite(WraithConfig config);
}
```

REPL 传一个 lambda 同时做两件事（失效搜索缓存 + 重载计价表）；既有的 2 参重载保留给测试。

- **app-server**：`pricingSet` 实现里写完 `cfg.save()` 后调该会话 `agent` 的 `reloadPricingTable`。

### 3.6 D6 —— 种子表不动

`SEEDS` 一条不加、一条不改、不可写。理由是 §1 已经说过的：种子的门槛是「两个独立可信来源对得上」，而中转站实付价没有公开来源。用户条目在**同长度时优先于种子**（`PricingTable` 构造器里 `entries.addAll(SEEDS)` 放在 config 之后，注释写明「config 在前:同长度时先命中用户口径」），所以用户想覆盖 `glm-5` 只要填一条同名的即可，不需要改种子。

### 3.7 D7 —— 文案与文档

- `.env.example`：`pricing` 本来就不是 env 概念，**不动**
- `AGENTS.md` §5 的连带清单加一条「改计价」，点明七层链路 + `reloadPricingTable` 不调则不生效
- `providerConfigUsage()` 的用法块补一行 `/config pricing --list`（`search` 那行今天刚补，同处）

## 4. 行为变化（须明确认可）

1. **`config.json` 会多出/被改写 `pricing` 数组**（用户用过写入口之后）。老文件不动。
2. **状态栏可能开始显示费用估算**——此前对中转站用户永远不显示。这是本特性的目的，但它意味着**用户会看到一个数字，而那个数字的正确性完全取决于他填的价**。回显与面板都不加「以此为准」之类的措辞。
3. **`handleConfigCommand` 第三参从 `ToolRegistry` 变成 `ConfigReloadHook`**（§3.5）。既有 2 参重载保留，`SearchConfigCommandTest.invalidatesSearchCacheAfterWriting` 需要跟着改成传 hook —— 这是本次**唯一**要改的既有测试。
4. **设置面板多一个 nav 项**「计价」，默认落地页仍是「我」（不变）。

## 5. 测试

- `PricingConfigCommandTest`（新，Java）——`/config pricing` 解析：单条写入、`--list`、`--remove`、缺参报错、负价报错、非法币种报错、同表重复前缀报错；接线：写进 `config.getPricing()` 并落盘、回显含「会命中哪几个模型」。**红线：`@TempDir` + `-Dwraith.config.dir`，不碰真实 `~/.wraith/config.json`**
- `PricingTableViewTest`（新，Java）——`view()` 同时列出 config 条目与种子且 `seeded` 标对；种子仍要求精确相等、config 条目仍是前缀匹配（**这两条是 §2.3 那个陷阱的守门人**）
- `PricingReloadTest`（新，Java）——`agent.reloadPricingTable(config)` 后 `formatCost` 用的是新表。**判别力自证：注释掉 reload 调用则该测试变红**
- `PricingRpcTest`（新，Java）——`config.getPricing` 回包形状（含 `seeded`）、`config.setPricing` 整表替换语义（旧条目被清掉，不是合并）
- `pricingView.test.ts`（新，桌面）——`validateEntries` 的每条规则各一例；`matchedModels` 的前缀语义（含「填 `glm` 命中多个」与「命中 0 个」两种）
- `settingsPricing.test.tsx`（新，桌面）——表单渲染既有条目、加行/删行/改行后保存传的是整表、种子行**不可编辑**、命中 0 个时显示警示但不阻止保存、`datalist` 里出现已配置模型名
- `SearchConfigCommandTest.invalidatesSearchCacheAfterWriting` —— 改为传 `ConfigReloadHook`（§4.3）
- 红线：桌面测试一律 `// @vitest-environment jsdom` + `afterEach(cleanup)`（照 `providersPanelBaseUrlHint.test.tsx`）

## 6. 我验不了什么

- **用户填的价对不对** —— 这是本设计**刻意不管**的。中转站实付价没有公开来源，wraith 只负责「让他能填、填了立刻生效、看得见这条命中谁」。
- **桌面表单在真机上的手感** —— 一个表格式的增删改在窄面板里够不够用，只能真机看。纯函数与渲染断言覆盖不到布局。
- **`model.list` 的 `model` 字段对每个 provider 都非空** —— 没配 model 的 provider 那里是空串，`datalist` 会少一项。这不是错，但真机上用户可能疑惑「为什么下拉里没有我那个」。
- **两客户端并发写** —— 后写覆盖先写（§3.1 的已知取舍），单测测不到，真机也难触发。

## 7. 明确不做

| 项 | 为什么 |
|---|---|
| 往 `SEEDS` 里加更多牌价 | §3.6。门槛是「两个独立可信来源对得上」，中转站实付价没有公开来源。这也是我最初判断错的方向，已在 §1 记下 |
| 自动抓取牌价页 | `PricingTable:42` 已记录 `bigmodel.cn/pricing` 是纯前端渲染、WebFetch 拿不到内容。抓价是个会静默过期的依赖，而错价比没价更糟 |
| 逐条 CRUD 的 RPC | §3.1。`PricingEntry` 无 id，`modelPrefix` 会被用户改，逐条 API 有歧义 |
| Providers 面板里的「填价」入口 | 用户在方案选择时选了「设置里单开一节」。§3.4 的 `datalist` + 命中提示是那个落点内的等效补偿 |
| 币种换算 / 汇率 | 一条条目一个币种，状态栏按该币种符号显示。混币种求和是另一个问题（而且需要汇率源，同样会静默过期） |
| `cacheHit ≤ cacheMiss` 校验 | §3.2。真实牌价两个方向都存在，不是 wraith 该管的 |
| 桌面「搜索后端」表单 | 上一条线的遗留（`search` 节只有 CLI 入口）。与本次同构，但不在本次范围——用户这次点名的是计价 |
