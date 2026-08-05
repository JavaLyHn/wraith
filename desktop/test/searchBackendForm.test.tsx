// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import SearchBackendForm, { SEARCH_BACKENDS } from '../src/renderer/components/SearchBackendForm'
import type { SearchStatusView } from '../src/shared/types'

/**
 * 桌面端配置搜索后端。
 *
 * <p>用户实测：「能力概览 → 网页搜索与抓取」挂着黄色「需配置」，说明里写着要用
 * CLI 的 config search 命令，于是问「这个不是必须要 cli 才能配置吧 桌面端也可以
 * 是不是哪里没做完整」。**是没做完整**：读的 RPC 一直有，写的整条链都不存在。
 *
 * <p>这里守的是两条**容易做错且做错了很贵**的语义（后端 `SearchConfigRules` 同此）：
 * key 框永不回填、换后端不继承旧 key。
 */

function stub(over: Record<string, unknown> = {}): {
  set: ReturnType<typeof vi.fn>; test: ReturnType<typeof vi.fn>
} {
  const set = vi.fn(async () => ({ ok: true }))
  const test = vi.fn(async () => ({ ok: true, provider: 'searxng', results: 10, latencyMs: 42, sample: '标题' }))
  ;(window as unknown as { wraith: unknown }).wraith = {
    configSetSearch: set, configTestSearch: test, configGetSearch: async () => ({ provider: '', ready: false }),
    ...over,
  }
  return { set, test }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { wraith?: unknown }).wraith
  vi.clearAllMocks()
})

const status = (over: Partial<SearchStatusView> = {}): SearchStatusView => ({
  provider: 'unconfigured', ready: false, ...over,
})

describe('SearchBackendForm', () => {
  it('四个后端都列出来了,免费无需 key 那条排最前', () => {
    stub()
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)
    for (const o of SEARCH_BACKENDS) {
      expect(screen.queryByTestId(`search-backend-option-${o.id}`), o.id).not.toBeNull()
    }
    expect(SEARCH_BACKENDS[0].id).toBe('searxng')
    expect(SEARCH_BACKENDS[0].needsKey).toBe(false)
  })

  it('DuckDuckGo 要带不稳定警示 —— 不能读成推荐', () => {
    const ddg = SEARCH_BACKENDS.find(o => o.id === 'duckduckgo')!
    expect(ddg.warn).toBeTruthy()
    expect(ddg.warn).toMatch(/失效|抓 HTML|临时/)
  })

  it('选 SearXNG 出地址框、不出 key 框；选 SerpAPI 反过来', () => {
    stub()
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)

    fireEvent.click(screen.getByTestId('search-backend-option-searxng').querySelector('input')!)
    expect(screen.queryByTestId('search-backend-baseurl')).not.toBeNull()
    expect(screen.queryByTestId('search-backend-apikey')).toBeNull()

    fireEvent.click(screen.getByTestId('search-backend-option-serpapi').querySelector('input')!)
    expect(screen.queryByTestId('search-backend-baseurl')).toBeNull()
    expect(screen.queryByTestId('search-backend-apikey')).not.toBeNull()
  })

  it('DuckDuckGo 两个框都不出 —— 后端给了参数会直接报错', () => {
    stub()
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)
    fireEvent.click(screen.getByTestId('search-backend-option-duckduckgo').querySelector('input')!)
    expect(screen.queryByTestId('search-backend-baseurl')).toBeNull()
    expect(screen.queryByTestId('search-backend-apikey')).toBeNull()
  })

  it('**key 框永不回填,占位符要说清「留空则不变」** —— 否则用户以为它空了', () => {
    stub()
    render(<SearchBackendForm status={status({ savedProvider: 'serpapi', hasKey: true })} onSaved={() => {}} />)

    const input = screen.getByTestId('search-backend-apikey') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toMatch(/留空则不变/)
    expect(input.type).toBe('password')
  })

  it('**换了后端时明确说旧 key 不会沿用** —— 一个 key 字段服务两家,沿用会发错家', () => {
    stub()
    render(<SearchBackendForm status={status({ savedProvider: 'serpapi', hasKey: true })} onSaved={() => {}} />)

    fireEvent.click(screen.getByTestId('search-backend-option-zhipu').querySelector('input')!)

    expect(screen.queryByTestId('search-backend-key-not-inherited')).not.toBeNull()
    expect((screen.getByTestId('search-backend-apikey') as HTMLInputElement).placeholder)
        .not.toMatch(/留空则不变/)
  })

  it('缺必填项时保存与测试都点不动', () => {
    stub()
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)
    // 什么都没选
    expect((screen.getByTestId('search-backend-save') as HTMLButtonElement).disabled).toBe(true)

    // 选了 searxng 但没填地址
    fireEvent.click(screen.getByTestId('search-backend-option-searxng').querySelector('input')!)
    expect((screen.getByTestId('search-backend-save') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('search-backend-test') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('search-backend-baseurl'), { target: { value: 'http://localhost:8888' } })
    expect((screen.getByTestId('search-backend-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('同一家且已存 key 时,空着 key 框也能保存(空=不改)', () => {
    stub()
    render(<SearchBackendForm status={status({ savedProvider: 'serpapi', hasKey: true })} onSaved={() => {}} />)
    expect((screen.getByTestId('search-backend-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('保存成功后清掉草稿里的 key,并通知外层刷新角标', async () => {
    const { set } = stub()
    const onSaved = vi.fn()
    render(<SearchBackendForm status={status()} onSaved={onSaved} />)

    fireEvent.click(screen.getByTestId('search-backend-option-serpapi').querySelector('input')!)
    fireEvent.change(screen.getByTestId('search-backend-apikey'), { target: { value: 'sk-fake-1234' } })
    fireEvent.click(screen.getByTestId('search-backend-save'))

    await waitFor(() => expect(screen.queryByTestId('search-backend-saved')).not.toBeNull())
    expect(set).toHaveBeenCalledWith({ provider: 'serpapi', apiKey: 'sk-fake-1234', baseUrl: '' })
    expect(onSaved).toHaveBeenCalled()
    // 存完不把 key 留在渲染进程内存里
    expect((screen.getByTestId('search-backend-apikey') as HTMLInputElement).value).toBe('')
  })

  it('后端回 {ok:false,error} 时把那句话贴出来,不弹通用失败', async () => {
    const { set } = stub({ configSetSearch: vi.fn(async () => ({ ok: false, error: 'SearXNG 需要填实例地址' })) })
    void set
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)

    fireEvent.click(screen.getByTestId('search-backend-option-serpapi').querySelector('input')!)
    fireEvent.change(screen.getByTestId('search-backend-apikey'), { target: { value: 'sk-x' } })
    fireEvent.click(screen.getByTestId('search-backend-save'))

    await waitFor(() => expect(screen.getByTestId('search-backend-error').textContent)
        .toContain('SearXNG 需要填实例地址'))
  })

  it('测试连接成功时摊开条数与耗时 —— 那是判断「搜到的是真东西」的依据', async () => {
    stub()
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)

    fireEvent.click(screen.getByTestId('search-backend-option-searxng').querySelector('input')!)
    fireEvent.change(screen.getByTestId('search-backend-baseurl'), { target: { value: 'http://localhost:8888' } })
    fireEvent.click(screen.getByTestId('search-backend-test'))

    await waitFor(() => {
      const text = screen.getByTestId('search-backend-test-result').textContent ?? ''
      expect(text).toContain('10')
      expect(text).toContain('42')
      expect(text).toContain('标题')
    })
  })

  it('测试连接失败时保留后端原文 —— 「连不上」「401」「429」是三件不同的事', async () => {
    stub({ configTestSearch: vi.fn(async () => ({ ok: false, error: 'ConnectException: Connection refused' })) })
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)

    fireEvent.click(screen.getByTestId('search-backend-option-searxng').querySelector('input')!)
    fireEvent.change(screen.getByTestId('search-backend-baseurl'), { target: { value: 'http://127.0.0.1:1' } })
    fireEvent.click(screen.getByTestId('search-backend-test'))

    await waitFor(() => expect(screen.getByTestId('search-backend-test-result').textContent)
        .toContain('Connection refused'))
  })

  it('**测试连接不写盘** —— 点测试不该调 configSetSearch', async () => {
    const { set, test } = stub()
    render(<SearchBackendForm status={status()} onSaved={() => {}} />)

    fireEvent.click(screen.getByTestId('search-backend-option-duckduckgo').querySelector('input')!)
    fireEvent.click(screen.getByTestId('search-backend-test'))

    await waitFor(() => expect(test).toHaveBeenCalled())
    expect(set).not.toHaveBeenCalled()
  })
})
