# Storage and owner-access development preview

Implemented 10 November 2026, following foundation commit `3794bc3`. The source revision is the commit introducing this evidence file. This is a Linux-tested development slice of phases 03/04, not a completed Windows or pharmacy release.

## Delivered behavior

- Fresh preview identity and profile, separate from the original synthetic prototype and future production profile. No web data/code/credentials are imported.
- Explicit setup creates an empty pharmacy and one local owner. The initial reviewed SQL contains metadata/migrations, owner/auth attempts, catalog, purchases/items, supplies, follow-ups/events, audit, counters, and mutation receipts. Business services are still pending.
- Service-owned SQLite connection verifies foreign keys, WAL, FULL synchronization, 5-second busy timeout, database identity, migration checksum, integrity, foreign keys and bounded credential formats.
- The durable installation claim precedes creation; the schema, metadata and account commit atomically. Missing, partial, mismatched, corrupt or incompatible data is never replaced with an empty database.
- Passwords and recovery codes use independent random salts and versioned scrypt (`N=32768,r=8,p=3`, 32-byte key, 64 MiB maximum memory). Database-supplied work factors are strictly validated. Minimum-Windows-hardware calibration remains pending.
- Recovery codes contain 256 random bits, generated with the renderer's Web Crypto API. Setup/recovery requires the owner to save and acknowledge the code before submission. Only hashes persist. Successful recovery rotates the code and password atomically; password changes retain the recovery code. Account changes return to login; after uncertain responses the user checks the new credentials rather than blindly resubmitting recovery.
- A single trusted-window service session lives only in memory, expires after eight hours, and is checked on protected reads/writes. Logout, process restart, password change, recovery, credential-version mismatch and a detected backward clock jump invalidate it. Lifecycle checks run on focus and every 30 seconds; protected commands check immediately.
- Login/recovery/password verification share a persistent throttle. Attempts are reserved before KDF work so terminating the process cannot erase them. Five failures start a 30-second delay, increasing to 15 minutes. Unknown identifiers use the same password check and generic failure message.
- Pharmacy-name edits freeze a request UUID and normalized payload. One immediate transaction checks prior receipts and expected version, updates the record, appends audit, advances revision and inserts the result receipt. A lost response followed by restart/login/retry produces one change. Changed payloads and stale versions fail explicitly. The implementation is currently one concrete command; extracting the shared business-command handler is pending.
- Locked/recovery views hide business details. Settings drafts stay in memory across login and service restart. Existing close-confirmation, restricted-origin IPC, single-instance shutdown and redacted diagnostics remain active.
- Raw prototype snapshot and device-check APIs are removed from the running preview. The legacy store remains covered by isolated primitive tests, not connected to the account database.

## Verification

Environment: Linux x64; Node 24.15.0; pnpm 10.33.4; pinned Electron 45.2.3; better-sqlite3 13.0.3.

- `pnpm check`: lint, formatting, three TypeScript configurations and 30 tests passed.
- File-backed tests cover empty setup, hashed credentials, reopen/login, session expiry/clock checks, persistent throttle, recovery rotation, password change, strict SQL/FKs/uniqueness, migration/identity rejection, partial setup protection, atomic rollback via a test-only SQL trigger, stale versions and receipt replay after response loss.
- `pnpm package`: builds the Linux x64 preview with native SQLite in the packaged utility process.
- `pnpm test:desktop`: 10 packaged tests passed with Chromium sandbox enabled. They cover setup/login/reopen, password change/recovery, renderer isolation/input validation, crash/restart/reauthentication with draft preservation, lock/close cancellation, diagnostic redaction/overwrite refusal, foreign-window denial, keyboard navigation/listener cleanup, missing-database recovery, and single-instance/utility-process shutdown.
- Visual inspection of `test-results/owner-overview.png` confirms the empty dashboard and preview state render in the packaged app. Artifacts/test profiles are untracked and disposable.

## Open gates

Windows 10/11 native builds and manual walkthroughs are pending. Windows ACLs, native installers, DPAPI, signing and hardware KDF performance are unverified. The preview profile environment override selects an isolated location; it never bypasses owner authentication.

Remaining phase 03/04 tasks include Drizzle schema mappings, exact quantity/date/domain validation, correlated supply/follow-up invariants, generic mutation infrastructure and transactional numbering, safe interrupted-setup resumption, broader disk-failure/load testing and target-hardware calibration. Interrupted setup currently fails closed with files preserved. Do not mark the complete phases passed.

Encrypted backups, journaled restore/migration, business workflows, exports and production deployment remain future phases. No schema upgrade is applied to existing data. Until backup/recovery is implemented, use synthetic preview data only.
