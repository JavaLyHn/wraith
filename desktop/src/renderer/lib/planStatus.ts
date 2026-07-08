export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed'

export function planStatusIcon(s: PlanStepStatus): string {
  switch (s) {
    case 'pending': return '○'
    case 'running': return '◐'
    case 'done': return '✓'
    case 'failed': return '✗'
  }
}

export function planStatusClass(s: PlanStepStatus): string {
  switch (s) {
    case 'running': return 'text-accent'
    case 'done': return 'text-green-500'
    case 'failed': return 'text-danger'
    default: return 'text-fg-subtle'
  }
}
