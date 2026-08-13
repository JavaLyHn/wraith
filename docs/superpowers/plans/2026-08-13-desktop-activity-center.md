# Desktop Activity Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-project desktop activity center that shows running, waiting, and recent session/task/automation work and routes users back to the correct conversation or control.

**Architecture:** Keep a small activity registry in Electron main, fed by the existing app-server notifications and task/automation APIs. Expose one typed snapshot/event/cancel bridge to the renderer; keep grouping, sorting, labels, and stale-state presentation as pure renderer helpers. `ActivityPanel` consumes the unified model while existing project, session, task, automation, and Git read-only behavior remains unchanged.

**Tech Stack:** Electron main/preload IPC, TypeScript, React, Vitest, existing JSON-RPC app-server, existing Tailwind-style utility classes.

## Global Constraints

- The first release is local-only: no cloud sync, remote control, or cross-device resume.
- Do not create, delete, clean, commit, push, or switch Git worktrees/branches.
- Do not treat every historical session as active; only registry-tracked work or explicitly known persisted task/automation states enter active/recent groups.
- On restart or uncertain source state, use `interrupted`/`unknown` and `stale`, never `running` by assumption.
- On read failure, retain the last successful snapshot and show that data may be stale; first-load failure must show an actionable error.
- Every behavior change requires a RED test: break/omit the implementation, run the exact focused test, confirm the expected assertion fails, then restore with the minimal GREEN implementation.
- Chinese comments and commit messages explain why; never commit `.env`, keys, settings, `target/`, `node_modules/`, `desktop/dist/`, or release artifacts.
- Before handoff run `cd desktop && npx.cmd vitest run`, `cd desktop && npx.cmd tsc --noEmit`, and `mvn -DskipTests=false test`.

---

### Task 1: Define the unified activity model and pure view helpers

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Create: `desktop/src/renderer/lib/activityView.ts`
- Test: `desktop/test/activityView.test.ts`

**Interfaces:**
- Add `ActivityKind = 'session' | 'task' | 'automation'`.
- Add `ActivityStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'canceled' | 'interrupted' | 'unknown'`.
- Add `ActivityItem` with `activityId`, `kind`, `status`, `projectPath`, optional `sessionId`, `taskId`, `runId`, `title`, `summary`, `branch`, `worktree`, `startedAt`, `updatedAt`, `error`, and `stale`.
- Add `ActivitySnapshot = { activities: ActivityItem[]; stale: boolean; error?: string }`.
- Export `activityGroups(items): { running: ActivityItem[]; waiting: ActivityItem[]; recent: ActivityItem[] }`, `activityBadgeCount(items): number`, `activityStatusLabel(status): string`, and `activityTargetLabel(item): string`.

- [ ] Write RED tests for source-independent grouping, status priority, recent-result limit of 10, updated-time descending order, badge counting only `running`/`waiting`, and readable labels when project/title/error fields are absent.
- [ ] Run `cd desktop && npx.cmd vitest run test/activityView.test.ts`; confirm the imports or assertions fail because the model/helpers do not exist.
- [ ] Implement the types and pure helpers without mutating input arrays. Put the recent limit in the helper, not in the component, so the limit is tested once and shared by every consumer.
- [ ] Re-run the focused test and confirm all new assertions pass.
- [ ] Commit with `feat(desktop): define activity view model`.

### Task 2: Implement the main-process activity registry

**Files:**
- Create: `desktop/src/main/activityStore.ts`
- Modify: `desktop/src/main/index.ts`
- Test: `desktop/test/activityStore.test.ts`

**Interfaces:**
- Export `ActivityStore` with `registerSession(input)`, `updateSession(id, patch)`, `registerTask(task)`, `registerAutomation(run)`, `mergeSnapshot(sourceItems)`, `snapshot(limit): ActivitySnapshot`, and `markStale(reason): ActivitySnapshot`.
- Use stable IDs: `session:<sessionId>`, `task:<taskId>`, and `automation:<runId>`.
- Main owns source-to-activity status mapping. Session activity starts on `turn.submit`, becomes `waiting` for approval/choice notifications, and becomes terminal on turn completion, error, interrupt, or backend disconnect. Task and automation statuses map from their existing wire values.
- Main sends a renderer notification `activity.changed` with `{ activities, stale, error? }` after a registry mutation; the initial query is handled by a request rather than by notification replay.

- [ ] Write RED tests for stable IDs, session running→waiting→completed transitions, disconnect mapping to `interrupted`/`unknown`, task/automation mapping, replacement without duplicate rows, and stale snapshots retaining the last successful items.
- [ ] Run `cd desktop && npx.cmd vitest run test/activityStore.test.ts`; confirm the registry API and transition assertions fail.
- [ ] Implement the store as an in-memory process-local registry. Keep terminal entries for the recent window and do not invent activity for arbitrary historical sessions. Wire existing `submitTurn`, interrupt/disconnect, approval/choice notification, task polling result, and automation event paths to update it.
- [ ] Re-run the focused store tests and verify event updates are emitted only for the changed snapshot.
- [ ] Commit with `feat(desktop): track desktop activity state`.

### Task 3: Add typed activity IPC and preload bridge

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`
- Test: `desktop/test/activityIpc.test.ts` or the repository's existing main/preload IPC test file

**Interfaces:**
- Add `activityList(limit?: number): Promise<ActivitySnapshot>` to `WraithApi` and expose `wraith:activityList`.
- Add `activityCancel(item: { kind: ActivityKind; id: string }): Promise<{ ok: boolean; message?: string }>` and expose `wraith:activityCancel`.
- Add `onActivityEvent(cb: (snapshot: ActivitySnapshot) => void): () => void`, backed by `wraith:activity-event`.
- `activityCancel` delegates only to existing operations: session→`turn.interrupt`, task→`task.cancel`, automation→`automations.stop`; unknown/terminal kinds return `{ ok: false, message }` without changing state.

- [ ] Write RED tests for handler registration, typed list response, correct cancel delegation for all three kinds, rejection of terminal/unknown items, and event unsubscribe behavior.
- [ ] Run the focused IPC tests and confirm the new channels/handlers are absent or fail the expected assertions.
- [ ] Implement narrow validation at the IPC boundary; renderer must not receive a raw JSON-RPC client or arbitrary method name.
- [ ] Re-run focused IPC tests and `cd desktop && npx.cmd tsc --noEmit`.
- [ ] Commit with `feat(desktop): expose activity IPC`.

### Task 4: Build the ActivityPanel and activity presentation helpers

**Files:**
- Create: `desktop/src/renderer/components/ActivityPanel.tsx`
- Create: `desktop/src/renderer/lib/activityPanelView.ts` only if a second pure helper is needed for card actions
- Test: `desktop/test/activityPanel.test.tsx`

**Interfaces:**
- `ActivityPanel` props: `onBack`, `onOpenSession(item)`, `onOpenTask(item)`, `onOpenAutomation(item)`, and optional `onRefresh`/`onCancel` callbacks supplied by `App`.
- The component consumes `ActivitySnapshot`, renders the three groups in the order from `activityGroups`, and never derives status from visual text.
- Running and waiting cards show action buttons; terminal cards show view-only actions. Failed cancellation keeps the card status and renders the returned message.

- [ ] Write RED component tests for group headings, empty state, stale banner, first-load error/retry, running/waiting action visibility, terminal action hiding, and callback payload identity.
- [ ] Run `cd desktop && npx.cmd vitest run test/activityPanel.test.tsx`; confirm the component is missing or assertions fail.
- [ ] Implement the smallest accessible panel: keyboard-focusable cards/buttons, stable `data-testid` values, status text plus icon/color, project path fallback, and an explicit “数据可能已过期” label when `stale` is true.
- [ ] Re-run the focused component tests and confirm no action is shown for terminal activities.
- [ ] Commit with `feat(desktop): add activity center panel`.

### Task 5: Integrate navigation, live updates, and existing activity sources

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/components/Sidebar.tsx`
- Modify: `desktop/src/renderer/components/TaskPanel.tsx` only if a shared refresh callback is required
- Test: `desktop/test/activityNavigation.test.tsx`, relevant `topBarComponent.test.tsx`/`app.test.tsx`

**Interfaces:**
- Extend the App view union with `'activity'`; add `activitySnapshot` state and a single `loadActivities(silent)` callback that preserves the last snapshot on failure.
- Pass `activityCount={activityBadgeCount(snapshot.activities)}` and `onOpenActivity={() => setView('activity')}` to `Sidebar`.
- Selecting a session activity switches project when needed and calls the existing `handleSelectSession`; selecting a task opens the existing task panel; selecting an automation opens the existing automation panel/session path.
- Subscribe once to `window.wraith.onActivityEvent`; refresh after task/automation events and after session turn completion/failure, without adding a fixed high-frequency poll.

- [ ] Write RED integration tests for sidebar entry/badge count, activity view selection, cross-project session navigation, task/automation routing, event-driven refresh, and stale preservation on load failure.
- [ ] Run the focused integration tests and confirm the new view/props/callbacks fail.
- [ ] Implement App state and callbacks, add the sidebar “活动” item in the existing navigation grouping, and render `<ActivityPanel>` before the existing tool views.
- [ ] Re-run focused integration tests and `cd desktop && npx.cmd tsc --noEmit`.
- [ ] Commit with `feat(desktop): integrate activity navigation`.

### Task 6: Add project/Git enrichment without changing Git behavior

**Files:**
- Modify: `desktop/src/main/activityStore.ts`
- Modify: `desktop/src/main/index.ts` only if a batch read is needed
- Modify: `desktop/src/shared/types.ts` if Git summary fields need a named wire type
- Test: `desktop/test/activityGitEnrichment.test.ts`

**Interfaces:**
- Keep `branch` and `worktree` optional. If the current project-scoped `git.status` can serve an activity, populate it; otherwise add one read-only batch query returning `{ projectPath, branch, changedFiles, additions, deletions, error? }[]`.
- A Git query failure must leave the activity visible and set only its Git enrichment error; it must not convert the activity status to `failed`.

- [ ] Write RED tests for branch/worktree display, multiple project paths, missing/non-Git projects, and Git failure isolation.
- [ ] Run the focused enrichment tests and confirm the batch query/helper is absent or assertions fail.
- [ ] Implement deduplicated, on-demand enrichment when the activity snapshot is requested; do not poll Git continuously and do not add any write operation.
- [ ] Re-run focused enrichment tests and the desktop TypeScript check.
- [ ] Commit with `feat(desktop): enrich activities with git context`.

### Task 7: Documentation, regression verification, and handoff

**Files:**
- Modify: `docs/windows-usage.md` or `docs/development.md` (desktop activity center section)
- Test: existing full desktop and Maven suites

- [ ] Add concise user documentation: where to find 活动, meaning of running/waiting/recent groups, what stop/cancel does, and why stale data may appear after disconnect/restart.
- [ ] Run `cd desktop && npx.cmd vitest run`; expected: all existing tests plus activity tests pass.
- [ ] Run `cd desktop && npx.cmd tsc --noEmit`; expected: zero TypeScript errors.
- [ ] Run `mvn -DskipTests=false test`; expected: no regression from the desktop-only feature (record any pre-existing failures separately rather than hiding them).
- [ ] Run `git diff --check` and inspect the final diff for raw IPC leakage, unbounded polling, write-capable Git calls, and accidental build artifacts.
- [ ] Commit with `docs(desktop): document activity center` and report the verification results.
