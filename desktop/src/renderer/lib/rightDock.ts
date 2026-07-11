/** 右侧列宽度夹紧:min 320px,max = max(320, 0.7*窗宽)。 */
export function clampColumnWidth(px: number, winW: number): number {
  const hi = Math.max(320, Math.round(winW * 0.7))
  return Math.max(320, Math.min(hi, px))
}

/** 地址栏输入 → 可导航 URL:空→about:blank;已带协议(或 about:)原样;否则补 https://。 */
export function normalizeUrl(input: string): string {
  const t = (input || '').trim()
  if (!t) return 'about:blank'
  if (/^[a-zA-Z][\w+.-]*:\/\//.test(t) || t.startsWith('about:')) return t
  return 'https://' + t
}
