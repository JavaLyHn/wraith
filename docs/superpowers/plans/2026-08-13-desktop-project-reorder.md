# Desktop Project Pin and Manual Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the desktop project list reorder projects within the starred or unstarred group via drag-and-drop and menu actions, with persistent order.

**Architecture:** Persist an optional `order` number on each `ProjectEntry`; main settings owns normalization and group-local moves, while renderer pure helpers derive visible group order and menu boundaries. Add one narrow IPC method and wire it through preload, App, ProjectsPanel, ProjectRow, and ProjectRowMenu. Cross-group drag is ignored; starring remains the only group-changing action.

**Tech Stack:** Electron main/preload IPC, TypeScript, React, Vitest, existing `settings.ts` JSON persistence.

## Global Constraints

- Existing settings without `order` remain readable and receive deterministic order derived from their current `lastUsedAt` ordering.
- Starred and unstarred projects have independent order sequences; moving never changes `starred`, `name`, or `lastUsedAt`.
- Cross-group drag is rejected; search filters only and never persists a reorder.
- Every behavior change gets a RED test first, then GREEN implementation.
- Chinese comments and commit messages explain why; do not commit user settings, `.env`, or build artifacts.

---

### Task 1: Pure project ordering and move helpers

**Files:**
- Modify: `desktop/src/renderer/lib/projectsView.ts`
- Test: `desktop/test/projectsView.test.ts`

**Interfaces:**
- Produce `projectGroup(view): 'starred' | 'rest'`, `moveProjectInGroup(paths, projectPath, targetIndex): string[]`, and `projectMoveBounds(rows, path): { index: number; count: number; group: 'starred' | 'rest' } | null`.

- [ ] Write failing tests for stable group partition order, moving up/down within a group, boundary no-op, and cross-group rejection.
- [ ] Run `cd desktop && npx.cmd vitest run test/projectsView.test.ts`; confirm the new imports/functions fail.
- [ ] Implement pure helpers without mutating input arrays; use path identity and `starred === true`.
- [ ] Re-run the focused test and commit `feat(desktop): add project reorder helpers`.

### Task 2: Persist order and expose reorder IPC

**Files:**
- Modify: `desktop/src/main/settings.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/shared/types.ts`
- Test: `desktop/test/settings.test.ts`, `desktop/test/projectStarred.test.ts`

**Interfaces:**
- Add `order?: number` to `ProjectEntry` and `ProjectView`.
- Add `reorderProject(userDataDir, projectPath, targetIndex): void` in settings; target index is within the project’s current starred group.
- Expose `window.wraith.reorderProject(path, targetIndex): Promise<void>` through preload and register `wraith:reorderProject`.

- [ ] Add RED settings tests: old entries get deterministic views, move persists only group order, invalid path/index is a no-op, starring appends to the new group without losing unrelated order.
- [ ] Run focused settings tests and verify failure.
- [ ] Implement normalization, group-local renumbering, and IPC delegation; preserve existing best-effort settings write behavior.
- [ ] Run settings/project-starred tests plus `npx.cmd tsc --noEmit`; commit `feat(desktop): persist project reorder through IPC`.

### Task 3: Project row drag-and-drop and menu actions

**Files:**
- Modify: `desktop/src/renderer/components/ProjectRow.tsx`
- Modify: `desktop/src/renderer/components/ProjectRowMenu.tsx`
- Test: `desktop/test/projectRow.test.tsx`, `desktop/test/projectRowMenu.test.tsx`

**Interfaces:**
- `ProjectRow` accepts `canMoveUp`, `canMoveDown`, `onMove(path, targetIndex)`, and emits drag callbacks using same-group metadata.
- `ProjectRowMenu` accepts `canMoveUp`, `canMoveDown`, and `onMove`; menu buttons call target index `index - 1` / `index + 1`.

- [ ] Add RED component tests for menu labels/disabled boundaries, up/down callbacks, same-group drag callback, and cross-group drag no-op.
- [ ] Run the focused component tests and verify failure.
- [ ] Implement accessible drag attributes and buttons; keep star, new-session, archive, rename, and remove behavior unchanged.
- [ ] Run focused component tests and commit `feat(desktop): add project move controls`.

### Task 4: Panel/App integration and full verification

**Files:**
- Modify: `desktop/src/renderer/components/ProjectsPanel.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `docs/windows-usage.md` or `docs/development.md` (desktop project controls section)
- Test: `desktop/test/projectsPanel.test.tsx`, relevant App/top-bar integration tests

**Interfaces:**
- ProjectsPanel calculates group-local bounds from filtered rows but sends the persisted target index based on the full group order; search never changes stored order.
- App calls `window.wraith.reorderProject`, then refreshes projects; on error it refreshes instead of optimistic persistence.

- [ ] Add RED panel/App tests for filtered reorder index mapping, IPC invocation, refresh on success, and refresh-on-error.
- [ ] Run focused tests and verify failure.
- [ ] Implement panel wiring, drag state, and App callback; update user-facing desktop docs with the new controls.
- [ ] Run `cd desktop && npx.cmd vitest run` and `npx.cmd tsc --noEmit`.
- [ ] Review diff, run `git diff --check`, and commit `feat(desktop): support persistent project ordering`.
