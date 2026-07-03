import type { McpResourceView } from './types'

export interface MentionState { active: boolean; start: number; query: string }
export interface MentionItem { label: string; insert: string; hint: string }

/** 光标前最近 @:其前一字符须为行首/空白;query = @+1 到光标;query 含任意空白 → 失活。 */
export function detectMention(value: string, caret: number): MentionState {
  const upto = value.slice(0, caret)
  // Walk backwards from caret to find the last @ that is preceded by start-of-string or whitespace
  let searchFrom = caret
  while (searchFrom > 0) {
    const at = upto.lastIndexOf('@', searchFrom - 1)
    if (at < 0) return { active: false, start: 0, query: '' }
    // Check char before @
    if (at > 0 && !/\s/.test(upto[at - 1]!)) {
      // @ is preceded by non-space: not a valid mention trigger, keep searching
      searchFrom = at
      continue
    }
    // Query is text from @+1 to caret
    const query = upto.slice(at + 1)
    // Any whitespace in query terminates the mention (strict semantics — trailing space = inactive)
    if (/\s/.test(query)) {
      searchFrom = at
      continue
    }
    return { active: true, start: at, query }
  }
  return { active: false, start: 0, query: '' }
}

/** 两级:query 无冒号 → server 一级(前缀滤+去重);有冒号 → 该 server 资源(uri/name 前缀滤)。 */
export function filterMentionItems(resources: McpResourceView[], query: string): MentionItem[] {
  const colon = query.indexOf(':')
  if (colon < 0) {
    const seen = new Set<string>()
    const out: MentionItem[] = []
    for (const r of resources) {
      if (!r.server.startsWith(query) || seen.has(r.server)) continue
      seen.add(r.server)
      out.push({ label: r.server, insert: `@${r.server}:`, hint: 'server' })
    }
    return out
  }
  const server = query.slice(0, colon)
  const rest = query.slice(colon + 1)
  return resources
    .filter(r => r.server === server && r.uri && r.uri.trim() !== '' && (r.uri.startsWith(rest) || r.name.startsWith(rest)))
    .map(r => ({ label: r.uri, insert: `@${r.server}:${r.uri} `, hint: r.description ? `${r.name} — ${r.description}` : r.name }))
}

export function insertMention(value: string, state: MentionState, insert: string): { next: string; caret: number } {
  const before = value.slice(0, state.start)
  const after = value.slice(state.start + 1 + state.query.length)
  return { next: before + insert + after, caret: before.length + insert.length }
}
