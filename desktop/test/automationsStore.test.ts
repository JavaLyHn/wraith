import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readTasks, upsertTask, removeTask,
  readRuns, putRun,
  readLastPanelOpenedAt, writeLastPanelOpenedAt, badgeVisible,
} from '../src/main/automationsStore'
import type { AutomationTask, AutomationRun } from '../src/shared/types'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-auto-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

function task(id: string, over: Partial<AutomationTask> = {}): AutomationTask {
  return { id, name: 'n' + id, prompt: 'p', projectPath: '/proj', enabled: true,
    schedule: { kind: 'interval', everyMinutes: 10 }, createdAt: 1000, enabledAt: 1000, lastFiredAt: null, ...over }
}
function run(runId: string, taskId: string, over: Partial<AutomationRun> = {}): AutomationRun {
  return { runId, taskId, startedAt: 1000, status: 'success', endedAt: 2000, ...over }
}

describe('automationsStore', () => {
  it('tasks: upsert 去重(按 id)与读回', () => {
    upsertTask(dir, task('a'))
    upsertTask(dir, task('a', { name: '改名' }))
    upsertTask(dir, task('b'))
    const ts = readTasks(dir)
    expect(ts.map(t => t.id)).toEqual(['a', 'b'])
    expect(ts[0]!.name).toBe('改名')
  })

  it('removeTask 连带删除该任务 runs,他任务不受影响', () => {
    upsertTask(dir, task('a')); upsertTask(dir, task('b'))
    putRun(dir, run('r1', 'a')); putRun(dir, run('r2', 'b'))
    removeTask(dir, 'a')
    expect(readTasks(dir).map(t => t.id)).toEqual(['b'])
    expect(readRuns(dir).map(r => r.runId)).toEqual(['r2'])
  })

  it('putRun 按 runId upsert(状态迁移覆盖同条)', () => {
    putRun(dir, run('r1', 'a', { status: 'running', endedAt: undefined }))
    putRun(dir, run('r1', 'a', { status: 'success', endedAt: 5000 }))
    const rs = readRuns(dir)
    expect(rs).toHaveLength(1)
    expect(rs[0]!.status).toBe('success')
  })

  it('每任务裁剪至最近 50 条(按 startedAt 倒序保留)', () => {
    for (let i = 0; i < 55; i++) putRun(dir, run('r' + i, 'a', { startedAt: i }))
    putRun(dir, run('other', 'b', { startedAt: 1 }))
    const rs = readRuns(dir)
    expect(rs.filter(r => r.taskId === 'a')).toHaveLength(50)
    expect(rs.filter(r => r.taskId === 'a').every(r => r.startedAt >= 5)).toBe(true)
    expect(rs.filter(r => r.taskId === 'b')).toHaveLength(1)
  })

  it('badgeVisible:waiting_approval 或 终态晚于上次打开', () => {
    const waiting = [run('r1', 'a', { status: 'waiting_approval', endedAt: undefined })]
    expect(badgeVisible(waiting, 9999)).toBe(true)
    const done = [run('r1', 'a', { status: 'success', endedAt: 500 })]
    expect(badgeVisible(done, 100)).toBe(true)
    expect(badgeVisible(done, 600)).toBe(false)
    expect(badgeVisible([run('r1', 'a', { status: 'running', endedAt: undefined })], 0)).toBe(false)
  })

  it('lastPanelOpenedAt 读写往返,缺省 0', () => {
    expect(readLastPanelOpenedAt(dir)).toBe(0)
    writeLastPanelOpenedAt(dir, 777)
    expect(readLastPanelOpenedAt(dir)).toBe(777)
  })

  it('坏 JSON 按空处理不崩', () => {
    fs.writeFileSync(path.join(dir, 'automations.json'), 'not json', 'utf8')
    fs.writeFileSync(path.join(dir, 'runs.json'), '[broken', 'utf8')
    expect(readTasks(dir)).toEqual([])
    expect(readRuns(dir)).toEqual([])
  })
})
