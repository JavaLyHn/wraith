# 搜索对等：web_search 不再只有 GLM 用户零配置可用

- 日期：2026-08-03
- 前置：`docs/superpowers/specs/2026-08-03-provider-agnostic-registry-design.md`（那条线的 §7 把本项列为「明确不做」，现在补上）
- 范围：搜索 provider 的**取值链对等** + 「未配置」话术去 GLM 化 + SearXNG 零门槛引导 + 缓存失效 + 一条**显式可选**的零 key 应急后端（§3.6）
- 不在范围：见 §7

## 1. 起因

这是用户在整条工作线**最开始**问的那个问题，当时没解决：

> 为什么都不可用，不是都内置了吗？…… 必须要设置了 glm key 才能用 mcp 吗？

以及后来定调的判定标准：

> 我最开始是面向 glm 的，但是我现在已经完全没这个要求了。**所以不应该出现只能用 glm 才能完成的事情。**

前一条工作线（provider 注册表去硬编码）把「启动 / 装 client / 默认值 / 补全 / 文案 / CLI 能不能配」六件事做成了 provider 无关，但它的 §7 明确把搜索排除在外。于是到今天为止，**`web_search` 仍然只有配了 `GLM_API_KEY` 的人能零配置用**。

用户的实际处境使这条更尖锐：他 6 个 provider **全部是中转站**（`api.sophnet.com`、`newapi.elevatesphere.com`、`api.siliconflow.cn`），全是 `protocol: openai` + 自定义 baseUrl，**没有任何官方 provider 的 key**。所以：

- 智谱那条路：没有 `GLM_API_KEY`，用不了
- Anthropic 服务端 `web_search`：需要**官方** Anthropic key，中转站给不了，这条对他是空的
- 剩下只有自己掏钱买 SerpAPI，或自己起一个 SearXNG

## 2. 调查结论

### 2.1 根因：不是搜索偏爱 GLM，是只有 GLM 的 key 恰好躺在 config.json 里

`WraithConfig` 有五节：`providers` / `gateway` / `stt` / `embedding` / `pricing`。**没有 `search` 节。**

于是 `SearchProviderFactory` 的取值链（`resolveKey`，:78-101）是这样的：

```java
    /** {@code KEY 名 → WraithConfig 的 provider 名}；不在表里的 key 不查 config。 */
    private static String providerForKey(String key) {
        return "GLM_API_KEY".equals(key) ? "glm" : null;
    }
```

`GLM_API_KEY` 能回落到 `config.json` —— 因为它蹭的是 **LLM provider** 的 key（`providers.glm.apiKey`）。而 `SERPAPI_KEY` / `SEARXNG_URL` 在 config.json 里**没有对应概念**，所以只能来自环境变量。

**这就是「只有 GLM 零配置」的全部机制**：不是搜索代码偏爱智谱，是三条路的**取值链不对等**——一条能读配置文件，两条只能读环境变量。桌面用户在 GUI 里能配 GLM（写进 config.json），但没有任何界面能配 SerpAPI 或 SearXNG。

### 2.2 「未配置」这句话由 Zhipu provider 代言，所以模型张口就说 GLM

`pickProvider`（:64-77）在什么都没配时：

```java
        return "zhipu"; // 默认占位（Wraith 主要面向 GLM 用户），isReady() 会为 false
```

于是那条中立的「三条路都给你」的提示，物理上挂在 `ZhipuSearchProvider.unavailableHint()` 上。**这正是用户截图里模型开口就提 GLM 的原因**——它读到的可用信息就是智谱 provider 在说话。

（前一条工作线已经把这条提示的**内容**改成三路并列、并点明 SearXNG 免费无需 key。但**载体**仍是 Zhipu provider，这层错位没动。）

### 2.3 `web_search` 的 provider 缓存永不失效 —— 第五次 snapshot-vs-live

`ToolRegistry`（:106、:1012-1016）：

```java
    private SearchProvider searchProvider;

    private synchronized SearchProvider searchProvider() {
        if (searchProvider == null) {
            searchProvider = SearchProviderFactory.create();
        }
        return searchProvider;
    }
```

**没有任何失效路径，也没有注入口。** 后果：用户配好搜索后，本次会话依然报「未配置」，必须重启后端。

这是本仓库第五次栽在 snapshot-vs-live 上（前四次：沙箱护盾、动作卡、pet 窗口、补全）。既然本次要引入一个**可写**的配置节，这个缺陷会立刻变成用户可见的困惑，必须一起修。

### 2.4 技术地形：不存在「零 key 又可靠」的通用网页搜索

调查过的候选，逐个说明处置：

| 路线 | 要 key | 可靠性 | 处置 |
|---|---|---|---|
| zhipu（现有） | `GLM_API_KEY` | 高 | 保留，取值链补齐（§3.1） |
| serpapi（现有） | `SERPAPI_KEY`（付费） | 高 | 保留，取值链补齐（§3.1） |
| **searxng（现有）** | **无**（需自托管实例） | 高 | 保留，门槛降到粘一条命令（§3.3） |
| Anthropic 服务端 `web_search` | **官方** Anthropic key | 高 | 不做（§7） |
| DuckDuckGo HTML 抓取 | 无 | 低：靠抓页面标记、会被限流、ToS 灰区 | **显式可选，永不自动选**（§3.6） |
| 公共 SearXNG 实例 | 无 | 低：多数禁用了 JSON API（`SearxngSearchProvider` 的注释已记录这点），且蹭别人实例不礼貌 | 不做（§7） |
| chrome-devtools MCP（已内建） | 无（需 Node） | 中：能「用浏览器去搜」，但比 API 慢很多 | **不接成 provider，但在话术里留出口**（§3.2 / §3.5） |

**结论：唯一既免 key 又可靠的路是 SearXNG 自托管。** 所以本设计的主线不是「加一个零配置后端」（可靠的那种物理上不存在），而是**把三条路做成对等，并把唯一免费那条的门槛降到最低**。

在此之上留两个后手，代价都很小、都不改变主线的默认行为：

- **DDG 做成显式可选**（§3.6）——愿意吃抖动的人自己开，自动选择链永远不返回它，所以它无法静默降低任何人的搜索质量。
- **浏览器那条只补话术**（§3.2 / §3.5）——`chrome-devtools` 已是内建 MCP（`Main.java:315`，`npx -y chrome-devtools-mcp@latest`），`web-access` skill 也在教模型用它。缺的只是「搜索这一步」没有降级指令：`web-access/SKILL.md:26` 那行的 fallback 列是 `—`。补一行字，不加类、不加依赖。

### 2.5 会被本次改动打红的既有测试（第六条「在断言旧契约」）

`src/test/java/com/lyhn/wraith/web/SearchProviderFactoryTest.java:37`：

```java
        assertEquals("zhipu", SearchProviderFactory.pickProvider(null, null, null, null));
```

它**正在断言 §2.2 那个偏心**。本次必须改写。

（前一条工作线里已有五条同类测试由用户裁决后改写：`ModelCatalogTest` 钉死 6 家那条、`WraithCompleterTest` 三条、`MainInputNormalizationTest` 那条、`CliCommandParserTest.resolvesConcreteModelNameToProviderAndModel`。这是第六条。）

## 3. 设计

### 3.1 D1 —— `search` 节进 config.json，照 `embedding` 的样子

在 `WraithConfig` 加一节，字段与 `EmbeddingConfig` 同构：

```java
    /** 搜索后端配置。三条路共用一个形状：provider 选谁、apiKey 给谁、baseUrl 指哪。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SearchConfig {
        private String provider;   // zhipu | serpapi | searxng；空 = 自动选
        private String apiKey;     // zhipu / serpapi 用；仅本地存储,绝不回包/日志
        private String baseUrl;    // searxng 用
        // getter/setter 同 EmbeddingConfig
    }
```

`SearchProviderFactory.resolveKey` 的取值链扩为：

**env → 系统属性 → `./.env` → `~/.env` → config.json 的 `search` 节**

映射规则（替换掉那个只认 `GLM_API_KEY` 的 `providerForKey`）：

| env 名 | 从 `search` 节取 | 条件 |
|---|---|---|
| `SEARCH_PROVIDER` | `provider` | 无条件 |
| `SEARXNG_URL` | `baseUrl` | 无条件（`baseUrl` 只有 searxng 会用，不存在归属歧义） |
| `SERPAPI_KEY` | `apiKey` | **仅当 `provider` 明确等于 `serpapi`** |
| `GLM_API_KEY` | `apiKey` | **仅当 `provider` 明确等于 `zhipu`**；此外**保留**现有的「回落 `providers.glm.apiKey`」 |

⚠️ **`apiKey` 只在 `provider` 明确时才被读取。** 一个字段服务 zhipu 与 serpapi 两家，靠 `provider` 区分——搜索一次只用一家，不需要同时存多家的 key（YAGNI）。`provider` 为空而 `apiKey` 有值时，**不猜它属于谁，直接当作没有**：`/config search` 会强制要求 `--provider`，所以这种状态只可能来自手改 config.json，而猜错归属会把 SerpAPI 的 key 发给智谱（或反之）。宁可报「未配置」。

⚠️ **`GLM_API_KEY` 回落 `providers.glm.apiKey` 这条要保留**，不是移除。推理与搜索共用一个 key 是智谱的产品事实，对 GLM 用户是真便利，删掉是无谓回归。本次要做的是让**另两条也有配置文件可读**，而不是把 GLM 那条拉下来——「对等」是抬高低的，不是压低高的。

⚠️ **`pickProvider` 的签名不变**（`(explicit, glmKey, serpKey, searxngUrl)`），只有「全空」那条分支的返回值从 `"zhipu"` 变成 `"unconfigured"`。这样既有的 12 条 `pickProvider` 测试里只有 :37 那条需要改。§3.6 的 `duckduckgo` 也不需要改签名——它只走 `explicit` 那条分支。

⚠️ **`duckduckgo` 在 `search` 节里只占 `provider` 一个字段**，不读 `apiKey`、不读 `baseUrl`（§3.4 会对多给的参数报错）。所以上表不需要为它加行。

### 3.2 D2 —— 「未配置」不再由 Zhipu 代言

新增 `UnconfiguredSearchProvider implements SearchProvider`：

- `name()` → `"unconfigured"`
- `isReady()` → `false`
- `search(...)` → 抛 `IOException(unavailableHint())`
- `unavailableHint()` → 三段，顺序固定：**中立的**三路指引 → §3.3 的检测结果 → **两条兜底出口**

两条兜底出口是本次新加的（原设计只有前两段），措辞与位置都有约束——它们**必须排在最后**，且各自带警示，不能读成推荐：

```
另外两条应急路（都不需要 key，但都不如上面三条稳）：
· 让我用浏览器去搜 —— 内建 chrome-devtools MCP，需要本机有 Node/npx；比 API 慢，但能用
· /config search --provider duckduckgo —— 靠抓 HTML，可能因改版或限流失效，只建议临时用
```

第一条**只是一句字符串**：`web` 包不 import `mcp` 包，不做任何探测（不查 npx 在不在），因此零耦合、零延迟。代价是 Node 缺失时这句话是空头承诺——可以接受，因为它排在最后且模型试一次就知道。

`pickProvider` 什么都没配时返回 `"unconfigured"` 而非 `"zhipu"`；`create()` 相应派发。

`ZhipuSearchProvider.unavailableHint()` **收回成 GLM 专属**（「请设 `GLM_API_KEY`，可与 GLM 推理共用同一个 key」），因为它此后只在用户**显式选了 zhipu 却没给 key** 时才会出现。

### 3.3 D3 —— 检测 + 给可粘贴命令，不代跑

`UnconfiguredSearchProvider.unavailableHint()` 里做两个廉价检测，**都必须有超时**（一句提示不能把 agent 卡住）：

1. `docker` 是否在 `PATH` 上 —— 查 `PATH` 各段下是否存在可执行文件，**不执行 `docker --version`**（起进程更慢且可能触发 Docker Desktop 唤醒）
2. `localhost:8888` 是否有人在听 —— TCP connect，**超时 300ms**

按结果给三种话术：

| 检测结果 | 话术 |
|---|---|
| 8888 有服务 | 「检测到 `localhost:8888` 有服务在听（可能已是 SearXNG）。执行 `/config search --provider searxng --base-url http://localhost:8888` 即可启用。」 |
| 有 docker、8888 无 | 给 `docker run --rm -p 8888:8888 searxng/searxng`，再给上面那行 `/config search`。并说明这是**免费、无需任何 key** 的路。 |
| 无 docker | 三条路都说清（SearXNG 免费但需 docker / SerpAPI 付费即开即用 / 智谱与 GLM 推理共用 key），不推荐任何一条为「默认」。**这是 §3.2 两条兜底出口最要紧的分支**——三条主路对无 docker 又无 key 的人全是「先去办点事」，此时至少有两条能立刻试。 |

**不代跑 `docker run`**（用户明确选择）。理由：启容器是副作用，谁负责停、重启后怎么办、端口被占怎么办——这些都不该由一句「搜索不可用」的提示替用户决定。

检测结果**不缓存**：提示是低频路径（只在搜索不可用时出现），而缓存会让「用户刚起了 docker、再问一次却还说没有」——又一个 snapshot-vs-live。

### 3.4 D4 —— 写入口 + 缓存失效

D1 加的 `search` 节需要有人能写它，否则只能手改 config.json，D1 与 D4 都失去意义。本次加**一个** CLI 写入口，照 `/config provider` 的样子：

```
/config search --provider searxng --base-url http://localhost:8888
/config search --provider serpapi --api-key sk-xxx
/config search --provider zhipu                     # 沿用 providers.glm.apiKey
/config search --provider duckduckgo                # 无需 key，见 §3.6
```

- 解析走与 `parseProviderConfigUpdate` 同构的纯函数，便于单测
- 非法 `--provider` 给人话报错（`只支持 zhipu / serpapi / searxng / duckduckgo`），不静默忽略
- `--provider duckduckgo` 同时给了 `--api-key` 或 `--base-url` 时**报错**（`duckduckgo 不需要 --api-key / --base-url`），不静默忽略——静默吞掉会让用户以为 key 生效了，之后排查不可能
- 回显**掩码** `apiKey`（复用 `maskSecret`）
- 保存后**立即失效搜索缓存**

`ToolRegistry` 加：

```java
    /** 搜索配置变更后调用；否则本次会话仍用旧 provider(第五次 snapshot-vs-live)。 */
    public synchronized void invalidateSearchProvider() {
        this.searchProvider = null;
    }

    /** 测试注入口(包可见)。 */
    synchronized void setSearchProviderForTest(SearchProvider p) { ... }
```

### 3.5 D5 —— 文案与文档

- `ToolRegistry` 里 `web_search` 的 tool description **不动**（前一条工作线已经把 provider 细节从 tool schema 里删干净了，那是对的——模型不选 provider）
- **`src/main/resources/skills/web-access/SKILL.md:26` 的工具选择表补 fallback**——这是 §2.4 点出的真窟窿。现状：

  ```
  | 搜索关键词、找入口 | `web_search` | — |
  ```

  改为：

  ```
  | 搜索关键词、找入口 | `web_search` | web_search 报未配置时：`mcp__chrome-devtools__navigate_page` 开搜索引擎页 + `take_snapshot`（慢但不需要任何 key） |
  ```

  为什么这条独立于「接不接 provider」：`web_search` 不可用时，模型在「搜索」这一步**没有任何降级指令**，只能自己瞎凑。补这一行是纯文案，不动 `web` 包
- `.env.example`：`SEARCH_PROVIDER` / `SERPAPI_KEY` / `SEARXNG_URL` 三项旁边补一句「也可以用 `/config search` 写进 `~/.wraith/config.json`」；`SEARCH_PROVIDER` 的可选值补 `duckduckgo`，**并在同一行标注「抓 HTML，会抖，只建议临时用」**——文档里出现它但不推荐它
- 桌面 `pluginShowcase.ts` 里 `web` 那条的 `requires` 文案：把「需三者之一」改成同时提到 `/config search`
- `AGENTS.md` §5.2「改 Web/搜索」的连带清单补上 `SearchConfig`、`UnconfiguredSearchProvider`、`DuckDuckGoSearchProvider`
- `SearchProvider.java` 接口顶上的「当前实现」注释现在只列了 serpapi / searxng（zhipu 都漏了）——补全四家，并标注 duckduckgo 是显式可选

### 3.6 D6 —— DuckDuckGo：显式可选，永不自动选

新增 `DuckDuckGoSearchProvider implements SearchProvider`。它是本设计里唯一零 key 的后端，也是唯一被明确判定为**不可靠**的后端，因此可达路径被刻意收窄到一条。

**可达性（这是本条的核心约束）：**

- 只有**显式**指定才能拿到它：`SEARCH_PROVIDER=duckduckgo` 或 `/config search --provider duckduckgo`
- `pickProvider` 的**自动选择链永远不返回 `"duckduckgo"`**。全空时返回 `"unconfigured"`（§3.1 已定），三个自动输入的任何组合都不产生它
- 因此它**无法静默降低任何人的搜索质量**。这正是用户当初排除 DDG 的理由（「做成默认会让搜索时好时坏，比明确报未配置更糟」）——收窄可达性后那个理由不再成立，而「零 key 能搜」的好处保住了

**实现要点：**

- HTTP 用 **OkHttp**，并照 `SearxngSearchProvider` 的样子留**可注入 client 的构造重载**（`SearxngSearchProvider(String, OkHttpClient)`）——测试要靠它
- 请求 `https://html.duckduckgo.com/html/?q=<urlencoded>`，带一个常见浏览器 `User-Agent`，超时照 searxng 的 5s
- 解析用 **jsoup**（`pom.xml:97-101` 已有 1.18.1，compile scope，同包 `HtmlExtractor` 正在用）：`Jsoup.parse` 后 `select("a.result__a")` 取标题与 href、`select("a.result__snippet")` 取摘要，映射为 `SearchResult`。**不手写正则**——正则抓 HTML 是在脆弱之上再叠一层脆弱
- `name()` → `"duckduckgo"`；`isReady()` → **恒 `true`**（没有 key 可缺）
- `unavailableHint()` → 因 `isReady()` 恒真而不会被展示，但仍要返回一句实话（说明它靠抓 HTML、稳定用途请换另三条），避免留一句 `""` 让后来人以为没写完

⚠️ **失败契约（最重要的一条）：HTTP 非 200、被限流、或解析出 0 条结果时，一律抛 `IOException`，绝不返回空列表。**

空列表和「网上没有这个信息」在模型眼里是同一件事，它会据此编造结论；异常则明确是「工具坏了」。异常文案要点名脆弱来源并给出路：

```
DuckDuckGo 后端返回了 0 条结果（HTTP <code>）。这个后端靠抓 HTML，
改版或限流都会这样。稳定用途请改用 searxng / serpapi / zhipu：/config search --provider ...
```

这条契约是 DDG 能被接受的**前提**，不是可选的打磨。

**明确不做**：不加重试、不加 UA 轮换、不加代理。那些是在跟对方的反爬对抗，一旦开始就没有尽头，且更接近 ToS 灰区。抓一次，不行就报错。

## 4. 行为变化（须明确认可）

1. **`SearchProviderFactory.create()` 在什么都没配时返回 `UnconfiguredSearchProvider` 而非 `ZhipuSearchProvider`。** `SearchProviderFactoryTest:37` 正断言旧行为，必须改写（§2.5）。
2. **新 config.json 会多一个 `search` 节**（用户用过 `/config search` 之后）。老文件不动，缺失时按 env / 自动选处理。
3. **`web_search` 不可用时的提示内容会随本机环境变化**（有无 docker、8888 有无服务）。这是有意的——一句不看环境的提示对用户没用。
4. **搜索配置改完立刻生效**，不再需要重启后端。
5. **多出一个 `duckduckgo` 后端，但只有显式指定才会用到**（§3.6）。自动选择链不变，所以现有用户的 provider 选择结果**一个都不变**。它会抛异常而非返回空列表，这是刻意的。
6. **「未配置」提示末尾多两行兜底出口**（浏览器 / duckduckgo）。两条都带警示、都排在三条主路之后。
7. **`web-access` skill 的工具选择表变了一行**（`SKILL.md:26` 的 fallback 从 `—` 变成浏览器路线）。这会改变模型在 `web_search` 不可用时的行为——从瞎凑变成有指令可循。

## 5. 测试

- `SearchConfigResolutionTest`（新）——三条路各自从 config.json 的 `search` 节读得到；env 优先于 config；空白/空串当作没有；`search` 节整节缺失时回落 env；config 读取抛异常时当作「没有」而不是把搜索链路带崩（沿用 `resolveKey` 现有的吞异常约定）；**`GLM_API_KEY` 回落 `providers.glm.apiKey` 的既有行为不被破坏**
- `UnconfiguredHintTest`（新）——三种检测分支各自的话术；提示里**不出现** GLM 作为推荐（只作为三选一之一）；检测函数全部注入，**不真连网、不真查 PATH**；**两条兜底出口出现、且各自带警示词**；**两条兜底的位置在三条主路之后**（断言下标顺序，不是断言「包含」——只断言包含则把它们放到开头也能过，正是要防的那种失败）
- `DuckDuckGoProviderTest`（新）——用 **MockWebServer**（`pom.xml` 已有，test scope）+ 注入的 OkHttpClient，**不真连 duckduckgo.com**。三条：喂离线 HTML fixture 解出预期条数与字段；HTTP 非 200 抛 `IOException`；**喂一份「结构对但没有 result 锚点」的 HTML → 解析出 0 条也抛 `IOException`**（这条是失败契约的守门人，异常文案里含改用另三条的出路）。另断言 `isReady()` 恒真
- `SearchProviderAutoSelectionTest`（新）——**这条是 §3.6 核心约束的守门人**：遍历 `(explicit=null, glmKey, serpKey, searxngUrl)` 三个输入的**全部 8 种空/非空组合**，断言 `pickProvider` 的返回值**没有一个是 `"duckduckgo"`**；再断言 `explicit="duckduckgo"` 时确实拿到它。**判别力自证**：把自动链里任何一条改成回落 duckduckgo 则该测试变红
- `SearchProviderCacheTest`（新）——`invalidateSearchProvider()` 后拿到的是按新配置构造的 provider。**判别力自证：注释掉失效调用则该测试变红**
- `SearchConfigCommandTest`（新）——`/config search` 的解析：四个 provider 各自、非法 provider 报错、缺 `--base-url` 时 searxng 报错、`duckduckgo` 带 `--api-key` 或 `--base-url` 时报错、回显掩码 key
- `SearchProviderFactoryTest:37` —— 改写为断言 `"unconfigured"`，并加注释说明它此前在断言 GLM 偏心
- 红线：**不得读写真实 `~/.wraith/config.json`**（用内存 `WraithConfig` 或 `@TempDir` + `-Dwraith.config.dir`）；**不得依赖真实环境变量**（本 checkout 的 `./.env` 含真实 key，`getApiKey` 会回落读它）；检测函数一律注入

## 6. 我验不了什么

- **SearXNG 实例真的返回结果** —— 需要用户本机起 docker。`SearxngSearchProvider` 的解析逻辑已有测试，但端到端要真机验。
- **`docker` 检测在 Windows 上的行为** —— `PATH` 分隔符与 `.exe` 后缀差异。纯函数部分可单测（注入 `PATH` 字符串与 platform），真机行为要用户在 Windows 上验。
- **8888 被非 SearXNG 的服务占用时** —— 提示会说「检测到有服务在听（可能已是 SearXNG）」，措辞已留余地；但用户照着配下去会失败。做主动探测（发一个 `/search?format=json` 试探）会让提示变慢且可能打扰无关服务，本设计不做。
- **DuckDuckGo 现在到底还能不能抓** —— 单测只喂离线 HTML fixture，验的是「给定这份 HTML 能解对」。真实端点今天返不返 200、多少次触发限流、标记有没有改版，**只能真机试**。这也是它被限制成显式可选的原因：契约允许它今天就是坏的。fixture 与线上不一致时，症状是「解析出 0 条 → 抛异常」，而不是静默给空结果——失败方式已经被 §3.6 的契约兜住。
- **改了 `SKILL.md:26` 之后模型真的会走浏览器** —— 那是模型行为，测不了。只能真机看一次 `web_search` 未配置时它下一步做什么。

## 7. 明确不做

> **两处已从本节移出**（用户 2026-08-03 追问后裁决「两条都写进 spec」）：DuckDuckGo 改为 §3.6 的**显式可选**后端；chrome-devtools 仍不接成 provider，但 §3.2 / §3.5 补了话术出口。移出的理由与原排除理由并不矛盾——原理由针对的是「做成默认」，收窄可达性后不再适用。

| 项 | 为什么 |
|---|---|
| 把 chrome-devtools MCP 接成 search provider | `web` 包要反向依赖 `mcp` 包（耦合变重），且浏览器搜索比 API 慢一个量级。改为只在话术里给出口（§3.2 / §3.5）——同样让模型能走到浏览器，代价是两行字而不是一层依赖 |
| DDG 的重试 / UA 轮换 / 代理 | 见 §3.6 末。跟反爬对抗没有尽头，且更接近 ToS 灰区。抓一次，不行就报错 |
| 把 DDG 放进自动选择链 | §3.6 的核心约束，由 `SearchProviderAutoSelectionTest` 守门。一旦自动可达，它就能静默把别人的搜索质量拉低——这正是当初排除它的理由 |
| Anthropic 服务端 `web_search_20260209` | **对本用户是空的**——需要官方 Anthropic key，他走中转站拿不到。等有官方 key 的用户提出再做 |
| 桌面「搜索后端」表单 + `searchGet`/`searchSet` RPC | `search` 节落地后这是自然的下一步（照 `embeddingGet`/`embeddingSet` 的样子），但那是 UI 活，本次先把后端与 CLI 打通 |
| 多家 key 同时存储 | 搜索一次只用一家，`apiKey` 单字段够用。YAGNI |
| 自动代跑 `docker run` | 用户明确选择「只检测 + 给命令」。启容器是副作用，生命周期不该由 wraith 接管 |
