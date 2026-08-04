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

const EMPTY_TEXT = '_本期无_';
const DESC_MAX = 120;

const formatSigned = (n) => (n >= 0 ? '+' : '') + n;

function truncateDescription(text) {
  if (!text) return '_无简介_';
  const s = String(text);
  return s.length > DESC_MAX ? `${s.slice(0, DESC_MAX)}…` : s;
}

// 一节榜单：标题 + 有序列表，空榜写空态文案而不是渲染空表格。
function renderSection(heading, rows, lineRenderer) {
  if (!rows || rows.length === 0) return `${heading}\n\n${EMPTY_TEXT}\n`;
  const body = rows.map((row, i) => lineRenderer(row, i + 1)).join('\n\n');
  return `${heading}\n\n${body}\n`;
}

// Row 型条目（stars.*／forks／newRepos／knowledge 共用）：链接行 + 缩进两格的简介行。
// starDelta/forkDelta 为 null 时明写「新入池，暂无日增」，绝不假装为 0。
function makeRowLine({ deltaField, emoji, totalField, streaks, extra }) {
  return (row, index) => {
    const { repo } = row;
    const url = `https://github.com/${repo.fullName}`;
    const delta = row[deltaField];
    const deltaText = delta === null || delta === undefined
      ? '新入池，暂无日增'
      : `${formatSigned(delta)} ${emoji}（${repo[totalField]} → 存量）`;
    const streak = streaks?.[repo.fullName];
    const clauses = [
      streak ? `🔥第 ${streak.days} 天在榜` : null,
      repo.primaryLanguage ?? null,
      extra ? extra(row) : null,
    ].filter(Boolean);
    // 「）」是全角括号，紧跟 · 不留空格；其余场景（比如「暂无日增」这句纯文字）前面要留半角空格。
    const sep = deltaText.endsWith('）') ? '·' : ' ·';
    const tail = clauses.length ? `${sep} ${clauses.join(' · ')}` : '';
    return `${index}. **[${repo.fullName}](${url})** ${deltaText}${tail}\n  ${truncateDescription(repo.description)}`;
  };
}

const growthSuffix = (row) => (row.growth === null || row.growth === undefined
  ? null
  : `涨幅 ${(row.growth * 100).toFixed(1)}%`);

function renderHeader(model) {
  const { window: win, pool, cost, failures } = model;
  const lines = [
    `# GitHub AI 日报 · ${win.to}`,
    '',
    `- 窗口：${win.from ?? '（无前一日快照，本期为首次运行）'} → ${win.to}（${win.hours ?? '未知'} 小时）`,
  ];
  if (win.degraded) lines.push(`> ⚠ ${win.note ?? '窗口存在异常，具体原因未提供'}`);
  lines.push(`- 监控池：${pool.repos} 个仓库 · ${pool.users} 个用户`);
  lines.push(`- 取数成本：GraphQL ${cost.graphqlPoints} 点 · Search ${cost.searchRequests} 次 · REST ${cost.restRequests} 次`);
  lines.push(`- 失败计数：仓库 ${failures.repos} · 用户 ${failures.users}`);
  return `${lines.join('\n')}\n`;
}

// follower 榜要整节做「有无前一日快照」的二值判断：null 时绝不渲染 0，而是明写 T+1。
function renderFollowersSection(followers) {
  const heading = '### 📈 涨粉榜';
  if (followers === null) return `${heading}\n\n_follower 日增需要前一日快照，**T+1 起可用**_\n`;
  if (followers.length === 0) return `${heading}\n\n${EMPTY_TEXT}\n`;
  const lines = followers.map((f, i) => {
    const deltaText = f.delta === null || f.delta === undefined
      ? '新增用户，暂无日增'
      : `${formatSigned(f.delta)} 粉丝（${f.followers} → 存量）`;
    return `${i + 1}. **[${f.login}](https://github.com/${f.login})** ${deltaText}`;
  });
  return `${heading}\n\n${lines.join('\n')}\n`;
}

function renderAttributionSection(attribution) {
  const heading = '### ⭐ star 归因榜';
  if (!attribution || attribution.length === 0) return `${heading}\n\n${EMPTY_TEXT}\n`;
  const lines = attribution.map((a, i) =>
    `${i + 1}. **[${a.owner}](https://github.com/${a.owner})** ${formatSigned(a.starDelta)} ⭐ · 来自 ${a.repos.length} 个仓库：${a.repos.join('、')}`);
  return `${heading}\n\n${lines.join('\n')}\n`;
}

const WATCHLIST_KIND_LABEL = { release: '发布', 'new-repo': '新仓库', surge: '暴涨' };

function renderWatchlistSection(watchlist) {
  const heading = '### 👀 关注名单';
  if (!watchlist || watchlist.length === 0) return `${heading}\n\n${EMPTY_TEXT}\n`;
  const lines = watchlist.map((w, i) =>
    `${i + 1}. **[${w.fullName}](https://github.com/${w.fullName})**（${WATCHLIST_KIND_LABEL[w.kind] ?? w.kind}）${w.detail}`);
  return `${heading}\n\n${lines.join('\n')}\n`;
}

function renderFooter(failures) {
  if (!failures?.notes || failures.notes.length === 0) return '';
  return `### 失败详情\n\n${failures.notes.map((n) => `- ${n}`).join('\n')}\n`;
}

export function renderMarkdown(model) {
  const { streaks } = model;
  const starLine = (extra) => makeRowLine({ deltaField: 'starDelta', emoji: '⭐', totalField: 'stars', streaks, extra });
  const forkLine = makeRowLine({ deltaField: 'forkDelta', emoji: '🍴', totalField: 'forks', streaks });

  const parts = [
    renderHeader(model),
    renderSection('### 🌟 新星榜', model.stars.rising, starLine()),
    renderSection('### 🌱 中坚榜', model.stars.mid, starLine()),
    renderSection('### 🐘 巨头榜', model.stars.giant, starLine()),
    renderSection('### 🚀 增速榜', model.stars.growth, starLine(growthSuffix)),
    renderSection('### 🍴 fork 增量榜', model.forks, forkLine),
    renderFollowersSection(model.people.followers),
    renderAttributionSection(model.people.attribution),
    renderSection('### 🆕 首日开源榜', model.newRepos, starLine()),
    renderWatchlistSection(model.watchlist),
    renderSection('### 📚 知识类仓库', model.knowledge, starLine()),
  ];

  const footer = renderFooter(model.failures);
  if (footer) parts.push(footer);

  return `${parts.join('\n')}\n`;
}

export function renderJson(model) {
  return `${JSON.stringify(model, null, 2)}\n`;
}
