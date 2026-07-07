# Provider 图标补全 + Coding Plan/普通 API 分组 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给缺失的 provider 补品牌图标（Coding Plan 复用母 provider），并把「全部」目录拆成「普通 API / Coding Plan」两小节。

**Architecture:** 纯桌面渲染层 + 共享 catalog。`providerCatalog.ts` 补 `lobeIcon` 与新增 `codingPlan` 标记；`ProviderIcon.tsx` 注册 3 个新 lobehub 图标；`ProvidersPanel.tsx` 按 `codingPlan` 拆分「全部」列表。零后端，jar 不变。

**Tech Stack:** TypeScript / React / Vite / Tailwind（token）/ `@lobehub/icons@5.10.1`（深层组件导入）/ vitest。

## Global Constraints

- 密钥红线：本特性无密钥面（纯 UI / 静态数据），提交前仍跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`（只应命中字段名/自指）。
- lobehub 深层导入沿用现有 `ProviderIcon.tsx` 同款路径 `@lobehub/icons/es/<Brand>/components/{Color,Mono}`；Color 优先、无 Color 用 Mono。
- 组件签名沿用仓库既有约定（`ProviderIcon` 用 `React.JSX.Element`，`ProvidersPanel` 用 `JSX.Element`）——不统一改写。
- 门禁：`npm run typecheck`（0 error）+ `npm run test`（vitest 全绿）+ `npm run build`（成功）。所有命令在 `desktop/` 下运行。
- 提交 trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 不改 `agnes` / `freellmapi`（保留首字母回落）、不拆「已配置」节、不改 provider 业务逻辑。

---

### Task 1: catalog 补 lobeIcon + codingPlan 标记 + 图标解析

**Files:**
- Modify: `desktop/src/shared/providerCatalog.ts`（接口加字段；7 条补 `lobeIcon`；4 条加 `codingPlan`）
- Modify: `desktop/src/renderer/components/ProviderIcon.tsx`（3 个新导入 + 3 个 `LOBE_ICONS` 条目）
- Test: `desktop/test/providerCatalog.test.ts`（`codingPlan` 断言）
- Test: `desktop/test/providerIcon.test.tsx`（更新 xfyun + 补 coding/infini/mimo，fallback 改用 agnes）

**Interfaces:**
- Consumes: 现有 `PROVIDER_CATALOG` / `findCatalogEntry` / `resolveIconKind` / `LOBE_ICONS`（已含 `Zhipu`/`Qwen`/`Moonshot`/`Volcengine` 键）。
- Produces: `ProviderCatalogEntry.codingPlan?: boolean`（Task 2 分组消费）；7 条 provider 的 `lobeIcon` 命中 `LOBE_ICONS` → `resolveIconKind` 返 `{kind:'lobe',name}`。

- [ ] **Step 1: 写失败测试（catalog codingPlan）**

在 `desktop/test/providerCatalog.test.ts` 的 `describe('PROVIDER_CATALOG', …)` 块内追加：

```ts
  it('*-coding 条目标记 codingPlan,普通条目不标记', () => {
    for (const id of ['dashscope-coding', 'zhipu-coding', 'kimi-coding', 'volcengine-coding'])
      expect(findCatalogEntry(id)?.codingPlan).toBe(true)
    expect(findCatalogEntry('openai')?.codingPlan).toBeFalsy()
    expect(findCatalogEntry('glm')?.codingPlan).toBeFalsy()
  })
```

- [ ] **Step 2: 改 `providerIcon.test.tsx` 为目标行为（失败）**

把 `desktop/test/providerIcon.test.tsx` 整体替换为：

```tsx
import { describe, it, expect } from 'vitest'
import { resolveIconKind } from '../src/renderer/components/ProviderIcon'

describe('resolveIconKind', () => {
  it('已知 lobeIcon → lobe', () => {
    expect(resolveIconKind('openai')).toEqual({ kind: 'lobe', name: 'OpenAI' })
  })
  it('alias 命中 → 用 canonical 的 lobeIcon', () => {
    // zhipu is an alias for glm, which has lobeIcon: 'Zhipu'
    expect(resolveIconKind('zhipu')).toEqual({ kind: 'lobe', name: 'Zhipu' })
  })
  it('Coding Plan 复用母 provider 图标', () => {
    expect(resolveIconKind('zhipu-coding')).toEqual({ kind: 'lobe', name: 'Zhipu' })
    expect(resolveIconKind('dashscope-coding')).toEqual({ kind: 'lobe', name: 'Qwen' })
    expect(resolveIconKind('kimi-coding')).toEqual({ kind: 'lobe', name: 'Moonshot' })
    expect(resolveIconKind('volcengine-coding')).toEqual({ kind: 'lobe', name: 'Volcengine' })
  })
  it('infini/mimo/xfyun 显示品牌图标', () => {
    expect(resolveIconKind('infini')).toEqual({ kind: 'lobe', name: 'Infinigence' })
    expect(resolveIconKind('mimo')).toEqual({ kind: 'lobe', name: 'XiaomiMiMo' })
    expect(resolveIconKind('xfyun')).toEqual({ kind: 'lobe', name: 'Spark' })
  })
  it('无 lobeIcon/未知 → 回落首字母', () => {
    expect(resolveIconKind('agnes')).toEqual({ kind: 'fallback', letter: 'A' })   // displayName 'Agnes AI'
    expect(resolveIconKind('不存在-provider')).toEqual({ kind: 'fallback', letter: '不' })
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd desktop && npm run test -- --run providerCatalog providerIcon`
Expected: FAIL —— `codingPlan` 断言失败（字段不存在）、coding/infini/mimo/xfyun 断言失败（当前为 fallback）。

- [ ] **Step 4: 改 `providerCatalog.ts` 接口 + 数据**

接口加字段（`lobeIcon?: string` 之后）：
```ts
  lobeIcon?: string
  codingPlan?: boolean
```

给以下条目补字段（保持各条其它字段不变）：
- `dashscope-coding`：加 `lobeIcon: 'Qwen',` 与 `codingPlan: true,`
- `zhipu-coding`：加 `lobeIcon: 'Zhipu',` 与 `codingPlan: true,`
- `kimi-coding`：加 `lobeIcon: 'Moonshot',` 与 `codingPlan: true,`
- `volcengine-coding`：加 `lobeIcon: 'Volcengine',` 与 `codingPlan: true,`
- `infini`：加 `lobeIcon: 'Infinigence',`
- `mimo`：加 `lobeIcon: 'XiaomiMiMo',`
- `xfyun`：加 `lobeIcon: 'Spark',`

（`agnes` / `freellmapi` 不动。）

- [ ] **Step 5: 改 `ProviderIcon.tsx` 注册 3 个新图标**

在导入区（Color-capable 段末，`ModelScopeColor` 之后）加：
```ts
import InfinigenceColor from '@lobehub/icons/es/Infinigence/components/Color'
import XiaomiMiMoMono from '@lobehub/icons/es/XiaomiMiMo/components/Mono'
import SparkColor from '@lobehub/icons/es/Spark/components/Color'
```

在 `LOBE_ICONS` 映射末尾（`ModelScope:` 那行之后）加：
```ts
  Infinigence: InfinigenceColor as unknown as LobeIconComp,
  XiaomiMiMo: XiaomiMiMoMono as unknown as LobeIconComp,
  Spark: SparkColor as unknown as LobeIconComp,
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd desktop && npm run test -- --run providerCatalog providerIcon`
Expected: PASS（两个测试文件全绿）。

- [ ] **Step 7: typecheck**

Run: `cd desktop && npm run typecheck`
Expected: 0 error（3 个深层导入路径存在，已核对 `es/{Infinigence,XiaomiMiMo,Spark}/components/`）。

- [ ] **Step 8: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/shared/providerCatalog.ts desktop/src/renderer/components/ProviderIcon.tsx desktop/test/providerCatalog.test.ts desktop/test/providerIcon.test.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || true
git commit -m "$(printf 'feat(desktop): provider 图标补全(Coding Plan 复用母图标 + infini/mimo/xfyun) + codingPlan 标记\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

### Task 2: ProvidersPanel 拆「全部」为 普通 API / Coding Plan

**Files:**
- Modify: `desktop/src/renderer/components/ProvidersPanel.tsx`（分组派生 + 渲染两小节）

**Interfaces:**
- Consumes: Task 1 的 `ProviderCatalogEntry.codingPlan`；现有 `restCatalog` / `renderCatalogRow` / `matchQ` / `doneRows`。
- Produces: 无（终端 UI）。

- [ ] **Step 1: 派生两组**

在 `restCatalog` 定义（`const restCatalog = PROVIDER_CATALOG.filter(…)`）之后追加：
```tsx
  const normalCatalog = restCatalog.filter(e => !e.codingPlan)
  const codingCatalog = restCatalog.filter(e => e.codingPlan)
```

- [ ] **Step 2: 渲染两小节替换原「全部」**

把 return 中这两行：
```tsx
        <div className="mt-3 px-2 text-3xs uppercase tracking-wider text-fg-subtle">全部</div>
        {restCatalog.map(renderCatalogRow)}
```
替换为：
```tsx
        {normalCatalog.length > 0 && <><div className="mt-3 px-2 text-3xs uppercase tracking-wider text-fg-subtle">普通 API</div>{normalCatalog.map(renderCatalogRow)}</>}
        {codingCatalog.length > 0 && <><div className="mt-3 px-2 text-3xs uppercase tracking-wider text-fg-subtle">Coding Plan</div>{codingCatalog.map(renderCatalogRow)}</>}
```
（`doneRows`「已配置」节保持不变，仍在其上方置顶。）

- [ ] **Step 3: typecheck + build**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: typecheck 0 error；build 成功。

- [ ] **Step 4: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/src/renderer/components/ProvidersPanel.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || true
git commit -m "$(printf 'feat(desktop): provider 列表「全部」拆为 普通 API / Coding Plan 两小节\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

## Self-Review

- **Spec 覆盖**：图标补全（7 条）= Task 1；分组 = Task 2；agnes/freellmapi 据置、已配置不拆 = 约束已列。✓
- **占位符**：无 TBD/TODO；每步含完整代码/命令。✓
- **类型一致**：`codingPlan?: boolean` 在 Task 1 接口定义、Task 2 消费；`lobeIcon` 键名（Infinigence/XiaomiMiMo/Spark）在 catalog 值与 `LOBE_ICONS` 键一致。✓
- **测试口径**：fallback 用例从 xfyun 迁到 agnes（xfyun 现有图标）；agnes displayName `Agnes AI` → 首字符 `A`。✓
