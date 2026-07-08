/** 工具卡片内容显示的纯逻辑。 */

/** 参数 JSON 美化:能解析则缩进(转义自然还原),否则原样返回。 */
export function prettyArgs(argsJson: string): string {
  if (!argsJson || !argsJson.trim()) return ''
  try {
    return JSON.stringify(JSON.parse(argsJson), null, 2)
  } catch {
    return argsJson
  }
}

/** 清洗模型误吐进正文的 DSML 工具调用标记(best-effort);普通文本原样。 */
export function stripDsml(text: string): string {
  if (!text) return text
  return text
    .replace(/<\|\s*DSML\s*\|[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
}
