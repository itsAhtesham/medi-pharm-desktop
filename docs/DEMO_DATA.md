# Seed a demo pharmacy

Run these commands from the cloned repository after `pnpm install --frozen-lockfile`, on Linux or Windows PowerShell:

```sh
pnpm seed:demo
pnpm dev:demo
```

The first command creates a separate profile at `.demo-data/pharmacy`. The second launches the development app with that profile using `MEDIPHARM_PREVIEW_HOME`; it does not open the normal installed pharmacy profile. Close other running preview windows before launching the demo.

Sign in with:

- Owner identifier: `demo-owner`
- Password: `Demo pharmacy 123!`

These are public demo credentials, for synthetic data only. The generated recovery code and dataset summary are in `.demo-data/pharmacy/demo-profile.json`. The demo profile and compiled seed tool are excluded from Git; neither is included in the installer.

## Data included

- 50 customers: 47 active and 3 archived, with varied ages and shared synthetic family phone numbers.
- 60 fictitious medicines: 55 active and 5 archived, with different strengths/forms.
- 180 purchases: 170 active and 10 cancelled, spread across roughly 11 months and the most recent fortnight relative to the seed date in Asia/Kolkata.
- Multi-medicine purchases, different units for one medicine, fractional quantities and a customer with over 20 purchases for history pagination.
- INR row amounts, fixed discounts, 10% and 12.5% discounts, 100% discounts and explicit zero amounts. The real application computes and saves paise totals.
- Extend/replace refill chains, enabled/disabled reminders, due/overdue/upcoming reminders, a future-starting supply, contact notes, snoozes and closed cycles.
- A corrected purchase and audit history, created through the normal business services, including preview fingerprints and request receipts.

Names, phone numbers, medicines, amounts and supply durations are synthetic test values. No messages are sent. Due dates naturally age after seeding; create a fresh profile when you want dates relative to today again. Backups start unconfigured so you can test backup setup yourself.

## Create another dataset

Seeding refuses an existing folder, including an empty folder. It never clears or appends to an existing pharmacy. To start again, choose a new path for both commands:

```sh
pnpm seed:demo --profile .demo-data/second-pharmacy
pnpm dev:demo --profile .demo-data/second-pharmacy
```

Use `--help` with either command for usage. A failed seed retains an incomplete profile for inspection; the demo launcher refuses to open it as a completed dataset. Choose another new folder after correcting the cause.

`pnpm dev` continues to use the normal profile when `MEDIPHARM_PREVIEW_HOME` is unset. The demo launcher sets the variable only for its child process, so it does not change your terminal environment.

## Open the seeded profile with a Windows packaged executable

If you want to test the packaged app instead of the development app, build it from the same source with `pnpm package`, close other preview windows, and run in PowerShell:

```powershell
$previousDemoHome = $env:MEDIPHARM_PREVIEW_HOME
try {
  $env:MEDIPHARM_PREVIEW_HOME = (Resolve-Path '.demo-data/pharmacy').Path
  & '.\out\MediPharm Desktop Preview-win32-x64\medipharm-preview.exe'
} finally {
  if ($null -eq $previousDemoHome) {
    Remove-Item Env:\MEDIPHARM_PREVIEW_HOME -ErrorAction SilentlyContinue
  } else {
    $env:MEDIPHARM_PREVIEW_HOME = $previousDemoHome
  }
}
```

Build and seed on the target OS; do not copy Linux `node_modules` to Windows. Seeding uses the checked-out application's schema and validation rules, so use a matching executable. You do not need to copy files into the normal installed data directory.

## Implementation

`src/tools/demo-data.ts` creates the profile through `OwnerService`, `BusinessService` and the normal database initialization path. It closes and independently health-checks the saved database before marking the seed complete. `src/tools/demo-cli.ts` provides the seed/launch commands. `vite.demo.config.mts` builds the Node tool with the existing Vite dependency; no extra runtime is required.
