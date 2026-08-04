import { describe, it, expect } from 'vitest'
import { embeddingTestLines, embeddingTestTone } from '../src/renderer/lib/embeddingTestView'
import type { EmbeddingTestResult } from '../src/shared/types'

/**
 * 「测试连接」的回包摊成人话。
 *
 * 后端（`EmbeddingProbe`）回的是 `{ok, dim, latencyMs, provider, model, baseUrl, warning?}`
 * 或 `{ok:false, error, hint?}`。这里是纯函数层：**哪些字段值得摊开、缺字段怎么办、
 * 语气怎么定**。渲染在 RagPanel。
 *
 * 两条纪律照抄后端：
 * ① 缺的字段整行不出现 —— 绝不显示「维度 undefined」；
 * ② 失败时**原文与诊断都留着**，诊断在前、原文在后 —— 「连不上」「401 key 错」
 *    「429 限流」是三件不同的事，只给友好话会把人引到错的地方去查。
 */

const ok = (over: Partial<EmbeddingTestResult> = {}): EmbeddingTestResult => ({
  ok: true, dim: 768, latencyMs: 585,
  provider: 'ollama', model: 'nomic-embed-text:latest', baseUrl: 'http://localhost:11434',
  ...over,
})

describe('embeddingTestLines - 成功', () => {
  it('维度与耗时都要摊出来 —— 它们分别是「能不能和现有索引对上」和「整库要跑多久」的依据', () => {
    const t = embeddingTestLines(ok()).join('\n')
    expect(t).toContain('768')
    expect(t).toMatch(/585|0\.6|0\.59/)      // 耗时以某种可读形式出现
  })

  it('回显实际生效的 provider / model / baseUrl —— 表单留空时后端会填默认,那才是真在跑的', () => {
    const t = embeddingTestLines(ok()).join('\n')
    expect(t).toContain('ollama')
    expect(t).toContain('nomic-embed-text:latest')
    expect(t).toContain('http://localhost:11434')
  })

  it('缺字段整行不出现,不显示 undefined / NaN', () => {
    const t = embeddingTestLines({ ok: true }).join('\n')
    expect(t).not.toContain('undefined')
    expect(t).not.toContain('NaN')
  })

  it('warning 原样带出 —— 那是「建索引之前」唯一一次能看见维度冲突的机会', () => {
    const w = '当前索引是用 nomic-embed-text:latest（768 维）建的，这个后端给出 1024 维'
    expect(embeddingTestLines(ok({ dim: 1024, warning: w })).join('\n')).toContain(w)
  })
})

describe('embeddingTestLines - 失败', () => {
  it('诊断在前、原文在后,两个都在', () => {
    const lines = embeddingTestLines({
      ok: false,
      error: 'Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434',
      hint: '连不上本机的 embedding 服务（localhost:11434）。最常见的原因是 **ollama 没在运行**',
    })
    const t = lines.join('\n')
    expect(t).toContain('没在运行')                        // 诊断
    expect(t).toContain('Failed to connect to')            // 原文,一个字不能少
    expect(t.indexOf('没在运行')).toBeLessThan(t.indexOf('Failed to connect to'))
  })

  it('没有诊断时只给原文,不硬凑一句安慰 —— 401 就该看见 401', () => {
    const t = embeddingTestLines({
      ok: false, error: 'Embedding API 请求失败 [401]: invalid api key',
    }).join('\n')
    expect(t).toContain('401')
    expect(t.split('\n').filter((l) => l.trim()).length).toBe(1)
  })

  it('后端连 error 都没给(不该发生)时也要说句人话,不能是空白框', () => {
    const t = embeddingTestLines({ ok: false }).join('\n')
    expect(t.trim().length).toBeGreaterThan(0)
    expect(t).not.toContain('undefined')
  })
})

describe('embeddingTestTone', () => {
  it('三态分明:成功 / 通了但与索引不兼容 / 失败', () => {
    expect(embeddingTestTone(ok())).toBe('ok')
    expect(embeddingTestTone(ok({ warning: '维度不一致' }))).toBe('warn')
    expect(embeddingTestTone({ ok: false, error: 'x' })).toBe('error')
  })

  it('「通了但不兼容」不能算成功 —— 那正是它最容易被忽略的地方', () => {
    // 绿勾 + 一行小字警告 = 用户只看见绿勾,然后带着不兼容的索引去检索
    expect(embeddingTestTone(ok({ warning: '维度不一致' }))).not.toBe('ok')
  })
})
