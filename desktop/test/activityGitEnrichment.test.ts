import { describe, expect, it, vi } from 'vitest'
import {
  canonicalActivityProjectPath,
  enrichActivitySnapshot,
  readActivityGitBatchWithRunner,
  type ActivityGitBatchReader,
} from '../src/main/activityStore'
import type { ActivityItem, ActivitySnapshot } from '../src/shared/types'

const activity = (activityId: string, projectPath: string, overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  activityId,
  kind: 'session',
  status: 'running',
  projectPath,
  sessionId: activityId,
  startedAt: 1,
  updatedAt: 2,
  ...overrides,
})

const snapshot = (...activities: ActivityItem[]): ActivitySnapshot => ({ activities, stale: false })
const project = (value: string) => canonicalActivityProjectPath(value)

describe('activity Git enrichment', () => {
  it('canonicalizes equivalent Windows paths before deduplicating a Git batch', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: canonicalActivityProjectPath('c:/Projects/Wraith/', 'win32'), branch: 'main', changedFiles: 0, additions: 0, deletions: 0 },
    ])
    const first = canonicalActivityProjectPath('C:/Projects/Wraith', 'win32')
    const second = canonicalActivityProjectPath('c:\\projects\\wraith\\', 'win32')

    await enrichActivitySnapshot(snapshot(activity('session:one', first), activity('session:two', second)), reader)

    expect(first).toBe(second)
    expect(reader).toHaveBeenCalledWith([first])
  })

  it('executes every production Git read with fixed read-only argv and lock-free environment', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce('D:/projects/wraith\n')
      .mockResolvedValueOnce('## feat/activity\n M src/main.ts\n')
      .mockResolvedValueOnce('7\t2\tsrc/main.ts\n')

    await readActivityGitBatchWithRunner(['D:/projects/wraith'], run)

    expect(run).toHaveBeenNthCalledWith(1, 'git', ['--no-optional-locks', '-C', 'D:/projects/wraith', 'rev-parse', '--show-toplevel'], expect.objectContaining({ env: expect.objectContaining({ GIT_OPTIONAL_LOCKS: '0' }), windowsHide: true }))
    expect(run).toHaveBeenNthCalledWith(2, 'git', ['--no-optional-locks', '-C', 'D:/projects/wraith', 'status', '--porcelain=v1', '--branch'], expect.anything())
    expect(run).toHaveBeenNthCalledWith(3, 'git', ['--no-optional-locks', '-C', 'D:/projects/wraith', 'diff', '--no-ext-diff', '--numstat', 'HEAD'], expect.anything())
  })

  it('preserves operational rev-parse errors as row-local Git context', async () => {
    const run = vi.fn().mockRejectedValue(new Error('spawn git EACCES'))

    const result = await readActivityGitBatchWithRunner(['D:/projects/restricted'], run)

    expect(result).toEqual([expect.objectContaining({ projectPath: 'D:/projects/restricted', error: 'spawn git EACCES' })])
  })
  it('adds branch and worktree context for every activity sharing a Git project with one batch lookup', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: project('D:/projects/wraith'), branch: 'feat/activity', changedFiles: 3, additions: 12, deletions: 4 },
    ])

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:one', 'D:/projects/wraith'),
      activity('session:two', 'D:/projects/wraith'),
    ), reader)

    expect(reader).toHaveBeenCalledWith([project('D:/projects/wraith')])
    expect(enriched.activities).toEqual([
      expect.objectContaining({ branch: 'feat/activity', worktree: project('D:/projects/wraith'), git: {
        branch: 'feat/activity', worktree: project('D:/projects/wraith'), changedFiles: 3, additions: 12, deletions: 4,
      } }),
      expect.objectContaining({ branch: 'feat/activity', worktree: project('D:/projects/wraith') }),
    ])
  })

  it('keeps distinct project paths isolated when one activity snapshot spans multiple projects', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: project('D:/projects/alpha'), branch: 'main', changedFiles: 1, additions: 2, deletions: 0 },
      { projectPath: project('D:/projects/beta'), branch: 'release', changedFiles: 5, additions: 0, deletions: 9 },
    ])

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:alpha', 'D:/projects/alpha'),
      activity('session:beta', 'D:/projects/beta'),
    ), reader)

    expect(reader).toHaveBeenCalledWith([project('D:/projects/alpha'), project('D:/projects/beta')])
    expect(enriched.activities.map(item => item.git)).toEqual([
      { branch: 'main', worktree: project('D:/projects/alpha'), changedFiles: 1, additions: 2, deletions: 0 },
      { branch: 'release', worktree: project('D:/projects/beta'), changedFiles: 5, additions: 0, deletions: 9 },
    ])
  })

  it('leaves non-Git and projectless activities visible without inventing Git context', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: project('D:/notes'), branch: null, changedFiles: 0, additions: 0, deletions: 0 },
    ])

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:notes', 'D:/notes'),
      activity('task:projectless', ''),
    ), reader)

    expect(reader).toHaveBeenCalledWith([project('D:/notes')])
    expect(enriched.activities[0]).toMatchObject({ activityId: 'session:notes', status: 'running' })
    expect(enriched.activities[0]).not.toHaveProperty('git')
    expect(enriched.activities[1]).toMatchObject({ activityId: 'task:projectless', status: 'running' })
    expect(enriched.activities[1]).not.toHaveProperty('git')
  })

  it('isolates a Git read failure on its matching activity without changing its work status', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: project('D:/projects/healthy'), branch: 'main', changedFiles: 0, additions: 0, deletions: 0 },
      { projectPath: project('D:/projects/broken'), branch: null, changedFiles: 0, additions: 0, deletions: 0, error: 'git status timed out' },
    ])

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:healthy', 'D:/projects/healthy', { status: 'completed' }),
      activity('session:broken', 'D:/projects/broken', { status: 'waiting' }),
    ), reader)

    expect(enriched.activities[0]).toMatchObject({ status: 'completed', git: { branch: 'main' } })
    expect(enriched.activities[1]).toMatchObject({ status: 'waiting', git: { error: 'git status timed out' } })
    expect(enriched.activities[1]).not.toHaveProperty('error')
  })

  it('keeps every activity visible when the batch reader itself rejects', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockRejectedValue(new Error('git executable unavailable'))

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:one', 'D:/projects/one', { status: 'running' }),
      activity('session:two', 'D:/projects/two', { status: 'completed' }),
    ), reader)

    expect(enriched.activities).toMatchObject([
      { activityId: 'session:one', status: 'running', git: { error: 'git executable unavailable' } },
      { activityId: 'session:two', status: 'completed', git: { error: 'git executable unavailable' } },
    ])
  })
})
