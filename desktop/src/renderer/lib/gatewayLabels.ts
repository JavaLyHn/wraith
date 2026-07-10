import type { GatewayBindPhase } from '../../shared/gateway'

/** 打码：保留首尾各 4 位,中间星号(≤8 位只留前 2)。 */
export function maskId(s: string | null): string {
  if (!s) return '—'
  if (s.length <= 8) return s.slice(0, 2) + '****'
  return s.slice(0, 4) + '****' + s.slice(-4)
}

/** 绑定阶段 → 可读提示。 */
export function bindPhaseLabel(phase: GatewayBindPhase, message?: string): string {
  switch (phase) {
    case 'scanning': return '等待扫码授权…'
    case 'bound': return '✅ 绑定成功'
    case 'secret-invalid': return message ?? 'openclaw 返回的密钥无法换取 token,请手填机器人密钥'
    case 'cancelled': return '已取消绑定'
    case 'failed': return message ?? '绑定失败,请重试'
  }
}
