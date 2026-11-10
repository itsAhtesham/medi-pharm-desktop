# Test the desktop preview on Windows

Use made-up pharmacy/account details. Owner access and pharmacy settings are implemented; business workflows and encrypted backups are still pending.

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

For service-crash/missing-database tests use the automated temporary profiles, not a profile you want to preserve. Interrupted setup currently enters recovery rather than automatically resuming. Backup and restore controls are not yet available. The original raw snapshot and DPAPI smoke checks belong to the historical prototype commit; Windows protected-key verification remains required when the encrypted backup feature is connected.

## Record evidence

Record source commit, executable/installer SHA-256 (`Get-FileHash -Algorithm SHA256 <path>`), OS build, architecture, hardware, commands/results, and failure screenshots. Windows 11 success does not certify Windows 10. Repeat target checks on Windows 10 before closing platform gates. Linux tests cannot certify Windows ACLs, DPAPI, native installation, signing, or upgrade behavior.
