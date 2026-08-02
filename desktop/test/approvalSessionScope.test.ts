import { describe, it, expect } from 'vitest'
import { reduce, initialState, setSessionId } from '../src/shared/transcriptReducer'
import type { BackendEvent } from '../src/shared/types'

function notif(method: string, params: Record<string, unknown>): BackendEvent {
  return { kind: 'notification', method, params } as BackendEvent
}

function approval(over: Record<string, unknown> = {}): BackendEvent {
  return notif('approval.requested', {
    approvalId: 'ap1', toolName: 'execute_command', argsJson: '{}', dangerLevel: 'medium', ...over,
  })
}

/**
 * 定时任务在**后台**跑,它的审批归自动化面板的运行历史内联处理(automations.respondApproval)。
 * 但 daemon 的 approval.requested 走的是同一条 NDJSON 事件流(见 main/index.ts 里 pushBadge 的注释),
 * 于是它也会打进主会话的 reducer → state.pendingApproval → 弹出全屏阻塞的 ApprovalModal。
 *
 * 后果有二:
 *  1. 用户没发起任何对话,却被一个盖住整个界面的模态拦住 —— 它的 Radix 遮罩
 *     (fixed inset-0 z-50 bg-black/40)连自动化面板的 tab 都点不动(shell.e2e T34 就卡在这);
 *  2. 就算点了那个模态的「批准」,它调的是 approval.respond(主会话通道),
 *     而这条审批的正主是 automations.respondApproval —— 两条路不是一回事。
 *
 * 判据用 sessionId:自动化 run 有自己的 sessionId,与当前对话不同。保守起见只在
 * **两边都有且不同**时才忽略 —— 事件不带 sessionId、或本地还没落桩时,一律照旧弹,
 * 免得把交互式审批误杀(那才是真正不能漏的)。
 */
describe('approval.requested 的归属:自动化 vs 交互式', () => {
  // 主判据:approvalId 形状。两边都在代码里定死 ——
  // 交互式 `appr_<n>`(EventStreamRenderer.promptApproval),自动化 `<runId>#<n>`(GatewayDaemon)。
  it('自动化 id(带 #)不弹主会话模态,哪怕本地还没开过会话', () => {
    // 这才是真实场景:开着自动化面板,定时任务到点触发,用户根本没聊过天 → state.sessionId 为空
    const s = reduce(initialState, approval({ approvalId: 'run_3#1', sessionId: 'sess_auto_3' }))
    expect(s.pendingApproval).toBeNull()
  })

  it('交互式 id(appr_n)照常弹', () => {
    const s = reduce(initialState, approval({ approvalId: 'appr_7' }))
    expect(s.pendingApproval?.approvalId).toBe('appr_7')
  })

  it('形状认不出时照弹 —— 失败方向必须朝「多弹」', () => {
    // 漏掉一个交互式审批会让 agent 永远等下去,比多弹一次严重得多
    const s = reduce(initialState, approval({ approvalId: 'something-new-from-a-future-backend' }))
    expect(s.pendingApproval).not.toBeNull()
  })
})

describe('approval.requested 的会话归属(次级判据)', () => {
  it('同会话:照常置 pendingApproval(交互式审批不能被误杀)', () => {
    const s0 = setSessionId(initialState, 'sess-chat')
    const s = reduce(s0, approval({ sessionId: 'sess-chat' }))
    expect(s.pendingApproval?.approvalId).toBe('ap1')
  })

  it('别的会话(后台自动化 run):不弹主会话模态', () => {
    const s0 = setSessionId(initialState, 'sess-chat')
    const s = reduce(s0, approval({ sessionId: 'auto-run-7', approvalId: 'task-1#1' }))
    expect(s.pendingApproval).toBeNull()
  })

  it('别的会话不改动其它任何状态(纯忽略,不是清空)', () => {
    let s = setSessionId(initialState, 'sess-chat')
    s = reduce(s, approval({ sessionId: 'sess-chat' }))       // 先有一个本会话的待审批
    const before = s.pendingApproval
    s = reduce(s, approval({ sessionId: 'auto-run-7', approvalId: 'task-1#1' }))
    expect(s.pendingApproval).toBe(before)                     // 不该被后台那条顶掉
  })

  it('事件不带 sessionId:照旧弹(后端某些路径可能不带,宁可多弹不可漏)', () => {
    const s0 = setSessionId(initialState, 'sess-chat')
    expect(reduce(s0, approval()).pendingApproval?.approvalId).toBe('ap1')
  })

  it('本地还没落桩 sessionId(新会话首轮前):照旧弹', () => {
    expect(reduce(initialState, approval({ sessionId: 'whatever' })).pendingApproval?.approvalId).toBe('ap1')
  })
})
