import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderJson } from '../../scripts/github-ai-daily/report.mjs';

const row = (fullName, stars, starDelta, over = {}) => ({
  repo: { fullName, owner: fullName.split('/')[0], ownerType: 'User', name: fullName.split('/')[1],
          description: 'desc of ' + fullName, topics: ['ai-agent'], stars, forks: 10, watchers: 0,
          primaryLanguage: 'Python', isFork: false, isArchived: false, pushedAt: '', createdAt: '' },
  starDelta, forkDelta: 3, growth: starDelta === null ? null : starDelta / Math.max(stars - starDelta, 1),
  ...over,
});

const MODEL = {
  window: { from: '2026-08-03T07:00', to: '2026-08-04T07:00', hours: 24, degraded: false, note: null },
  pool: { repos: 2100, users: 1400 },
  cost: { graphqlPoints: 38, searchRequests: 74, restRequests: 50 },
  failures: { repos: 0, users: 0, notes: [] },
  stars: { rising: [row('new/star', 900, 210)], mid: [row('mid/thing', 8000, 300)],
           giant: [row('big/one', 90000, 700)], growth: [row('new/star', 900, 210)] },
  forks: [row('forked/hard', 5000, 40)],
  people: { followers: [{ login: 'karpathy', followers: 214548, delta: 320 }],
            attribution: [{ owner: 'acme', starDelta: 510, repos: ['acme/one', 'acme/two'] }] },
  newRepos: [row('brand/new', 60, null)],
  watchlist: [{ fullName: 'anthropics/thing', kind: 'release', detail: 'v2.0.0 发布' }],
  knowledge: [row('awesome/list', 4000, 120)],
  streaks: { 'new/star': { days: 3, lastDate: '2026-08-04' } },
};

describe('renderMarkdown', () => {
  it('头部写明窗口与池子规模', () => {
    const md = renderMarkdown(MODEL);
    expect(md).toContain('2026-08-03T07:00');
    expect(md).toContain('24');
    expect(md).toContain('2100');
  });
  it('三层与增速榜各自成节', () => {
    const md = renderMarkdown(MODEL);
    for (const s of ['新星', '中坚', '巨头', '增速']) expect(md).toContain(s);
    expect(md).toContain('new/star');
    expect(md).toContain('big/one');
  });
  it('连续在榜天数出现在对应条目上', () => {
    expect(renderMarkdown(MODEL)).toMatch(/new\/star[\s\S]{0,200}第 3 天/);
  });
  it('窗口异常时显式标注，不静默', () => {
    const md = renderMarkdown({ ...MODEL,
      window: { ...MODEL.window, hours: 48, degraded: true, note: '昨日漏跑,本期窗口为 48 小时' } });
    expect(md).toContain('48');
    expect(md).toContain('漏跑');
  });
  it('冷启动时 follower 榜明写 T+1，不假装有数据', () => {
    const md = renderMarkdown({ ...MODEL, people: { ...MODEL.people, followers: null } });
    expect(md).toContain('T+1');
    expect(md).not.toContain('karpathy');
  });
  it('各榜为空时给出空态文案而不是渲染空表格', () => {
    const md = renderMarkdown({ ...MODEL,
      stars: { rising: [], mid: [], giant: [], growth: [] }, forks: [], newRepos: [],
      watchlist: [], knowledge: [] });
    expect(md).toContain('本期无');
    expect(md).not.toMatch(/\|\s*\|\s*\|/);
  });
  it('失败计数不为零时报告尾部列出来', () => {
    const md = renderMarkdown({ ...MODEL,
      failures: { repos: 12, users: 3, notes: ['Trending 兜底不可用'] } });
    expect(md).toContain('12');
    expect(md).toContain('Trending 兜底不可用');
  });
  it('取数成本写进报告（好判断额度够不够）', () => {
    expect(renderMarkdown(MODEL)).toContain('38');
  });
  it('绝不含任何投递渠道字样', () => {
    const md = renderMarkdown(MODEL);
    for (const w of ['飞书', 'QQ', 'webhook', 'feishu']) expect(md).not.toContain(w);
  });
});

describe('renderJson', () => {
  it('可被解析回来且保留结构', () => {
    const back = JSON.parse(renderJson(MODEL));
    expect(back.stars.rising[0].repo.fullName).toBe('new/star');
    expect(back.window.hours).toBe(24);
  });
  it('以换行结尾', () => { expect(renderJson(MODEL).endsWith('\n')).toBe(true); });
});
