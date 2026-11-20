# Business workflow verification

Implementation follows `f035e92`. The commit introducing this report identifies the source under test. Development verification uses Linux x64, Node 24.15.0, pnpm 10.33.4 and the pinned Electron/native SQLite package. Windows 10/11 verification remains open.

For the subsequent fresh-profile purchase amounts implementation, see the [purchase amounts verification results](../PURCHASE_AMOUNTS_IMPLEMENTATION_PLAN.md#10-verification-results).

## Implemented scope

- Customer/medicine create, edit, archive, restore, normalized search and stable 20-record pagination. Shared customer phone numbers are permitted; medicine identity includes normalized name/strength/form across active and archived records.
- Restricted, validated preload/main/service commands for queries, purchase previews and idempotent mutations. Owner checks remain authoritative in the database service. The renderer receives neither a SQL interface nor filesystem access.
- Exact quantities, immutable purchase numbers, dated item snapshots, one supply per distinct medicine, independent opt-in reminders, explicit refill choices, zero/null remaining overrides and late-reminder confirmation.
- Corrections/cancellation with reasons and atomic reconciliation of all affected old/new customer/medicine chains. Removed supply rows retain stable identity. Later replace entries reset carry; manual remaining overrides remain assertions.
- Contact, scheduling, manual closure and eligible reopen; supersession preserves contact/date/closure state and cancellation restores it. Appended events record reconciliation and contact outcomes.
- Customer-grouped due/scheduled/closed follow-ups, customer/medicine purchase history, purchase details and readable before/after audit history.
- Inline creation retains the purchase draft. Lock/re-authentication retains drafts; restore resets them. Unknown outcomes keep the exact command frozen for receipt replay. A global database revision conservatively invalidates purchase previews on any intervening business write.
- Startup, snapshot and restore health checks verify item/supply correspondence, sequence counter position, active-chain calculations, current reminder eligibility and paused-cycle data. Existing schema version 1 remains unchanged.

## Verification

- `pnpm check`: lint, formatting, three TypeScript configurations, and 70 unit/integration/recovery tests passed.
- File-backed business tests cover normalized duplicates, phone sharing, archive/restore, stale versions, exact mixed units, independent medicines, carry/replace/zero overrides, invalid/future dates, late reminders, stable supply identity on removal/re-addition, earlier corrections, customer moves, cancellation restoration, manual close/reopen, history snapshots, context conflicts, retry deduplication, authorization, pagination and late-transaction rollback including the purchase number.
- A populated database reopens successfully and round-trips through encrypted backup/restore with purchase and contact history intact. Deliberately inconsistent carry calculations, reminder state, paused state and sequence counters are rejected.
- `pnpm package`: Linux x64 preview built with native SQLite.
- `pnpm test:desktop`: all 17 packaged journeys passed with Chromium sandbox enabled. Existing owner, security, recovery and backup journeys remain green. New journeys cover inline customer/medicine creation with draft retention, exact quantity entry, supply preview, purchase correction, contact scheduling, refill, cancellation restoring the contact date, restart/search/customer purchase history, draft preservation across lock, and catalogue archive/restore.
- The purchase preview and scheduled follow-up screens were visually inspected using synthetic data. The UI verification found and resolved ambiguous dropdown labels and a rejected history request containing a display-only field.
- `git diff --check` passed. No migration, dependency or lockfile changes were required.

## Remaining release work

CSV export, a consolidated current-supply history view, larger concurrency/fault/load exercises, independent review, signed installers and Windows 10/11 native/keyboard/accessibility validation remain open. The preview retains its existing 64 MiB backup limit and schema-upgrade restrictions. No pricing, billing, stock control, supplier purchasing or automated messaging was added.
