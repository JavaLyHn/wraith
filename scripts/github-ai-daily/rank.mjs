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

// 窗口内新建的仓库：它的 star/fork 全是窗口内攒出来的，所以「日增 = 存量」不是估算而是
// 精确值。但「涨幅」对这种仓库没有意义 —— 窗口起点时它还不存在，分母为 0，`growthRate`
// 会算出 stars/1 这种天文数字，一个 3000 星的新库就能顶掉整张增速榜。
//
// 所以 `growth = null` 必须**无条件**执行，不能只在 starDelta 还是 null 时才做：冷启动路
// 径下 Trending 会先把 starDelta 填成 starsToday（≈ 存量），那恰恰是最容易爆的一种输入。
// 曾经写成嵌在 starDelta === null 分支里，真机上只因为当天交叉命中的都是 ≥12k 星的老仓库
// 才没炸出来。
//
// rows 就地改写。windowFromMs 是窗口起点的毫秒时间戳；createdAt 解析不出来、或早于窗口
// 起点的（日期粒度的 created:>= 查询会捞到最多 48h 前建的库），一律不动 —— 不猜。
export function applyNewRepoDeltas(rows, newNames, windowFromMs) {
  for (const row of rows) {
    if (!newNames.has(row.repo.fullName)) continue;
    const created = Date.parse(row.repo.createdAt);
    if (!Number.isFinite(created) || created < windowFromMs) continue;
    row.growth = null;
    if (row.starDelta === null || row.starDelta === undefined) row.starDelta = row.repo.stars;
    if (row.forkDelta === null || row.forkDelta === undefined) row.forkDelta = row.repo.forks;
  }
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

export function updateStreaks(prev, rankedFullNames, todayISO, ttlDays = STREAK_TTL_DAYS) {
  const out = {};
  for (const [key, rec] of Object.entries(prev ?? {})) {
    if (dayDiff(todayISO, rec.lastDate) <= ttlDays) out[key] = { ...rec };
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
