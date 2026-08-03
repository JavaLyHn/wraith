// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PluginsPanel from '../src/renderer/components/PluginsPanel'
import { BUILTIN_CAPABILITIES } from '../src/renderer/lib/pluginShowcase'

/**
 * 内置能力面板不许再说「无需配置」。
 *
 * <p>用户看着「内置能力 · 开箱即用 —— Wraith 自带的能力，无需配置即可在对话中调用」，
 * 其中「网页搜索与抓取」标着「已内置」，实际一问 agent 就说 web_search 不可用、
 * 需要 GLM_API_KEY。于是问「为什么都不可用，不是都内置了吗」。
 *
 * <p>**是面板在撒谎，不是模型在胡说。** 九项里有两项确实有前置条件：
 * - 网页搜索：需要一个搜索 provider 的 key（GLM / SerpAPI / SearXNG 任一）
 * - 浏览器接管：需要机器上有 Node（起 chrome-devtools MCP）和 Chrome
 *
 * <p>其余七项（文件读写 / 代码搜索 / 执行命令 / 新建项目 / 技能 / 记忆 / 任务清单）
 * 是真·零配置。
 *
 * <p>判据取「**说清楚**」而不是「实时探测」：静态标注在任何机器上都成立
 * （这项能力确实内置、且确实需要一个 key），不会像实时状态那样在没探测到时
 * 反过来误报。真实可用性由 agent 调用时的 provider 提示负责。
 */

const NEED_CONFIG = ['web', 'browser']

function props(): React.ComponentProps<typeof PluginsPanel> {
  return {
    servers: [], configError: null, busy: false,
    onBack: () => {}, onRefresh: () => {}, onToggle: () => {},
    onRestart: () => {}, onRemove: () => {}, onSubmitForm: async () => true,
  }
}

describe('BUILTIN_CAPABILITIES 的前置条件标注', () => {
  it('有前置条件的两项被标出来了,并写清缺什么', () => {
    for (const id of NEED_CONFIG) {
      const c = BUILTIN_CAPABILITIES.find(x => x.id === id)
      expect(c, `找不到能力 ${id}`).toBeTruthy()
      expect(c!.requires, `${id} 必须标注前置条件`).toBeTruthy()
      expect(c!.requires!.length, `${id} 的说明不能是空话`).toBeGreaterThan(4)
    }
  })

  it('网页搜索要点名可用的 key,而不是只说「需要配置」', () => {
    const web = BUILTIN_CAPABILITIES.find(c => c.id === 'web')!
    expect(web.requires).toMatch(/GLM_API_KEY/)
    expect(web.requires).toMatch(/SERPAPI|SearXNG|SEARXNG/i)
  })

  // 这条文案原先是「搜索需三者之一:GLM_API_KEY(与 GLM 推理共用)/ SERPAPI_KEY /
  // SEARXNG_URL(自托管,免费无需 key)」—— GLM 摆在第一位,读起来像推荐,而对纯中转站
  // 用户(无任何官方 provider key)「与 GLM 推理共用」根本不是便利,是一句空话。
  it('免费那条排在 GLM 前面,且不把任何搜索后端说成零配置', () => {
    const requires = BUILTIN_CAPABILITIES.find(c => c.id === 'web')!.requires!
    expect(requires.indexOf('SEARXNG')).toBeLessThan(requires.indexOf('GLM_API_KEY'))

    // 只看搜索那半句。「抓取(web_fetch)零配置」是真话,不该被这条断言连坐 ——
    // 要禁的是把某个**搜索后端**说成零配置(原文案对 GLM 写的是「零额外配置」,
    // 而对没有官方 GLM key 的人那是假话)。
    const searchHalf = requires.split('抓取')[0]
    expect(searchHalf).not.toMatch(/零额外配置|零配置/)
  })

  it('提到 /config search 这个写入口(此前只有环境变量一条路)', () => {
    expect(BUILTIN_CAPABILITIES.find(c => c.id === 'web')!.requires).toMatch(/\/config search/)
  })

  it('浏览器接管要点名 Node 与 Chrome', () => {
    const b = BUILTIN_CAPABILITIES.find(c => c.id === 'browser')!
    expect(b.requires).toMatch(/Node/i)
    expect(b.requires).toMatch(/Chrome/i)
  })

  it('真·零配置的七项不许乱标 —— 标了等于制造新的噪声', () => {
    for (const c of BUILTIN_CAPABILITIES.filter(x => !NEED_CONFIG.includes(x.id))) {
      expect(c.requires, `${c.id} 不该有前置条件`).toBeUndefined()
    }
  })
})

describe('面板文案', () => {
  it('小标题不能再说「无需配置」—— 那对九项里的两项是假的', () => {
    render(<PluginsPanel {...props()} />)
    const sub = screen.getByTestId('mcp-builtin-subtitle')
    expect(sub.textContent).not.toContain('无需配置')
  })

  it('需配置的卡片挂「需配置」徽标,零配置的仍是「已内置」', () => {
    const { container } = render(<PluginsPanel {...props()} />)
    const cards = container.querySelectorAll('[data-testid="mcp-builtin-card"]')
    expect(cards.length).toBe(BUILTIN_CAPABILITIES.length)

    const byName = (n: string): Element =>
      [...cards].find(c => c.textContent?.includes(n))!
    expect(byName('网页搜索与抓取').textContent).toContain('需配置')
    expect(byName('浏览器接管').textContent).toContain('需配置')
    expect(byName('文件读写').textContent).toContain('已内置')
    expect(byName('文件读写').textContent).not.toContain('需配置')
  })

  it('需配置的卡片把「缺什么」直接写在卡上,不用点进去才看得到', () => {
    const { container } = render(<PluginsPanel {...props()} />)
    const web = [...container.querySelectorAll('[data-testid="mcp-builtin-card"]')]
      .find(c => c.textContent?.includes('网页搜索与抓取'))!
    expect(web.textContent).toMatch(/GLM_API_KEY/)
  })
})
