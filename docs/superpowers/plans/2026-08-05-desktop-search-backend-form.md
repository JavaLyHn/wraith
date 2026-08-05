# 桌面端配置搜索后端（2026-08-05）

> **起因**（用户实测）：「能力概览 → 网页搜索与抓取」卡片挂着黄色「需配置」，
> 说明文字里写着「可用 **/config search** 写进配置」。用户问：
> 「这个不是必须要 cli 才能配置吧 桌面端也可以 是不是哪里没做完整」。
>
> **是没做完整。** 核过 RPC 面：

| RPC | 有吗 |
|---|---|
| `config.getSearch`（读状态） | ✅ `AppServer:873` → `SessionRunner.searchStatus()` → `ToolRegistry.searchStatus()` |
| `config.setSearch`（写） | ❌ **整条链都不存在** |

> 所以搜索后端目前只能从 CLI `/config search` 或手改 `~/.wraith/config.json` 写。
> 对照：**embedding 是完整的**（`config.setEmbedding` + RagPanel 里的表单），
> 说明这不是设计取舍，是漏了一半。

## 现成先例（照它做，别另发明）

```
config.setEmbedding                      ← AppServer:833
  → SessionRunner.embeddingSet(provider, model, baseUrl, apiKey)   ← 接口:275, 实现 Main:1921
  → desktop/src/main/index.ts ipcMain.handle('wraith:configSetEmbedding')
  → desktop/src/preload/index.ts configSetEmbedding
  → RagPanel.tsx 表单
```

搜索后端只是少一个 `model`（它没有模型这一维）。

## 决策

### D1. 表单放在哪 —— 能力卡片自己的详情区

`PluginsPanel` 里内置能力卡片**本来就可点**（`selected = 'builtin:<id>'` 哨兵 + 详情区）。
把表单放进「网页搜索与抓取」被选中后的详情区，用户看见黄标 → 点卡片 → 就地配好。

不放进 RagPanel：那里是检索/embedding 的地盘，而用户撞墙的地方是这张卡片。
把配置入口摆在**报告问题的那个位置**，不需要用户先猜它在别处。

### D2. 校验规则必须**单一来源**

规则现在写死在 `Main.parseSearchConfigUpdate`（一个命令行解析器）里：

- provider 必需，只允许 `zhipu / serpapi / searxng / duckduckgo`
- `searxng` 必须给 baseUrl
- `duckduckgo` 给了 apiKey/baseUrl 要**报错**（静默吞掉会让用户以为 key 生效了）

抽成 `SearchConfigRules.validate(provider, apiKey, baseUrl)`，CLI 与 app-server 都调它。
不抽的话两条路会漂，而漂的方向恰好是「桌面能存进一个 CLI 认为非法的配置」。

### D3. `apiKey` 空 = 沿用已存

与 `embeddingSet` 严格一致。表单不回填 key（回包里根本没有 key）。

### D4. 状态回包要加 `hasApiKey` / `baseUrl`

否则表单没法区分「没配过」和「配过但我不给你看」，用户会以为清空了。
`baseUrl` 不是密钥，可以回传；**key 永不回传**，只回一个布尔。

### D5. 存完要 `invalidateSearchProvider()`

CLI 那条路在 `Main:769` 调了它，所以 `/config search` 之后不必重启。
桌面这条路若漏掉，表现是「存成功了但 agent 还说没配」—— 又一次 snapshot-vs-live。

### D6. 顺手改掉那句文案

`pluginShowcase.ts` 里 `requires` 写着「可用 /config search 写进配置」——
桌面能配了之后这句话就是在把用户推去开终端。

## 落地顺序

1. `SearchConfigRules`（新）+ 让 `parseSearchConfigUpdate` 调它 —— 纯重构，测试先绿
2. `ToolRegistry.searchStatus()` 加 `hasApiKey` / `baseUrl`
3. `SessionRunner.searchSet(...)` 接口 + `config.setSearch` dispatch + Main 里的实现
4. desktop：types / preload / main ipc
5. desktop：卡片详情区的表单
6. 文案

### D7. 「测试连接」一起做（用户选的）

我原本打算不做，理由是「存完回聊天问一句就能验」。**用户选了做** —— 那个理由不成立的地方在于：
SearXNG 端口写错、SerpAPI key 少一位、智谱 key 过期，三种故障在聊天里都表现成
同一句「搜索不可用」，回聊天验等于把分诊推给用户。

实现照 `config.testEmbedding`：
- **必须 `dispatchAsync`**。dispatch 跑在 `serve()` 那条**唯一的** reader 线程上，
  同步执行会让整个 app-server 在探测期间处理不了任何 RPC —— 表现为「点了测试连接，
  整个桌面端都没反应」。
- **0 条结果算失败**。连得上但搜不出东西，对用户和连不上没区别
  （SearXNG 装好了但没启用任何搜索引擎就是这个表现）。
- **不读 env/config**，只用表单值造 provider。若回落到既有配置，就会出现
  「表单填错了但测试通过」，那比没有这个按钮更糟。

## 不做

- **不做 provider 自动探测**。`SEARCH_PROVIDERS` 里 `duckduckgo` 是「显式可选，自动链永不选它」，
  自动探测会把它选上。

## 落地后的事实

- Java **2336** / 桌面 **1774** / tsc **0**
- 突变验证两处：① 去掉「换 provider 不继承旧 key」→ `SearchConfigRulesTest` 红 2 条；
  ② 把表单的 `id === 'web'` 条件改成无条件 → 面板接线测试红 1 条
- 改到了一条既有测试：`builtinCapabilityRequires` 原先钉「文案要提到 `/config search`」。
  写它时 CLI 是唯一写入口；现在继续钉那个命令就成了反向要求
  （用户问的正是「不是必须要 cli 吧」）。**意图不变**（文案必须指出一个写入口），
  期望改成「指向就在手边的那个」。
