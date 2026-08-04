// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ApprovalModal from '../src/renderer/components/ApprovalModal'

/**
 * 「当前的请求 有些参数是空的 但还是展示了出来」。
 *
 * 用户批准 mcp__memory__list_resources 时,弹窗里挂着一个**空的大框**,占掉四分之一个
 * 对话框却什么都没写 —— 那个工具用的是 emptyObjectSchema(),压根没有参数。
 *
 * 修法的边界:没有参数才收框;有参数但值为空则**照样列出来**并标 `(空)`。
 * 审批弹窗的全部意义是让用户看清将要执行什么,为了好看藏掉一个参数是把可读性换成安全性。
 */

afterEach(cleanup)

const props = (over: Record<string, unknown> = {}) => ({
  approvalId: 'a1',
  toolName: 'mcp__memory__list_resources',
  argsJson: '{}',
  dangerLevel: 'MCP',
  riskDescription: '将调用外部 MCP server 提供的工具',
  suggestion: '',
  beforeContent: null,
  onRespond: vi.fn(),
  onReject: vi.fn(),
  ...over,
})

describe('无参数的审批请求', () => {
  it('{} → 不再挂那个空框,只有一行「无参数」', () => {
    render(<ApprovalModal {...props()} />)
    expect(screen.getByTestId('approval-no-args').textContent).toContain('无参数')
    expect(screen.queryByTestId('approval-args-rows')).toBeNull()
    expect(screen.queryByTestId('approval-args-raw')).toBeNull()
  })

  it('空串也一样', () => {
    render(<ApprovalModal {...props({ argsJson: '' })} />)
    expect(screen.getByTestId('approval-no-args')).toBeTruthy()
  })

  it('仍然能手动补参数 —— 收框不等于剥夺编辑能力', () => {
    render(<ApprovalModal {...props()} />)
    fireEvent.click(screen.getByTestId('json-edit-open'))
    expect(screen.getByTestId('json-edit')).toBeTruthy()
  })

  it('批准按钮照常可用 —— 没参数不是错误状态', () => {
    render(<ApprovalModal {...props()} />)
    expect(screen.getByTestId('approve').hasAttribute('disabled')).toBe(false)
  })
})

describe('有参数的审批请求', () => {
  it('逐行显示键值,而不是一坨 JSON', () => {
    render(<ApprovalModal {...props({
      toolName: 'read_file', argsJson: '{"path":"src/a.ts","limit":50}',
    })} />)
    const rows = screen.getByTestId('approval-args-rows')
    expect(rows.textContent).toContain('path')
    expect(rows.textContent).toContain('src/a.ts')
    expect(rows.textContent).toContain('limit')
    expect(screen.queryByTestId('approval-no-args')).toBeNull()
  })

  it('值为空的键照样列出并标 (空) —— 不藏', () => {
    render(<ApprovalModal {...props({
      toolName: 'mcp__x__y', argsJson: '{"uri":"","cursor":""}',
    })} />)
    const rows = screen.getByTestId('approval-args-rows')
    expect(rows.textContent).toContain('uri')
    expect(rows.textContent).toContain('cursor')
    expect(rows.textContent).toContain('(空)')
    expect(screen.queryByTestId('approval-no-args')).toBeNull()
  })

  it('非法 JSON 原样摊开 —— 那时用户更需要看到原文', () => {
    render(<ApprovalModal {...props({ toolName: 'mcp__x__y', argsJson: '{not json' })} />)
    expect(screen.getByTestId('approval-args-raw').textContent).toContain('{not json')
  })

  it('execute_command 与 write_file 走各自的专用视图,不受本改动影响', () => {
    const { unmount } = render(<ApprovalModal {...props({
      toolName: 'execute_command', argsJson: '{"command":"ls -la"}',
    })} />)
    expect(screen.getByTestId('command-edit')).toBeTruthy()
    expect(screen.queryByTestId('approval-no-args')).toBeNull()
    unmount()

    render(<ApprovalModal {...props({
      toolName: 'write_file', argsJson: '{"path":"a.txt","content":"hi"}',
    })} />)
    expect(screen.queryByTestId('approval-no-args')).toBeNull()
  })
})
