import type { ReactNode } from 'react'

interface WelcomeEmptyStateProps {
  children: ReactNode
}

export default function WelcomeEmptyState({ children }: WelcomeEmptyStateProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <h1 className="mb-2 text-2xl font-semibold text-fg">今天做点什么？</h1>
      <p className="mb-8 text-sm text-fg-muted">
        Wraith 会读代码、跑命令、改文件——先说个目标
      </p>
      <div className="w-full">{children}</div>
    </div>
  )
}
