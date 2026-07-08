/**
 * TDD tests for transcriptReducer — team.* 事件 → TeamItem 归约。
 *
 * Run: cd desktop && npx vitest run transcriptReducerTeam
 */

import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialTranscriptState } from '../src/shared/transcriptReducer'

const ev = (method: string, params: any) => ({ kind: 'notification' as const, method, params })

function run(events: { method: string; params: any }[]) {
  return events.reduce((s, e) => transcriptReducer(s, e), initialTranscriptState())
}

describe('team 归约', () => {
  it('started→plan→batch→step 全序列形态正确', () => {
    const s = run([
      ev('team.started', { teamId: 't1', goal: 'G', agents: [{ id: 'planner', role: 'planner' }, { id: 'worker-1', role: 'worker' }] }),
      ev('team.plan', { teamId: 't1', steps: [{ id: 'step_1', description: 'A', type: 'COMMAND', dependencies: [] }, { id: 'step_2', description: 'B', type: 'COMMAND', dependencies: [] }] }),
      ev('team.batch', { teamId: 't1', batchIndex: 1, stepIds: ['step_1', 'step_2'] }),
      ev('team.step.started', { teamId: 't1', stepId: 'step_1', agent: 'worker-1' }),
      ev('team.step.completed', { teamId: 't1', stepId: 'step_1', status: 'completed', result: 'RA', approved: true, retries: 0 }),
      ev('team.finished', { teamId: 't1', status: 'partial' }),
    ])
    const item: any = s.items.find(i => i.type === 'team')
    expect(item.goal).toBe('G')
    expect(item.steps.map((x: any) => x.id)).toEqual(['step_1', 'step_2'])
    expect(item.steps[0]).toMatchObject({ agent: 'worker-1', status: 'done', result: 'RA', approved: true })
    expect(item.steps[1].status).toBe('pending')
    expect(item.parallelStepIds).toEqual(expect.arrayContaining(['step_1', 'step_2']))
    expect(item.status).toBe('partial')
  })

  it('两并行 step 的 completed 乱序到达各自归位', () => {
    const s = run([
      ev('team.started', { teamId: 't1', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't1', steps: [{ id: 'step_1', description: 'A', type: 'X', dependencies: [] }, { id: 'step_2', description: 'B', type: 'X', dependencies: [] }] }),
      ev('team.step.completed', { teamId: 't1', stepId: 'step_2', status: 'completed', result: 'R2', approved: true, retries: 1 }),
      ev('team.step.completed', { teamId: 't1', stepId: 'step_1', status: 'failed', result: 'E1', approved: false, retries: 0 }),
    ])
    const item: any = s.items.find(i => i.type === 'team')
    expect(item.steps.find((x: any) => x.id === 'step_2')).toMatchObject({ status: 'done', result: 'R2', retries: 1 })
    expect(item.steps.find((x: any) => x.id === 'step_1')).toMatchObject({ status: 'failed', result: 'E1' })
  })
})
