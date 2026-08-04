import { describe, it, expect } from 'vitest';
import { matchesKeyword, scoreRepo, isExcluded, isKnowledge, classify }
  from '../../scripts/github-ai-daily/classify.mjs';

const CONFIG = {
  topics: { agent: ['ai-agent', 'agentic'], spec: ['mcp', 'llms-txt'] },
  keywords: { include: ['agent', 'LLM', 'MCP', 'eval'], exclude: ['mirror', '镜像', '翻译'] },
  knowledgeRepoHints: ['awesome', 'cookbook', '教程'],
};

const repo = (over = {}) => ({
  fullName: 'acme/thing', owner: 'acme', ownerType: 'Organization', name: 'thing',
  description: 'a thing', topics: [], stars: 500, forks: 10, watchers: 5,
  primaryLanguage: 'Python', isFork: false, isArchived: false,
  pushedAt: '2026-08-03T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', ...over,
});

describe('matchesKeyword', () => {
  it('ASCII 关键词走词边界，不误伤更长的单词', () => {
    expect(matchesKeyword('an MCP server', 'MCP')).toBe(true);
    expect(matchesKeyword('mcpherson wrote this', 'MCP')).toBe(false);
    expect(matchesKeyword('LLM-powered', 'LLM')).toBe(true);
  });
  it('大小写不敏感', () => {
    expect(matchesKeyword('an llm agent', 'LLM')).toBe(true);
  });
  it('中文关键词走子串（中文没有词边界）', () => {
    expect(matchesKeyword('这是官方文档的中文翻译版', '翻译')).toBe(true);
  });
  it('空 haystack 不炸', () => {
    expect(matchesKeyword('', 'agent')).toBe(false);
    expect(matchesKeyword(null, 'agent')).toBe(false);
  });
});

describe('scoreRepo', () => {
  it('单个 topic 命中给 3 分，若该 topic 字符串本身也命中一个关键词则再叠加 1 分', () => {
    // 'ai-agent' 本身命中 topics.agent，score 里的 3 分来自这里；但关键词干草堆现在也扫
    // repo.topics，'agent' 这个关键词对 'ai-agent' 这个 topic 字符串一样满足词边界
    // （前面是 '-'，后面是字符串末尾），所以再叠加 1 分，总分 4，不是纯 topic 的 3。
    const r = scoreRepo(repo({ topics: ['ai-agent'] }), CONFIG);
    expect(r.score).toBe(4);
    expect(r.topicHits).toEqual(['ai-agent']);
    expect(r.keywordHits).toEqual(['agent']);
  });
  it('topic 分数上限 6，三个命中最多算 6 分（本例另有 2 个关键词经由 topics 命中，一并叠加）', () => {
    // topicHits 三个都命中，3*3=9 封顶到 6；关键词干草堆现在也扫 topics：'agent' 命中
    // 'ai-agent'，'MCP' 命中 'mcp'（'agentic' 因为词边界不满足不会再重复命中 'agent'），
    // keywordHits=['agent','MCP'] 两个，+2。总分 6+2=8。
    const r = scoreRepo(repo({ topics: ['ai-agent', 'agentic', 'mcp'] }), CONFIG);
    expect(r.score).toBe(8);
    expect(r.keywordHits).toEqual(['agent', 'MCP']);
  });
  it('关键词只给弱信号，单个 1 分', () => {
    const r = scoreRepo(repo({ description: 'an LLM toolkit' }), CONFIG);
    expect(r.score).toBe(1);
    expect(r.keywordHits).toEqual(['LLM']);
  });
  it('关键词分数上限 3', () => {
    expect(scoreRepo(repo({ name: 'agent-eval', description: 'LLM MCP agent eval' }), CONFIG).score).toBe(3);
  });
  it('topic + 关键词叠加，上限 9', () => {
    const r = scoreRepo(repo({ topics: ['ai-agent', 'mcp'], name: 'llm-agent-eval',
      description: 'agent LLM MCP eval' }), CONFIG);
    expect(r.score).toBe(9);
  });
  it('简介为 null 不炸', () => {
    expect(scoreRepo(repo({ description: null }), CONFIG).score).toBe(0);
  });
  it('topic 与同名关键词各算一次 —— 两种信号刻意相加，不去重', () => {
    const r = scoreRepo(repo({ topics: ['mcp'], description: 'Native MCP support included' }), CONFIG);
    expect(r.score).toBe(4);
    expect(r.keywordHits).toEqual(['MCP']);
  });
  it('关键词干草堆现在也扫 topics —— 真实数据里最重要的仓库反而打的 topic 最少，' +
     '名字/简介里没提，但 topics 里字面写着关键词（例如 whisper.cpp 的 inference/transformer）',
  () => {
    // 没有任何 topic 命中 topics 表（topicHits=0），name/description/fullName 里也不含
    // 关键词——分数完全来自 topics 数组里的字符串本身满足某个关键词的词边界。
    const r = scoreRepo(repo({ topics: ['llm-toolkit'] }), CONFIG);
    expect(r.topicHits).toEqual([]);
    expect(r.keywordHits).toEqual(['LLM']);
    expect(r.score).toBe(1);
  });
});

describe('isExcluded', () => {
  it('fork 直接剔除', () => { expect(isExcluded(repo({ isFork: true }), CONFIG)).toBe(true); });
  it('归档仓库直接剔除', () => { expect(isExcluded(repo({ isArchived: true }), CONFIG)).toBe(true); });
  it('命中 exclude 关键词直接剔除', () => {
    expect(isExcluded(repo({ description: 'a mirror of upstream' }), CONFIG)).toBe(true);
    expect(isExcluded(repo({ name: 'langchain-中文翻译' }), CONFIG)).toBe(true);
  });
  it('干净仓库不被剔除', () => { expect(isExcluded(repo(), CONFIG)).toBe(false); });
});

describe('isKnowledge', () => {
  it('名称命中提示词算知识类', () => {
    expect(isKnowledge(repo({ name: 'awesome-ai-agents' }), CONFIG)).toBe(true);
  });
  it('中文提示词也算', () => {
    expect(isKnowledge(repo({ description: 'LLM 入门教程' }), CONFIG)).toBe(true);
  });
  it('主语言为 Markdown 算知识类', () => {
    expect(isKnowledge(repo({ primaryLanguage: 'Markdown' }), CONFIG)).toBe(true);
  });
  it('主语言为 null 算知识类（纯文档仓库，如 agents.md / llms-txt）', () => {
    expect(isKnowledge(repo({ primaryLanguage: null }), CONFIG)).toBe(true);
  });
  it('正常代码仓库不算', () => { expect(isKnowledge(repo(), CONFIG)).toBe(false); });
  it('提示词只出现在 topics 里也算知识类（教程仓常只打 tag，名字里没线索）', () => {
    expect(isKnowledge(repo({ topics: ['awesome-list'], primaryLanguage: 'Python' }), CONFIG)).toBe(true);
  });
  it('topics 干草堆与 isExcluded 对称 —— 两者都看 topics', () => {
    expect(isKnowledge(repo({ topics: ['cookbook'], primaryLanguage: 'Go' }), CONFIG)).toBe(true);
    expect(isKnowledge(repo({ topics: ['ai-agent'], primaryLanguage: 'Go' }), CONFIG)).toBe(false);
  });
});

describe('classify', () => {
  it('剔除优先于一切，哪怕 topic 全中', () => {
    const r = classify(repo({ isFork: true, topics: ['ai-agent', 'mcp'] }), CONFIG);
    expect(r.kind).toBe('excluded');
  });
  it('分数不足 2（AI 阈值）判为 unrelated', () => {
    expect(classify(repo({ description: 'an LLM toolkit' }), CONFIG).kind).toBe('unrelated');
  });
  it('topic 命中 + 该 topic 字符串自身又命中一个关键词，两者叠加后稳稳超过 AI 阈值 2', () => {
    // 'mcp' 这个 topic 既命中 topics.spec（3 分），其字符串本身又满足关键词 MCP 的词边界
    // （+1 分），合计 4 分——阈值降到 2 之后，这个输入已经不再"刚好卡线"，而是明显超阈值；
    // 真正卡在新阈值上的边界另见下面两条 exactly-2 / exactly-1 的测试。
    const r = classify(repo({ topics: ['mcp'] }), CONFIG);
    expect(r.kind).toBe('ai');
    expect(r.score).toBe(4);
  });
  it('关键词命中封顶 3 分（KEYWORD_CAP，与 AI 阈值 2 无关）同样算 AI 相关', () => {
    expect(classify(repo({ description: 'agent LLM eval' }), CONFIG).kind).toBe('ai');
  });
  it('恰好命中新阈值 2 分（两个关键词、零 topic）判为 ai（阈值边界）', () => {
    const r = classify(repo({ description: 'an agent eval helper', topics: [] }), CONFIG);
    expect(r.score).toBe(2);
    expect(r.kind).toBe('ai');
  });
  it('恰好 1 分（差一分够不着新阈值 2）判为 unrelated（阈值边界另一侧）', () => {
    const r = classify(repo({ description: 'an agent framework', topics: [] }), CONFIG);
    expect(r.score).toBe(1);
    expect(r.kind).toBe('unrelated');
  });
  it('AI 相关 + 知识类 → knowledge，不进主榜', () => {
    const r = classify(repo({ name: 'awesome-mcp', topics: ['mcp'] }), CONFIG);
    expect(r.kind).toBe('knowledge');
    expect(r.score).toBe(4); // topic mcp 得 3 + 名字里词边界命中关键词 MCP 得 1
  });
  it('知识类但与 AI 无关 → unrelated（不进知识栏）', () => {
    expect(classify(repo({ name: 'awesome-cooking' }), CONFIG).kind).toBe('unrelated');
  });
  it('靠 topic 认出的教程仓进知识栏而不是主榜', () => {
    const r = classify(repo({ topics: ['mcp', 'awesome-list'], primaryLanguage: 'Python' }), CONFIG);
    expect(r.kind).toBe('knowledge');
  });
});
