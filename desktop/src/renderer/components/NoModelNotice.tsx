import { KeyRound } from 'lucide-react'

/**
 * 「还没配模型」的引导条。
 *
 * 全新装机时后端以无模型状态启动 —— 能开面板、能存配置，但发不出对话。
 * 此前这个状态在界面上**完全没有表达**：用户只看到一个输入框，打字发出去石沉大海，
 * 控制台里那句 `未找到可用 API Key` 他根本看不到。
 *
 * 所以这条不是装饰，是那个状态唯一的出口：说清现状 + 一键直达配置。
 */
export default function NoModelNotice({ onConfigure }: { onConfigure: () => void }): JSX.Element {
  return (
    <div
      data-testid="no-model-notice"
      className="flex w-full max-w-2xl items-center gap-3 rounded-xl border border-border bg-surface/60 px-4 py-3"
    >
      <KeyRound className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-fg">还没有配置模型</div>
        <div className="mt-0.5 text-3xs text-fg-subtle">填一个 API Key 就能开始对话</div>
      </div>
      <button
        data-testid="no-model-configure"
        onClick={onConfigure}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-2xs text-white transition-opacity hover:opacity-90"
      >
        去配置
      </button>
    </div>
  )
}
