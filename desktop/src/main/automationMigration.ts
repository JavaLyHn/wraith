/**
 * automationMigration.ts — pure mapping functions for legacy → daemon-format automations.
 * No I/O; I/O (RPC upsert to app-server) lives in Task 18.
 */

import { AutomationTask, AutomationSchedule } from '../shared/types'

// ---------------------------------------------------------------------------
// Legacy shape (pre-daemon, Electron-only scheduler)
// ---------------------------------------------------------------------------

/**
 * The pre-migration AutomationTask shape stored by the old Electron scheduler.
 * It has `projectPath` but no `workspace`, `deliverTo`, or `approval`.
 * Schedule was only interval/daily/weekly (no cron).
 */
export interface LegacyAutomationTask {
  id: string
  name: string
  prompt: string
  projectPath: string
  schedule: AutomationSchedule
  enabled: boolean
  createdAt: number
  enabledAt: number
  lastFiredAt?: number | null
}

// ---------------------------------------------------------------------------
// mapLegacyTask
// ---------------------------------------------------------------------------

/**
 * Map a legacy Electron-scheduler task to the daemon-compatible AutomationTask format.
 *
 * Key decisions:
 * - `workspace` is set from `legacy.projectPath` (daemon reads `workspace`; `projectPath` is
 *   kept on the output too because the current AutomationTask type still requires it).
 * - `deliverTo` defaults to `[{ platform: 'desktop' }]` to preserve the existing
 *   desktop-notification behavior after migration.
 * - `approval` defaults to `{ default: 'deny' }` as a safe deny-all baseline.
 * - `lastFiredAt` is intentionally NOT carried into the mapped task.
 *   `automation-state.json` (where lastFiredAt lives) is daemon-owned, single-writer;
 *   the desktop/app-server cannot write it. Migration seeds task definitions only.
 *   A migrated interval task simply re-anchors from `enabledAt` on its first fire —
 *   this is a one-time, acceptable skip.
 */
export function mapLegacyTask(legacy: LegacyAutomationTask): AutomationTask {
  return {
    id: legacy.id,
    name: legacy.name,
    prompt: legacy.prompt,
    projectPath: legacy.projectPath,   // kept for type compatibility (transition period)
    workspace: legacy.projectPath,     // daemon reads workspace
    schedule: legacy.schedule,
    enabled: legacy.enabled,
    createdAt: legacy.createdAt,
    enabledAt: legacy.enabledAt,
    lastFiredAt: null,                 // NOT migrated — daemon-owned state; see comment above
    deliverTo: [{ platform: 'desktop' }],
    approval: { default: 'deny' },
  }
}

// ---------------------------------------------------------------------------
// needsMigration
// ---------------------------------------------------------------------------

/**
 * Return true iff a one-time legacy-→-daemon migration should run.
 *
 * Conditions (all must hold):
 * 1. `alreadyMigrated === false` — migration flag not yet set.
 * 2. `legacyTasks.length > 0`   — there is something to migrate.
 * 3. `daemonTasks.length === 0`  — daemon store is empty (avoid overwriting if partially populated).
 */
export function needsMigration(
  daemonTasks: AutomationTask[],
  legacyTasks: LegacyAutomationTask[],
  alreadyMigrated: boolean,
): boolean {
  return !alreadyMigrated && legacyTasks.length > 0 && daemonTasks.length === 0
}
