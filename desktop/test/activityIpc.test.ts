import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityItem, ActivitySnapshot } from '../src/shared/types'
import { registerActivityIpc } from '../src/main/activityIpc'
import type { WraithApi } from '../src/preload/index'

type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown> | unknown

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
  },
  webUtils: { getPathForFile: vi.fn() },
}))

const active = (kind: ActivityItem['kind'], id: string): ActivityItem => ({
  activityId: `${kind}:${id}`,
  kind,
  status: 'running',
  projectPath: 'D:/wraith',
  ...(kind === 'session' ? { sessionId: id } : kind === 'task' ? { taskId: id } : { runId: id }),
  startedAt: 1,
  updatedAt: 2,
})

function install(snapshot: ActivitySnapshot, currentSessionId = 'session-1') {
  const handlers = new Map<string, Handler>()
  const request = vi.fn().mockResolvedValue({ ok: true })
  registerActivityIpc({
    handle: (channel, handler) => handlers.set(channel, handler),
    snapshot: vi.fn().mockReturnValue(snapshot),
    listSnapshot: vi.fn().mockResolvedValue(snapshot),
    request,
    currentSessionId: () => currentSessionId,
    sessionInterruptParams: item => ({ sessionId: item.sessionId ?? null, turnId: null }),
  })
  return { handlers, request }
}

describe('activity IPC handlers', () => {
  it('registers the typed list handler and returns the activity snapshot', async () => {
    const snapshot: ActivitySnapshot = { activities: [active('task', 'task-1')], stale: true, error: 'backend unavailable' }
    const { handlers } = install(snapshot)

    expect(handlers.has('wraith:activityList')).toBe(true)
    expect(await handlers.get('wraith:activityList')!(undefined, 20)).toEqual(snapshot)
  })

  it.each([
    ['session', 'session-1', 'turn.interrupt', { sessionId: 'session-1', turnId: null }],
    ['task', 'task-1', 'task.cancel', { id: 'task-1' }],
  ] as const)('cancels a registered active %s through its fixed backend operation', async (kind, id, method, params) => {
    const { handlers, request } = install({ activities: [active(kind, id)], stale: false })

    await expect(handlers.get('wraith:activityCancel')!(undefined, { kind, id })).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(method, params)
  })

  it('does not interrupt an old active session because the backend interrupt is process-global', async () => {
    const { handlers, request } = install({ activities: [active('session', 'old-session')], stale: false }, 'current-session')

    await expect(handlers.get('wraith:activityCancel')!(undefined, { kind: 'session', id: 'old-session' }))
      .resolves.toEqual({ ok: false, message: '只能停止当前会话' })
    expect(request).not.toHaveBeenCalled()
  })

  it('reports automation cancellation as unavailable without calling a nonexistent backend method', async () => {
    const { handlers, request } = install({ activities: [active('automation', 'run-1')], stale: false })

    await expect(handlers.get('wraith:activityCancel')!(undefined, { kind: 'automation', id: 'run-1' }))
      .resolves.toEqual({ ok: false, message: '自动化运行暂不支持从活动中心停止' })
    expect(request).not.toHaveBeenCalled()
  })

  it('returns a typed failure when a registered item lacks its source id or the backend rejects', async () => {
    const malformedTask = { ...active('task', 'task-1'), taskId: undefined }
    const { handlers, request } = install({ activities: [malformedTask], stale: false })
    const cancel = handlers.get('wraith:activityCancel')!

    await expect(cancel(undefined, { kind: 'task', id: 'task-1' })).resolves.toEqual({ ok: false, message: '活动项缺少任务标识' })
    const working = install({ activities: [active('task', 'task-2')], stale: false })
    working.request.mockRejectedValueOnce(new Error('task backend unavailable'))
    await expect(working.handlers.get('wraith:activityCancel')!(undefined, { kind: 'task', id: 'task-2' }))
      .resolves.toEqual({ ok: false, message: 'task backend unavailable' })
  })

  it('rejects terminal, unknown, malformed, and unregistered items without calling the backend', async () => {
    const completed = { ...active('task', 'done-task'), status: 'completed' as const }
    const { handlers, request } = install({ activities: [completed], stale: false })
    const cancel = handlers.get('wraith:activityCancel')!

    await expect(cancel(undefined, { kind: 'task', id: 'done-task' })).resolves.toMatchObject({ ok: false })
    await expect(cancel(undefined, { kind: 'task', id: 'missing-task' })).resolves.toMatchObject({ ok: false })
    await expect(cancel(undefined, { kind: 'unknown', id: 'anything' })).resolves.toMatchObject({ ok: false })
    await expect(cancel(undefined, { kind: 'task' })).resolves.toMatchObject({ ok: false })
    expect(request).not.toHaveBeenCalled()
  })

  it('uses the raw registry snapshot for cancellation without invoking the Git-enriched list snapshot', async () => {
    const handlers = new Map<string, Handler>()
    const listSnapshot = vi.fn(async () => ({ activities: [active('task', 'task-1')], stale: false }))
    const request = vi.fn().mockResolvedValue({ ok: true })
  registerActivityIpc({
      handle: (channel, handler) => handlers.set(channel, handler),
    snapshot: () => ({ activities: [active('task', 'task-1')], stale: false }),
      listSnapshot,
      request,
      currentSessionId: () => 'session-1',
      sessionInterruptParams: item => ({ sessionId: item.sessionId ?? null, turnId: null }),
    })

    await handlers.get('wraith:activityCancel')!(undefined, { kind: 'task', id: 'task-1' })

    expect(request).toHaveBeenCalledWith('task.cancel', { id: 'task-1' })
    expect(listSnapshot).not.toHaveBeenCalled()
  })
})

let wraith: WraithApi

beforeAll(async () => {
  await import('../src/preload/index')
  wraith = electron.exposeInMainWorld.mock.calls[0][1] as WraithApi
})

beforeEach(() => {
  electron.invoke.mockReset()
  electron.on.mockReset()
  electron.removeListener.mockReset()
})

describe('activity preload bridge', () => {
  it('exposes only the fixed list and cancel channels', async () => {
    const snapshot: ActivitySnapshot = { activities: [], stale: false }
    electron.invoke.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ ok: true })

    await expect(wraith.activityList(12)).resolves.toBe(snapshot)
    await expect(wraith.activityCancel({ kind: 'task', id: 'task-1' })).resolves.toEqual({ ok: true })
    expect(electron.invoke).toHaveBeenNthCalledWith(1, 'wraith:activityList', 12)
    expect(electron.invoke).toHaveBeenNthCalledWith(2, 'wraith:activityCancel', { kind: 'task', id: 'task-1' })
  })

  it('unsubscribes exactly the activity event listener it registered', () => {
    const callback = vi.fn()
    const unsubscribe = wraith.onActivityEvent(callback)
    const listener = electron.on.mock.calls[0][1]
    const snapshot: ActivitySnapshot = { activities: [active('automation', 'run-1')], stale: false }

    listener({}, snapshot)
    unsubscribe()

    expect(callback).toHaveBeenCalledWith(snapshot)
    expect(electron.on).toHaveBeenCalledWith('wraith:activity-event', listener)
    expect(electron.removeListener).toHaveBeenCalledWith('wraith:activity-event', listener)
  })
})
