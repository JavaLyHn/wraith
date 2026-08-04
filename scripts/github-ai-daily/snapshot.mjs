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
