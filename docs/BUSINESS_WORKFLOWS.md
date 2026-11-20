# Pharmacy workflow walkthrough

Use synthetic data in this development preview until Windows testing and the owner walkthrough are complete. All entries stay in the local pharmacy database. A purchase records the medicines supplied to a customer and their INR value after the purchase discount.

## Customers and medicines

Open **Customers → Add customer**. Enter a name and a phone with 7–15 digits. Formatting is retained, shared family numbers are allowed, and age/notes are optional. Search by name or phone. Edit a record to correct details, archive it or restore it. Archived records remain in history and are excluded from new purchase selections.

Open **Medicines → Add medicine**. Name, strength and form identify a catalogue entry; name and form are required. Case, Unicode compatibility forms and repeated whitespace are normalized for identity matching. An archived match must be restored instead of duplicated. Choose quantity units on purchases, not in the catalogue. Existing purchase labels preserve their dated snapshots after catalogue changes.

Lists and pickers have pages of 20. **View purchases** on a customer or medicine opens a dedicated purchase-history view. Selecting a purchase opens its own details view, with **View audit history** opening a further history view. Back returns through these views without resetting the list search, status or page. **Reports** provides the complete purchase list. Purchase details include recorded supplies, corrections and cancellation history. **View current supplies** on a customer gathers medicine coverage, run-out dates and reminder states in one place, separating future-starting supplies from today’s coverage.

## Purchases and supplies

1. Open **Purchases → New purchase** and select a customer. Customer and medicine pickers also offer inline creation without discarding the purchase draft.
2. Enter the purchase date and optional notes. Future purchase dates are refused. Add medicine rows with positive quantities, up to three decimal places, and units. The same medicine may appear in different units; duplicate medicine/unit rows must be combined. Enter the total rupee amount for each row to at most two decimal places. An explicit zero is valid. Changing quantity keeps the entered row amount.
3. Enter **Supply start date** and 1–365 **Days supplied** for each distinct medicine. The application does not infer dosage or duration from quantity. Start must be on or after purchase and must respect the chronological medicine chain.
4. For a refill, explicitly choose **Extend** or **Replace**. Extend carries estimated remaining days; **Remaining days adjustment (optional)** replaces that estimate, including an explicit zero. Replace starts fresh. Each medicine has an independent reminder opt-in, initially off.
5. Optionally choose a manual reminder date. Click anywhere inside a date field to open its calendar, or use keyboard entry. It cannot precede purchase; a date on/after run-out needs explicit confirmation.
6. Review the subtotal and optionally enter a fixed discount in rupees. Select **Enter discount as percentage** to use a percentage from 0 to 100 with up to two decimal places. Switching modes clears the previous discount. The app rounds a percentage deduction once to the nearest paise, with half a paise rounded up.
7. Select **Refresh supply preview**. Review the final amount, carried days, run-out and reminder dates, then **Save**. Editing fields clears the preview. A concurrent saved change can invalidate it; refresh and review again.

Seven new days starting 1 November run out on 8 November. An 11-day refill starting 4 November carries four days in extend mode, runs out on 19 November and reminds on 16 November. Replace mode runs out on 15 November and reminds on 12 November. These are supply estimates based on the entered days, not medical dosing advice.

Open purchase details to **Correct purchase** or **Cancel purchase**, with a reason. Sequence numbers stay unchanged. Corrections can change customer, date and medicine rows; all affected old/new chains reconcile atomically. Cancellation retains the purchase and restores the preceding eligible reminder state. Changes to historical item rows remain visible in before/after audit details.

## Follow-ups

Overview and **Follow-ups** show due/overdue customers, with separate medicine actions. Switch to **Scheduled**, **Closed / superseded** or **All cycles** as needed. Pagination counts customers so matching medicines for one customer stay together.

**Record follow-up** supports:

- Contact outcome, optionally with a next-contact date. Contact alone keeps the reminder open.
- Scheduling the next contact without claiming a contact occurred.
- Manual closure with a reason, and explicit reopening of the eligible current closed cycle.

A future contact date moves the reminder to Scheduled. When it becomes due, it offers follow-up again. **Record refill** preselects the customer/medicine; enter the actual duration, refill choice and reminder opt-in. A later supply supersedes the preceding cycle even when its reminder is disabled. Cancelling the later supply restores previous contact/scheduling/manual-closure state. Other medicines are unaffected.

Open **Contact history** to see contact and system reconciliation events in a dedicated view; Back returns to the selected follow-up tab. Audit details use recorded before/after values; this is application history, not proof against an administrator editing local files.

## Drafts and recovery

Forms have a Back button near the heading that names their destination. Back asks whether to discard and leave or continue editing; Escape continues editing. Returning from an inline customer/medicine form keeps the parent purchase. Returning from a correction or cancellation opens the original purchase details. Detail, current-supply and purchase-history views replace the list and offer Back, preserving the previous list search, filters and pagination. New views start at the top with keyboard focus on the heading. Dashboard entries offer Back to overview at their entry view. Main tabs use the existing navigation without a Back button.

Customer, medicine and purchase forms have Clear, Save and Discard controls. Clear restores the initial form values, including saved values when editing. For purchases, Clear resets a new purchase to its starting defaults, restores saved values during a correction, and retains the preselected customer and medicine when starting a refill. It clears the supply preview, so preview again before saving. Inline customer and medicine records already saved remain in the catalogue even if the purchase is cleared or discarded. Discard closes the editor; for inline creation it returns to the purchase with its draft retained. Changing sections with an unsaved business draft asks whether to discard and switch or continue editing. Confirming discards the whole unfinished workflow, including any parent purchase. Saving or an uncertain save result temporarily blocks navigation and resetting. Locking or storage reauthentication preserves the in-memory draft. Closing the application loses unsaved drafts after confirmation. A restore clears drafts so they cannot be submitted into the restored dataset.

If a save response is uncertain, the submission stays frozen. Recover storage/sign in and use **Retry same submission**; its original request ID prevents duplicate purchases or catalogue records. A known stale-record conflict requires reopening the latest saved record and reapplying the intended correction. Purchase-context conflicts can be resolved by refreshing the preview.

Business records and contact/audit history are included in encrypted backups. See [backup usage](BACKUP_USAGE.md). Device backup preferences remain separate.

## Reports and CSV exports

Lists provide filtered CSV exports across all matching pages. Settings provides full-data exports, including archived/cancelled records and contact history. See [reports and CSV exports](REPORTS_AND_EXPORTS.md) for column meanings, spreadsheet handling and safe save behavior.
