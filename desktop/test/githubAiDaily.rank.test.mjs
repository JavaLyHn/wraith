import { describe, it, expect } from 'vitest';
import {
  diffRepos, tierOf, growthRate, topBy, diffFollowers, attributeStars, updateStreaks,
  applyNewRepoDeltas,
} from '../../scripts/github-ai-daily/rank.mjs';

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

describe('applyNewRepoDeltas', () => {
  // 窗口 = 2026-08-03T00:00Z 起
  const WINDOW_FROM = Date.parse('2026-08-03T00:00:00Z');
  const IN = '2026-08-03T12:00:00Z';    // 窗口内新建
  const OUT = '2026-08-02T12:00:00Z';   // 窗口外新建（日期粒度查询会捞到这种）
  const newNames = new Set(['new/in', 'new/out']);
  const row = (fullName, createdAt, starDelta, forkDelta, growth = 0.5) => ({
    repo: repo(fullName, 3000, 40, { createdAt }), starDelta, forkDelta, growth,
  });

  // 四格真值表：(窗口内/窗口外) × (starDelta 为 null / 非 null)
  it('① 窗口内新建 + 无基线可比 → 日增 = 存量（精确值），growth 置 null', () => {
    const r = row('new/in', IN, null, null);
    applyNewRepoDeltas([r], newNames, WINDOW_FROM);
    expect(r.starDelta).toBe(3000);
    expect(r.forkDelta).toBe(40);
    expect(r.growth).toBeNull();
  });

  it('② 窗口内新建 + starDelta 已被 Trending 填过 → 保留该值，但 growth 仍必须置 null', () => {
    // 这是曾经漏掉的那格：starsToday ≈ 存量，growthRate 会算出 stars/1 = 300000%
    const r = row('new/in', IN, 2900, null);
    applyNewRepoDeltas([r], newNames, WINDOW_FROM);
    expect(r.starDelta).toBe(2900);        // 不覆盖已有的真实日增
    expect(r.forkDelta).toBe(40);          // fork 仍是精确回填
    expect(r.growth).toBeNull();           // ← 承重断言：新库不许上增速榜
  });

  it('③ 窗口外新建 + 无基线可比 → 一个字段都不动（不猜）', () => {
    const r = row('new/out', OUT, null, null);
    applyNewRepoDeltas([r], newNames, WINDOW_FROM);
    expect(r.starDelta).toBeNull();
    expect(r.forkDelta).toBeNull();
    expect(r.growth).toBe(0.5);
  });

  it('④ 窗口外新建 + 已有真实日增 → 一个字段都不动', () => {
    const r = row('new/out', OUT, 12, 3);
    applyNewRepoDeltas([r], newNames, WINDOW_FROM);
    expect(r.starDelta).toBe(12);
    expect(r.forkDelta).toBe(3);
    expect(r.growth).toBe(0.5);
  });

  it('不在新库名单里的仓库不受影响，哪怕它也是窗口内新建的', () => {
    const r = row('pool/x', IN, null, null);
    applyNewRepoDeltas([r], newNames, WINDOW_FROM);
    expect(r.starDelta).toBeNull();
    expect(r.growth).toBe(0.5);
  });

  it('createdAt 解析不出来 → 当窗口外处理，不猜', () => {
    const r = row('new/in', 'not-a-date', null, null);
    applyNewRepoDeltas([r], newNames, WINDOW_FROM);
    expect(r.starDelta).toBeNull();
    expect(r.growth).toBe(0.5);
  });

  it('置了 null 的 growth 会被 topBy 过滤掉 —— 新库确实进不了增速榜', () => {
    const fresh = row('new/in', IN, 2900, null);
    const normal = { repo: repo('pool/y', 1000, 10), starDelta: 50, forkDelta: 2, growth: 0.05 };
    applyNewRepoDeltas([fresh, normal], newNames, WINDOW_FROM);
    const board = topBy([fresh, normal], (r) => r.growth, 5);
    expect(board.map((r) => r.repo.fullName)).toEqual(['pool/y']);
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
  it('TTL 可配置：给 5 天时，6 天没上榜的清掉、正好 5 天的保留', () => {
    const prev = { 'a/old': { days: 2, lastDate: '2026-07-29' },
                   'a/edge': { days: 2, lastDate: '2026-07-30' } };
    const s = updateStreaks(prev, [], '2026-08-04', 5);
    expect(s['a/old']).toBeUndefined();
    expect(s['a/edge']).toEqual({ days: 2, lastDate: '2026-07-30' });
  });
  it('不传 TTL 时沿用 30 天默认（旧调用不受影响）', () => {
    const s = updateStreaks({ 'a/b': { days: 1, lastDate: '2026-07-20' } }, [], '2026-08-04');
    expect(s['a/b']).toBeDefined();
  });
});
