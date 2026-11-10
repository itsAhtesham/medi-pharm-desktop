# Medi Pharm Desktop

A new offline desktop application for **Windows 10 and 11**, developed on Linux. All desktop code is written from scratch. The sibling web application is reference material for business rules only; its implementation, database, credentials, and deployment are not reused.

The user confirmed the existing business scope unchanged on 10 November 2026. A Windows 11 laptop is available for native testing. Windows x64 is the initial architecture assumption; Windows 10 verification remains required before release. macOS is outside the release scope.

## Current status

Phase 00 awaits Windows verification. Implementation has started on the phase 01/02 desktop foundation, with tested lifecycle and recovery behavior. The application is a **synthetic platform prototype**, not a pharmacy-ready release.

Implemented:

- Electron window with a React interface and locally bundled assets.
- Versioned, validated preload API and a dedicated utility process owning SQLite.
- Sample-record persistence and duplicate-request protection.
- Raw SQLite snapshots and verification of a restored copy in a separate location.
- Native folder-picker and protected-key-store checks.
- Single-instance behavior, service shutdown, and missing-database protection.
- Service failure detection, explicit restart, draft preservation, and safe uncertain-save retries.
- Unsaved-close confirmation and local diagnostic export with bounded, allowlisted logs.
- Linting, formatting, separate renderer/desktop type checks, and unit/integration/recovery/desktop tests.

Business screens are visibly marked as planned. Owner authentication, the pharmacy schema, encrypted backups, live-data restore, reminders, exports, and signed installers remain future phases. Never enter real customer data into this prototype. Its raw snapshots are unencrypted and are not the future `.mpbackup` format.

## Develop on Linux

Use Node **24.15.0** (see `.nvmrc`) and pnpm **10.33.4**. With nvm installed:

```sh
nvm use
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

Installation downloads the pinned Electron runtime. Internet is needed on the development/build machine for dependency downloads; the packaged runtime uses local assets and storage.

```sh
pnpm test:unit
pnpm test:integration
pnpm test:recovery
pnpm package       # package for this operating system
pnpm test:desktop  # test that packaged artifact; needs a desktop session
```

On Linux the packaged executable is `out/MediPharm Prototype-linux-x64/medipharm-prototype`. This is a development artifact, not a Linux customer release.

Prototype data lives in `${XDG_DATA_HOME:-~/.local/share}/medi-pharm-desktop-prototype/` on Linux or `%LOCALAPPDATA%/MediPharm Prototype/` on Windows. These identities are deliberately separate from the future production app. Automated desktop tests set `MEDIPHARM_PROTOTYPE_HOME` to a fresh temporary directory. That override belongs to this prototype and must not become a production authentication/reset bypass.

## Test on Windows

Follow [the Windows testing guide](docs/WINDOWS_TESTING.md). Build natively on Windows with `pnpm package` or `pnpm make:windows`; do not copy Linux `node_modules` or its packaged executable onto Windows.

The current installer configuration is set up to produce an **unsigned prototype**. Windows execution, DPAPI behavior, installer behavior, and Windows 10 compatibility cannot be certified from Linux tests.

## Plans and evidence

| Document | Purpose |
| --- | --- |
| [Platform decisions](docs/PLATFORM_DECISIONS.md) | Confirmed scope, prototype identity, pinned toolchain, pending hardware decisions |
| [Foundation verification](docs/verification/FOUNDATION.md) | Latest implemented lifecycle/API work, checks, and remaining gates |
| [Phase 00 verification](docs/verification/PHASE_00.md) | Actual checks and remaining platform gates |
| [Overall plan](OVERALL_PLAN.md) | Requirements, scope, milestones, acceptance criteria |
| [Implementation plan](IMPLEMENTATION_PLAN.md) | Fourteen phases, task dependencies, and completion gates |
| [Architecture](ARCHITECTURE.md) | Production process and API design |
| [Database plan](DATABASE_PLAN.md) | Proposed pharmacy schema, transactions, migrations |
| [Backup and recovery](BACKUP_AND_RECOVERY.md) | Future encrypted archive and restore design |
| [Build and release](BUILD_AND_RELEASE.md) | Windows packaging, signing, offline updates |

The [web demo's business plan](../medi-pharm/IMPLEMENTATION_PLAN.md) remains a reference. Confirmed workflows are customers, medicines, purchases, per-medicine supply estimates, follow-ups, history, settings, and CSV export. A purchase means a sale from the pharmacy to a customer. Inventory, supplier purchasing, billing, accounting, automated messaging, cloud storage, and LAN functionality are outside this baseline.
