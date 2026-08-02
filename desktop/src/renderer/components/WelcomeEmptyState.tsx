import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import Logo from './Logo'
import type { PromptCategory } from '../lib/welcomePrompts'
// 闪光的 mask 图:用 WR logo 的 alpha 形状(dark/light 两版形状一致,取其一即可)把闪光
// 限制在 WR 字样内。作为 CSS 变量注入,供 tokens.css 的 .welcome-logo::after mask 使用。
import logoMask from '../assets/logo-dark.png'

const CHIP = 'rounded-xl border border-border bg-surface/60 px-3 py-2 text-xs text-fg-muted '
  + 'transition-all hover:-translate-y-0.5 hover:border-accent hover:text-fg hover:shadow-md'

/**
 * 首页空态:主题感知 logo + 示例芯片 + composer。
 *
 * 示例是**两级**的:先选类别,再选一条具体建议。旧版是一排以冒号结尾的半句
 * (「重构这个函数,让它更清晰:」),点一下只把半句填进输入框,冒号后面填什么还得用户自己想 ——
 * 而这个页面服务的正是"还不知道能让它干什么"的时刻。现在每条叶子都是完整可跑的一句话。
 *
 * `notices` 是"这里虽然还没开始对话,但外面发生了点事"的插槽 —— 目前只有后台任务完成药丸。
 * 不把空态整个换成 Transcript:一条后台通知就让示例卡与 logo 消失,那个交换不划算;
 * 但通知也不能丢(否则从面板提交任务后回到新会话,完成与否无从得知)。
 */
export default function WelcomeEmptyState(
  { categories, onPickExample, children, notices }:
  {
    categories: PromptCategory[]
    onPickExample: (text: string) => void
    children: ReactNode
    notices?: ReactNode
  },
): JSX.Element {
  const [openCategory, setOpenCategory] = useState<PromptCategory | null>(null)

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="welcome-logo mb-4" style={{ '--wr-logo-mask': `url(${logoMask})` } as CSSProperties}><Logo className="h-16 w-16 object-contain" /></div>
      <h1 className="mb-6 text-2xl font-semibold text-fg">今天做点什么？</h1>

      {categories.length > 0 && (
        <div className="mb-8 flex w-full max-w-2xl flex-col items-center gap-2">
          {openCategory === null ? (
            <div className="flex flex-wrap justify-center gap-2">
              {categories.map((c) => (
                <button key={c.label} data-testid="welcome-category" onClick={() => setOpenCategory(c)} className={CHIP}>
                  {c.label}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-3xs text-fg-subtle">
                <button data-testid="welcome-back" onClick={() => setOpenCategory(null)}
                  aria-label="返回类别"
                  className="flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-fg-muted transition-colors hover:text-accent">
                  <ChevronLeft className="h-3 w-3" strokeWidth={1.5} />返回
                </button>
                <span>{openCategory.label}</span>
              </div>
              <div className="flex flex-col items-stretch gap-2">
                {openCategory.prompts.map((p) => (
                  <button key={p} data-testid="welcome-example" onClick={() => onPickExample(p)}
                    className={CHIP + ' text-left'}>
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}
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
