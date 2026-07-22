import { describe, it, expect } from 'vitest'
import { deriveArtifacts, deriveFiles } from '../src/shared/artifactSummary'
import type { Item } from '../src/shared/transcriptReducer'

function tool(name: string, argsJson: string, output: string): Item {
  return { type: 'tool', card: { callId: 'c-' + name, name, argsJson, output, done: true } }
}

describe('deriveArtifacts', () => {
  it('files: 按 path 去重,首个 diff 定 kind、content 取最后一次 after', () => {
    const items: Item[] = [
      { type: 'diff', filePath: 'README.md', before: '', after: '你好' },
      { type: 'diff', filePath: 'README.md', before: '你好', after: '你好2' },
      { type: 'diff', filePath: 'src/a.ts', before: 'old', after: 'new' },
    ]
    expect(deriveArtifacts(items, '/proj').files).toEqual([
      { path: 'README.md', kind: 'created', content: '你好2' },
      { path: 'src/a.ts', kind: 'modified', content: 'new' },
    ])
  })

  it('files: write_file 工具卡计入产物(含内容未变的 no-op 重写,后端不发 diff)', () => {
    const items: Item[] = [
      tool('write_file', JSON.stringify({ path: 'README.md', content: '你好' }), '文件已写入: README.md'),
    ]
    expect(deriveArtifacts(items, '/proj').files).toEqual([
      { path: 'README.md', kind: 'modified', content: '你好' },
    ])
    expect(deriveArtifacts(items, '/proj').isEmpty).toBe(false)
  })

  it('files: write_file 工具卡 + 同路径 diff 合并为一条(content 取最新)', () => {
    const items: Item[] = [
      tool('write_file', JSON.stringify({ path: 'a.txt', content: 'v2' }), 'ok'),
      { type: 'diff', filePath: 'a.txt', before: 'v1', after: 'v2' },
    ]
    expect(deriveArtifacts(items, null).files).toEqual([{ path: 'a.txt', kind: 'modified', content: 'v2' }])
  })

  it('files: 新建文件 kind=created,即便 write_file 工具卡先于 diff 到达', () => {
    const items: Item[] = [
      tool('write_file', JSON.stringify({ path: 'new.md', content: 'x' }), 'ok'),
      { type: 'diff', filePath: 'new.md', before: '', after: 'x' },
    ]
    expect(deriveArtifacts(items, null).files[0]).toEqual({ path: 'new.md', kind: 'created', content: 'x' })
  })

  it('files: 被拒绝的 write_file(ok=false)不计入产物', () => {
    const items: Item[] = [
      { type: 'tool', card: { callId: 'c1', name: 'write_file', argsJson: JSON.stringify({ path: 'x.md', content: 'y' }), output: '[HITL] 操作已被拒绝', done: true, ok: false } },
    ]
    expect(deriveArtifacts(items, null).files).toEqual([])
  })

  it('servers: 从 execute_command 输出抽回环 URL,归一化 + 去重(含尾斜杠合并)', () => {
    const items: Item[] = [
      tool('execute_command', '{"command":"npm run dev"}', 'VITE ready at http://localhost:5173/\nlocalhost:5173'),
      tool('execute_command', '{"command":"x"}', 'listening on 127.0.0.1:3000'),
    ]
    expect(deriveArtifacts(items, null).servers).toEqual([
      { url: 'http://localhost:5173' },
      { url: 'http://127.0.0.1:3000' },
    ])
  })

  it('servers: 忽略非回环与无端口的提及', () => {
    const s = deriveArtifacts([tool('execute_command', '{}', 'see https://example.com and localhost without port')], null)
    expect(s.servers).toEqual([])
  })

  it('servers: 不把更大 token 的子串(如 backend-localhost:8080)当作回环服务', () => {
    const items: Item[] = [
      tool('execute_command', '{}', 'proxying to backend-localhost:8080 and svc-127.0.0.1:9000'),
    ]
    expect(deriveArtifacts(items, null).servers).toEqual([])
  })

  it('browser: 取浏览器工具最后一次 argsJson.url', () => {
    const items: Item[] = [
      tool('browser_navigate', '{"url":"https://a.com"}', ''),
      tool('mcp__chrome-devtools__navigate_page', '{"url":"https://b.com"}', ''),
    ]
    expect(deriveArtifacts(items, null).browserUrl).toBe('https://b.com')
  })

  it('browser: 导航目标(argsJson.url)优先于之后检查类工具 output 刮到的 URL', () => {
    const items: Item[] = [
      tool('mcp__chrome-devtools__navigate_page', '{"url":"https://target.com"}', ''),
      tool('mcp__chrome-devtools__take_snapshot', '{}', 'page: https://scraped-from-snapshot.com'),
    ]
    expect(deriveArtifacts(items, null).browserUrl).toBe('https://target.com')
  })

  it('browser: 无任何 url 参数时退回从导航类工具 output 抽 URL', () => {
    const items: Item[] = [
      tool('browser_navigate', '{}', 'navigated to https://fallback.com ok'),
    ]
    expect(deriveArtifacts(items, null).browserUrl).toBe('https://fallback.com')
  })

  it('browser: 忽略 status/connect 类工具 output 里的 CDP 端点', () => {
    const items: Item[] = [
      tool('browser_status', '{}', 'connected: http://127.0.0.1:9222/devtools'),
    ]
    expect(deriveArtifacts(items, null).browserUrl).toBeNull()
  })

  it('subagents: 聚合 team 步数与角色;无 team → null', () => {
    expect(deriveArtifacts([], null).subagents).toBeNull()
    const team: Item = {
      type: 'team', teamId: 't1', goal: 'g',
      agents: [{ id: 'a1', role: 'coder' }, { id: 'a2', role: 'reviewer' }],
      steps: [
        { id: 's1', description: '', type: 'x', status: 'done' },
        { id: 's2', description: '', type: 'x', status: 'running' },
        { id: 's3', description: '', type: 'x', status: 'done' },
      ],
      parallelStepIds: [],
    }
    expect(deriveArtifacts([team], null).subagents).toEqual({ total: 3, done: 2, roles: ['coder', 'reviewer'] })
  })

  it('sources: 用户附件按 path 去重', () => {
    const items: Item[] = [
      { type: 'user', text: 'hi', attachments: [{ path: '/i/1.png', name: '1.png', kind: 'image' }] },
      { type: 'user', text: 'again', attachments: [{ path: '/i/1.png', name: '1.png', kind: 'image' }, { path: '/i/2.png', name: '2.png', kind: 'image' }] },
    ]
    expect(deriveArtifacts(items, '/proj').sources).toEqual([
      { path: '/i/1.png', name: '1.png', kind: 'image' },
      { path: '/i/2.png', name: '2.png', kind: 'image' },
    ])
  })

  it('isEmpty: 只有 workspace(无产物)→ true', () => {
    expect(deriveArtifacts([], '/proj').isEmpty).toBe(true)
    expect(deriveArtifacts([{ type: 'message', text: 'hi' }], '/proj').isEmpty).toBe(true)
  })

  it('isEmpty: 有任一产物 → false', () => {
    expect(deriveArtifacts([{ type: 'diff', filePath: 'a', before: '', after: 'x' }], null).isEmpty).toBe(false)
  })
})

describe('deriveFiles', () => {
  const tool = (name: string, argsJson: string, output = ''): Item =>
    ({ type: 'tool', card: { callId: 'c-' + name, name, argsJson, output, done: true } })

  it('write_file 卡计入(含 no-op),按 path 去重、content 取最新', () => {
    const items: Item[] = [
      tool('write_file', JSON.stringify({ path: 'a.md', content: 'v1' })),
      tool('write_file', JSON.stringify({ path: 'a.md', content: 'v2' })),
    ]
    expect(deriveFiles(items)).toEqual([{ path: 'a.md', kind: 'modified', content: 'v2' }])
  })

  it('write_file 卡 + 同路径 diff 合并成一条(diff 定 created)', () => {
    const items: Item[] = [
      tool('write_file', JSON.stringify({ path: 'new.md', content: 'x' })),
      { type: 'diff', filePath: 'new.md', before: '', after: 'x' },
    ]
    expect(deriveFiles(items)).toEqual([{ path: 'new.md', kind: 'created', content: 'x' }])
  })

  it('ok=false 的 write_file 不计', () => {
    const items: Item[] = [
      { type: 'tool', card: { callId: 'c1', name: 'write_file', argsJson: JSON.stringify({ path: 'x', content: 'y' }), output: '', done: true, ok: false } },
    ]
    expect(deriveFiles(items)).toEqual([])
  })

  it('无产物 → 空数组', () => {
    expect(deriveFiles([{ type: 'message', text: 'hi' }])).toEqual([])
  })
})
