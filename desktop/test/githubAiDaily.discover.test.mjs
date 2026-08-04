import { describe, it, expect, vi } from 'vitest';
import { buildQueries, buildNewRepoQueries, mergePool, discover, discoverNewRepos }
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
  it('配置为空时不产出裸查询（与 buildQueries 同一条约束）', () => {
    expect(buildNewRepoQueries({ topics: {}, keywords: {}, newRepoMinStars: 5 },
      { sinceISO: '2026-08-03' })).toEqual([]);
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

describe('discoverNewRepos', () => {
  it('按 classify 过滤：AI/知识类保留，剔除的丢弃', async () => {
    const client = { searchRepos: vi.fn(async (q) => {
      if (q.startsWith('topic:ai-agent')) return [repo('new/agent'), repo('new/awesome', { name: 'awesome-thing' })];
      if (q.startsWith('topic:agentic')) return [repo('new/fork', { isFork: true })];
      return [];
    }) };
    const r = await discoverNewRepos(client, CONFIG, '2026-08-03');
    expect(r.repos.map((x) => x.fullName).sort()).toEqual(['new/agent', 'new/awesome']);
    expect(r.notes).toEqual([]);
  });
  it('全部查询失败：repos 为空，notes 非空且点名失败查询（否则和「今天真没有新库」无法区分）', async () => {
    const client = { searchRepos: vi.fn(async () => { throw new Error('network down'); }) };
    const r = await discoverNewRepos(client, CONFIG, '2026-08-03');
    expect(r.repos).toEqual([]);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes.every((n) => n.includes('查询失败'))).toBe(true);
    expect(r.notes.some((n) => n.includes('network down'))).toBe(true);
  });
  it('部分查询失败：成功的结果保留，同时记一条 note', async () => {
    const client = { searchRepos: vi.fn(async (q) => {
      if (q.startsWith('topic:mcp')) throw new Error('boom');
      return [repo('new/ok')];
    }) };
    const r = await discoverNewRepos(client, CONFIG, '2026-08-03');
    expect(r.repos.map((x) => x.fullName)).toEqual(['new/ok']);
    expect(r.notes.some((n) => n.includes('topic:mcp') && n.includes('boom'))).toBe(true);
  });
});
