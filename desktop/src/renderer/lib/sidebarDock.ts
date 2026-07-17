export const HOTZONE_PX = 8        // 折叠态左缘触发热区宽度(px)
export const SIDEBAR_WIDTH = 240   // 展开态占位宽(= aside 的 w-60)
export const DOCK_ANIM_MS = 200    // 划入/划出与折叠动画时长(ms)

/** 折叠占位宽:展开 240,折叠 0(配合 transition-[width] 做丝滑收展)。 */
export function dockPlaceholderWidth(collapsed: boolean): number {
  return collapsed ? 0 : SIDEBAR_WIDTH
}

/** 承 <Sidebar/> 的内层 wrapper 的定位/动画类,编码三态(恒绝对定位,展开/收起双向滑动):
 *  展开 → translate-x-0(占位 240 推挤内容,视觉与流内等价);
 *  折叠 → 浮层滑出;peek 控制丝滑滑入/滑出。 */
export function dockInnerClass(collapsed: boolean, peek: boolean): string {
  const base = 'absolute left-0 top-0 h-full w-60 transition-transform duration-200 ease-out motion-reduce:transition-none'
  if (!collapsed) return base + ' translate-x-0'
  const overlay = base + ' z-50 rounded-r-xl shadow-2xl'
  return peek ? overlay + ' translate-x-0' : overlay + ' -translate-x-full pointer-events-none'
}
