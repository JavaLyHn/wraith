import { describe, expect, it } from 'vitest'
import type { ActivityItem } from '../src/shared/types'
import {
  activityBadgeCount,
  activityGroups,
  activityStatusLabel,
  activityTargetLabel,
} from '../src/renderer/lib/activityView'

const activity = (overrides: Partial<ActivityItem>): ActivityItem => ({
  activityId: 'activity',
  kind: 'session',
  status: 'completed',
  projectPath: 'D:/projects/example',
  startedAt: 1,
  updatedAt: 1,
  ...overrides,
})

describe('activityGroups', () => {
  it('groups every source by status priority and sorts each group by newest update without changing input order', () => {
    const items = [
      activity({ activityId: 'old-task', kind: 'task', status: 'running', updatedAt: 10 }),
      activity({ activityId: 'automation-wait', kind: 'automation', status: 'waiting', updatedAt: 20 }),
      activity({ activityId: 'new-session', kind: 'session', status: 'running', updatedAt: 30 }),
      activity({ activityId: 'finished', kind: 'automation', status: 'completed', updatedAt: 40 }),
    ]

    expect(activityGroups(items)).toEqual({
      running: [items[2], items[0]],
      waiting: [items[1]],
      recent: [items[3]],
    })
    expect(items.map(item => item.activityId)).toEqual(['old-task', 'automation-wait', 'new-session', 'finished'])
  })

  it('keeps at most the ten newest non-active results', () => {
    const items = Array.from({ length: 12 }, (_, index) => activity({
      activityId: `completed-${index}`,
      status: 'completed',
      updatedAt: index,
    }))

    expect(activityGroups(items).recent.map(item => item.activityId)).toEqual([
      'completed-11', 'completed-10', 'completed-9', 'completed-8', 'completed-7',
      'completed-6', 'completed-5', 'completed-4', 'completed-3', 'completed-2',
    ])
  })
})

describe('activityBadgeCount', () => {
  it('counts only running and waiting activities', () => {
    expect(activityBadgeCount([
      activity({ status: 'running' }),
      activity({ status: 'waiting' }),
      activity({ status: 'failed' }),
      activity({ status: 'unknown' }),
    ])).toBe(2)
  })
})

describe('activity labels', () => {
  it('maps every known status to a readable label', () => {
    expect(activityStatusLabel('running')).toBe('运行中')
    expect(activityStatusLabel('waiting')).toBe('等待中')
    expect(activityStatusLabel('completed')).toBe('已完成')
    expect(activityStatusLabel('failed')).toBe('失败')
    expect(activityStatusLabel('canceled')).toBe('已取消')
    expect(activityStatusLabel('interrupted')).toBe('已中断')
    expect(activityStatusLabel('unknown')).toBe('未知')
  })

  it('uses readable fallbacks when project, title, and error are absent', () => {
    expect(activityTargetLabel(activity({
      projectPath: '',
      title: undefined,
      error: undefined,
    }))).toBe('未命名活动')
    expect(activityTargetLabel(activity({
      projectPath: 'D:/projects/wraith',
      title: undefined,
    }))).toBe('wraith')
    expect(activityTargetLabel(activity({
      projectPath: '',
      title: undefined,
      error: '连接已断开',
    }))).toBe('连接已断开')
  })
})
