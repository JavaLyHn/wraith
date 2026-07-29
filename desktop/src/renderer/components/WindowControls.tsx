import { useEffect, useState } from 'react'
import { shouldShowWindowControls } from '../lib/topBar'

const wc = (): Window['wraith']['windowControls'] => window.wraith.windowControls

function MinIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" /></svg>
}
function MaxIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.4" y="1.4" width="7.2" height="7.2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
}
function RestoreIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="2.8" width="6.2" height="6.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.1 2.8 V1 H9 V6.9" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
function CloseIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.6 1.6 L8.4 8.4 M8.4 1.6 L1.6 8.4" stroke="currentColor" strokeWidth="1.2" /></svg>
}

/** Windows 自绘窗口控制键(最小/最大-还原/关闭)。仅 win32 渲染;mac(交通灯)/Linux(系统窗框)返回 null。
 *  混合风:位置/行为按 Windows(右上、贴角、close 悬停红),字形用 wraith 单色墨、非 close 键 hover 圆润淡底。 */
export default function WindowControls({ platform }: { platform: string }): JSX.Element | null {
  const show = shouldShowWindowControls(platform)
  const [isMax, setIsMax] = useState(false)

  useEffect(() => {
    if (!show) return
    let alive = true
    // changed 防陈旧覆盖:若初次 isMaximized() 还没落地时就先收到一次实时 onMaximizeChange,
    // 后到的初次查询结果已经过期,不能再拿它去覆盖更新的实时值。
    let changed = false
    void wc().isMaximized().then(m => { if (alive && !changed) setIsMax(m) })
    const off = wc().onMaximizeChange(m => { changed = true; setIsMax(m) })
    return () => { alive = false; off() }
  }, [show])

  if (!show) return null

  const base = 'flex h-[38px] w-[46px] items-center justify-center [-webkit-app-region:no-drag] text-fg-muted transition-colors duration-100'
  const soft = ' hover:bg-fg/[0.08] hover:text-fg'
  return (
    <div data-testid="window-controls" className="flex items-stretch">
      <button data-testid="win-minimize" aria-label="最小化" title="最小化" onClick={() => wc().minimize()} className={base + soft}><MinIcon /></button>
      <button data-testid="win-maximize" aria-label={isMax ? '还原' : '最大化'} title={isMax ? '还原' : '最大化'} data-max-state={isMax ? 'maximized' : 'normal'} onClick={() => wc().toggleMaximize()} className={base + soft}>{isMax ? <RestoreIcon /> : <MaxIcon />}</button>
      <button data-testid="win-close" aria-label="关闭" title="关闭" onClick={() => wc().close()} className={base + ' hover:bg-red-600 hover:text-white'}><CloseIcon /></button>
    </div>
  )
}
