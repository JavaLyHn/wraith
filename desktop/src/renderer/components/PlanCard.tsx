import { useState } from 'react'
import { planStatusIcon, planStatusClass, type PlanStepStatus } from '../lib/planStatus'

interface PlanStep { id: string; description: string; status: PlanStepStatus; result?: string; output?: string }
interface PlanItem { type: 'plan'; planId: string; goal: string; steps: PlanStep[] }
interface PlanReviewItem {
  type: 'planReview'
  reviewId: string
  planId: string
  goal: string
  steps: { id: string; description: string }[]
  resolved: boolean
}

/** 单个步骤行（含可折叠输出区）。 */
function PlanStepRow({ s }: { s: PlanStep }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // 步骤正文优先取流式 output，缺失时回落到完成事件的 result（二者为同一份内容）。
  // 一律折叠展示——绝不内联渲染整段答案，否则中文描述会被挤成单字竖排。
  const body = (s.output && s.output.length > 0) ? s.output : (s.result ?? '')
  const hasBody = body.length > 0
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 ${planStatusClass(s.status)}`}>{planStatusIcon(s.status)}</span>
        <span className="min-w-0 flex-1 break-words text-fg-muted">{s.description}</span>
        {hasBody && (
          <button
            className="ml-1 shrink-0 text-fg-subtle hover:text-fg-muted"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? '折叠输出' : '展开输出'}
          >
            {expanded ? '▼ 输出' : '▶ 输出'}
          </button>
        )}
      </div>
      {hasBody && expanded && (
        <div className="ml-5 mt-0.5 max-h-48 overflow-y-auto rounded border border-border bg-bg px-2 py-1 text-fg-subtle">
          <pre className="whitespace-pre-wrap break-words text-xs">{body}</pre>
        </div>
      )}
    </li>
  )
}

export function PlanChecklist({ item }: { item: PlanItem }): JSX.Element {
  return (
    <div className="my-1.5 rounded-lg border border-border bg-surface p-3 text-xs font-mono">
      <div className="mb-2 font-semibold text-accent">计划 · {item.goal}</div>
      <ul className="flex flex-col gap-1">
        {item.steps.map(s => (
          <PlanStepRow key={s.id} s={s} />
        ))}
      </ul>
    </div>
  )
}

export function PlanReviewCard(
  { item, onReview }: {
    item: PlanReviewItem
    onReview: (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => void
  },
): JSX.Element {
  const [supplementing, setSupplementing] = useState(false)
  const [feedback, setFeedback] = useState('')
  if (item.resolved) return <></>
  return (
    <div className="my-1.5 rounded-lg border border-accent bg-surface p-3 text-xs font-mono">
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
