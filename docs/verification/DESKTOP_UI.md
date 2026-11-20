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

## Purchase labels and calendar clicks — preview 0.1.2

Purchase rows use Quantity and Unit without numeric suffixes. Medicine supply sections use Supply start date, Days supplied, Refill choice, Remaining days adjustment (optional), and Manual reminder date (optional). Accessible groups retain the medicine name. The refill prompt is disabled and hidden from the option list; Extend and Replace remain selectable. Purchase, supply-start, manual-reminder and next-contact date fields open the native calendar when clicked anywhere, retaining keyboard entry and existing date limits.

`pnpm check` passes lint, formatting, all TypeScript configurations and 88 tests. Linux packaging and two targeted packaged Electron journeys pass: the existing purchase/correction/contact/refill/cancellation workflow and a new two-medicine purchase check. The latter verifies independent quantities, units and supply choices, keyboard refill selection, and successful native picker calls from clicks on date text, blank space and the icon, followed by date entry and saving. Windows-native calendar behavior and installation of the rebuilt preview still require testing on Windows 10/11 as described in the Windows walkthrough.

## Purchase form actions

Purchases now place Clear, Save and Discard together beneath the supply-preview instruction and button. Clear restores the opening draft: defaults for a new purchase, original saved values for a correction, or the preselected customer/medicine for a refill. It removes the preview and requires a new successful preview before saving. Returning from inline catalogue creation retains the purchase's original reset baseline. Discard closes the purchase without deleting catalogue records already saved inline. The existing disabled fieldset protects all actions during work and uncertain submissions.

Validation: `pnpm check` passes all 88 tests, lint, formatting and TypeScript checks; Linux packaging succeeds. Three targeted packaged desktop journeys pass, covering correction/refill reset, inline creation and navigation, new purchase reset/discard, preview invalidation and frozen controls after an uncertain purchase save. Windows-native verification remains pending.

## Back navigation

Forms have a destination-labelled Back button above the heading. The existing modal defaults to Continue editing; Escape keeps the draft, and Discard and leave returns to the previous view. Inline creation preserves its parent purchase, while correction/cancellation returns to purchase details. Pending or uncertain saves disable Back; lock/lifecycle transitions dismiss the popup without losing the draft.

Purchase details remember whether they opened from a list, related purchase history or current supplies. Supply and history panels expose Back to their list, and contact history can return to follow-ups. Lists and report panels remain mounted but hidden during editing so nested searches and pagination survive a return. Back restores keyboard focus to the destination. Main tabs retain their existing navigation.

Validation: `pnpm check` passes lint, formatting, all three TypeScript configurations and 88 tests. Linux packaging succeeds and all 26 packaged desktop journeys pass. Added/extended checks cover Back confirmation and Escape, inline parent preservation, return from corrections through supply views, related purchase history, search/status/page retention, focus restoration, uncertain-save blocking and locking with the popup open. The customer-form screenshot shows the top Back control. Windows-native testing remains pending.

## Dedicated views — preview 0.1.3

Customer/medicine purchase history, purchase details, current supplies, contact history and purchase audit history now occupy dedicated views within the existing window. The parent list or report remains mounted and hidden to retain search, filters and pagination. Headings receive focus and new views start at the top; primary-tab keyboard navigation keeps focus on the tab bar. Selecting the active business tab returns to its list. Dashboard entry views return to Overview, including unsaved-form confirmation.

Settings now links to separate backup and CSV-export views, with matching sidebar shortcuts. Pharmacy settings drafts survive opening those views. Verified restores show a focused review with explicit RESTORE confirmation; Back cancels the preview through the existing API. Navigation remains blocked during active backup/export work and while a restore review awaits cancellation or confirmation. Backend storage and restore behavior are unchanged.

Validation: `pnpm check` passes lint, formatting, all three TypeScript configurations and 88 tests. Linux packaging succeeds. All 29 packaged desktop journeys pass on the final build, including customer and medicine histories with 21 purchases, page/search retention, one visible view at a time, audit/contact history, supply-source navigation, Settings separation, cancel/reopen/confirm restore review, dashboard Back destinations and primary-tab keyboard navigation. Screenshots are generated as `dedicated-purchase-history.png`, `dedicated-purchase-details.png` and `backup-restore-preview.png` under ignored `test-results/`. Windows 10/11 installer and native UI verification remain pending.
