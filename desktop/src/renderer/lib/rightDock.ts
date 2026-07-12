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

/** 内嵌浏览器缩放适宽的目标桌面宽度(px):窄面板按此宽布局再整体缩放填满。 */
export const FIT_TARGET_WIDTH = 1000
/** 缩放下限:避免极窄面板把页面缩到不可读。 */
export const FIT_MIN_ZOOM = 0.5

/**
 * 自动适宽缩放因子:令 guest 视口 ≈ target(setZoomFactor 里 z<1 会放大 CSS 视口,innerWidth≈宿主宽/z)。
 * z = 面板宽/target,夹在 [FIT_MIN_ZOOM, 1]:面板≥target 不缩(z=1);越窄缩得越多但不低于下限;
 * 非法宽度(≤0)返回 1(安全)。
 */
export function fitZoom(panelWidth: number, target: number = FIT_TARGET_WIDTH): number {
  if (!(panelWidth > 0) || !(target > 0)) return 1
  return Math.min(1, Math.max(FIT_MIN_ZOOM, panelWidth / target))
}
