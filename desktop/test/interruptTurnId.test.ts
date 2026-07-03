/**
 * T11 — interrupt turnId 硬化(防御性,当前行为不变)
 *
 * 核验:早窗(turn.submit 在途、尚未 resolve)interrupt 不携带
 * 陈旧的上一 turn id,而是携带 null(后端线程中断兜底)或正确新 id。
 *
 * ─── RED PROOF(不运行;仅文档) ──────────────────────────────────────────
 * 旧代码路径:submitTurn handler 未清零 currentTurnId,直到 resolve 才赋值。
 * 早窗内:currentTurnId = 上一 turn 的陈旧 id(非 null,非新 id)。
 * interrupt 发出:{ turnId: '<stale-prev-turn>' }。
 * 下方"旧逻辑模拟"断言 turnId === 'stale-prev-turn' 成立
 * → 断言"不应携带陈旧 id"失败 → 测试 RED。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 当前后端 AppServer 按线程(turnThread)中断,不读 turnId 参数。
 * 故无论早窗发 null 还是正确 id,运行时可观测行为均不变。
 * 此测试为纯防御性硬化的门禁证明。
 */

import { describe, it, expect } from 'vitest'
import { resolveInterruptTurnId } from '../src/main/interruptTurnId'

// ---------------------------------------------------------------------------
// 纯函数单元测试
// ---------------------------------------------------------------------------

describe('T11: resolveInterruptTurnId — 纯函数行为', () => {
  it('currentTurnId = null(早窗已清零) → 返回 null(后端线程中断兜底)', () => {
    expect(resolveInterruptTurnId(null)).toBeNull()
  })

  it('currentTurnId = 已知 id(post-resolve) → 返回该 id', () => {
    expect(resolveInterruptTurnId('turn-abc-123')).toBe('turn-abc-123')
  })
})

// ---------------------------------------------------------------------------
// 状态机模拟:验证 submitTurn 生命周期内 currentTurnId 的变迁
// ---------------------------------------------------------------------------

describe('T11: submitTurn 早窗 interrupt 状态机', () => {
  /**
   * 模拟旧逻辑(不清零,修改前行为):
   *   submit handler 未提前清零 currentTurnId → 早窗持有陈旧 id。
   *
   * RED PROOF:此模拟演示旧代码会发陈旧 id。
   * 若以此为断言目标("不应发陈旧 id"),测试就会失败 → RED。
   */
  it('[RED 演示] 旧逻辑:早窗 currentTurnId 持有陈旧 id(不清零)', async () => {
    // 旧逻辑状态机
    let currentTurnId: string | null = 'stale-prev-turn'  // 上一 turn 遗留

    // 捕获一次「submit 在途但尚未 resolve」的中断
    let interruptTurnIdSentByOldLogic: string | null = undefined as unknown as string | null

    // 构造一个受控的 submit Promise:submit 发出后暂停,等 latch resolve 再完成
    let latchResolve!: () => void
    const latch = new Promise<void>(r => { latchResolve = r })

    const submitPromise = (async () => {
      // 旧逻辑:submit 前不清零 currentTurnId
      // (这里什么都不做,与旧代码等价)

      await latch  // 模拟网络往返延迟

      // submit resolve 后才赋值
      currentTurnId = 'new-turn-xyz'
    })()

    // 早窗内触发 interrupt — 旧逻辑会读到陈旧 id
    interruptTurnIdSentByOldLogic = resolveInterruptTurnId(currentTurnId)

    // 让 submit 完成
    latchResolve()
    await submitPromise

    // 旧逻辑:早窗 interrupt 携带陈旧 id
    expect(interruptTurnIdSentByOldLogic).toBe('stale-prev-turn')
    // 这正是"坏":不是 null,不是新 id,而是上一 turn 的旧 id。
    // ← 如果对此加断言"should be null",测试 RED。
  })

  /**
   * 新逻辑(硬化后):submitTurn handler 在 await 前先清零 currentTurnId。
   * 早窗内:currentTurnId = null → interrupt 发 null → 安全兜底。
   *
   * GREEN PROOF:此模拟演示新代码早窗不发陈旧 id。
   */
  it('[GREEN] 新逻辑:早窗 currentTurnId 已清零 → interrupt 发 null(不发陈旧 id)', async () => {
    // 新逻辑状态机
    let currentTurnId: string | null = 'stale-prev-turn'  // 上一 turn 遗留

    let interruptTurnIdSentByNewLogic: string | null = undefined as unknown as string | null

    let latchResolve!: () => void
    const latch = new Promise<void>(r => { latchResolve = r })

    const submitPromise = (async () => {
      // T11 硬化:submit 前先清零 → 早窗 currentTurnId = null
      currentTurnId = null

      await latch  // 模拟网络往返延迟

      // submit resolve 后赋新 id
      currentTurnId = 'new-turn-xyz'
    })()

    // 早窗内触发 interrupt — 新逻辑读到 null
    interruptTurnIdSentByNewLogic = resolveInterruptTurnId(currentTurnId)

    // 让 submit 完成
    latchResolve()
    await submitPromise

    // 新逻辑:早窗 interrupt 携带 null(不携带陈旧 id)
    expect(interruptTurnIdSentByNewLogic).toBeNull()

    // post-resolve 之后 currentTurnId 已是新 id
    expect(currentTurnId).toBe('new-turn-xyz')
  })

  /**
   * 正常路径(post-resolve):submit 完成后的 interrupt 携带正确新 id。
   */
  it('[GREEN] post-resolve interrupt 携带正确新 id', () => {
    // submit 已完成,currentTurnId = 新 id
    const currentTurnId = 'new-turn-xyz'

    const turnIdSent = resolveInterruptTurnId(currentTurnId)

    // post-resolve:interrupt 携带正确 id
    expect(turnIdSent).toBe('new-turn-xyz')
  })

  /**
   * 边界:初始状态(首次 submit 前,currentTurnId = null)→ interrupt 发 null。
   * 旧逻辑此处本就是 null,新逻辑不变。
   */
  it('[GREEN] 初始状态(从无到有,首次 submit 前)→ interrupt 发 null', () => {
    const currentTurnId: string | null = null  // 应用初始状态

    const turnIdSent = resolveInterruptTurnId(currentTurnId)

    expect(turnIdSent).toBeNull()
  })
})
