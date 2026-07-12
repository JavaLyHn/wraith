import type { ReactNode } from 'react'
import { dockInnerClass, dockPlaceholderWidth, HOTZONE_PX } from '../lib/sidebarDock'

/** 侧栏折叠壳:承单个 <Sidebar/>(children)。展开态在布局流内推挤主内容;折叠态内层变绝对浮层,
 * peek 控制丝滑滑入/滑出;折叠态左缘 8px 热区 mouseenter → 划出。受控:collapsed/peek 由 App 持有,
 * 切换只改 wrapper 类,children(<Sidebar/>)不 remount,保留其内部状态。 */
export default function SidebarDock(
  { collapsed, peek, onPeekChange, children }:
  { collapsed: boolean; peek: boolean; onPeekChange: (v: boolean) => void; children: ReactNode },
): JSX.Element {
  return (
    <>
      {/* 流内占位:展开 240 推挤内容,折叠 0 让内容占满;宽度过渡做丝滑收展。不设 overflow-hidden,
          以便折叠态内层浮层(absolute)能溢出显示。 */}
      <div
        data-testid="sidebar-dock"
        className="relative h-full shrink-0 transition-[width] duration-200 ease-out"
        style={{ width: dockPlaceholderWidth(collapsed) }}
      >
        <div
          className={dockInnerClass(collapsed, peek)}
          onMouseLeave={() => { if (collapsed) onPeekChange(false) }}
        >
          {children}
        </div>
      </div>
      {/* 折叠态左缘热区:进入 → 划出浮层 */}
      {collapsed && (
        <div
          data-testid="sidebar-hotzone"
          className="fixed left-0 top-0 z-40 h-full"
          style={{ width: HOTZONE_PX }}
          onMouseEnter={() => onPeekChange(true)}
        />
      )}
    </>
  )
}
