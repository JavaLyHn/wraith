import { useState, useRef, useEffect } from 'react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import {
  Plus, Search, Blocks, Clock, MessageSquare, Plug, BookOpen, Brain, History, Globe, ScanSearch,
  Star, ListTree, List, Pencil, Trash2, Check, Settings, Wrench, ChevronDown, ListTodo, Shield, User,
  type LucideIcon,
} from 'lucide-react'
import ProjectSwitcher from './ProjectSwitcher'
import Logo from './Logo'
import { sessionDisplayName, partitionStarred, groupSessionsByTime } from '../lib/sessionView'
import { userAvatarGlyph, accountGlyphDuplicatesName } from '../lib/chatIdentity'
import type { ProfilePrefs } from '../settings/prefs'
import type { SessionMeta, ProjectView } from '../../shared/types'

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
      <div className="mb-0.5 flex items-center rounded-lg bg-fg/10 px-1">
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
      (active ? 'relative bg-fg/10 before:absolute before:left-1 before:top-1/2 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent' : 'hover:bg-fg/5')}
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
        className={'shrink-0 px-1 ' + (s.starred ? 'text-warn' : 'text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100')}>
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

type ToolNav = 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'
  | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks'

/**
 * 工具项分组。依据是**什么时候会点它**,不是功能相似:
 *   配置 — 装好一次,几周不动;改完就走,不看结果
 *   运行 — 有东西在后台跑着,想看它怎么样了;有状态、会变、可能带红点
 *   观察 — 出事了回头查;只读为主,查完就关
 * 附带的好处:红点只可能出现在「运行」组,眼睛知道往哪儿扫。
 *
 * 11 项平铺时扫一遍要过 11 行。这里只加小标题、不做逐组折叠 —— 分段是为了扫得快,
 * 不是为了藏起来;「工具」本身已能整体折叠,再套一层只会给每次点击多加一步。
 */
const TOOL_GROUPS: { label: string; items: { nav: ToolNav; testId: string; label: string; Icon: LucideIcon }[] }[] = [
  {
    label: '配置',
    items: [
      { nav: 'plugins', testId: 'nav-plugins', label: 'MCP', Icon: Blocks },
      { nav: 'providers', testId: 'nav-providers', label: 'Provider 配置', Icon: Plug },
      { nav: 'skills', testId: 'nav-skills', label: '技能', Icon: BookOpen },
    ],
  },
  {
    label: '运行',
    items: [
      { nav: 'automations', testId: 'nav-automations', label: '自动化', Icon: Clock },
      { nav: 'im-gateway', testId: 'nav-im-gateway', label: 'IM 网关', Icon: MessageSquare },
      { nav: 'tasks', testId: 'nav-tasks', label: '后台任务', Icon: ListTodo },
    ],
  },
  {
    label: '观察',
    items: [
      { nav: 'memory', testId: 'nav-memory', label: '记忆', Icon: Brain },
      { nav: 'snapshots', testId: 'nav-snapshots', label: '快照', Icon: History },
      // 中性盾:状态语义(ok/未启用)由顶栏那个盾承担,这里只是分类图标,别用带勾的
      { nav: 'policy', testId: 'nav-policy', label: '安全', Icon: Shield },
      { nav: 'browser', testId: 'nav-browser', label: '浏览器', Icon: Globe },
      { nav: 'rag', testId: 'nav-rag', label: '代码检索', Icon: ScanSearch },
    ],
  },
]

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
  /** 账户行的头像/昵称来源(设置→「我」)。沙箱状态已移出侧栏,见顶栏的盾图标。 */
  profile: ProfilePrefs
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
  profile,
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
}: SidebarProps): JSX.Element {
  // 进入某工具页时自动展开一次(让高亮的活动项可见);此后由用户折叠意图决定,可手动收起并保持。
  // 不能写成 `toolsExpanded || activeNav !== null` 派生——在工具页时那会强制展开、压过用户点
  // 「工具」头部的收起意图(点了收不回,只有切回对话 activeNav→null 才收得起)。改用 effect 仅在
  // activeNav 变化(切到新工具页)时展开;activeNav 不变时用户的手动收起不被冲掉。
  const [toolsExpanded, setToolsExpanded] = useState<boolean>(() => activeNav !== null)
  useEffect(() => {
    if (activeNav !== null) setToolsExpanded(true)
  }, [activeNav])
  const showTools = toolsExpanded
  // 会话列表分组模式:recent=最新平铺(默认)/ time=按时间分组;记忆在 localStorage
  const [groupMode, setGroupMode] = useState<'recent' | 'time'>(() => {
    try { return localStorage.getItem('wraith.sidebar.sessionGroupMode') === 'time' ? 'time' : 'recent' } catch { return 'recent' }
  })
  // 昵称可以被清空(设置里那个输入框允许空串),空了得有个兜底,否则账户行只剩头像
  const displayName = profile.name.trim() || '我'
  // 默认状态(name='我' + 无 avatar)下字形与昵称同字,会渲染成「我 我」——那时头像让位给通用图标
  const glyphRedundant = accountGlyphDuplicatesName(profile, displayName)
  // TOOL_GROUPS 只描述"有哪些项、怎么分组",回调仍由 props 逐个传入 —— 这张表把两者对上
  const handlers: Record<ToolNav, () => void> = {
    plugins: onOpenPlugins,
    automations: onOpenAutomations,
    'im-gateway': onOpenImGateway,
    providers: onOpenProviders,
    skills: onOpenSkills,
    memory: onOpenMemory,
    snapshots: onOpenSnapshots,
    policy: onOpenPolicy,
    browser: onOpenBrowser,
    rag: onOpenRag,
    tasks: onOpenTasks,
  }
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
          {/* 搜索:原为 nav 里一整行「🔍 搜索」,现收进标题行只留图标(省一行高度)。
              必须是 brand-home 的**兄弟**而非其子元素 —— 后者会连带触发「新对话」。 */}
          <button
            type="button"
            data-testid="nav-search"
            onClick={onOpenSearch}
            aria-label="搜索"
            title="搜索(⌘K)"
            className="mr-3 shrink-0 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-fg/5 hover:text-accent"
          >
            <Search className="h-4 w-4" strokeWidth={1.5} />
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
          {/* 工具组(可折叠;进入工具页自动展开)*/}
          <button
            data-testid="nav-tools-toggle"
            onClick={() => setToolsExpanded(v => !v)}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-fg/5"
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
          {TOOL_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <div className="mt-1.5 px-3 pb-0.5 text-3xs uppercase tracking-wider text-fg-subtle">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.nav}
                  data-testid={item.testId}
                  onClick={handlers[item.nav]}
                  className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
                    (activeNav === item.nav
                      ? 'relative bg-fg/10 before:absolute before:left-1 before:top-1/2 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent text-fg'
                      : 'text-fg-muted hover:bg-fg/5')}
                >
                  <span className="flex items-center gap-2">
                    <item.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />{item.label}
                    {item.nav === 'automations' && automationBadge && (
                      <span data-testid="nav-automations-badge" className="relative ml-auto flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75 motion-reduce:hidden" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
          </div>
          )}
        </nav>

        {/* conversations list */}
        <div className="flex-1 overflow-y-auto">
          {/* ⭐重点分区 + 对话分区 */}
          <>
            {(() => {
              const { starred, rest } = partitionStarred(sessions)
              const renderRows = (list: SessionMeta[]): JSX.Element[] => list.map(s => (
                <SessionRow key={s.id} s={s} active={s.id === activeSessionId}
                  running={s.id === runningSessionId}
                  onSelect={onSelectSession} onToggleStar={onToggleStar}
                  onRename={onRenameSession} onDelete={onDeleteSession} />
              ))
              // sticky 表头:滚动时标题不动,内容从下方滑过(半透明 + 模糊)
              const headerCls = 'sticky top-0 z-20 mt-4 sidebar-sticky pl-5 pr-3 pb-1.5 pt-2 text-3xs uppercase tracking-wider text-fg-subtle'
              const groupLabelCls = 'sticky top-7 z-10 sidebar-sticky pl-5 pr-3 py-1 text-3xs uppercase tracking-wider text-fg-subtle'
              return (
                <>
                  {sessions.length === 0 && !newDraftActive && <div className="mt-4 px-3 py-2 text-xs text-fg-subtle">还没有历史会话</div>}
                  {starred.length > 0 && <>
                    <div className={headerCls + ' flex items-center gap-1'}><Star className="h-3 w-3 shrink-0" strokeWidth={1.5} />重点</div>
                    <div className="px-2">{renderRows(starred)}</div>
                  </>}
                  {(rest.length > 0 || newDraftActive) && <>
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
                    {/* 草稿行:归属「对话」分区,置顶于列表 */}
                    {newDraftActive && (
                      <div className="px-2">
                        <button
                          type="button"
                          data-testid="session-draft"
                          onClick={onNewConversation}
                          title="当前新对话(发送消息后自动保存到列表)"
                          className="relative mb-0.5 flex w-full items-center gap-2 rounded-lg bg-fg/10 px-3 py-1.5 text-left text-xs text-fg before:absolute before:left-1 before:top-1/2 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent"
                        >
                          <span className="truncate">新对话</span>
                          <span className="ml-auto shrink-0 text-3xs text-fg-subtle">草稿</span>
                        </button>
                      </div>
                    )}
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

        {/* footer: 账户行。头像+昵称取自设置→「我」(prefs.profile),点整行进设置面板。
            单行、无副标题 —— 当前模型在 composer 的切换器里已有,重复写只是占高度。
            沙箱状态已搬到顶栏的盾图标(全局可见,异常才变红),这里不再常驻一行灰字。 */}
        <div className="border-t border-border px-3 py-2.5">
          <button
            data-testid="nav-settings"
            onClick={onOpenSettings}
            title={'设置 · ' + displayName}
            className={'group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ' +
              (activeNav === 'settings'
                ? 'relative bg-fg/10 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent'
                : 'hover:bg-fg/5')}
          >
            <span
              data-testid="account-avatar"
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sm leading-none"
            >
              {glyphRedundant
                ? <User className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
                : userAvatarGlyph(profile)}
            </span>
            <span data-testid="account-name" className={'flex-1 truncate text-xs ' + (activeNav === 'settings' ? 'text-fg' : 'text-fg-muted group-hover:text-fg')}>
              {displayName}
            </span>
            {/* 齿轮只在 hover / 活动态出现:常态下它是冗余的(整行就是设置入口) */}
            <Settings
              aria-hidden
              className={'h-3.5 w-3.5 shrink-0 transition-opacity ' +
                (activeNav === 'settings' ? 'text-accent opacity-100' : 'text-fg-subtle opacity-0 group-hover:opacity-100')}
              strokeWidth={1.5}
            />
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
