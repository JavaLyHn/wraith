import { describe, it, expect } from 'vitest'
import { transcriptToMarkdown, type ExportMeta } from '../src/renderer/lib/transcriptMarkdown'
import type { Item } from '../src/shared/transcriptReducer'

const meta: ExportMeta = { title: '我的会话', model: 'deepseek-chat', workspace: '/repo', exportedAt: '2026-07-10 23:59' }

describe('transcriptToMarkdown', () => {
  it('文件头含标题 + 模型/工作目录/导出时间', () => {
    const md = transcriptToMarkdown([], meta)
    expect(md).toContain('# 我的会话')
    expect(md).toContain('deepseek-chat')
    expect(md).toContain('/repo')
    expect(md).toContain('2026-07-10 23:59')
  })

  it('空会话不崩,仅有头部', () => {
    expect(() => transcriptToMarkdown([], meta)).not.toThrow()
  })

  it('user → 👤 用户 段', () => {
    const md = transcriptToMarkdown([{ type: 'user', text: '你好' }], meta)
    expect(md).toContain('## 👤 用户')
    expect(md).toContain('你好')
  })

  it('message(助手)→ 🤖 助手 段', () => {
    const md = transcriptToMarkdown([{ type: 'message', text: '在的' }], meta)
    expect(md).toContain('## 🤖 助手')
    expect(md).toContain('在的')
  })

  it('thinking → blockquote 思考', () => {
    const md = transcriptToMarkdown([{ type: 'thinking', label: '思考', text: '先看文件', done: true }], meta)
    expect(md).toContain('> 💭')
    expect(md).toContain('先看文件')
  })

  it('tool → 🔧 名称 + json 参数 + 输出代码块', () => {
    const md = transcriptToMarkdown([{
      type: 'tool',
      card: { callId: 'c1', name: 'read_file', argsJson: '{"path":"a.ts"}', output: 'file body', ok: true, done: true },
    }], meta)
    expect(md).toContain('### 🔧 read_file')
    expect(md).toContain('```json')
    expect(md).toContain('"path":"a.ts"')
    expect(md).toContain('file body')
  })

  it('tool 空输出 → 省略输出块(不出现空 fence)', () => {
    const md = transcriptToMarkdown([{
      type: 'tool',
      card: { callId: 'c1', name: 'noop', argsJson: '{}', output: '', done: true },
    }], meta)
    expect(md).toContain('### 🔧 noop')
    expect(md).not.toContain('输出')
  })

  it('tool 超长输出 → 截断并标注', () => {
    const big = 'x'.repeat(5000)
    const md = transcriptToMarkdown([{
      type: 'tool',
      card: { callId: 'c1', name: 'grep', argsJson: '{}', output: big, done: true },
    }], meta)
    expect(md).toContain('已截断')
    expect(md.length).toBeLessThan(5000)
  })

  it('diff → 📝 文件 + diff 代码块含 -/+ 行', () => {
    const md = transcriptToMarkdown([{ type: 'diff', filePath: 'foo.ts', before: 'old', after: 'new' }], meta)
    expect(md).toContain('### 📝 foo.ts')
    expect(md).toContain('```diff')
    expect(md).toContain('-old')
    expect(md).toContain('+new')
  })

  it('plan → 📋 计划 + 勾选清单(done=[x], 其它=[ ])', () => {
    const md = transcriptToMarkdown([{
      type: 'plan', planId: 'p1', goal: '重构',
      steps: [
        { id: 's1', description: '读代码', status: 'done' },
        { id: 's2', description: '改代码', status: 'pending' },
      ],
    }], meta)
    expect(md).toContain('## 📋 计划:重构')
    expect(md).toContain('- [x] 读代码')
    expect(md).toContain('- [ ] 改代码')
  })

  it('team → 👥 团队 + 目标', () => {
    const md = transcriptToMarkdown([{
      type: 'team', teamId: 't1', goal: '造功能',
      agents: [{ id: 'a1', role: '规划' }], steps: [], parallelStepIds: [],
    }], meta)
    expect(md).toContain('## 👥 团队:造功能')
    expect(md).toContain('造功能')
  })

  it('多条按顺序拼接', () => {
    const md = transcriptToMarkdown([
      { type: 'user', text: 'Q' },
      { type: 'message', text: 'A' },
    ], meta)
    expect(md.indexOf('👤 用户')).toBeLessThan(md.indexOf('🤖 助手'))
  })
})
