/**
 * 一条 approval.requested 是不是该弹主会话那个全屏阻塞模态。
 *
 * 背景:后台定时任务的审批也会打进同一条 NDJSON 事件流,于是用户没发起任何对话,却被一个
 * 盖住整个界面的模态拦住 —— 它的 Radix 遮罩连自动化面板的 tab 都点不动。而这条审批的正主是
 * 面板运行历史里的内联批准(automations.respondApproval),跟主会话的 approval.respond 不是一条路。
 *
 * 判据用 approvalId 的形状,两边都在代码里定死:
 *   - 交互式:`appr_<n>`     —— EventStreamRenderer.promptApproval
 *   - 自动化:`<runId>#<n>`  —— GatewayDaemon(runId + "#" + counter)
 * 不用 sessionId 作主判据:v1 里会话 id 会在 turn.completed 时从 sess_… 换成持久化 id
 * (见 notificationFilter.ts 那段长注释),拿它过滤会误杀第二轮起的交互式审批 —— 而漏掉一个
 * 交互式审批会让 agent 永远等下去,比多弹一次严重得多。
 *
 * **失败方向刻意朝"多弹"**:认不出的形状一律当交互式处理。
 */
export function isAutomationApprovalId(approvalId: string): boolean {
  return approvalId.includes('#')
}

/**
 * @param approvalId        事件里的 approvalId
 * @param eventSessionId    事件里的 sessionId(可能没有)
 * @param currentSessionId  本地记录的当前会话(新会话首轮前为空)
 */
export function shouldPopChatApproval(
  approvalId: string,
  eventSessionId: string,
  currentSessionId: string,
): boolean {
  if (isAutomationApprovalId(approvalId)) return false
  // 次级判据:两边都有会话 id 且不同 → 不是这个会话的事。任一为空就放行(fail-open)。
  if (eventSessionId && currentSessionId && eventSessionId !== currentSessionId) return false
  return true
}
