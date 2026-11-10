# Storage reliability and encrypted recovery verification

Implementation follows `c2431ec`, tested 11 November 2026 on Linux x64 with Node 24.15.0, pnpm 10.33.4 and the repository's pinned Electron/native SQLite toolchain. The commit introducing this file identifies the source under test. This is development evidence; Windows 10/11 gates remain open.

## Storage and account infrastructure

- Shared immediate-transaction runner: owner authorization, canonical payload digest, request receipt replay, synchronous mutation, validated result, audit, revision and receipt commit. Purchase number allocation fails outside a transaction and rolls back with it.
- Exact integer-thousandth quantity parsing and real calendar-date arithmetic. Asia/Kolkata day calculation is independent of the OS timezone.
- One authoritative reviewed SQL schema. Startup compares the ledger and actual tables/indexes/triggers with the immutable initial migration. Drizzle is deferred; no schema-push or competing ORM-generated DDL is introduced.
- Health checks include identity, integrity, FKs, owner/KDF bounds, supply/follow-up correspondence and implemented date/run-out invariants. Further business invariants belong to the upcoming workflows.
- Setup creates a private complete candidate, then a durable prepared journal. Recovery runs before creating/opening the live directory. An interrupted prepared setup finishes as a locked account; an unprepared setup can be attempted again. Legacy partial initialization claims remain recovery conditions.

## Archive and key behavior

Archive framing: eight ASCII magic bytes `MPBACK01`, four-byte big-endian JSON-header length, bounded header, AES-256-GCM ciphertext, 16-byte authentication tag. Header limit: 4 KiB; encrypted manifest limit: 8 KiB; whole file limit: 64 MiB. The payload is a four-byte manifest length, manifest JSON, and exactly one SQLite snapshot. There are no archive entry paths or decompression operations.

The public header contains only format/envelope metadata, fixed bounded scrypt parameters, salts, nonces, wrapped master key, wrapping tag and payload length. The entire prefix/header is authenticated as GCM associated data. Identifying metadata, snapshot counts and SHA-256 are encrypted. Each key envelope uses a fresh 16-byte salt and 12-byte nonce; every archive uses a fresh 12-byte nonce. KDF: scrypt N=32768/r=8/p=3 with a 64 MiB work-memory ceiling. Master keys are random 32-byte values. Ciphertext is fully authenticated before plaintext is parsed or staged.

The local key configuration includes an HMAC proof derived with a separate HKDF context, binding the portable envelope to its master key. OS-key unlock verifies that proof before any automatic archive can be produced; structurally valid envelope corruption is rejected. A successful passphrase unwrap can upgrade legacy proof metadata. This prevents local encryption success from hiding a broken portable key envelope.

The service owns portable envelopes and in-memory keys. Only main handles Electron safeStorage and native dialogs; key-bearing internal responses are stripped before returning to preload. Unavailable/unprotected storage never persists a plaintext key. Password/key rotation verifies the old backup passphrase; future archives adopt the new envelope/key while old archives remain independently decryptable with their original passphrases.

Snapshots use SQLite's backup facility, are converted to standalone DELETE journal mode, checked, and counted after completion. Jobs estimate required space and reject oversized data. `.partial` files are flushed, read back, authenticated and checksum-verified before same-directory publication. Device history records success afterwards. Failed local jobs retain prior archives; external failures remain independently pending.

The serialized service and main maintenance state prevent overlapping jobs. Eligibility runs after login, resume and five-minute checks while signed in with an unlocked key. Unchanged data is skipped unless forced or its key envelope changed. Destination markers prevent silently using a different folder/drive. Retention preserves 14 daily/8 weekly archives per dataset and all safety copies; only tracked files are candidates for deletion, after new success at that destination.

## Restore and interruption behavior

A native selection is decrypted and staged; its manifest is compared with the verified SQLite data. The renderer receives only a preview token and summary, not a filename or key. Restore rechecks authorization, token lifetime, dataset and revision before replacement. Healthy installations require a verified safety archive. Damaged installations require explicit salvage confirmation and preserve original files without claiming a healthy safety archive.

The prepared journal records a UUID-derived job, expected dataset and snapshot hash. Paths are derived internally. Recovery determines the replacement boundary from the staged/live/retained directories and verifies the expected generation before proceeding. It handles interruptions before either rename, after moving the old directory, after moving the new directory and after marker publication. Ambiguous/damaged candidates stop recovery; retained generations are never automatically deleted. The marker is retained with the old directory. Sessions and drafts are invalidated for replacement, including uncertain responses.

New-profile restore needs no original device key. Device identity, destinations and local success history are not imported. Existing device backup configuration stays in place. Fresh restore adopts the archive envelope in memory; interactive unlock can establish new local OS protection after restart. A new post-restore backup is attempted separately and its success/failure is reported separately from replacement.

## Checks

- `pnpm check`: lint, formatting, three TypeScript configurations and 53 unit/integration/recovery tests passed.
- `pnpm package`: Linux x64 packaged preview builds with native SQLite in the utility process.
- The file-backed suite covers portable decryption, wrong passphrase, ciphertext/tag tampering, altered local key envelopes, truncation, oversized KDF fields, trailing bytes, bounded reads, snapshot revision/counts, session guards, unchanged scheduling, changed destination identity, failed local publication, failed safety backup, fresh restore, stale previews, explicit damaged-data salvage, passphrase/master-key rotation, retention and original-generation preservation.
- Journal boundary fixtures exercise prepared, old-moved, new-moved, marker-written and damaged-candidate states, plus interrupted first setup. They use actual files/directories, not production reset/fault hooks.
- Packaged desktop coverage includes the existing owner/lifecycle/security tests plus backup/restore, fresh-profile portable recovery, wrong archive passphrase, and unavailable OS key protection. `pnpm test:desktop`: all 15 packaged journeys passed with Chromium sandbox enabled, including explicit damaged-data salvage, the persistent post-restore backup message, and external-folder reselection verifying a fresh copy after the previous external archive was removed. The harness verifies its temporary runtime path before any fixture mutation. The rendered backup/restore preview was visually inspected.

## Open release gates

Windows native packaging/DPAPI, fresh Windows account recovery, removable-drive/filesystem flush behavior, real unplug/full-disk/power-loss exercises, minimum-hardware KDF calibration, load testing and independent archive-format security review remain pending. Linux directory fsync and boundary tests cannot certify Windows or hardware power-loss guarantees.

This preview buffers bounded archives in memory; streaming larger datasets is a release-scale task. History is capped at 1,000 entries; retained/pinned copies can require deliberate maintenance. Old live generations and safety archives are retained until an acceptance/cleanup workflow is added. Only schema version 1 is supported: no invented upgrade is run, and future-schema migrations stay disabled until an actual immutable migration and its backup/rollback rehearsal exist. Business screens remain placeholders.
