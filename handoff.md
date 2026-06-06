# CSV Card View — Claude Code Handoff

Lean session pickup. Reference content lives in `docs/`:

- **[docs/architecture.md](docs/architecture.md)** — what the code does. Module map, view modes, data model, mobile dashboard templates (3 gotchas), CSV helper architecture, path resolution, per-file config, settings shape. Read when changing plugin behaviour.
- **[docs/css-classes.md](docs/css-classes.md)** — every class in `styles.css` with where it lives and what owns it. Status color palette. Read when editing CSS or tracing a visual bug.
- **[docs/dev-workflow.md](docs/dev-workflow.md)** — project file tree, npm scripts, test surface, bench tool, manual test checklist, data.json shape. Read when running the dev loop or adding tests.

This file stays small on purpose so session startup doesn't eat the context window. If you add something that's stable reference material (not "this is what's currently happening"), put it in `docs/` and link from here.

---

## Session pickup

**Live data location**: `Knowledge/Library/` in the iCloud vault. The five canonical CSV files (movies, books, quotes, dictionary, habit_tracker) live there. `Mobile/` and `Archive/` are created by the plugin on first click of the respective buttons. The old `Knowledge/Test/` folder is legacy and can be deleted.

**XLSX support retired** (commit "SWITCH TO CSV AS MAIN"). The plugin is CSV-only — `registerExtensions(["csv"])`, no SheetJS, no `_csv_helpers/` mirror. The migration script (`migrate-xlsx-to-csv.mjs`) preserved the original xlsx files in `Knowledge/Library/Archive/<basename>_pre-csv-migration.xlsx` if anything needs to be recovered. The lossless-ness was verified by `xlsx-to-csv-roundtrip.mjs` (all 10 cell-by-cell checks passed) before any data was touched.

> **Why this matters beyond bundle size:** the `_csv_helpers/` mirror existed solely because Dataview on mobile couldn't parse xlsx. It was a one-way shadow of the xlsx source, kept in sync on every save via three separate code paths (`doSave()`, `generateMobileFiles()`, and the `csv-add` submit handler). With csv as the canonical format, Dataview reads it directly. **One file, zero sync, zero possibility of drift between source and read-target.** If you find yourself reintroducing a "secondary copy of the data" pattern for any reason, push back hard — it's the bug class this migration eliminated.

**XLSX imports going forward**: deliberately not in-plugin. If you get an xlsx, adapt `migrate-xlsx-to-csv.mjs` (CLI script, takes ~10 seconds). Considered and rejected: a palette command "Import XLSX → CSV" that lazy-loads SheetJS as a separate chunk. Lazy-chunk-wise it wouldn't bloat startup, but for a single-user vault that's done migrating, it's dead code. Status quo: csv-native plugin, standalone converter for the rare inflow case.

**All dev scripts already point at the new location** — `test-mobile-dashboards.mjs`, `regenerate-mobile-dashboards.mjs`, `normalize-stars.mjs`, `normalize-watched.mjs`. Search/replace `Knowledge/Library/` to retarget if the user moves the folder again.

**Last shipped**: see `git log --oneline -10`. Recent arc has been mobile-iPhone work: pre-fill of habit add-form by date, picker auto-close fix, toolbar overflow, kanban single-column on phones, search-input mobile overflow, then the CSV-only migration.

**Active dev loop**:
```
npm run build:deploy && npm run regen:mobile && npm run test:all
```
Then Cmd+R in Obsidian to reload. Drop `regen:mobile` if no mobile template changed. See [docs/dev-workflow.md](docs/dev-workflow.md) for the full command surface and bench numbers.

**Bundle**: 297 KB minified (down from 720 KB pre-migration — SheetJS removed). Startup parse+eval ~0.7 ms. Chart.js still lazy-loaded for the dashboard view. `node bench-load.mjs main.js` reproduces.

---

## Mobile gotchas

Anything that touches input focus / picker positioning / viewport sizing on mobile needs to reckon with these. They've each cost a session-debug cycle before.

- **iOS virtual keyboard fires `resize`.** Focusing an input pops the keyboard which fires `resize`. Don't dismiss UI on resize (or detect `matchMedia("(pointer: coarse)")` and skip). The picker's scroll/resize listeners are gated this way in `showSelectPicker` in `src/utils.ts`.
- **csv-add date input** does NOT pre-fill for non-habit shapes. For habit shapes (file has a date column), it pre-fills binary toggles + text fields + notes from the matching row, the title flips to "Updating ‹date›", and the submit button reads "Update" (vs "Add"). Card gets `.is-updating` class for the accent ring.
- **Toolbar uses `flex-wrap: wrap`** + `@media (max-width: 600px)` block that hides the filename title and row-count chip to keep action buttons visible.
- **By-genre kanban uses CSS scroll-snap on mobile** so each column is exactly `calc(100vw - 60px)` and swipe lands cleanly on the next one. Desktop columns (260–300px) showed 1.5-columns-side-by-side on phones, which read as broken.
- **Mobile search input**: focus pseudo-class expands to `width: 220px` on desktop, which would overflow the toolbar on phones — mobile media query uses `width: 100% !important` to defeat the focus rule's specificity. Wrap has `min-width: 0` so flex can actually shrink it.

---

## Open follow-ups

- **main.ts at ~2300 lines.** The `src/view/{toolbar,table,kanban,dashboard,library,mobile}.ts` split is overdue but risky without DOM-level test coverage. Deserves a dedicated session and a minimal regression harness designed first.

- **regenerate-mobile-dashboards.mjs still has a parallel template copy** of what's in `src/mobile-templates.ts`. Eliminating needs a plain-JS rewrite so both `.ts` (esbuild) and `.mjs` (node) callers can import the templates without esbuild.

- **fileConfigs auto-detected with no override** — the current "auto" path for `cardFields` and `habitColumns` recomputes every render. Could cache once when first promoted. Minor.

- **Per-file view configuration — views themselves.** Currently `kanban-genre` and `table` are global and fixed. Future: per-file `views: ViewDefinition[]` so a movies file could declare "By Director" + "By Decade" instead of "By Genre". `ViewDefinition` would carry `type`, `label`, `groupCol`, `subgroupCol`. Toolbar renders buttons from the array; ⚙ Columns modal lets the user add/remove/rename.

- **Multi-value select for Category** — the picker sets a single string. Proper multi-select with individual chips would be better (comma-split for kanban columns already works on the read side).

- **Mobile UI polish backlog** — resize handles don't work on touch; some narrow-screen layouts still need iteration.

- **Travel / world-map view — SHIPPED.** Read-only `"travel"` view mode for CSVs carrying `country` (ISO-2) + `date_entered`/`date_left` + `source` (`confirmed|inferred|conflict`). Code: `src/travel-data.ts` (DOM-free analysis + country/continent reference data, unit-testable) and `src/travel-view.ts` (render). Wired in `main.ts` via `isTravelFile()` (auto-defaults to travel, toolbar "Travel" button, dispatch branch) + `loadMapSvg()`. Renders: stats row, interactive choropleth (gold=confirmed, blue=photo-only), per-country day totals, year-by-year timeline, confirmed trips table + collapsed photo-inferred + collapsed conflicts. **Map asset:** `world-map.svg` (integer-quantized to ~113 KB, 122 ISO paths) ships *beside* the bundle and is read at runtime from `${configDir}/plugins/csv-card-view/world-map.svg` — kept out of `main.js` (bundle only grew +12 KB). `npm run deploy` now copies it. Validated: `analyzeTravel` is unit-tested against a synthetic fixture (`sample-data/travel_flat.csv`) — source-filtering, day totals, overlap masking, blue-only set. Source file = a flat CSV emitted by the external `travel.py`. Not yet exercised live in Obsidian (this sandbox can't write the iCloud plugin folder — see deploy note below). **Overlap / dedup rule (implemented): confirmed is authoritative.** (1) Drop all `source==conflict` rows from the map, timeline, and counts — a conflict row is a flagged copy of an inferred row that contradicts a confirmed one. Optionally surface them in a collapsed review list (the blueprint shows a `[!danger]` callout); excluded from viz/counts either way. (2) Use an inferred row only where it does *not* overlap any confirmed range (see `overlapsConfirmed`); overlapping inferred is redundant or contradicted → skip it. This is what prevents double-counting days. Sharp edge: `overlapsConfirmed` drops the *entire* inferred segment on any overlap, so a long inferred stay containing a short confirmed trip vanishes — acceptable, because those are exactly the conflict cases and confirmed + the conflict log preserve the signal. (3) **Map layering — don't drop all inferred:** gold = confirmed countries; blue = countries seen *only* via non-overlapping inferred rows. Dropping all inferred erases the photo-only countries that are most of the blue layer. (4) Blank and partial dates (`2022-06-??`) exist → visited-but-undated, min-1-day for real ranges. Keep the map SVG a *loaded asset*, not inlined in the bundle, and quantize it (~50% lighter, topology-preserving, `keep-shapes` so MC/MT/LI survive). Open framing question: travel-specific view vs. a generic "geo/choropleth view for any CSV with a country column" — the latter is the reusable one. Residency math stays out (next item).

- **Residency / threshold rules — SHIPPED.** Structured rules (no DSL): `ResidencyRule {label, scope:{country|countries}, window:{calendar-year|rolling:N|all-time}, threshold, exempt:{visa_status:[…]}, onExceed, note}` in `types.ts`, with a neutral `DEFAULT_RESIDENCY_RULES` (one Schengen 90/180 example) + `SCHENGEN` set. Pure evaluator in `src/residency.ts` (`evaluateResidency(rule, trips, today)`) reduces each to one primitive — days in scope within window, minus exempt rows, vs threshold — rendered as a used/threshold gauge by `renderResidency` in travel-view (gold/green/amber/red status, window label, note, disclaimer). Counts **confirmed trips only**, date_entered inclusive / date_left exclusive, clamped to window. 6 unit tests with a fixed `today` over synthetic data (calendar-year clamping, exemption, rolling, all-time, status). Settings: `showResidency` toggle + a full **in-app rule editor** (`renderResidencyRules` in the settings tab — add/remove rules, edit countries/window/threshold/exempt/onExceed/note). `loadSettings` deep-clones `residencyRules` so the editor never mutates the shared default constant. **Privacy:** committed `DEFAULT_RESIDENCY_RULES` is a single neutral Schengen example — personal jurisdiction rules live only in `data.json` (deployed plugin folder, never in the repo). Tests use synthetic data (XA/XB), not real trips. **Follow-up:** SPT prior-year ⅓/⅙ weighting + UK tiered test not modeled — labelled "indicators, not legal advice" + per-rule `note`. A `weighting` field on ResidencyRule is the place to add it.

- **Travel map tooltip hit-area / tiny-country tuning — tune by eye in the live map.** The hover tooltip + invisible hit halo for micro-states (shipped: instant cursor-following tooltip, `.cp-tiny` transparent-stroke halo) use two magic numbers that were set by reasoning, never validated against the rendered map: the `< 12`px tiny-country threshold in `injectMap` (`src/travel-view.ts`) and the `stroke-width: 3` halo in `.csv-tv-map .country-path.cp-tiny` (`styles.css`). Open the travel view and check the small ones — if halos feel "grabby" (a micro-state stealing hovers from a larger neighbour), lower the stroke-width; if tiny nations are still hard to land on, raise the threshold and/or the stroke-width. Those two values are the only dials.

- **Mobile file opening** — historically tapping a CSV/XLSX file opened the system share dialog on mobile. As noted above this turned out not to be a hard limit — xlsx opens natively now. If we drop XLSX in the migration above, csv may also need re-validating on mobile.

---

## Two patterns worth carrying forward

1. **Measure before the perf claim.** `bench-load.mjs` is checked in for this reason. Lazy-loading SheetJS sounded obviously good but cost +47 KB minified before the eval win made the trade clearly worth it.
2. **One affordance per action.** If the user can click the thing, don't put a button next to it that does the same. Hover-tint, `cursor`, placeholder text. Several past UX commits deleted ceremony around things that already worked (kanban "Edit note" button, expander "Edit"/"Preview" toggle, table "⤢" inline button).
3. **Generated artifacts are not the source of truth.** Mobile dashboards are stamped from `src/mobile-templates.ts`. Manual `.md` edits get wiped the next "📱 Mobile" click. Fix bugs in the template, run `npm run regen:mobile`. (The simulator catches drift empirically.)
4. **Build the test harness before the third bug.** `test-mobile-dashboards.mjs` runs each dataviewjs block against a stubbed Dataview runtime backed by real CSVs. Turned "I think this works" into "the CI knows this works." Every subsequent feature was cheaper because the safety net was already there.
