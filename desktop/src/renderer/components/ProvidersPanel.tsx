export default function ProvidersPanel({ onBack }: { onBack: () => void }): JSX.Element {
  return <div data-testid="providers-panel" className="p-4 text-xs text-fg-muted"><button onClick={onBack}>← 返回</button> Provider 配置(建设中)</div>
}
