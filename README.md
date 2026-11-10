# Medi Pharm Desktop

A new offline desktop application for **Windows 10 and 11**, developed on Linux. All desktop code is written from scratch. The sibling web application is reference material for business rules only; its implementation, database, credentials, and deployment are not reused.

The user confirmed the existing business scope unchanged on 10 November 2026. A Windows 11 laptop is available for native testing. Windows x64 is the initial architecture assumption; Windows 10 verification remains required before release. macOS is outside the release scope.

## Current status

The app now has an **offline pharmacy workflow development preview**. Windows release verification and release-scale testing remain pending; it is not ready for pharmacy operations.

Implemented:

- Electron window, bundled React interface, validated IPC, and service-owned SQLite.
- Blue desktop shell, horizontal navigation, grouped shortcuts, live dashboard metrics and purchase-count chart, compact record tables, and responsive quick actions.
- Explicit empty-pharmacy setup, local owner login, lock/logout, password changes, and rotating offline recovery codes.
- Salted, versioned scrypt hashes; persistent failed-login throttling; eight-hour in-memory sessions checked by the service.
- Reviewed initial schema, migration checksum ledger, dataset identity, strict constraints and health checks.
- Pharmacy-name edits with optimistic versions, atomic audit/revision/receipt writes, and safe replay after a lost response.
- Service restart requiring login, draft preservation, unsaved-close confirmation, and redacted diagnostics.
- Exact quantity/date helpers and a shared transactional mutation/numbering foundation.
- Private staged setup and journaled dataset replacement with interrupted-operation recovery.
- Portable AES-256-GCM `.mpbackup` archives, passphrase-wrapped master keys, optional OS-protected local keys, and explicit in-memory fallback.
- Manual/daily backups while signed in, independent external-drive verification, 14 daily/8 weekly retention, and pinned restore safety copies.
- Verified restore previews, fresh-profile restore, damaged-installation recovery, and backup passphrase/key rotation.
- Customer and medicine create/edit/archive/restore, normalized search, pagination, and inline creation during purchase entry.
- Purchases with exact quantities, multiple units, dated medicine snapshots, independent supply durations, refill carry-over, previews, corrections and cancellation.
- Customer-grouped due/scheduled follow-ups, contact outcomes, next-contact dates, manual closure/reopening, and restoration of earlier cycle state after cancellation.
- Customer/medicine purchase history, purchase details, readable audit history, and populated-data backup/restore validation.
- Consolidated customer supply coverage, future supply starts, run-out estimates and current reminder state.
- Filtered/all-record CSV exports for customers, medicines, purchases/items, follow-up cycles and contact history through native save dialogs.
- Unit, integration, recovery, and packaged desktop tests using temporary synthetic profiles.

Version-to-version migration scripts, load verification and signed installers remain future work. Use test data only. The old prototype snapshot/key-store checks remain historical evidence and isolated storage tests; raw snapshots are no longer exposed by the app.

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

On Linux the packaged executable is `out/MediPharm Desktop Preview-linux-x64/medipharm-preview`. This is a development artifact, not a Linux customer release.

Preview data lives in `${XDG_DATA_HOME:-~/.local/share}/medi-pharm-desktop-preview/` on Linux or `%LOCALAPPDATA%/MediPharm Desktop Preview/` on Windows. These identities are deliberately separate from the future production app. Automated desktop tests set `MEDIPHARM_PREVIEW_HOME` to a fresh temporary directory. That override belongs to this preview and must not become a production authentication/reset bypass.

The live database is `data/live/medipharm.sqlite`, with installation identity in `settings/installation.json`. The new preview does not open or import old prototype data. Setup displays a login recovery code before creating the account; save it privately, then acknowledge it. Password/recovery changes require a new sign-in. No credentials are built in.

Open **Settings → Encrypted backups & restore** to configure a separate backup passphrase, create an archive, open its local folder, or register an external destination. A fresh installation and recovery mode also offer restore. See [the backup walkthrough](docs/BACKUP_USAGE.md).

A missing/corrupt database or mismatched migration ledger opens recovery mode. New setup builds privately and publishes through the same verified replacement journal as restore. Startup completes an interrupted prepared replacement or blocks ambiguous/damaged candidates while retaining the original files. Ordinary restore requires a verified current-data safety archive; explicit damaged-data recovery preserves the originals without falsely claiming they are a usable backup.

This preview caps archives at **64 MiB** and retains old live generations/safety archives for inspection. Windows filesystem/DPAPI verification, large-data streaming, and future-schema upgrade rehearsals remain release gates. Existing unsupported schemas are never upgraded automatically. Use synthetic data until the release checks and owner walkthrough are complete.

See [the desktop interface guide](docs/UI_DESIGN.md), [reports and CSV exports](docs/REPORTS_AND_EXPORTS.md) and [the business workflow walkthrough](docs/BUSINESS_WORKFLOWS.md) for customer, medicine, purchase and follow-up entry.

## Test on Windows

Follow [the Windows testing guide](docs/WINDOWS_TESTING.md). Build natively on Windows with `pnpm package` or `pnpm make:windows`; do not copy Linux `node_modules` or its packaged executable onto Windows.

The current installer configuration is set up to produce an **unsigned preview**. Windows execution, DPAPI behavior, installer behavior, and Windows 10 compatibility cannot be certified from Linux tests.

## Plans and evidence

| Document | Purpose |
| --- | --- |
| [UI verification](docs/verification/DESKTOP_UI.md) | Dashboard tests, native screenshots and remaining Windows layout checks |
| [Desktop interface](docs/UI_DESIGN.md) | Navigation, real-data dashboard definitions and responsive layout |
| [Reports/export verification](docs/verification/REPORTS_AND_EXPORTS.md) | Current supply coverage, CSV publication and packaged export evidence |
| [Business workflow verification](docs/verification/BUSINESS_WORKFLOWS.md) | Transaction, reconciliation, populated recovery and packaged workflow evidence |
| [Platform decisions](docs/PLATFORM_DECISIONS.md) | Confirmed scope, prototype identity, pinned toolchain, pending hardware decisions |
| [Backup and recovery verification](docs/verification/BACKUP_AND_RECOVERY.md) | Current archive, restore, interruption and packaged-test evidence |
| [Storage and account verification](docs/verification/STORAGE_AND_ACCOUNT.md) | Current owner access, schema, mutation and packaged-test evidence |
| [Foundation verification](docs/verification/FOUNDATION.md) | Latest implemented lifecycle/API work, checks, and remaining gates |
| [Phase 00 verification](docs/verification/PHASE_00.md) | Actual checks and remaining platform gates |
| [Overall plan](OVERALL_PLAN.md) | Requirements, scope, milestones, acceptance criteria |
| [Implementation plan](IMPLEMENTATION_PLAN.md) | Fourteen phases, task dependencies, and completion gates |
| [Architecture](ARCHITECTURE.md) | Production process and API design |
| [Database plan](DATABASE_PLAN.md) | Proposed pharmacy schema, transactions, migrations |
| [Backup and recovery](BACKUP_AND_RECOVERY.md) | Future encrypted archive and restore design |
| [Build and release](BUILD_AND_RELEASE.md) | Windows packaging, signing, offline updates |

The [web demo's business plan](../medi-pharm/IMPLEMENTATION_PLAN.md) remains a reference. Confirmed workflows are customers, medicines, purchases, per-medicine supply estimates, follow-ups, history, settings, and CSV export. A purchase means a sale from the pharmacy to a customer. Inventory, supplier purchasing, billing, accounting, automated messaging, cloud storage, and LAN functionality are outside this baseline.
