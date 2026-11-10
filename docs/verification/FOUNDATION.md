# Desktop foundation verification — 10 November 2026

This implementation builds on prototype commit `fe377e7`. Phase 01/02 work is in progress; the Windows platform gates are still open. The application still uses synthetic prototype storage, not the pharmacy schema.

## Implemented behavior

- Version 1 request envelopes and runtime-validated result schemas across renderer/preload/main/service boundaries.
- Explicit startup, ready, maintenance, recovery, and shutdown transitions. Setup-required and locked states are reserved and have tested command policies; owner access is not implemented yet.
- Bounded transport/service queues, correlated responses, transport timeout handling, and distinction between a read failure and an uncertain write outcome.
- Service failure events disable writes immediately. Restart is an explicit action, waits for the old process to exit, and preserves the renderer draft without replaying it automatically.
- Uncertain submissions keep their request ID and frozen payload. A file-backed test commits a save, loses the response, reopens SQLite, and confirms retry adds no duplicate record.
- Native confirmation before closing an unsaved draft. Graceful shutdown drains accepted work before the service exits, with bounded forced termination if it does not respond.
- Lifecycle subscriptions return an unsubscribe function. Monotonic revisions prevent an older lifecycle response from replacing a newer event. Focus refresh repairs missed events.
- Maintenance messages while snapshots/restored-copy checks run; other storage operations are blocked until ready.
- Rotating local diagnostics containing only allowlisted event names and timestamps. Export uses a native save dialog, requires a new `.json` filename, and never overwrites existing files or follows a pre-existing destination symlink.
- ESLint/Prettier, separate renderer/desktop type checks, and separate unit/integration/recovery test commands.

## Toolchain and test environment

Ubuntu 22.04.5 LTS, Linux x64; development Node 24.15.0 and pnpm 10.33.4. Electron 45.2.3 embeds Node 24.22.2 and SQLite 3.53.4 is supplied by better-sqlite3 13.0.3.

TypeScript was changed from 7.0.2 to **6.0.3** because the pinned typescript-eslint 8.72.2 supports TypeScript below 6.1. ESLint 10.14.0 and Prettier 3.9.10 are pinned. The source/configuration was formatted once when adding this tooling.

## Executed checks

| Command/check | Result |
| --- | --- |
| `pnpm check` | Lint, formatting, three TypeScript configurations, and all 20 tests passed |
| `pnpm package` | Linux x64 package built with the native SQLite module |
| `pnpm test:desktop` | All 9 packaged desktop journeys passed |
| `git diff --check` | Passed |
| Packaged screenshot | Overview layout inspected after adding diagnostic export |

The 20 unit/integration/recovery tests cover request constraints, paths/assets, SQLite persistence/transactions/snapshots, lifecycle policies, diagnostics rotation/filtering, out-of-order replies, bounded requests, timeout uncertainty, invalid responses/protocol versions, and replay after a committed save loses its response.

The nine packaged desktop journeys cover:

1. Save, snapshot, quit, reopen, and restore-copy verification.
2. Renderer isolation, declared API surface, invalid mutations, and blocked remote fetch.
3. Killing the actual SQLite utility process, blocking further writes, retaining the draft, and restarting without an automatic save.
4. Cancelling an unsaved close, then explicitly discarding and exiting.
5. Exporting diagnostics through a stubbed native save selection, excluding sample text/paths, and refusing to overwrite an existing report.
6. Rejecting requests from a separate hostile renderer. That test creates an extra permissive window only in the test harness; production code contains no such window or bypass.
7. Unsubscribing lifecycle callbacks and navigating all placeholder routes by keyboard.
8. Missing initialized database recovery without creating an empty replacement.
9. Single-instance reuse and normal service termination when the last window closes.

Tests used fresh temporary profiles in the host Linux desktop session with Chromium sandboxing enabled. Native close/save dialogs were stubbed for deterministic tests. Real Windows dialogs, DPAPI, installers, and Windows 10/11 compatibility remain unverified.

Tested application ASAR SHA-256:

```text
3c0510891c5ff64a1d8e6e736bff1d96bc9e071a407ab553f546a2a88d833562
```

Tested dependency lockfile SHA-256:

```text
ecea2b96cfc157def2b37e15c73451c35845b4fec150ea821941499a5c43d2c8
```

These identify the tested bundle and dependency resolution, not a signed Windows installer.

## Remaining work

- Phase 01: production identity/profile configuration, remaining source areas as they acquire real responsibilities, and packaged Windows verification.
- Phase 02: connect setup/locked states and session invalidation to real owner access; broaden forced-parent-loss and active-job termination checks; verify the lifecycle on Windows.
- Phase 03 onward: production SQLite schema and migrations, exact business values, owner setup/login/recovery, mutation receipts, encrypted backup/live restore, and all pharmacy workflows.

The checked task items in the implementation plan are supported by the Linux evidence above. They do not close a phase whose exit gate requires Windows testing. No real customer data, production login, or production backup capability is claimed.
