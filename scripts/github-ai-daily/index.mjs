#!/usr/bin/env node
// GitHub AI 日报的编排入口（spec §4 的数据流）。
//
// 这一层只做四件事：排顺序、处理失败、决定退出码、把各模块的产出装成 ReportModel。
// 所有判定口径（打分、分层、做差、渲染）都在旁边那几个有单测的模块里，这里不重复实现。
//
// 退出码是定时任务唯一的信号，必须严格：
//   0 成功 / 1 配置（含参数）错误 / 2 token 错误 / 3 取数整体失败
// 失败路径上**绝不写报告文件** —— 每天早上 7 点准时投一份看着正常的空报告，
// 比明着失败糟糕得多。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadConfig, ConfigError, DEFAULT_DATA_DIR } from './config.mjs';
import { classify } from './classify.mjs';
import { resolveToken, TokenError, GitHubClient } from './github.mjs';
import { discover, discoverNewRepos } from './discover.mjs';
import {
  listSnapshots, pickBaseline, pruneSnapshots, readSnapshot, windowHours, writeSnapshot,
} from './snapshot.mjs';
import {
  applyNewRepoDeltas, attributeStars, diffFollowers, diffRepos, growthRate, tierOf, topBy,
  updateStreaks,
} from './rank.mjs';
import { renderJson, renderMarkdown } from './report.mjs';

const EXIT_OK = 0;
const EXIT_CONFIG = 1;
const EXIT_TOKEN = 2;
const EXIT_NETWORK = 3;

// 「运维型」异常：已经诊断清楚、话也说明白了的失败（额度耗尽、失败占比过高、池子为空）。
// 打上这个标记，收尾处就不再糊一屏调用栈 —— 栈只对真正没预料到的异常有价值。
const operational = (err) => Object.assign(err, { operational: true });

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const BASELINE_MAX_ATTEMPTS = 3;    // 坏快照最多往回退 3 份（spec §8）
const COLD_START_FORK_CANDIDATES = 30;   // brief Step 1 第 8 条明文规定的数字，不是本层自选的口径

// 进度日志一律走 stderr：stdout 的最后一行留给报告绝对路径，Task 9 的 automation
// prompt 靠那一行找报告，别的东西不许挤进去。
const log = (msg) => process.stderr.write(`${msg}\n`);

class UsageError extends Error {}

// ---- 小工具 ----

const pad = (n) => String(n).padStart(2, '0');
// 全程用本地时间：snapshot.mjs 的文件名也是本地时间，两边必须同一把尺子。
const localDateISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localMinuteISO = (d) => `${localDateISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function parseArgs(argv) {
  const args = { dataDir: DEFAULT_DATA_DIR, dryRun: false, skipDiscover: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data-dir') {
      const v = argv[i += 1];
      if (!v) throw new UsageError('--data-dir 后面要跟一个目录路径');
      args.dataDir = resolve(v);
    } else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--skip-discover') args.skipDiscover = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new UsageError(`不认识的参数：${a}（用 --help 看用法）`);
  }
  return args;
}

const HELP = `用法：node scripts/github-ai-daily/index.mjs [选项]

  --data-dir <path>   数据目录（配置/池子/快照/报告都在这儿）。默认 ${DEFAULT_DATA_DIR}
  --dry-run           只做发现与快照，不出报告（想看池子长什么样、又不想覆盖当天报告时用）
  --skip-discover     跳过 Search 发现，直接用已有 pool.json 取数。
                      排障与同日复跑用：Search 额度是 30 次/分钟，一轮完整发现要几百次请求。
  -h, --help          显示本帮助

退出码：0 成功 / 1 配置或参数错误 / 2 token 错误 / 3 取数整体失败
`;

function readJsonFile(path, fallback, label, notes) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    // 池子和连续天数都是可再生的状态：坏了就按空的算并留痕，不能因此中断整期报告。
    notes.push(`${label} 读不出来（${path}）：${e.message}；本期按空的算，运行结束会重写一份`);
    return fallback;
  }
}

const writeJsonFile = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

// ---- 基线：读不出来就往更早的退，退不动就当冷启动 ----

async function loadBaseline(snapDir, now, minAgeHours, notes) {
  let names = listSnapshots(snapDir);
  for (let attempt = 1; attempt <= BASELINE_MAX_ATTEMPTS; attempt += 1) {
    const picked = pickBaseline(names, now, minAgeHours);
    if (!picked) return null;
    let snap = null;
    let reason = null;
    try {
      snap = await readSnapshot(snapDir, picked.name);
      // 能解压但一条仓库都没有，等价于没有基线：拿它做差会把整池报成「新入池」。
      if (snap.repos.size === 0) reason = '解压出来是空的（0 个仓库）';
    } catch (e) {
      reason = e.message;
    }
    if (!reason) {
      if (attempt > 1) notes.push(`已退到更早的基线快照 ${picked.name}（第 ${attempt} 次尝试才读成功）`);
      return snap;
    }
    notes.push(`基线快照 ${picked.name} 用不了：${reason}；改用更早的一份`);
    names = names.filter((n) => n !== picked.name);
  }
  notes.push(`连续 ${BASELINE_MAX_ATTEMPTS} 份基线快照都读不出来，本期退化为「无基线」路径`);
  return null;
}

// ---- 冷启动（D13）：不伪造零，只填真拿得到的那部分 ----

async function applyColdStart(client, config, rows, now, notes) {
  // trending 只能按语言分（spec §1），配置模板里没这个键：用户想扩就自己加
  // trendingLanguages，缺省只抓全站榜。
  const langs = Array.isArray(config.trendingLanguages) ? config.trendingLanguages : [];
  const trending = await client.trendingRepos(langs);
  const byName = new Map(rows.map((r) => [r.repo.fullName, r]));
  let hits = 0;
  for (const t of trending) {
    const row = byName.get(t.fullName);
    if (!row) continue;                 // 只覆盖交叉命中的，池外的 trending 条目不入榜
    row.starDelta = t.starsToday;
    row.growth = growthRate(row);
    hits += 1;
  }
  notes.push(`冷启动：Trending 页抓到 ${trending.length} 条，与监控池交叉命中 ${hits} 条`
    + ' —— star 日增只覆盖这些仓库，池内其余仓库本期没有 star 日增（不是 0）');

  // fork 日增是唯一零冷启动的精确指标，但一个仓库一次回溯，只能给候选前 N 个用。
  const sinceISO = new Date(now.getTime() - DAY_MS).toISOString();
  const candidates = [...rows]
    .sort((a, b) => ((b.starDelta ?? 0) - (a.starDelta ?? 0)) || (b.repo.stars - a.repo.stars))
    .slice(0, COLD_START_FORK_CANDIDATES);
  for (const row of candidates) {
    row.forkDelta = await client.forksSince(row.repo.fullName, sinceISO);
  }
  notes.push(`冷启动：fork 日增对 ${candidates.length} 个候选仓库做了精确回溯`
    + '（按 star 日增、其次存量排序），这批之外的仓库本期没有 fork 日增');
}

// ---- 关注名单（spec §7）：不看是否上榜，一律单独报；但必须先过 classify ----

// 除了 nameWithOwner/createdAt/releases，还要把 classify() 读的那几个字段一起取回来 ——
// 关注名单的候选可能根本不在候选池里（这正是它存在的意义：spec §11 的「池外爆款会漏」由它兜），
// 所以不能拿池内快照去分类。这里只列 classify() 真正读的字段，不重建整个 Repo 形状。
const WATCHLIST_REPO_FIELDS = 'nameWithOwner name description createdAt isFork isArchived '
  + 'primaryLanguage{name} repositoryTopics(first:20){nodes{topic{name}}} '
  + 'releases(first:1, orderBy:{field:CREATED_AT,direction:DESC}){nodes{tagName name publishedAt}}';

function buildWatchlistQuery(logins, reposPerOwner) {
  const varDecls = [];
  const fields = [];
  const variables = {};
  logins.forEach((login, idx) => {
    varDecls.push(`$w${idx}:String!`);
    fields.push(`w${idx}: repositoryOwner(login:$w${idx}) { login `
      + `repositories(first:${reposPerOwner}, privacy:PUBLIC, isFork:false, `
      + 'orderBy:{field:PUSHED_AT,direction:DESC}) { totalCount nodes { '
      + `${WATCHLIST_REPO_FIELDS} } } }`);
    variables[`w${idx}`] = login;
  });
  return { query: `query(${varDecls.join(',')}) { rateLimit{cost} ${fields.join(' ')} }`, variables };
}

// GraphQL 节点 → classify() 能吃的最小 Repo 形状。
const watchlistNodeToRepo = (node) => ({
  fullName: node.nameWithOwner,
  name: node.name,
  description: node.description ?? null,
  topics: (node.repositoryTopics?.nodes ?? []).map((n) => n.topic.name),
  primaryLanguage: node.primaryLanguage?.name ?? null,
  isFork: node.isFork,
  isArchived: node.isArchived,
});

async function fetchWatchlist(client, config, rows, windowFromMs, notes) {
  const logins = [...new Set([
    ...(config.watchlist?.orgs ?? []),
    ...(config.watchlist?.users ?? []),
  ])].filter(Boolean);
  const entries = [];

  // 关注名单的门槛**故意比主榜低**（用户裁定）：主榜要 score ≥ config.aiThreshold（默认 2），
  // 这里只要 score ≥ config.watchlistMinScore（默认 1）。两个门槛都可配，别在这儿写死数字。
  //
  // 为什么两套门槛不是随意为之：关注名单存在的意义，恰恰是兜住打分器兜不住的仓库
  // （spec §11「池外爆款会漏，缓解手段是加进 watchlist」）。实测铁证 ——
  // `anthropics/claude-code` **一个 topic 都没打**，简介里的 "agentic" 还差一个字母过不了
  // `agent` 的词边界，score = 0；`openai/codex` score = 1。用主榜的 ≥3 去筛关注名单，
  // 等于把这个机制最该抓住的两个目标一起筛掉。而噪声那一侧实测全是 0 分
  // （openai-ruby / langchain-ai/terraform / google/xls…），所以 ≥1 这条低线足够把它们挡住。
  //
  // `excluded` 无条件拒：那条路在干真活 —— `google/boringssl` 的简介写着 "Mirror of BoringSSL"，
  // 命中 exclude 规则，镜像仓库不该出现在任何榜上。`unrelated` 不再自动拒，只看分数。
  const droppedByScore = [];
  const droppedExcluded = [];
  const truncated = [];
  const minScore = config.watchlistMinScore;
  const relevant = (fullName, repo) => {
    const { kind, score } = classify(repo, config);
    if (kind === 'excluded') { droppedExcluded.push(`${fullName}（排除项）`); return false; }
    if (score >= minScore) return true;
    droppedByScore.push(`${fullName}（${score} 分）`);
    return false;
  };
  const reposPerOwner = config.watchlistReposPerOwner;

  if (logins.length > 0) {
    // 这一节是锦上添花：查挂了不该毁掉已经拿到手的整期数据，所以整段包 try。
    try {
      const { query, variables } = buildWatchlistQuery(logins, reposPerOwner);
      const data = await client.graphql(query, variables);
      logins.forEach((login, idx) => {
        const owner = data?.[`w${idx}`];
        if (!owner) { notes.push(`关注名单里的 ${login} 查不到（改名或不存在？）`); return; }
        const nodes = owner.repositories?.nodes ?? [];
        const totalCount = owner.repositories?.totalCount;
        // 截断必须留痕：`orderBy PUSHED_AT DESC` + `first:N` 意味着只看得见最近推送的 N 个仓库，
        // 一个 google 体量的组织后面还有几千个，窗口内的 release 会被悄悄漏掉。spec §7 要求
        // 「窗口内有新 release 一律单独报」，做不到就得让人看见做不到，而不是装作没有。
        // 攒起来最后合成一条 —— 每个关注对象各记一条的话，天天四行同样的话，很快就没人看了。
        if (typeof totalCount === 'number' && totalCount > nodes.length) {
          truncated.push(`${login}（${totalCount} 个仓库）`);
        }
        for (const node of nodes) {
          // 先算「窗口内有没有动静」，再过 classify —— 顺序反了就数不出被滤掉多少条。
          const events = [];
          const rel = node.releases?.nodes?.[0];
          const relAt = rel?.publishedAt ? Date.parse(rel.publishedAt) : NaN;
          if (Number.isFinite(relAt) && relAt >= windowFromMs) {
            events.push({
              kind: 'release',
              detail: `窗口内发布 ${rel.tagName}${rel.name && rel.name !== rel.tagName ? `（${rel.name}）` : ''}`,
            });
          }
          const createdAt = Date.parse(node.createdAt);
          if (Number.isFinite(createdAt) && createdAt >= windowFromMs) {
            events.push({ kind: 'new-repo', detail: `窗口内新建（${node.createdAt}）` });
          }
          if (events.length === 0) continue;
          if (!relevant(node.nameWithOwner, watchlistNodeToRepo(node))) continue;
          for (const e of events) entries.push({ fullName: node.nameWithOwner, ...e });
        }
      });
    } catch (e) {
      notes.push(`关注名单查询失败：${e.message}（本期该栏只剩池内涨幅，release/新建库缺失）`);
    }
  }

  // 组织不进人物榜（spec §5），它们的动静就报在这儿：池内属于关注对象的仓库按 star 日增取前几。
  const watched = new Set(logins.map((l) => l.toLowerCase()));
  const surges = topBy(
    rows.filter((r) => watched.has(String(r.repo.owner).toLowerCase())
      && r.starDelta > 0 && relevant(r.repo.fullName, r.repo)),
    (r) => r.starDelta,
    config.topN,
  );
  for (const row of surges) {
    entries.push({ fullName: row.repo.fullName, kind: 'surge', detail: `本期 +${row.starDelta} ⭐（存量 ${row.repo.stars}）` });
  }

  if (truncated.length > 0) {
    notes.push(`关注名单只看每个关注对象最近推送的 ${reposPerOwner} 个仓库`
      + `（watchlistReposPerOwner）：${truncated.join('、')} 超出了这个数，更靠后的仓库若在窗口内`
      + '发过 release 会被漏掉，需要就把这个值调大');
  }
  // 被挡掉又确实有窗口内动静的，不许安静消失。两类分开报：分数不够是**口径可调**的
  // （补关键词或调 watchlistMinScore 就能放进来），排除项是镜像/归档，本来就不该报。
  if (droppedExcluded.length > 0) {
    const uniq = [...new Set(droppedExcluded)];
    log(`[ghai] 关注名单命中排除规则（镜像/归档/黑名单词）${uniq.length} 条：${uniq.join('、')}`);
  }
  if (droppedByScore.length > 0) {
    const uniq = [...new Set(droppedByScore)];
    log(`[ghai] 关注名单分数不够（窗口内有动静但 < ${minScore} 分）${uniq.length} 条：${uniq.join('、')}`);
    notes.push(`关注名单：${uniq.length} 个仓库窗口内有动静但 AI 相关性分数低于 `
      + `watchlistMinScore=${minScore}，未列入（样本：${uniq.slice(0, 5).join('、')}`
      + `${uniq.length > 5 ? ' 等' : ''}）；要放它们进来就往 config 的 keywords.include / topics 补词`);
  }

  const seen = new Set();
  return entries.filter((e) => {
    const key = `${e.kind}:${e.fullName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- 主流程 ----

async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return EXIT_OK; }

  // 1. 配置（缺失则从模板复制）
  const { config, path: configPath, createdFromTemplate } = loadConfig({ dataDir: args.dataDir });
  if (createdFromTemplate) {
    process.stdout.write(`已按模板生成默认配置：${configPath}\n（改口径直接编辑它，下次运行生效）\n`);
  }

  // 2. token（绝不打印其值）+ 客户端
  const token = resolveToken();
  // 用户显式写 null 也不能崩：?? 兜底用与 config.default.json 一致的默认值，
  // 不依赖 mergeConfig 一定已经把这两个新键补齐。
  const client = new GitHubClient({
    token,
    log,
    searchThrottleMs: config.searchThrottleMs ?? 2100,
    maxRetries: config.graphqlMaxRetries ?? 3,
    maxBatchFailureRatio: config.maxBatchFailureRatio ?? 0.25,
  });

  const now = new Date();
  const todayISO = localDateISO(now);
  const dataDir = args.dataDir;
  const snapDir = join(dataDir, 'snapshots');
  const poolPath = join(dataDir, 'pool.json');
  const streaksPath = join(dataDir, 'streaks.json');
  const notes = [];

  // 3. 发现 → 写回池子
  let pool = readJsonFile(poolPath, {}, 'pool.json', notes);
  if (args.skipDiscover) {
    notes.push('本次运行带了 --skip-discover：没跑 Search 发现，池子沿用上次的 pool.json');
    log(`[ghai] --skip-discover：沿用已有池子 ${Object.keys(pool).length} 个仓库`);
  } else {
    // 这一步会静默好几分钟：Search 硬限 30 次/分钟，客户端串行节流 ≥2.1s/次，
    // 一轮下来几百次请求。不先说一声，运维会以为脚本卡死了。
    log('[ghai] 开始 Search 发现（串行节流 ≥2.1s/次，整轮通常 5–15 分钟，期间没有输出是正常的）……');
    const found = await discover(client, config, pool, todayISO);
    pool = found.pool;
    notes.push(...found.notes);
    writeJsonFile(poolPath, pool);
    log(`[ghai] 发现完成：池子 ${Object.keys(pool).length} 个仓库（新增 ${found.added.length} / 移出 ${found.dropped.length}）`
      + `；本次召回 AI ${found.aiRepos.length} 个、知识类 ${found.knowledgeRepos.length} 个`);
  }

  // 4. 首日新库（独立于池子）
  let newRepos = [];
  if (!args.skipDiscover) {
    log('[ghai] 开始查首日新库（同样是 Search，同样慢）……');
    const sinceISO = localDateISO(new Date(now.getTime() - DAY_MS));
    const res = await discoverNewRepos(client, config, sinceISO);
    newRepos = res.repos;
    notes.push(...res.notes);
    log(`[ghai] 首日新库：${newRepos.length} 个（created:>=${sinceISO}）`);
  }

  // 5. 快照取数：池内全部 + 新库
  const targets = [...new Set([...Object.keys(pool), ...newRepos.map((r) => r.fullName)])];
  if (targets.length === 0) {
    throw operational(new Error('候选池与新库都是空的，没有任何仓库可取数'
      + '（Search 发现是不是全失败了？看上面的 stderr 里有没有 403/限流）'));
  }
  log(`[ghai] 批量取仓库快照：${targets.length} 个……`);
  const { repos: currentRepos, failures: repoFailures } = await client.batchRepoSnapshots(targets);
  if (currentRepos.size === 0) {
    throw operational(new Error(`${targets.length} 个仓库一个都没取到，本期没有任何可报的数据`));
  }
  log(`[ghai] 仓库快照完成：成功 ${currentRepos.size} / 失败 ${repoFailures.length}`);

  // 6a. 基线与做差 —— 位置比计划里的编号提前了：spec §5 要求人物池按「本期」star 日增
  //     选扩充仓库，而本期日增只有做完差才有。基线选取全是本地 IO，且 pickBaseline 要求
  //     基线距今 ≥baselineMinAgeHours，所以提到写快照之前不会把今天这份选成基线。
  const baseline = await loadBaseline(snapDir, now, config.baselineMinAgeHours, notes);
  const rows = diffRepos(currentRepos, baseline?.repos ?? null);

  const win = { from: null, to: localMinuteISO(now), hours: null, degraded: false, note: null };
  if (baseline) {
    win.from = localMinuteISO(baseline.at);
    win.hours = windowHours(baseline.at, now);
    const nominalHours = config.windowNominalHours ?? 24;
    const toleranceHours = config.windowToleranceHours ?? 1;
    if (Math.abs(win.hours - nominalHours) > toleranceHours) {
      win.degraded = true;
      win.note = `本期窗口是 ${win.hours} 小时，不是 24 小时（上一份可用快照是 ${localMinuteISO(baseline.at)}，`
        + '中间大概漏跑了）。下面所有「日增」覆盖的就是这么长的时间，没有折算成一天。';
    }
  } else {
    win.degraded = true;
    win.note = '首次运行（或基线全损）：没有可比的前一日快照。star 日增只来自 Trending 页'
      + '「stars today」的交叉命中，fork 日增来自 forks 精确回溯，follower 日增 T+1 起才有。';
    // 这一步在写快照之前，却要打 1 次 HTML + 最多 30 次分页 REST。它是**尽力而为**的补数：
    // 让它的传输层异常冒出去就等于「一次网络抽风 → 今天的快照没写成 → 明天还是冷启动 →
    // 后天报一个 48h 退化窗口」，一次抖动赔三天。所以整段包住，失败只留痕。
    try {
      await applyColdStart(client, config, rows, now, notes);
    } catch (e) {
      notes.push(`冷启动补数失败：${e.message} —— 本期 star/fork 日增基本为空，`
        + '但快照已照常落盘，明天起就有真实基线可比');
    }
  }

  const windowFromMs = baseline ? baseline.at.getTime() : now.getTime() - DAY_MS;
  applyNewRepoDeltas(rows, new Set(newRepos.map((r) => r.fullName)), windowFromMs);

  // 6b. 人物池：上界 = 池内 User owner 去重 + contributorPoolTopRepos × contributorsPerRepo
  const logins = new Set();
  for (const repo of currentRepos.values()) {
    if (repo.ownerType === 'User' && repo.owner) logins.add(repo.owner);
  }
  const ownerCount = logins.size;
  const topRepoN = config.contributorPoolTopRepos ?? 0;
  if (topRepoN > 0) {
    const forContributors = topBy(rows, (r) => r.starDelta, topRepoN);
    log(`[ghai] 人物池扩充：对本期 star 日增前 ${forContributors.length} 个仓库取 contributors……`);
    // 与冷启动补数同理：这也是写快照之前的尽力而为的扩充（上界 =
    // contributorPoolTopRepos × contributorsPerRepo 次 REST），不该因为一次传输层抖动
    // 就把当天的快照连坐掉。
    try {
      for (const row of forContributors) {
        for (const login of await client.contributors(row.repo.fullName, config.contributorsPerRepo)) {
          // Bot 账号在 GraphQL 里是 Bot 类型，user(login:) 查它一律返回 null，
          // 放进去只会把「失败用户数」撑成一堆假失败。
          if (!login.endsWith('[bot]')) logins.add(login);
        }
      }
    } catch (e) {
      notes.push(`人物池 contributors 扩充中断：${e.message} —— 人物池只剩池内 owner，`
        + '快照照常落盘');
    }
  }
  log(`[ghai] 批量取 follower：${logins.size} 人（池内 owner ${ownerCount} + contributors 扩充）……`);
  const { users, failures: userFailures } = await client.batchUserFollowers([...logins]);
  log(`[ghai] follower 完成：成功 ${users.size} / 失败 ${userFailures.length}`);

  // 7. 落本期快照（先落盘再渲染：报告挂了明天照样有基线可比）
  const snapFile = await writeSnapshot(snapDir, now, { repos: currentRepos, users });
  log(`[ghai] 快照已写入：${snapFile}`);

  if (args.dryRun) {
    log('[ghai] --dry-run：只做发现与快照，不写报告');
    process.stdout.write(`${snapFile}\n`);
    return EXIT_OK;
  }

  // 8/9. 分层、各榜、关注名单、连续在榜天数
  const poolNames = new Set(Object.keys(pool));
  const newNames = new Set(newRepos.map((r) => r.fullName));
  const kindOf = new Map(rows.map((r) => [r.repo.fullName, classify(r.repo, config).kind]));
  // 主榜只收池内仓库：新库板是独立视角，没过 minStars 门槛的东西不该混进主榜；
  // 同时按本期快照重新分类一遍 —— 池里的仓库可能昨天归档了/改了 topic，
  // 这一步顺手把它们挡在榜外（下一轮 discover 也不会再把它们放回池子）。
  const inPool = (r) => poolNames.has(r.repo.fullName);
  const aiRows = rows.filter((r) => inPool(r) && kindOf.get(r.repo.fullName) === 'ai');
  const knowledgeRows = rows.filter((r) => inPool(r) && kindOf.get(r.repo.fullName) === 'knowledge');
  const newRows = rows.filter((r) => newNames.has(r.repo.fullName)
    && ['ai', 'knowledge'].includes(kindOf.get(r.repo.fullName)));

  const byTier = (tier) => aiRows.filter((r) => tierOf(r.repo.stars, config.tiers) === tier);
  const stars = {
    rising: topBy(byTier('rising'), (r) => r.starDelta, config.topN),
    mid: topBy(byTier('mid'), (r) => r.starDelta, config.topN),
    giant: topBy(byTier('giant'), (r) => r.starDelta, config.topN),
    growth: topBy(aiRows, (r) => r.growth, config.topN),
  };
  const forks = topBy(aiRows, (r) => r.forkDelta, config.topN);
  const knowledge = topBy(knowledgeRows, (r) => r.starDelta, config.topN);
  const newReposBoard = topBy(newRows, (r) => r.starDelta, config.topN);

  // 涨粉榜：没有基线就整节为 null（渲染成「T+1 起可用」），绝不渲染成一片 0。
  // topBy 的同值 tiebreak 读 `repo.fullName`，所以先给每人挂一个只有 fullName 的壳，取完再摘掉。
  const followers = baseline
    ? topBy(
      diffFollowers(users, baseline.users).map((f) => ({ ...f, repo: { fullName: f.login } })),
      (f) => f.delta,
      config.topN,
    ).map(({ repo, ...f }) => f)
    : null;
  // 归因榜同样是人物榜：组织不进（spec §5），它们的动静归关注名单栏。
  // `ownerType` 只用来过滤，不能带进 model —— ReportModel 里这一节只声明 {owner,starDelta,repos}。
  const attribution = attributeStars(rows)
    .filter((a) => a.ownerType === 'User')
    .slice(0, config.topN)
    .map(({ ownerType, ...a }) => a);
  const watchlist = await fetchWatchlist(client, config, rows, windowFromMs, notes);

  const ranked = [...new Set([
    ...stars.rising, ...stars.mid, ...stars.giant, ...stars.growth,
    ...forks, ...newReposBoard, ...knowledge,
  ].map((r) => r.repo.fullName))];
  // 只在内存里算；落盘要等报告真的写成（见下），否则渲染一失败，今天照样被计入
  // 每个仓库的「第 N 天在榜」，明天的天数就凭空多了一天。
  const streaks = updateStreaks(
    readJsonFile(streaksPath, {}, 'streaks.json', notes), ranked, todayISO, config.streakTtlDays ?? 30);

  // 10. 渲染 → 落盘 → 清理超期快照
  const model = {
    window: win,
    // 「监控池」= 池子本身的规模；currentRepos 还多含当天的首日新库，不是池子。
    pool: { repos: poolNames.size, users: users.size },
    cost: { ...client.cost },
    failures: { repos: repoFailures.length, users: userFailures.length, notes: [...notes, ...client.notes] },
    stars,
    forks,
    people: { followers, attribution },
    newRepos: newReposBoard,
    watchlist,
    knowledge,
    streaks,
  };

  // 两份都先渲染成字符串再落盘：`renderJson` 抛在 `renderMarkdown` 之后的话，
  // 磁盘上会留下一份新 .md 配一份隔日的旧 .json，比两份都没有更难排查。
  const mdPath = join(dataDir, `${todayISO}.md`);
  const jsonPath = join(dataDir, `${todayISO}.json`);
  const md = renderMarkdown(model);
  const json = renderJson(model);
  writeFileSync(mdPath, md);
  writeFileSync(jsonPath, json);
  writeJsonFile(streaksPath, streaks);   // 报告落盘成功了，今天才算「在榜」

  // 清理是收尾杂务：unlinkSync 撞上 EPERM/EBUSY 不该让一次已经成功的运行退成失败码 ——
  // 那会变成「报告明明写好了，automation 却报错」，正是本脚本最想避免的错配。
  try {
    const pruned = pruneSnapshots(snapDir, now, config.snapshotRetainDays);
    if (pruned.length > 0) log(`[ghai] 清理超期快照 ${pruned.length} 份`);
  } catch (e) {
    log(`[ghai] 清理超期快照失败（不影响本期报告）：${e.message}`);
  }
  log(`[ghai] 取数成本：GraphQL ${client.cost.graphqlPoints} 点 · Search ${client.cost.searchRequests} 次`
    + ` · REST ${client.cost.restRequests} 次`);

  // 11. 最后一行 = 报告绝对路径（automation 的 prompt 靠它找报告）
  process.stdout.write(`${mdPath}\n`);
  return EXIT_OK;
}

// 12. 顶层错误处理：分类退出码，失败一律不写报告
async function main() {
  try {
    return await run(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`[ghai] 参数错误：${e.message}\n`);
      return EXIT_CONFIG;
    }
    if (e instanceof ConfigError) {
      process.stderr.write(`[ghai] 配置错误：${e.message}\n`
        + `[ghai] 出问题的文件：${e.path}\n`
        + '[ghai] 修好这个文件再跑；本次没有写出任何报告。\n');
      return EXIT_CONFIG;
    }
    if (e instanceof TokenError) {
      process.stderr.write(`[ghai] token 错误：${e.message}\n`
        + '[ghai] 先跑 `gh auth status` 看登录还在不在；本次没有写出任何报告。\n');
      return EXIT_TOKEN;
    }
    process.stderr.write(`[ghai] 取数失败，本次没有写出任何报告：${e.message}\n`);
    // 运维型异常（额度耗尽、失败占比过高、池子为空）已经把话说清楚了，再糊一屏栈只会
    // 让人误以为是崩溃。只有真正没预料到的异常才值得打栈。
    if (e?.stack && !e.operational) process.stderr.write(`${e.stack}\n`);
    process.stderr.write('[ghai] 排查顺序：网络是否通 → `gh api rate_limit` 看额度是否耗尽'
      + ' → 隔一会儿重跑。已经落盘的快照/池子不会丢，重跑不会重复计数。\n');
    return EXIT_NETWORK;
  }
}

process.exitCode = await main();
