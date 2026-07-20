import type { CSSProperties, ReactNode } from 'react'
import Logo from './Logo'
// 闪光的 mask 图:用 WR logo 的 alpha 形状(dark/light 两版形状一致,取其一即可)把闪光
// 限制在 WR 字样内。作为 CSS 变量注入,供 tokens.css 的 .welcome-logo::after mask 使用。
import logoMask from '../assets/logo-dark.png'

/** 首页空态:主题感知 logo(闪光+悬停动效)+ 随机示例卡(点卡直接发送)+ composer。 */
export default function WelcomeEmptyState(
  { examples, onPickExample, children }:
  { examples: string[]; onPickExample: (text: string) => void; children: ReactNode },
): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="welcome-logo mb-4" style={{ '--wr-logo-mask': `url(${logoMask})` } as CSSProperties}><Logo className="h-16 w-16 object-contain" /></div>
      <h1 className="mb-6 text-2xl font-semibold text-fg">今天做点什么？</h1>
      {examples.length > 0 && (
        <div className="mb-8 flex w-full max-w-2xl flex-wrap justify-center gap-2">
          {examples.map((ex) => (
            <button key={ex} data-testid="welcome-example" onClick={() => onPickExample(ex)}
              className="rounded-xl border border-border bg-surface/60 px-3 py-2 text-xs text-fg-muted transition-all hover:-translate-y-0.5 hover:border-accent hover:text-fg hover:shadow-md">
              {ex}
            </button>
          ))}
        </div>
      )}
      <div className="w-full">{children}</div>
    </div>
  )
}
