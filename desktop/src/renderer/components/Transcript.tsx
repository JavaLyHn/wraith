import { Fragment, useEffect, useMemo, useRef } from 'react'
import type { Item } from '../../shared/transcriptReducer'
import type { RunMode } from '../../shared/types'
import WorkingIndicator from './WorkingIndicator'
import ThinkingBlock from './ThinkingBlock'
import ToolCard from './ToolCard'
import ToolGroup from './ToolGroup'
import UserMessage from './UserMessage'
import AgentMessage from './AgentMessage'
import FileArtifactCard from './FileArtifactCard'
import type { EditorApp } from '../../shared/editors'
import { filesUnderMessages } from '../../shared/artifactSummary'
import type { ArtifactFile } from '../../shared/artifactSummary'
import { PlanChecklist, PlanReviewCard } from './PlanCard'
import { TeamCard } from './TeamCard'
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
  onUndo?: (file: ArtifactFile) => Promise<boolean>
  editors?: EditorApp[]
  workspace?: string | null
}

export default function Transcript({ items, busy, onEditMessage, onDeleteMessage, onResendMessage, onPlanReview, mode, onOpenArtifact, onOpenDiff, onUndo, editors, workspace }: TranscriptProps): JSX.Element {
  let userOrdinal = 0 // 渲染期为 user 气泡计数(1-based),rewind 用
  const totalUsers = items.filter(i => i.type === 'user').length
  const containerRef = useRef<HTMLDivElement>(null)
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
            <FileArtifactCard key={f.path} file={f} workspace={workspace ?? null} editors={editors ?? []}
              onOpenPreview={onOpenArtifact} onOpenDiff={onOpenDiff} onUndo={onUndo} />
          ))}
        </div>
      </div>
    )
  }

  const handleScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // 发送即强制贴底(最后一项是 user 气泡=刚提交/编辑重发);流式内容仅在贴底时跟随
    if (items[items.length - 1]?.type === 'user') stickRef.current = true
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  // [&>*]:shrink-0 必不可少:卡片类子项(tool/thinking/diff)带 overflow-hidden,
  // 其 flex 自动最小高度为 0——内容一旦溢出容器,flex 会把它们压成 2px 边框线
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-testid="transcript"
      className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4 [&>*]:shrink-0"
    >
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
  )
}
