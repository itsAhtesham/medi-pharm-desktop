# Medi Pharm Desktop overall plan

Deliver an installable desktop application for one pharmacy operating on one computer. The owner can open it, manage records, close it, and reopen it with all committed data intact, without an internet connection. Local and external backups provide recovery after mistakes or replacement of the computer.

Windows 10 and 11 are release targets. Linux is the developer workstation and a development/test platform. This plan covers the technical foundation and a confirmed functional baseline from the existing demo; additional ERP features will be scoped separately.

Confirmed on 10 November 2026: keep the business baseline unchanged, write all desktop code from scratch, and ship only for Windows 10 and 11. Linux is the development environment; a Windows 11 laptop is available for testing. Windows x64 is the working architecture assumption pending hardware confirmation.

## Requirements and planning defaults

| Area | Decision or proposed default | Status |
| --- | --- | --- |
| Execution | Installed desktop app with fully local runtime and data | Confirmed |
| Release platforms | Windows 10 and 11 | Confirmed |
| Development platform | Linux | Confirmed |
| Initial topology | One computer, one authoritative local database | Confirmed |
| Lifecycle | Launch manually; database opens with app; exit closes application services | Confirmed |
| Backups | Local directory and optional external drive; restore supported | Confirmed direction |
| Future topology | Primary computer with service and database; desktop clients connect over LAN | Future direction only |
| Product baseline | Existing demo workflows, implemented from scratch | Confirmed 10 November 2026 |
| Access | One local owner account and one OS user profile initially | Proposed |
| Stack | Electron, React, TypeScript, Vite, SQLite, Drizzle, better-sqlite3, Electron Forge | Proposed |
| CPU targets | Windows x64 | Proposed; verify client hardware |
| Backup protection | Encrypted portable archives with an owner-held backup passphrase | Proposed |
| Scheduling | Daily automatic backup while app is running; startup catch-up; manual backup | Proposed |
| Updates | Signed installers delivered manually, including via USB | Proposed |
| Live database encryption | Standard SQLite with OS account permissions; disk encryption handled by the device | Proposed; confirm confidentiality requirements before real data |

An application login limits access through the app. It does not encrypt the SQLite file or protect it against an administrator of the computer. Encrypted backups and local database protection are separate decisions.

## Intended installation and daily operation

1. Install the Windows application.
2. Launch it from the desktop or Start menu.
3. Complete local owner setup, pharmacy settings, and backup configuration. Setup must work offline.
4. Store business records in the fixed application-data directory, separate from installed executable files.
5. Use the application normally. Each successful save means the local transaction committed.
6. See the last successful local and external backup separately. Connect an external drive when desired.
7. Exit the application. Background services exit with it; the saved database remains on disk.

The first-run screen also offers restoring an existing backup. A missing database in a previously initialized installation opens recovery guidance rather than silently creating an empty pharmacy.

## Scope boundary

Use the current demo to exercise the technical foundation with customer records, medicine catalog, customer purchases, per-medicine supply calculations, follow-up actions, history, settings, and CSV exports. Preserve its meaning of purchase: a sale from the pharmacy to a customer.

Do not treat the reference screenshot as a feature specification. Inventory, supplier purchasing, billing, GST, accounting, test reminders, vitals, cloud backups, and automated messaging need a later feature decision. A native print facility can be accommodated architecturally without committing to billing or invoice features.

No LAN listener, synchronization engine, cloud account, online license check, push service, or remote update dependency is required in the initial runtime. Backups and reminders do not run while the app is closed or the computer is off. Opening the app recomputes due reminders and checks missed backups.

## Implementation sequence

Work through these milestones in order. Each has an observable completion gate; completion means demonstrated behavior, not merely committed code. Estimate delivery dates after the platform prototype and feature-baseline review.

The [phase wise implementation plan](IMPLEMENTATION_PLAN.md#phase-map-and-dependencies) expands these seven milestones into fourteen phases, with concrete task IDs, dependencies, implementation outputs, tests, and exit gates. Its phase map preserves the milestone groupings below.

| Milestone | Work | Completion gate |
| --- | --- | --- |
| 0 Platform prototype | Pin a compatible toolchain; launch Electron on Linux; build Windows x64 and test on Windows 10 and 11; load native SQLite in the packaged service process; test native key storage and backup on each target | Clean offline target machines launch a packaged build and create, reopen, back up, and restore a synthetic database |
| 1 Desktop foundation | Local asset protocol, shell/navigation, typed IPC, service supervision, single-instance behavior, fixed data directories, structured errors and logs | UI stays responsive during database work; a second launch focuses the existing window; exit leaves no app service running |
| 2 Storage and account | Schema and migrations, owner setup, local login/session, password change/recovery, transactions, mutation receipts, validation | Invalid or interrupted writes leave no partial business records; unauthorized IPC calls cannot access records |
| 3 Backup and recovery | Archive format, passphrase setup, local scheduling, external destinations, retention, restore journal, migration snapshots | Restore succeeds on a second OS user/device using only installer, archive, and recovery materials; interruption tests preserve the previous database |
| 4 Baseline workflows | Customers, catalog, purchase entry/correction/cancellation, supply calculations, follow-up actions and history | Current medicine-level rules and linked-history behavior pass service and desktop tests |
| 5 Packaging and updates | Windows installers, signing, schema compatibility, manual update flow | Offline install, update with data, reinstall, and attempted downgrade behave as documented on each supported platform |
| 6 Reliability and owner walkthrough | Failure injection, hardware measurements, usability, keyboard operation, backup drills, documentation | Acceptance matrix passes; owner completes the daily workflow and restores a sample backup without developer tools |

Milestone 0 is deliberately early: Linux development must not defer discovery of native module, OS credential-store, installer, or Windows signing issues until the end.

## Acceptance matrix

| Scenario | Required outcome |
| --- | --- |
| Install and first launch without network | Local assets, runtime, database setup, and owner creation work |
| Open and close repeatedly | Committed records survive; no duplicated bootstrap records |
| Reboot computer | No app service starts automatically; manual launch finds the existing database |
| Launch app twice | Existing window opens; no second business database owner is created |
| Save interrupted before commit | Entire command rolls back |
| Save committed but response lost | Retrying the same request returns its original result without duplication |
| Two edits based on old data | The later stale edit receives a conflict and preserves the user's draft |
| Renderer or service crash | App shows a recoverable state; records remain consistent; sessions are renewed safely |
| Invalid or missing existing database | Recovery screen appears; no silent replacement with an empty database |
| Full or read-only disk | Save or backup reports failure; app does not claim success |
| External drive absent or unplugged | Local backup state remains accurate; external attempt is pending/failed; earlier backups remain |
| Interrupted archive write | Partial file never appears as a completed backup |
| Corrupt or wrong-password archive | Restore rejects it without modifying live data |
| Restore older snapshot | Owner sees its date and replacement consequences; current data is preserved first |
| Backup restored on another Windows computer or OS account | Business data restores; device paths and OS-protected keys are recreated locally |
| Interrupted restore or migration | Startup completes a verified recovery path before accepting writes |
| Install newer app | Records survive and compatible migrations run once |
| Install app older than database | App refuses incompatible writes and explains the recovery options |
| Uninstall and reinstall | Uninstaller preserves business data by default; reinstall finds it |
| Date changes, sleep, or resume | Dashboard and backup due state are recalculated using the pharmacy calendar |
| Network monitoring during ordinary use | No application-initiated connection to third-party services is required or made |

For persistent storage, use real file-backed SQLite tests, not only an in-memory database. Test platform installers separately from development-mode Electron automation.

## Performance and capacity planning

Capture the client's OS version, CPU architecture, RAM, available disk space, display resolution, expected annual purchases, and desired retention during milestone 0. Proposed synthetic load for initial profiling: 10,000 customers, 10,000 medicines, 100,000 purchases, and 300,000 item/supply rows, plus their events. This is a test workload, not a supported-capacity claim.

Measure cold start, paginated search, purchase save, large-chain correction, backup creation, and restoration on an agreed reference machine. Set release budgets after those measurements. Keep list queries paginated and move synchronous database work away from the window process. Backups must not require loading the full archive into memory.

## Decisions to finalize during implementation

| Decision | Proposed direction | Needed by |
| --- | --- | --- |
| Exact Windows 10/11 minimum versions and CPUs | Match client hardware and the selected maintained Electron version | Platform prototype |
| Product and publisher identity | Stable application ID, folder name, bundle ID, publisher, and icon | First packaged prototype |
| Native build access | Windows 11 laptop available for manual testing; Windows 10 test environment still needed; Linux remains the development workstation | Platform prototype |
| Distribution credentials | Windows signing identity | Release packaging |
| Owner access and recovery | One local owner, session in memory, offline recovery code | Account implementation |
| Existing demo records | Start empty; import only if explicitly requested and mapped | Database implementation |
| Confidentiality of the live database | OS file permissions plus device disk encryption; revisit SQLite encryption if required | Before real customer data |
| Backup passphrase custody | Owner stores it separately and demonstrates replacement-device restore | Backup setup |
| Backup frequency and retention | Daily, 14 daily and 8 weekly copies; external when connected | Backup acceptance |
| Functional baseline | Baseline confirmed unchanged on 10 November 2026; implement all desktop code from scratch | Workflow implementation |

These decisions do not block documenting the architecture. They do block claiming an untested platform, a recovery guarantee, or completion of the corresponding milestone.

## Delivery package

Deliver source and lockfile, schema migrations, tested platform installers, version and schema compatibility notes, release checksums, offline setup instructions, backup/restore instructions, owner recovery instructions, and a verification record tied to each artifact. Do not include development fixtures, production records, private signing keys, or backup passwords in installers.

The [build plan](BUILD_AND_RELEASE.md) separates internet use on developer/build machines from the client's offline runtime. The [backup plan](BACKUP_AND_RECOVERY.md) defines achievable recovery behavior rather than promising zero data loss between backups.
