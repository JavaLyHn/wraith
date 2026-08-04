import { describe, it, expect } from 'vitest'
import { embeddingTestLines, embeddingTestTone, embeddingTestToneClass, embeddingTestTitleClass } from '../src/renderer/lib/embeddingTestView'
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

/**
 * 配色。两条,都是量出来的,不是审美判断。
 *
 * **① 必须走主题令牌,不能写死 Tailwind 调色板。** 初版写的是 `text-emerald-200` /
 * `text-amber-200` / `text-red-200` —— 那是**暗色主题**的浅色文字。用户是亮色主题,
 * 浅绿字压在 `emerald-500/10` 这种近白底上,实测「压根看不清」。算下来对比度 **1.09:1**
 * （WCAG 正文要求 ≥4.5:1）。令牌 `--ok-rgb` 等在 `tokens.css` 里对 `:root`（亮）与
 * `[data-theme="dark"]`（暗）各有一套值。
 *
 * **② 但换成令牌还不够 —— 正文不能用 tone 色。** 那三个令牌是给角标/短标签设计的。
 * 实测压在 `tone/10` 底色上的对比度:
 * <pre>
 *            亮色主题            暗色主题
 *   text-ok      2.93:1 ❌         6.46:1 ✅
 *   text-warn    2.44:1 ❌         7.24:1 ✅
 *   text-danger  4.43:1 △          5.27:1 ✅
 *   text-fg-muted 4.9~5.2:1 ✅     6.5~6.8:1 ✅
 *   text-fg      13.3~14.0:1 ✅   13.4~14.0:1 ✅
 * </pre>
 * 所以 **tone 色只留给描边 / 底色 / 标题**（标题短且有 emoji 冗余编码），
 * 明细行走 `text-fg-muted` —— 那才是两个主题都过 AA 的组合。
 *
 * <p>这也是为什么 `embeddingTestToneClass` **不再返回任何 `text-*`**:返回了,
 * 里面的明细行就会继承 tone 色,又回到亮色主题下看不清。
 */
describe('embeddingTestToneClass', () => {
  const TONES = ['ok', 'warn', 'error'] as const
  const token = (t: string): string => (t === 'error' ? 'danger' : t)

  it('底色与描边走对应的语义令牌', () => {
    for (const t of TONES) {
      const cls = embeddingTestToneClass(t)
      expect(cls, `${t}: ${cls}`).toContain(`bg-${token(t)}/`)
      expect(cls, `${t}: ${cls}`).toContain(`border-${token(t)}/`)
    }
  })

  it('容器**不带**文字色 —— 带了明细行就继承 tone 色,亮色主题下 2.4~2.9:1 看不清', () => {
    for (const t of TONES) {
      expect(embeddingTestToneClass(t), `${t} 不该定文字色`).not.toMatch(/\btext-/)
    }
  })

  it('标题用 tone 色 —— 它短、加粗,而且有 emoji 冗余编码状态', () => {
    expect(embeddingTestTitleClass('ok')).toContain('text-ok')
    expect(embeddingTestTitleClass('warn')).toContain('text-warn')
    expect(embeddingTestTitleClass('error')).toContain('text-danger')
  })

  it('不许出现写死的调色板色阶 —— 那种颜色只在一种主题下可读', () => {
    const palette = /\b(?:text|bg|border)-(?:emerald|amber|red|green|yellow|slate|gray|zinc|neutral|stone|blue|sky)-\d{2,3}\b/
    for (const t of TONES) {
      expect(embeddingTestToneClass(t), `${t} 容器: ${embeddingTestToneClass(t)}`).not.toMatch(palette)
      expect(embeddingTestTitleClass(t), `${t} 标题: ${embeddingTestTitleClass(t)}`).not.toMatch(palette)
    }
  })
})
