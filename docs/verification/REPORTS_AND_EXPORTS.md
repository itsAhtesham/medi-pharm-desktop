# Supply reports and CSV export verification

Implementation follows `c8180f8`; the commit introducing this report identifies the source under test. Verification uses Linux x64, Node 24.15.0, pnpm 10.33.4 and the pinned Electron/native SQLite toolchain.

## Implementation

- Customer supply query runs in one read transaction, pages distinct medicines, and distinguishes effective coverage from future starts and the latest recorded supply. Cancelled/removed supplies are excluded, archive states retained, and reminder/contact/closure state shown separately.
- Exact validated export variants cover customers, medicines, purchases/items, follow-up cycles and events. Renderer input includes only export kind/filters. Main owns native selection; the service owns database reads and destination writing.
- CSV uses a SQLite iterator and per-row UTF-8 encoding rather than collecting the full dataset or passing customer data through main IPC. One read transaction provides a consistent database view; the serialized service and maintenance state prevent overlapping writes. Row processing is limited to 90 seconds; broker timeout is at least 120 seconds.
- Native overwrite confirmation precedes existing-file replacement. A private sibling file is created exclusively, flushed, closed and atomically renamed; destination identity/stat checks detect changes during export. Internal data-directory paths, symlink targets and invalid extensions are refused. Failure cleanup and uncertainty messages preserve the distinction between a failed write and lost confirmation.
- CSV values are quoted, quotes doubled, Unicode/newlines retained and formula prefixes escaped. Readable explicit columns exclude account credentials/device secrets. History exports include before/after event fields rather than internal JSON blobs.
- Vitest workers are capped at two because file-backed integration fixtures exercise real memory-hard KDFs. The larger parallel suite exposed a five-second timeout in the unchanged owner-recovery test; that test passed in isolation. Production hashing costs and test timeouts are unchanged.

## Checks

- `pnpm check`: lint, formatting, all three TypeScript configurations and **84 tests across 15 files passed** with bounded worker concurrency.
- `pnpm package`: Linux x64 packaged preview built successfully with native SQLite.
- `pnpm test:desktop`: **all 18 packaged journeys passed** with Chromium sandbox enabled, including current coverage/reminder display, source purchase links, filtered export across the native boundary, empty exports, overwrite/cancellation, internal-path rejection, full contact-history export, invalid kind/path input rejection and locked-workspace authorization.
- The cancelled native-dialog test fixture was subsequently adjusted to use Electron's typed empty-string path; the CSV-specific journey was rerun before committing.
- The consolidated supply screen was visually inspected. `git diff --check` passed. No schema, dependency or lockfile changes were needed.

Coverage includes more than one page of customers, every export variant, empty selections, filter parity, dated medicine snapshots, exact mixed-unit quantities, archived/cancelled records, contact events, formula/quote/Unicode handling, invalid inherited-property export names, authorization, internal/symlink/missing destinations, partial-write failure, destination races, removed destinations and retry after cleanup. Supply tests cover future refills, cancellation restoration, disabled reminders, exhausted/today coverage, archived entries, contact/manual closure, search and pagination.

## Remaining platform gates

Actual Windows 10/11 execution, native overwrite prompts, Excel/import rendering, locked files, removable-drive unplug/full-volume behavior and hardware durability remain unverified from Linux. Injected failures and directory removal exercise cleanup paths; they do not certify physical disk-full or power-loss behavior. Large production datasets and minimum-hardware latency still need release-scale measurement. See [Windows testing](../WINDOWS_TESTING.md).
