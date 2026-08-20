import { useState, useRef, useEffect } from 'react'
import { cn } from '../lib/utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import {
  Plus, Search, Blocks, Clock, MessageSquare, Plug, BookOpen, Brain, History, Globe, ScanSearch,
  Star, ListTree, List, Archive, Settings, Wrench, ChevronDown, ListTodo, Shield, User, FolderOpen, AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import ProjectSwitcher from './ProjectSwitcher'
import Logo from './Logo'
import { sessionDisplayName, partitionStarred, groupSessionsByTime } from '../lib/sessionView'
import { userAvatarGlyph, accountGlyphDuplicatesName } from '../lib/chatIdentity'
import type { ProfilePrefs } from '../settings/prefs'
import type { SessionMeta, ProjectView } from '../../shared/types'

export function SessionRow({ s, active, running, failed, onSelect, onToggleStar, onRename, onArchive, dragState, onDragStart, onDragOver, onDrop, onDragEnd }: {
  s: SessionMeta; active: boolean; running: boolean; failed: boolean
  onSelect: (id: string) => void
  onToggleStar: (id: string, starred: boolean) => void
  onRename: (id: string, name: string) => void
  onArchive: (id: string) => void
  /** 拖拽状态（由 Sidebar 管理，传给每行做视觉反馈） */
  dragState?: { draggingId: string | null; overId: string | null } | null
  onDragStart?: (id: string) => void
  onDragOver?: (id: string) => void
  onDrop?: (id: string) => void
  onDragEnd?: () => void
}): JSX.Element {
  // 行内改名:Electron 渲染进程不支持 window.prompt,故用就地输入框
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)   // 防 Escape 后 onBlur 二次提交
  const titleRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (editing) { doneRef.current = false; editRef.current?.focus(); editRef.current?.select() }
  }, [editing])

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    const check = (): void => {
      setIsOverflowing(el.scrollWidth > el.clientWidth + 1)
    }
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [s.name, s.title])

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

  const isDragging = dragState?.draggingId === s.id
  const isDragOver = dragState?.overId === s.id && dragState?.draggingId !== s.id

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); onDragStart?.(s.id) }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver?.(s.id) }}
      onDrop={(e) => { e.preventDefault(); onDrop?.(s.id) }}
      onDragEnd={() => { onDragEnd?.() }}
      className={'group relative mb-0.5 flex items-center rounded-lg px-1 transition-opacity ' +
        (active ? 'relative bg-fg/10 before:absolute before:left-1 before:top-1/2 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent' : 'hover:bg-fg/5') +
        (isDragging ? ' opacity-40' : '') +
        (isDragOver ? ' ring-1 ring-accent/50' : '')}
      onDoubleClick={startEdit}
    >
      {running && (
        <span data-testid="session-running-dot" className="relative ml-1 flex h-2 w-2 shrink-0" title="运行中">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-accent opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
      )}
      {/* 异常中断标记:本轮问答出过问题(LLM 调用失败 / 后端断开等)。常显、优先于 hover 操作,
          但运行态让位给圆点 —— 新的一轮在跑,旧问题不再喧宾夺主。 */}
      {failed && !running && (
        <span data-testid="session-failed" className="shrink-0 pl-1" title="此会话曾有异常中断,点击会话可查看">
          <AlertTriangle className="h-3 w-3 text-danger" strokeWidth={2} fill="currentColor" fillOpacity={0.15} />
        </span>
      )}
      <button
        data-testid="conversation-item"
        onClick={() => onSelect(s.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={sessionDisplayName(s)}
        className={'min-w-0 flex-1 overflow-hidden px-2 py-2 text-left text-xs ' + (active ? 'text-fg' : 'text-fg-muted')}
      >
        <div ref={titleRef} className="relative overflow-hidden">
          <div className={cn(
            'inline-flex whitespace-nowrap',
            isOverflowing && hovered && 'animate-marquee'
          )}>
            <span className="pr-8">{sessionDisplayName(s)}</span>
            {isOverflowing && hovered && (
              <span className="pr-8" aria-hidden="true">{sessionDisplayName(s)}</span>
            )}
          </div>
        </div>
      </button>
      {/* 浮层操作组:不占布局空间(标题排满整行),hover 行或已星标时浮出。
          改名按钮已删 —— 双击行即可改名;左侧渐变让文字在按钮下方渐隐,避免生硬截断。 */}
      <div
        className={'absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-gradient-to-r from-transparent to-bg pl-5 pr-0.5 transition-opacity ' +
          (s.starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
      >
        <button data-testid="session-star" title={s.starred ? '取消重点' : '标记重点'}
          onClick={() => onToggleStar(s.id, !s.starred)}
          className={s.starred ? 'px-1 text-warn' : 'px-1 text-fg-subtle hover:text-fg'}>
          <Star className="h-3 w-3" strokeWidth={1.5} fill={s.starred ? 'currentColor' : 'none'} />
        </button>
        {/* 归档可逆(设置里能恢复),故单击生效不做二次确认;二次确认留给真正不可逆的永久删除 */}
        <button data-testid="session-archive"
          title={running ? '会话进行中,不可归档' : '归档(从列表收起,可在设置 › 归档中找回)'}
          disabled={running}
          onClick={() => onArchive(s.id)}
          className={'px-1 text-fg-subtle hover:text-fg ' + (running ? 'cursor-not-allowed opacity-40' : '')}>
          <Archive className="h-3 w-3" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}

type ToolNav = 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'
  | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents'
  | 'workspace'

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
  {
    // 前三组讲的是「agent 怎么工作」,这一组是「我的东西」——塞进任何一组
    // 都会让那组的分类依据失效,所以单开。目前一项,后续剪藏/归档也归这里。
    label: '资料',
    items: [
      { nav: 'documents', testId: 'nav-documents', label: '文档', Icon: FolderOpen },
      { nav: 'workspace', testId: 'nav-workspace', label: '文件', Icon: ListTree },
    ],
  },
]

interface SidebarProps {
  workspace: string
  projects: ProjectView[]
  busy: boolean
  sessions: SessionMeta[]
  /** 异常中断(LLM 失败/后端断开等)的会话 id 集合:对应会话行右侧显示感叹号。 */
  failedSessions: ReadonlySet<string>
  activeSessionId: string
  runningSessionId: string
  /** 当前是尚未落桩的空白新会话:侧栏顶部显示一条「新对话」草稿行并高亮。 */
  newDraftActive: boolean
  onNewConversation: () => void
  onSelectSession: (id: string) => void
  onToggleStar: (id: string, starred: boolean) => void
  onRenameSession: (id: string, name: string) => void
  onArchiveSession: (id: string) => void
  /** 拖拽排序：把 sourceId 移到 targetId 的位置。
   *  targetSection 标识 drop 目标所在分区 —— 跨分区拖拽(普通⇄重点)由 App 层
   *  语义化为自动星标切换,否则 partitionStarred 渲染时会把它弹回原分区,表现为"拖不进"。 */
  onReorderSession?: (sourceId: string, targetId: string, targetSection?: 'starred' | 'rest') => void
  onActivateProject: (path: string) => void
  onAddProject: () => void
  /** 进「项目」面板看全量(改名/移出/整理都在那儿)。 */
  onOpenAllProjects: () => void
  /** 账户行的头像/昵称来源(设置→「我」)。沙箱状态已移出侧栏,见顶栏的盾图标。 */
  profile: ProfilePrefs
  activeNav: 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents' | 'workspace' | 'projects' | 'settings' | null
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
  onOpenDocuments: () => void
  onOpenWorkspace?: () => void
  onOpenSettings: () => void
  automationBadge: boolean
  /** 后台任务活跃数(running + enqueued);0 = 不显示。全局队列,不区分会话。 */
  taskActiveCount: number
  /** 打开命令面板(搜索)。 */
  onOpenSearch: () => void
}

export default function Sidebar({
  workspace,
  projects,
  busy,
  sessions,
  failedSessions,
  activeSessionId,
  runningSessionId,
  newDraftActive,
  onNewConversation,
  onSelectSession,
  onToggleStar,
  onRenameSession,
  onArchiveSession,
  onReorderSession,
  onActivateProject,
  onAddProject,
  onOpenAllProjects,
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
  onOpenDocuments,
  onOpenWorkspace = () => {},
  onOpenSettings,
  automationBadge,
  taskActiveCount,
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
  // 拖拽排序状态
  const [dragState, setDragState] = useState<{ draggingId: string | null; overId: string | null }>({ draggingId: null, overId: null })
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
    documents: onOpenDocuments,
    workspace: onOpenWorkspace,
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
          onOpenAllProjects={onOpenAllProjects}
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
            {/* 折叠态:自动化红点(需处理)与后台任务计数(仅告知)都要冒上来,否则收起就看不见了。
                两者语义不同 —— 红 = 等你处理,accent = 正在跑,所以不合并成一个点。 */}
            {!showTools && taskActiveCount > 0 && (
              <span data-testid="nav-tools-task-count" className="ml-1 shrink-0 text-3xs text-accent">{taskActiveCount}</span>
            )}
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
                    {item.nav === 'tasks' && taskActiveCount > 0 && (
                      <span data-testid="nav-tasks-count"
                        className="ml-auto flex shrink-0 items-center gap-1 text-3xs text-accent">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75 motion-reduce:hidden" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                        </span>
                        {taskActiveCount}
                      </span>
                    )}
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
              const renderRows = (list: SessionMeta[], section: 'starred' | 'rest'): JSX.Element[] => list.map(s => (
                <SessionRow key={s.id} s={s} active={s.id === activeSessionId}
                  running={s.id === runningSessionId}
                  failed={failedSessions.has(s.id)}
                  onSelect={onSelectSession} onToggleStar={onToggleStar}
                  onRename={onRenameSession} onArchive={onArchiveSession}
                  dragState={dragState}
                  onDragStart={(id) => setDragState({ draggingId: id, overId: null })}
                  onDragOver={(id) => setDragState(prev => prev.draggingId ? { ...prev, overId: id } : prev)}
                  onDrop={(id) => { if (dragState.draggingId && dragState.draggingId !== id) onReorderSession?.(dragState.draggingId, id, section); setDragState({ draggingId: null, overId: null }) }}
                  onDragEnd={() => setDragState({ draggingId: null, overId: null })} />
              ))
              // sticky 表头:滚动时标题不动,内容从下方滑过(半透明 + 模糊)
              const headerCls = 'sticky top-0 z-20 mt-4 sidebar-sticky pl-5 pr-3 pb-1.5 pt-2 text-3xs uppercase tracking-wider text-fg-subtle'
              const groupLabelCls = 'sticky top-7 z-10 sidebar-sticky pl-5 pr-3 py-1 text-3xs uppercase tracking-wider text-fg-subtle'
              return (
                <>
                  {sessions.length === 0 && !newDraftActive && <div className="mt-4 px-3 py-2 text-xs text-fg-subtle">还没有历史会话</div>}
                  {starred.length > 0 && <>
                    <div className={headerCls + ' flex items-center gap-1'}><Star className="h-3 w-3 shrink-0" strokeWidth={1.5} />重点</div>
                    <div className="px-2">{renderRows(starred, 'starred')}</div>
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
                          <div className="px-2">{renderRows(g.sessions, 'rest')}</div>
                        </div>
                      ))
                      : <div className="px-2">{renderRows(rest, 'rest')}</div>}
                  </>}
                </>
              )
            })()}
          </>
        </div>

        {/* footer: 账户行。头像+昵称取自设置→「我」(prefs.profile),点整行进设置面板。
            沙箱状态已搬到顶栏的盾图标,这里不再常驻一行灰字。

            v2 —— 第一版「无底色 + 齿轮只在 hover 出现」静止态一个可点的信号都不剩,读作装饰。
            三处补回可供性:
              1. 常驻 bg-fg/5 —— 与上方「新对话」同一套底色,是本侧栏里"这是个按钮"的既有语言;
              2. 齿轮常显(hover/活动态才提亮),它是"这里通向设置"的唯一图形线索;
              3. 昵称用 text-fg 而非 muted —— 它是这行的主标签,之前比装饰性的头像还淡。 */}
        <div className="border-t border-border px-3 py-2.5">
          <button
            data-testid="nav-settings"
            onClick={onOpenSettings}
            title={'设置 · ' + displayName}
            className={'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ' +
              (activeNav === 'settings'
                ? 'relative bg-fg/10 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent'
                : 'bg-fg/5 hover:bg-fg/10')}
          >
            <span
              data-testid="account-avatar"
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-xs leading-none"
            >
              {glyphRedundant
                ? <User className="h-3 w-3 text-fg-muted" strokeWidth={1.5} />
                : userAvatarGlyph(profile)}
            </span>
            <span data-testid="account-name" className="flex-1 truncate text-xs text-fg">
              {displayName}
            </span>
            <Settings
              aria-hidden
              className={'h-3.5 w-3.5 shrink-0 transition-colors ' +
                (activeNav === 'settings' ? 'text-accent' : 'text-fg-subtle group-hover:text-accent')}
              strokeWidth={1.5}
            />
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
