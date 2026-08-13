import { describe, expect, it, vi } from 'vitest'
import {
  enrichActivitySnapshot,
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

describe('activity Git enrichment', () => {
  it('adds branch and worktree context for every activity sharing a Git project with one batch lookup', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: 'D:/projects/wraith', branch: 'feat/activity', changedFiles: 3, additions: 12, deletions: 4 },
    ])

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:one', 'D:/projects/wraith'),
      activity('session:two', 'D:/projects/wraith'),
    ), reader)

    expect(reader).toHaveBeenCalledWith(['D:/projects/wraith'])
    expect(enriched.activities).toEqual([
      expect.objectContaining({ branch: 'feat/activity', worktree: 'D:/projects/wraith', git: {
        branch: 'feat/activity', worktree: 'D:/projects/wraith', changedFiles: 3, additions: 12, deletions: 4,
      } }),
      expect.objectContaining({ branch: 'feat/activity', worktree: 'D:/projects/wraith' }),
    ])
  })

  it('keeps distinct project paths isolated when one activity snapshot spans multiple projects', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: 'D:/projects/alpha', branch: 'main', changedFiles: 1, additions: 2, deletions: 0 },
      { projectPath: 'D:/projects/beta', branch: 'release', changedFiles: 5, additions: 0, deletions: 9 },
    ])

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:alpha', 'D:/projects/alpha'),
      activity('session:beta', 'D:/projects/beta'),
    ), reader)

    expect(reader).toHaveBeenCalledWith(['D:/projects/alpha', 'D:/projects/beta'])
    expect(enriched.activities.map(item => item.git)).toEqual([
      { branch: 'main', worktree: 'D:/projects/alpha', changedFiles: 1, additions: 2, deletions: 0 },
      { branch: 'release', worktree: 'D:/projects/beta', changedFiles: 5, additions: 0, deletions: 9 },
    ])
  })

  it('leaves non-Git and projectless activities visible without inventing Git context', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: 'D:/notes', branch: null, changedFiles: 0, additions: 0, deletions: 0 },
    ])

    const enriched = await enrichActivitySnapshot(snapshot(
      activity('session:notes', 'D:/notes'),
      activity('task:projectless', ''),
    ), reader)

    expect(reader).toHaveBeenCalledWith(['D:/notes'])
    expect(enriched.activities[0]).toMatchObject({ activityId: 'session:notes', status: 'running' })
    expect(enriched.activities[0]).not.toHaveProperty('git')
    expect(enriched.activities[1]).toMatchObject({ activityId: 'task:projectless', status: 'running' })
    expect(enriched.activities[1]).not.toHaveProperty('git')
  })

  it('isolates a Git read failure on its matching activity without changing its work status', async () => {
    const reader: ActivityGitBatchReader = vi.fn().mockResolvedValue([
      { projectPath: 'D:/projects/healthy', branch: 'main', changedFiles: 0, additions: 0, deletions: 0 },
      { projectPath: 'D:/projects/broken', branch: null, changedFiles: 0, additions: 0, deletions: 0, error: 'git status timed out' },
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
