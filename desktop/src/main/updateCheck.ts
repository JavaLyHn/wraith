export interface GhRelease { tag_name: string; html_url: string; draft: boolean; prerelease: boolean }
export interface UpdateResult {
  current: string
  latest: string | null
  hasUpdate: boolean
  url: string | null
  isPrerelease: boolean
  error?: string
}

/** 极简 semver 比较:a>b→1,a<b→-1,相等→0。去 v 前缀、按 x.y.z 数值,忽略预发标记的细粒度排序。 */
export function semverCompare(a: string, b: string): number {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d !== 0) return d > 0 ? 1 : -1 }
  return 0
}

export function computeUpdate(current: string, releases: GhRelease[], includeBeta: boolean): UpdateResult {
  const usable = (releases || []).filter(
    (r) => r && !r.draft && (includeBeta || !r.prerelease) && typeof r.tag_name === 'string',
  )
  let best: GhRelease | null = null
  for (const r of usable) if (!best || semverCompare(r.tag_name, best.tag_name) > 0) best = r
  const latest = best ? best.tag_name.replace(/^v/, '').split('-')[0] : null
  const hasUpdate = !!latest && semverCompare(latest, current) > 0
  return { current, latest, hasUpdate, url: best ? best.html_url : null, isPrerelease: !!best && best.prerelease }
}

/** 语义化版本比较:latest 是否严格新于 current。剥离前导 v;非法串一律 false(不误报)。 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = String(v ?? '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = parse(latest), b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}
