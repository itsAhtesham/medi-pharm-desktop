# Back up and recover the development preview

Use synthetic pharmacy data until business workflows and Windows release checks are complete. These controls are available in Settings → Open backups & restore, or the Backups & restore sidebar shortcut. Backups and CSV exports have separate views.

## Create and verify backups

1. Choose a dedicated backup passphrase of 15–128 characters. It is separate from your login password and login recovery code. Save it somewhere private away from the computer, then confirm that you saved it.
2. Optionally select Remember securely. Windows uses Electron's DPAPI-backed protection. If protected storage is unavailable (including an unprotected Linux backend), the key remains in memory for this app session; no plaintext key is persisted.
3. Select Create encrypted backup. Wait for the verified local success timestamp. Open local backup folder opens only this app's backup directory.
4. Optionally choose a folder on an external drive. The app registers that folder with a destination marker and copies/verifies the archive there. Local and external last-success timestamps are independent. A disconnected or changed destination leaves external protection pending.
5. After reconnecting a drive with a changed letter/path, reselect the original folder. Its registered marker identifies it, and reselection creates and verifies a fresh archive copy. The app does not guess a replacement drive or recreate a missing destination.

Eligibility is checked after login, after resume and every five minutes while the owner is signed in. A daily archive is due when no verified archive exists, or data changed and the pharmacy day changed / 24 hours elapsed. Unlock the backup key after restart if OS protection is not available. Manual backup can run even if data is unchanged. The app does not run a backup service after closing.

Retention keeps the newest archive for each of 14 days and 8 weeks per dataset. Safety archives remain pinned. Retention runs only after a new archive is verified at that destination. The preview supports archives up to 64 MiB and performs a free-space preflight; it does not delete older good backups to make an attempt succeed.

## Restore on this computer

1. Sign in. Unlock/configure backups so a verified safety archive of the current pharmacy can be created.
2. Enter the selected archive's backup passphrase and choose a `.mpbackup` file with the native dialog.
3. Review the pharmacy name, captured date, revision and counts. A different pharmacy dataset is explicitly identified. Local edits after the preview invalidate it; previews expire after ten minutes.
4. Type `RESTORE`, select Restore this pharmacy, and confirm the native replacement prompt. Unsaved drafts and changes later than the archive will be replaced.
5. The app verifies a safety archive, retains the old live directory, publishes the staged dataset through its recovery journal, and clears sessions/drafts. Sign in with the owner credentials captured by the archive. A later password or recovery-code change is also reverted by restoring older data.
6. Verify the pharmacy details. The app attempts a new backup after restore and reports that result separately. Old data remains in `recovery/` and safety archives remain pinned; there is no automatic cleanup of those generations yet.

The current device's destination preferences, key configuration and job history are retained. They are not imported from the backup's source computer. Existing archives retain their original passphrases.

## Restore on a new computer

Build/install the preview for that OS, then use Restore an existing pharmacy on first-run setup. You need the archive, its backup passphrase, and the restored owner password or login recovery code. No original OS key store is required. The new device creates its own identity and job history. Reconfigure the external destination explicitly.

The recovered backup key initially lives in memory. After restarting, sign in and unlock backups with the archive passphrase; select Remember securely if OS protection is available.

## Recover damaged or missing local data

Recovery mode offers archive inspection and explicit recovery. A valid backup is decrypted and checked first. The UI explains that the damaged installation cannot produce a verified safety archive; confirmation preserves its original directory/marker separately before publishing the validated candidate. It never silently initializes an empty pharmacy over those files.

If a prepared replacement was interrupted, startup resolves its journal before permitting normal operations. An invalid candidate or ambiguous set of directories remains blocked with files preserved. Do not delete individual WAL, SHM, database, marker or journal files to bypass that state. Preserve the whole profile and use a separate fresh profile/computer to rehearse recovery if needed.

## Change backup credentials

Expand Change backup passphrase or encryption key. Verify the current passphrase, enter and save the replacement, and optionally rotate the master encryption key. The app then creates a new verified archive. **Older archives still need their original passphrase**; rotation does not rewrite existing files. Login password changes are independent.

If a credential-change response is interrupted, use the new passphrase to unlock and check/create a backup. If a restore response is interrupted, restart storage and inspect the restored pharmacy after login; do not blindly repeat replacement.

Restore verification opens a dedicated **Review restore** view. Check the pharmacy, capture time and counts before typing RESTORE. **Back to backups & restore** (or **Back to restore setup** during recovery) cancels the preview and returns without replacing data. Other section navigation is unavailable during the review; cancel the review first.
