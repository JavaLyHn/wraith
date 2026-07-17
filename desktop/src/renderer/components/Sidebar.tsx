import { useState, useRef, useEffect } from 'react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import {
  Plus, Search, Blocks, Clock, MessageSquare, Plug, BookOpen, Brain, History, Globe, ScanSearch,
  Star, ListTree, List, Pencil, Trash2, Check, Settings, Wrench, ChevronDown,
  Shield, ShieldAlert, ShieldCheck, ListTodo, PanelLeft,
} from 'lucide-react'
import ProjectSwitcher from './ProjectSwitcher'
import Logo from './Logo'
import { sessionDisplayName, partitionStarred, groupSessionsByTime } from '../lib/sessionView'
import type { SessionMeta, ProjectView } from '../../shared/types'
import { topBarLeftPad } from '../lib/topBar'

function SessionRow({ s, active, running, onSelect, onToggleStar, onRename, onDelete }: {
  s: SessionMeta; active: boolean; running: boolean
  onSelect: (id: string) => void
  onToggleStar: (id: string, starred: boolean) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}): JSX.Element {
  const [confirmDel, setConfirmDel] = useState(false)
  // 行内改名:Electron 渲染进程不支持 window.prompt,故用就地输入框
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)   // 防 Escape 后 onBlur 二次提交

  useEffect(() => {
    if (editing) { doneRef.current = false; editRef.current?.focus(); editRef.current?.select() }
  }, [editing])

  const startEdit = (): void => { setDraft(s.name ?? s.title ?? ''); setEditing(true) }
  const finishEdit = (save: boolean): void => {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    if (save) onRename(s.id, draft)
  }

  if (editing) {
    return (
      <div className="mb-0.5 flex items-center rounded-lg bg-surface px-1">
        <input ref={editRef} data-testid="session-rename-input" value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => finishEdit(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') finishEdit(true)
            else if (e.key === 'Escape') finishEdit(false)
          }}
          className="w-full rounded border border-accent bg-bg px-2 py-1.5 text-xs text-fg outline-none" />
      </div>
    )
  }

  return (
    <div className={'group mb-0.5 flex items-center gap-1 rounded-lg px-1 ' +
      (active ? 'bg-surface' : 'hover:bg-surface/60')}
      onMouseLeave={() => setConfirmDel(false)}>
      {running && (
        <span data-testid="session-running-dot" className="relative ml-1 flex h-2 w-2 shrink-0" title="运行中">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-accent opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
      )}
      <button data-testid="conversation-item" onClick={() => onSelect(s.id)}
        className={'flex-1 truncate px-2 py-2 text-left text-xs ' + (active ? 'text-fg' : 'text-fg-muted')}
        title={sessionDisplayName(s)}>
        {sessionDisplayName(s)}
      </button>
      <button data-testid="session-star" title={s.starred ? '取消重点' : '标记重点'}
        onClick={() => onToggleStar(s.id, !s.starred)}
        className={'shrink-0 px-1 ' + (s.starred ? 'text-warning' : 'text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100')}>
        <Star className="h-3 w-3" strokeWidth={1.5} fill={s.starred ? 'currentColor' : 'none'} />
      </button>
      <button data-testid="session-rename" title="改名"
        onClick={startEdit}
        className="shrink-0 px-1 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100">
        <Pencil className="h-3 w-3" strokeWidth={1.5} />
      </button>
      <button data-testid="session-delete"
        title={running ? '会话进行中,不可删除' : (confirmDel ? '确认删除?' : '删除')}
        disabled={running}
        onClick={() => { if (!confirmDel) { setConfirmDel(true); return } onDelete(s.id) }}
        className={'shrink-0 px-1 opacity-0 group-hover:opacity-100 ' +
          (running ? 'disabled:cursor-not-allowed disabled:opacity-40' : '') +
          (confirmDel ? ' text-danger opacity-100' : ' text-fg-subtle hover:text-fg')}>
        {confirmDel ? <Check className="h-3 w-3" strokeWidth={1.5} /> : <Trash2 className="h-3 w-3" strokeWidth={1.5} />}
      </button>
    </div>
  )
}

interface SidebarProps {
  workspace: string
  projects: ProjectView[]
  busy: boolean
  sessions: SessionMeta[]
  activeSessionId: string
  runningSessionId: string
  /** 当前是尚未落桩的空白新会话:侧栏顶部显示一条「新对话」草稿行并高亮。 */
  newDraftActive: boolean
  onNewConversation: () => void
  onSelectSession: (id: string) => void
  onToggleStar: (id: string, starred: boolean) => void
  onRenameSession: (id: string, name: string) => void
  onDeleteSession: (id: string) => void
  onActivateProject: (path: string) => void
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onRenameProject: (path: string, name: string) => void
  sandbox: 'macos-seatbelt' | 'none' | 'unknown'
  activeNav: 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'settings' | null
  onOpenPlugins: () => void
  onOpenAutomations: () => void
  onOpenImGateway: () => void
  onOpenProviders: () => void
  onOpenSkills: () => void
  onOpenMemory: () => void
  onOpenSnapshots: () => void
  onOpenTasks: () => void
  onOpenPolicy: () => void
  onOpenBrowser: () => void
  onOpenRag: () => void
  onOpenSettings: () => void
  automationBadge: boolean
  /** 打开命令面板(搜索)。 */
  onOpenSearch: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

export default function Sidebar({
  workspace,
  projects,
  busy,
  sessions,
  activeSessionId,
  runningSessionId,
  newDraftActive,
  onNewConversation,
  onSelectSession,
  onToggleStar,
  onRenameSession,
  onDeleteSession,
  onActivateProject,
  onAddProject,
  onRemoveProject,
  onRenameProject,
  sandbox,
  activeNav,
  onOpenPlugins,
  onOpenAutomations,
  onOpenImGateway,
  onOpenProviders,
  onOpenSkills,
  onOpenMemory,
  onOpenSnapshots,
  onOpenTasks,
  onOpenPolicy,
  onOpenBrowser,
  onOpenRag,
  onOpenSettings,
  automationBadge,
  onOpenSearch,
  collapsed,
  onToggleCollapsed,
}: SidebarProps): JSX.Element {
  const [toolsExpanded, setToolsExpanded] = useState(false)
  // 进入某工具页时强制展开(高亮可见);否则由用户折叠状态决定
  const showTools = toolsExpanded || activeNav !== null
  // 会话列表分组模式:recent=最新平铺(默认)/ time=按时间分组;记忆在 localStorage
  const [groupMode, setGroupMode] = useState<'recent' | 'time'>(() => {
    try { return localStorage.getItem('wraith.sidebar.sessionGroupMode') === 'time' ? 'time' : 'recent' } catch { return 'recent' }
  })
  const toggleGroupMode = (): void => setGroupMode(m => {
    const next = m === 'time' ? 'recent' : 'time'
    try { localStorage.setItem('wraith.sidebar.sessionGroupMode', next) } catch { /* ignore */ }
    return next
  })

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-testid="sidebar"
        className="sidebar-gradient flex h-full w-60 flex-col border-r border-border"
      >
        {/* 顶段:交通灯让位 + 折叠键;拖拽区。mac 下透明露磨砂 */}
        <div className={'flex h-[38px] shrink-0 items-center [-webkit-app-region:drag] ' + topBarLeftPad(window.wraith.platform)}>
          <button
            type="button"
            data-testid="sidebar-collapse"
            onClick={onToggleCollapsed}
            title={collapsed ? '展开侧栏' : '折叠侧栏'}
            className="rounded-lg p-1.5 text-fg-muted transition duration-150 active:scale-90 motion-reduce:transform-none hover:bg-surface/60 hover:text-fg [-webkit-app-region:no-drag]"
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            data-testid="brand-home"
            onClick={onNewConversation}
            title="回到新对话首页"
            className="flex flex-1 select-none items-center gap-2 px-4 py-4 text-left transition-opacity hover:opacity-80"
          >
            <Logo className="h-7 w-7 object-contain" />
            <span className="text-sm font-bold tracking-wide text-fg">WRAITH</span>
          </button>
        </div>

        <ProjectSwitcher
          projects={projects}
          activePath={workspace}
          busy={busy}
          onActivate={onActivateProject}
          onAdd={onAddProject}
          onRemove={onRemoveProject}
          onRename={onRenameProject}
        />

        {/* new conversation — functional */}
        <div className="px-3">
          <button
            data-testid="new-conversation"
            onClick={onNewConversation}
            className="w-full rounded-lg bg-fg/5 px-3 py-2 text-left text-xs text-fg hover:bg-fg/10 hover:text-accent"
          >
            <span className="flex items-center gap-2"><Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />新对话</span>
          </button>
        </div>

        {/* nav */}
        <nav className="mt-3 flex flex-col gap-0.5 px-3">
          {/* search — 点击打开命令面板 */}
          <button
            data-testid="nav-search"
            onClick={onOpenSearch}
            className="rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60"
          >
            <span className="flex items-center gap-2"><Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />搜索</span>
          </button>

          {/* 工具组(可折叠;进入工具页自动展开)*/}
          <button
            data-testid="nav-tools-toggle"
            onClick={() => setToolsExpanded(v => !v)}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60"
          >
            <Wrench className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />工具
            {!showTools && automationBadge && (
              <span data-testid="nav-tools-badge" className="relative ml-1 flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
              </span>
            )}
            <ChevronDown className={'ml-auto h-3.5 w-3.5 shrink-0 transition-transform ' + (showTools ? '' : '-rotate-90')} strokeWidth={1.5} />
          </button>
          {showTools && (
          <div className="flex flex-col gap-0.5 pl-2">
          {/* plugins — enabled */}
          <button
            data-testid="nav-plugins"
            onClick={onOpenPlugins}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'plugins' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><Blocks className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />MCP</span>
          </button>

          {/* automations — enabled */}
          <button
            data-testid="nav-automations"
            onClick={onOpenAutomations}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'automations' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />自动化
              {automationBadge && (
                <span data-testid="nav-automations-badge" className="relative ml-auto flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
                </span>
              )}
            </span>
          </button>

          {/* IM 网关 — enabled */}
          <button
            data-testid="nav-im-gateway"
            onClick={onOpenImGateway}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'im-gateway' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />IM 网关</span>
          </button>

          {/* Provider 配置 — enabled */}
          <button
            data-testid="nav-providers"
            onClick={onOpenProviders}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'providers' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><Plug className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />Provider 配置</span>
          </button>

          {/* skills — enabled */}
          <button
            data-testid="nav-skills"
            onClick={onOpenSkills}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'skills' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />技能</span>
          </button>
          {/* memory */}
          <button
            data-testid="nav-memory"
            onClick={onOpenMemory}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'memory' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><Brain className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />记忆</span>
          </button>
          {/* snapshots */}
          <button
            data-testid="nav-snapshots"
            onClick={onOpenSnapshots}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'snapshots' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />快照</span>
          </button>
          {/* background tasks */}
          <button
            data-testid="nav-tasks"
            onClick={onOpenTasks}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'tasks' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><ListTodo className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />后台任务</span>
          </button>
          {/* policy + audit */}
          <button
            data-testid="nav-policy"
            onClick={onOpenPolicy}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'policy' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />安全</span>
          </button>
          {/* browser */}
          <button
            data-testid="nav-browser"
            onClick={onOpenBrowser}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'browser' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />浏览器</span>
          </button>
          {/* rag / code search */}
          <button
            data-testid="nav-rag"
            onClick={onOpenRag}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'rag' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            <span className="flex items-center gap-2"><ScanSearch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />代码检索</span>
          </button>
          </div>
          )}
        </nav>

        {/* conversations list */}
        <div className="flex-1 overflow-y-auto">
          {/* ⭐重点分区 + 对话分区 */}
          <>
            {newDraftActive && (
              <button
                type="button"
                data-testid="session-draft"
                onClick={onNewConversation}
                title="当前新对话(发送消息后自动保存到列表)"
                className="mt-2 flex w-full items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-left text-xs text-fg"
              >
                <span className="truncate">新对话</span>
                <span className="ml-auto shrink-0 text-3xs text-fg-subtle">草稿</span>
              </button>
            )}
            {(() => {
              const { starred, rest } = partitionStarred(sessions)
              const renderRows = (list: SessionMeta[]): JSX.Element[] => list.map(s => (
                <SessionRow key={s.id} s={s} active={s.id === activeSessionId}
                  running={s.id === runningSessionId}
                  onSelect={onSelectSession} onToggleStar={onToggleStar}
                  onRename={onRenameSession} onDelete={onDeleteSession} />
              ))
              // sticky 表头:滚动时标题不动,内容从下方滑过(半透明 + 模糊)
              const headerCls = 'sticky top-0 z-20 mt-4 sidebar-sticky px-3 py-1 text-3xs uppercase tracking-wider text-fg-subtle backdrop-blur-sm'
              const groupLabelCls = 'sticky top-7 z-10 sidebar-sticky px-3 py-1 text-3xs uppercase tracking-wider text-fg-subtle backdrop-blur-sm'
              return (
                <>
                  {sessions.length === 0 && <div className="mt-4 px-3 py-2 text-xs text-fg-subtle">还没有历史会话</div>}
                  {starred.length > 0 && <>
                    <div className={headerCls + ' flex items-center gap-1'}><Star className="h-3 w-3 shrink-0" strokeWidth={1.5} />重点</div>
                    <div className="px-2">{renderRows(starred)}</div>
                  </>}
                  {rest.length > 0 && <>
                    <div className={headerCls + ' flex items-center'}>
                      <span>对话</span>
                      <button
                        data-testid="session-group-toggle"
                        onClick={toggleGroupMode}
                        title={groupMode === 'time' ? '切换为最新平铺' : '切换为按时间分组'}
                        aria-label={groupMode === 'time' ? '切换为最新平铺' : '切换为按时间分组'}
                        className="ml-auto rounded px-1 text-xs leading-none text-fg-muted transition-colors hover:text-accent"
                      >
                        {groupMode === 'time'
                          ? <ListTree className="h-3 w-3" strokeWidth={1.5} />
                          : <List className="h-3 w-3" strokeWidth={1.5} />}
                      </button>
                    </div>
                    {groupMode === 'time'
                      ? groupSessionsByTime(rest, Date.now()).map(g => (
                        <div key={g.label}>
                          <div className={groupLabelCls}>{g.label}</div>
                          <div className="px-2">{renderRows(g.sessions)}</div>
                        </div>
                      ))
                      : <div className="px-2">{renderRows(rest)}</div>}
                  </>}
                </>
              )
            })()}
          </>
        </div>

        {/* footer: sandbox badge */}
        <div className="border-t border-border px-3 py-3">
          <button
            data-testid="nav-settings"
            onClick={onOpenSettings}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-muted hover:bg-surface hover:text-accent"
          >
            <Settings aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} /><span>设置</span>
          </button>
          <div
            data-testid="sandbox-badge"
            className={
              'mt-2 flex items-center gap-1 truncate text-2xs ' +
              (sandbox === 'none' ? 'text-danger' : 'text-fg-subtle')
            }
            title={sandbox === 'none' ? '命令未在沙箱内执行' : sandbox === 'macos-seatbelt' ? '命令在 Seatbelt 沙箱内执行' : '沙箱状态未知'}
          >
            {sandbox === 'none'
              ? <><ShieldAlert className="h-3 w-3 shrink-0" strokeWidth={1.5} />沙箱未启用</>
              : sandbox === 'macos-seatbelt'
                ? <><ShieldCheck className="h-3 w-3 shrink-0" strokeWidth={1.5} />沙箱: Seatbelt</>
                : <><Shield className="h-3 w-3 shrink-0" strokeWidth={1.5} />沙箱: —</>}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
