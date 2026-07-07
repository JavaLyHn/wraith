# 设计：Provider 图标补全 + Coding Plan / 普通 API 分组

日期：2026-07-07
范围：桌面渲染层 + 共享 catalog。零后端（jar 不变）。分支 `feat/provider-icons-grouping`（off main，与 `feat/skill-scope-move` / `feat/resend-message` 互不影响）。

## 问题

Provider 选择列表里，一部分条目显示的是**首字母回落**（圆形底 + 单字），而非品牌图标：

- **Coding Plan 系列**（`zhipu-coding` 显「智」、`dashscope-coding` 显「百」、`kimi-coding` 显「K」、`volcengine-coding` 显「火」）——它们本该复用各自母 provider 的品牌图标。
- **部分普通 provider**（`infini` 显「无」、`mimo` 显「X」、`xfyun` 显「讯」）——lobehub 里其实有对应品牌图标，只是 catalog 没登记 `lobeIcon`。

同时，「全部」目录把普通 API 与 Coding Plan 混在一条长列表里，Coding Plan 条目散落其中，不易区分。

## 目标

1. 给缺失的 catalog 条目补 `lobeIcon`，让 Coding Plan 复用母 provider 图标、`infini`/`mimo`/`xfyun` 显示品牌图标。
2. 「全部」目录按 **普通 API / Coding Plan** 拆成两小节展示。

## 非目标（YAGNI）

- 不为 `agnes` / `freellmapi` 造图标：lobehub 无对应品牌，保留首字母回落。
- 不拆「已配置」一节：用户已配置的 provider 仍按原样扁平置顶。
- 不改 provider 的业务逻辑（配置/测试/删除/默认）、不改 `ModelSwitcher`（它复用 `ProviderIcon`，图标补全自动生效，无需额外改动）。
- 不引新的图标库（仅用已装的 `@lobehub/icons@5.10.1`）。

## 现有结构（锚点）

- `desktop/src/shared/providerCatalog.ts`：`ProviderCatalogEntry` 接口 + `PROVIDER_CATALOG` 数组。`findCatalogEntry(idOrAlias)` 按 id/alias 反查。
- `desktop/src/renderer/components/ProviderIcon.tsx`：
  - 深层组件导入（如 `@lobehub/icons/es/Zhipu/components/Color`），Color 优先、否则 Mono。
  - `LOBE_ICONS: Record<string, LobeIconComp>`，键 = catalog 里的 `lobeIcon` 字符串。
  - `resolveIconKind(id)`：catalog 有 `lobeIcon` 且命中 `LOBE_ICONS` → `{kind:'lobe',name}`；否则 `{kind:'fallback',letter}`（取 displayName 首字符）。
- `desktop/src/renderer/components/ProvidersPanel.tsx`：
  - `doneRows`（已配置，`hasKey`）→「已配置」节；`restCatalog`（未配置或 `repeatable`）→「全部」节（`restCatalog.map(renderCatalogRow)`，:133）。
  - 搜索框 `q` 经 `matchQ(id,name)` 过滤。

## 设计

### 1. catalog：补 `lobeIcon` + 加 `codingPlan` 标记

`ProviderCatalogEntry` 接口新增可选字段：
```ts
codingPlan?: boolean   // true = Coding Plan 系列(分组用)
```

补 `lobeIcon`（沿用现有 lobehub 品牌键名）：

| 条目 id | 新增 `lobeIcon` | 新增 `codingPlan` | 图标来源 |
|---|---|---|---|
| `zhipu-coding` | `Zhipu` | `true` | 已 import |
| `dashscope-coding` | `Qwen` | `true` | 已 import（母 `dashscope` 用 Qwen） |
| `kimi-coding` | `Moonshot` | `true` | 已 import |
| `volcengine-coding` | `Volcengine` | `true` | 已 import |
| `infini` | `Infinigence` | — | **新 import**（Color） |
| `mimo` | `XiaomiMiMo` | — | **新 import**（Mono，无 Color） |
| `xfyun` | `Spark` | — | **新 import**（Color） |

`agnes` / `freellmapi` 不动。

### 2. ProviderIcon：注册 3 个新图标

新增深层导入并登记进 `LOBE_ICONS`：
```ts
import InfinigenceColor from '@lobehub/icons/es/Infinigence/components/Color'
import XiaomiMiMoMono   from '@lobehub/icons/es/XiaomiMiMo/components/Mono'
import SparkColor       from '@lobehub/icons/es/Spark/components/Color'
// …
Infinigence: InfinigenceColor as unknown as LobeIconComp,
XiaomiMiMo:  XiaomiMiMoMono  as unknown as LobeIconComp,
Spark:       SparkColor      as unknown as LobeIconComp,
```
`resolveIconKind` 逻辑不变——`zhipu-coding` 等条目自身带了 `lobeIcon` 后即命中 lobe 分支。

### 3. ProvidersPanel：拆「全部」为两小节

把 `restCatalog` 按 `codingPlan` 分成两组，普通在前、Coding Plan 在后；各组沿用现有 `matchQ` 过滤（搜索时逐组过滤），组为空则隐藏该组标题：
```tsx
const normalCatalog = restCatalog.filter(e => !e.codingPlan)
const codingCatalog = restCatalog.filter(e => e.codingPlan)
// 「已配置」节不变
// 普通 API 小节:标题「普通 API」+ normalCatalog.map(renderCatalogRow)
// Coding Plan 小节:标题「Coding Plan」+ codingCatalog.map(renderCatalogRow)（codingCatalog 非空才渲染标题）
```
小节标题沿用现有 `mt-3 px-2 text-3xs uppercase tracking-wider text-fg-subtle` 样式。`renderCatalogRow` 不变。

## 测试 / 门禁

- **vitest `providerIcon.test.tsx`**：
  - 更新原 `xfyun → 首字母「讯」` 用例 → 改判 `{kind:'lobe',name:'Spark'}`。
  - fallback 用例改用仍无图标者：`resolveIconKind('agnes')` → `{kind:'fallback',letter:'A'}`。
  - 补：`resolveIconKind('zhipu-coding')` → `{kind:'lobe',name:'Zhipu'}`（Coding Plan 复用母图标）；`infini` → `Infinigence`；`mimo` → `XiaomiMiMo`。
- **vitest `providerCatalog.test.ts`**：补一条——`*-coding` 四条 `codingPlan===true`，且随机取一个普通条目（如 `openai`）`codingPlan` 为假。
- **typecheck + build**：3 个新图标深层导入路径存在（已核对 `es/{Infinigence,XiaomiMiMo,Spark}/components/` 目录）、`ProvidersPanel` 分组接线通过。
- **眼验**：重启桌面 App，打开 provider 列表——
  - 上述 7 条显示品牌图标（Coding Plan 4 条 = 母 provider 图标；infini/mimo/xfyun = 各自品牌）；`agnes`/`freellmapi` 仍首字母。
  - 「全部」分为「普通 API」「Coding Plan」两节，普通在前；「已配置」仍置顶不拆。
  - 搜索时各组独立过滤、空组不显标题。

## 风险

- lobehub 深层组件路径是内部结构（非公开 API），已按现有 `ProviderIcon.tsx` 同款方式核对 `@lobehub/icons@5.10.1` 下 `es/Infinigence/components/Color`、`es/XiaomiMiMo/components/Mono`、`es/Spark/components/Color` 均存在。升级 lobehub 时需连同现有图标一并复核（现有文件已有此注记）。

## 交付链路

`feat/provider-icons-grouping` → 实现（TDD）→ typecheck + vitest + build 全绿 → 眼验 → FF-merge + 推送（推送前用户点头）。纯前端，jar 不变。

## 安全

无密钥面，纯 UI / 静态数据。
