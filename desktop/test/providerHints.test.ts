import { describe, it, expect } from 'vitest'
import { baseUrlFixHint, BASE_URL_PLACEHOLDER } from '../src/renderer/lib/providerHints'

/**
 * 真实卡壳复现:Base URL 填 `https://cdn.rkapi.com`,测试连接回
 * `404 - {"error":{"message":"Invalid URL (POST /chat/completions)"}}`。
 *
 * 后端把 Base URL 直接拼 /chat/completions(FreeLlmApiClient.toChatCompletionsUrl),
 * 而 OpenAI 兼容网关要的是 /v1/chat/completions —— /v1 属于 Base URL 的一部分。
 * 报错原文说清了路径不对,但没人有义务把它推理成「该给 Base URL 补 /v1」。
 */
describe('baseUrlFixHint', () => {
  const REAL_404 =
    'API请求失败: 404 - {"error":{"message":"Invalid URL (POST /chat/completions)","type":"invalid_request_error"}}'

  it('复现那次真实报错 → 给出可照抄的完整 URL', () => {
    const hint = baseUrlFixHint('https://cdn.rkapi.com', REAL_404)
    expect(hint).toContain('https://cdn.rkapi.com/v1')
  })

  it('结尾斜杠不会拼出双斜杠', () => {
    expect(baseUrlFixHint('https://cdn.rkapi.com/', REAL_404)).toContain('https://cdn.rkapi.com/v1')
    expect(baseUrlFixHint('https://cdn.rkapi.com//', REAL_404)).not.toContain('//v1')
  })

  it('已经带 /v1 → 不再瞎建议(那就不是这个毛病了)', () => {
    expect(baseUrlFixHint('https://cdn.rkapi.com/v1', REAL_404)).toBeNull()
    expect(baseUrlFixHint('https://x.com/v1/', REAL_404)).toBeNull()
  })

  it('其它版本段(v2 / v1beta)同样不建议', () => {
    expect(baseUrlFixHint('https://x.com/v2', REAL_404)).toBeNull()
    expect(baseUrlFixHint('https://x.com/v1beta', REAL_404)).toBeNull()
  })

  it('用户填了完整端点 → 后端认这种写法,不该建议改', () => {
    expect(baseUrlFixHint('https://x.com/v1/chat/completions', REAL_404)).toBeNull()
  })

  it('**密钥类错误不出手** —— 对 401/403 猜 /v1 只会把人带偏', () => {
    expect(baseUrlFixHint('https://cdn.rkapi.com', 'API请求失败: 401 - Unauthorized')).toBeNull()
    expect(baseUrlFixHint('https://cdn.rkapi.com', 'API请求失败: 403 - Forbidden')).toBeNull()
  })

  it('网络类错误不出手', () => {
    expect(baseUrlFixHint('https://cdn.rkapi.com', 'connect timed out')).toBeNull()
    expect(baseUrlFixHint('https://cdn.rkapi.com', 'unable to verify the first certificate')).toBeNull()
  })

  it('Base URL 为空时不出手(还没填,谈不上填错)', () => {
    expect(baseUrlFixHint('', REAL_404)).toBeNull()
    expect(baseUrlFixHint('   ', REAL_404)).toBeNull()
  })

  it('placeholder 本身就把 /v1 的约定说了出来', () => {
    expect(BASE_URL_PLACEHOLDER).toContain('/v1')
  })
})
