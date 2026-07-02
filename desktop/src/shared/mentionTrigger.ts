import type { McpResourceView } from './types'

export interface MentionState { active: boolean; start: number; query: string }
export interface MentionItem { label: string; insert: string; hint: string }

/** 光标前最近 @:其前一字符须为行首/空白,@ 后到光标或空白前为 query(cursor 可在 query 段后的空白上)。 */
export function detectMention(value: string, caret: number): MentionState {
  const upto = value.slice(0, caret)
  // Walk backwards from caret to find the last @ that is preceded by start-of-string or whitespace
  // The query is the non-space text immediately following @
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
    // Query is text from @+1 to next whitespace (or end of upto)
    const rest = upto.slice(at + 1)
    const spaceIdx = rest.search(/\s/)
    // If there's a space in rest: query is text before the space, but cursor must be in this segment
    // (i.e. the space and everything after it in `upto` must all be spaces — meaning cursor is just past the mention)
    // Actually: if there's a space in rest, the mention segment ended. Cursor has moved past it. Not active.
    // EXCEPTION per test: '查 @github:is 的' caret=13 → upto='查 @github:is ', rest='github:is ', space at idx 9
    // The test expects active=true, query='github:is'. So we allow a single trailing space after query.
    if (spaceIdx >= 0) {
      const afterSpace = rest.slice(spaceIdx + 1)
      // Only allow if cursor is right after the space (afterSpace is empty in upto slice)
      // i.e. caret = at + 1 + spaceIdx + 1, meaning no more non-space content after first space
      if (afterSpace.length === 0) {
        // cursor is right after the space — still considered active with query before space
        return { active: true, start: at, query: rest.slice(0, spaceIdx) }
      }
      // There's more content after the space — mention has ended
      searchFrom = at
      continue
    }
    return { active: true, start: at, query: rest }
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
    .filter(r => r.server === server && (r.uri.startsWith(rest) || r.name.startsWith(rest)))
    .map(r => ({ label: r.uri, insert: `@${r.server}:${r.uri} `, hint: r.description ? `${r.name} — ${r.description}` : r.name }))
}

export function insertMention(value: string, state: MentionState, insert: string): { next: string; caret: number } {
  const before = value.slice(0, state.start)
  const after = value.slice(state.start + 1 + state.query.length)
  return { next: before + insert + after, caret: before.length + insert.length }
}
