# GitHub AI 日报 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 造一个零依赖 Node 脚本，每天被 wraith 定时任务调用一次，产出「昨日 AI 领域 star 日增 / fork 日增 / 涨粉最多的人」的 Markdown + JSON 报告，所有口径外置到配置文件、不含任何投递代码。

**Architecture:** 因为 GitHub 官方 API 拿不到任何历史增量（`stargazers` 对他人仓库 404、follower 零历史 —— 实测见 spec §1），脚本必须**有状态**：Search API 维护 AI 候选池 → GraphQL 每天批量抓一份全池快照 → 与前一天快照做差得到精确日增。冷启动那一天没有基线，退化用 Trending 页的 `stars today` 和 `forks?sort=newest` 精确回溯兜底。副作用（网络、磁盘）只允许出现在 `github.mjs` / `snapshot.mjs`，分类、排名、渲染全是纯函数，因此单测**不需要 mock 网络**。

**Tech Stack:** Node 22（本机 v22.22.2）原生 `fetch` + `node:zlib` gzip，**零 npm 依赖**；测试用 `desktop/` 已装的 vitest ^2.0.0（实测 2.1.9）；token 走 `gh auth token`（本机已登录，scopes `gist`/`read:org`/`repo`）。

**Spec:** `docs/superpowers/specs/2026-08-04-github-ai-daily-digest-design.md`
决策映射：D7→Task 1，D5→Task 2，D2 D15→Task 3，D3 D6→Task 4，D9→Task 5，D10 D11 D13→Task 6，D1→Task 7，D14→贯穿全部，D8 D12→Task 9。

---

## Global Constraints

- **文件形态已实测锁定**：脚本模块用 `.mjs`；单测文件用 **`.test.mjs`（不是 `.ts`）**，放 `desktop/test/`。
  实测依据：`desktop/tsconfig.json` 的 `include` 含 `test/**/*` 且 `strict: true`、`allowJs` 未开，**用 `.ts` 写测试去 import 无类型的 `.mjs` 会让 `npm run typecheck` 报 TS7016**；改成 `.test.mjs` 后 tsc 直接不收录该文件，而 vitest 默认 include（`**/*.{test,spec}.?(c|m)[jt]s?(x)`）照样能捕获。两条已跑通验证。
- **测试禁止读写真实 `~/.wraith/`。** 一切磁盘测试用 `node:fs.mkdtempSync(join(tmpdir(), 'ghai-'))`，`finally` 里 `rmSync(..., {recursive:true, force:true})`。
- **测试禁止发真实网络请求。** `github.mjs` 的所有网络入口都必须接受注入的 `fetchImpl`；单测只喂假 `fetchImpl` 和字符串 fixture。
- **绝不打印 token。** 日志、报告、错误信息里一律不得出现 token 值，也不得把 token 写进任何文件。测试里的 token 一律用 `ghp_FAKE_FOR_TEST`。
- **脚本零投递代码。** 不得出现飞书 / QQ / webhook / SMTP 任何字样（spec D8）。投递归 automation 的 `deliverTo`。
- **一切口径外置。** 主题、关键词、黑名单、关注名单、阈值、Top N 一律从配置读，源码里**不得**出现硬编码的 topic 名或阈值数字（默认值只允许出现在 `config.default.json`）。
- **测试闸门**：每个任务结束时 `cd desktop && npm test` 必须全绿，`npm run typecheck` 必须 0 错误。
  **当前基线：110 test files / 959 tests passed（2026-08-04 在本分支基点 `ecb8643` = `origin/main` 实测）。** 每个任务只允许让这两个数字变大。
  （注：`feat/windows-parity-block1` 上是 167/1458，那条线不在本分支范围内，别拿它对账。）
- `git add` **只加**本任务明确列出的文件；**绝不** `git add .` / `git add -A`；**绝不**提交 `~/.wraith/` 下的任何东西。
- commit message 正文用中文，末尾加：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
  （仓库另有 `Claude-Session: <url>` 惯例，按执行时的真实会话填；拿不到就省略，**不要编一个**。）
- **时间一律用注入的 `now`**，不得在纯函数里调 `new Date()` —— 否则测不了「漏跑一天」这类分支。

---

## File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `scripts/github-ai-daily/config.default.json` | **新建**。配置模板，唯一允许写默认口径的地方 | 1 |
| `scripts/github-ai-daily/config.mjs` | **新建**。配置加载、模板合并（不覆盖用户键）、语法错误定位 | 1 |
| `scripts/github-ai-daily/classify.mjs` | **新建**。AI 相关性打分、剔除、知识类判定（纯函数） | 2 |
| `scripts/github-ai-daily/snapshot.mjs` | **新建**。快照 JSONL.gz 读写、基线选取、保留期清理 | 3 |
| `scripts/github-ai-daily/rank.mjs` | **新建**。做差、三层分层、增速榜、连续在榜天数（纯函数） | 4 |
| `scripts/github-ai-daily/report.mjs` | **新建**。Markdown / JSON 渲染（纯函数） | 5 |
| `scripts/github-ai-daily/github.mjs` | **新建**。token 解析、限流退避、GraphQL 批量、REST、Trending HTML 解析 | 6 |
| `scripts/github-ai-daily/discover.mjs` | **新建**。查询构造、候选池增量维护 | 7 |
| `scripts/github-ai-daily/index.mjs` | **新建**。CLI 编排、冷启动路径、退出码 | 8 |
| `docs/runbooks/github-ai-daily.md` | **新建**。怎么改配置、怎么排障、定时任务怎么配 | 9 |
| `desktop/test/githubAiDaily.*.test.mjs` | **新建**。7 个测试文件，一个模块一个 | 1–7 |

---

## Task 1: 配置层

**Files:**
- Create: `scripts/github-ai-daily/config.default.json`
- Create: `scripts/github-ai-daily/config.mjs`
- Test: `desktop/test/githubAiDaily.config.test.mjs`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces:
  - `DEFAULT_DATA_DIR: string` —— `join(homedir(), '.wraith', 'reports', 'github-ai-daily')`
  - `class ConfigError extends Error` —— 带 `.path` 与 `.cause`
  - `mergeConfig(template: object, user: object): object` —— 纯函数。递归合并；**用户已有的键一律保留**（含值为 `null`/`0`/`false`/`[]`）；**数组整体替换，不合并**；模板独有的键补进来
  - `loadConfig({ dataDir, templatePath }): { config: object, path: string, createdFromTemplate: boolean }` —— 直接用 `node:fs`，**不做 fs 注入**（磁盘测试走真实临时目录，注入假 fs 只会测得更浅）。目录不存在则递归创建；`config.json` 不存在则从模板复制并 `createdFromTemplate: true`；JSON 语法错误抛 `ConfigError`

- [ ] **Step 1: 写 `config.default.json`**

内容照抄 spec §6 全文（含 `contributorPoolTopRepos: 50`）。这是**唯一**允许出现默认口径的文件。

- [ ] **Step 2: 写失败的测试**

`desktop/test/githubAiDaily.config.test.mjs`：

```js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeConfig, loadConfig, ConfigError, DEFAULT_DATA_DIR } from '../../scripts/github-ai-daily/config.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ghai-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const TEMPLATE = { topN: 5, minStars: 100, tiers: { rising: 3000, mid: 30000 }, topics: { agent: ['ai-agent', 'agentic'] } };

describe('mergeConfig', () => {
  it('用户的键一律不被模板覆盖', () => {
    const merged = mergeConfig(TEMPLATE, { topN: 20, tiers: { rising: 500 } });
    expect(merged.topN).toBe(20);
    expect(merged.tiers.rising).toBe(500);
    expect(merged.tiers.mid).toBe(30000); // 缺失的才补
  });

  it('用户显式写的 falsy 值不被当成缺失', () => {
    const merged = mergeConfig(TEMPLATE, { minStars: 0, topN: null });
    expect(merged.minStars).toBe(0);
    expect(merged.topN).toBe(null);
  });

  it('数组整体替换而不是合并 —— 用户删掉的 topic 不许被模板加回来', () => {
    const merged = mergeConfig(TEMPLATE, { topics: { agent: ['ai-agent'] } });
    expect(merged.topics.agent).toEqual(['ai-agent']);
  });

  it('模板独有的新键会被补进来（升级路径）', () => {
    const merged = mergeConfig({ ...TEMPLATE, brandNewKey: 7 }, { topN: 20 });
    expect(merged.brandNewKey).toBe(7);
  });

  it('不改动入参', () => {
    const user = { topN: 20 };
    mergeConfig(TEMPLATE, user);
    expect(user).toEqual({ topN: 20 });
    expect(TEMPLATE.tiers.mid).toBe(30000);
  });
});

describe('loadConfig', () => {
  it('首次运行从模板复制，并标记 createdFromTemplate', () => {
    const dir = tmp(), tplDir = tmp();
    const templatePath = join(tplDir, 'config.default.json');
    writeFileSync(templatePath, JSON.stringify(TEMPLATE));
    const r = loadConfig({ dataDir: join(dir, 'nested'), templatePath });
    expect(r.createdFromTemplate).toBe(true);
    expect(r.config.topN).toBe(5);
    expect(existsSync(r.path)).toBe(true);
    expect(JSON.parse(readFileSync(r.path, 'utf8')).topN).toBe(5);
  });

  it('已有配置时不再标记 createdFromTemplate，且用户值优先', () => {
    const dir = tmp(), tplDir = tmp();
    const templatePath = join(tplDir, 'config.default.json');
    writeFileSync(templatePath, JSON.stringify(TEMPLATE));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ topN: 99 }));
    const r = loadConfig({ dataDir: dir, templatePath });
    expect(r.createdFromTemplate).toBe(false);
    expect(r.config.topN).toBe(99);
    expect(r.config.minStars).toBe(100);
  });

  it('JSON 语法错误抛 ConfigError 且带上文件路径 —— 绝不静默回落默认值', () => {
    const dir = tmp(), tplDir = tmp();
    const templatePath = join(tplDir, 'config.default.json');
    writeFileSync(templatePath, JSON.stringify(TEMPLATE));
    mkdirSync(dir, { recursive: true });
    const bad = join(dir, 'config.json');
    writeFileSync(bad, '{ "topN": 5, }');
    let err;
    try { loadConfig({ dataDir: dir, templatePath }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.path).toBe(bad);
    expect(err.message).toContain('config.json');
  });
});

describe('DEFAULT_DATA_DIR', () => {
  it('落在 ~/.wraith/reports/github-ai-daily', () => {
    expect(DEFAULT_DATA_DIR.endsWith(join('.wraith', 'reports', 'github-ai-daily'))).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/githubAiDaily.config.test.mjs`
Expected: FAIL —— `Failed to resolve import ".../config.mjs"`

- [ ] **Step 4: 实现 `config.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATA_DIR = join(homedir(), '.wraith', 'reports', 'github-ai-daily');
export const DEFAULT_TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'config.default.json');

export class ConfigError extends Error {
  constructor(message, path, cause) {
    super(message);
    this.name = 'ConfigError';
    this.path = path;
    this.cause = cause;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mergeConfig(template, user) {
  const out = isPlainObject(user) ? { ...user } : {};
  for (const [k, tv] of Object.entries(template ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) {
      out[k] = isPlainObject(tv) ? mergeConfig(tv, {}) : Array.isArray(tv) ? [...tv] : tv;
    } else if (isPlainObject(tv) && isPlainObject(out[k])) {
      out[k] = mergeConfig(tv, out[k]);
    }
    // 数组或标量：用户已有 → 原样保留（数组整体替换语义）
  }
  return out;
}

export function loadConfig({ dataDir = DEFAULT_DATA_DIR, templatePath = DEFAULT_TEMPLATE_PATH } = {}) {
  let template;
  try {
    template = JSON.parse(readFileSync(templatePath, 'utf8'));
  } catch (e) {
    throw new ConfigError(`配置模板读不了：${templatePath} —— ${e.message}`, templatePath, e);
  }

  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'config.json');

  if (!existsSync(path)) {
    const config = mergeConfig(template, {});
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    return { config, path, createdFromTemplate: true };
  }

  let user;
  try {
    user = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ConfigError(
      `config.json 语法错误，已停止运行（不会退回默认值，否则你会以为改生效了）：${path}\n${e.message}`,
      path, e);
  }
  return { config: mergeConfig(template, user), path, createdFromTemplate: false };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/githubAiDaily.config.test.mjs`
Expected: PASS（13 个断言全过）

- [ ] **Step 6: 跑全量闸门**

Run: `cd desktop && npm test && npm run typecheck`
Expected: 168 files / 1470 tests 左右全绿；typecheck 无输出

- [ ] **Step 7: 提交**

```bash
git add scripts/github-ai-daily/config.default.json scripts/github-ai-daily/config.mjs desktop/test/githubAiDaily.config.test.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): GitHub AI 日报的配置层 —— 口径全外置，升级不覆盖用户改动

主题/关键词/黑名单/关注名单/阈值全从 config.json 读,源码里不留硬编码。
合并规则刻意是「模板只补缺失键」而非深度覆盖:用户删掉的 topic 不许被
下次升级偷偷加回来,所以数组是整体替换语义。config.json 语法错误直接
报错退出而不回落默认值 —— 静默回落会让人以为自己的修改生效了。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: AI 相关性与知识类判定

**Files:**
- Create: `scripts/github-ai-daily/classify.mjs`
- Test: `desktop/test/githubAiDaily.classify.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 config 形状（`topics`、`keywords.include/exclude`、`knowledgeRepoHints`）
- Produces:
  - 规范化的仓库对象类型（后续所有任务共用这个形状）：
    ```js
    /** @typedef {{fullName:string, owner:string, ownerType:'User'|'Organization', name:string,
     *  description:string|null, topics:string[], stars:number, forks:number, watchers:number,
     *  primaryLanguage:string|null, isFork:boolean, isArchived:boolean,
     *  pushedAt:string, createdAt:string}} Repo */
    ```
  - `matchesKeyword(haystack: string, keyword: string): boolean` —— ASCII 关键词走词边界，非 ASCII（中文）走子串
  - `scoreRepo(repo, config): { score: number, topicHits: string[], keywordHits: string[] }` —— topic 命中 **+3/个、上限 6**；名称或简介关键词命中 **+1/个、上限 3**
  - `isExcluded(repo, config): boolean`
  - `isKnowledge(repo, config): boolean`
  - `classify(repo, config): { kind: 'ai'|'knowledge'|'unrelated'|'excluded', score, topicHits, keywordHits }`

- [ ] **Step 1: 写失败的测试**

`desktop/test/githubAiDaily.classify.test.mjs`：

```js
import { describe, it, expect } from 'vitest';
import { matchesKeyword, scoreRepo, isExcluded, isKnowledge, classify }
  from '../../scripts/github-ai-daily/classify.mjs';

const CONFIG = {
  topics: { agent: ['ai-agent', 'agentic'], spec: ['mcp', 'llms-txt'] },
  keywords: { include: ['agent', 'LLM', 'MCP', 'eval'], exclude: ['mirror', '镜像', '翻译'] },
  knowledgeRepoHints: ['awesome', 'cookbook', '教程'],
};

const repo = (over = {}) => ({
  fullName: 'acme/thing', owner: 'acme', ownerType: 'Organization', name: 'thing',
  description: 'a thing', topics: [], stars: 500, forks: 10, watchers: 5,
  primaryLanguage: 'Python', isFork: false, isArchived: false,
  pushedAt: '2026-08-03T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', ...over,
});

describe('matchesKeyword', () => {
  it('ASCII 关键词走词边界，不误伤更长的单词', () => {
    expect(matchesKeyword('an MCP server', 'MCP')).toBe(true);
    expect(matchesKeyword('mcpherson wrote this', 'MCP')).toBe(false);
    expect(matchesKeyword('LLM-powered', 'LLM')).toBe(true);
  });
  it('大小写不敏感', () => {
    expect(matchesKeyword('an llm agent', 'LLM')).toBe(true);
  });
  it('中文关键词走子串（中文没有词边界）', () => {
    expect(matchesKeyword('这是官方文档的中文翻译版', '翻译')).toBe(true);
  });
  it('空 haystack 不炸', () => {
    expect(matchesKeyword('', 'agent')).toBe(false);
    expect(matchesKeyword(null, 'agent')).toBe(false);
  });
});

describe('scoreRepo', () => {
  it('单个 topic 命中给 3 分', () => {
    const r = scoreRepo(repo({ topics: ['ai-agent'] }), CONFIG);
    expect(r.score).toBe(3);
    expect(r.topicHits).toEqual(['ai-agent']);
  });
  it('topic 分数上限 6，三个命中也只算 6', () => {
    expect(scoreRepo(repo({ topics: ['ai-agent', 'agentic', 'mcp'] }), CONFIG).score).toBe(6);
  });
  it('关键词只给弱信号，单个 1 分', () => {
    const r = scoreRepo(repo({ description: 'an LLM toolkit' }), CONFIG);
    expect(r.score).toBe(1);
    expect(r.keywordHits).toEqual(['LLM']);
  });
  it('关键词分数上限 3', () => {
    expect(scoreRepo(repo({ name: 'agent-eval', description: 'LLM MCP agent eval' }), CONFIG).score).toBe(3);
  });
  it('topic + 关键词叠加，上限 9', () => {
    const r = scoreRepo(repo({ topics: ['ai-agent', 'mcp'], name: 'llm-agent-eval',
      description: 'agent LLM MCP eval' }), CONFIG);
    expect(r.score).toBe(9);
  });
  it('简介为 null 不炸', () => {
    expect(scoreRepo(repo({ description: null }), CONFIG).score).toBe(0);
  });
});

describe('isExcluded', () => {
  it('fork 直接剔除', () => { expect(isExcluded(repo({ isFork: true }), CONFIG)).toBe(true); });
  it('归档仓库直接剔除', () => { expect(isExcluded(repo({ isArchived: true }), CONFIG)).toBe(true); });
  it('命中 exclude 关键词直接剔除', () => {
    expect(isExcluded(repo({ description: 'a mirror of upstream' }), CONFIG)).toBe(true);
    expect(isExcluded(repo({ name: 'langchain-中文翻译' }), CONFIG)).toBe(true);
  });
  it('干净仓库不被剔除', () => { expect(isExcluded(repo(), CONFIG)).toBe(false); });
});

describe('isKnowledge', () => {
  it('名称命中提示词算知识类', () => {
    expect(isKnowledge(repo({ name: 'awesome-ai-agents' }), CONFIG)).toBe(true);
  });
  it('中文提示词也算', () => {
    expect(isKnowledge(repo({ description: 'LLM 入门教程' }), CONFIG)).toBe(true);
  });
  it('主语言为 Markdown 算知识类', () => {
    expect(isKnowledge(repo({ primaryLanguage: 'Markdown' }), CONFIG)).toBe(true);
  });
  it('主语言为 null 算知识类（纯文档仓库，如 agents.md / llms-txt）', () => {
    expect(isKnowledge(repo({ primaryLanguage: null }), CONFIG)).toBe(true);
  });
  it('正常代码仓库不算', () => { expect(isKnowledge(repo(), CONFIG)).toBe(false); });
});

describe('classify', () => {
  it('剔除优先于一切，哪怕 topic 全中', () => {
    const r = classify(repo({ isFork: true, topics: ['ai-agent', 'mcp'] }), CONFIG);
    expect(r.kind).toBe('excluded');
  });
  it('分数不足 3 判为 unrelated', () => {
    expect(classify(repo({ description: 'an LLM toolkit' }), CONFIG).kind).toBe('unrelated');
  });
  it('刚好 3 分即算 AI 相关（阈值边界）', () => {
    expect(classify(repo({ topics: ['mcp'] }), CONFIG).kind).toBe('ai');
  });
  it('关键词凑满 3 分也算 AI 相关', () => {
    expect(classify(repo({ description: 'agent LLM eval' }), CONFIG).kind).toBe('ai');
  });
  it('AI 相关 + 知识类 → knowledge，不进主榜', () => {
    const r = classify(repo({ name: 'awesome-mcp', topics: ['mcp'] }), CONFIG);
    expect(r.kind).toBe('knowledge');
    expect(r.score).toBe(4); // topic mcp 得 3 + 名字里词边界命中关键词 MCP 得 1
  });
  it('topic 与同名关键词各算一次 —— 两种信号刻意相加，不去重', () => {
    // 守住这条语义：曾有实现为了凑分数偷偷加过「同名即去重」，那会把
    // 「结构化 tag」与「简介里的自由文本」这两份独立证据抹成一份。
    const r = scoreRepo(repo({ topics: ['mcp'], description: 'Native MCP support included' }), CONFIG);
    expect(r.score).toBe(4);
    expect(r.keywordHits).toEqual(['MCP']);
  });
  it('知识类但与 AI 无关 → unrelated（不进知识栏）', () => {
    expect(classify(repo({ name: 'awesome-cooking' }), CONFIG).kind).toBe('unrelated');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/githubAiDaily.classify.test.mjs`
Expected: FAIL —— 无法解析 `classify.mjs`

- [ ] **Step 3: 实现 `classify.mjs`**

```js
/** @typedef {{fullName:string, owner:string, ownerType:'User'|'Organization', name:string,
 *  description:string|null, topics:string[], stars:number, forks:number, watchers:number,
 *  primaryLanguage:string|null, isFork:boolean, isArchived:boolean,
 *  pushedAt:string, createdAt:string}} Repo */

const TOPIC_POINTS = 3;
const TOPIC_CAP = 6;
const KEYWORD_POINTS = 1;
const KEYWORD_CAP = 3;
const AI_THRESHOLD = 3;

const isAscii = (s) => /^[\x20-\x7E]+$/.test(s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchesKeyword(haystack, keyword) {
  if (!haystack || !keyword) return false;
  const text = String(haystack);
  if (!isAscii(keyword)) return text.toLowerCase().includes(keyword.toLowerCase());
  return new RegExp(`(^|[^a-z0-9])${escapeRe(keyword)}([^a-z0-9]|$)`, 'i').test(text);
}

const allTopics = (config) => Object.values(config.topics ?? {}).flat();
const haystacks = (repo) => [repo.name ?? '', repo.description ?? '', repo.fullName ?? ''];

export function scoreRepo(repo, config) {
  const wanted = new Set(allTopics(config).map((t) => t.toLowerCase()));
  const topicHits = (repo.topics ?? []).filter((t) => wanted.has(String(t).toLowerCase()));
  const keywordHits = (config.keywords?.include ?? [])
    .filter((k) => haystacks(repo).some((h) => matchesKeyword(h, k)));
  const score = Math.min(topicHits.length * TOPIC_POINTS, TOPIC_CAP)
              + Math.min(keywordHits.length * KEYWORD_POINTS, KEYWORD_CAP);
  return { score, topicHits, keywordHits };
}

export function isExcluded(repo, config) {
  if (repo.isFork || repo.isArchived) return true;
  const fields = [...haystacks(repo), ...(repo.topics ?? [])];
  return (config.keywords?.exclude ?? []).some((k) => fields.some((h) => matchesKeyword(h, k)));
}

export function isKnowledge(repo, config) {
  const lang = repo.primaryLanguage;
  if (lang === null || lang === undefined || String(lang).toLowerCase() === 'markdown') return true;
  return (config.knowledgeRepoHints ?? []).some((h) => haystacks(repo).some((x) => matchesKeyword(x, h)));
}

export function classify(repo, config) {
  const scored = scoreRepo(repo, config);
  if (isExcluded(repo, config)) return { kind: 'excluded', ...scored };
  if (scored.score < AI_THRESHOLD) return { kind: 'unrelated', ...scored };
  return { kind: isKnowledge(repo, config) ? 'knowledge' : 'ai', ...scored };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/githubAiDaily.classify.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑全量闸门**

Run: `cd desktop && npm test && npm run typecheck`
Expected: 全绿，测试数只增不减

- [ ] **Step 6: 提交**

```bash
git add scripts/github-ai-daily/classify.mjs desktop/test/githubAiDaily.classify.test.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): AI 相关性打分 —— topic 是强信号,关键词只配当弱信号

很多爆款不打 topic,所以必须有关键词兜底;但关键词噪声大,于是 topic
+3/个(上限 6)、关键词 +1/个(上限 3),阈值 3 分。关键词匹配对 ASCII 走词
边界,免得 MCP 匹上 mcpherson;中文走子串,因为中文没有词边界。

知识类(awesome/教程/纯文档仓)单独归一类而不是剔除:agents.md、llms-txt
这种「AI 规范」本质上也是文档仓,直接扔会丢掉一整类要看的东西。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 快照存取与基线选取

**Files:**
- Create: `scripts/github-ai-daily/snapshot.mjs`
- Test: `desktop/test/githubAiDaily.snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `Repo` 形状
- Produces:
  - `snapshotName(at: Date): string` —— `'2026-08-04T07.jsonl.gz'`，**本地时区**、小时精度
  - `parseSnapshotName(name: string): Date | null` —— 解析不出返回 `null`（忽略目录里的杂物）
  - `pickBaseline(names: string[], now: Date, minAgeHours: number): { name: string, at: Date } | null` —— **纯函数**。取「距 now 至少 minAgeHours」中最新的一份
  - `windowHours(from: Date, to: Date): number` —— 保留一位小数
  - `writeSnapshot(dir, at, { repos, users }): Promise<string>` —— 写 gzip JSONL，返回文件全路径。每行一条 `{"t":"repo",...}` 或 `{"t":"user","login":..,"followers":..}`
  - `readSnapshot(dir, name): Promise<{ at: Date, repos: Map<string, Repo>, users: Map<string, number> }>` —— **坏行跳过不抛**，整个文件解压失败才抛
  - `listSnapshots(dir): string[]` —— 按时间升序，已过滤非法名
  - `pruneSnapshots(dir, now, retainDays): string[]` —— 返回被删的文件名

- [ ] **Step 1: 写失败的测试**

```js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotName, parseSnapshotName, pickBaseline, windowHours,
         writeSnapshot, readSnapshot, listSnapshots, pruneSnapshots }
  from '../../scripts/github-ai-daily/snapshot.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ghai-snap-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('snapshotName / parseSnapshotName', () => {
  it('小时精度、可往返', () => {
    const at = new Date(2026, 7, 4, 7, 30, 0);
    const name = snapshotName(at);
    expect(name).toBe('2026-08-04T07.jsonl.gz');
    expect(parseSnapshotName(name).getHours()).toBe(7);
    expect(parseSnapshotName(name).getDate()).toBe(4);
  });
  it('非法名返回 null 而不是抛', () => {
    expect(parseSnapshotName('config.json')).toBe(null);
    expect(parseSnapshotName('.DS_Store')).toBe(null);
  });
});

describe('pickBaseline', () => {
  const NOW = new Date(2026, 7, 4, 7, 0, 0);
  it('正常情况取昨天那份', () => {
    const r = pickBaseline(['2026-08-02T07.jsonl.gz', '2026-08-03T07.jsonl.gz', '2026-08-04T07.jsonl.gz'], NOW, 20);
    expect(r.name).toBe('2026-08-03T07.jsonl.gz');
  });
  it('今天刚写的那份不能当基线（不足 20h）', () => {
    expect(pickBaseline(['2026-08-04T07.jsonl.gz'], NOW, 20)).toBe(null);
  });
  it('漏跑一天 → 自动退到前天那份', () => {
    const r = pickBaseline(['2026-08-02T07.jsonl.gz', '2026-08-04T07.jsonl.gz'], NOW, 20);
    expect(r.name).toBe('2026-08-02T07.jsonl.gz');
  });
  it('一份都没有返回 null（冷启动）', () => {
    expect(pickBaseline([], NOW, 20)).toBe(null);
  });
  it('忽略目录里的杂物文件', () => {
    const r = pickBaseline(['config.json', '2026-08-03T07.jsonl.gz'], NOW, 20);
    expect(r.name).toBe('2026-08-03T07.jsonl.gz');
  });
});

describe('windowHours', () => {
  it('正常 24h', () => {
    expect(windowHours(new Date(2026, 7, 3, 7), new Date(2026, 7, 4, 7))).toBe(24);
  });
  it('漏跑变 48h', () => {
    expect(windowHours(new Date(2026, 7, 2, 7), new Date(2026, 7, 4, 7))).toBe(48);
  });
  it('保留一位小数', () => {
    expect(windowHours(new Date(2026, 7, 3, 7, 0), new Date(2026, 7, 4, 7, 30))).toBe(24.5);
  });
});

describe('writeSnapshot / readSnapshot', () => {
  it('仓库与人物往返', async () => {
    const dir = tmp();
    const at = new Date(2026, 7, 4, 7);
    const repos = new Map([['a/b', { fullName: 'a/b', stars: 100, forks: 5, owner: 'a', ownerType: 'User' }]]);
    const users = new Map([['karpathy', 214548]]);
    const file = await writeSnapshot(dir, at, { repos, users });
    expect(existsSync(file)).toBe(true);
    const back = await readSnapshot(dir, snapshotName(at));
    expect(back.repos.get('a/b').stars).toBe(100);
    expect(back.users.get('karpathy')).toBe(214548);
    expect(back.at.getHours()).toBe(7);
  });

  it('坏行跳过、好行照读（单条截断不该毁掉整期报告）', async () => {
    const dir = tmp();
    const name = '2026-08-03T07.jsonl.gz';
    const body = '{"t":"repo","fullName":"a/b","stars":1}\n{ 这行是坏的\n{"t":"user","login":"x","followers":9}\n';
    writeFileSync(join(dir, name), gzipSync(Buffer.from(body)));
    const back = await readSnapshot(dir, name);
    expect(back.repos.size).toBe(1);
    expect(back.users.get('x')).toBe(9);
  });

  it('整个文件不是 gzip 时抛错（好让上层退到更早的基线）', async () => {
    const dir = tmp();
    writeFileSync(join(dir, '2026-08-03T07.jsonl.gz'), 'not gzip at all');
    await expect(readSnapshot(dir, '2026-08-03T07.jsonl.gz')).rejects.toThrow();
  });
});

describe('listSnapshots / pruneSnapshots', () => {
  it('按时间升序且过滤杂物', async () => {
    const dir = tmp();
    await writeSnapshot(dir, new Date(2026, 7, 4, 7), { repos: new Map(), users: new Map() });
    await writeSnapshot(dir, new Date(2026, 7, 2, 7), { repos: new Map(), users: new Map() });
    writeFileSync(join(dir, 'config.json'), '{}');
    expect(listSnapshots(dir)).toEqual(['2026-08-02T07.jsonl.gz', '2026-08-04T07.jsonl.gz']);
  });

  it('超期的删掉，期内的留下', async () => {
    const dir = tmp();
    await writeSnapshot(dir, new Date(2026, 6, 1, 7), { repos: new Map(), users: new Map() });
    await writeSnapshot(dir, new Date(2026, 7, 3, 7), { repos: new Map(), users: new Map() });
    const removed = pruneSnapshots(dir, new Date(2026, 7, 4, 7), 10);
    expect(removed).toEqual(['2026-07-01T07.jsonl.gz']);
    expect(readdirSync(dir)).toEqual(['2026-08-03T07.jsonl.gz']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/githubAiDaily.snapshot.test.mjs`
Expected: FAIL —— 无法解析 `snapshot.mjs`

- [ ] **Step 3: 实现 `snapshot.mjs`**

```js
import { readdirSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})\.jsonl\.gz$/;
const pad = (n) => String(n).padStart(2, '0');

export function snapshotName(at) {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}.jsonl.gz`;
}

export function parseSnapshotName(name) {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
}

export function windowHours(from, to) {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}

export function pickBaseline(names, now, minAgeHours) {
  const candidates = names
    .map((name) => ({ name, at: parseSnapshotName(name) }))
    .filter((c) => c.at && windowHours(c.at, now) >= minAgeHours)
    .sort((a, b) => b.at - a.at);
  return candidates[0] ?? null;
}

export function listSnapshots(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names
    .map((name) => ({ name, at: parseSnapshotName(name) }))
    .filter((c) => c.at)
    .sort((a, b) => a.at - b.at)
    .map((c) => c.name);
}

export async function writeSnapshot(dir, at, { repos, users }) {
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const repo of repos.values()) lines.push(JSON.stringify({ t: 'repo', ...repo }));
  for (const [login, followers] of users) lines.push(JSON.stringify({ t: 'user', login, followers }));
  const file = join(dir, snapshotName(at));
  writeFileSync(file, gzipSync(Buffer.from(`${lines.join('\n')}\n`)));
  return file;
}

export async function readSnapshot(dir, name) {
  const raw = gunzipSync(readFileSync(join(dir, name))).toString('utf8');
  const repos = new Map();
  const users = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; } // 坏行跳过：一条截断不该毁掉整期报告
    if (rec.t === 'repo' && rec.fullName) { const { t, ...rest } = rec; repos.set(rec.fullName, rest); }
    else if (rec.t === 'user' && rec.login) users.set(rec.login, rec.followers);
  }
  return { at: parseSnapshotName(name), repos, users };
}

export function pruneSnapshots(dir, now, retainDays) {
  const cutoff = now.getTime() - retainDays * 86_400_000;
  const removed = [];
  for (const name of listSnapshots(dir)) {
    if (parseSnapshotName(name).getTime() < cutoff) { unlinkSync(join(dir, name)); removed.push(name); }
  }
  return removed;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/githubAiDaily.snapshot.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑全量闸门**

Run: `cd desktop && npm test && npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add scripts/github-ai-daily/snapshot.mjs desktop/test/githubAiDaily.snapshot.test.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): 每日快照与基线选取 —— 漏跑一天要能自己降级,而不是出错

GitHub 不给任何历史增量,所以日增只能靠「今天的快照减昨天的快照」。
基线不写死成「昨天那一份」,而是「距今至少 20h 中最新的一份」:昨天漏跑
就自动退到前天,上层据此把窗口标成 48h,而不是静默算出一个 2 倍的日增。

readSnapshot 对坏行跳过、对整个文件解压失败才抛:单条截断不该毁掉整期
报告,而整份坏掉必须让上层能退到更早的基线。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 做差、分层、增速榜、连续在榜天数

**Files:**
- Create: `scripts/github-ai-daily/rank.mjs`
- Test: `desktop/test/githubAiDaily.rank.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `Repo`、Task 3 的 `readSnapshot` 返回的 `Map` 形状
- Produces:
  - `/** @typedef {{repo:Repo, starDelta:number|null, forkDelta:number|null, growth:number|null}} Row */`
  - `diffRepos(current: Map<string,Repo>, baseline: Map<string,Repo>|null): Row[]` —— 基线缺该仓库或基线为 `null` → delta 为 `null`
  - `tierOf(stars: number, tiers: {rising:number, mid:number}): 'rising'|'mid'|'giant'` —— `stars < rising` → rising；`stars < mid` → mid；否则 giant
  - `growthRate(row: Row): number|null` —— `starDelta / max(stars - starDelta, 1)`
  - `topBy(rows: Row[], pick: (r:Row)=>number|null, n: number): Row[]` —— `null` 一律排除；降序；同值按 `fullName` 升序保证确定性
  - `diffFollowers(current: Map<string,number>, baseline: Map<string,number>|null): Array<{login:string, followers:number, delta:number|null}>`
  - `attributeStars(rows: Row[]): Array<{owner:string, ownerType:string, starDelta:number, repos:string[]}>` —— 按 owner 聚合 star 日增
  - `updateStreaks(prev: Record<string,{days:number,lastDate:string}>, rankedFullNames: string[], todayISO: string): Record<string,{days:number,lastDate:string}>` —— 昨天在榜 → `days+1`；断档 >1 天 → 重置为 1；今天没上榜的**保留原记录不动**（供次日判断断档），但满 `retain` 天未上榜的清掉（用 `todayISO` 与 `lastDate` 差值 > 30 天清理）

- [ ] **Step 1: 写失败的测试**

```js
import { describe, it, expect } from 'vitest';
import { diffRepos, tierOf, growthRate, topBy, diffFollowers, attributeStars, updateStreaks }
  from '../../scripts/github-ai-daily/rank.mjs';

const repo = (fullName, stars, forks, over = {}) => ({
  fullName, owner: fullName.split('/')[0], ownerType: 'User', name: fullName.split('/')[1],
  description: '', topics: [], stars, forks, watchers: 0, primaryLanguage: 'Python',
  isFork: false, isArchived: false, pushedAt: '', createdAt: '', ...over,
});

describe('diffRepos', () => {
  it('算出 star 与 fork 日增', () => {
    const cur = new Map([['a/b', repo('a/b', 150, 20)]]);
    const base = new Map([['a/b', repo('a/b', 100, 12)]]);
    const [row] = diffRepos(cur, base);
    expect(row.starDelta).toBe(50);
    expect(row.forkDelta).toBe(8);
  });
  it('基线里没有该仓库 → delta 为 null，不当成 0 也不当成全量', () => {
    const [row] = diffRepos(new Map([['a/b', repo('a/b', 150, 20)]]), new Map());
    expect(row.starDelta).toBe(null);
    expect(row.forkDelta).toBe(null);
  });
  it('完全没有基线（冷启动）→ 全部 null', () => {
    const [row] = diffRepos(new Map([['a/b', repo('a/b', 150, 20)]]), null);
    expect(row.starDelta).toBe(null);
  });
  it('star 变少（被刷星回收）→ 负数照实报，不夹到 0', () => {
    const [row] = diffRepos(new Map([['a/b', repo('a/b', 90, 20)]]), new Map([['a/b', repo('a/b', 100, 20)]]));
    expect(row.starDelta).toBe(-10);
  });
});

describe('tierOf', () => {
  const T = { rising: 3000, mid: 30000 };
  it('边界值归属明确', () => {
    expect(tierOf(2999, T)).toBe('rising');
    expect(tierOf(3000, T)).toBe('mid');
    expect(tierOf(29999, T)).toBe('mid');
    expect(tierOf(30000, T)).toBe('giant');
  });
});

describe('growthRate', () => {
  it('用「涨之前的存量」作分母', () => {
    expect(growthRate({ repo: repo('a/b', 200, 0), starDelta: 100 })).toBeCloseTo(1.0);
  });
  it('新库存量为 0 时不除以零', () => {
    expect(growthRate({ repo: repo('a/b', 50, 0), starDelta: 50 })).toBe(50);
  });
  it('delta 为 null 时返回 null', () => {
    expect(growthRate({ repo: repo('a/b', 50, 0), starDelta: null })).toBe(null);
  });
});

describe('topBy', () => {
  const rows = [
    { repo: repo('a/x', 10, 0), starDelta: 5 },
    { repo: repo('a/y', 10, 0), starDelta: null },
    { repo: repo('a/z', 10, 0), starDelta: 9 },
    { repo: repo('a/w', 10, 0), starDelta: 9 },
  ];
  it('降序、排除 null、取前 N', () => {
    const top = topBy(rows, (r) => r.starDelta, 2);
    expect(top.map((r) => r.repo.fullName)).toEqual(['a/w', 'a/z']); // 同值按 fullName 升序，确定性
  });
  it('N 大于可用条数时不补空', () => {
    expect(topBy(rows, (r) => r.starDelta, 99)).toHaveLength(3);
  });
});

describe('diffFollowers', () => {
  it('算涨粉，基线缺人时为 null', () => {
    const r = diffFollowers(new Map([['a', 100], ['b', 50]]), new Map([['a', 80]]));
    expect(r.find((x) => x.login === 'a').delta).toBe(20);
    expect(r.find((x) => x.login === 'b').delta).toBe(null);
  });
  it('没有基线时全为 null（follower 榜 T+1 才有数据）', () => {
    expect(diffFollowers(new Map([['a', 100]]), null)[0].delta).toBe(null);
  });
});

describe('attributeStars', () => {
  it('按 owner 聚合 star 日增，并列出贡献的仓库', () => {
    const rows = [
      { repo: repo('acme/one', 100, 0), starDelta: 30 },
      { repo: repo('acme/two', 100, 0), starDelta: 20 },
      { repo: repo('other/x', 100, 0), starDelta: 40 },
      { repo: repo('acme/three', 100, 0), starDelta: null },
    ];
    const out = attributeStars(rows);
    expect(out[0]).toMatchObject({ owner: 'acme', starDelta: 50 });
    expect(out[0].repos).toEqual(['acme/one', 'acme/two']);
    expect(out[1]).toMatchObject({ owner: 'other', starDelta: 40 });
  });
});

describe('updateStreaks', () => {
  it('首次上榜记 1 天', () => {
    const s = updateStreaks({}, ['a/b'], '2026-08-04');
    expect(s['a/b']).toEqual({ days: 1, lastDate: '2026-08-04' });
  });
  it('昨天也在榜 → 累加', () => {
    const s = updateStreaks({ 'a/b': { days: 3, lastDate: '2026-08-03' } }, ['a/b'], '2026-08-04');
    expect(s['a/b'].days).toBe(4);
  });
  it('断档超过一天 → 重置为 1（一日游不许攒天数）', () => {
    const s = updateStreaks({ 'a/b': { days: 9, lastDate: '2026-07-20' } }, ['a/b'], '2026-08-04');
    expect(s['a/b'].days).toBe(1);
  });
  it('同一天重复跑不重复累加（幂等）', () => {
    const s = updateStreaks({ 'a/b': { days: 3, lastDate: '2026-08-04' } }, ['a/b'], '2026-08-04');
    expect(s['a/b'].days).toBe(3);
  });
  it('今天没上榜的保留记录（次日才能判断是否断档）', () => {
    const s = updateStreaks({ 'a/b': { days: 3, lastDate: '2026-08-03' } }, [], '2026-08-04');
    expect(s['a/b']).toEqual({ days: 3, lastDate: '2026-08-03' });
  });
  it('30 天以上没上榜的记录被清理，避免文件无限膨胀', () => {
    const s = updateStreaks({ 'a/b': { days: 3, lastDate: '2026-06-01' } }, [], '2026-08-04');
    expect(s['a/b']).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/githubAiDaily.rank.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 `rank.mjs`**

```js
const STREAK_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

export function diffRepos(current, baseline) {
  const rows = [];
  for (const [fullName, repo] of current) {
    const before = baseline?.get(fullName) ?? null;
    const starDelta = before ? repo.stars - before.stars : null;
    const forkDelta = before ? repo.forks - before.forks : null;
    rows.push({ repo, starDelta, forkDelta, growth: null });
  }
  for (const row of rows) row.growth = growthRate(row);
  return rows;
}

export function tierOf(stars, tiers) {
  if (stars < tiers.rising) return 'rising';
  if (stars < tiers.mid) return 'mid';
  return 'giant';
}

export function growthRate(row) {
  if (row.starDelta === null || row.starDelta === undefined) return null;
  return row.starDelta / Math.max(row.repo.stars - row.starDelta, 1);
}

export function topBy(rows, pick, n) {
  return rows
    .filter((r) => pick(r) !== null && pick(r) !== undefined)
    .sort((a, b) => (pick(b) - pick(a)) || a.repo.fullName.localeCompare(b.repo.fullName))
    .slice(0, n);
}

export function diffFollowers(current, baseline) {
  return [...current].map(([login, followers]) => {
    const before = baseline?.get(login);
    return { login, followers, delta: before === undefined ? null : followers - before };
  });
}

export function attributeStars(rows) {
  const byOwner = new Map();
  for (const row of rows) {
    if (row.starDelta === null || row.starDelta <= 0) continue;
    const key = row.repo.owner;
    const acc = byOwner.get(key) ?? { owner: key, ownerType: row.repo.ownerType, starDelta: 0, repos: [] };
    acc.starDelta += row.starDelta;
    acc.repos.push(row.repo.fullName);
    byOwner.set(key, acc);
  }
  return [...byOwner.values()].sort((a, b) => (b.starDelta - a.starDelta) || a.owner.localeCompare(b.owner));
}

const dayDiff = (aISO, bISO) => Math.round((Date.parse(`${aISO}T00:00:00Z`) - Date.parse(`${bISO}T00:00:00Z`)) / DAY_MS);

export function updateStreaks(prev, rankedFullNames, todayISO) {
  const out = {};
  for (const [key, rec] of Object.entries(prev ?? {})) {
    if (dayDiff(todayISO, rec.lastDate) <= STREAK_TTL_DAYS) out[key] = { ...rec };
  }
  for (const key of rankedFullNames) {
    const rec = out[key];
    if (!rec) { out[key] = { days: 1, lastDate: todayISO }; continue; }
    const gap = dayDiff(todayISO, rec.lastDate);
    if (gap === 0) continue;                                  // 同日复跑：幂等
    out[key] = { days: gap === 1 ? rec.days + 1 : 1, lastDate: todayISO };
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/githubAiDaily.rank.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑全量闸门**

Run: `cd desktop && npm test && npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add scripts/github-ai-daily/rank.mjs desktop/test/githubAiDaily.rank.test.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): 分层排名 + 增速榜 + 连续在榜天数

单一总榜会被少数超大仓库和当天上 HN 的爆款长期占满,新秀被绝对值压死。
所以按存量切三层(新星/中坚/巨头)各出 Top N,外加一张增速榜(日增÷涨之
前的存量)专抓黑马 —— 分母用「涨之前」而不是「现在」,否则新库的增速会
被自己的涨幅稀释。

「基线里没有」与「日增为 0」严格区分成 null 和 0:前者是我们不知道,后者
是确实没涨。star 变少照实报负数,不夹到 0(那是刷星被回收的信号)。

连续在榜天数断档超一天就重置,不然一日游能攒出假趋势。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 报告渲染

**Files:**
- Create: `scripts/github-ai-daily/report.mjs`
- Test: `desktop/test/githubAiDaily.report.test.mjs`

**Interfaces:**
- Consumes: Task 4 的 `Row`、`attributeStars`、`diffFollowers` 输出
- Produces:
  - 报告模型（`index.mjs` 组装、`report.mjs` 消费，**后续任务必须照这个形状**）：
    ```js
    /** @typedef {{
     *   window: { from: string|null, to: string, hours: number|null, degraded: boolean, note: string|null },
     *   pool: { repos: number, users: number },
     *   cost: { graphqlPoints: number, searchRequests: number, restRequests: number },
     *   failures: { repos: number, users: number, notes: string[] },
     *   stars: { rising: Row[], mid: Row[], giant: Row[], growth: Row[] },
     *   forks: Row[],
     *   people: { followers: Array<{login,followers,delta}>|null, attribution: Array<{owner,starDelta,repos}> },
     *   newRepos: Row[],
     *   watchlist: Array<{fullName:string, kind:'release'|'new-repo'|'surge', detail:string}>,
     *   knowledge: Row[],
     *   streaks: Record<string, {days:number,lastDate:string}>
     * }} ReportModel */
    ```
  - `renderMarkdown(model: ReportModel): string`
  - `renderJson(model: ReportModel): string` —— `JSON.stringify(model, null, 2)` + 结尾换行

- [ ] **Step 1: 写失败的测试**

```js
import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderJson } from '../../scripts/github-ai-daily/report.mjs';

const row = (fullName, stars, starDelta, over = {}) => ({
  repo: { fullName, owner: fullName.split('/')[0], ownerType: 'User', name: fullName.split('/')[1],
          description: 'desc of ' + fullName, topics: ['ai-agent'], stars, forks: 10, watchers: 0,
          primaryLanguage: 'Python', isFork: false, isArchived: false, pushedAt: '', createdAt: '' },
  starDelta, forkDelta: 3, growth: starDelta === null ? null : starDelta / Math.max(stars - starDelta, 1),
  ...over,
});

const MODEL = {
  window: { from: '2026-08-03T07:00', to: '2026-08-04T07:00', hours: 24, degraded: false, note: null },
  pool: { repos: 2100, users: 1400 },
  cost: { graphqlPoints: 38, searchRequests: 74, restRequests: 50 },
  failures: { repos: 0, users: 0, notes: [] },
  stars: { rising: [row('new/star', 900, 210)], mid: [row('mid/thing', 8000, 300)],
           giant: [row('big/one', 90000, 700)], growth: [row('new/star', 900, 210)] },
  forks: [row('forked/hard', 5000, 40)],
  people: { followers: [{ login: 'karpathy', followers: 214548, delta: 320 }],
            attribution: [{ owner: 'acme', starDelta: 510, repos: ['acme/one', 'acme/two'] }] },
  newRepos: [row('brand/new', 60, null)],
  watchlist: [{ fullName: 'anthropics/thing', kind: 'release', detail: 'v2.0.0 发布' }],
  knowledge: [row('awesome/list', 4000, 120)],
  streaks: { 'new/star': { days: 3, lastDate: '2026-08-04' } },
};

describe('renderMarkdown', () => {
  it('头部写明窗口与池子规模', () => {
    const md = renderMarkdown(MODEL);
    expect(md).toContain('2026-08-03T07:00');
    expect(md).toContain('24');
    expect(md).toContain('2100');
  });
  it('三层与增速榜各自成节', () => {
    const md = renderMarkdown(MODEL);
    for (const s of ['新星', '中坚', '巨头', '增速']) expect(md).toContain(s);
    expect(md).toContain('new/star');
    expect(md).toContain('big/one');
  });
  it('连续在榜天数出现在对应条目上', () => {
    expect(renderMarkdown(MODEL)).toMatch(/new\/star[\s\S]{0,200}第 3 天/);
  });
  it('窗口异常时显式标注，不静默', () => {
    const md = renderMarkdown({ ...MODEL,
      window: { ...MODEL.window, hours: 48, degraded: true, note: '昨日漏跑,本期窗口为 48 小时' } });
    expect(md).toContain('48');
    expect(md).toContain('漏跑');
  });
  it('冷启动时 follower 榜明写 T+1，不假装有数据', () => {
    const md = renderMarkdown({ ...MODEL, people: { ...MODEL.people, followers: null } });
    expect(md).toContain('T+1');
    expect(md).not.toContain('karpathy');
  });
  it('各榜为空时给出空态文案而不是渲染空表格', () => {
    const md = renderMarkdown({ ...MODEL,
      stars: { rising: [], mid: [], giant: [], growth: [] }, forks: [], newRepos: [],
      watchlist: [], knowledge: [] });
    expect(md).toContain('本期无');
    expect(md).not.toMatch(/\|\s*\|\s*\|/);
  });
  it('失败计数不为零时报告尾部列出来', () => {
    const md = renderMarkdown({ ...MODEL,
      failures: { repos: 12, users: 3, notes: ['Trending 兜底不可用'] } });
    expect(md).toContain('12');
    expect(md).toContain('Trending 兜底不可用');
  });
  it('取数成本写进报告（好判断额度够不够）', () => {
    expect(renderMarkdown(MODEL)).toContain('38');
  });
  it('绝不含任何投递渠道字样', () => {
    const md = renderMarkdown(MODEL);
    for (const w of ['飞书', 'QQ', 'webhook', 'feishu']) expect(md).not.toContain(w);
  });
});

describe('renderJson', () => {
  it('可被解析回来且保留结构', () => {
    const back = JSON.parse(renderJson(MODEL));
    expect(back.stars.rising[0].repo.fullName).toBe('new/star');
    expect(back.window.hours).toBe(24);
  });
  it('以换行结尾', () => { expect(renderJson(MODEL).endsWith('\n')).toBe(true); });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/githubAiDaily.report.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 `report.mjs`**

要点（实现细节自由，但必须满足上面全部断言）：

- 头部一段：窗口 `from → to`、`hours` 小时、`degraded` 为真时把 `note` 用 `> ⚠` 引用块显式打出、池子规模、取数成本、失败计数。
- 每张榜一个 `###` 小节，节标题含「新星 / 中坚 / 巨头 / 增速 / fork / 涨粉 / star 归因 / 首日开源 / 关注名单 / 知识类」字样。
- 条目行格式：`1. **[owner/name](https://github.com/owner/name)** +210 ⭐（900 → 存量）· 🔥第 3 天在榜 · Python`，下一行缩进两格写简介（截断到 120 字符）。
- `starDelta` 为 `null` 时写 `新入池，暂无日增`。
- 空榜写 `_本期无_`。
- `people.followers === null` 时整节写 `_follower 日增需要前一日快照，**T+1 起可用**_`。
- 结尾附 `failures.notes` 列表（有才写）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/githubAiDaily.report.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑全量闸门**

Run: `cd desktop && npm test && npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add scripts/github-ai-daily/report.mjs desktop/test/githubAiDaily.report.test.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): 报告渲染 —— 数据缺失一律写明,不许拿空表格糊过去

三条硬规矩写进了断言:窗口异常必须在头部显式标注(漏跑导致的 48h 不能
装成 24h);冷启动时 follower 榜写「T+1 起可用」而不是渲染 0;空榜写空态
文案而不是渲染一张空表。取数成本也进报告,好判断额度还够不够。

另有一条断言专门守 spec D8:报告里不得出现任何投递渠道字样,投递归
automation 的 deliverTo,脚本不该知道飞书/QQ 的存在。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: GitHub 客户端（网络层）

**Files:**
- Create: `scripts/github-ai-daily/github.mjs`
- Test: `desktop/test/githubAiDaily.github.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `Repo` 形状（`batchRepoSnapshots` 必须产出这个形状）
- Produces:
  - `class TokenError extends Error`
  - `resolveToken({ env, runGhAuth }): string` —— 顺序：`env.GITHUB_TOKEN` → `env.GH_TOKEN` → `runGhAuth()`；全空抛 `TokenError`。**返回值绝不进日志**
  - `parseTrendingHtml(html: string): Array<{ fullName: string, starsToday: number }>`
  - `parseRateLimitReset(headers: Headers|Map, now: Date): number` —— 返回应等待的毫秒数（下限 1000、上限 60000）
  - `class GitHubClient` —— 构造 `{ token, fetchImpl = globalThis.fetch, sleep = (ms)=>new Promise(r=>setTimeout(r,ms)), now = () => new Date(), log = () => {} }`
    - `graphql(query, variables): Promise<object>` —— 命中 `RATE_LIMITED` / 403 / 5xx 时按 `parseRateLimitReset` 退避，最多重试 3 次；累加 `this.cost.graphqlPoints`
    - `searchRepos(q, { maxPages = 3 }): Promise<Repo[]>` —— 每次请求前 `await sleep(2100)`（30 req/min 硬限）；累加 `this.cost.searchRequests`
    - `batchRepoSnapshots(fullNames): Promise<{ repos: Map<string,Repo>, failures: string[] }>` —— 100 个一批的 alias 查询
    - `batchUserFollowers(logins): Promise<{ users: Map<string,number>, failures: string[] }>`
    - `forksSince(fullName, sinceISO, cap = 500): Promise<number>` —— `?sort=newest` 翻页累计
    - `contributors(fullName, top): Promise<string[]>`
    - `trendingRepos(languages): Promise<Array<{fullName, starsToday}>>`
    - `cost: { graphqlPoints, searchRequests, restRequests }`

- [ ] **Step 1: 写失败的测试**

```js
import { describe, it, expect, vi } from 'vitest';
import { resolveToken, TokenError, parseTrendingHtml, parseRateLimitReset, GitHubClient }
  from '../../scripts/github-ai-daily/github.mjs';

const FAKE = 'ghp_FAKE_FOR_TEST';
const jsonRes = (body, status = 200, headers = {}) => ({
  ok: status < 400, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body),
});

describe('resolveToken', () => {
  it('优先用 GITHUB_TOKEN', () => {
    expect(resolveToken({ env: { GITHUB_TOKEN: FAKE }, runGhAuth: () => 'never' })).toBe(FAKE);
  });
  it('回落 gh auth token', () => {
    expect(resolveToken({ env: {}, runGhAuth: () => `${FAKE}\n` })).toBe(FAKE);
  });
  it('两条路都没有 → TokenError，且提示怎么修', () => {
    let err; try { resolveToken({ env: {}, runGhAuth: () => { throw new Error('gh not found'); } }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TokenError);
    expect(err.message).toContain('gh auth login');
  });
  it('错误信息里不含 token 值', () => {
    let err; try { resolveToken({ env: { GITHUB_TOKEN: '   ' }, runGhAuth: () => '' }); } catch (e) { err = e; }
    expect(err.message).not.toContain('ghp_');
  });
});

describe('parseTrendingHtml', () => {
  const HTML = `
    <article class="Box-row">
      <h2 class="h3 lh-condensed"><a href="/acme/agent-thing">acme / agent-thing</a></h2>
      <span class="d-inline-block float-sm-right">1,085 stars today</span>
    </article>
    <article class="Box-row">
      <h2 class="h3 lh-condensed"><a href="/other/tool">other / tool</a></h2>
      <span class="d-inline-block float-sm-right">42 stars today</span>
    </article>`;
  it('抽出仓库名与今日星数（含千分位）', () => {
    expect(parseTrendingHtml(HTML)).toEqual([
      { fullName: 'acme/agent-thing', starsToday: 1085 },
      { fullName: 'other/tool', starsToday: 42 },
    ]);
  });
  it('GitHub 改版导致抓不到时返回空数组，不抛（兜底路径不该拖垮主链路）', () => {
    expect(parseTrendingHtml('<html>redesigned</html>')).toEqual([]);
  });
});

describe('parseRateLimitReset', () => {
  const NOW = new Date('2026-08-04T07:00:00Z');
  it('按 x-ratelimit-reset 算出等待毫秒', () => {
    const reset = String(Math.floor(NOW.getTime() / 1000) + 5);
    expect(parseRateLimitReset(new Headers({ 'x-ratelimit-reset': reset }), NOW)).toBe(5000);
  });
  it('没有该头时给下限 1s', () => {
    expect(parseRateLimitReset(new Headers({}), NOW)).toBe(1000);
  });
  it('封顶 60s，免得挂死整次运行', () => {
    const reset = String(Math.floor(NOW.getTime() / 1000) + 99999);
    expect(parseRateLimitReset(new Headers({ 'x-ratelimit-reset': reset }), NOW)).toBe(60000);
  });
});

describe('GitHubClient.graphql', () => {
  it('累加 rateLimit.cost', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ data: { rateLimit: { cost: 1 }, a: { stargazerCount: 5 } } }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    await c.graphql('query{}', {});
    expect(c.cost.graphqlPoints).toBe(1);
  });
  it('限流后退避重试并最终成功', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ errors: [{ type: 'RATE_LIMITED' }] }, 200, { 'x-ratelimit-reset': '0' }))
      .mockResolvedValueOnce(jsonRes({ data: { rateLimit: { cost: 1 }, ok: true } }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep });
    const data = await c.graphql('query{}', {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalled();
    expect(data.ok).toBe(true);
  });
  it('重试用尽后抛错', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ errors: [{ type: 'RATE_LIMITED' }] }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    await expect(c.graphql('query{}', {})).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 首次 + 3 次重试
  });
  it('请求头带 Bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ data: { rateLimit: { cost: 1 } } }));
    await new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} }).graphql('query{}', {});
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${FAKE}`);
  });
});

describe('GitHubClient.batchRepoSnapshots', () => {
  it('100 个一批，并归一化成 Repo 形状', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `acme/r${i}`);
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const aliases = [...body.query.matchAll(/(r\d+):\s*repository/g)].map((m) => m[1]);
      const data = { rateLimit: { cost: 1 } };
      for (const a of aliases) {
        data[a] = { nameWithOwner: `acme/${a}`, owner: { login: 'acme', __typename: 'Organization' },
          name: a, description: 'd', stargazerCount: 10, forkCount: 2, watchers: { totalCount: 1 },
          primaryLanguage: { name: 'Python' }, isFork: false, isArchived: false,
          pushedAt: '2026-08-03T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
          repositoryTopics: { nodes: [{ topic: { name: 'ai-agent' } }] } };
      }
      return jsonRes({ data });
    });
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    const { repos, failures } = await c.batchRepoSnapshots(names);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 100 + 50
    expect(repos.size).toBe(150);
    expect(repos.get('acme/r0')).toMatchObject({
      fullName: 'acme/r0', owner: 'acme', ownerType: 'Organization',
      stars: 10, forks: 2, primaryLanguage: 'Python', topics: ['ai-agent'],
    });
    expect(failures).toEqual([]);
  });

  it('单个 alias 返回 null（仓库被删/改名）时记入 failures，其余照常返回', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ data: { rateLimit: { cost: 1 },
      r0: null,
      r1: { nameWithOwner: 'acme/r1', owner: { login: 'acme', __typename: 'User' }, name: 'r1',
            description: null, stargazerCount: 1, forkCount: 0, watchers: { totalCount: 0 },
            primaryLanguage: null, isFork: false, isArchived: false,
            pushedAt: '', createdAt: '', repositoryTopics: { nodes: [] } } } }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    const { repos, failures } = await c.batchRepoSnapshots(['acme/r0', 'acme/r1']);
    expect(repos.size).toBe(1);
    expect(failures).toEqual(['acme/r0']);
  });
});

describe('GitHubClient.forksSince', () => {
  it('数出窗口内新建的 fork 数（零冷启动的精确回溯）', async () => {
    const page1 = [
      { created_at: '2026-08-04T05:00:00Z' }, { created_at: '2026-08-04T01:00:00Z' },
      { created_at: '2026-08-03T20:00:00Z' },
    ];
    const page2 = [{ created_at: '2026-08-03T06:00:00Z' }, { created_at: '2026-08-01T00:00:00Z' }];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes(page1)).mockResolvedValueOnce(jsonRes(page2));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    expect(await c.forksSince('a/b', '2026-08-03T07:00:00Z')).toBe(3);
  });
  it('cap 生效，超大仓库不会翻到天荒地老', async () => {
    const full = Array.from({ length: 100 }, () => ({ created_at: '2026-08-04T05:00:00Z' }));
    const fetchImpl = vi.fn(async () => jsonRes(full));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    expect(await c.forksSince('a/b', '2026-08-03T07:00:00Z', 250)).toBe(250);
  });
});

describe('GitHubClient.searchRepos', () => {
  it('每次请求前节流 ≥2.1s（search 硬限 30/min）', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => jsonRes({ items: [], total_count: 0 }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep });
    await c.searchRepos('topic:mcp', { maxPages: 2 });
    expect(sleep.mock.calls.every(([ms]) => ms >= 2100)).toBe(true);
    expect(c.cost.searchRequests).toBeGreaterThan(0);
  });
  it('拿到空页就停，不硬翻满 maxPages', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ items: [], total_count: 0 }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    await c.searchRepos('topic:mcp', { maxPages: 10 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/githubAiDaily.github.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 `github.mjs`**

关键实现约束：

- `resolveToken` 用注入的 `runGhAuth`（默认实现 `execFileSync('gh', ['auth','token'], {encoding:'utf8'})`）。trim 后为空视为无。
- GraphQL 端点 `https://api.github.com/graphql`，REST `https://api.github.com`，Trending `https://github.com/trending{/lang}?since=daily`。
- 批量查询的 alias 用 `r0..r99` / `u0..u99`（**不能**用仓库名派生，`-`/`.` 不是合法 GraphQL alias 字符）。仓库名走 GraphQL 变量。
- `batchRepoSnapshots` 每批查询体：
  ```graphql
  query($o0:String!,$n0:String!, ...) {
    rateLimit{cost}
    r0: repository(owner:$o0, name:$n0) { nameWithOwner owner{login __typename} name description
      stargazerCount forkCount watchers{totalCount} primaryLanguage{name} isFork isArchived
      pushedAt createdAt repositoryTopics(first:20){nodes{topic{name}}} }
  }
  ```
- 归一化：`stars←stargazerCount`、`forks←forkCount`、`watchers←watchers.totalCount`、`primaryLanguage←primaryLanguage?.name ?? null`、`topics←repositoryTopics.nodes.map(n=>n.topic.name)`、`ownerType←owner.__typename`、`fullName←nameWithOwner`。
- `searchRepos` 用 `/search/repositories?q=&sort=stars&order=desc&per_page=100&page=N`，REST 结果也归一化到同一个 `Repo` 形状（`full_name`/`stargazers_count`/`forks_count`/`language`/`topics`/`owner.type`）。
- **`sleep` 必须在真正 fetch 之前调用**，否则测试里的节流断言过不了，线上也会瞬间打爆 30/min。
- `forksSince` 的返回值必须 **`Math.min(count, cap)`**：每页 100 条、cap 是 250 时，翻到第三页会累计到 300，直接返回就超了 cap。翻页终止条件是「本页出现早于 `sinceISO` 的记录」或「累计已达 cap」或「本页为空」，三者任一。
- `trendingRepos` 抓 HTML 失败（非 2xx 或抛异常）→ 返回 `[]` 并把说明 push 到 `this.notes`，**不抛**。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/githubAiDaily.github.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑全量闸门**

Run: `cd desktop && npm test && npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add scripts/github-ai-daily/github.mjs desktop/test/githubAiDaily.github.test.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): GitHub 客户端 —— GraphQL 批量把取数成本压到每天 40 point

实测多 alias 批查一次只花 1 point(额度 5000/h),所以盯 2000+ 仓库和
1500 人每天只烧 ~40 point;REST 逐个查会是几千次请求。alias 用 r0..r99
而不是仓库名派生,因为 - 和 . 不是合法 GraphQL alias 字符。

search API 硬限 30 req/min,节流刻意放在 fetch 之前而不是之后 —— 放在
之后第一波就会打爆。

forksSince 是唯一零冷启动的精确回溯:forks?sort=newest 带 created_at,
翻页数到窗口外为止(带 cap,超大仓库不许翻到天荒地老)。

Trending 抓 HTML 失败一律返回空数组并记 note,不抛:它只是兜底路径,
GitHub 改版不该拖垮主链路。所有网络入口都吃注入的 fetchImpl,所以这
一层也有单测,不发真实请求。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 候选池发现与增量维护

**Files:**
- Create: `scripts/github-ai-daily/discover.mjs`
- Test: `desktop/test/githubAiDaily.discover.test.mjs`

**Interfaces:**
- Consumes: Task 1 config、Task 2 `classify`、Task 6 `GitHubClient`
- Produces:
  - `buildQueries(config, { todayISO }): string[]` —— topic 查询 + 关键词查询，均带 `stars:>=minStars` 与 `pushed:>=<today-activeWithinDays>`
  - `buildNewRepoQueries(config, { sinceISO }): string[]` —— 带 `created:>=sinceISO` 与 `stars:>=newRepoMinStars`
  - `mergePool(pool, found, todayISO, config): { pool, added: string[], dropped: string[] }` —— **纯函数**。`pool` 形如 `{ [fullName]: { firstSeen, lastActive } }`；`found` 是 `Repo[]`；超过 `activeWithinDays` 未活跃的踢出
  - `discover(client, config, pool, todayISO): Promise<{ pool, added, dropped, aiRepos: Repo[], knowledgeRepos: Repo[], notes: string[] }>` —— `notes` 收集单条查询的失败说明（见下方 Step 3 约束）
  - `discoverNewRepos(client, config, sinceISO): Promise<{ repos: Repo[], notes: string[] }>` —— 必须和 `discover` 一样把失败说明带出来。返回裸 `Repo[]` 会让「全部查询失败」和「昨天确实没有新库」变得无法区分，而 spec §8 要求失败计数进报告尾部、Task 5 的 `ReportModel` 也已有 `failures.notes` 位置接它

- [ ] **Step 1: 写失败的测试**

```js
import { describe, it, expect, vi } from 'vitest';
import { buildQueries, buildNewRepoQueries, mergePool, discover }
  from '../../scripts/github-ai-daily/discover.mjs';

const CONFIG = {
  topics: { agent: ['ai-agent', 'agentic'], spec: ['mcp'] },
  keywords: { include: ['agent', 'LLM'], exclude: [] },
  knowledgeRepoHints: ['awesome'],
  minStars: 100, newRepoMinStars: 5, activeWithinDays: 90,
};
const repo = (fullName, over = {}) => ({
  fullName, owner: fullName.split('/')[0], ownerType: 'User', name: fullName.split('/')[1],
  description: '', topics: ['ai-agent'], stars: 500, forks: 1, watchers: 0,
  primaryLanguage: 'Python', isFork: false, isArchived: false,
  pushedAt: '2026-08-03T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', ...over,
});

describe('buildQueries', () => {
  it('每个 topic 一条查询，带上 star 与活跃度限定', () => {
    const qs = buildQueries(CONFIG, { todayISO: '2026-08-04' });
    expect(qs).toContain('topic:ai-agent stars:>=100 pushed:>=2026-05-06');
    expect(qs.filter((q) => q.startsWith('topic:'))).toHaveLength(3);
  });
  it('关键词查询限定在名称与简介，不误召回全文', () => {
    const qs = buildQueries(CONFIG, { todayISO: '2026-08-04' });
    expect(qs.some((q) => q.includes('agent in:name,description'))).toBe(true);
  });
  it('配置为空时不产出裸查询（否则等于拉全站）', () => {
    expect(buildQueries({ topics: {}, keywords: {}, minStars: 100, activeWithinDays: 90 },
      { todayISO: '2026-08-04' })).toEqual([]);
  });
});

describe('buildNewRepoQueries', () => {
  it('用 newRepoMinStars 而不是 minStars —— 新库绝对值必然低', () => {
    const qs = buildNewRepoQueries(CONFIG, { sinceISO: '2026-08-03' });
    expect(qs[0]).toContain('created:>=2026-08-03');
    expect(qs[0]).toContain('stars:>=5');
    expect(qs.some((q) => q.includes('stars:>=100'))).toBe(false);
  });
});

describe('mergePool', () => {
  it('新仓库入池并记 firstSeen', () => {
    const { pool, added } = mergePool({}, [repo('a/b')], '2026-08-04', CONFIG);
    expect(added).toEqual(['a/b']);
    expect(pool['a/b'].firstSeen).toBe('2026-08-04');
  });
  it('已在池中的仓库保留原 firstSeen，只更新 lastActive', () => {
    const prev = { 'a/b': { firstSeen: '2026-01-01', lastActive: '2026-07-01' } };
    const { pool, added } = mergePool(prev, [repo('a/b')], '2026-08-04', CONFIG);
    expect(added).toEqual([]);
    expect(pool['a/b'].firstSeen).toBe('2026-01-01');
    expect(pool['a/b'].lastActive).toBe('2026-08-04');
  });
  it('超过 activeWithinDays 没再出现的踢出池子', () => {
    const prev = { 'stale/one': { firstSeen: '2025-01-01', lastActive: '2026-01-01' } };
    const { pool, dropped } = mergePool(prev, [], '2026-08-04', CONFIG);
    expect(dropped).toEqual(['stale/one']);
    expect(pool['stale/one']).toBeUndefined();
  });
  it('不改动入参', () => {
    const prev = { 'a/b': { firstSeen: '2026-01-01', lastActive: '2026-08-01' } };
    mergePool(prev, [repo('a/b')], '2026-08-04', CONFIG);
    expect(prev['a/b'].lastActive).toBe('2026-08-01');
  });
});

describe('discover', () => {
  it('按 classify 结果把 AI 仓库与知识类分开，剔除的不进池', async () => {
    const client = { searchRepos: vi.fn(async (q) => {
      if (q.startsWith('topic:ai-agent')) return [repo('good/agent'), repo('awesome/list', { name: 'awesome-list' })];
      if (q.startsWith('topic:agentic')) return [repo('bad/fork', { isFork: true })];
      return [];
    }) };
    const r = await discover(client, CONFIG, {}, '2026-08-04');
    expect(r.aiRepos.map((x) => x.fullName)).toEqual(['good/agent']);
    expect(r.knowledgeRepos.map((x) => x.fullName)).toEqual(['awesome/list']);
    expect(Object.keys(r.pool).sort()).toEqual(['awesome/list', 'good/agent']);
  });
  it('同一仓库被多条查询召回时只算一次', async () => {
    const client = { searchRepos: vi.fn(async () => [repo('dup/one')]) };
    const r = await discover(client, CONFIG, {}, '2026-08-04');
    expect(r.aiRepos).toHaveLength(1);
  });
  it('单条查询失败不影响其余查询（一个 topic 挂了不该毁掉整次发现）', async () => {
    const client = { searchRepos: vi.fn(async (q) => {
      if (q.startsWith('topic:mcp')) throw new Error('boom');
      return [repo('ok/one')];
    }) };
    const r = await discover(client, CONFIG, {}, '2026-08-04');
    expect(r.aiRepos.length).toBeGreaterThan(0);
    expect(r.notes.some((n) => n.includes('topic:mcp'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/githubAiDaily.discover.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 `discover.mjs`**

要点：

- 日期算术只用注入的 `todayISO`（形如 `2026-08-04`）做 UTC 天数加减，**不许调 `new Date()`**。
- `buildQueries`：`topic:<t> stars:>=<minStars> pushed:>=<cutoff>`；关键词版 `<k> in:name,description stars:>=<minStars> pushed:>=<cutoff>`。topics 与 include 都为空 → 返回 `[]`。
- `discover` 用 `classify()` 分流：`kind==='ai'` 进 `aiRepos`，`kind==='knowledge'` 进 `knowledgeRepos`，其余丢弃；两类都入池（知识类也要跟踪日增才能出知识栏）。
- 每条查询包一层 `try/catch`，失败把 `查询失败：<q> —— <err.message>` push 进 `notes` 后继续。返回值含 `notes: string[]`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/githubAiDaily.discover.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑全量闸门**

Run: `cd desktop && npm test && npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add scripts/github-ai-daily/discover.mjs desktop/test/githubAiDaily.discover.test.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): 候选池增量维护 —— 池子是攒出来的,不是每天重建的

topic 与关键词双路召回,都带 stars 与 pushed 限定;配置里两者都空时返回
空查询列表而不是裸查询,否则等于拉全站。池子记 firstSeen/lastActive,
连续 activeWithinDays 没再被召回才踢出 —— 每天重建会让「连续在榜」和
「新入池」这两个信号失去意义。

单条查询失败只记 note 不中断:一个 topic 挂了不该毁掉整次发现。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 编排入口与真机眼验

**Files:**
- Create: `scripts/github-ai-daily/index.mjs`
- Test: 无单测（编排层全是 IO；靠真机跑通眼验，见 Step 3–6）

**Interfaces:**
- Consumes: Task 1–7 全部导出
- Produces: CLI。退出码 `0` 成功 / `1` 配置错误 / `2` token 错误 / `3` 网络整体失败。支持 `--dry-run`（只发现与快照，不写报告）、`--data-dir <path>`（测试与排障用）

- [ ] **Step 1: 写 `index.mjs`**

编排顺序（严格照 spec §4）：

1. 解析参数 → `loadConfig()`；`createdFromTemplate` 为真时在 stdout 提示配置文件位置。配置错误 → 退出码 1。
2. `resolveToken()` → 失败退出码 2。构造 `GitHubClient`。
3. `discover()` 更新池子 → 写回 `pool.json`。
4. `discoverNewRepos()` 拿首日新库。
5. `batchRepoSnapshots(池内全部 + 新库)`。
6. 人物池：池内 `ownerType==='User'` 的 owner 去重；`contributorPoolTopRepos > 0` 时对上一期 star 日增前 N 个仓库调 `contributors()` 扩充 → `batchUserFollowers()`。
7. `writeSnapshot()` 落本期快照。
8. `pickBaseline(listSnapshots(dir), now, config.baselineMinAgeHours)`：
   - 有基线 → `readSnapshot()`；解压抛错则退到更早一份（最多退 3 次），并把说明记进 `failures.notes`。
   - 无基线 → 冷启动：`trendingRepos()` 的 `starsToday` 作为 star 日增填入（只覆盖交叉命中的仓库）；对 star 榜候选前 30 个调 `forksSince()` 得精确 fork 日增；`people.followers = null`。
   - 窗口 `hours !== 24 ±1` 时 `degraded: true` 并写 note（例：`昨日漏跑，本期窗口为 48 小时`）。
9. `diffRepos` / `diffFollowers` / `attributeStars` → 按 `tierOf` 分层 → `topBy` 取 Top N → 关注名单查询 → `updateStreaks()` 写回 `streaks.json`。
10. `renderMarkdown` / `renderJson` → 写 `<data-dir>/YYYY-MM-DD.md` 与 `.json` → `pruneSnapshots()`。
11. stdout 打印报告文件绝对路径（automation 的 prompt 靠这一行找到报告）。
12. 顶层 `try/catch`：网络整体失败 → stderr 写明原因 + 退出码 3。**绝不在失败时写出一份空报告。**

- [ ] **Step 2: 语法与导入自检**

Run: `node --check scripts/github-ai-daily/index.mjs`
Expected: 无输出

- [ ] **Step 3: 冷启动真机跑（第一次，无基线）**

Run: `node scripts/github-ai-daily/index.mjs --data-dir /tmp/ghai-verify`
Expected: 退出码 0；`/tmp/ghai-verify/` 下出现 `config.json`、`pool.json`、`snapshots/*.jsonl.gz`、`YYYY-MM-DD.md`、`.json`；报告里 follower 节写着「T+1 起可用」；stdout 最后一行是报告绝对路径。
**人工看：** 池子规模是否落在 1000–5000（太小说明查询构造有问题，太大说明过滤失效）；star 榜里有没有明显不属于 AI 的仓库；知识类栏是否真的把 awesome 类挑走了。

- [ ] **Step 4: 记录真实成本**

Run: `gh api rate_limit --jq '.resources.graphql, .resources.search, .resources.core'`
Expected: GraphQL 消耗 < 100 point。若显著超出，说明批量没生效（检查是不是退化成逐个查）。

- [ ] **Step 5: 伪造基线，验 T+1 路径**

伪造一份 25 小时前的快照（把刚生成的快照复制成前一天的名字并改几个 star 数），重跑：

```bash
cp /tmp/ghai-verify/snapshots/$(ls /tmp/ghai-verify/snapshots | tail -1) \
   /tmp/ghai-verify/snapshots/$(date -v-1d +%Y-%m-%dT%H).jsonl.gz
node scripts/github-ai-daily/index.mjs --data-dir /tmp/ghai-verify
```

Expected: 报告头部窗口约 24h、`degraded` 为假；star/fork 日增有数字；follower 节不再是「T+1」。

- [ ] **Step 6: 验退化路径**

删掉基线只留一份 50 小时前的快照后重跑 → 报告头部必须显式写「窗口 48 小时」之类的 note。
再把 `config.json` 改成非法 JSON（如末尾多一个逗号）重跑 → 退出码 1 且 stderr 指明文件路径。
Expected: 两条都符合，且**都没有产出报告文件**。

- [ ] **Step 7: 清理并跑全量闸门**

Run: `rm -rf /tmp/ghai-verify && cd desktop && npm test && npm run typecheck`
Expected: 全绿。**确认 `~/.wraith/reports/` 下没有被这次验证写入任何东西**（`ls ~/.wraith/reports/ 2>/dev/null`）。

- [ ] **Step 8: 提交**

```bash
git add scripts/github-ai-daily/index.mjs
git commit -m "$(cat <<'EOF'
feat(ghai): 编排入口 —— 失败就退非零码,绝不产出一份空报告

冷启动那天没有基线可比,于是退化用 Trending 页的 stars today 交叉命中,
外加对 star 榜候选做 forksSince 精确回溯;follower 榜老实写「T+1 起可
用」。窗口不是 24h(漏跑)时在报告头部显式标注,不静默算出翻倍的日增。

退出码分开:1 配置错、2 token 错、3 网络整体失败。定时任务据此把失败显
示成失败,而不是每天投一份看着正常的空报告。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 接进 wraith 定时任务 + runbook

**Files:**
- Create: `docs/runbooks/github-ai-daily.md`
- 手动操作：桌面 App「自动化」面板新建任务（**不手改 `~/.wraith/automations.json`**，避免与 daemon 的写入打架）

**Interfaces:**
- Consumes: Task 8 的 CLI 与退出码
- Produces: 一条可运行的 automation + 一份排障文档

- [ ] **Step 1: 写 runbook**

`docs/runbooks/github-ai-daily.md` 必须覆盖：

- **怎么改口径**：`~/.wraith/reports/github-ai-daily/config.json` 各字段含义；加一个 topic / 加一个关注对象 / 调 Top N 的具体例子；改完下次运行生效，不用重启任何东西。
- **定时任务配置**（照 spec §10 逐字给出）：
  ```
  name:      GitHub AI 日报
  schedule:  daily 07:00
  workspace: /Users/aa00945/Desktop/wraith
  approval:  default DENY，仅 execute_command 设 ALLOW
  deliverTo: 面板里勾选（飞书 / QQ / 桌面，随时改）
  prompt:    跑 `node scripts/github-ai-daily/index.mjs`，读它输出的最后一行路径指向的
             Markdown 报告，用中文点评每张榜的 Top 3（为什么火、值不值得跟），输出全文。
  ```
- **为什么 approval 必须只放行 `execute_command`**：`ApprovalPolicy.resolve()` 默认返回 `DENY`（`src/main/java/com/lyhn/wraith/automation/ApprovalPolicy.java:16`），无人值守的任务只该放行它真正需要的那一个工具。
- **排障表**：退出码 1/2/3 各自的含义与修法；报告里出现「窗口 48 小时」是什么意思；follower 榜一直空白怎么查（人物池是不是空的）；`gh auth status` 掉了怎么办；磁盘占用与 `snapshotRetainDays`。
- **已知限制**照抄 spec §11（窗口不是日历日、池外爆款会漏、Trending 是 HTML 抓取随时可能失效）。

- [ ] **Step 2: 在桌面面板建任务并「立即运行」一次**

打开桌面 App →「自动化」→ 新建，按 Step 1 的参数填 → 点「立即运行」。
Expected: 运行成功；投递目标收到带中文点评的报告；`~/.wraith/automation-runs.json` 里这次是 `success`。
**若报 `method not found` 或行为像旧代码**：见 `~/.wraith/wraith.jar` 同步问题（本仓库既有坑：桌面 dev 跑的是 `~/.wraith/wraith.jar` 而非 `target/`）。本任务没改 Java，正常不该遇到。

- [ ] **Step 3: 确认 DENY 兜底真的生效**

把 prompt 临时改成让它读一个工作区外的文件（如 `~/.ssh/config`）→「立即运行」。
Expected: 该工具调用被拒（`deniedTools` 里出现它），任务不因此崩溃。验完把 prompt 改回去。

- [ ] **Step 4: 提交**

```bash
git add docs/runbooks/github-ai-daily.md
git commit -m "$(cat <<'EOF'
docs(ghai): GitHub AI 日报的排障与接线手册

写清三件容易踩的:approval 必须只给 execute_command 放行(默认 DENY 是
ApprovalPolicy 的兜底,无人值守任务不该有第二个工具的权限);报告里「窗口
48 小时」是漏跑降级不是 bug;follower 榜空白先查人物池而不是查网络。

投递目标一律在面板里勾,脚本里没有任何投递代码 —— 这是设计,不是缺失。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec 覆盖检查：**

| Spec 条目 | 落在哪 |
|---|---|
| D1 混合三源 | Task 7（发现）+ Task 8（冷启动兜底编排） |
| D2 过去 24h + 漏跑降级 | Task 3 `pickBaseline`/`windowHours` + Task 5 窗口标注 + Task 8 Step 6 |
| D3 三层 + 增速榜 | Task 4 `tierOf`/`growthRate` + Task 5 分节 |
| D4 人物双榜 | Task 4 `diffFollowers`/`attributeStars` + Task 5 |
| D5 知识类分栏 | Task 2 `isKnowledge` + Task 7 分流 + Task 5 知识栏 |
| D6 连续在榜 / 关注名单 / 首日新库 | Task 4 `updateStreaks` + Task 8 步骤 9 关注名单 + Task 7 `buildNewRepoQueries` |
| D7 配置外置不覆盖 | Task 1 全部 |
| D8 零投递代码 | Global Constraints + Task 5 反向断言 + Task 9 |
| D9 JSON+MD，LLM 只点评 | Task 5 + Task 9 prompt |
| D10 GraphQL 批量 | Task 6 `batchRepoSnapshots` + Task 8 Step 4 成本核对 |
| D11 token 解析与不落盘 | Task 6 `resolveToken` + 反向断言 |
| D12 approval 只放行 execute_command | Task 9 Step 1/3 |
| D13 冷启动兜底 | Task 6 `trendingRepos`/`forksSince` + Task 8 步骤 8 |
| D14 纯函数/副作用分层 | File Structure + Task 2/4/5 全纯 |
| D15 JSONL.gz + 保留策略 | Task 3 `writeSnapshot`/`pruneSnapshots` |
| §5 判定规则（打分/剔除/知识类） | Task 2 逐条断言 |
| §8 失败模式（限流/部分失败/整体失败/坏快照/配置语法） | Task 6 退避、Task 6 failures、Task 8 退出码 3、Task 3 坏行与坏文件、Task 1 ConfigError |
| §9 测试策略 | Task 1–7 各自 |
| §10 定时任务接入 | Task 9 |
| §11 已知限制 | Task 9 runbook 照抄 |

**类型一致性检查：** `Repo` 形状在 Task 2 定义，Task 3（快照读写）、Task 4（`row.repo.stars`）、Task 5（渲染 `row.repo.fullName`）、Task 6（`batchRepoSnapshots` 归一化）、Task 7（`classify` 入参）用的是同一套字段名。`Row` 在 Task 4 定义，Task 5 消费。`ReportModel` 在 Task 5 定义，Task 8 组装。`cost` 三个计数器名（`graphqlPoints`/`searchRequests`/`restRequests`）在 Task 6 与 Task 5 模型里一致。

**无占位符：** 全部 7 个测试文件给的是可直接粘贴运行的代码；Task 5 与 Task 6 的实现步骤给的是约束清单而非代码，但每条约束都有对应断言把它钉住。
