# Test the desktop preview on Windows

Use made-up pharmacy/account details. Owner access, pharmacy settings, encrypted backups and journaled restore are implemented. Customer, medicine, purchase/supply and follow-up workflows are implemented for preview testing. Windows release gates remain pending.

## Prepare the native build

1. In Settings → System → About, record Windows version/build, System type, processor, RAM, and display scaling. The current configuration assumes x64; an ARM64 laptop is not a verified x64 target.
2. Install Node.js 24.15.0 and pnpm 10.33.4 (`npm install --global pnpm@10.33.4`).
3. Copy/clone the repository including `pnpm-lock.yaml`. Exclude `node_modules`, `.vite`, `out`, test outputs, and local data profiles. The sibling web repository is not required.
4. Run in PowerShell:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
pnpm package
pnpm test:desktop
pnpm make:windows
```

Build-time downloads need internet. If native compilation is required, install compatible Python and Visual Studio C++ build tools. Do not copy Linux native modules.

Executable: `out\MediPharm Desktop Preview-win32-x64\medipharm-preview.exe`.
Unsigned installer: `out\make\squirrel.windows\x64\MediPharm-Preview-Setup.exe`.
Signing and production installer validation remain future work.

## Offline walkthrough

Disconnect networking after building, then check:

- First launch offers explicit pharmacy setup. Choose a pharmacy name, owner identifier and 12–128-character password. Save the generated recovery code separately and acknowledge it before creating the account.
- Setup returns to login. Sign in and verify all business counts are zero.
- Open Settings, rename the pharmacy, save, close and reopen. Login is required and the saved name survives.
- Type a settings draft, lock the workspace, then sign in. The draft is preserved. Try closing with a draft and choose Keep editing.
- Change the password. The app locks; the new password works and the previous one fails.
- Use Forgot password with the saved recovery code. Save the replacement code. The old code must no longer work after successful recovery.
- Try five incorrect logins. Further login/recovery attempts are temporarily throttled even after restarting the app. Wait at least 30 seconds before retrying. Further failures increase the delay, up to 15 minutes.
- Launch a second copy. It focuses the existing window. Close the last window and confirm no preview/storage process remains in Task Manager.
- Export diagnostics to a new filename, then attempt to overwrite it. Existing files must be preserved. Reports contain event names/times, not credentials or pharmacy details.
- Check keyboard navigation, setup/recovery form scrolling, screen scaling, startup speed and password-check responsiveness.
- Install the unsigned preview where permitted and repeat the persistence test. Record installed-artifact results separately.

Preview data: `%LOCALAPPDATA%\MediPharm Desktop Preview\`. SQLite lives at `data\live\medipharm.sqlite`; installation identity at `settings\installation.json`; Chromium files at `runtime\`. Old `MediPharm Prototype` data is not imported. Preserve the whole preview profile for reopen/reinstall checks. There is no tray process or Windows-startup service.

## Backup and recovery acceptance

Follow [the detailed walkthrough](BACKUP_USAGE.md) with synthetic data:

- Configure a separate backup passphrase, select OS protection, create an archive and check its local verified timestamp. Close/reopen, sign in and confirm the protected key unlocks without re-entering the backup passphrase. This is the DPAPI test; Linux execution does not prove it.
- Repeat with Remember securely disabled. After restart, backup creation must remain disabled until the passphrase is entered. An unavailable key store must never persist a plaintext key.
- Register an external folder, verify independent success, disconnect it, change the pharmacy name and create another archive. Local success must remain visible with external pending. Reconnect/reselect the original folder and verify the copy. Test changed drive letters without placing files on a different drive.
- Restore an earlier archive, inspect the preview, cancel once, then explicitly confirm. Verify restored pharmacy name, required owner login, retained original files and a pinned safety archive. A wrong passphrase, altered or truncated archive must not replace local data.
- Restore on a second Windows profile/computer using only the archive/passphrase and restored owner credentials. Reconfigure external storage and verify new local key protection after an interactive unlock on that computer.
- Change the backup passphrase and optionally rotate the master key. A new archive must verify with the new passphrase; a separately preserved older archive must still need the old passphrase.
- In isolated disposable profiles, exercise missing/corrupt data recovery and process termination around replacement. Recovery must preserve old files and either open a verified generation or remain blocked. Never use a wanted pharmacy profile for fault tests.
- Exercise insufficient space, read-only destinations and drive unplugging on disposable media. Check that earlier completed archives survive and `.partial` files never become completed success entries.

The preview caps archives at 64 MiB and checks eligibility while signed in. Retention keeps 14 daily/8 weekly copies; safety archives and old live generations stay retained. New setup resumes a prepared journal; a legacy partial claim or damaged candidate requires explicit recovery. Unsupported database schemas are rejected, not silently upgraded.

## Record evidence

Record source commit, executable/installer SHA-256 (`Get-FileHash -Algorithm SHA256 <path>`), OS build, architecture, hardware, commands/results, and failure screenshots. Windows 11 success does not certify Windows 10. Repeat target checks on Windows 10 before closing platform gates. Linux tests cannot certify Windows ACLs, DPAPI, native installation, signing, or upgrade behavior.

## Business workflow rehearsal

Follow [the workflow walkthrough](BUSINESS_WORKFLOWS.md) using synthetic records. On Windows 11 and Windows 10, verify:

1. Create/search/edit/archive/restore customers and medicines. Shared family phone numbers are allowed; normalized duplicate medicines are refused, including archived matches.
2. Create a customer and medicine inline from a purchase without losing notes. Enter exact fractional quantities, multiple units and independent days/reminder choices for two medicines.
3. Rehearse extend versus replace and explicit zero remaining; review date calculations. Correct an earlier purchase and cancel a latest refill, verifying the resulting chain and history.
4. Record contact and schedule another date, close/reopen a cycle, and verify a cancellation restores the preceding contact/schedule/closure state.
5. Lock/unlock with a draft, verify unsaved-close confirmation, restart the app and find the saved customer/purchase histories.
6. Back up the populated database, restore it into a fresh Windows profile, and verify purchase counts, dated labels, follow-up state and history.
7. Use keyboard-only controls and Windows date inputs; inspect scrolling/focus at the laptop's normal display scaling. Record any Windows-specific differences rather than treating Linux UI tests as certification.

## Supply report and CSV checks

- Open Customers → View current supplies. Verify multiple units for one medicine produce one report row. Rehearse a future-starting refill: current coverage must still reflect the last supply that has started; the future start and latest recorded run-out appear separately. Cancel the latest purchase and confirm the earlier coverage/reminder returns.
- Export customers, medicines, purchase items, follow-up cycles and contact history from Settings. From lists, apply a search/status filter and confirm every matching page is exported. Check optional blanks, shared phones, exact fractional quantities, archived records and cancelled purchases.
- Open the CSV in the spreadsheet application used on the laptop. Verify UTF-8 names, commas, quotes and embedded line breaks. Use synthetic formula-prefixed names/notes such as `=1+1` and confirm they remain text. Formula-prefixed cells intentionally receive a leading apostrophe. Import phone columns as text to preserve leading zeros and formatting.
- Rehearse native save cancellation, explicit overwrite of a disposable CSV, a CSV open/locked in Excel, a read-only destination, a disconnected removable drive and a full test volume. A failure before publication must preserve an existing destination. Interrupted external writes can leave a `.medipharm-export-*.partial` file; it is not a completed report.
- Confirm CSV exports cannot target the application’s own data directory. CSVs are unencrypted portability reports and do not replace encrypted backups. Verify the destination and its access permissions before using real data.

Linux verification does not certify Windows rename/locking, save-dialog overwrite confirmation, removable-drive flush behavior or spreadsheet import behavior. Record those results on the actual Windows 11 laptop and Windows 10 test system.


## Dashboard and desktop layout

Use the [interface guide](UI_DESIGN.md) for count definitions. On both Windows targets:

- At 1366×768 and 1920×1080, check 100%, 125% and 150% Windows display scaling. Verify native title controls, menu navigation, visible keyboard focus, sidebar toggle, table scrolling and access to form save/discard buttons. Linux Electron zoom tests are supporting evidence, not native DPI certification.
- Start empty, create a customer and medicine through dashboard quick actions, and record a purchase. Confirm saved counts and the seven-day count chart. Cancel a purchase and confirm it disappears from active counts.
- Create due and future reminders, including two medicines for one customer. Compare cycle counts with distinct customer counts. Check the customer link opens the correct supply report and View all opens the matching follow-up view.
- Record a future-starting refill while current coverage ends within five days. Verify current coverage remains in Ending soon; closing a reminder must not remove its supply coverage.
- Open a draft from a shortcut, lock/sign in, and confirm the draft survives. Other navigation must remain disabled until save/discard.
- Create a backup from the dashboard after configuration and verify the status bar timestamp. With backups locked/unconfigured, the same shortcut must open Settings. Rehearse external-copy pending status.
- Verify the Reports tab still exposes purchase details/history and filtered CSV exports, and that keyboard entry works in the denser purchase form.
