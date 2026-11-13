# Desktop interface verification

Implemented 11 November 2026. This covers the reference-inspired desktop shell and authenticated dashboard read model; the original business, storage and backup workflows remain in place.

## Automated evidence

- `pnpm check`: 88 passing tests in 16 files, including lint, formatting and all three TypeScript configurations.
- `pnpm package`: Linux x64 production bundle/package succeeds.
- Packaged Electron: the 18 existing journeys pass, covering setup/login, isolation, lifecycle, keyboard navigation, backups, restore, business mutations, draft preservation, supply reports and CSV export.
- The added dashboard journey passes independently after correcting its locked-state expectation: the main process rejects reads with `NOT_READY` before the service's authentication check. It covers direct editor shortcuts, locked-read rejection, draft retention, saved counters, real purchase-chart data, customer supply links, due filtering, backup setup fallback and verified backup creation from the dashboard.
- Dashboard integration cases cover zero records, the Asia/Kolkata midnight boundary, archived catalogs, cancelled purchases, distinct-customer versus cycle totals, future-starting refills, cancellation fallback, six-row previews with complete totals, snoozes, closure and unauthenticated service access.

## Visual/layout evidence

The packaged dashboard is exercised at 1920×1080 and 1366×768 at 100%, and 1366×768 at 125% and 150% Electron zoom. Checks wait for the expected CSS viewport, verify document/workspace overflow and key element bounds, and exercise sidebar collapse and reachable customer actions.

Screenshots are generated under ignored `test-results/`:

- `dashboard-1920-1.png`
- `dashboard-1366-1.png`
- `dashboard-1366-1.25.png`
- `dashboard-1366-1.5.png`

These use Electron's native `capturePage`; CDP page screenshots can crop the zoomed window. Records and backup timestamps in captures come from disposable synthetic test profiles. No fixture data is imported into the installed application.

## Remaining platform checks

Linux packaging and Electron zoom checks do not certify Windows display scaling, native date/save controls, DPAPI, filesystem behavior, installer execution or Windows 10 compatibility. Follow the dashboard section of [Windows testing](../WINDOWS_TESTING.md) on the Windows 11 laptop and a Windows 10 test system. Existing signing, migration, archive-size and load-verification release gates remain open.

## Colour refinement

The subsequent colour pass adds workflow-specific navigation/editor accents, two-tone SVG icons with coloured badges, soft card gradients and stronger dashboard accents. Neutral record tables and labelled statuses are retained. Lint, formatting, all TypeScript configurations and Linux packaging pass; the existing packaged keyboard-navigation and dashboard/size/zoom journeys pass (2 tests). No business or storage behavior changed in this pass.

## Neutral background and icon contrast

The next visual refinement replaces the blue-tinted workspace, sidebar, panels, forms and tables with white/grey surfaces and charcoal framing. Section colour is concentrated in solid icon badges and accent borders; white SVG strokes are thicker for clearer contrast. Lint, formatting, TypeScript checks, Linux packaging and the existing packaged dashboard/zoom journey are the validation scope for this styling-only update.

## Form actions and draft navigation — preview 0.1.1

Customer and medicine editors now present Clear, Save and Discard together. New forms reset to defaults; existing edits reset to the originally loaded values/version. Inline reset/discard preserves the parent purchase, while confirmed navigation discards the whole unsaved workflow. Tabs and shortcuts open a modal confirmation instead of being disabled by an ordinary draft. Continue editing and Escape retain values; a lifecycle transition away from ready cancels pending navigation. Saves in progress or with unknown results still block navigation and reset/discard.

Validation: `pnpm check` passes all 88 unit/integration/recovery tests; Linux packaging succeeds; all 23 packaged desktop journeys pass. Four added journeys cover customer and medicine reset/save/discard, default dialog focus and Escape, continuing versus switching, inline parent preservation and shortcut targets, and uncertain-save protection across lock/sign-in. The customer case additionally checks locking while the popup is open. Screenshots are generated as `test-results/customer-form-actions.png` and `test-results/discard-navigation.png`. Windows-native behavior and installation of the rebuilt 0.1.1 preview still require testing on the Windows laptop.
