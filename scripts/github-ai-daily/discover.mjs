import { classify } from './classify.mjs';

/** @typedef {import('./classify.mjs').Repo} Repo */
/** @typedef {{firstSeen: string, lastActive: string}} PoolEntry */
/** @typedef {Record<string, PoolEntry>} Pool */

const DAY_MS = 86_400_000;

// UTC 天数算术：全部基于注入的 YYYY-MM-DD 字符串，绝不碰 new Date()/Date.now()。
const parseISODateUTC = (iso) => Date.parse(`${iso}T00:00:00Z`);
const formatISODateUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const subDaysISO = (iso, days) => formatISODateUTC(parseISODateUTC(iso) - days * DAY_MS);
const dayDiff = (aISO, bISO) => Math.round((parseISODateUTC(aISO) - parseISODateUTC(bISO)) / DAY_MS);

const allTopics = (config) => [...new Set(Object.values(config.topics ?? {}).flat())];
const includeKeywords = (config) => [...new Set(config.keywords?.include ?? [])];

// 两个维度各自独立：topic 精确匹配 GitHub 的 topic 索引；关键词故意锁在 in:name,description，
// 不放开到全文搜索，否则「LLM」这类词会在 README 正文里到处误中。
// 二者都为空 → 返回 []，绝不吐出一条裸的 `stars:>=N pushed:>=D`（等于拉全站）。
export function buildQueries(config, { todayISO }) {
  const topics = allTopics(config);
  const keywords = includeKeywords(config);
  if (topics.length === 0 && keywords.length === 0) return [];
  const cutoff = subDaysISO(todayISO, config.activeWithinDays);
  const suffix = `stars:>=${config.minStars} pushed:>=${cutoff}`;
  return [
    ...topics.map((t) => `topic:${t} ${suffix}`),
    ...keywords.map((k) => `${k} in:name,description ${suffix}`),
  ];
}

// 「首日开源」发现：用 newRepoMinStars 而不是 minStars —— 昨天才创建的仓库不可能攒到
// 主门槛那么多星，用主门槛会让这块板子永远空着。同样两维度都空则不产出裸查询。
export function buildNewRepoQueries(config, { sinceISO }) {
  const topics = allTopics(config);
  const keywords = includeKeywords(config);
  if (topics.length === 0 && keywords.length === 0) return [];
  const suffix = `created:>=${sinceISO} stars:>=${config.newRepoMinStars}`;
  return [
    ...topics.map((t) => `topic:${t} ${suffix}`),
    ...keywords.map((k) => `${k} in:name,description ${suffix}`),
  ];
}

// 纯函数：候选池是攒出来的，不是每天重建的。firstSeen 一旦写入就不再变，
// lastActive 每次被召回就刷新到今天；连续 activeWithinDays 天没被任何查询召回才踢出。
// 不改动 pool/found 任何一方 —— 调用方（Task 8）会把旧 pool 原样传进来，指望它还能用。
export function mergePool(pool, found, todayISO, config) {
  const nextPool = {};
  const added = [];
  const dropped = [];
  const seen = new Set();

  for (const repo of found) {
    const key = repo.fullName;
    if (seen.has(key)) continue; // 防御性去重：discover() 已经去重过，这里再兜一层
    seen.add(key);
    const prevEntry = pool?.[key];
    if (prevEntry) {
      nextPool[key] = { firstSeen: prevEntry.firstSeen, lastActive: todayISO };
    } else {
      nextPool[key] = { firstSeen: todayISO, lastActive: todayISO };
      added.push(key);
    }
  }

  for (const [key, entry] of Object.entries(pool ?? {})) {
    if (seen.has(key)) continue; // 今天被召回，上面已经处理并刷新过
    if (dayDiff(todayISO, entry.lastActive) > config.activeWithinDays) {
      dropped.push(key);
    } else {
      nextPool[key] = { ...entry }; // 今天没召回，但还在活跃窗口内 —— 原样保留，静待窗口耗尽
    }
  }

  return { pool: nextPool, added, dropped };
}

// 两个 discover* 入口共用的执行核心：逐条查询、按 fullName 去重、单条失败只记 note、
// 不中断其余查询——一个 topic 挂了不该毁掉整次发现。此前 discover 与 discoverNewRepos
// 各自维护一份几乎相同的循环，唯一的差异（记不记 note）恰好在最要紧的地方悄悄分叉；
// 现在两者共享同一份循环 + 同一份错误可见性策略，不再有漂移的余地。
async function runQueries(client, queries) {
  const notes = [];
  const results = new Map();
  for (const q of queries) {
    try {
      const repos = await client.searchRepos(q);
      for (const repo of repos) {
        if (!results.has(repo.fullName)) results.set(repo.fullName, repo);
      }
    } catch (err) {
      notes.push(`查询失败：${q} —— ${err.message}`);
    }
  }
  return { results, notes };
}

// classify() 之后 ai/knowledge 都要入池（知识类也需要日增数据才能出「知识类」报告栏），
// unrelated/excluded 直接丢弃、不进池。
function splitByKind(foundByName, config) {
  const aiRepos = [];
  const knowledgeRepos = [];
  const poolCandidates = [];
  for (const repo of foundByName.values()) {
    const { kind } = classify(repo, config);
    if (kind === 'ai') {
      aiRepos.push(repo);
      poolCandidates.push(repo);
    } else if (kind === 'knowledge') {
      knowledgeRepos.push(repo);
      poolCandidates.push(repo);
    }
    // 'unrelated' / 'excluded'：丢弃，不进池
  }
  return { aiRepos, knowledgeRepos, poolCandidates };
}

export async function discover(client, config, pool, todayISO) {
  const queries = buildQueries(config, { todayISO });
  const { results: foundByName, notes } = await runQueries(client, queries);
  const { aiRepos, knowledgeRepos, poolCandidates } = splitByKind(foundByName, config);
  const { pool: nextPool, added, dropped } = mergePool(pool, poolCandidates, todayISO, config);
  return { pool: nextPool, added, dropped, aiRepos, knowledgeRepos, notes };
}

// 「首日开源」板独立于候选池：不写入/不依赖 pool 的 firstSeen 连续性，每天单纯问一遍
// 「从 sinceISO 起新建的、已经有点星的仓库有哪些」。同样按 classify 过滤掉不相关/排除项。
// notes 必须跟着 repos 一起返回——一次 07:00 无人值守的 cron 里，把失败吞进空数组会让
// 「今天真的一个新仓库都没有」和「查询接口全挂了」变得无法区分；report.mjs 的
// failures.notes 需要看到这些内容，console.error 在无人值守场景下没人能看见。
export async function discoverNewRepos(client, config, sinceISO) {
  const queries = buildNewRepoQueries(config, { sinceISO });
  const { results: foundByName, notes } = await runQueries(client, queries);
  const repos = [];
  for (const repo of foundByName.values()) {
    const { kind } = classify(repo, config);
    if (kind === 'ai' || kind === 'knowledge') repos.push(repo);
  }
  return { repos, notes };
}
