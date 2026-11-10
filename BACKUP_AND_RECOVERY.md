# Medi Pharm Desktop backup and recovery

Provide portable encrypted backups to a directory on the computer and, optionally, an external hard drive or USB drive. Backups run inside the application and require no internet. A backup must be restorable on a replacement Windows 10 or 11 computer without the original computer's OS key store.

This document defines the target design. The 11 November 2026 development slice implements portable archives, local/external copies, scheduling, key/passphrase rotation, restore preview, safety backups and journaled replacement. See [usage](docs/BACKUP_USAGE.md) and [verification](docs/verification/BACKUP_AND_RECOVERY.md). Full Windows, scale and migration release gates remain open.

The current format is one bounded encrypted manifest/database frame, capped at 64 MiB. Current snapshot jobs briefly pause business commands through maintenance mode; concurrent writing and streaming are later scale improvements. It accepts no archive-supplied filenames or compression. The scheduler checks after login/resume and every five minutes while signed in and the backup key is unlocked. Retention keeps 14 daily and 8 weekly archives per dataset and pins safety copies; old live generations are retained. Future pre-migration retention and an owner acceptance/cleanup flow are not yet enabled. Backup history is bounded to 1,000 registered entries, with ordinary obsolete history pruned; reaching the limit with retained/pinned entries blocks new jobs without deleting archives.

New-device restore initially keeps the recovered key in memory. After restarting, unlock backups and choose OS protection to remember it on the new computer. Existing restores preserve that device's backup configuration. Keys never cross the renderer API. Actual DPAPI and removable-filesystem behavior still require Windows testing.

## Backup destinations and behavior

| Destination | Purpose | Default behavior |
| --- | --- | --- |
| Local application backup directory | Quick recovery from accidental changes or a failed update | Enabled during setup; daily while the app is running |
| Selected external drive directory | Recovery when the computer or internal disk is lost | Optional destination; copy the newest verified snapshot when connected |
| Temporary private staging | Create and verify a snapshot before publication | Internal implementation directory; never shown as a completed backup |

The same-disk backup does not protect against failure of that disk. Show the local and external last-success timestamps independently so local success cannot imply external protection.

Use the OS folder picker to configure destinations. Preserve an application-created destination identifier and, where available, volume identity plus relative folder path. A Windows drive letter or Linux development mount path can change; reselect and verify the same destination instead of writing silently to a different drive. Reject a destination inside the live data or job-staging directory.

## Scheduling and retention

Proposed initial defaults:

- Check backup eligibility after successful login and on resume from sleep.
- Create a local snapshot when no successful backup exists for the current pharmacy day, or the elapsed backup interval has expired, and there are changes since the prior snapshot. Offer a manual forced snapshot even if unchanged.
- While the app remains open, check periodically so crossing a day boundary does not require restart. Use Asia/Kolkata for the displayed business date and UTC timestamps for job history.
- When the external destination becomes available, copy the latest completed archive. If newer data now needs protection, create a fresh snapshot first.
- Keep 14 daily and 8 weekly completed archives per destination, plus the latest 3 pre-migration snapshots. Pin a pre-restore safety backup until the restore is accepted.
- Run retention only after a new backup at that destination has completed and verified. Never delete the only known-good backup to make room for an attempt.

Only one backup job runs at a time. Deduplicate startup, timer, and drive-check triggers. A persistent job record captures pending/failed work; it does not claim a scheduler runs when the app is closed. If the computer was off, the next launch catches up. Do not rely on shutdown hooks to create the day's only backup.

There is no guarantee of zero loss between snapshots. With daily backups, recovery can lose changes since the latest successful snapshot; if external backups are less frequent, a disk failure can lose more. Show the actual timestamp instead of promising a fixed recovery point that disconnected media cannot meet.

## Archive contents

Use a versioned `.mpbackup` file. Example: `medi-pharm-2026-11-08-1800-a1b2c3.mpbackup`.

The encrypted payload contains a consistent SQLite snapshot and a manifest with:

- Archive format version and backup UUID.
- Dataset UUID, source app version, and database migration version/checksum.
- Snapshot start/completion timestamps and the data revision read from the completed snapshot.
- File names, byte sizes, SHA-256 checksums, and selected record counts.
- Source platform for diagnostics only; it does not restrict restoration to that platform.

The current business baseline has no attachments. If attachments are added later, extend the format and snapshot boundary to include every referenced file consistently before calling an archive a full backup.

Do not include Chromium cache, logs, machine-specific paths, an OS-protected secret-store blob, temporary files, or live app sessions. Local owner credential hashes and business audit history remain in the database snapshot. CSV exports are a separate reporting feature and cannot replace a full backup.

The unencrypted header contains only what is required to identify the format and decrypt it: bounded format/KDF fields, salt, key-envelope metadata, nonces, authentication tags, and lengths. Keep customer records and pharmacy-identifying metadata inside the encrypted payload.

## Consistent backup sequence

1. Resolve a registered destination, create a job UUID, and validate permissions and available space. Record the attempt separately from business data.
2. Use SQLite's online backup facility, through the driver's backup API, to produce a standalone snapshot in a private staging directory. Do not copy the live `.sqlite` file while writes may be in its WAL. SQLite supports live database snapshots through this facility. [SQLite backup API](https://www.sqlite.org/backup.html)
3. Complete and close the snapshot writer. Open the snapshot for verification; check its identity, schema, integrity, foreign keys, and required business relationships. Read counts and revision from this snapshot rather than the moving live database.
4. Write the manifest and build the bounded archive payload. Encrypt it into a uniquely named `.partial` file in the final destination directory.
5. Flush and close the output. Read it back, verify authenticated decryption and payload checksums, then rename it to its final name. A partial file must never appear in the completed-backup list.
6. Record success for that destination and apply its retention policy. Preserve older copies until this succeeds.
7. If configured and connected, copy the finished encrypted archive to a temporary file on the external destination, verify the copy, then publish it there. External success is recorded independently.
8. Remove only this job's temporary artifacts. If the app crashed, next launch cleans recognized abandoned jobs after checking that recovery does not need them.

Writes may continue during ordinary snapshot creation. The snapshot is internally consistent, but do not label the click time as its exact data cutoff; record completion and the revision actually captured. The better-sqlite3 backup interface allows incremental progress and continued database use. [Driver backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

File flush/rename behavior must be tested on supported filesystems, including the client's external drive. Power loss can still damage a device; successful verification means the archive was readable at verification time, not that storage hardware cannot fail later.

## Encryption and portable recovery

Use standard cryptographic library primitives, with a versioned envelope format and independent tests. Proposed design:

1. Generate a random 256-bit backup master key during backup setup.
2. Ask the owner for a dedicated backup passphrase and confirmation. Derive a wrapping key using scrypt with a random salt and explicit, benchmarked parameters.
3. Encrypt/wrap the master key with authenticated encryption. Include this passphrase-protected key envelope in each archive.
4. Protect a second local copy of the master key with the OS credential store, allowing scheduled backups without repeatedly asking for the passphrase.
5. Encrypt each archive with AES-256-GCM, using a fresh random nonce for every encryption. Authenticate the format header as associated data. Do not reuse a key/nonce pair.
6. On another computer, derive the wrapping key from the owner-entered passphrase, unwrap the master key, authenticate/decrypt the archive, and establish new local OS protection after a successful restore.

Cap KDF parameters and archive sizes before processing untrusted headers. Reject malformed input and wrong authentication tags before using any extracted database. Do not stream unauthenticated plaintext into the live data directory. The implementation uses established primitives from [Node.js crypto](https://nodejs.org/api/crypto.html); the envelope and operational behavior above are project design choices requiring review and tests.

Use the supported asynchronous Electron `safeStorage` API for OS protection in the pinned Electron version. Windows uses DPAPI; these local protections do not provide portable recovery by themselves. On Linux development machines, detect an unavailable/unprotected key-store backend and require an interactive in-memory key rather than silently treating it as protected. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

Changing the backup passphrase changes future archive envelopes; existing backups still need their original passphrase unless explicitly re-encrypted. Rotating a compromised master key is a separate operation. Changing the app login password does not change backup encryption.

If the original computer and its protected key are gone, and the archive passphrase is lost, that archive cannot be recovered. The owner must store the passphrase separately and demonstrate a restore before using the system for real records. Never tie the only decryption route to the original Windows user account.

## Restore workflow

Restoring replaces the selected local dataset with the snapshot; it does not merge later records. A restore on a fresh computer also requires the restored owner login or the separate owner recovery code before normal access.

1. The owner chooses a backup through a native dialog. Existing installations require owner authentication; fresh installations expose restore from first-run setup.
2. Parse a bounded header and authenticate/decrypt into a restricted staging directory. Do not trust filenames supplied by an archive: reject absolute paths, traversal, symbolic links, unknown required entries, and unreasonable expanded sizes.
3. Check format compatibility, dataset identity, schema version, checksums, database integrity, foreign keys, and business invariants. Reject newer unsupported schemas. Migrate a supported older snapshot in staging before touching live data.
4. Display the pharmacy identity, captured date/revision, representative counts, and the fact that later local changes will be replaced. If the dataset differs, make that explicit. Require a deliberate restore confirmation.
5. Enter application maintenance mode. Stop new business commands, finish active transactions, and create a verified safety backup of the current dataset. If this fails, abort normal restore. Recovery from an already damaged database uses a separate explicit salvage path that preserves the original files.
6. Close all database handles, including verification readers, and complete/close the old WAL state. Create a flushed restore journal recording the old data path, staged new data path, identities, verification results, and current replacement phase.
7. On the same internal filesystem, move the existing `data/live` directory to this job's recovery directory, then move the prepared new directory into `data/live`. Track each phase in the journal; do not assume two directory renames form one atomic operation.
8. Open the replacement, apply the required runtime pragmas, verify health, and clear sessions and renderer caches. Retain the old directory until acceptance. On startup after interruption, resolve the journal to a verified old or new generation before allowing writes.
9. Preserve this device's paths/preferences, generate a new local installation identity on a replacement computer, and recreate local key protection. Do not restore another computer's successful-job history as this device's history. Reconfirm external destinations.
10. Require owner login/recovery, record the restore in local operations history and business audit where appropriate, create a new verified backup, and confirm representative records.

Foreign-key checks are separate from SQLite's integrity check. Use both, then validate domain relationships that SQL checks do not express. [SQLite verification pragmas](https://www.sqlite.org/pragma.html#pragma_integrity_check)

## Failure behavior

| Failure | Required response |
| --- | --- |
| External drive unavailable | Keep local status accurate; show external backup pending with its last success |
| Drive unplugged during write | Keep earlier completed archives; mark this attempt failed; partial file is not restorable |
| Disk full | Stop cleanly and report required space; do not delete the last good backup automatically |
| Key store unavailable | Request the backup passphrase or pause backup; never fall back silently to plaintext |
| Wrong passphrase or altered archive | Reject without replacing live files |
| Database integrity/relationship failure | Quarantine candidate and preserve current data |
| App killed during backup | Discard or verify the incomplete job on restart; do not manufacture a success timestamp |
| App killed during restore | Recover from the journal and verified directories before opening normal workflows |
| Unsupported database version | Explain which application version is needed; do not attempt a blind downgrade |
| Backup copied to another OS | Use the portable key envelope; recreate paths and OS protection locally |

## Recovery acceptance and handover

Use synthetic records to rehearse local restore, external-drive restore, Windows 10-to-11 restore, Windows 11-to-10 restore, and recovery on a fresh OS account with the original key store unavailable. Verify selected customer histories, supply dates, cancellation state, owner access, audit events, and record counts.

Inject interruption before and after each restore replacement phase. Include wrong passphrase, invalid tag, truncated file, missing archive entry, excessive size, unplugged media, read-only destination, and insufficient-space tests. Verify that failed migration/restore cannot silently initialize an empty database.

The handover includes the installer, a verified archive, the separately held backup passphrase, owner access/recovery instructions, and a successful fresh-device rehearsal. Backup status is complete only after a usable artifact exists; a restore test is the evidence that the recovery process works.
