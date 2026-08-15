// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Sidebar from '../src/renderer/components/Sidebar'

afterEach(() => cleanup())

// 最小 props stub 集 (仅关心 ToolNav workspace 扩展 + onOpenWorkspace prop 接收)
const stub: any = {
  workspace: 'd:/wrk', projects: [], busy: false, sessions: [], activeSessionId: '', runningSessionId: '',
  newDraftActive: false, onNewConversation: () => {}, onSelectSession: () => {},
  onToggleStar: () => {}, onRenameSession: () => {}, onArchiveSession: () => {},
  onActivateProject: () => {}, onAddProject: () => {}, onOpenAllProjects: () => {},
  profile: { name: '', avatar: '' } as any, automationBadge: false, taskActiveCount: 0,
  onOpenSearch: () => {}, onOpenPlugins: () => {}, onOpenAutomations: () => {},
  onOpenImGateway: () => {}, onOpenProviders: () => {}, onOpenSkills: () => {},
  onOpenMemory: () => {}, onOpenSnapshots: () => {}, onOpenTasks: () => {},
  onOpenPolicy: () => {}, onOpenBrowser: () => {}, onOpenRag: () => {},
  onOpenDocuments: () => {}, onOpenSettings: () => {},
  activeNav: null,
}

describe('Sidebar ToolNav.workspace entry', () => {
  it('workspace 入口渲染为「文件」按钮,testId=nav-workspace', () => {
    render(<Sidebar {...stub} activeNav="documents" onOpenWorkspace={() => {}} />)
    const btn = screen.getByTestId('nav-workspace')
    expect(btn).toBeTruthy()
    expect(btn.querySelector('span')?.textContent).toContain('文件')
  })
  it('点击 workspace 入口调用 onOpenWorkspace', () => {
    let called = false
    render(<Sidebar {...stub} activeNav="documents" onOpenWorkspace={() => { called = true }} />)
    screen.getByTestId('nav-workspace').click()
    expect(called).toBe(true)
  })
})
