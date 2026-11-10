# Platform decisions — 10 November 2026

## Confirmed with the user

- Implement this desktop application entirely from scratch. Refer to the sibling web project only for business requirements.
- Preserve the documented business baseline without changes.
- Release for Windows 10 and Windows 11 only. macOS is out of scope.
- Develop on Linux. A Windows 11 laptop is available for manual native testing.
- Keep the single-computer, local-data, offline design. The initial dataset is empty.

Retain the existing proposed defaults: one local owner account, a separate offline login recovery code, daily backups while the app is running, 14 daily and 8 weekly retained copies, optional external storage, and a separate owner-held backup passphrase. Live SQLite is protected by OS access controls; encrypted backups do not mean the live database is encrypted. Owner access and a separate login recovery code are now implemented in the development preview; backup/key-custody behavior remains pending.

## Initial implementation decisions

The working CPU target is Windows x64, pending confirmation of the laptop's architecture. Record its Windows build, CPU, RAM, storage, and display before claiming a platform gate. A separate Windows 10 environment is still needed.

The historical first artifact was named **MediPharm Prototype** with internal ID `com.fructum.medipharm.prototype`, executable `medipharm-prototype`, and separate prototype data directories. It contains synthetic records only. The current account/storage preview is **MediPharm Desktop Preview**, ID `com.fructum.medipharm.preview`, executable `medipharm-preview`, with a separate `MediPharm Desktop Preview` Windows profile and `medi-pharm-desktop-preview` Linux profile. It never imports the historical prototype dataset. Final product/publisher identity and signing ownership remain pending; this prototype must not silently become a production data identity.

| Component | Pinned version |
| --- | --- |
| Development Node.js | 24.15.0 |
| pnpm | 10.33.4 |
| Electron | 45.2.3 |
| Electron Forge | 8.0.1 |
| Vite | 8.3.7 |
| React / React DOM | 19.3.1 |
| TypeScript | 6.0.3 |
| better-sqlite3 | 13.0.3 |
| Zod | 4.6.7 |
| Vitest | 5.1.0 |
| Playwright | 1.65.0 |

The foundation pins TypeScript 6.0.3 because typescript-eslint 8.72.2 supports versions below 6.1; the initial prototype used 7.0.2. ESLint 10.14.0 and Prettier 3.9.10 enforce the checked-in source conventions. Separate renderer and desktop TypeScript configurations keep Node globals out of renderer code.

Exact dependency resolution is in `pnpm-lock.yaml`. Forge 8 emits CommonJS main/preload/service bundles with `.cjs` filenames. Electron 45's npm package provides an explicit `install-electron` command; the project runs it on installation. Native SQLite stays external to the JavaScript service bundle and its native binaries are unpacked from ASAR. The 13.x driver uses Node-API prebuilds; validate the actual installed binary on each OS rather than assuming Linux execution proves Windows support.

The original service owned the sample SQLite database; it now owns the preview pharmacy database with owner authentication and a migration ledger. The legacy storage tests remain isolated. It uses WAL, FULL synchronization, foreign keys, and bounded busy waits. Snapshot tests use the SQLite backup API, convert the closed snapshot to DELETE journal mode, and open a separate restored copy. This proves storage primitives only; it does not implement the future encrypted backup, retention, journaled live restore, or pharmacy migration system.

The current UI uses small local CSS files and system fonts. Owner-access screens and initial SQL schema are implemented. Drizzle business mappings and further workflow UI remain pending; no Tailwind/shadcn adoption is required for this slice. No web implementation files have been copied.

## Pending decisions and gates

- Exact Windows builds, laptop architecture, hardware budgets, and Windows 10 test access.
- Production product/publisher identity and signing arrangements.
- Native Windows package, SQLite loading, DPAPI round trip, real dialogs, and process cleanup.
- Windows owner-access/recovery verification, KDF calibration, and backup passphrase custody workflows in their planned phases.

These do not prevent continuing independent Linux development. They prevent marking the corresponding Windows acceptance checks complete.

## Toolchain references

The implementation follows the [Forge Vite configuration](https://www.electronforge.io/config/plugins/vite), [native unpacking guidance](https://www.electronforge.io/config/plugins/auto-unpack-natives), [Electron utility process API](https://www.electronjs.org/docs/latest/api/utility-process), and [asynchronous protected storage API](https://www.electronjs.org/docs/latest/api/safe-storage). Installed package types and source were checked for the pinned versions rather than relying solely on current documentation examples.
