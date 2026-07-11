/**
 * 模型的图片(视觉)支持判定——用于发送前预检。纯函数,可测。
 *
 * 三态而非布尔:本工具只能「确定」两类,其余一律 unknown 放行,
 * 避免误拦其它 provider 上配置的视觉模型(失败时由 turn.failed 红条兜底)。
 *   - supported:  glm-5v* 系列(GLMClient 里唯一接了视觉端点的)
 *   - unsupported: deepseek 全系(本工具中均为纯文本;视觉是另一条未接的 VL 线)
 *   - unknown:    其余(openai/generic/kimi/step/xfyun… 无法可靠判定)
 */
export type ImageSupport = 'supported' | 'unsupported' | 'unknown'

export function imageSupport(model: string): ImageSupport {
  const m = (model || '').trim().toLowerCase()
  if (!m) return 'unknown'
  if (m.startsWith('glm-5v')) return 'supported'
  if (m.startsWith('deepseek')) return 'unsupported'
  return 'unknown'
}

/** 发送前是否应拦下(仅「确定不支持」才拦)。 */
export function shouldBlockImageSend(model: string): boolean {
  return imageSupport(model) === 'unsupported'
}
