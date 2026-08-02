import type { CSSProperties, ReactNode } from 'react'
import Logo from './Logo'
// 闪光的 mask 图:用 WR logo 的 alpha 形状(dark/light 两版形状一致,取其一即可)把闪光
// 限制在 WR 字样内。作为 CSS 变量注入,供 tokens.css 的 .welcome-logo::after mask 使用。
import logoMask from '../assets/logo-dark.png'

/**
 * 首页空态:主题感知 logo(闪光+悬停动效)+ 随机示例卡(点卡直接发送)+ composer。
 *
 * `notices` 是"这里虽然还没开始对话,但外面发生了点事"的插槽 —— 目前只有后台任务完成药丸。
 * 不把空态整个换成 Transcript:一条后台通知就让示例卡与 logo 消失,那个交换不划算;
 * 但通知也不能丢(否则从面板提交任务后回到新会话,完成与否无从得知)。
 */
export default function WelcomeEmptyState(
  { examples, onPickExample, children, notices }:
  { examples: string[]; onPickExample: (text: string) => void; children: ReactNode; notices?: ReactNode },
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
      {notices && (
        <div data-testid="welcome-notices" className="mb-3 flex w-full max-w-2xl flex-col items-center gap-2">
          {notices}
        </div>
      )}
      <div className="w-full">{children}</div>
    </div>
  )
}
