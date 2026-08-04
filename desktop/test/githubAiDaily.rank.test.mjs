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
