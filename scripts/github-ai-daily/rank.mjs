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
