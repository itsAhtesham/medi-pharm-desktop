# Medi Pharm Desktop phase wise implementation plan

Build the desktop application in small, verifiable phases, starting with a working packaged SQLite prototype and ending with tested Windows 10 and 11 installers. Daily development takes place on Linux. The application stores data locally, starts its services when opened, and stops them when closed.

Status updated 10 November 2026: phase 00 is in progress, with a synthetic prototype and early shell work. Windows gates remain open. Later business phases are not started. See [phase 00 evidence](docs/verification/PHASE_00.md). Original planning date: 8 November 2026.

## Scope and document ownership

Use the [overall plan](OVERALL_PLAN.md) for requirements, [architecture](ARCHITECTURE.md) for process boundaries, [database plan](DATABASE_PLAN.md) for persistence rules, [backup plan](BACKUP_AND_RECOVERY.md) for recovery behavior, and [build plan](BUILD_AND_RELEASE.md) for platform delivery. This document owns task order, dependencies, implementation slices, and evidence required to complete each phase.

The user confirmed the customer, medicine, purchase, supply, follow-up, history, settings, and export baseline unchanged on 10 November 2026. Implement every desktop layer from scratch; consult the web project only for business requirements. Infrastructure uses the documented desktop stack. Additional features from the reference image remain a separate discussion.

The first release serves one pharmacy, one local owner, and one computer. No LAN server, client synchronization, cloud storage, boot-time service, automatic login startup, or always-running tray process is included. Keep the transport boundary reusable for a future LAN service without implementing that service now.

## Phase map and dependencies

| Phase | Deliverable | Depends on | Overall milestone | Status |
| --- | --- | --- | --- | --- |
| 00 | Platform decisions and packaged native prototype | None | 0 Platform prototype | In progress; Windows verification pending |
| 01 | Project foundation and local interface shell | 00 toolchain proof | 1 Desktop foundation | Early prototype shell; full phase pending |
| 02 | Application lifecycle and restricted IPC | 01 | 1 Desktop foundation | Not started |
| 03 | SQLite schema and storage infrastructure | 02 | 2 Storage and account | Not started |
| 04 | Owner access and reliable mutation infrastructure | 03 | 2 Storage and account | Not started |
| 05 | Encrypted local and external backup creation | 04 | 3 Backup and recovery | Not started |
| 06 | Restore and migration recovery | 05 | 3 Backup and recovery | Not started |
| 07 | Customer and medicine catalog workflows | 04, 06 | 4 Baseline workflows | Not started |
| 08 | Medicine supply domain and purchase services | 07 | 4 Baseline workflows | Not started |
| 09 | Purchase entry and correction interface | 08 | 4 Baseline workflows | Not started |
| 10 | Follow-ups, histories, settings, and export | 09 | 4 Baseline workflows | Not started |
| 11 | Signed installers and offline upgrade flow | 06, 10, signing access | 5 Packaging and updates | Not started |
| 12 | Reliability, performance, and release verification | 11 | 6 Reliability and owner walkthrough | Not started |
| 13 | Owner pilot, recovery rehearsal, and handover | 12 | 6 Reliability and owner walkthrough | Not started |

This is the default sequence, not a requirement to stop at the end of every phase. Continue authorized implementation when the evidence supports the next step. If target hardware or signing access is unavailable, identify the blocked checks and continue independent Linux work; do not record the corresponding platform gate as passed.

Native packaging starts in phase 00 and is checked throughout. Phase 11 completes distribution rather than discovering packaging for the first time. Database upgrades on an existing owner installation remain disabled until phase 06 supplies verified pre-migration backup and recovery.

## Execution and completion rules

- Give work items their listed IDs, such as `P03-04`, in implementation notes or issue tracking.
- Keep task checkboxes unchecked until their code and required verification exist.
- End each phase with a runnable demonstration and a verification note listing source revision, environment, commands, results, and unresolved issues.
- Use proposed notes such as `docs/verification/PHASE_03.md`; those files are future deliverables, not currently present evidence.
- Test changes as they are implemented. Phase 12 adds system-level evidence and targeted regression, rather than postponing all testing until the end.
- Use synthetic fixtures and isolated development/test directories. Never use the client's database as a test target.
- Define product changes explicitly. Updating this implementation plan does not silently expand the agreed feature baseline.

## Phase 00 Platform decisions and packaged native prototype

**Outcome:** prove that the chosen stack can run, persist data, and use native capabilities on the intended release platforms before building the application around it.

**Inputs:** current architecture documents, access to the Linux development environment, and an arrangement for Windows 10/11 builds and execution.

### Implementation tasks

- [ ] **P00-01** Record client OS versions, CPU architectures, RAM, storage, and screen resolution. Finalize the proposed Windows 10/11 x64 matrix and its minimum supported OS versions.
- [ ] **P00-02** Choose stable internal product ID, bundle ID, publisher identity, and data-root names. Keep development identities distinct from production. Record signing account ownership and how native build machines will be accessed.
- [ ] **P00-03** Pin a compatible Electron, Forge, Vite, TypeScript, Drizzle, better-sqlite3, and pnpm toolchain. Record the embedded Node/SQLite versions and native rebuild requirements. Check experimental integrations against the selected versions.
- [x] **P00-04** Create a disposable or reusable native smoke prototype with a renderer, restricted preload, main process, and utility-process service. Have the service write and reopen a synthetic SQLite record.
- [ ] **P00-05** Package that prototype on Windows 10 and 11. Verify the native module and service entry point load from the installed artifact, including ASAR/unpacked paths.
- [ ] **P00-06** Prove raw SQLite snapshot creation/restoration, native file dialogs, platform directory resolution, and protected-key round trips on each target. This proves primitives; it is not the completed encrypted backup product.
- [x] **P00-07** Record remaining defaults: one owner, confirmed business baseline, empty initial dataset, backup policy, and the distinction between live database protection and encrypted archives. Record unresolved product decisions without inventing requirements.

### Required verification

Launch the packaged prototype with networking disabled. Create a record, exit, reopen, and read it. Create a snapshot and restore it to a separate test root. Confirm native-key access works and fails visibly when unavailable. Confirm no customer database or development configuration is embedded in the artifact.

**Outputs:** platform decision record, pinned prototype configuration, synthetic smoke artifact for each proposed target, and `PHASE_00` verification evidence.

**Exit gate:** all selected target architectures have executed the packaged smoke flow. A Linux development launch alone does not close this phase. Signing procurement may remain open until phase 11, but native packaging and key-store feasibility must be demonstrated.

## Phase 01 Project foundation and local interface shell

**Outcome:** establish the production project structure and a navigable local interface using the proven toolchain.

**Inputs:** phase 00 toolchain and process decisions. Relevant design: [architecture source structure](ARCHITECTURE.md#source-structure).

### Implementation tasks

- [ ] **P01-01** Create the proposed source areas: `main`, `preload`, `renderer`, `service`, `application`, `domain`, `db`, `backup`, `contracts`, and `platform`. Keep business code independent of Electron APIs.
- [ ] **P01-02** Configure TypeScript targets, linting, formatting, path imports, lockfile use, and separate bundles for renderer, main, preload, and service. Exclude native binaries from JavaScript bundling.
- [ ] **P01-03** Add development, lint, typecheck, unit, integration, desktop-test, recovery-test, package, and make scripts. Document which execute on Linux and which require the target OS.
- [ ] **P01-04** Build the app shell, navigation, accessible dialogs, form controls, loading/error/empty states, and placeholder routes for the confirmed baseline. Use synthetic display data only.
- [ ] **P01-05** Bundle fonts, icons, styles, and other UI assets locally. Implement the constrained production application protocol and verify asset resolution in installed builds.
- [ ] **P01-06** Add explicit environment configuration and isolated development/test roots. Production must not fall back to fixture data or expose a test bypass.
- [ ] **P01-07** Establish unit tests for shared pure helpers and a desktop smoke journey that launches the shell, navigates, and quits cleanly.

### Required verification

Run lint, typecheck, and shell smoke tests. Navigate all placeholder routes by keyboard. Package and open the shell without a development server or internet. Confirm missing assets result in visible diagnostic failure rather than a hidden dependency on the Linux working directory.

**Outputs:** project scaffold, local visual shell, scripts, production asset loading, and initial test harness.

**Exit gate:** a packaged shell launches on both targeted Windows versions using only bundled assets. Placeholder content is clearly separated from persisted workflows.

## Phase 02 Application lifecycle and restricted IPC

**Outcome:** the window and local service communicate through a small validated API, with correct startup, exit, and crash behavior.

**Inputs:** phase 01. Relevant design: [architecture](ARCHITECTURE.md#command-and-query-contract).

### Implementation tasks

- [ ] **P02-01** Implement the single-instance lock, second-launch focus behavior, and service startup/readiness handshake. Start the service only as part of launching the app.
- [ ] **P02-02** Implement application states: starting, setup required, locked, ready, maintenance, recovery required, and stopping. Define which commands each state allows.
- [ ] **P02-03** Expose explicit preload methods with shared Zod request/result schemas and protocol versioning. Enforce trusted sender/frame checks, request bounds, and registered operations in the main-process broker.
- [ ] **P02-04** Correlate requests and responses; implement typed errors, progress events, event unsubscription, bounded queues, and timeout behavior. A timeout must not be equated automatically with a rolled-back write.
- [ ] **P02-05** Add service supervision and parent-loss shutdown. On service failure, disable writes and invalidate sessions; provide a restart/recovery path without blindly replaying pending mutations.
- [ ] **P02-06** Implement graceful quit, in-flight job handling, and unsaved-form prompts. Closing the last window exits the service on both Windows 10 and 11. Minimizing leaves the application running.
- [ ] **P02-07** Apply renderer sandboxing, context isolation, restricted navigation, production CSP, and denial of unneeded permissions. Do not expose arbitrary SQL, filesystem paths, shell commands, or generic IPC calls.
- [ ] **P02-08** Add redacted, rotating local diagnostics and a local support-export mechanism. Keep identifiers needed for diagnosis without logging customer data or secrets.

### Required verification

Send malformed, oversized, unknown, and unauthorized IPC requests. Attempt a call from an untrusted frame. Launch twice, kill the service, close the last window, and inspect process cleanup. Simulate a lost response and confirm the UI reports uncertainty. Test window-close behavior on Windows as well as Linux development builds.

**Outputs:** typed desktop API, broker and service host, lifecycle state machine, local diagnostics, and process-failure tests.

**Exit gate:** the renderer has no privileged direct access; duplicate launch, normal exit, and child-process failure have demonstrated behavior without orphan services.

## Phase 03 SQLite schema and storage infrastructure

**Outcome:** establish the persistent business store with reviewed constraints and predictable initialization.

**Inputs:** phase 02 and the [database plan](DATABASE_PLAN.md).

### Implementation tasks

- [ ] **P03-01** Implement platform data-root resolution and directory creation with appropriate OS permissions. Separate live data, runtime cache, settings, logs, backups, staging, and recovery paths.
- [ ] **P03-02** Implement the service-owned connection, pragma configuration/readback, must-exist handling after setup, and read-only snapshot verification connections. Prohibit multiple uncontrolled writers.
- [ ] **P03-03** Implement schema mappings and reviewed initial SQL for metadata, pharmacy/owner, catalog, purchases/items, medicine supplies, follow-ups/events, audit, numbering counters, receipts, and login attempts.
- [ ] **P03-04** Implement exact quantity parsing/storage, canonical UUID handling, business-date validation, timestamp mappings, JSON versioning, and enum/boolean constraints.
- [ ] **P03-05** Add indexes and foreign keys from the database plan. Verify cross-record correspondence in service validation where individual foreign keys are insufficient.
- [ ] **P03-06** Build the migration ledger with immutable checksums and the empty-database migration path. Reject a database newer than the app or a changed applied migration. Production upgrades of an existing dataset remain gated on phase 06 recovery.
- [ ] **P03-07** Define initialization ordering between database commit and installation marker. An interrupted first setup can resume safely; an initialized installation with a missing database enters recovery instead of starting empty.
- [ ] **P03-08** Add synthetic file-backed fixtures, database health inspection, and isolated repository tests. Test code must refuse a production data root.

### Required verification

Run migrations from empty, reopen the database, and assert pragma values and schema checksums. Reject invalid quantities, duplicate identities, orphan references, and wrong scope. Test missing/unreadable existing files, future schema, interrupted setup, and directories with spaces/non-ASCII characters. Test quantity/date round trips under different process timezones.

**Outputs:** initial schema/migrations, connection manager, storage adapters, integrity inspector, and file-backed database fixtures.

**Exit gate:** a correctly initialized database reopens reliably, invalid records are rejected, and missing/corrupt/incompatible data is never replaced silently.

## Phase 04 Owner access and reliable mutation infrastructure

**Outcome:** secure local access and a reusable transactional command pipeline before building business screens.

**Inputs:** phase 03. Relevant design: [local authentication](ARCHITECTURE.md#authentication-and-local-access) and [transactions and retries](DATABASE_PLAN.md#transactions-and-retries).

### Implementation tasks

- [ ] **P04-01** Build offline owner setup and login. Store a salted, versioned scrypt password hash with bounded, benchmarked parameters. Enforce shared password and identifier validation on all credential paths.
- [ ] **P04-02** Implement in-memory sessions bound through the broker to the trusted window. Enforce authorization on reads and writes; clear sessions on exit, service restart, password change, and logout.
- [ ] **P04-03** Implement persistent failed-login throttling and offline owner recovery-code generation, hashing, verification, and rotation. Display recovery instructions without creating a support backdoor.
- [ ] **P04-04** Build the shared command handler for validation, normalized payload hashing, request IDs, receipt lookup, version checks, transaction execution, audit, revision increment, and post-commit events.
- [ ] **P04-05** Implement sequence allocation within the business transaction. Preserve display numbers and historical IDs during corrections and cancellations.
- [ ] **P04-06** Build the renderer mutation helper: freeze the original payload on submission, preserve the same request ID for uncertain retries, retain an in-memory draft through reauthentication, and surface conflicts for review.
- [ ] **P04-07** Implement fault-injection hooks in tests around receipt lookup, record updates, commit, and response delivery. Do not ship reset/bypass hooks in customer builds.

### Required verification

Prove generic login errors, persistent throttling, account recovery, session expiry, and password-change invalidation. Kill the service before commit and after commit/before response. The first leaves no business changes; replay of the second returns the committed result once. Reusing a request ID with a different normalized payload must fail. Verify synchronous transaction callbacks do not cross an asynchronous boundary.

**Outputs:** local account screens/services, session manager, recovery flow, transaction executor, mutation helper, and retry tests.

**Exit gate:** every protected entry point checks access, and the shared mutation pipeline demonstrates atomic writes and idempotent uncertain retries.

## Phase 05 Encrypted local and external backup creation

**Outcome:** create verified portable backup files with independent local/external status.

**Inputs:** phase 04 and [backup creation design](BACKUP_AND_RECOVERY.md#consistent-backup-sequence).

### Implementation tasks

- [ ] **P05-01** Finalize the versioned archive/header/manifest schemas, maximum sizes, allowed entries, key IDs, and test vectors. Keep identifying business metadata inside the encrypted payload.
- [ ] **P05-02** Implement backup-passphrase setup, wrapping-key derivation, random master-key generation, authenticated archive encryption, and OS-protected local key storage. Explicitly handle unavailable or unprotected key-store backends.
- [ ] **P05-03** Implement snapshot jobs using the SQLite backup API. Verify the completed snapshot, then read its revision/counts for the manifest; do not use counts from a changing live database.
- [ ] **P05-04** Implement destination selection and validation, private staging, streamed encryption, destination `.partial` writes, readback verification, and final publication. Track success only after verification.
- [ ] **P05-05** Add external destination identity and reconnection handling. Copy completed encrypted archives with verification; handle changed drive letters/mount names without guessing a destination.
- [ ] **P05-06** Implement one-job-at-a-time scheduling, startup/resume catch-up, unchanged-data decisions, manual backup, and independent destination history. Handle interrupted/abandoned job state on next launch.
- [ ] **P05-07** Implement retention for the proposed 14 daily, 8 weekly, and 3 pre-migration copies. Pin safety copies and preserve the last good archive when a new attempt fails.
- [ ] **P05-08** Add the backup settings/status screen, progress, error messages, last-success timestamps, and passphrase/key rotation behavior. Make local success distinguishable from external success.

### Required verification

Create/decrypt a known archive and compare its snapshot data. Test wrong passphrase, modified header/payload/tag, key-store failure, full/read-only destination, drive disconnect, repeated scheduler triggers, app exit during snapshot, and retention after failure. Confirm a partial file never appears as a completed backup. Confirm archive decryption succeeds without the originating OS key store.

**Outputs:** archive format specification, crypto/key adapters, snapshot/export jobs, scheduling/retention, backup UI, and known-answer/failure tests.

**Exit gate:** local and external archives verify independently, retain older good copies on failure, and can be decrypted portably. Full database replacement is completed in phase 06.

## Phase 06 Restore and migration recovery

**Outcome:** restore a backup and upgrade an existing database without losing the ability to recover from an interruption.

**Inputs:** phase 05. Relevant design: [restore workflow](BACKUP_AND_RECOVERY.md#restore-workflow) and [database migrations](DATABASE_PLAN.md#migrations-and-updates).

### Implementation tasks

- [ ] **P06-01** Build archive inspection and staging extraction with format/version/size checks, authenticated decryption, path traversal rejection, integrity checks, foreign-key checks, and domain validation.
- [ ] **P06-02** Add first-run restore and authenticated restore of an existing installation. Display snapshot date, dataset identity, version, counts, and replacement consequences before confirmation.
- [ ] **P06-03** Add the maintenance barrier that stops new commands, drains transactions/jobs, closes all SQLite handles, and creates a verified safety snapshot before replacement.
- [ ] **P06-04** Implement the flushed restore journal and same-filesystem directory replacement protocol. Define deterministic recovery for interruption before/after moving the old and new directories.
- [ ] **P06-05** Reopen and validate the replacement, clear sessions/query caches, preserve device-specific destinations, and recreate protected local keys. Track restored dataset identity separately from local installation identity.
- [ ] **P06-06** Implement pre-migration snapshots and journaled upgrades for existing datasets. Test transactional rollback and explicit table rebuilds; reject unsupported downgrade/newer-schema writes.
- [ ] **P06-07** Define the damaged-database recovery path. Preserve original files and do not force an impossible valid safety snapshot or silently erase the damaged dataset. Keep salvage separate from ordinary restore.
- [ ] **P06-08** Exercise new-device restore using only the installer, archive, backup passphrase, and owner login/recovery materials. Reconfigure external destinations and verify a new backup afterwards.

### Required verification

Interrupt every restore/journal replacement boundary and every migration boundary. On relaunch, the app must select a verified old/new dataset or a recovery screen, never ordinary writes against an ambiguous state. Restore Windows-created archives on a second Windows computer with a fresh OS user and no original key store. Check representative histories and counts, not only file checksums.

**Outputs:** restore inspection/UI, maintenance barrier, recovery journals, upgrade executor, and cross-platform recovery tests.

**Exit gate:** normal restore, interrupted restore, and failed upgrade all preserve an evidenced recovery route. Existing-data migrations can now be enabled.

## Phase 07 Customer and medicine catalog workflows

**Outcome:** persist and maintain the records needed for purchase entry with searchable lists and preserved history.

**Inputs:** phases 04 and 06, the confirmed business baseline. Relevant design: [proposed database tables](DATABASE_PLAN.md#proposed-tables).

### Implementation tasks

- [ ] **P07-01** Implement customer create/edit/archive/restore services through the shared mutation pipeline. Require a normalized valid phone; allow shared family numbers and optional age.
- [ ] **P07-02** Implement medicine create/edit/archive/restore with a normalized name/strength/form identity. Handle existing archived matches with a restore/reuse choice instead of creating duplicates.
- [ ] **P07-03** Implement bounded search, stable sorting, pagination, list counts, and selection of active records. Preserve archived records in historical detail views.
- [ ] **P07-04** Build customer and medicine list/detail screens, edit dialogs, conflict handling, and accessible search/select controls.
- [ ] **P07-05** Implement reusable inline-create dialogs and callbacks for purchase entry. Preserve the parent draft when a dialog opens, fails, retries, or closes.
- [ ] **P07-06** Add version checks and audit events for changes, including archive/restore. Enforce the documented effect of archived customers/medicines on new versus historical purchases.
- [ ] **P07-07** Add service and desktop journeys for exact duplicate detection, normalized search, optional values, stale edits, and repeated creates after a lost response.

### Required verification

Create records, restart the app, and find them by name/phone. Test whitespace/case normalization, shared phone numbers, archived duplicate medicines, and invalid ages/phones. A repeated inline create with the same request ID must return the same record. Ensure historical medicine labels will come from purchase snapshots rather than later catalog edits.

**Outputs:** catalog services/repositories, list/detail screens, reusable picker/inline-create components, and catalog regression tests.

**Exit gate:** the owner can create, search, correct, archive, and restore catalog records offline without losing or duplicating them.

## Phase 08 Medicine supply domain and purchase services

**Outcome:** implement the transactional purchase/supply engine independently of the purchase screen.

**Inputs:** phase 07 and [supply invariants](DATABASE_PLAN.md#supply-and-reminder-invariants).

### Implementation tasks

- [ ] **P08-01** Implement pure calendar helpers, exact quantities, supply-date calculations, reminder lead calculation, and follow-up-state derivation with an injectable clock.
- [ ] **P08-02** Implement supply-context queries and a deterministic revision covering all relevant purchase, supply, and follow-up state. Return enough information for a preview without exposing internal records indiscriminately.
- [ ] **P08-03** Implement purchase creation with item snapshots, one supply per distinct medicine, opt-in reminders, sequence allocation, and a single atomic receipt/audit commit.
- [ ] **P08-04** Implement extend/replace decisions, nullable versus zero remaining overrides, manual reminder validation, and explicit confirmation for dates at/after run-out.
- [ ] **P08-05** Implement chain reconciliation in purchase-date/sequence order. Recompute dependent estimates, close superseded follow-ups, and retain the previous contact/snooze/manual-closure state.
- [ ] **P08-06** Implement correction with reason, cancellation, medicine removal/re-addition, purchase-date changes, and customer moves. Reconcile every affected old/new chain within the same transaction.
- [ ] **P08-07** Preserve stale-version/revision conflicts and uncertain retry semantics. Return affected entities/revisions only after commit.
- [ ] **P08-08** Create a service-level lifecycle matrix that exercises multi-medicine purchases and changes to earlier as well as latest supplies. Include actual file-backed transaction races and injected rollback failures.

### Required business examples

| Example | Required result |
| --- | --- |
| Seven new days from 1 November | Run-out 8 November; reminder 6 November |
| Eleven-day refill on 4 November with four days carried | Run-out 19 November; reminder 16 November |
| Same refill starting fresh | Run-out 15 November; reminder 12 November |
| One day with no carry | Reminder on the supply start date |
| Same medicine in strips and tablets | Two quantity rows, one supply duration and reminder choice |
| Two distinct medicines | Independent duration, remaining supply, and reminder state |
| Remaining override of zero | Carry zero; do not treat it as an absent override |
| New reminder disabled on a later supply | Prior cycle superseded; no new open reminder |
| Cancel latest supply | Prior eligible contact/snooze/manual-closure state restored |
| Correct an earlier supply before a later replace entry | Recompute dependent extends; replace still resets coverage |
| Purchase another medicine | Existing medicine's follow-up remains unaffected |
| Stale simultaneous refill requests | One valid commit; conflicting stale request creates no partial purchase |

Use fixed fixture dates and clocks so these tests do not change behavior as real time advances. Add leap-day/year-boundary and out-of-range computed-date cases.

**Outputs:** pure domain modules, purchase/supply repositories, command services, chain revision protocol, and lifecycle tests.

**Exit gate:** all calculation examples and correction/cancellation invariants pass without needing a renderer. A failing reconciliation leaves no partially saved purchase or history.

## Phase 09 Purchase entry and correction interface

**Outcome:** the owner can complete the purchase workflow using the validated service engine.

**Inputs:** phase 08 and the catalog components from phase 07.

### Implementation tasks

- [ ] **P09-01** Build customer selection, purchase date, notes, medicine rows, quantities, and units. Reject future purchase dates and duplicate medicine/unit rows with understandable messages.
- [ ] **P09-02** Group supply fields by distinct medicine. Add new days, supply start, reminder opt-in, extend/replace choice, optional remaining adjustment, and manual reminder controls.
- [ ] **P09-03** Load context for the current customer/date/medicine selection. Discard stale asynchronous results, indicate loading/errors, and provide explicit refresh after a conflict.
- [ ] **P09-04** Show estimated carried days, run-out, and reminder dates before saving. Require a deliberate refill choice where prior supply exists and reset invalid confirmations when dependent values change.
- [ ] **P09-05** Connect inline customer/medicine creation without losing existing form values. Preserve grouping when a medicine appears in different units or a row is removed.
- [ ] **P09-06** Integrate the shared mutation helper, loading/disabled states, structured validation, reauthentication, frozen uncertain retries, and post-save navigation.
- [ ] **P09-07** Build purchase list/detail, correction with a reason, and cancellation confirmation. Present the consequences for related supplies and preserve dated snapshots/history.
- [ ] **P09-08** Implement unsaved-change behavior and keyboard operation, including date controls and dialogs. Treat app-exit loss of unsaved in-memory drafts honestly; persistent draft recovery is not assumed.

### Required verification

Run a complete purchase with two medicines and mixed units, inline creation, and different reminder choices. Expire the session mid-entry and verify the draft survives reauthentication. Drop the successful save response and retry to obtain one purchase. Change selections rapidly to test stale previews. Correct and cancel both early and latest purchases and inspect the resulting history.

**Outputs:** working purchase entry/list/detail/correction screens, preview integration, and desktop journeys against real local storage.

**Exit gate:** the owner can record and correct a representative purchase offline with a clear preview, reliable save behavior, and no duplicate or partially reconciled records.

## Phase 10 Follow ups histories settings and export

**Outcome:** complete the confirmed daily workflow around due reminders and historical records.

**Inputs:** phase 09. Relevant baseline: [overall scope](OVERALL_PLAN.md#scope-boundary).

### Implementation tasks

- [ ] **P10-01** Implement dashboard queries for due customers and counts. Implement dedicated follow-up tabs grouped/paginated by customer so one customer's matching medicines are not split across pages.
- [ ] **P10-02** Implement contact, optional next contact date, snooze, close with reason, and explicit reopen for an eligible current cycle. Preserve separate status and contact history per medicine.
- [ ] **P10-03** Implement contacted/awaiting-refill and follow-up-again presentation. Add refill entry links that preselect the relevant customer/medicine without guessing new supply duration or reminder opt-in.
- [ ] **P10-04** Build current customer supply, dated purchase history, medicine purchase history, and event/audit detail views. Distinguish active, cancelled, superseded, and manually closed records.
- [ ] **P10-05** Implement pharmacy settings, password change, logout, backup settings access, and the visible data/backup status. Keep device preferences separate from backed-up pharmacy settings.
- [ ] **P10-06** Implement approved CSV exports through a native save dialog and an exact enum of export kinds. Bound memory, neutralize spreadsheet formulas, close all handles in success/failure paths, and surface cancellation/disk errors accurately.
- [ ] **P10-07** Refresh queries after commits, route changes, app focus/resume, and relevant date changes. A lost process event must not permanently leave a view stale. Do not add SSE or a network listener for local refresh.
- [ ] **P10-08** Add end-to-end journeys spanning purchase, contact, scheduling, refill, cancellation, reopen, history, export, logout, and a subsequent app restart.

### Required verification

Confirm contact does not close a reminder. A future contact date moves it to Scheduled, and becoming due offers another follow-up. Manual closure survives later supply restoration. Verify customer grouping counts and pagination, catalog rename snapshots, and independent medicine actions. Reject invalid export kinds, including inherited object-property names, without leaking a database/file handle. Test writing to a disconnected or full export destination.

**Outputs:** dashboard/follow-up workflows, customer/medicine history views, settings, exports, and an integrated owner journey.

**Exit gate:** the confirmed business baseline is usable end to end through the desktop app, and reminders remain correct across restart and pharmacy-date changes.

## Phase 11 Signed installers and offline upgrade flow

**Outcome:** produce customer-distributable artifacts that preserve data through installation, upgrade, and reinstallation.

**Inputs:** phases 06 and 10, target build environments, and signing arrangements. Relevant design: [build and release plan](BUILD_AND_RELEASE.md).

### Implementation tasks

- [ ] **P11-01** Finalize Windows 10/11 maker configuration, product metadata, icons, bundle identities, platform entitlements, and architecture-specific artifact names.
- [ ] **P11-02** Build from a clean source revision/lockfile on the target release jobs. Rebuild native SQLite for the selected Electron runtime and architecture; verify utility-process execution and bundled migrations.
- [ ] **P11-03** Sign Windows releases and verify final installer signatures. Keep signing credentials outside source and installers.
- [ ] **P11-04** Implement/test running-instance handling during installer replacement and manual offline update delivery. No installed app action may require downloading runtime dependencies.
- [ ] **P11-05** Exercise schema compatibility and the phase 06 migration recovery flow using prior-release fixtures. Refuse incompatible downgrades and give a clear recovery path.
- [ ] **P11-06** Test uninstallation and reinstall behavior, data directory preservation, user-profile isolation, Windows installer replacement, and paths with spaces/non-ASCII names.
- [ ] **P11-07** Scan packaged contents for fixtures, real databases, archives, environment files, secrets, test bypasses, development server references, and remote assets.
- [ ] **P11-08** Generate artifact checksums, version compatibility notes, offline installation/update instructions, and build provenance. Record exactly which OS/CPU combinations each artifact was tested on.

### Required verification

Install the exact final artifacts on clean disconnected Windows 10/11 targets. Complete first-run setup, login, save, restart, backup, restore, and update with existing data. Verify no boot/login entry or persistent tray service is introduced. Recheck the final hardened binaries separately if automation requires a differently instrumented QA build.

**Outputs:** candidate signed installers, checksums/provenance, compatibility matrix, and installer/update verification records.

**Exit gate:** each claimed release platform passes offline first install and update using the actual distributable artifact, with data preserved.

## Phase 12 Reliability performance and release verification

**Outcome:** demonstrate system behavior under realistic volume, interruptions, and environmental failures.

**Inputs:** phase 11 candidate artifacts and the [overall acceptance matrix](OVERALL_PLAN.md#acceptance-matrix).

### Implementation tasks

- [ ] **P12-01** Create a reproducible synthetic capacity dataset based on the proposed 10,000 customers, 10,000 medicines, 100,000 purchases, and 300,000 item/supply rows, including meaningful history and long refill chains.
- [ ] **P12-02** Measure cold launch, list search, pagination, purchase save, chain correction, export, backup, and restore on the agreed reference machines. Record memory/disk use and set measured release budgets; optimize only demonstrated bottlenecks.
- [ ] **P12-03** Run process-kill and storage-failure scenarios across commit, snapshot, archive publication, migration, and restore boundaries. Verify the startup recovery decisions with real files.
- [ ] **P12-04** Exercise IPC boundary attacks, invalid schemas, login recovery/throttling, corrupted archives, malformed paths, oversized input, and leakage checks for logs/diagnostic exports.
- [ ] **P12-05** Test network-disabled operation and observe application traffic during ordinary workflows. Confirm all runtime assets and necessary operations remain local.
- [ ] **P12-06** Test sleep/resume, timezone differences, pharmacy midnight, clock rollback, external-drive reconnection, low disk space, read-only directories, and repeated open/close cycles.
- [ ] **P12-07** Complete keyboard, focus, error-message, text-scaling, and supported-display checks on Windows 10/11. Ensure long-running work reports progress and the window remains responsive.
- [ ] **P12-08** Resolve release-blocking defects, add targeted regression cases, and repeat affected checks. Rebuild/re-sign changed artifacts and verify those exact artifacts before marking the phase complete.

### Required evidence

Maintain a release verification record with artifact hashes, OS/CPU/RAM/disk details, schema/engine versions, tested scenarios, measurements, and remaining limitations. Distinguish an untested environment from an observed application failure. A green Linux test run cannot substitute for Windows DPAPI or Windows installer evidence.

**Outputs:** reliability report, measured performance budgets, target-platform verification, defect resolutions, and final release candidates.

**Exit gate:** all mandatory acceptance scenarios pass on supported targets, and there are no unresolved issues that can lose committed data, misstate backup success, break recovery, or prevent ordinary offline use.

## Phase 13 Owner pilot recovery rehearsal and handover

**Outcome:** the owner can install, operate, update, and recover the app with understandable instructions and the required recovery materials.

**Inputs:** phase 12 final candidates and access to the owner's intended hardware.

### Implementation tasks

- [ ] **P13-01** Run an owner walkthrough with synthetic records: setup, customer/medicine creation, purchase, follow-up, refill, correction/cancellation, and history/export.
- [ ] **P13-02** Configure the chosen local/external backup destinations and demonstrate successful, pending, and failed backup states. Confirm the owner understands what happens when the drive or app is unavailable.
- [ ] **P13-03** Have the owner create a backup and restore it to a separate fresh profile/device, using the backup passphrase and owner credentials/recovery code without developer tooling.
- [ ] **P13-04** Finalize offline install/update instructions, backup/restore instructions, credential-recovery instructions, and a short troubleshooting guide covering missing database, storage full, missing external drive, and incompatible app version.
- [ ] **P13-05** Record supported hardware/OS versions, backup frequency/retention, recovery responsibilities, passphrase custody, and owner acceptance. Keep backup passphrases and recovery codes out of the source repository and support notes.
- [ ] **P13-06** Deliver the tested installer(s), artifact checksums, release notes, documentation, and recovery procedure. First real use starts with an empty dataset unless a separate import has been specified and verified.
- [ ] **P13-07** Establish a maintenance process for dependency updates, defect fixes, compatible migrations, new installer delivery, and periodic restore rehearsal. Track requested new features separately from corrective work.

### Required verification

The owner completes the daily flow and a recovery drill on the actual target hardware. Verify the restored dataset rather than only observing a success message. Capture usability issues before introducing real customer records; resolve any issue that blocks safe routine work or recovery.

**Outputs:** owner-accepted release, handover guide, successful recovery rehearsal, and a clearly scoped maintenance backlog.

**Exit gate:** the owner can use and recover the application offline, the shipped artifacts match the verification record, and all required access/recovery materials have an agreed custodian.

## Coverage ownership

Use this table to prevent critical behaviors from being deferred or tested only at one layer.

| Behavior | First implemented | Main verification | Final release evidence |
| --- | --- | --- | --- |
| Native SQLite and platform packaging | 00 | Packaged prototype on target OS/CPU | 11 and 12 |
| Local assets and offline shell | 01 | Packaged shell without dev server | 11 and 12 |
| Restricted IPC and service lifecycle | 02 | Malformed sender/request and process cleanup tests | 12 |
| Persistent directories and schema | 03 | File-backed constraints, setup interruption, missing-file tests | 11 and 12 |
| Authorization and recovery codes | 04 | Unauthorized calls, expiry, restart, reset/throttling | 12 and 13 |
| Atomic writes and uncertain retries | 04 | Before/after-commit fault injection and receipt replay | 08–10 and 12 |
| Portable encrypted archives | 05 | Crypto vectors, corrupt inputs, unavailable keys/media | 06, 12, and 13 |
| Restore and migration interruption | 06 | Every replacement/journal boundary; between Windows 10 and 11 | 11–13 |
| Catalog consistency | 07 | Normalization, archival, conflicts, inline retries | 09 and 10 |
| Supply arithmetic and reconciliation | 08 | Pure rules plus actual transactional lifecycle tests | 09, 10, and 12 |
| Usable purchase entry | 09 | Desktop journey, stale preview, reauthentication | 12 and 13 |
| Follow-ups/history/exports | 10 | End-to-end daily workflow and handle cleanup | 12 and 13 |
| Offline installer upgrades | 11 | Previous-version data, failure/downgrade, reinstall | 12 and 13 |

## Suggested implementation slices

Keep each change reviewable and independently verifiable. A phase can contain several changes; it need not become one large pull request.

| Slice | Typical scope | Demonstration |
| --- | --- | --- |
| Platform bootstrap | Native prototype and build configuration | Packaged synthetic SQLite record survives restart |
| Desktop lifecycle | Main/preload/service contracts and shutdown | Second launch focuses existing window; quit closes child |
| Storage foundation | Paths, migrations, constraints, fixtures | Invalid data rejected and missing existing file handled safely |
| Account and mutation core | Local sessions, owner recovery, receipts | Interrupted successful command replays once |
| Backup engine | Snapshot, encryption, publication | Portable archive verified without source key store |
| Restore engine | Candidate inspection and journaled replacement | Interrupted restore returns to a verified dataset |
| Catalog | Services and screens | Inline create preserves an active draft |
| Supply engine | Pure rules and transactional reconciliation | Early refill and cancellation restore expected dates/state |
| Purchase interface | Entry, previews, correction, cancellation | Complete representative multi-medicine workflow |
| Follow-up interface | Contact, schedule, close/reopen, history | Independent medicine follow-ups remain correct |
| Distribution | Native installers, updates, signing | Fresh offline install and data-preserving update |

Document compatibility changes when a slice changes IPC contracts, schema, backup format, or persistent directory identity. Never edit an already shipped migration to fit a later slice.

## Release handoff checklist

- [ ] Phase gates have linked evidence rather than only checked task lists.
- [ ] The functional baseline and any later changes are explicitly recorded.
- [ ] Windows 10/11 artifacts, native dependencies, and supported versions are verified.
- [ ] Linux development and automated tests remain isolated from production data.
- [ ] Runtime operation has no required internet or third-party server connection.
- [ ] Committed data, retries, corrections, and history survive the required failure cases.
- [ ] Encrypted local/external backups and fresh-device restore have been demonstrated.
- [ ] Existing-data migrations and attempted downgrade cannot silently damage data.
- [ ] Final installers preserve the permanent data directory and add no startup service.
- [ ] The owner can perform backup, restore, and account recovery with the delivered instructions.

## Work intentionally left for a later plan

The LAN design remains a future architecture extension: one primary service owns the database and clients call authenticated APIs. It will require its own host availability, TLS/pairing, concurrency, update compatibility, and recovery plan. Directly sharing the SQLite file over a network folder is not that design.

Additional ERP features, importing the web demo's data, persistent draft recovery, online updates, automated messaging, cloud backup, and offline client synchronization each need their own requirements and impact assessment. No task in this plan authorizes silently adding them.

Calendar delivery estimates should follow phase 00 results and the baseline decision. Track implementation effort separately from waiting for hardware, signing access, and owner review; the phase count is not a promised schedule.
