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
