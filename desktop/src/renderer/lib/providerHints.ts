/**
 * Provider 表单的「按错误给建议」。
 *
 * 起因是一次真实卡壳：Base URL 填 `https://cdn.rkapi.com`，测试连接回
 * `404 - {"error":{"message":"Invalid URL (POST /chat/completions)"}}`。
 * 后端把 Base URL 直接拼 `/chat/completions`（见 `FreeLlmApiClient.toChatCompletionsUrl`），
 * 而 OpenAI 兼容网关要的是 `/v1/chat/completions` —— 也就是 **`/v1` 属于 Base URL 的一部分**。
 *
 * 报错原文其实说清了路径不对，但没人有义务知道「那意味着 Base URL 该补 /v1」。
 * 这里把那一步推理补上，并直接给出可照抄的完整 URL。
 */

/** 看着像「路径不对」而不是「密钥不对 / 网络不通」的错误。 */
function looksLikeWrongPath(error: string): boolean {
  const e = error.toLowerCase()
  return e.includes('404') || e.includes('invalid url') || e.includes('not found')
}

/** 去掉结尾斜杠。 */
function trimSlash(u: string): string {
  return u.trim().replace(/\/+$/, '')
}

/**
 * 测试连接失败时，给一条可照抄的修正建议；给不出就返回 null。
 *
 * 只在**路径类**错误上出手：401/403 是密钥问题，连接超时是网络问题，
 * 对那些乱猜 `/v1` 只会把人带偏。
 */
export function baseUrlFixHint(baseUrl: string, error: string): string | null {
  const url = trimSlash(baseUrl ?? '')
  if (url === '' || !looksLikeWrongPath(error ?? '')) return null
  // 已经带了版本段就不是这个毛病了(有些网关是 /v1beta、/openai/v1 等)
  if (/\/v\d+(beta)?$/i.test(url)) return null
  // 用户把完整端点填进来了 —— 后端能识别这种写法，不必改
  if (url.endsWith('/chat/completions')) return null
  return `Base URL 可能缺少版本段。多数 OpenAI 兼容网关要的是 ${url}/v1`
}

/** Base URL 输入框的样例文案：把 /v1 属于 Base URL 这件事前置说清。 */
export const BASE_URL_PLACEHOLDER = 'https://api.example.com/v1'
