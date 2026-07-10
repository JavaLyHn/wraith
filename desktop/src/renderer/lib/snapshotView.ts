/** 快照相位的中文标签(纯函数,可单测)。 */
export function phaseLabel(phase: string): string {
  if (phase === 'PRE_TURN') return '轮前'
  if (phase === 'POST_TURN') return '轮后'
  if (phase === 'PRE_RESTORE') return '恢复前'
  return phase
}
