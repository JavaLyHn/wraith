// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import PluginsPanel from '../src/renderer/components/PluginsPanel'
import { BUILTIN_CAPABILITIES } from '../src/renderer/lib/pluginShowcase'
import type { McpServerView, SearchStatusView } from '../src/shared/types'

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
 * <p>**这里原先写的判据是「静态标注而不是实时探测」**，理由是「实时状态在没探测到时会
 * 反过来误报」。那个理由只覆盖了一个方向：静态标注对**配好了的人**是恒定误报 ——
 * 用户已经能搜到 GitHub 内容了，卡片还挂着黄色「需配置」和整段「搜索需四者之一…」，
 * 于是问「明明能搜到了，为什么还显示这些黄色内容」。
 *
 * <p>现在两项都有真实信号可问（搜索 ← `config.getSearch`；浏览器 ← 内置 chrome-devtools
 * MCP 的 state），所以角标改成实时。`requires` 这份文案**仍然要留着** —— 它是
 * 「确实没配」时给出的「怎么配」，只是不再无条件显示。判定逻辑与它的单测在
 * `capabilityReadiness.test.ts`；这里守的是**面板接线**。
 *
 * <p>探不到时是中性的「检测中…」，不退回假黄标 —— 这就是原理由担心的那个方向，
 * 用第三种状态解决，而不是用一句恒定的假话解决。
 */

const NEED_CONFIG = ['web', 'browser']

/** 测试里 window.wraith 只需要这一个方法;不设则走「探不到」分支。 */
function stubBackend(status: SearchStatusView | null): void {
  ;(window as unknown as { wraith: unknown }).wraith = {
    configGetSearch: async () => {
      if (status === null) throw new Error('backend not connected')
      return status
    },
  }
}

afterEach(() => {
  delete (window as unknown as { wraith?: unknown }).wraith
})

const readyServer: McpServerView = {
  name: 'chrome-devtools', state: 'ready', scope: 'builtin', enabled: true,
  shadowed: false, transport: 'stdio', tools: [], envKeys: [],
}

function props(over: Partial<React.ComponentProps<typeof PluginsPanel>> = {}):
    React.ComponentProps<typeof PluginsPanel> {
  return {
    servers: [], configError: null, busy: false,
    onBack: () => {}, onRefresh: () => {}, onToggle: () => {},
    onRestart: () => {}, onRemove: () => {}, onSubmitForm: async () => true,
    ...over,
  }
}

const cardText = (container: HTMLElement, name: string): string =>
  [...container.querySelectorAll('[data-testid="mcp-builtin-card"]')]
    .find(c => c.textContent?.includes(name))!.textContent ?? ''

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

  /**
   * 这条原来钉的是「文案要提到 `/config search`」—— 写它的时候 CLI **是唯一的写入口**
   * （在那之前文案只说环境变量，等于让人去改 shell 配置）。
   *
   * <p>现在桌面端能配了（`config.setSearch` + 卡片详情里的表单），继续钉那个命令就成了
   * 反向要求：用户实测问的正是「这个不是必须要 cli 才能配置吧 桌面端也可以」，
   * 而文案当时确实在把他推去开终端。
   *
   * <p><b>意图不变、期望改了</b>：文案必须指出一个<b>就在手边</b>的写入口。
   */
  it('指出一个就在手边的写入口 —— 不再把人推去开终端', () => {
    const requires = BUILTIN_CAPABILITIES.find(c => c.id === 'web')!.requires!
    expect(requires).toMatch(/点这张卡片|这张卡片/)
    expect(requires).not.toMatch(/\/config search/)
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

  it('确实没配时:挂「需配置」并把「缺什么」直接写在卡上,不用点进去才看得到', async () => {
    stubBackend({ provider: 'unconfigured', ready: false })
    const { container } = render(<PluginsPanel {...props()} />)

    await waitFor(() => expect(cardText(container, '网页搜索与抓取')).toContain('需配置'))
    expect(cardText(container, '网页搜索与抓取')).toMatch(/GLM_API_KEY/)
  })

  it('配好了就转「已就绪」,并说出用的是哪个后端 —— 用户问的正是这个', async () => {
    stubBackend({ provider: 'searxng', ready: true })
    const { container } = render(<PluginsPanel {...props()} />)

    await waitFor(() => expect(cardText(container, '网页搜索与抓取')).toContain('已就绪'))
    const web = cardText(container, '网页搜索与抓取')
    expect(web).toContain('searxng')
    expect(web).not.toContain('需配置')
    // 判别力自证:把 PluginsPanel 里的 capabilityReadiness 换回 c.requires 那套静态判断,
    // 这两行会红。
    expect(web).not.toMatch(/GLM_API_KEY/)
    expect(web).not.toContain('四者之一')
  })

  it('浏览器接管跟着内置 chrome-devtools MCP 的真实状态走', async () => {
    stubBackend({ provider: 'searxng', ready: true })
    const { container } = render(<PluginsPanel {...props({ servers: [readyServer] })} />)

    await waitFor(() => expect(cardText(container, '浏览器接管')).toContain('已就绪'))
    expect(cardText(container, '浏览器接管')).not.toContain('需配置')
  })

  it('MCP 起失败时把后端的原始报错写在卡上,比「需装 Node」有用', async () => {
    stubBackend({ provider: 'unconfigured', ready: false })
    const { container } = render(<PluginsPanel {...props({
      servers: [{ ...readyServer, state: 'error', error: 'spawn npx ENOENT' }],
    })} />)

    await waitFor(() => expect(cardText(container, '浏览器接管')).toContain('spawn npx ENOENT'))
  })

  it('后端探不到时是中性的「检测中…」,不是那个假黄标', async () => {
    stubBackend(null)   // configGetSearch 抛错
    const { container } = render(<PluginsPanel {...props()} />)

    const web = cardText(container, '网页搜索与抓取')
    expect(web).toContain('检测中')
    expect(web).not.toContain('需配置')
    // 探不到就别声称就绪,这是原静态方案担心的那个方向
    expect(web).not.toContain('已就绪')
  })

  it('零配置的七项永远是「已内置」,不受探测结果影响', async () => {
    stubBackend({ provider: 'unconfigured', ready: false })
    const { container } = render(<PluginsPanel {...props()} />)

    expect(container.querySelectorAll('[data-testid="mcp-builtin-card"]').length)
      .toBe(BUILTIN_CAPABILITIES.length)
    for (const c of BUILTIN_CAPABILITIES.filter(x => !NEED_CONFIG.includes(x.id))) {
      const text = cardText(container, c.name)
      expect(text, c.id).toContain('已内置')
      expect(text, c.id).not.toContain('需配置')
    }
  })
})
