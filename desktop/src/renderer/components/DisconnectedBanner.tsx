interface DisconnectedBannerProps {
  onRestart: () => void
}

export default function DisconnectedBanner({ onRestart }: DisconnectedBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs">
      <span className="text-danger">⚡ 后端连接断开</span>
      <button
        data-testid="restart"
        onClick={onRestart}
        className="rounded-lg border border-danger px-3 py-1 text-danger hover:bg-danger/10"
      >
        重新连接
      </button>
    </div>
  )
}
