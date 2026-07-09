import { useState } from 'react'
import type { TeamItem, TeamStep } from '../../shared/transcriptReducer'

// ---------------------------------------------------------------------------
// Role configuration
// ---------------------------------------------------------------------------

const ROLE_ICON: Record<string, string> = {
  planner: '🧭',
  worker: '🔧',
  reviewer: '🔎',
}

const ROLE_COLOR: Record<string, string> = {
  planner: 'text-blue-400 border-blue-400/40 bg-blue-400/10',
  worker: 'text-violet-400 border-violet-400/40 bg-violet-400/10',
  reviewer: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
}

function roleIcon(role: string): string {
  return ROLE_ICON[role] ?? '🤖'
}

function roleColor(role: string): string {
  return ROLE_COLOR[role] ?? 'text-fg-muted border-border bg-surface'
}

// ---------------------------------------------------------------------------
// Step status helpers
// ---------------------------------------------------------------------------

type TeamStepStatus = TeamStep['status']

function stepStatusIcon(s: TeamStepStatus): string {
  switch (s) {
    case 'pending': return '○'
    case 'running': return '◐'
    case 'done': return '✓'
    case 'failed': return '✗'
    case 'skipped': return '⏭'
    default: return '?'
  }
}

function stepStatusClass(s: TeamStepStatus): string {
  switch (s) {
    case 'running': return 'text-accent'
    case 'done': return 'text-green-500'
    case 'failed': return 'text-danger'
    case 'skipped': return 'text-fg-subtle'
    default: return 'text-fg-subtle'
  }
}

// ---------------------------------------------------------------------------
// Status dot for role chips in the header
// ---------------------------------------------------------------------------

/** Compute status dot class for a role chip in the header. */
function roleDotClass(
  role: string,
  agentId: string,
  steps: TeamStep[],
): string {
  const anyRunning = steps.some(s => s.status === 'running')
  if (role === 'planner') {
    // Planner is always green once steps exist
    return steps.length > 0 ? 'bg-green-500' : 'bg-fg-subtle/40'
  }
  if (role === 'reviewer') {
    return anyRunning ? 'bg-amber-400 animate-pulse' : 'bg-fg-subtle/40'
  }
  // Worker: amber if it's the agent of any running step
  const workerRunning = steps.some(s => s.status === 'running' && s.agent === agentId)
  return workerRunning ? 'bg-amber-400 animate-pulse' : 'bg-fg-subtle/40'
}

// ---------------------------------------------------------------------------
// Review verdict tag
// ---------------------------------------------------------------------------

function ReviewTag({ step }: { step: TeamStep }): JSX.Element | null {
  const retries = step.retries ?? 0
  if (step.status === 'failed') return null
  if (step.approved === true) {
    if (retries === 0) {
      return <span className="ml-1 text-green-500">✅ 审查通过</span>
    }
    return <span className="ml-1 text-amber-400">🔁 重试{retries}次后通过</span>
  }
  if (step.approved === false && step.status === 'done') {
    return <span className="ml-1 text-amber-400">⚠️ 保留</span>
  }
  return null
}

// ---------------------------------------------------------------------------
// TeamStepRow
// ---------------------------------------------------------------------------

function TeamStepRow({ step, roleColorClass }: { step: TeamStep; roleColorClass: string }): JSX.Element {
  // done 步骤结果默认展开：team 卡片即完整产出,输出不该藏在一次点击之后(保留折叠钮供收起)。
  const [expanded, setExpanded] = useState(true)
  const agentName = step.agent ?? ''

  // running 时优先展示流式 output（自动展开）；done 时展示 result（默认展开,可手动折叠）
  const isRunning = step.status === 'running'
  const hasLiveOutput = isRunning && typeof step.output === 'string' && step.output.length > 0
  const hasResult = !isRunning && typeof step.result === 'string' && step.result.length > 0

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-start gap-2">
        {/* Agent badge：文字为 agent 名(worker-1),配色按其角色(从 item.agents 解析后传入) */}
        {agentName && (
          <span
            className={`shrink-0 rounded border px-1 py-0 leading-none ${roleColorClass}`}
          >
            {agentName}
          </span>
        )}
        {/* Status icon（running 时脉冲动画,避免整卡看着静止） */}
        <span className={`shrink-0 ${step.status === 'running' ? 'animate-pulse ' : ''}${stepStatusClass(step.status)}`}>
          {stepStatusIcon(step.status)}
        </span>
        {/* Description */}
        <span className="min-w-0 flex-1 break-words text-fg-muted">{step.description}</span>
        {/* Review verdict */}
        <ReviewTag step={step} />
        {/* Expand toggle — 仅 done 且有 result 时显示 */}
        {hasResult && (
          <button
            className="ml-1 shrink-0 text-fg-subtle hover:text-fg-muted"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? '折叠输出' : '展开输出'}
          >
            {expanded ? '▼ 输出' : '▶ 输出'}
          </button>
        )}
      </div>
      {/* running 步骤：流式 output 自动展开 */}
      {hasLiveOutput && (
        <div className="ml-5 mt-0.5 max-h-48 overflow-y-auto rounded border border-border bg-bg px-2 py-1 text-fg-subtle">
          <pre className="whitespace-pre-wrap break-words text-xs">{step.output}</pre>
        </div>
      )}
      {/* done 步骤：result 可折叠 */}
      {hasResult && expanded && (
        <div className="ml-5 mt-0.5 max-h-48 overflow-y-auto rounded border border-border bg-bg px-2 py-1 text-fg-subtle">
          <pre className="whitespace-pre-wrap break-words text-xs">{step.result}</pre>
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// B1 parallel grouping helpers
// ---------------------------------------------------------------------------

type StepGroup =
  | { kind: 'solo'; step: TeamStep }
  | { kind: 'parallel'; steps: TeamStep[] }

function groupSteps(steps: TeamStep[], parallelStepIds: string[]): StepGroup[] {
  const parallelSet = new Set(parallelStepIds)
  const groups: StepGroup[] = []
  let i = 0
  while (i < steps.length) {
    const step = steps[i]
    if (parallelSet.has(step.id)) {
      // Collect consecutive parallel steps
      const batch: TeamStep[] = [step]
      let j = i + 1
      while (j < steps.length && parallelSet.has(steps[j].id)) {
        batch.push(steps[j])
        j++
      }
      groups.push({ kind: 'parallel', steps: batch })
      i = j
    } else {
      groups.push({ kind: 'solo', step })
      i++
    }
  }
  return groups
}

// ---------------------------------------------------------------------------
// Footer helpers
// ---------------------------------------------------------------------------

type TeamStatus = TeamItem['status']

function footerText(s: TeamStatus): string | null {
  switch (s) {
    case 'completed': return '✅ 协作完成'
    case 'partial': return '⚠️ 部分完成'
    case 'failed': return '❌ 有失败'
    default: return null
  }
}

function footerClass(s: TeamStatus): string {
  switch (s) {
    case 'completed': return 'border-green-500/40 text-green-500'
    case 'partial': return 'border-amber-400/40 text-amber-400'
    case 'failed': return 'border-danger/40 text-danger'
    default: return ''
  }
}

// ---------------------------------------------------------------------------
// TeamCard
// ---------------------------------------------------------------------------

export function TeamCard({ item }: { item: TeamItem }): JSX.Element {
  const groups = groupSteps(item.steps, item.parallelStepIds)
  const footer = footerText(item.status)
  // agentId(如 worker-1)→ role(worker),用于步骤徽标配色
  const roleById = new Map(item.agents.map(a => [a.id, a.role]))
  const stepRoleColor = (step: TeamStep): string => roleColor(roleById.get(step.agent ?? '') ?? '')

  return (
    <div className="my-1.5 rounded-lg border border-border bg-surface p-3 text-xs font-mono">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-accent">团队协作 · {item.goal}</span>
        {/* Role status chips */}
        <div className="flex flex-wrap gap-1">
          {item.agents.map(agent => (
            <span
              key={agent.id}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 leading-none ${roleColor(agent.role)}`}
            >
              {roleIcon(agent.role)}
              <span>{agent.id}</span>
              {/* Status dot */}
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${roleDotClass(agent.role, agent.id, item.steps)}`}
              />
            </span>
          ))}
        </div>
      </div>

      {/* Planner streaming area — 仅在 steps 尚未到达时显示实时规划输出 */}
      {item.steps.length === 0 && item.plannerOutput && item.plannerOutput.length > 0 && (
        <div className="mb-2">
          <div className="mb-0.5 text-blue-400">🧭 规划中…</div>
          <div className="max-h-48 overflow-y-auto rounded border border-border bg-bg px-2 py-1 text-fg-subtle">
            <pre className="whitespace-pre-wrap break-words text-xs">{item.plannerOutput}</pre>
          </div>
        </div>
      )}

      {/* Planning row — steps 到达后显示，取代实时规划区 */}
      {item.steps.length > 0 && (
        <div className="mb-2 text-fg-muted">
          🧭 拆解为 {item.steps.length} 步
        </div>
      )}

      {/* Step timeline with B1 parallel grouping */}
      {groups.length > 0 && (
        <ul className="flex flex-col gap-1">
          {groups.map(group => {
            if (group.kind === 'solo') {
              return <TeamStepRow key={group.step.id} step={group.step} roleColorClass={stepRoleColor(group.step)} />
            }
            // Parallel group — key 用批内首步 id(稳定),避免 batch 陆续到达时下标错位
            return (
              <li key={`parallel-${group.steps[0].id}`} className="flex flex-col gap-0.5">
                <div className="text-fg-subtle">⚡ 并行执行</div>
                <ul className="ml-3 flex flex-col gap-1 border-l border-border pl-2">
                  {group.steps.map(step => (
                    <TeamStepRow key={step.id} step={step} roleColorClass={stepRoleColor(step)} />
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}

      {/* Footer */}
      {footer !== null && (
        <div className={`mt-2 rounded border px-2 py-1 font-semibold ${footerClass(item.status)}`}>
          {footer}
        </div>
      )}
    </div>
  )
}
