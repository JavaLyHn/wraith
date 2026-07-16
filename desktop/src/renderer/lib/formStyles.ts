// 软卡片视觉语言(2026-07-16 spec):层次靠深浅不靠描边。全 app panel/form 共享。
export const CARD = 'flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-sm'
export const SECTION_TITLE = 'text-2xs font-semibold uppercase tracking-wider text-fg-subtle'
/** 卡内控件:灰填充无边框,focus 亮 accent;透明边框防聚焦时尺寸跳动。 */
export const INPUT = 'mt-1 w-full rounded-lg border border-transparent bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent'
/** 裸在灰底上(无卡片包裹)的控件:反相用白填充。 */
export const INPUT_ON_BG = 'mt-1 w-full rounded-lg border border-transparent bg-surface px-3 py-2 text-xs text-fg outline-none focus:border-accent'
export const BTN_PRIMARY = 'rounded-lg bg-accent px-4 py-2 text-xs text-accent-fg hover:opacity-90 disabled:opacity-60'
export const BTN_GHOST = 'rounded-lg px-4 py-2 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-40'
export const BTN_DANGER_GHOST = 'rounded-lg px-4 py-2 text-xs text-danger hover:bg-danger/10 disabled:opacity-40'

/** 面板内容区窄于此(px)切单栏 + 任务芯片条。 */
export const NARROW_LAYOUT_PX = 640
/** width 为 0/未测量时返回 false(宽),避免初帧闪单栏。 */
export function isNarrowLayout(width: number): boolean {
  return width > 0 && width < NARROW_LAYOUT_PX
}
