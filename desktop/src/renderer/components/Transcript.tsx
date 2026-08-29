import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List } from 'react-window'
import type { ListImperativeAPI } from 'react-window'
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
import { groupToolRuns, type RenderNode } from '../lib/groupToolRuns'
import RulerTimeline from './RulerTimeline'
import { timelineMarksAttrs } from '../lib/timelineMarks'
import { useTranscriptRowHeights } from '../lib/useTranscriptRowHeights'
import { TranscriptRow } from './TranscriptRow'
import type { DynamicRowHeight } from 'react-window'

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
  /** 分支回调:在某条 Wraith 回复处创建会话分支。 */
  onBranch?: (msgIndex: number) => void
  /** 分支操作执行中(禁用按钮)。 */
  branchingMsgIndex?: number | null
}

// 传给虚拟行组件的 props(不含 index/style/ariaAttributes,由 react-window 注入)
interface RowProps {
  renderNodes: RenderNode[]
  marks: ReturnType<typeof timelineMarksAttrs>
  chipsByMsg: Map<number, ReturnType<typeof filesUnderMessages> extends Map<any, infer V> ? V : never>
  totalUsers: number
  busy: boolean
  mode: RunMode
  editors: EditorApp[]
  workspace: string | null
  onEditMessage: (ordinal: number, newText: string) => void
  onDeleteMessage: (ordinal: number) => void
  onResendMessage: (ordinal: number, text: string) => void
  onPlanReview: (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => void
  onOpenArtifact?: (filePath: string, content: string) => void
  onOpenDiff?: (filePath: string, before: string, after: string) => void
  onUndo?: (file: ArtifactFile) => Promise<{ ok: boolean; message?: string }>
  onOpenPanel: (id: PanelId) => void
  onImBound?: (platform: string, gatewayState: GatewayState | null) => void
  onBranch?: (msgIndex: number) => void
  branchingMsgIndex?: number | null
  onHoverHid: (hid: string | null) => void
  dynamicRowHeight: DynamicRowHeight
}

export default function Transcript({ items, busy, onEditMessage, onDeleteMessage, onResendMessage, onPlanReview, mode, onOpenArtifact, onOpenDiff, onUndo, editors, workspace, onOpenPanel, onImBound, onBranch, branchingMsgIndex }: TranscriptProps): JSX.Element {
  const totalUsers = items.filter(i => i.type === 'user').length
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<ListImperativeAPI | null>(null)
  const stickRef = useRef(true)
  const [hoveredHid, setHoveredHid] = useState<string | null>(null)
  const [listHeight, setListHeight] = useState(600)
  const chipsByMsg = useMemo(() => filesUnderMessages(items), [items])
  const renderNodes = useMemo(() => groupToolRuns(items), [items])
  const marks = useMemo(() => timelineMarksAttrs(renderNodes), [renderNodes])
  const turns = useMemo(() => marks.filter(m => m.markType === 'dot').map(m => m.hid), [marks])
  const showWorkingIndicator = busy && items[items.length - 1]?.type === 'user'

  const { dynamicRowHeight } = useTranscriptRowHeights(renderNodes.length + (showWorkingIndicator ? 1 : 0))

  // 容器尺寸监听
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height ?? 600
      setListHeight(height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 自动贴底
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    if (items[items.length - 1]?.type === 'user') stickRef.current = true
    if (stickRef.current && renderNodes.length > 0) {
      requestAnimationFrame(() => {
        list.scrollToRow({ align: 'end', index: renderNodes.length - 1 })
      })
    }
  }, [items, renderNodes.length])

  // 内容变化后重新贴底
  useEffect(() => {
    const list = listRef.current
    if (!list || !stickRef.current || renderNodes.length === 0) return
    requestAnimationFrame(() => {
      list.scrollToRow({ align: 'end', index: renderNodes.length - 1 })
    })
  }, [renderNodes])

  // 用户滚轮交互:记录手势时间
  const lastGestureRef = useRef(0)
  const markGesture = (): void => { lastGestureRef.current = performance.now() }

  // 点击横线跳转
  const scrollToHid = useCallback((hid: string): void => {
    const idx = marks.findIndex(m => m.hid === hid)
    if (idx < 0) return
    listRef.current?.scrollToRow({ align: 'smart', index: idx })
  }, [marks])

  // 行组件
  const RowComponent = useCallback((props: { index: number; style: React.CSSProperties } & RowProps) => {
    const { index, style } = props
    const {
      renderNodes: nodes, marks: mks, chipsByMsg: chips, totalUsers: totalU,
      busy: b, mode: m, editors: eds, workspace: ws,
      onEditMessage: onEdit, onDeleteMessage: onDel, onResendMessage: onResend,
      onPlanReview: onPlan, onOpenArtifact: onArt, onOpenDiff: onDiff, onUndo: onUndoFn,
      onOpenPanel: onPanel, onImBound: onBind, onBranch: onBr, branchingMsgIndex: branchIdx,
      onHoverHid: onHover, dynamicRowHeight: dynH,
    } = props

    // WorkingIndicator 占位行
    if (index >= nodes.length) {
      return (
        <div style={style} className="shrink-0">
          <div className="px-4 py-2">
            <WorkingIndicator mode={m} />
          </div>
        </div>
      )
    }

    const node = nodes[index]
    const mark = mks[index]
    const attrs = mark ? {
      'data-tl-hid': mark.hid,
      ...(mark.markType ? { 'data-tl-mark-type': mark.markType } : {}),
      onMouseEnter: () => onHover(mark.hid),
      onMouseLeave: () => onHover(null),
    } : {}

    // 计算截至当前行的 user 序号
    let userOrdinal = 0
    for (let i = 0; i <= index; i++) {
      const n = nodes[i]
      if (n.kind === 'item' && n.item.type === 'user') userOrdinal++
    }

    const renderChipsFor = (msgIdx: number): JSX.Element | null => {
      const chipList = chips.get(msgIdx)
      if (!chipList) return null
      return (
        <div className="flex gap-2.5">
          <div className="w-6 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {chipList.map(f => (
              <FileArtifactHoverPreview key={f.path} file={f} workspace={ws ?? null} editors={eds ?? []}
                onOpenPreview={onArt} onOpenDiff={onDiff} onUndo={onUndoFn} {...attrs} />
            ))}
          </div>
        </div>
      )
    }

    const content = ((): JSX.Element => {
      // 工具组
      if (node.kind === 'toolGroup') {
        const firstCallId = node.cards[0]?.callId ?? `toolgroup-${index}`
        if (node.cards.length === 1) {
          return <ToolCard card={node.cards[0]} {...attrs} />
        }
        return <ToolGroup cards={node.cards} {...attrs} />
      }

      const { item, originalIdx } = node
      if (item.type === 'user') {
        return (
          <>
            <UserMessage
              {...attrs}
              text={item.text}
              mode={item.mode}
              attachments={item.attachments}
              ordinal={userOrdinal}
              isLastUser={userOrdinal === totalU}
              busy={b}
              onEdit={onEdit}
              onDelete={onDel}
              onResend={onResend}
            />
            {renderChipsFor(originalIdx)}
          </>
        )
      }
      if (item.type === 'message') {
        return (
          <>
            <AgentMessage
              {...attrs}
              text={item.text}
              timestampMs={item.timestampMs}
              onBranch={onBr ? () => onBr(originalIdx) : undefined}
              branching={branchIdx === originalIdx}
            />
            {renderChipsFor(originalIdx)}
          </>
        )
      }
      if (item.type === 'error') {
        return (
          <div data-testid="turn-error" {...attrs}
            className="self-start max-w-[85%] rounded-2xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            ⚠️ 这一轮出错了:{item.text}
          </div>
        )
      }
      if (item.type === 'thinking') {
        return <ThinkingBlock label={item.label} text={item.text} done={item.done} {...attrs} />
      }
      if (item.type === 'action') {
        return <ActionCard panel={item.panel} onOpenPanel={onPanel} {...attrs} />
      }
      if (item.type === 'im-bind') {
        return <ImConnectCard platform={item.platform} workspace={ws} onOpenPanel={onPanel} onBound={onBind} {...attrs} />
      }
      if (item.type === 'system-event') {
        return (
          <div data-testid="system-event" {...attrs}
            className="self-center max-w-[85%] rounded-full border border-border bg-surface/60 px-3 py-1 text-2xs text-fg-subtle">
            ⊙ {item.text}
          </div>
        )
      }
      if (item.type === 'task-done') {
        return (
          <TaskDonePill text={item.text} ok={item.ok}
            onOpen={() => onPanel('tasks')} {...attrs} />
        )
      }
      if (item.type === 'plan') {
        return <PlanChecklist item={item} {...attrs} />
      }
      if (item.type === 'planReview') {
        return <PlanReviewCard item={item} onReview={onPlan} {...attrs} />
      }
      if (item.type === 'team') {
        return <TeamCard item={item} {...attrs} />
      }
      return <div />
    })()

    return (
      <TranscriptRow index={index} style={style} dynamicRowHeight={dynH}>
        {content}
      </TranscriptRow>
    )
  }, [])

  // 虚拟行 props(变化时触发重渲染)
  const rowProps: RowProps = {
    renderNodes,
    marks,
    chipsByMsg,
    totalUsers,
    busy,
    mode,
    editors: editors ?? [],
    workspace: workspace ?? null,
    onEditMessage,
    onDeleteMessage,
    onResendMessage,
    onPlanReview,
    onOpenArtifact,
    onOpenDiff,
    onUndo,
    onOpenPanel,
    onImBound,
    onBranch,
    branchingMsgIndex,
    onHoverHid: setHoveredHid,
    dynamicRowHeight,
  }

  const totalRowCount = renderNodes.length + (showWorkingIndicator ? 1 : 0)

  return (
    <div className="flex min-h-0 flex-1">
      <RulerTimeline
        turns={turns}
        activeHid={hoveredHid}
        onHover={setHoveredHid}
        onJump={scrollToHid}
      />
      <div
        ref={containerRef}
        onWheel={markGesture}
        onTouchMove={markGesture}
        data-testid="transcript"
        className="min-w-0 flex-1 overflow-hidden"
      >
        <List<RowProps>
          listRef={listRef}
          style={{ height: listHeight, width: '100%' }}
          rowCount={totalRowCount}
          rowHeight={dynamicRowHeight}
          rowComponent={RowComponent}
          rowProps={rowProps}
          overscanCount={5}
          className="overflow-y-auto [overflow-anchor:none]"
        />
      </div>
    </div>
  )
}
