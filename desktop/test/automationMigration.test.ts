import { describe, it, expect } from 'vitest'
import { mapLegacyTask, needsMigration, LegacyAutomationTask } from '../src/main/automationMigration'
import { AutomationTask } from '../src/shared/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1_750_000_000_000

const legacyInterval: LegacyAutomationTask = {
  id: 'task-001',
  name: 'Test task',
  prompt: 'Do something useful',
  projectPath: '/w',
  schedule: { kind: 'interval', everyMinutes: 60 },
  enabled: true,
  createdAt: NOW - 10_000,
  enabledAt: NOW - 5_000,
  lastFiredAt: NOW - 1_000,
}

// ---------------------------------------------------------------------------
// mapLegacyTask
// ---------------------------------------------------------------------------

describe('mapLegacyTask', () => {
  it('maps projectPath → workspace', () => {
    const result = mapLegacyTask(legacyInterval)
    expect(result.workspace).toBe('/w')
  })

  it('sets deliverTo = [{ platform: "desktop" }]', () => {
    const result = mapLegacyTask(legacyInterval)
    expect(result.deliverTo).toEqual([{ platform: 'desktop' }])
  })

  it('sets approval.default = "deny"', () => {
    const result = mapLegacyTask(legacyInterval)
    expect(result.approval).toEqual({ default: 'deny' })
  })

  it('preserves id, name, prompt', () => {
    const result = mapLegacyTask(legacyInterval)
    expect(result.id).toBe('task-001')
    expect(result.name).toBe('Test task')
    expect(result.prompt).toBe('Do something useful')
  })

  it('preserves schedule', () => {
    const result = mapLegacyTask(legacyInterval)
    expect(result.schedule).toEqual({ kind: 'interval', everyMinutes: 60 })
  })

  it('preserves enabled, createdAt, enabledAt', () => {
    const result = mapLegacyTask(legacyInterval)
    expect(result.enabled).toBe(true)
    expect(result.createdAt).toBe(NOW - 10_000)
    expect(result.enabledAt).toBe(NOW - 5_000)
  })

  it('does NOT carry lastFiredAt (daemon-owned state)', () => {
    const result = mapLegacyTask(legacyInterval)
    // lastFiredAt must be null — daemon state is not seeded via migration
    expect(result.lastFiredAt).toBeNull()
  })

  it('keeps projectPath on the output for type compatibility', () => {
    const result = mapLegacyTask(legacyInterval)
    expect(result.projectPath).toBe('/w')
  })
})

// ---------------------------------------------------------------------------
// needsMigration
// ---------------------------------------------------------------------------

const someDaemon: AutomationTask[] = [{
  id: 'daemon-1',
  name: 'Daemon task',
  prompt: 'x',
  projectPath: '/p',
  schedule: { kind: 'interval', everyMinutes: 10 },
  enabled: true,
  createdAt: NOW,
  enabledAt: NOW,
  lastFiredAt: null,
}]

describe('needsMigration', () => {
  it('returns true when !migrated && legacyTasks>0 && daemonTasks===0', () => {
    expect(needsMigration([], [legacyInterval], false)).toBe(true)
  })

  it('returns false when alreadyMigrated === true', () => {
    expect(needsMigration([], [legacyInterval], true)).toBe(false)
  })

  it('returns false when daemonTasks.length > 0', () => {
    expect(needsMigration(someDaemon, [legacyInterval], false)).toBe(false)
  })

  it('returns false when legacyTasks.length === 0', () => {
    expect(needsMigration([], [], false)).toBe(false)
  })
})
