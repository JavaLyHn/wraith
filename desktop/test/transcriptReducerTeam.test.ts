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

  // ── Task 5: plannerOutput + step.output streaming ─────────────────────────

  it('team.plan.output 两 delta 累加到 plannerOutput', () => {
    const s = run([
      ev('team.started', { teamId: 't2', goal: 'G', agents: [] }),
      ev('team.plan.output', { teamId: 't2', text: 'Hello ' }),
      ev('team.plan.output', { teamId: 't2', text: 'World' }),
    ])
    const item: any = s.items.find(i => i.type === 'team' && i.teamId === 't2')
    expect(item.plannerOutput).toBe('Hello World')
  })

  it('team.plan.output unknown teamId 安全忽略', () => {
    const s = run([
      ev('team.started', { teamId: 't2', goal: 'G', agents: [] }),
      ev('team.plan.output', { teamId: 'unknown', text: 'X' }),
    ])
    const item: any = s.items.find(i => i.type === 'team' && i.teamId === 't2')
    expect(item.plannerOutput).toBeUndefined()
  })

  it('team.step.output 两 delta 累加到该步 output，另一步保持 undefined', () => {
    const s = run([
      ev('team.started', { teamId: 't3', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't3', steps: [
        { id: 's1', description: 'A', type: 'X', dependencies: [] },
        { id: 's2', description: 'B', type: 'X', dependencies: [] },
      ] }),
      ev('team.step.output', { teamId: 't3', stepId: 's1', text: 'foo ' }),
      ev('team.step.output', { teamId: 't3', stepId: 's1', text: 'bar' }),
    ])
    const item: any = s.items.find(i => i.type === 'team' && i.teamId === 't3')
    expect(item.steps.find((x: any) => x.id === 's1').output).toBe('foo bar')
    expect(item.steps.find((x: any) => x.id === 's2').output).toBeUndefined()
  })

  it('两个并行 step 的 step.output 乱序到达各归其位，不串台', () => {
    const s = run([
      ev('team.started', { teamId: 't4', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't4', steps: [
        { id: 'sA', description: 'A', type: 'X', dependencies: [] },
        { id: 'sB', description: 'B', type: 'X', dependencies: [] },
      ] }),
      ev('team.step.output', { teamId: 't4', stepId: 'sA', text: 'alpha1 ' }),
      ev('team.step.output', { teamId: 't4', stepId: 'sB', text: 'beta1 ' }),
      ev('team.step.output', { teamId: 't4', stepId: 'sA', text: 'alpha2' }),
      ev('team.step.output', { teamId: 't4', stepId: 'sB', text: 'beta2' }),
    ])
    const item: any = s.items.find(i => i.type === 'team' && i.teamId === 't4')
    expect(item.steps.find((x: any) => x.id === 'sA').output).toBe('alpha1 alpha2')
    expect(item.steps.find((x: any) => x.id === 'sB').output).toBe('beta1 beta2')
  })

  it('team.step.output unknown stepId 安全忽略', () => {
    const s = run([
      ev('team.started', { teamId: 't5', goal: 'G', agents: [] }),
      ev('team.plan', { teamId: 't5', steps: [
        { id: 's1', description: 'A', type: 'X', dependencies: [] },
      ] }),
      ev('team.step.output', { teamId: 't5', stepId: 'ghost', text: 'X' }),
    ])
    const item: any = s.items.find(i => i.type === 'team' && i.teamId === 't5')
    expect(item.steps.find((x: any) => x.id === 's1').output).toBeUndefined()
  })
})
