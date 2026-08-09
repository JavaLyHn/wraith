import { Fragment, useEffect, useMemo, useRef } from 'react'
import type { Item } from '../../shared/transcriptReducer'
import type { RunMode } from '../../shared/types'
import WorkingIndicator from './WorkingIndicator'
import ThinkingBlock from './ThinkingBlock'
import ToolCard from './ToolCard'
import ToolGroup from './ToolGroup'
import UserMessage from './UserMessage'
import AgentMessage from './AgentMessage'
import FileArtifactHoverPreview from './FileArtifactHoverPreview'
import type { EditorApp } from '../../shared/editors'
import { filesUnderMessages } from '../../shared/artifactSummary'
import type { ArtifactFile } from '../../shared/artifactSummary'
import { PlanChecklist, PlanReviewCard } from './PlanCard'
import { TeamCard } from './TeamCard'
import ActionCard from './ActionCard'
import ImConnectCard from './ImConnectCard'
import TaskDonePill from './TaskDonePill'
import type { PanelId } from '../lib/panelActions'
import type { GatewayState } from '../../shared/gateway'
import { groupToolRuns } from '../lib/groupToolRuns'

interface TranscriptProps {
  items: Item[]
  /** turn 运行中:禁用消息编辑/删除。 */
  busy: boolean
  onEditMessage: (ordinal: number, newText: string) => void
  onDeleteMessage: (ordinal: number) => void
  onResendMessage: (ordinal: number, text: string) => void
  /** 计划复审响应回调。 */
  onPlanReview: (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => void
  /** 当前轮次模式,用于"处理中"占位文案(正在规划/思考中/组建团队)。 */
  mode: RunMode
  /** 点文件名开右侧内容预览。 */
  onOpenArtifact?: (filePath: string, content: string) => void
  /** 查看更改/审核 → 右侧 diff。 */
  onOpenDiff?: (filePath: string, before: string, after: string) => void
  /** 撤销:文件级写回 before(created 删除),返回是否成功。 */
  onUndo?: (file: ArtifactFile) => Promise<{ ok: boolean; message?: string }>
  editors?: EditorApp[]
  workspace?: string | null
  /** 打开功能面板(action / im-bind 动作卡用)。 */
  onOpenPanel: (id: PanelId) => void
  /** IM 卡绑定成功上报 —— 上层据此补一轮系统事件让 agent 知情。 */
  onImBound?: (platform: string, gatewayState: GatewayState | null) => void
}

export default function Transcript({ items, busy, onEditMessage, onDeleteMessage, onResendMessage, onPlanReview, mode, onOpenArtifact, onOpenDiff, onUndo, editors, workspace, onOpenPanel, onImBound }: TranscriptProps): JSX.Element {
  let userOrdinal = 0 // 渲染期为 user 气泡计数(1-based),rewind 用
  const totalUsers = items.filter(i => i.type === 'user').length
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // 贴底跟随:初始 true(载入历史直接落底);用户上翻(离底 >80px)即停跟,不打断阅读
  const stickRef = useRef(true)
  const chipsByMsg = useMemo(() => filesUnderMessages(items), [items])

  const renderChips = (idx: number): JSX.Element | null => {
    const chips = chipsByMsg.get(idx)
    if (!chips) return null
    return (
      <div className="flex gap-2.5">
        <div className="w-6 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {chips.map(f => (
            <FileArtifactHoverPreview key={f.path} file={f} workspace={workspace ?? null} editors={editors ?? []}
              onOpenPreview={onOpenArtifact} onOpenDiff={onOpenDiff} onUndo={onUndo} />
          ))}
        </div>
      </div>
    )
  }

  // 最近一次用户滚动手势(wheel/touch)的时刻。scroll 事件是异步的:内容增长后滞后触发的
  // scroll 会读到"已变大的 gap",若据此解除跟随会把自动贴底误关(满载下尤甚,且带守卫的钉底
  // 全被跳过 → 停在底部之上)。故解除跟随只认用户近期手势,内容增长的瞬时偏离一律保持跟随。
  const lastGestureRef = useRef(0)
  const markGesture = (): void => { lastGestureRef.current = performance.now() }

  const handleScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom) stickRef.current = true
    else if (performance.now() - lastGestureRef.current < 200) stickRef.current = false
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // 发送即强制贴底(最后一项是 user 气泡=刚提交/编辑重发);流式内容仅在贴底时跟随
    if (items[items.length - 1]?.type === 'user') stickRef.current = true
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  // 内容高度的变化可能发生在 items-effect 之后而不触发它:文件卡挂在 message 下(mock/真实里
  // message 常先于 tool/diff 到达),末段 tool 输出结算、字体回流等与 items 解耦的增长都会让上面
  // 那次同步 scrollTop 失准且不再跟随。用 ResizeObserver 观察内容实际尺寸,仍贴底时重新钉底 ——
  // 因果无关、确定性(配合 [overflow-anchor:none] 阻止浏览器反向补偿)。
  useEffect(() => {
    const el = containerRef.current
    const content = contentRef.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (stickRef.current) el.scrollTop = el.scrollHeight })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  // [&>*]:shrink-0 必不可少:卡片类子项(tool/thinking/diff)带 overflow-hidden,
  // 其 flex 自动最小高度为 0——内容一旦溢出容器,flex 会把它们压成 2px 边框线
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onWheel={markGesture}
      onTouchMove={markGesture}
      data-testid="transcript"
      className="flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none]"
    >
    <div ref={contentRef} className="flex flex-col gap-1 [&>*]:shrink-0">
      {groupToolRuns(items).map((node, nodeIdx) => {
        // 工具组：单张卡片直接渲染（避免双层展开），≥2 张才用可折叠 ToolGroup
        if (node.kind === 'toolGroup') {
          // 用首张卡片的 callId 作为稳定 key（同一 run 内 callId 唯一）
          const firstCallId = node.cards[0]?.callId ?? `toolgroup-${nodeIdx}`
          if (node.cards.length === 1) {
            return <ToolCard key={firstCallId} card={node.cards[0]} />
          }
          return <ToolGroup key={firstCallId} cards={node.cards} />
        }

        // 普通 item：按类型分发渲染；用 originalIdx 作 key，工具追加时不随分组位置偏移
        const { item, originalIdx } = node
        if (item.type === 'user') {
          userOrdinal++
          return (
            <Fragment key={`user-${userOrdinal}`}>
              <UserMessage
                text={item.text}
                mode={item.mode}
                attachments={item.attachments}
                ordinal={userOrdinal}
                isLastUser={userOrdinal === totalUsers}
                busy={busy}
                onEdit={onEditMessage}
                onDelete={onDeleteMessage}
                onResend={onResendMessage}
              />
              {renderChips(originalIdx)}
            </Fragment>
          )
        }
        if (item.type === 'message') {
          return (
            <Fragment key={`msg-${originalIdx}`}>
              <AgentMessage text={item.text} />
              {renderChips(originalIdx)}
            </Fragment>
          )
        }
        if (item.type === 'error') {
          return (
            <div key={`err-${originalIdx}`} data-testid="turn-error"
              className="self-start max-w-[85%] rounded-2xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
              ⚠️ 这一轮出错了:{item.text}
            </div>
          )
        }
        if (item.type === 'thinking') {
          return <ThinkingBlock key={`think-${originalIdx}`} label={item.label} text={item.text} done={item.done} />
        }
        if (item.type === 'diff') return null
        if (item.type === 'action') {
          return <ActionCard key={`action-${originalIdx}`} panel={item.panel} onOpenPanel={onOpenPanel} />
        }
        if (item.type === 'im-bind') {
          return <ImConnectCard key={`imbind-${originalIdx}`} platform={item.platform} workspace={workspace} onOpenPanel={onOpenPanel} onBound={onImBound} />
        }
        if (item.type === 'system-event') {
          return (
            <div key={`sysev-${originalIdx}`} data-testid="system-event"
              className="self-center max-w-[85%] rounded-full border border-border bg-surface/60 px-3 py-1 text-2xs text-fg-subtle">
              ⊙ {item.text}
            </div>
          )
        }
        if (item.type === 'task-done') {
          return (
            <TaskDonePill key={`taskdone-${item.taskId}`} text={item.text} ok={item.ok}
              onOpen={() => onOpenPanel('tasks')} />
          )
        }
        if (item.type === 'plan') {
          return <PlanChecklist key={item.planId} item={item} />
        }
        if (item.type === 'planReview') {
          return <PlanReviewCard key={item.reviewId} item={item} onReview={onPlanReview} />
        }
        if (item.type === 'team') {
          return <TeamCard key={item.teamId} item={item} />
        }
        return null
      })}
      {/* 处理中占位:轮次运行中且尚无任何输出(最后一项仍是刚发的 user 气泡)时显示,
          任何真实内容(plan/team 卡片、thinking、message、tool)到达后 last 不再是 user,自动消失。 */}
      {busy && items[items.length - 1]?.type === 'user' && <WorkingIndicator mode={mode} />}
    </div>
    </div>
  )
}
