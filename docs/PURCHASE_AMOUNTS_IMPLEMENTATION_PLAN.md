# Purchase amounts, discounts and Overview value reporting

Status: implementation plan only; no application or database changes made by this document.

Prepared: 20 November 2026. Repository baseline: `2ad0c08`, desktop preview `0.1.3`, database schema version 1.

## 1. Outcome and agreed behavior

Add a manually entered amount to each medicine quantity/unit row, save a purchase-level discount and final total, and expose purchase value in details, exports and Overview. Keep the offline Windows 10/11 application and existing purchase/supply/reminder workflows.

Confirmed requirements:

- Each row reads **Medicine | Quantity | Unit | Amount**.
- Amount is the total for that row before the purchase discount. It is not a unit price and is not multiplied by quantity.
- Show a subtotal, a purchase-level discount above the final total, and the final total amount.
- An **Enter discount as percentage** checkbox switches the discount input between a currency amount and a percentage.
- INR is the default. Users enter and see rupees; persisted INR amounts are integer paise.
- Decimal text is converted directly to paise, without floating-point multiplication. Reject money inputs with more than two decimal places.
- Calculate percentage discounts using integers and round once to the nearest paise, with a half-paise rounded up.
- Preserve old purchases without inventing historical amounts. Display **Amount not recorded** instead of zero.
- Retain the existing purchase-count card/chart and add purchase-value reporting.

Concrete defaults for this implementation:

| Decision             | Planned behavior                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported currency   | INR only in this release; show INR/₹ explicitly, with no currency selector or conversion. Store the currency on each priced purchase.        |
| New purchase amounts | Required on every quantity/unit row. Blank is invalid; an explicit zero is valid.                                                            |
| Discount default     | No discount. Blank or zero normalizes to `none`.                                                                                             |
| Money limit          | `MAX_MONEY_MINOR = 9_999_999_999` paise (₹9,99,99,999.99), for each row and for the entire purchase subtotal. Reject an overflowing sum.     |
| Percentage input     | 0–100%, at most two decimal places; store basis points, where 10% = 1000.                                                                    |
| Legacy corrections   | Allow ordinary corrections while keeping all amounts unknown, or explicitly record amounts for every row. No partially priced purchase.      |
| Overview default     | Last 7 days, including today, grouped daily. A Monthly option shows the current month to date and preceding 11 months.                       |
| Value definition     | Sum of final purchase amounts after discounts, for active purchases by purchase date. This is purchase value, not money collected or profit. |

Unit pricing, automatic quantity × price, taxes/GST, payment methods, paid/outstanding balances, refunds, inventory costing, medicine-level net revenue and multiple-currency operation are outside this change. No new price field belongs on the medicine catalogue.

## 2. Current code and dependencies

| Area                       | Existing code                                                                                                | Required work                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Database schema            | `src/db/migrations/0001.ts`                                                                                  | Add migration 0002; keep 0001 byte-for-byte unchanged.                                                                                    |
| Database opening/setup     | `src/db/pharmacy-database.ts`                                                                                | Create version 2 installations and upgrade verified version 1 installations safely.                                                       |
| Schema/business validation | `src/db/health.ts`, `src/db/business-health.ts`                                                              | Version-aware inspection and monetary consistency checks. Current inspection accepts only version 1 and compares actual DDL against 0001. |
| Durable replacement        | `src/db/replacement.ts`                                                                                      | Extend the existing staged/journaled replacement path for upgrades, preserving recovery of old setup/restore journals.                    |
| Integer helpers            | `src/domain/values.ts`                                                                                       | Keep existing quantity/date helpers; add a separate money module.                                                                         |
| Purchase contracts/service | `src/contracts/business.ts`, `src/application/business-service.ts`                                           | Input validation, authoritative calculation, preview, transactional persistence and read models.                                          |
| Mutation receipts/history  | `src/application/mutations.ts`                                                                               | Preserve request-ID replay, atomic receipts and before/after history when monetary fields are added.                                      |
| Purchase UI                | `src/renderer/business-workspace.tsx`                                                                        | Row amounts, discount controls, totals, corrections, details, history and reset behavior.                                                 |
| CSV                        | `src/contracts/reports.ts`, `src/application/csv-export.ts`, `src/renderer/reports.tsx`                      | Add row amounts and a purchase-summary export with one row per purchase.                                                                  |
| Overview                   | `src/contracts/dashboard.ts`, `src/application/dashboard-service.ts`, `src/renderer/dashboard.tsx`           | Add value card, daily/monthly series and missing-amount coverage counts.                                                                  |
| IPC                        | `src/contracts/desktop.ts`, `src/preload/preload.ts`, `src/main/main.ts`, `src/service/service.ts`           | Propagate new contracts and the selected dashboard value period through all validated boundaries.                                         |
| Backups/restore            | `src/backup/archive.ts`, `src/backup/manager.ts`, `src/contracts/backup.ts`, `src/renderer/backup-panel.tsx` | Read supported old/new manifests, verify before migrating, and restore a verified current-schema candidate.                               |

The application currently has a migration ledger but no supported version-upgrade workflow. Updating the startup validator to simply accept another version is insufficient: snapshot inspection, replacement recovery and archive manifests also depend on schema version/checksum.

## 3. Money model and exact arithmetic

Create `src/domain/money.ts` with pure, shared helpers:

- `parseMoneyMinor(text)`: validate decimal rupee text, split whole/fractional parts, pad the fraction to two digits and construct integer paise.
- `parsePercentBps(text)`: the same exact decimal parsing for a bounded percentage.
- `calculatePurchaseMoney(rows, discount)`: validate every row, sum, apply one purchase-level discount and return canonical totals.
- `formatMoneyMinor(value, currency)` and `formatDecimalMinor(value)`: display currency or produce an exact two-decimal CSV/input value without passing through a floating-point rupee value.

Parsing rules:

1. Trim surrounding whitespace. Accept digits with an optional dot followed by one or two digits, such as `125`, `125.5`, `125.50` and `0.01`.
2. Reject negative values, exponent notation, separators/currency symbols inside the editable value, non-finite values, missing whole digits and more than two decimal places. Use plain decimal text in the input; apply Indian digit grouping only to display text.
3. Empty money inputs remain empty/invalid for new purchases; never silently turn them into zero. An empty discount means no discount.
4. Parse and calculate using `bigint` intermediates. Convert per-purchase results to JavaScript numbers only after checking the configured bound, which is below `Number.MAX_SAFE_INTEGER`.
5. Store SQLite `INTEGER` values, not `REAL`. Do not use `parseFloat(text) * 100`, floating-point percentage multiplication or `toFixed()` to repair calculations.

For nonnegative values:

```text
subtotalMinor = sum(rowAmountMinor)
fixed discount: discountMinor = enteredAmountMinor
percentage discount: discountMinor = (subtotalMinor * percentBps + 5000) / 10000
finalTotalMinor = subtotalMinor - discountMinor
```

The percentage formula uses integer division and rounds only the final purchase discount. Do not round discounts independently per medicine. Reject fixed discounts above the subtotal and percentages above 100; never silently clamp them. Zero-subtotal purchases may only have a zero monetary discount.

Required calculation examples:

| Input                                     | Stored/calculated result                        |
| ----------------------------------------- | ----------------------------------------------- |
| `125.50` rupees                           | `12550` paise                                   |
| `0.10` + `0.20`                           | `30` paise, displayed ₹0.30                     |
| ₹1000 subtotal, 10% discount              | `100000 - 10000 = 90000` paise                  |
| ₹1000 subtotal, ₹125.50 discount          | `100000 - 12550 = 87450` paise                  |
| ₹0.01 subtotal, 50% discount              | Half a paise rounds up: discount `1`, total `0` |
| ₹0.03 subtotal, 50% discount              | Discount `2` paise, total `1` paise             |
| ₹12.50 subtotal, 100% discount            | Total `0`; still a priced purchase              |
| `1.005`, `1e3`, `-1`, or discount 100.01% | Validation error                                |

## 4. Schema version 2

Add `src/db/migrations/0002.ts` and a migration registry with ordered IDs/checksums. Use the same reviewed migration sequence for new installations, upgrades and the expected-schema comparison in health inspection.

### 4.1 New columns

All added columns are nullable to represent pre-existing unpriced purchases. Do not backfill zeros or INR onto unknown monetary records.

| Table            | Column                  | SQLite type  | Meaning                                                                     |
| ---------------- | ----------------------- | ------------ | --------------------------------------------------------------------------- |
| `purchase_items` | `amount_minor`          | INTEGER NULL | Entered line amount before purchase discount.                               |
| `purchases`      | `currency_code`         | TEXT NULL    | `INR` for a priced purchase.                                                |
| `purchases`      | `subtotal_minor`        | INTEGER NULL | Sum of all item amounts.                                                    |
| `purchases`      | `discount_type`         | TEXT NULL    | `none`, `fixed`, or `percentage`.                                           |
| `purchases`      | `discount_percent_bps`  | INTEGER NULL | Percentage in basis points; present only for a nonzero percentage discount. |
| `purchases`      | `discount_amount_minor` | INTEGER NULL | Entered fixed discount or calculated percentage discount.                   |
| `purchases`      | `total_amount_minor`    | INTEGER NULL | Subtotal minus discount.                                                    |

Use additive DDL with explicit checks for column ranges and legal same-row combinations. Preserve existing IDs, foreign keys, indexes, purchase sequences, versions, timestamps and all existing constraints. Retain SQLite STRICT tables. The migration must be exercised against the actual pinned SQLite version, including its stored DDL representation.

### 4.2 Legal states and invariants

**Unpriced legacy purchase:** all purchase monetary columns are NULL and all item amounts are NULL. NULL means unknown, not free. A new application purchase cannot enter this state.

**Priced purchase:** currency is INR, every item has a bounded nonnegative integer amount, and subtotal/discount/final total are non-NULL bounded integers.

| Discount type | Percentage | Discount amount                                               |
| ------------- | ---------- | ------------------------------------------------------------- |
| `none`        | NULL       | 0                                                             |
| `fixed`       | NULL       | Greater than 0 and at most subtotal                           |
| `percentage`  | 1–10000    | Exactly the rounded percentage calculation; may round to zero |

Enforce `subtotal_minor >= discount_amount_minor` and `total_amount_minor = subtotal_minor - discount_amount_minor`. Write NULL checks explicitly: SQLite CHECK expressions must not accidentally accept invalid combinations because an expression evaluates to NULL.

Cross-row equality between purchase subtotal and item sum belongs in the save transaction and `inspectBusiness`; an ordinary SQLite CHECK cannot sum child rows. Inspect monetary consistency for cancelled purchases as well as active ones. A priced purchase cannot be corrected back into an unpriced one.

Do not add dashboard summary tables or allocate a purchase discount across medicines. Existing purchase-date indexes should support the initial Overview queries; add an index only if query-plan/representative-data measurements justify it.

## 5. Safe live upgrade and schema inspection

Implement the following before enabling money writes. Add `src/db/migrations.ts` for the version registry and `src/db/upgrade.ts` for asynchronous preparation. `PharmacyDatabase` is currently constructed synchronously, so await preparation in `src/service/service.ts` before constructing the owner/business services or announcing readiness; do not hide an asynchronous upgrade inside a constructor. Update direct-open test helpers to use the same preparation path.

1. Recognize a supported schema by its exact migration ledger, checksums and actual DDL. Keep strict inspection of version 1 available; inspect version 2 using 0001 followed by 0002. Reject unknown versions, modified ledgers and mismatched constraints.
2. Preserve the existing version 1 manifest checksum interpretation. Define version 2's schema checksum as SHA-256 of the UTF-8 registry lines `1:<checksum1>\n2:<checksum2>\n` (where `\n` denotes an actual LF, including the final LF) and test that mapping. Each migration checksum is the SHA-256 of that migration's exact SQL text. Do not reinterpret existing archives using a new checksum algorithm.
3. At service startup, resolve any existing replacement journal first, including version 1 setup/restore candidates. No business command may run while an upgrade is in progress.
4. For a verified version 1 live database, create a consistent staged copy using SQLite's backup API. Do not copy only the `.sqlite` file while committed data may still live in WAL.
5. Run 0002, append its ledger row and increment `app_meta.revision` once in a transaction on the staged copy. Keep dataset identity, owner credentials, purchase versions, audit records and mutation receipts intact.
6. Validate the complete candidate, checkpoint/close it into a self-contained database, durably flush it and publish it through the journaled replacement mechanism. Add an explicit `upgrade` replacement kind while retaining support for old journals. Preserve the complete original live generation and installation marker in recovery storage.
7. Open the published version 2 database, verify it again and then allow normal authentication/work. Repeat startup must not rerun the migration or increment revision again.
8. If migration or publication is interrupted, recover a verified generation through the journal or remain blocked with the original files retained. Never turn an unsupported/damaged installation into an empty pharmacy.

The parent currently allows 15 seconds for service readiness (`src/main/service-client.ts`). Make startup upgrade-aware: keep the normal startup deadline, add a validated upgrading/progress state and a bounded five-minute upgrade deadline for the initial implementation, and measure it on Windows fixtures. The main window must show that data is being updated and prevent business actions; it must not kill a healthy upgrade at the old 15-second limit. Test shutdown, deadline expiry and restart during preparation. An interrupted upgrade must still follow the journal recovery rules above.

An encrypted backup passphrase is not a prerequisite for opening an installed version 1 database. The locally retained original generation supplies upgrade recovery; it is not presented as a portable encrypted backup. Recommend a verified encrypted backup before the Windows upgrade rehearsal when one is already configured.

No automatic downgrade is supported. An older executable must reject schema version 2. A rollback to the old app uses a separately preserved version 1 profile/backup and necessarily excludes changes made after upgrading; never swap in a stale generation automatically.

## 6. Backup and restore compatibility

Archive encryption and the existing archive container format need not change solely because the enclosed SQLite schema changes. Extend the manifest/database-info schemas to accept only reviewed version/checksum combinations, rather than changing version 1 literals to unrestricted numbers/strings.

Restore sequence for a version 1 archive:

1. Authenticate/decrypt and verify the original archive as today.
2. Inspect the extracted database using the version 1 inspector. Compare its dataset, revision, counts, schema version/checksum and other manifest metadata **before** migration.
3. Migrate the private candidate to version 2 and verify it. Do not change the selected archive file.
4. Keep distinct source-archive information and target-candidate information in the pending restore. Bind the token to the verified candidate hash/schema and the current live dataset/revision. Do not compare the upgraded revision/schema directly against the old manifest.
5. Show the original archive's capture details and a short notice that the older backup will be updated for this app version. Keep the existing RESTORE confirmation, expiry and safety-copy behavior.
6. On confirmation, recheck the candidate and current live state, preserve the current pharmacy, publish the verified version 2 candidate and require restored-owner sign-in. New backups use version 2 metadata.
7. Cancel removes the staged candidate and clears sensitive key material as today. A failed migration, unsupported future schema, wrong passphrase or tampered candidate must never replace live data.

Exercise this for an initialized installation, a fresh profile and damaged-installation recovery. Preserve prior safety archives, device key handling, external-backup behavior and retained generations. Version-aware replacement recovery must work even if an older restore journal was pending when the app was upgraded.

## 7. Contracts, preview and transactional persistence

Use an explicit input shape so historical unknown amounts are distinguishable from entered zeroes:

```ts
// Contract sketch, not implementation code.
type PurchasePricingInput = null | {
  currencyCode: 'INR';
  discount:
    | { type: 'none' }
    | { type: 'fixed'; amount: string } // decimal rupees
    | { type: 'percentage'; percent: string };
};
// Each purchase item adds amount: string | null (decimal rupees).
```

- `pricing: null` is accepted only for a correction of an already-unpriced legacy purchase, with every item amount NULL. Require full pricing for all new purchases.
- A priced input requires a decimal amount on every item. Reject mixed priced/unpriced items and unsupported currency codes.
- Parse money on the service side using the shared exact helpers. The renderer may use the same helpers for instant feedback, but cannot supply authoritative subtotal/discount/final-total fields.
- Extend purchase reads, item reads and preview responses with canonical monetary fields. Keep per-purchase minor-unit numbers within the specified safe bound.
- Extend the existing preview to return both supply estimates and verified money totals. Changing amounts, discount mode/value, quantity/unit, item selection or other purchase details invalidates the accepted preview. Save still recalculates and validates inside the service transaction.
- Write parent totals, item amounts, supply changes, audit snapshots, mutation receipt and revision atomically through the existing `mutate` path. Any failure rolls all of them back, including sequence allocation.
- Keep expected purchase version and expected dataset revision checks. Currency, amounts and discount inputs participate in the receipt payload hash. Unknown-result retries submit the exact frozen payload and original request ID; changed monetary data under that ID must conflict.
- Preserve old receipts/audit JSON during migration. Do not rewrite stored payload hashes to inject money fields or permit a new unpriced purchase through an old request shape. Historical snapshots without money fields render as unrecorded; they are not malformed new inputs.
- Cancellation preserves the recorded monetary values and audit history but removes that purchase from active value aggregates.

## 8. Purchase editor, details and history

### New purchases and refills

1. Add **Amount (₹)** after Unit on each quantity row, using decimal text entry and `inputMode="decimal"`.
2. Explain once: “Enter the total amount for this medicine row.” Changing quantity/unit does not multiply or silently change the amount.
3. New rows start blank. A refill starts with blank amounts and no discount; do not copy a previous price or discount as if it were current.
4. Show the summary after the medicine/supply sections and above the existing preview/actions:

```text
Subtotal                         ₹1,000.00
Discount                         [100.00]
[ ] Enter discount as percentage
Discount applied                   ₹100.00
Total amount                       ₹900.00
```

5. When checked, label the input **Discount (%)**, show its calculated rupee deduction and validate 0–100. Switching modes clears the entered discount value to avoid silently reinterpreting ₹100 as 100%. Explain the reset beside the control.
6. Update draft totals immediately only when inputs are valid. Show a helpful field error or incomplete state instead of a misleading zero/partial total. Keep the “preview before Save” instruction and use the service preview for confirmed totals.
7. Preserve Clear / Save / Discard, Back confirmation, inline creation, lock/unlock draft retention and frozen uncertain submissions. Clear restores initial amounts/discounts for corrections and blank/default amounts for new purchases/refills; it clears the preview.

### Existing purchases

- An unpriced legacy correction initially says **Amount not recorded** and offers **Record amounts for this purchase**. Existing nonfinancial corrections remain possible without fabricating amounts.
- Recording amounts requires every row and a valid purchase discount. Until saved, opting out restores the fully unpriced draft; clearing a priced purchase never converts it to NULL.
- Priced corrections load exact decimal rupee text from saved paise, retaining legitimate zeroes and the original discount type/value. Correction reason remains required.
- Show row amounts, currency, subtotal, discount description, discount amount and final total in the dedicated purchase-details view.
- Add a **Total amount** column to shared purchase lists, covering Purchases, Reports and customer/medicine history. Keep cancelled status visible and show unpriced values explicitly.
- Format monetary fields in audit before/after views as rupees and percentages, using the snapshot currency. Do not display raw paise as if they were rupees, or infer missing historical values.
- Current-supply and contact screens retain their supply/reminder meaning; their existing source-purchase links expose the financial details.

## 9. CSV exports without double counting

The current `purchases` CSV emits one row per medicine/unit, so repeating the full discounted purchase total on every row would invite incorrect sums.

Implement two clearly named outputs:

| Export                                               | Row grain             | New money columns                                                                                                                                            |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing purchase-items export (`kind: purchases`)   | One medicine/unit row | Currency, Line amount, Amount status. Keep the other existing columns. Do not repeat purchase-level totals.                                                  |
| New purchase-summary export (`kind: purchaseTotals`) | One purchase          | Currency, Subtotal, Discount type, Discount percentage, Discount amount, Total amount, Amount status; plus purchase number/date/status and customer context. |

- Reuse purchase search/customer/medicine filters for the summary. A medicine filter selects whole matching purchases; its purchase total includes every medicine and must be described that way.
- Write rupee values as ungrouped exact decimals such as `125.50`, with a separate `INR` column. Unknown values are blank and marked `not_recorded`; explicit zero is `0.00` and marked `recorded`.
- Represent percentage as an exact decimal such as `12.50`, never the raw basis-point count. Keep fixed-discount percentages blank.
- Provide both exports in Settings and clearly labelled actions on purchase lists/history. Include cancelled records with their status under the existing export rules; Overview excludes them separately.
- Preserve CSV escaping, formula protection, UTF-8, filtered all-page export, cancellation, overwrite checks, durable publication and exclusion of the app's own data directory.

## 10. Overview card and graph

Keep `purchasesToday` and the existing seven-day purchase-count chart intact.

Add a **Purchase value** card and **Purchase value over time** graph sharing one period control:

| Selection       | Bounds and buckets                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Daily (default) | Today and preceding six pharmacy days; seven daily buckets.                                                      |
| Monthly         | First day of the month 11 months ago through today; 12 monthly buckets, current month labelled as month to date. |

Use purchase dates and Asia/Kolkata calendar boundaries consistently. Compute month boundaries as calendar dates, not by subtracting fixed 30-day periods. Fill empty buckets with zeroes.

Extend the dashboard request with a validated period (default Daily) through desktop contracts, preload, main and service. Extend the response with a value summary containing currency, period bounds, exact total, priced/unpriced purchase counts and bucket values/counts. Read counts and money under the same database read transaction/revision.

Aggregate directly from active purchases, never by joining purchase items. This prevents counting the purchase total multiple times when it contains several medicines or units. Sum only recorded INR totals; include legitimate zero-total purchases in the priced count. Count legacy unpriced purchases separately and show a note such as “3 purchases have no recorded amount.” If all purchases are unpriced, show **No recorded amounts** rather than claiming a known zero value.

Per-purchase integers are bounded, but an aggregate can exceed JavaScript's safe-number range. Stream the relevant purchase date/total rows from the indexed date range and accumulate bucket totals using `bigint`. Serialize aggregate minor units as decimal integer strings across JSON/IPC. Format card/table/tooltip values from those exact strings. Convert only normalized chart coordinates to floating point; never use chart coordinates to calculate displayed totals.

The chart must have an accessible labelled summary/table, exact rupee tooltips and clear empty/partial-data states. Correcting a purchase moves its value to the corrected purchase date; cancelling it removes its value. Refresh after commits, restores and existing refresh triggers. Do not label this revenue collected, profit or payment received.

## 11. Implementation sequence and completion gates

| Phase                          | Concrete deliverable                                                                                    | Gate before the next phase                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1. Exact arithmetic            | Money module, bounds, parsing/formatting and discount calculation.                                      | Unit examples, invalid inputs, round-half-up and maximum-value cases pass.                                   |
| 2. Schema registry and upgrade | 0002, version-aware inspectors, staged live upgrade and journal recovery.                               | Version 1 fixtures upgrade/reopen; fault tests preserve originals and never publish an incomplete candidate. |
| 3. Backup compatibility        | Versioned manifests, verify-before-upgrade restore candidates, explicit source/target metadata.         | Old/new archive restores, cancellation, tampering and interrupted replacement pass.                          |
| 4. Purchase data path          | Input/read/preview contracts, transactional writes, correction/cancellation and monetary health checks. | Save/reopen, conflicts, receipts, legacy correction and rollback cases pass.                                 |
| 5. Purchase UI                 | Amounts, checkbox discount, totals, reset/Back behavior, dedicated details/list/audit formatting.       | Packaged user journeys prove displayed, previewed and persisted totals agree.                                |
| 6. Exports                     | Item amounts and separate one-row-per-purchase summary.                                                 | Multi-item exports reconcile to purchases without duplicated totals.                                         |
| 7. Overview                    | Value card/graph, period request and exact aggregates with missing-value coverage.                      | Date-boundary, correction/cancellation, zero/unknown and large-aggregate cases pass.                         |
| 8. Release rehearsal           | Updated docs, package version/artifact and Windows upgrade walkthrough.                                 | All local checks pass; actual Windows evidence is recorded separately.                                       |

Keep every intermediate commit runnable or explicitly gate unfinished UI. Do not release an executable that writes version 2 money records before its inspector, backup and restore paths understand them. No dependency/framework change is expected.

## 12. Required verification

### Unit tests

Add `tests/unit/money.test.ts` covering exact parsing/formatting, empty versus zero, malformed input, fraction precision, limits, fixed/percentage validation, half-paise boundaries, 100% discounts and safe `bigint` conversions. Include round-trip properties across representative integer paise values and aggregate values above the JavaScript safe-integer limit.

### Migration and recovery tests

Add frozen version 1 database/archive fixtures produced using the original schema/checksum; do not generate every “old” fixture from the new schema builder.

- Upgrade populated and empty version 1 profiles. Verify IDs, quantities, supplies, credentials, histories, receipts, sequences and unknown-money values remain intact.
- Reopen twice and verify exactly one new migration/revision increment.
- Hold preparation beyond the old 15-second startup limit and verify the main process stays in the upgrade state; exercise the bounded deadline and restart recovery.
- Upgrade with committed WAL data present and verify it is included.
- Terminate around staging, migration, journal preparation, each rename and marker publication. Resume to a verified generation or a recoverable blocked state, with originals retained.
- Exercise insufficient space, readonly files, tampered ledgers/DDL, future versions and inconsistent monetary rows. No partially upgraded live database may be opened.
- Resume old version 1 setup/restore journals under the new executable before performing any required upgrade.

### Integration tests

Extend business, mutation, backup, reports and dashboard tests:

- Multi-medicine/multiple-unit purchases, zero and maximum valid amounts, no/fixed/percentage discounts, correction/reopen and cancellation.
- Identical unknown-result retry creates one purchase and one financial result; changed money under the same request ID conflicts. Stale preview/version and transaction failures leave all related data unchanged.
- Legacy nonfinancial corrections preserve NULL amounts; fully pricing a legacy purchase works; partial pricing and reverting a priced purchase to unknown are refused.
- Monetary health inspection detects altered subtotal, incorrect rounding, bad currency and mismatched row amounts, including cancelled purchases.
- Back up and restore version 2 values exactly; restore a genuine version 1 archive into both fresh and existing profiles. Check source-manifest validation happens before conversion and the post-restore backup has current metadata.
- CSV item and purchase-summary totals reconcile; unknowns stay blank; cancelled records stay labelled; filtered exports do not multiply totals.
- Overview handles no records, only unknown records, zero-priced records, mixed records, cancellations, moved purchase dates, seven-day/month/year/leap-year boundaries and large exact aggregates. Check owner access and currency guards.

### Packaged desktop tests

Extend `tests/desktop/prototype.spec.ts` to cover:

1. Enter two medicine amounts, preview and save; restart/sign in and verify list/details totals.
2. Fixed discount, percentage checkbox, mode-switch reset, decimal errors, above-subtotal errors and explicit zeroes.
3. Change pricing after preview: Save is disabled until another successful preview. Retry an uncertain save without permitting edits or double counting.
4. Clear, Discard, Back, inline customer/medicine creation, correction and refill defaults preserve their documented behavior with monetary fields.
5. Open an upgraded legacy purchase, retain unknown amounts during an ordinary correction, then explicitly record all amounts.
6. Verify Overview card/chart and period switching after save/correct/cancel, and export both money views.
7. Restore an older archive, cancel once, then confirm; verify the upgraded purchase histories, unknown amounts and restored sign-in.
8. Inspect the amount row and summary at 1366×768 and 1920×1080, with existing 100%/125%/150% zoom coverage, visible focus and reachable buttons.

### Commands and native acceptance

Run from the repository with the pinned Node/pnpm environment:

```sh
pnpm check
pnpm package
pnpm test:desktop
```

Then, on the Windows build/test machine:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm package
pnpm test:desktop
pnpm make:windows
```

Use a disposable copy of a populated preview 0.1.3/version 1 profile to test the new installer and upgrade. Also test a fresh installation, old-archive restore and reopen after an interrupted upgrade. Record source commit, package version, executable/installer hashes and Windows build. Linux checks do not certify Windows installation, file replacement/locking, display scaling or DPAPI. Windows 10 and Windows 11 require separate evidence.

Update `BUSINESS_WORKFLOWS.md`, `REPORTS_AND_EXPORTS.md`, `BACKUP_USAGE.md`, `WINDOWS_TESTING.md`, the platform decision about disabled upgrades, and verification notes only as implementation evidence becomes available. Bump the application version when preparing the completed release; do not claim a Windows installer was validated from Linux.

## 13. Definition of done

- [ ] Every new purchase saves exact per-row paise, currency, discount and final total, and those values survive restart and restore.
- [ ] Rupee/percentage input and display follow the agreed precision and rounding rules throughout UI, history, exports and Overview.
- [ ] Existing installations and older backups upgrade without fabricated amounts or loss of pharmacy records.
- [ ] Purchase edits, cancellation, idempotent retries and conflict handling preserve transactional consistency.
- [ ] List/details/audit views and both CSV exports correctly distinguish unknown amounts from zero.
- [ ] The new Overview card and daily/monthly graph use exact net purchase values without double counting, while existing count metrics remain correct.
- [ ] Clear/Save/Discard, preview requirements, Back destinations, lock behavior and frozen submissions remain functional.
- [ ] Upgrade, recovery, archive compatibility and monetary health tests pass, together with the existing suite.
- [ ] Documentation and native Windows evidence accurately identify completed and still-pending release checks.
