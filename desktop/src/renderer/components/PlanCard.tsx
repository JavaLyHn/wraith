import { useState } from 'react'
import type { HTMLAttributes } from 'react'
import {
  planStatusIcon, planStatusClass, planStatusAnimation, planProgressLabel,
  type PlanStepStatus,
} from '../lib/planStatus'
import { useStickToBottom } from '../lib/stickToBottom'
import { cn } from '../lib/utils'

interface PlanStep { id: string; description: string; status: PlanStepStatus; result?: string; output?: string }
interface PlanItem { type: 'plan'; planId: string; goal: string; steps: PlanStep[]; plannerOutput?: string }
interface PlanReviewItem {
  type: 'planReview'
  reviewId: string
  planId: string
  goal: string
  steps: { id: string; description: string }[]
  resolved: boolean
}

interface PlanChecklistProps extends HTMLAttributes<HTMLDivElement> {
  item: PlanItem
}

interface PlanReviewCardProps extends HTMLAttributes<HTMLDivElement> {
  item: PlanReviewItem
  onReview: (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => void
}

/**
 * 流式输出框：内容增长时自动贴底（与 TeamCard 同一套 useStickToBottom）。
 * `[overflow-anchor:none]` 挡浏览器的 scroll anchoring 在内容增长时反向补偿 scrollTop。
 */
function PlanStreamBox({ text }: { text: string }): JSX.Element {
  const ref = useStickToBottom<HTMLDivElement>(text)
  return (
    <div ref={ref}
      className="ml-5 mt-0.5 max-h-48 overflow-y-auto [overflow-anchor:none] rounded border border-border bg-bg px-2 py-1 text-fg-subtle">
      <pre className="whitespace-pre-wrap break-words text-xs">{text}</pre>
    </div>
  )
}

/** 单个步骤行（含可折叠输出区）。 */
function PlanStepRow({ s }: { s: PlanStep }): JSX.Element {
  const running = s.status === 'running'
  // running 步骤默认展开:折叠着就等于看不到它在动 —— 而"看得出在动"正是这张卡的职责。
  // 完成的步骤仍默认折叠,否则整卡会被历史正文撑爆。
  const [override, setOverride] = useState<boolean | null>(null)
  const expanded = override ?? running
  // 步骤正文优先取流式 output，缺失时回落到完成事件的 result（二者为同一份内容）。
  // 绝不内联渲染整段答案，否则中文描述会被挤成单字竖排。
  const body = (s.output && s.output.length > 0) ? s.output : (s.result ?? '')
  const hasBody = body.length > 0
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-start gap-2">
        {/* running 时图标转起来。inline-block 必需:transform 对 inline 元素无效 */}
        <span className={`shrink-0 ${planStatusClass(s.status)} ${planStatusAnimation(s.status)}`}>
          {planStatusIcon(s.status)}
        </span>
        <span className="min-w-0 flex-1 break-words text-fg-muted">{s.description}</span>
        {hasBody && (
          <button
            className="ml-1 shrink-0 text-fg-subtle hover:text-fg-muted"
            onClick={() => setOverride(!expanded)}
            aria-label={expanded ? '折叠输出' : '展开输出'}
          >
            {expanded ? '▼ 输出' : '▶ 输出'}
          </button>
        )}
      </div>
      {hasBody && expanded && <PlanStreamBox text={body} />}
    </li>
  )
}

export function PlanChecklist({ item, className: incomingClass, ...rest }: PlanChecklistProps): JSX.Element {
  // 计划表(steps)到达前的"规划中"实时正文:消除数秒空窗的"死机感"。steps 一到即收敛为清单
  // (规划阶段流出的是计划 JSON 原文,计划表出来后再展示原文冗余,故仅生成期显示)。
  const generating = item.steps.length === 0
  const hasPlannerOutput = typeof item.plannerOutput === 'string' && item.plannerOutput.length > 0
  const progress = planProgressLabel(item.steps)
  const running = item.steps.some(s => s.status === 'running')
  return (
    <div className={cn(incomingClass, "my-1.5 rounded-lg border border-border bg-surface p-3 text-xs font-mono")} {...rest}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-accent">计划{item.goal ? ` · ${item.goal}` : ''}</span>
        {/* 实时进度:光看一排图标数不出来跑到第几步了 */}
        {progress && (
          <span data-testid="plan-progress"
            className={'text-2xs ' + (running ? 'animate-pulse text-accent' : 'text-fg-subtle')}>
            {progress}
          </span>
        )}
      </div>
      {generating && hasPlannerOutput && (
        <div>
          <div className="mb-0.5 flex items-center gap-1 text-accent">
            <span className="animate-pulse">🧭</span>
            <span>正在规划…</span>
          </div>
          <PlanStreamBox text={item.plannerOutput ?? ''} />
        </div>
      )}
      {item.steps.length > 0 && (
        <ul className="flex flex-col gap-1">
          {item.steps.map(s => (
            <PlanStepRow key={s.id} s={s} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function PlanReviewCard(
  { item, onReview, className: incomingClass, ...rest }: PlanReviewCardProps,
): JSX.Element {
  const [supplementing, setSupplementing] = useState(false)
  const [feedback, setFeedback] = useState('')
  if (item.resolved) return <></>
  return (
    <div className={cn(incomingClass, "my-1.5 rounded-lg border border-accent bg-surface p-3 text-xs font-mono")} {...rest}>
      <div className="mb-2 font-semibold text-accent">复审计划 · {item.goal}</div>
      <ul className="mb-3 flex flex-col gap-1">
        {item.steps.map(s => (
          <li key={s.id} className="text-fg-muted">• {s.description}</li>
        ))}
      </ul>
      {supplementing ? (
        <div className="flex flex-col gap-2">
          <textarea
            data-testid="plan-supplement"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            className="rounded border border-border bg-surface p-2 text-fg-muted"
            placeholder="补充要求…"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              className="rounded border border-accent px-2 py-1 text-accent hover:bg-accent/10"
              onClick={() => onReview(item.reviewId, 'supplement', feedback)}
            >
              提交补充
            </button>
            <button
              className="rounded border border-border px-2 py-1 text-fg-muted hover:bg-fg/[0.05]"
              onClick={() => setSupplementing(false)}
            >
              返回
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            data-testid="plan-execute"
            className="rounded border border-accent px-2 py-1 text-accent hover:bg-accent/10"
            onClick={() => onReview(item.reviewId, 'execute')}
          >
            执行
          </button>
          <button
            className="rounded border border-border px-2 py-1 text-fg-muted hover:bg-fg/[0.05]"
            onClick={() => setSupplementing(true)}
          >
            补充
          </button>
          <button
            data-testid="plan-cancel"
            className="rounded border border-danger px-2 py-1 text-danger hover:bg-danger/10"
            onClick={() => onReview(item.reviewId, 'cancel')}
          >
            取消
          </button>
        </div>
      )}
    </div>
  )
}
