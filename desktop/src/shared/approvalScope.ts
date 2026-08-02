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
 * ⚠ **绝对不要在这里加 sessionId 判据**,哪怕只当次级、哪怕写成"两边都有才生效"。
 *
 * 试过一次,当场把交互式审批打死了:
 *   - AppServer.sessionId 在第一次 turn.completed 时被换成持久化 id(sess_… → 20260703T…),
 *     此后 turn.started 带的是新 id;
 *   - 但 EventStreamRenderer.sessionId 是 `private final`,构造时定死永不更新,
 *     approval.requested 里带的一直是那个旧的 sess_…。
 * 于是从**第二轮**起两者必然不等 → 审批被吞 → 弹窗不出现 → 工具卡停在 running、轮次永远等下去。
 * (notificationFilter.ts 里记了一整段的就是这个雷,MULTI_SESSION_FILTER_ENABLED 至今为 false。)
 *
 * 只用 id 形状。它不依赖任何会话状态,也就踩不到换号问题。
 */
export function shouldPopChatApproval(approvalId: string): boolean {
  return !isAutomationApprovalId(approvalId)
}
