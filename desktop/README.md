# wraith-desktop

Electron + React + TypeScript shell for the Wraith AI agent (P3b delivery).

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | `node -v` |
| Java 17+ | Used to run the backend jar |
| Built backend jar | `~/.wraith/wraith.jar` — produced by `wraith-install` from the Java side (`mvn package` + copy) |

> If the jar is absent and `WRAITH_APPSERVER_CMD` is not set, the backend
> child process will fail to spawn. The existing `error`/`exit` handlers on
> the child process emit a `{kind:'connection', state:'disconnected'}` event,
> which makes the UI show the disconnected banner. Run `wraith-install` first
> to place the jar, or use the `WRAITH_APPSERVER_CMD` override (see below).

## Install

```sh
npm install
```

## Development (real backend)

```sh
npm run dev
```

Launches Electron in dev mode. The main process spawns `java -jar ~/.wraith/wraith.jar app-server` and connects over JSON-RPC 2.0 / JSONL. Hot-reload is active for the renderer.

## Unit tests (vitest)

```sh
npm test
```

Runs all vitest unit tests (pure module tests — no Electron, no live backend):

- `backend.test.ts` — `resolveBackendCommand` + `defaultJarPath` helpers
- `jsonRpcClient.test.ts` — JSON-RPC 2.0 codec and pending-request lifecycle
- `transcriptReducer.test.ts` — UI state reducer for all event kinds
- `smoke.test.ts` — basic sanity

Expected: all 30 tests pass in < 1 s.

## E2E tests (Playwright)

```sh
npm run e2e
```

Builds the app (`electron-vite build`) then runs Playwright against a deterministic mock backend (`test/fixtures/mock-backend.mjs`). The mock is wired in via `WRAITH_APPSERVER_CMD`; native dialogs are bypassed via `WRAITH_E2E=1`.

Expected: 2 tests pass (connection banner + transcript flow).

## Environment overrides

| Variable | Effect |
|---|---|
| `WRAITH_APPSERVER_CMD` | Replace the default `java -jar ~/.wraith/wraith.jar app-server` with any command+args (space-separated). Useful for pointing at a local build or the mock. |
| `WRAITH_E2E=1` | Skip the native directory-picker dialog (`wraith:pickWorkspace` returns `null`). Set automatically by Playwright. |

## Build (production bundle)

```sh
npm run build
```

Outputs to `out/`. The resulting Electron app still requires Java 17+ and `~/.wraith/wraith.jar` at runtime.

## Type-check only

```sh
npm run typecheck
```

## Roadmap

- **P4** — Monaco per-hunk diff viewer, rich approval (edit params / allow network), status bar enrichment, `session.resume`, `sandbox.unavailable` event.
- **P5** — Packaging and distribution: electron-builder, jpackage (trimmed JRE), code signing.
