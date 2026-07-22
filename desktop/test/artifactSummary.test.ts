import { describe, it, expect } from 'vitest'
import { deriveArtifacts } from '../src/shared/artifactSummary'
import type { Item } from '../src/shared/transcriptReducer'

function tool(name: string, argsJson: string, output: string): Item {
  return { type: 'tool', card: { callId: 'c-' + name, name, argsJson, output, done: true } }
}

describe('deriveArtifacts', () => {
  it('files: 按 path 去重,首个 diff 决定 新建/改动', () => {
    const items: Item[] = [
      { type: 'diff', filePath: 'README.md', before: '', after: '你好' },
      { type: 'diff', filePath: 'README.md', before: '你好', after: '你好2' },
      { type: 'diff', filePath: 'src/a.ts', before: 'old', after: 'new' },
    ]
    expect(deriveArtifacts(items, '/proj').files).toEqual([
      { path: 'README.md', kind: 'created' },
      { path: 'src/a.ts', kind: 'modified' },
    ])
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
