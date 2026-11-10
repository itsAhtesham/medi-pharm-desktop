# Current supplies and CSV exports

## Consolidated customer supplies

Open **Customers → View current supplies**. The report has one row per medicine represented by an included supply on an active purchase. It is searchable and paginated, and archived customers/medicines remain visible for reference.

- **Coverage today** uses the latest supply that has actually started, in purchase-date/sequence order. Remaining days are a date-based estimate, never a count of physical stock. A run-out today shows zero remaining days; an expired supply is labelled exhausted.
- **Latest recorded supply** shows its start, new/carried days, run-out and a link to its purchase. It can start in the future. The earliest future supply start is shown separately so planned stock is not mistaken for coverage available today.
- **Latest supply reminder** shows disabled, due, overdue, scheduled or manually closed, with next/last contact and closure reason where applicable. It refers to the latest recorded supply cycle; recording a later supply supersedes the preceding reminder even if that later supply starts in the future.

Cancelling or correcting purchases changes the report through the existing chain reconciliation. Removed medicine rows and cancelled purchases do not contribute. Medicine labels use the current catalogue; source purchase details retain their dated labels. The report refreshes after commits, on focus and at least every minute while the workspace is available.

## Export scope

Use **Export CSV** on Customers, Medicines, Purchases, History or Follow-ups. This exports all records matching the displayed search/status filters across all pages. Follow-ups also offer **Export matching follow-up history**; its filters select cycles, then include their events.

Use **Settings → CSV exports** for the whole dataset, including archived catalogue entries, cancelled purchases and all reminder cycles.

| Export | One data row represents | Included details |
| --- | --- | --- |
| Customers | Customer | Name, displayed phone, optional age, notes and active/archive state |
| Medicines | Catalogue entry | Name, strength, form and active/archive state |
| Purchases and items | Purchase medicine/unit row | Purchase number/date/status, customer, dated medicine labels, exact quantity, unit, supply inputs/estimates and purchase notes |
| Follow-up cycles | Medicine reminder cycle | Customer/medicine, purchase number, current status, next contact, run-out, last contact, closure |
| Contact and follow-up history | Recorded event | Cycle context plus event time/action/note and before/after status/contact date/closure reason |

Multiple units repeat the shared medicine supply fields in the purchase export; do not sum those repeated day counts. Purchase filters select purchases and export all their quantity rows. Contact-history context describes the cycle now; the event columns capture the dated change. Business dates use Asia/Kolkata; event timestamp columns explicitly use UTC. Authentication tables, password/recovery hashes and device keys are excluded.

## Saving and spreadsheet handling

Choose the destination in the native save dialog. Cancelling creates no report. Selecting an existing regular CSV permits replacement after the native overwrite confirmation; a file changed during export is refused. The application data directory, symlink destinations and non-CSV filenames are rejected.

Rows are written incrementally to a private sibling `.partial` file from one database read transaction. The temporary file is flushed and closed before publication. Failures before publication preserve an existing destination and attempt to remove the partial. A disconnected drive or process termination may retain an incomplete partial; only the chosen `.csv` is a completed report. An unconfirmed response or final disk flush reports uncertainty—inspect the destination before retrying. Exports pause other workspace operations and have a 90-second row-processing limit; narrow the search if that limit is reached.

The format is UTF-8 with a BOM, comma delimiters, quoted cells and CRLF row endings. Quotes are doubled; embedded line breaks are retained. Dangerous spreadsheet formula prefixes, including leading whitespace/control prefixes, receive an apostrophe so the cell is treated as text. This apostrophe can be visible in some import tools. Import phone columns as text to preserve leading zeros. Spreadsheet behavior still requires verification in the actual Windows spreadsheet application.

CSV files are **unencrypted** and contain customer data. They are portability reports, not complete backups and not an import format. Keep using the [encrypted backup workflow](BACKUP_USAGE.md) for recovery.
