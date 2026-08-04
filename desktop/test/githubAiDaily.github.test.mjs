import { describe, it, expect, vi } from 'vitest';
import { resolveToken, TokenError, parseTrendingHtml, parseRateLimitReset, GitHubClient }
  from '../../scripts/github-ai-daily/github.mjs';

const FAKE = 'ghp_FAKE_FOR_TEST';
const jsonRes = (body, status = 200, headers = {}) => ({
  ok: status < 400, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body),
});

describe('resolveToken', () => {
  it('优先用 GITHUB_TOKEN', () => {
    expect(resolveToken({ env: { GITHUB_TOKEN: FAKE }, runGhAuth: () => 'never' })).toBe(FAKE);
  });
  it('回落 gh auth token', () => {
    expect(resolveToken({ env: {}, runGhAuth: () => `${FAKE}\n` })).toBe(FAKE);
  });
  it('两条路都没有 → TokenError，且提示怎么修', () => {
    let err; try { resolveToken({ env: {}, runGhAuth: () => { throw new Error('gh not found'); } }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TokenError);
    expect(err.message).toContain('gh auth login');
  });
  it('错误信息里不含 token 值', () => {
    let err; try { resolveToken({ env: { GITHUB_TOKEN: '   ' }, runGhAuth: () => '' }); } catch (e) { err = e; }
    expect(err.message).not.toContain('ghp_');
  });
});

describe('parseTrendingHtml', () => {
  const HTML = `
    <article class="Box-row">
      <h2 class="h3 lh-condensed"><a href="/acme/agent-thing">acme / agent-thing</a></h2>
      <span class="d-inline-block float-sm-right">1,085 stars today</span>
    </article>
    <article class="Box-row">
      <h2 class="h3 lh-condensed"><a href="/other/tool">other / tool</a></h2>
      <span class="d-inline-block float-sm-right">42 stars today</span>
    </article>`;
  it('抽出仓库名与今日星数（含千分位）', () => {
    expect(parseTrendingHtml(HTML)).toEqual([
      { fullName: 'acme/agent-thing', starsToday: 1085 },
      { fullName: 'other/tool', starsToday: 42 },
    ]);
  });
  it('GitHub 改版导致抓不到时返回空数组，不抛（兜底路径不该拖垮主链路）', () => {
    expect(parseTrendingHtml('<html>redesigned</html>')).toEqual([]);
  });
  it('真实页面：<h2> 里 <a> 前有 <svg>、href 前有别的属性、href 带查询串，照样抽得出来', () => {
    const REAL_HTML = `
      <article class="Box-row">
        <h2 class="h3 lh-condensed">
          <svg class="octicon octicon-repo" aria-hidden="true" height="16" viewBox="0 0 16 16" width="16"><path></path></svg>
          <a class="Link" data-view-component="true" href="/foo/bar?utm_source=trending">
            foo /
            bar
          </a>
        </h2>
        <span class="d-inline-block float-sm-right">7 stars today</span>
      </article>`;
    expect(parseTrendingHtml(REAL_HTML)).toEqual([{ fullName: 'foo/bar', starsToday: 7 }]);
  });
});

describe('parseRateLimitReset', () => {
  const NOW = new Date('2026-08-04T07:00:00Z');
  it('按 x-ratelimit-reset 算出等待毫秒', () => {
    const reset = String(Math.floor(NOW.getTime() / 1000) + 5);
    expect(parseRateLimitReset(new Headers({ 'x-ratelimit-reset': reset }), NOW)).toBe(5000);
  });
  it('没有该头时给下限 1s', () => {
    expect(parseRateLimitReset(new Headers({}), NOW)).toBe(1000);
  });
  it('封顶 60s，免得挂死整次运行', () => {
    const reset = String(Math.floor(NOW.getTime() / 1000) + 99999);
    expect(parseRateLimitReset(new Headers({ 'x-ratelimit-reset': reset }), NOW)).toBe(60000);
  });
});

describe('GitHubClient.graphql', () => {
  it('累加 rateLimit.cost', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ data: { rateLimit: { cost: 1 }, a: { stargazerCount: 5 } } }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    await c.graphql('query{}', {});
    expect(c.cost.graphqlPoints).toBe(1);
  });
  it('限流后退避重试并最终成功', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ errors: [{ type: 'RATE_LIMITED' }] }, 200, { 'x-ratelimit-reset': '0' }))
      .mockResolvedValueOnce(jsonRes({ data: { rateLimit: { cost: 1 }, ok: true } }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep });
    const data = await c.graphql('query{}', {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalled();
    expect(data.ok).toBe(true);
  });
  it('重试用尽后抛错', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ errors: [{ type: 'RATE_LIMITED' }] }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    await expect(c.graphql('query{}', {})).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 首次 + 3 次重试
  });
  it('请求头带 Bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ data: { rateLimit: { cost: 1 } } }));
    await new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} }).graphql('query{}', {});
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${FAKE}`);
  });
  it('200 但只有 errors、没有 data（查询校验错误）时抛出携带 message 的错误，不误判 undefined', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ errors: [{ message: 'Field "bogus" doesn\'t exist on type Query' }] }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    await expect(c.graphql('query{ bogus }', {})).rejects.toThrow(/bogus.*doesn't exist/);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 非限流错误，不重试
  });
});

describe('GitHubClient.batchRepoSnapshots', () => {
  it('100 个一批，并归一化成 Repo 形状', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `acme/r${i}`);
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const aliases = [...body.query.matchAll(/(r\d+):\s*repository/g)].map((m) => m[1]);
      const data = { rateLimit: { cost: 1 } };
      for (const a of aliases) {
        data[a] = { nameWithOwner: `acme/${a}`, owner: { login: 'acme', __typename: 'Organization' },
          name: a, description: 'd', stargazerCount: 10, forkCount: 2, watchers: { totalCount: 1 },
          primaryLanguage: { name: 'Python' }, isFork: false, isArchived: false,
          pushedAt: '2026-08-03T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
          repositoryTopics: { nodes: [{ topic: { name: 'ai-agent' } }] } };
      }
      return jsonRes({ data });
    });
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    const { repos, failures } = await c.batchRepoSnapshots(names);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 100 + 50
    expect(repos.size).toBe(150);
    expect(repos.get('acme/r0')).toMatchObject({
      fullName: 'acme/r0', owner: 'acme', ownerType: 'Organization',
      stars: 10, forks: 2, primaryLanguage: 'Python', topics: ['ai-agent'],
    });
    expect(failures).toEqual([]);
  });

  it('单个 alias 返回 null（仓库被删/改名）时记入 failures，其余照常返回', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ data: { rateLimit: { cost: 1 },
      r0: null,
      r1: { nameWithOwner: 'acme/r1', owner: { login: 'acme', __typename: 'User' }, name: 'r1',
            description: null, stargazerCount: 1, forkCount: 0, watchers: { totalCount: 0 },
            primaryLanguage: null, isFork: false, isArchived: false,
            pushedAt: '', createdAt: '', repositoryTopics: { nodes: [] } } } }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    const { repos, failures } = await c.batchRepoSnapshots(['acme/r0', 'acme/r1']);
    expect(repos.size).toBe(1);
    expect(failures).toEqual(['acme/r0']);
  });
});

describe('GitHubClient.forksSince', () => {
  it('数出窗口内新建的 fork 数（零冷启动的精确回溯）', async () => {
    const page1 = [
      { created_at: '2026-08-04T05:00:00Z' }, { created_at: '2026-08-04T01:00:00Z' },
      { created_at: '2026-08-03T20:00:00Z' },
    ];
    const page2 = [{ created_at: '2026-08-03T06:00:00Z' }, { created_at: '2026-08-01T00:00:00Z' }];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes(page1)).mockResolvedValueOnce(jsonRes(page2));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    expect(await c.forksSince('a/b', '2026-08-03T07:00:00Z')).toBe(3);
  });
  it('cap 生效，超大仓库不会翻到天荒地老', async () => {
    const full = Array.from({ length: 100 }, () => ({ created_at: '2026-08-04T05:00:00Z' }));
    const fetchImpl = vi.fn(async () => jsonRes(full));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    expect(await c.forksSince('a/b', '2026-08-03T07:00:00Z', 250)).toBe(250);
  });
});

describe('GitHubClient.searchRepos', () => {
  it('每次请求前节流 ≥2.1s（search 硬限 30/min）', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => jsonRes({ items: [], total_count: 0 }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep });
    await c.searchRepos('topic:mcp', { maxPages: 2 });
    expect(sleep.mock.calls.every(([ms]) => ms >= 2100)).toBe(true);
    expect(c.cost.searchRequests).toBeGreaterThan(0);
  });
  it('拿到空页就停，不硬翻满 maxPages', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ items: [], total_count: 0 }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    await c.searchRepos('topic:mcp', { maxPages: 10 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('非 2xx（比如 403 二级限流）要记 note，不能悄悄说成「查无结果」', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ message: 'secondary rate limit' }, 403));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    const repos = await c.searchRepos('topic:mcp', { maxPages: 3 });
    expect(repos).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 出错就停，不接着翻页
    expect(c.notes.some((n) => n.includes('403'))).toBe(true);
  });
});

describe('GitHubClient.trendingRepos', () => {
  it('HTTP 200 但解析出 0 条时要记 note——这是「返回 [] 不抛」这条兜底策略本身会悄悄失效的信号', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>redesigned</html>' }));
    const c = new GitHubClient({ token: FAKE, fetchImpl, sleep: async () => {} });
    const result = await c.trendingRepos([]);
    expect(result).toEqual([]);
    expect(c.notes.some((n) => n.includes('0 条'))).toBe(true);
  });
});
