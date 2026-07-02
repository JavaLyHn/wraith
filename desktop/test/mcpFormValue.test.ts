import { describe, it, expect } from 'vitest'
import { buildFormValue, envRowsFromKeys, type EnvRow } from '../src/shared/mcpFormValue'

describe('mcpFormValue', () => {
  it('envRowsFromKeys 用占位空值回填既有 key', () => {
    expect(envRowsFromKeys(['B', 'A'])).toEqual([
      { key: 'B', value: '' },
      { key: 'A', value: '' },
    ])
  })

  it('buildFormValue 组装 payload:空值 env 保留(交给后端语义),空 key 行丢弃', () => {
    const rows: EnvRow[] = [
      { key: 'TOKEN', value: '' },      // 编辑态未动 → 空串=后端保留现值
      { key: 'NEW', value: 'nv' },
      { key: '', value: 'ignored' },    // 空 key 丢弃
    ]
    const v = buildFormValue('project', 'srv', ' npx ', ' -y \n pkg \n\n', rows)
    expect(v).toEqual({
      scope: 'project', name: 'srv', command: 'npx',
      args: ['-y', 'pkg'], env: { TOKEN: '', NEW: 'nv' },
    })
  })

  it('args 按行拆分并去空白行', () => {
    expect(buildFormValue('user', 'n', 'c', '', []).args).toEqual([])
  })
})
