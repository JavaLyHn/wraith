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
  it('单个 topic 命中给 3 分', () => {
    const r = scoreRepo(repo({ topics: ['ai-agent'] }), CONFIG);
    expect(r.score).toBe(3);
    expect(r.topicHits).toEqual(['ai-agent']);
  });
  it('topic 分数上限 6，三个命中也只算 6', () => {
    expect(scoreRepo(repo({ topics: ['ai-agent', 'agentic', 'mcp'] }), CONFIG).score).toBe(6);
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
});

describe('classify', () => {
  it('剔除优先于一切，哪怕 topic 全中', () => {
    const r = classify(repo({ isFork: true, topics: ['ai-agent', 'mcp'] }), CONFIG);
    expect(r.kind).toBe('excluded');
  });
  it('分数不足 3 判为 unrelated', () => {
    expect(classify(repo({ description: 'an LLM toolkit' }), CONFIG).kind).toBe('unrelated');
  });
  it('刚好 3 分即算 AI 相关（阈值边界）', () => {
    expect(classify(repo({ topics: ['mcp'] }), CONFIG).kind).toBe('ai');
  });
  it('关键词凑满 3 分也算 AI 相关', () => {
    expect(classify(repo({ description: 'agent LLM eval' }), CONFIG).kind).toBe('ai');
  });
  it('AI 相关 + 知识类 → knowledge，不进主榜', () => {
    const r = classify(repo({ name: 'awesome-mcp', topics: ['mcp'] }), CONFIG);
    expect(r.kind).toBe('knowledge');
    expect(r.score).toBe(4); // topic mcp 得 3 + 名字里词边界命中关键词 MCP 得 1
  });
  it('知识类但与 AI 无关 → unrelated（不进知识栏）', () => {
    expect(classify(repo({ name: 'awesome-cooking' }), CONFIG).kind).toBe('unrelated');
  });
});
