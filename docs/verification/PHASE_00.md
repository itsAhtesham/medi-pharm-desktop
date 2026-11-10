# Phase 00 verification — 10 November 2026

**Status: in progress. Linux prototype checks pass; Windows gates remain open.**

This evidence covers the synthetic prototype only. It does not certify pharmacy workflows, production migrations, encrypted backup, live-data restore, authentication, or a Windows installer. All code was written in this repository from scratch.

## Environment and artifact identity

- Ubuntu 22.04.5 LTS, Linux x64, kernel 6.8.0-138-generic.
- Development Node.js 24.15.0; pnpm 10.33.4.
- Electron 45.2.3, embedded Node.js 24.22.2, Chromium 156.0.8078.80.
- better-sqlite3 13.0.3, embedded SQLite 3.53.4.
- Source is an uncommitted working tree; the repository has no first commit yet. No source revision is claimed.
- Tested package: `out/MediPharm Prototype-linux-x64/`.

SHA-256 identifiers for the tested artifacts:

```text
resources/app.asar
db3734ab13961f0cb1dc1a49c57e4047ca63af9eda993722c959b7142a9ec49f

medipharm-prototype executable
63c681d208685f80f19cda46764d9f123a788fd8dccdb8ab7970dd7a2935b82f

pnpm-lock.yaml
f09d72d99d3d8d63db99f84e9c34edbe4858fc93687dcf578812664bc6f90039
```

The executable hash identifies the Electron host; the ASAR hash identifies the application bundle. Native binaries are also present in `resources/app.asar.unpacked`; a final release will need a checksum for the complete distributed artifact.

## Executed checks

Commands used Node 24.15.0 on PATH:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | 12 tests passed across contracts, platform paths/assets, and real SQLite files |
| `pnpm package` | Linux x64 package built, including native SQLite and the utility-process entry |
| `pnpm test:desktop` | All 4 packaged desktop journeys passed |
| Package content inspection | Compiled UI/main/preload/service and runtime dependencies present; no project source, tests, docs, `.env`, database, or backup files included |
| UI inspection | Packaged overview screenshot inspected for layout and honest prototype status |

Unit/integration checks cover exact command validation, oversized/extra input, prototype path isolation, asset traversal rejection, persistent saves, idempotent retries, changed-payload rejection, invalid SQL writes, snapshot generation, separate-copy restoration, corrupt snapshots, missing initialized databases, and newer schema rejection.

Packaged desktop journeys verify:

1. Local `medipharm://app/` assets load without a development server. Save a synthetic note, create a snapshot, quit, reopen, read the note, and verify a restored copy.
2. Renderer Node access is absent, only the six declared bridge methods are exposed, malformed mutations are rejected, and a remote fetch is blocked. Planned business routes display their unfinished state.
3. Removing the closed prototype database after initialization produces a recovery message and disabled saves instead of silently creating an empty replacement.
4. A second executable launch exits successfully and leaves one window. Closing the last window terminates the identified database service process.

Desktop tests explicitly set `chromiumSandbox: true`; the test harness uses inspector/debugging ports for automation. Production source does not disable Chromium sandboxing or open those ports. The restricted execution environment prevented GUI startup, so desktop tests ran in the host desktop session with fresh temporary prototype roots. Native Windows behavior is still unverified.

The interface uses only bundled assets. The test checks remote-request blocking; the machine's network was not physically disconnected, and a complete runtime traffic audit remains a later release check.

## Issues resolved during the prototype

- Forge 8 emits `.cjs` entry points, which are now used for main, preload, and service.
- The default Vite packaging filter excluded runtime dependencies. The package now explicitly retains pruned runtime `node_modules`, with native files unpacked from ASAR.
- The local asset handler now reads only allowed packaged files directly instead of routing internal file reads through the renderer's network restrictions.
- Closed snapshots are switched to DELETE journal mode so verification creates a standalone snapshot without leftover WAL/SHM sidecars.
- Packaging validates the cached Electron archive with the checksum manifest bundled in the pinned Electron package, avoiding a needless remote checksum request on each build.

## Task accounting and remaining gates

- **P00-04 complete:** renderer, restricted preload, main broker, utility service, and native SQLite persistence demonstrated on Linux.
- **P00-07 complete:** defaults and open decisions are recorded in the plans and platform decision record.
- **P00-01 / P00-02 partial:** Windows 10/11 scope and a separate prototype identity are recorded. Hardware inventory, production identity, and signing ownership remain open.
- **P00-03 partial:** the prototype toolchain is pinned and exercised. Drizzle business mappings and the full production tooling are not installed yet.
- **P00-05 / P00-06 pending on Windows:** native package/install, DPAPI, real folder dialogs, and offline smoke checks must run on the laptop and a Windows 10 environment.
- **Phase 01 early work only:** a navigable shell exists, but this is not the complete production foundation.

Follow [Windows testing](../WINDOWS_TESTING.md) for the native handoff. Do not mark phase 00 complete based on Linux results alone. Protected-key-store and real-dialog round trips are exposed in the prototype but have not been recorded as passing on either Windows target.
