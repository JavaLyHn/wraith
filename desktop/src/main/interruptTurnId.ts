/**
 * T11 — interrupt turnId 硬化(防御性)
 *
 * 纯函数:根据当前状态决定 turn.interrupt 应携带哪个 turnId。
 *
 * 语义规则:
 *   - pendingTurnId !== null:新 turn 已 resolve,有确定 turnId → 发该 id。
 *   - pendingTurnId === null(早窗:submit 在途未 resolve):
 *       不发陈旧的上一 turn id,而是发 null(后端按线程中断兜底)。
 *
 * 注意:本函数仅在 submitTurn handler 将 currentTurnId 清零(early 窗)之后、
 * turn.submit 的 resolved 结果赋值(post-resolve)之前被调用时才有防御意义。
 * 当前后端 AppServer 按 turnThread 中断、不读 turnId——函数返回值无论是 null
 * 还是正确 id,运行时行为均与修改前等价。此为纯防御性硬化。
 *
 * @param currentTurnId - 当前已知的最新 turnId(null = 无已知 id 或已清零)
 * @returns 应随 turn.interrupt 发送的 turnId(null = 后端线程中断兜底)
 */
export function resolveInterruptTurnId(currentTurnId: string | null): string | null {
  return currentTurnId
}
