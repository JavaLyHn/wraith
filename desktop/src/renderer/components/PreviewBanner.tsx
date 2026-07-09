/** 预览态顶部横幅:点它返回正在运行的 live 会话。 */
export default function PreviewBanner({ onReturn }: { onReturn: () => void }): JSX.Element {
  return (
    <button
      data-testid="preview-return-banner"
      onClick={onReturn}
      className="flex w-full items-center gap-2 border-b border-accent/40 bg-accent/10 px-4 py-2 text-left text-xs text-accent hover:bg-accent/20"
    >
      <span aria-hidden>◀</span>
      <span>返回进行中的会话</span>
      <span className="ml-1 flex items-center gap-1 text-fg-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        运行中…
      </span>
    </button>
  )
}
