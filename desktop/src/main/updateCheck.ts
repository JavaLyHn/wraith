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

/**
 * 把 GitHub API 的失败响应转成给用户看的中文文案。
 * 匿名请求限 60/小时/IP,耗尽时 GitHub 返 403 且 x-ratelimit-remaining=0;
 * 此时读 x-ratelimit-reset(epoch 秒)算出还有几分钟重置。其余情况回落到「HTTP <码>」。
 */
export function describeHttpError(
  status: number,
  remaining: string | null,
  resetEpochSec: string | null,
  nowMs: number,
): string {
  if (status === 403 && remaining === '0') {
    const resetSec = parseInt(resetEpochSec || '', 10)
    if (Number.isFinite(resetSec) && resetSec > 0) {
      const mins = Math.max(1, Math.ceil((resetSec * 1000 - nowMs) / 60000))
      return `GitHub 接口访问频繁(匿名限流),请约 ${mins} 分钟后再试`
    }
    return 'GitHub 接口访问频繁(匿名限流),请稍后再试'
  }
  return `HTTP ${status}`
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
