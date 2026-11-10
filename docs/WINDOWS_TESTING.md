# Test the prototype on the Windows 11 laptop

This is a synthetic platform prototype. Use made-up notes only; pharmacy workflows and encrypted backups have not been implemented.

## Prepare the native build

1. In Settings → System → About, record Windows version/build, System type, processor, and RAM. The current build configuration assumes x64; do not treat an ARM64 device as a verified x64 target.
2. Install Node.js 24.15.0 and pnpm 10.33.4. Install pnpm with `npm install --global pnpm@10.33.4` if it is not available.
3. Copy/clone this source directory, including `pnpm-lock.yaml`. Exclude `node_modules`, `.vite`, `out`, test outputs, and all prototype databases. The sibling web repository is not needed to build this application.
4. Open PowerShell in the project directory and run:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
pnpm package
pnpm test:desktop
pnpm make:windows
```

Build-time downloads need internet. If a native dependency requires compilation instead of using its prebuilt binary, install the supported Python and Visual Studio C++ build tools and rerun the build. Do not copy Linux native modules.

The packaged executable is `out\MediPharm Prototype-win32-x64\medipharm-prototype.exe`. The Squirrel installer is produced under `out\make\squirrel.windows\x64\` as `MediPharm-Prototype-Setup.exe`. It is an unsigned test artifact; production signing is a later release task. If an organizational policy blocks it, record the blocker rather than changing the policy.

## Manual acceptance checks

Disconnect the network after building. Run the native artifact and record each result:

- The interface opens without a development server or internet and shows connected SQLite storage.
- Save a unique sample note, close the app, reopen, and confirm the note/count survive.
- Launch a second copy while it is open. The existing window is focused; another database owner is not created.
- Create a test snapshot, add another sample, then verify the restored copy. It reports the snapshot's count and keeps the newer live sample.
- Run the protected-key-storage check. On Windows this exercises DPAPI. Record whether it succeeds.
- Open the native folder picker, select a folder, then repeat and cancel. Neither action should write files in the selected folder.
- Close the last window and confirm no prototype/service process remains in Task Manager. Minimizing should keep it running.
- Check keyboard navigation and display scaling on the laptop.
- Install the unsigned prototype where permitted, repeat the persistence test, and record installer behavior separately from running the unpacked executable.

Prototype data is stored at `%LOCALAPPDATA%\MediPharm Prototype\`; runtime files are separate from `data\prototype.sqlite`. Keep the folder while checking reopen/reinstall behavior. The app does not start with Windows or keep a tray service alive.

## Report evidence

Record source revision (or an archive hash until the first commit), package SHA-256, OS build, architecture, hardware, commands/results, and screenshots of failures. PowerShell's `Get-FileHash -Algorithm SHA256 <path>` can identify the tested executable/installer.

Windows 11 success does not certify Windows 10. Repeat the native/offline checks on Windows 10 before marking phase 00 or final release compatibility complete. Production upgrade, recovery, and uninstall preservation checks remain in later phases.
