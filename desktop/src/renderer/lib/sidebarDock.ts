export const HOTZONE_PX = 8        // 折叠态左缘触发热区宽度(px)
export const SIDEBAR_WIDTH = 240   // 展开态占位宽(= aside 的 w-60)
export const DOCK_ANIM_MS = 200    // 划入/划出与折叠动画时长(ms)

/** 折叠占位宽:展开 240,折叠 0(配合 transition-[width] 做丝滑收展)。 */
export function dockPlaceholderWidth(collapsed: boolean): number {
  return collapsed ? 0 : SIDEBAR_WIDTH
}

/** 承 <Sidebar/> 的内层 wrapper 的定位/动画类,编码三态:
 *  展开 → 流内;折叠 → 绝对浮层,peek 控制丝滑滑入/滑出(始终 absolute 以保证 transform 过渡生效)。 */
export function dockInnerClass(collapsed: boolean, peek: boolean): string {
  if (!collapsed) return 'h-full w-60'
  const base = 'absolute left-0 top-0 z-50 h-full w-60 rounded-r-xl shadow-2xl transition-transform duration-200 ease-out'
  return peek ? base + ' translate-x-0' : base + ' -translate-x-full pointer-events-none'
}
