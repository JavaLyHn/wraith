import type { SessionMeta } from '../../shared/types'

/** 会话展示名:自定义名优先,其次自动标题,最后兜底。 */
export function sessionDisplayName(s: SessionMeta): string {
  const n = s.name?.trim()
  if (n) return n
  return s.title || '(未命名)'
}

/** 按 starred 拆成两组,各自保持传入顺序(不改 updatedAt 倒序)。 */
export function partitionStarred(sessions: SessionMeta[]): { starred: SessionMeta[]; rest: SessionMeta[] } {
  const starred: SessionMeta[] = []
  const rest: SessionMeta[] = []
  for (const s of sessions) (s.starred ? starred : rest).push(s)
  return { starred, rest }
}
