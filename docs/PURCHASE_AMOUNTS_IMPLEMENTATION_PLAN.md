# Purchase amounts, discounts and Overview value reporting

Implementation plan for the first tested build. The pharmacy starts with an empty profile. The first purchase and every correction require an amount on each medicine/unit row. Setup, restart and encrypted restore use the same purchase schema.

Prepared 20 November 2026 against application baseline `2ad0c08`, desktop preview `0.1.3`. The implementation was tested on the working tree based on `f254e83`.

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
- Retain the existing purchase-count card/chart and add purchase-value reporting.

Concrete defaults for this implementation:

| Decision             | Planned behavior                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported currency   | INR only in this release; show INR/₹ explicitly, with no currency selector or conversion. Store the currency on each purchase.        |
| New purchase amounts | Required on every quantity/unit row. Blank is invalid; an explicit zero is valid.                                                            |
| Discount default     | No discount. Blank or zero normalizes to `none`.                                                                                             |
| Money limit          | `MAX_MONEY_MINOR = 9_999_999_999` paise (₹9,99,99,999.99), for each row and for the entire purchase subtotal. Reject an overflowing sum.     |
| Percentage input     | 0–100%, at most two decimal places; store basis points, where 10% = 1000.                                                                    |
| Overview default     | Last 7 days, including today, grouped daily. A Monthly option shows the current month to date and preceding 11 months.                       |
| Value definition     | Sum of final purchase amounts after discounts, for active purchases by purchase date. This is purchase value, not money collected or profit. |

Unit pricing, automatic quantity × price, taxes/GST, payment methods, paid/outstanding balances, refunds, inventory costing, medicine-level net revenue and multiple-currency operation are outside this change. No new price field belongs on the medicine catalogue.

## 2. Implementation map

| Area | Files | Work |
| --- | --- | --- |
| Storage | `src/db/migrations/0001.ts`, `src/db/health.ts`, `src/db/business-health.ts` | Define required amounts in the initial tables and verify purchase totals during inspection. |
| Money and purchases | `src/domain/money.ts`, `src/contracts/business.ts`, `src/application/business-service.ts`, `src/application/mutations.ts` | Share exact arithmetic, bind previews to drafts, save amounts and preserve receipt replay. |
| Purchase UI | `src/renderer/business-workspace.tsx` | Capture row amounts and discounts. Show totals in preview, details, lists and audit history. |
| Exports | `src/contracts/reports.ts`, `src/application/csv-export.ts`, `src/renderer/reports.tsx` | Extend the item export and add a purchase-summary export. |
| Overview and IPC | `src/contracts/dashboard.ts`, `src/application/dashboard-service.ts`, `src/renderer/dashboard.tsx`, desktop contracts, preload, main and service | Carry the selected period and exact totals through the validated request and response. |
| Backup verification | `src/backup/archive.ts`, `src/backup/manager.ts`, `tests/integration/backup.test.ts` | Exercise the existing encrypted backup and restore flow against newly recorded purchases. |

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

## 4. Initial database schema

Define the columns directly in the `CREATE TABLE` statements in `src/db/migrations/0001.ts` for this pre-production baseline. Keep schema version 1 and use the existing SHA-256 checksum of the revised SQL in setup, inspection and archive manifests. An earlier development profile or archive has a different checksum. Keep the existing validation and recovery behavior for that case. First-run tests use a new profile directory.

| Table | Column | SQLite declaration | Meaning |
| --- | --- | --- | --- |
| `purchase_items` | `amount_minor` | INTEGER NOT NULL | Entered line amount before discount |
| `purchases` | `currency_code` | TEXT NOT NULL | INR |
| `purchases` | `subtotal_minor` | INTEGER NOT NULL | Sum of item amounts |
| `purchases` | `discount_type` | TEXT NOT NULL | `none`, `fixed` or `percentage` |
| `purchases` | `discount_percent_bps` | INTEGER | Entered basis points for percentage mode |
| `purchases` | `discount_amount_minor` | INTEGER NOT NULL | Fixed or calculated deduction |
| `purchases` | `total_amount_minor` | INTEGER NOT NULL | Subtotal less deduction |

Keep STRICT tables. Bound all paise columns from zero through `MAX_MONEY_MINOR` and check that currency is INR, the deduction is at most the subtotal, and the total equals subtotal minus deduction. For `none`, require a zero deduction and NULL basis points. For `fixed`, require a positive deduction and NULL basis points. For `percentage`, explicitly require non-NULL basis points in 1–10000 and the exact deduction from section 3. A positive percentage can round to zero paise and still retains the entered percentage.

Check the parent subtotal against the sum of its rows in the save transaction and in `inspectBusiness` for active and cancelled purchases. Reuse the existing marker, dataset identity, ledger, schema and manifest checks on open and restore.

## 5. Contracts, preview and persistence

- Require decimal `amount` text on each purchase item and a purchase-level pricing input containing `currencyCode: 'INR'` and a discount. Use a discriminated union for `none`, `fixed` with decimal rupee text, or `percentage` with decimal percent text. The service validates these inputs and derives every total.
- Extend purchase and item reads with canonical monetary fields. Preview returns the supply estimates, monetary totals, revision and a fingerprint computed by the service from the dataset ID, revision and full validated draft, including row amounts and discount input.
- Clear the accepted preview when any draft field changes. Carry its fingerprint and revision on Save. Inside the existing mutation transaction, check the expected purchase version and dataset revision, recompute the fingerprint from the submitted draft, and require a match before the first write. A change from ₹100 to ₹1,000 requires another preview even when the database revision is unchanged.
- Save the purchase, items, supply changes, audit snapshots, receipt and revision atomically. Keep receipt lookup ahead of first-write checks so retrying an already committed frozen request returns its original result after restart. Reusing its request ID with changed money must conflict.
- Corrections require a reason and follow the same pricing and preview rules. Cancellation retains the amounts and audit history and removes the purchase from active Overview totals.

## 6. Purchase editor, details and history

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

- Corrections load exact decimal rupee text from saved paise, retaining legitimate zeroes and the original discount type/value. Correction reason remains required.
- Show row amounts, currency, subtotal, discount description, discount amount and final total in the dedicated purchase-details view.
- Add a **Total amount** column to shared purchase lists, covering Purchases, Reports and customer/medicine history. Keep cancelled status visible.
- Format monetary fields in audit before/after views as rupees and percentages, using the snapshot currency. Do not display raw paise as if they were rupees.
- Current-supply and contact screens retain their supply/reminder meaning; their existing source-purchase links expose the financial details.

## 7. CSV exports without double counting

The current `purchases` CSV emits one row per medicine/unit, so repeating the full discounted purchase total on every row would invite incorrect sums.

Implement two clearly named outputs:

| Export                                               | Row grain             | New money columns                                                                                                                                            |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing purchase-items export (`kind: purchases`)   | One medicine/unit row | Currency, Line amount. Keep the other existing columns. Do not repeat purchase-level totals.                                                  |
| New purchase-summary export (`kind: purchaseTotals`) | One purchase          | Currency, Subtotal, Discount type, Discount percentage, Discount amount, Total amount; plus purchase number/date/status and customer context. |

- Reuse purchase search/customer/medicine filters for the summary. A medicine filter selects whole matching purchases; its purchase total includes every medicine and must be described that way.
- Write rupee values as ungrouped exact decimals such as `125.50`, with a separate `INR` column. Export explicit zero as `0.00`.
- Represent percentage as an exact decimal such as `12.50`, never the raw basis-point count. Leave the percentage blank for fixed discounts and purchases with no discount.
- Provide both exports in Settings and clearly labelled actions on purchase lists/history. Include cancelled records with their status under the existing export rules; Overview excludes them separately.
- Preserve CSV escaping, formula protection, UTF-8, filtered all-page export, cancellation, overwrite checks, durable publication and exclusion of the app's own data directory.

## 8. Overview card and graph

Keep `purchasesToday` and the existing seven-day purchase-count chart intact.

Add a **Purchase value** card and **Purchase value over time** graph sharing one period control:

| Selection       | Bounds and buckets                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Daily (default) | Today and preceding six pharmacy days; seven daily buckets.                                                      |
| Monthly         | First day of the month 11 months ago through today; 12 monthly buckets, current month labelled as month to date. |

Use purchase dates and Asia/Kolkata calendar boundaries consistently. Compute month boundaries as calendar dates, not by subtracting fixed 30-day periods. Fill empty buckets with zeroes.

Extend the dashboard request with a validated period (default Daily) through desktop contracts, preload, main and service. Extend the response with a value summary containing currency, period bounds, exact total, active purchase counts and bucket values/counts. Read counts and money under the same database read transaction/revision.

Aggregate directly from active purchases by purchase date. Count each purchase once and sum its final INR amount, including zero. Use the count to distinguish an empty period or bucket (“No purchases”) from a period or bucket containing a recorded ₹0.00 purchase. Show the purchase count alongside exact values in the accessible table and tooltips.

Per-purchase integers are bounded, but an aggregate can exceed JavaScript's safe-number range. Stream the relevant purchase date/total rows from the indexed date range and accumulate bucket totals using `bigint`. Serialize aggregate minor units as decimal integer strings across JSON/IPC. Format card/table/tooltip values from those exact strings. Convert only normalized chart coordinates to floating point; never use chart coordinates to calculate displayed totals.

The chart must have an accessible labelled summary/table, exact rupee tooltips and a clear empty state. Correcting a purchase moves its value to the corrected purchase date; cancelling it removes its value. Refresh after commits, restores and existing refresh triggers. Do not label this revenue collected, profit or payment received.

## 9. Implementation order and verification

1. **Money helpers.** Add `tests/unit/money.test.ts` for the examples in section 3, malformed decimals, blank and explicit zero, a subtotal just above the maximum, and a positive percentage whose deduction rounds to zero. Verify exact formatting for both individual amounts and aggregates above the JavaScript safe-integer limit.
2. **Schema, service and editor.** Land required columns together with their writers and update purchase fixtures and callers. Extend business, mutation and recovery tests for multiple medicines and multiple units of one medicine, all discount modes, corrections, cancellation and rollback. Test a changed draft submitted with the same revision and previous preview fingerprint. Test lost-response replay with the original frozen submission. Verify that health inspection catches a mismatch between the item sum and purchase subtotal for both active and cancelled records.
3. **Exports and Overview.** Test filtered, multi-item purchases in both exports. Item amounts must sum to the summary subtotal, and subtotal less discount must equal the summary total. An unfiltered active purchase total for the same date range must agree with Overview. Cover cancelled purchases, corrected dates, empty periods, zero totals, month/year and leap-day boundaries, exact large aggregates, and owner access.
4. **Backup and restore.** Create a verified encrypted backup of purchases recorded in this build. Restore into a fresh profile and check restored-owner sign-in, item amounts, discount type/input, subtotal, final total and audit history. Exercise cancellation and the existing safety-copy flow when restoring over an initialized test pharmacy. Keep the existing recovery and archive-integrity tests passing.

### First packaged walkthrough

Use a new profile and extend `tests/desktop/prototype.spec.ts` for this path.

1. Complete setup. Confirm that Overview shows no purchases. Create a customer and two medicines.
2. Enter row amounts of ₹125.50 and ₹74.50, with a quantity greater than one on the first row. Select a 12.50% discount. Preview must show ₹200.00 subtotal, ₹25.00 discount and ₹175.00 final total.
3. Save, restart and sign in. Verify both row amounts in details, ₹175.00 in the purchase list and ₹175.00 on Overview. Export both views and reconcile the two item rows with the one purchase-summary row.
4. Back up and restore the purchase. Verify the same amounts after restored-owner sign-in. Correct the discount to a fixed ₹10.00, confirm the revised ₹190.00 total, then cancel the purchase. Its details retain ₹190.00 and Overview returns to an empty period.
5. In separate editor cases, exercise mode-switch reset, invalid decimals, excessive discounts, explicit zero, edit after preview, uncertain-save retry, Clear, Discard, Back, inline creation, lock/unlock and refill defaults. Verify daily/monthly switching and accessible controls at 1366×768 and 1920×1080 with the existing zoom coverage.

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

On each supported Windows version, exercise fresh setup, purchase entry, restart and restore with the packaged app. Record the source commit, package version, artifact hashes and Windows build alongside the observed results.

Update the business workflow, reports, backup usage and Windows testing documentation as the behavior is verified.

## 10. Verification results

- On Linux x64 with Node 24.15.0 and pnpm 10.33.4, `pnpm check` passed lint, formatting, all three TypeScript checks and 92 unit, integration and recovery tests across 17 files.
- `pnpm package` produced the Linux x64 preview. The SHA-256 of `resources/app.asar` is `896e6d04264ac82ebe40a0b185c31ee6e3f2fa2263f8f7ceac57e4e1eb492a49`.
- All 29 packaged Linux desktop tests passed. The purchase walkthrough verified ₹175.00 across restart, both export formats, Overview, audit and restore. It applied a fixed discount to reach ₹190.00, cancelled the purchase and verified the empty Overview. Editor controls remained reachable at the tested desktop sizes and zoom levels.
- Native Windows 10 and Windows 11 installation, display scaling and restore checks are pending. Use the [Windows walkthrough](WINDOWS_TESTING.md).

## 11. Definition of done

- [x] Fresh setup opens an empty pharmacy with the reviewed initial schema.
- [x] Every purchase saves exact row amounts, currency, discount and final total. The values survive restart and encrypted backup/restore.
- [x] The preview matches the saved draft. Corrections, cancellations and retries preserve consistent records and audit history.
- [x] The editor, details, audit views, both CSV exports and Overview agree on the same purchase. Existing count, supply, reminder and navigation workflows pass their tests.
- [x] The verification notes identify the local and native Windows checks actually completed.
