interface SubmitErrorBannerProps {
  message: string
  onDismiss: () => void
}

export default function SubmitErrorBanner({ message, onDismiss }: SubmitErrorBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-xs" data-testid="submit-error">
      <span className="text-red-600 dark:text-red-400">✕ {message}</span>
      <button
        data-testid="submit-error-dismiss"
        onClick={onDismiss}
        className="rounded-lg border border-red-500/60 px-3 py-1 text-red-600 dark:text-red-400 hover:bg-red-500/10"
      >
        知道了
      </button>
    </div>
  )
}
