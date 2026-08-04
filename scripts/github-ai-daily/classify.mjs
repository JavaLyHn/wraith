/** @typedef {{fullName:string, owner:string, ownerType:'User'|'Organization', name:string,
 *  description:string|null, topics:string[], stars:number, forks:number, watchers:number,
 *  primaryLanguage:string|null, isFork:boolean, isArchived:boolean,
 *  pushedAt:string, createdAt:string}} Repo */

const TOPIC_POINTS = 3;
const TOPIC_CAP = 6;
const KEYWORD_POINTS = 1;
const KEYWORD_CAP = 3;
const AI_THRESHOLD = 2; // 与 config.default.json 的 aiThreshold 保持同一个默认值，不留两套数字

const isAscii = (s) => /^[\x20-\x7E]+$/.test(s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchesKeyword(haystack, keyword) {
  if (!haystack || !keyword) return false;
  const text = String(haystack);
  if (!isAscii(keyword)) return text.toLowerCase().includes(keyword.toLowerCase());
  return new RegExp(`(^|[^a-z0-9])${escapeRe(keyword)}([^a-z0-9]|$)`, 'i').test(text);
}

const allTopics = (config) => Object.values(config.topics ?? {}).flat();
const haystacks = (repo) => [repo.name ?? '', repo.description ?? '', repo.fullName ?? ''];

export function scoreRepo(repo, config) {
  const wanted = new Set(allTopics(config).map((t) => t.toLowerCase()));
  const topicHits = (repo.topics ?? []).filter((t) => wanted.has(String(t).toLowerCase()));
  // 关键词干草堆也带上 topics —— 与 isExcluded/isKnowledge 保持一致。真实数据里最重要的
  // 几个仓库反而打得最少（whisper.cpp 一个 topic 都没进配置，llama.cpp 只挂了 ggml），
  // 但它们的 topics 里常常字面写着 inference/transformer 这类已经在 keywords.include
  // 里的词——旧代码只扫 name/description/fullName，白白放过了这个信号。
  const fields = [...haystacks(repo), ...(repo.topics ?? [])];
  const keywordHits = (config.keywords?.include ?? [])
    .filter((k) => fields.some((h) => matchesKeyword(h, k)));
  const score = Math.min(topicHits.length * TOPIC_POINTS, TOPIC_CAP)
              + Math.min(keywordHits.length * KEYWORD_POINTS, KEYWORD_CAP);
  return { score, topicHits, keywordHits };
}

export function isExcluded(repo, config) {
  if (repo.isFork || repo.isArchived) return true;
  const fields = [...haystacks(repo), ...(repo.topics ?? [])];
  return (config.keywords?.exclude ?? []).some((k) => fields.some((h) => matchesKeyword(h, k)));
}

export function isKnowledge(repo, config) {
  const lang = repo.primaryLanguage;
  if (lang === null || lang === undefined || String(lang).toLowerCase() === 'markdown') return true;
  // 与 isExcluded 对称：topics 也进干草堆。只打了 tag、名字/简介里没线索的教程仓
  // （比如某些 awesome-list）不然会溜进主榜而不是知识栏。
  const fields = [...haystacks(repo), ...(repo.topics ?? [])];
  return (config.knowledgeRepoHints ?? []).some((h) => fields.some((x) => matchesKeyword(x, h)));
}

export function classify(repo, config) {
  const scored = scoreRepo(repo, config);
  if (isExcluded(repo, config)) return { kind: 'excluded', ...scored };
  const threshold = config.aiThreshold ?? AI_THRESHOLD;
  if (scored.score < threshold) return { kind: 'unrelated', ...scored };
  return { kind: isKnowledge(repo, config) ? 'knowledge' : 'ai', ...scored };
}
