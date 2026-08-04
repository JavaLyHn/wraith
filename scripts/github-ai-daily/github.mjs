import { execFileSync } from 'node:child_process';

/** @typedef {import('./classify.mjs').Repo} Repo */

const GRAPHQL_URL = 'https://api.github.com/graphql';
const REST_BASE = 'https://api.github.com';
const TRENDING_BASE = 'https://github.com/trending';
const REST_ACCEPT = 'application/vnd.github+json';

const MAX_RETRIES = 3; // 首次 + 3 次重试 = 最多 4 次 fetch
const SEARCH_THROTTLE_MS = 2100; // search API 硬限 30 req/min → 每req间隔 ≥2s
const BATCH_SIZE = 100; // 每批 alias 数（GraphQL 单次请求上限的保守值）
const RESET_MIN_MS = 1000;
const RESET_MAX_MS = 60000;

// ---- token 解析：绝不把 token 值写进任何日志/错误信息 ----

export class TokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenError';
  }
}

function defaultRunGhAuth() {
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' });
}

const isBlank = (v) => typeof v !== 'string' || v.trim() === '';

export function resolveToken({ env = process.env, runGhAuth = defaultRunGhAuth } = {}) {
  if (!isBlank(env.GITHUB_TOKEN)) return env.GITHUB_TOKEN.trim();
  if (!isBlank(env.GH_TOKEN)) return env.GH_TOKEN.trim();
  let fromGh = '';
  try {
    fromGh = runGhAuth();
  } catch {
    fromGh = '';
  }
  if (!isBlank(fromGh)) return fromGh.trim();
  throw new TokenError(
    '找不到 GitHub token：请先运行 `gh auth login` 登录，或设置 GITHUB_TOKEN / GH_TOKEN 环境变量后重试。');
}

// ---- trending 页面抓取：纯兜底路径，解析失败/改版一律返回空数组，不抛 ----

export function parseTrendingHtml(html) {
  try {
    const articles = String(html).match(/<article\b[\s\S]*?<\/article>/g);
    if (!articles) return [];
    const out = [];
    for (const block of articles) {
      // 真实 trending 页面在 <h2> 里 <a> 前常有 <svg class="octicon...">，且 <a> 上
      // href 前面常还有别的属性（class、data-view-component 等）；两种偏离任一种都会让
      // 严格锚定「<h2> 后紧跟 <a href=」的写法抓空。用 [\s\S]*? 跨过插入的标签，
      // 用 <a\b[^>]*href= 跨过 href 前面的其他属性；[^"?]+ 顺手把查询串也剥掉。
      const hrefMatch = block.match(/<h2[^>]*>[\s\S]*?<a\b[^>]*href="\/([^"?]+)/);
      const starsMatch = block.match(/([\d,]+)\s+stars\s+today/);
      if (!hrefMatch || !starsMatch) continue;
      out.push({
        fullName: hrefMatch[1].trim(),
        starsToday: Number(starsMatch[1].replace(/,/g, '')),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---- 限流退避：下限 1s、上限 60s，避免挂死整次运行 ----

export function parseRateLimitReset(headers, now = new Date()) {
  const raw = typeof headers?.get === 'function' ? headers.get('x-ratelimit-reset') : undefined;
  const resetEpochSeconds = Number(raw);
  if (!raw || !Number.isFinite(resetEpochSeconds)) return RESET_MIN_MS;
  const waitMs = resetEpochSeconds * 1000 - now.getTime();
  return Math.min(RESET_MAX_MS, Math.max(RESET_MIN_MS, waitMs));
}

// ---- REST/GraphQL 归一化：两条取数路径必须产出同一个 Repo 形状 ----

const REPO_FIELDS = 'nameWithOwner owner{login __typename} name description stargazerCount '
  + 'forkCount watchers{totalCount} primaryLanguage{name} isFork isArchived pushedAt createdAt '
  + 'repositoryTopics(first:20){nodes{topic{name}}}';

/** @returns {Repo} */
function normalizeGraphqlRepo(node) {
  return {
    fullName: node.nameWithOwner,
    owner: node.owner?.login ?? null,
    ownerType: node.owner?.__typename ?? null,
    name: node.name,
    description: node.description ?? null,
    topics: (node.repositoryTopics?.nodes ?? []).map((n) => n.topic.name),
    stars: node.stargazerCount,
    forks: node.forkCount,
    watchers: node.watchers?.totalCount ?? 0,
    primaryLanguage: node.primaryLanguage?.name ?? null,
    isFork: node.isFork,
    isArchived: node.isArchived,
    pushedAt: node.pushedAt,
    createdAt: node.createdAt,
  };
}

/** @returns {Repo} */
function normalizeRestRepo(item) {
  return {
    fullName: item.full_name,
    owner: item.owner?.login ?? null,
    ownerType: item.owner?.type ?? null,
    name: item.name,
    description: item.description ?? null,
    topics: item.topics ?? [],
    stars: item.stargazers_count,
    forks: item.forks_count,
    watchers: item.watchers_count ?? 0,
    primaryLanguage: item.language ?? null,
    isFork: item.fork ?? false,
    isArchived: item.archived ?? false,
    pushedAt: item.pushed_at,
    createdAt: item.created_at,
  };
}

// alias 用 r0../u0.. 而不是仓库名/登录名派生：'-'、'.' 不是合法 GraphQL alias 字符。
// idx 是「这一批 fullNames/logins 里的全局下标」而不是每批重置的下标 —— 重置会导致
// 第二批的 r0 与第一批的 r0 撞名，覆盖掉前一批已经收进 Map 的结果。
function buildRepoBatchQuery(pairs) {
  const varDecls = [];
  const fields = [];
  const variables = {};
  for (const { idx, owner, name } of pairs) {
    varDecls.push(`$o${idx}:String!,$n${idx}:String!`);
    fields.push(`r${idx}: repository(owner:$o${idx}, name:$n${idx}) { ${REPO_FIELDS} }`);
    variables[`o${idx}`] = owner;
    variables[`n${idx}`] = name;
  }
  return { query: `query(${varDecls.join(',')}) { rateLimit{cost} ${fields.join(' ')} }`, variables };
}

function buildUserBatchQuery(pairs) {
  const varDecls = [];
  const fields = [];
  const variables = {};
  for (const { idx, login } of pairs) {
    varDecls.push(`$l${idx}:String!`);
    fields.push(`u${idx}: user(login:$l${idx}) { login followers{totalCount} }`);
    variables[`l${idx}`] = login;
  }
  return { query: `query(${varDecls.join(',')}) { rateLimit{cost} ${fields.join(' ')} }`, variables };
}

function splitOwnerName(fullName) {
  const slash = fullName.indexOf('/');
  return { owner: fullName.slice(0, slash), name: fullName.slice(slash + 1) };
}

function authHeaders(token, extra = {}) {
  // 纯对象，不是 Headers 实例：Bearer 头要能被直接下标访问（见测试）。
  return { Authorization: `Bearer ${token}`, ...extra };
}

export class GitHubClient {
  constructor({
    token,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => new Date(),
    log = () => {},
    searchThrottleMs = SEARCH_THROTTLE_MS,
    maxRetries = MAX_RETRIES,
  } = {}) {
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.now = now;
    this.log = log;
    this.searchThrottleMs = searchThrottleMs;
    this.maxRetries = maxRetries;
    // 三个计数器分别对应 report.mjs 的 cost.*，每个都只在对应方法里累加一次。
    this.cost = { graphqlPoints: 0, searchRequests: 0, restRequests: 0 };
    this.notes = [];
  }

  // 唯一会打 GraphQL 端点的方法：累加 cost.graphqlPoints。
  // RATE_LIMITED 可能以 HTTP 200 + body.errors 的形式出现（不是 4xx），所以检测放在 body 里。
  async graphql(query, variables) {
    const body = JSON.stringify({ query, variables });
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const res = await this.fetchImpl(GRAPHQL_URL, {
        method: 'POST',
        headers: authHeaders(this.token, { 'Content-Type': 'application/json' }),
        body,
      });
      let parsed = {};
      try { parsed = await res.json(); } catch { parsed = {}; }
      const rateLimited = Array.isArray(parsed?.errors)
        && parsed.errors.some((e) => e?.type === 'RATE_LIMITED');
      if (res.ok && !rateLimited) {
        // 查询校验错误 / 节点数超限等，GitHub 回的是 200 + errors[] + 没有 data。
        // 这不是限流,重试没用;必须在这里截住,否则 return undefined 会让调用方
        // （比如 batchRepoSnapshots 的 data['r0']）炸出一句不知所云的 TypeError，
        // 真正的 GraphQL 错误信息反而被吞掉。
        if (parsed?.data == null && Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
          throw new Error(`GraphQL 查询错误：${parsed.errors[0]?.message ?? '（错误对象没有 message 字段）'}`);
        }
        const cost = parsed?.data?.rateLimit?.cost;
        if (typeof cost === 'number') this.cost.graphqlPoints += cost;
        return parsed.data;
      }
      const retryable = rateLimited || res.status === 403 || res.status >= 500;
      if (!retryable || attempt === this.maxRetries) {
        const reason = rateLimited ? 'RATE_LIMITED' : `HTTP ${res.status}`;
        throw new Error(`GraphQL 请求失败（${reason}），已用尽 ${this.maxRetries} 次重试`);
      }
      this.log(`[github] GraphQL 限流/${res.status}，退避重试（第 ${attempt + 1} 次）`);
      await this.sleep(parseRateLimitReset(res.headers, this.now()));
    }
    // 不可达：循环要么 return，要么 throw。
    throw new Error('GraphQL 请求失败');
  }

  // 三条 REST 路径（forksSince/contributors/searchRepos）共用的取数+计数+报错口。
  // 非 2xx 时不抛：记一条 note 并返回 null，调用方据此决定「就地停」还是「返回已收集的部分」——
  // 这样一次 403/422 不会被误判成「查无结果」而悄悄吞掉，也不会因为半途出错就丢光已经拿到的数据。
  // counterKey 区分 search 与其余 REST：两者是不同的速率限额桶，report.mjs 也是分开渲染的。
  async _restFetch(url, { counterKey = 'restRequests' } = {}) {
    const res = await this.fetchImpl(url, { headers: authHeaders(this.token, { Accept: REST_ACCEPT }) });
    this.cost[counterKey] += 1;
    if (!res.ok) {
      this.notes.push(`REST 请求失败（HTTP ${res.status}）：${url}`);
      return null;
    }
    return res;
  }

  // 100 个 fullName 一批，alias 用「这次调用里的全局下标」，跨批不重置。
  async batchRepoSnapshots(fullNames) {
    const repos = new Map();
    const failures = [];
    for (let start = 0; start < fullNames.length; start += BATCH_SIZE) {
      const batch = fullNames.slice(start, start + BATCH_SIZE);
      const pairs = batch.map((fullName, i) => ({ idx: start + i, fullName, ...splitOwnerName(fullName) }));
      const { query, variables } = buildRepoBatchQuery(pairs);
      const data = await this.graphql(query, variables);
      for (const p of pairs) {
        const node = data[`r${p.idx}`];
        if (!node) { failures.push(p.fullName); continue; } // 仓库被删/改名：跳过，不拖累整批
        repos.set(node.nameWithOwner, normalizeGraphqlRepo(node));
      }
    }
    return { repos, failures };
  }

  async batchUserFollowers(logins) {
    const users = new Map();
    const failures = [];
    for (let start = 0; start < logins.length; start += BATCH_SIZE) {
      const batch = logins.slice(start, start + BATCH_SIZE);
      const pairs = batch.map((login, i) => ({ idx: start + i, login }));
      const { query, variables } = buildUserBatchQuery(pairs);
      const data = await this.graphql(query, variables);
      for (const p of pairs) {
        const node = data[`u${p.idx}`];
        if (!node) { failures.push(p.login); continue; } // 用户被删/改名同理
        users.set(node.login, node.followers?.totalCount ?? 0);
      }
    }
    return { users, failures };
  }

  // 唯一「零冷启动」的精确回溯：forks?sort=newest 按时间新→旧翻页，数到窗口外为止。
  // 终止条件严格三选一：本页出现早于 sinceISO 的记录 / 累计已达 cap / 本页为空——
  // 不能拿「本页 < per_page」当成隐含终止信号，会提前少数漏算一页。
  async forksSince(fullName, sinceISO, cap = 500) {
    const sinceTime = new Date(sinceISO).getTime();
    let count = 0;
    for (let page = 1; ; page += 1) {
      const url = `${REST_BASE}/repos/${fullName}/forks?sort=newest&per_page=100&page=${page}`;
      const res = await this._restFetch(url);
      // 非 2xx：_restFetch 已经记了 note，就地停在已经数到的位置而不是让调用方误以为
      // 这仓库真的只有这么多 fork（比如 403 被当成「翻到头了」，报告里悄悄少报）。
      if (!res) break;
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) break;
      let hitOld = false;
      for (const item of items) {
        if (new Date(item.created_at).getTime() < sinceTime) { hitOld = true; break; }
        count += 1;
        if (count >= cap) break;
      }
      if (hitOld || count >= cap) break;
    }
    return Math.min(count, cap);
  }

  async contributors(fullName, top) {
    const url = `${REST_BASE}/repos/${fullName}/contributors?per_page=${top}&anon=false`;
    const res = await this._restFetch(url);
    if (!res) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];
    return items.slice(0, top).map((c) => c.login).filter(Boolean);
  }

  // search API 硬限 30 req/min：sleep 必须在 fetch 之前，否则第一波请求就打爆限额。
  async searchRepos(q, { maxPages = 3 } = {}) {
    const repos = [];
    for (let page = 1; page <= maxPages; page += 1) {
      await this.sleep(this.searchThrottleMs);
      const url = `${REST_BASE}/search/repositories?q=${encodeURIComponent(q)}`
        + `&sort=stars&order=desc&per_page=100&page=${page}`;
      const res = await this._restFetch(url, { counterKey: 'searchRequests' });
      // 非 2xx（比如 403 二级限流、422 非法查询）：_restFetch 已经记了 note，
      // 就此停止翻页——绝不能把它并入「items 为空」分支，否则报告会把
      // 「搜索接口出错」误读成「AI 相关新仓库今天恰好一个都没有」。
      if (!res) break;
      const body = await res.json();
      const items = body?.items ?? [];
      if (items.length === 0) break;
      for (const item of items) repos.push(normalizeRestRepo(item));
    }
    return repos;
  }

  // 冷启动兜底：抓 HTML 失败（非 2xx 或抛异常）绝不能拖垮主链路，per-language 隔离失败。
  async trendingRepos(languages) {
    const langs = languages && languages.length > 0 ? languages : [null];
    const out = [];
    for (const lang of langs) {
      try {
        const url = lang ? `${TRENDING_BASE}/${encodeURIComponent(lang)}?since=daily` : `${TRENDING_BASE}?since=daily`;
        const res = await this.fetchImpl(url);
        if (!res.ok) {
          this.notes.push(`trending 抓取失败（${lang ?? '全部语言'}）：HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        const parsed = parseTrendingHtml(html);
        // 200 但解析出 0 条：多半是 GitHub 又改版了，parseTrendingHtml 抓空。
        // 「返回 []、不抛」正是让这种情况可能悄悄发生的原因，所以必须留痕，
        // 否则冷启动兜底路径死掉都没人知道，报告只是安静地缺一节。
        if (parsed.length === 0) {
          this.notes.push(`trending 页面解析出 0 条（${lang ?? '全部语言'}）：` +
            'HTTP 200 但没抓到任何仓库，可能是 GitHub 改版，parseTrendingHtml 需要跟进');
        }
        out.push(...parsed);
      } catch (e) {
        this.notes.push(`trending 抓取异常（${lang ?? '全部语言'}）：${e.message}`);
      }
    }
    return out;
  }
}
