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

/**
 * 接入平台卡片的状态文案 —— 只看该平台自身是否可用/已配置,与「当前选中哪张卡」无关。
 * 之前的 bug 是拿 isSelected && bound 判断,导致只有被选中的卡才可能显示「已配置」。
 */
export function platformStatusText(status: string, configured: boolean): string {
  if (status !== 'available') return '即将支持'
  return configured ? '✓ 已配置' : '可配置'
}

/** 配套的文案颜色 class,同样只依赖该平台自身状态。 */
export function platformStatusColor(status: string, configured: boolean): string {
  return status === 'available' && configured ? 'text-ok' : 'text-fg-subtle'
}
