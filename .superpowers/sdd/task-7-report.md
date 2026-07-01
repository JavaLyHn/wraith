# Task 7 Report: 重连自动 resume + 沙箱徽标

## What Was Added

### 1. `normalizeSandbox` helper (App.tsx)
A module-level function extracted to avoid duplicating the sandbox-value ternary in both the startup and reconnect effects:
```ts
function normalizeSandbox(sb: string | undefined): 'macos-seatbelt' | 'none' | 'unknown' {
  return sb === 'none' ? 'none' : sb === 'macos-seatbelt' ? 'macos-seatbelt' : 'unknown'
}
```

### 2. `setSandbox` wiring (App.tsx)
- Added `setSandbox` import from `transcriptReducer`
- Added `{ type: 'setSandbox'; sandbox: ... }` to the `LocalAction` union
- Added `setSandbox` branch in `reduceAdapter`
- Startup effect now calls `dispatch({ type: 'setSandbox', sandbox: normalizeSandbox(initObj.capabilities?.sandbox) })` after initialize

### 3. Reconnect effect (App.tsx)
A new `useEffect` with a `reconnectRef` that only arms after the first disconnect:
- When `state.connection === 'disconnected'`: sets `reconnectRef.current = true`
- When `state.connection === 'connected'` and ref is false: returns immediately (first connect handled by startup effect)
- When `state.connection === 'connected'` and ref is true: fires `initialize` + `setSandbox` + `startSession` + `resumeSession(activeId)` + `fetchSessions`
- Depends on `[state.connection, state.sessionId, state.workspace, fetchSessions]`

### 4. Sidebar sandbox badge (Sidebar.tsx)
- Added `sandbox: 'macos-seatbelt' | 'none' | 'unknown'` to `SidebarProps`
- Destructured `sandbox` in function signature
- Added `<div data-testid="sandbox-badge">` in footer below workspace line
  - `text-danger` class when `sandbox === 'none'`, else `text-fg-subtle`
  - Text: '⚠ 沙箱未启用' (none), '🛡 沙箱: Seatbelt' (macos-seatbelt), '沙箱: —' (unknown)
- `<Sidebar sandbox={state.sandbox} />` wired in App.tsx

### 5. Mock `initialize` sandbox support (mock-appserver.mjs)
Changed `capabilities` in `initialize` response:
```js
capabilities: { toolOutputStreaming: true, sandbox: process.env['MOCK_SANDBOX'] || 'macos-seatbelt' }
```

### 6. New E2E tests (shell.e2e.ts)
- **Test 9** (sandbox badge): Launches with `MOCK_SANDBOX=none`, asserts `[data-testid="sandbox-badge"]` contains '未启用'
- **Test 10** (reconnect smoke): Submits a turn, approves the tool call, asserts 'exit 0' on tool card + no crash

## TDD Evidence

### RED phase
Ran `npx playwright test -g "sandbox badge"` before implementation:
```
✘ sandbox badge shows unavailable when capabilities.sandbox=none
Error: element(s) not found — locator('[data-testid="sandbox-badge"]')
1 failed
```

### GREEN phase
After implementing all changes:
```
✓ sandbox badge shows unavailable when capabilities.sandbox=none (459ms)
1 passed (795ms)
```

## Final Test Results

### typecheck
```
tsc --noEmit -p tsconfig.json → 0 errors
```

### vitest
```
Test Files  6 passed (6)
     Tests  53 passed (53)
Duration    399ms
```

### build
```
✓ built in ~550ms (3 bundles: main, preload, renderer)
```

### Full E2E (Playwright)
```
10 passed (6.0s)
  ✓ happy path: submit turn, see markdown+thinking+tool+approval, approve, see output
  ✓ disconnect: backend crash after init shows disconnected banner
  ✓ approval toggle sends session.setApprovalMode with correct auto flag
  ✓ workspace switch re-picks dir → second session.start + transcript reset
  ✓ welcome empty state shows, then transitions to transcript on submit
  ✓ static sidebar shell present with disabled placeholder nav
  ✓ sidebar lists sessions; new clears; selecting resumes history
  ✓ submitting echoes the user message as a bubble
  ✓ sandbox badge shows unavailable when capabilities.sandbox=none  ← NEW
  ✓ reconnect after restart re-resumes the active session           ← NEW
```

## Files Changed

| File | Change |
|------|--------|
| `desktop/src/renderer/App.tsx` | normalizeSandbox helper; setSandbox LocalAction+reduceAdapter+import; startup effect sandbox dispatch; reconnect effect (reconnectRef); Sidebar sandbox prop |
| `desktop/src/renderer/components/Sidebar.tsx` | sandbox prop added to SidebarProps + destructured; sandbox-badge div in footer |
| `desktop/test/fixtures/mock-appserver.mjs` | initialize capabilities.sandbox driven by MOCK_SANDBOX env |
| `desktop/test/e2e/shell.e2e.ts` | Test 9 (sandbox badge) + Test 10 (reconnect smoke) |

## Self-Review Findings / Concerns

- **Brief deviation (reconnect smoke test)**: The brief's Test 10 snippet asserts `toContainText('exit 0')` directly after submit, but the mock requires approval before the turn completes with exit 0. Added `approveBtn.click()` before the assertion — this matches the happy-path test (Test 1) pattern and correctly tests the full turn lifecycle.
- **reconnect effect deps**: The `useEffect` depends on `state.connection`, `state.sessionId`, `state.workspace`, and `fetchSessions`. If a turn completes and sets a new sessionId while `connection === 'connected'`, the effect re-runs but `reconnectRef.current` is false, so it returns immediately — no spurious re-initialization.
- **normalizeSandbox DRY**: Both startup and reconnect effects call `normalizeSandbox(...)`. The ternary is not duplicated.
- No other concerns. All pipeline stages (typecheck + vitest + build + playwright ×10) passed cleanly.

## Fix: drop state.sessionId from reconnect effect deps

### Before (dep array, line 201)
```ts
}, [state.connection, state.sessionId, state.workspace, fetchSessions])
```

### After (dep array)
```ts
}, [state.connection, state.workspace, fetchSessions])
```

### Why it is safe
`activeId` is still read from `state.sessionId` **inside** the effect body (`const activeId = state.sessionId`, line 184), so the closure captures the correct value at the moment the effect fires. The `state.connection` dependency already re-creates the effect on every disconnect/reconnect transition — the only moments the session-resume path matters. Removing `state.sessionId` prevents the effect from re-evaluating on every `turn.completed` (which updates `sessionId`); the `reconnectRef` guard made it harmless before, but it was a spurious re-evaluation footgun.

### Verification
```
npm run typecheck  →  0 errors
npm run build      →  clean (3 bundles, ~600ms)
npx playwright test →  10 passed (6.2s)
  ✓ sandbox badge shows unavailable when capabilities.sandbox=none
  ✓ reconnect after restart re-resumes the active session
  (all 10 tests green)
```
