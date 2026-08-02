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

/**
 * 回归钉子 —— 我第一版加了 sessionId 次级判据(「两边都有且不同才忽略」,自以为很保守),
 * 当场把交互式审批打死了:
 *   AppServer.sessionId 在首次 turn.completed 换成持久化 id,此后 turn.started 带新 id;
 *   而 EventStreamRenderer.sessionId 是 private final,approval.requested 里一直是旧的 sess_…。
 * 从第二轮起两者必然不等 → 审批被吞 → 弹窗不出现 → 工具卡停在 running、轮次永远等下去。
 * 症状极隐蔽:第一轮完全正常,第二轮才挂。
 */
describe('sessionId 不得参与判定(交互式审批不能被吞)', () => {
  it('sessionId 与本地记录不一致时,仍然要弹', () => {
    const s0 = setSessionId(initialState, '20260803T091500-abc')   // 首轮后换成的持久化 id
    const s = reduce(s0, approval({ approvalId: 'appr_2', sessionId: 'sess_9f3c' })) // 渲染器里定死的旧 id
    expect(s.pendingApproval?.approvalId).toBe('appr_2')
  })

  it('同会话照常弹', () => {
    const s0 = setSessionId(initialState, 'sess-chat')
    expect(reduce(s0, approval({ sessionId: 'sess-chat' })).pendingApproval?.approvalId).toBe('ap1')
  })

  it('自动化 id 即便 sessionId 与本地一致也不弹(形状说了算)', () => {
    const s0 = setSessionId(initialState, 'sess-chat')
    expect(reduce(s0, approval({ approvalId: 'run_3#1', sessionId: 'sess-chat' })).pendingApproval).toBeNull()
  })

  it('后台那条不该顶掉已有的待审批(纯忽略,不是清空)', () => {
    let s = setSessionId(initialState, 'sess-chat')
    s = reduce(s, approval({ approvalId: 'appr_1' }))
    const before = s.pendingApproval
    s = reduce(s, approval({ approvalId: 'run_3#1' }))
    expect(s.pendingApproval).toBe(before)
  })
})
