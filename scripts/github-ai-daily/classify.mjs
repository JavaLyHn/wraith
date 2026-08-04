/** @typedef {{fullName:string, owner:string, ownerType:'User'|'Organization', name:string,
 *  description:string|null, topics:string[], stars:number, forks:number, watchers:number,
 *  primaryLanguage:string|null, isFork:boolean, isArchived:boolean,
 *  pushedAt:string, createdAt:string}} Repo */

const TOPIC_POINTS = 3;
const TOPIC_CAP = 6;
const KEYWORD_POINTS = 1;
const KEYWORD_CAP = 3;
const AI_THRESHOLD = 3;

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
  const topicHitsLower = new Set(topicHits.map((t) => String(t).toLowerCase()));
  const keywordHits = (config.keywords?.include ?? [])
    .filter((k) => !topicHitsLower.has(k.toLowerCase()) && haystacks(repo).some((h) => matchesKeyword(h, k)));
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
  return (config.knowledgeRepoHints ?? []).some((h) => haystacks(repo).some((x) => matchesKeyword(x, h)));
}

export function classify(repo, config) {
  const scored = scoreRepo(repo, config);
  if (isExcluded(repo, config)) return { kind: 'excluded', ...scored };
  if (scored.score < AI_THRESHOLD) return { kind: 'unrelated', ...scored };
  return { kind: isKnowledge(repo, config) ? 'knowledge' : 'ai', ...scored };
}
