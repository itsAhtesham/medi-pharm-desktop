# Desktop interface

The interface follows the supplied pharmacy dashboard reference: navy branding and status bars, a horizontal navigation strip, pale-blue grouped shortcuts, pastel dashboard metrics, compact tables and a quick-action panel. It uses Segoe UI where available, bundled SVG icons and local styles; no external fonts, chart service or network requests are needed. Electron retains native window controls.

## Navigation

- **Overview** opens the dashboard. Shortcuts create a customer, medicine or purchase directly in the existing editor. Due reminders open the due/overdue view; upcoming reminders open scheduled cycles.
- **Customers** and **Medicines** use searchable tables with active/archived filters and existing edit/history actions. Customers retain their consolidated supply report.
- **Purchases** retains quantity entry, independent supply fields, preview, correction and cancellation. Quantity rows and supply sections stay separate so units never imply treatment duration.
- **Follow-ups** keeps customer-grouped contact/refill actions and due, scheduled, closed and all-cycle filters.
- **Reports** is the former History view: purchase history, details, audit records and matching CSV export. All export types are also available in Settings.
- **Settings** contains pharmacy details, owner password, CSV exports, encrypted backups and restore.

Navigation and shortcuts are disabled while a business draft is open. Locking keeps that draft until sign-in. A restore clears drafts and pending navigation. The status bar reports lifecycle state and the last verified local backup, including pending external copies. An unconfigured or locked backup shortcut opens Settings; an unlocked shortcut creates a verified archive.

## Dashboard definitions

Every number comes from the authenticated local database in one read transaction. The dashboard refreshes on entry, saved revisions, focus, the Refresh dashboard button and every minute while mounted.

| Display | Meaning |
| --- | --- |
| Active customers / medicines | Unarchived catalog records |
| Purchases today | Active customer purchases dated today in Asia/Kolkata; cancelled purchases excluded |
| Seven-day activity | Active purchase counts for today and the preceding six dates, including zero-count dates; no revenue estimate |
| Ending within five days | One effective supply per customer/medicine with run-out between today and today + 5, inclusive; future-starting refills do not hide current coverage |
| Overdue / due / scheduled | Open reminder cycles before today / on or before today / after today; closed and superseded cycles excluded |
| Customers to contact | Distinct customers with due or overdue cycles, not the number of medicines |
| Recent activity | Five latest customer, medicine, purchase, cancellation or follow-up audit events |

Run-out estimates are customer supply estimates, not inventory expiry dates. Archived catalog entries can still have historical supplies or open reminders; these remain visible until their workflows are resolved. Ending-soon and reminder previews show at most six rows; totals cover all matching records. Select a customer in a preview to inspect their supply report. Due/upcoming tables link to the complete follow-up views.

## Layout and accessibility

At wide sizes the grouped sidebar and right quick actions flank the dashboard. Below 1200 CSS pixels, quick actions move below the dashboard. Below 1000 CSS pixels, the sidebar collapses behind a labelled toggle. Narrower windows stack panels and forms. Tables scroll internally, while the main workspace scrolls independently of the top navigation and bottom status bar.

Buttons and fields retain visible keyboard focus, associated labels and existing save/validation behavior. Charts expose a text alternative with every date/count. Colors supplement visible labels. Windows display scaling and native date inputs still require the walkthrough in [Windows testing](WINDOWS_TESTING.md).

Billing, stock inventory, GST, accounts, clinical tests and cloud features pictured in the reference are outside the agreed business scope.
