interface ModelFallbackBannerProps {
  onDismiss: () => void
}

export default function ModelFallbackBanner({ onDismiss }: ModelFallbackBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-xs" data-testid="model-fallback-banner">
      <span className="text-yellow-600 dark:text-yellow-400">⚠ 会话原模型不可用,已回退到默认模型</span>
      <button
        data-testid="model-fallback-dismiss"
        onClick={onDismiss}
        className="rounded-lg border border-yellow-500/60 px-3 py-1 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10"
      >
        知道了
      </button>
    </div>
  )
}
