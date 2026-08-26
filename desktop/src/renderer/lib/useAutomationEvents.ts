import { useEffect } from 'react'

/**
 * 自动化事件订阅 hook:监听主进程推送的自动化事件。
 *
 * 处理 badge(红点)/approval(审批缓存)/open-panel(自动跳转)/runs-changed(刷新列表)。
 */
export function useAutomationEvents(params: {
  onBadge: (show: boolean) => void
  onApproval: (evt: { runId?: string; payload: Record<string, unknown> }) => void
  onOpenPanel: () => void
  onRunsChanged: () => void
}): void {
  const { onBadge, onApproval, onOpenPanel, onRunsChanged } = params

  useEffect(() => {
    const unsub = window.wraith.onAutomationEvent(evt => {
      if (evt.kind === 'badge') onBadge(evt.show)
      if (evt.kind === 'approval') {
        // I-4: 审批 push 只缓存 payload,不强弹(spec §1.1-4/§6.2:通知+红点+运行历史「处理审批」,
        // 用户在面板主动点开 ApprovalModal)。badge 与 OS 通知已由 main 侧推送,renderer 无需动作。
        onApproval({ runId: evt.runId, payload: evt.payload })
      }
      if (evt.kind === 'open-panel') onOpenPanel()
      if (evt.kind === 'runs-changed') onRunsChanged()
    })
    return unsub
  }, [onBadge, onApproval, onOpenPanel, onRunsChanged])
}
