# XLSX Card View — Claude Code Handoff

Lean session pickup. Reference content lives in `docs/`:

- **[docs/architecture.md](docs/architecture.md)** — what the code does. Module map, view modes, data model, mobile dashboard templates (3 gotchas), CSV helper architecture, path resolution, per-file config, settings shape. Read when changing plugin behaviour.
- **[docs/css-classes.md](docs/css-classes.md)** — every class in `styles.css` with where it lives and what owns it. Status color palette. Read when editing CSS or tracing a visual bug.
- **[docs/dev-workflow.md](docs/dev-workflow.md)** — project file tree, npm scripts, test surface, bench tool, manual test checklist, data.json shape. Read when running the dev loop or adding tests.

This file stays small on purpose so session startup doesn't eat the context window. If you add something that's stable reference material (not "this is what's currently happening"), put it in `docs/` and link from here.

---

## Session pickup

**Live data location**: `Knowledge/Library/` in the iCloud vault. The five xlsx files (movies, books, quotes, dictionary, habit_tracker) live there. `Mobile/`, `_csv_helpers/`, and `Archive/` are created by the plugin on first click of the respective buttons. The old `Knowledge/Test/` folder is legacy and can be deleted.

**All dev scripts already point at the new location** — `test-mobile-dashboards.mjs`, `regenerate-mobile-dashboards.mjs`, `normalize-stars.mjs`, `normalize-watched.mjs`. Search/replace `Knowledge/Library/` to retarget if the user moves the folder again.

**Last shipped**: see `git log --oneline -10`. Recent arc has been mobile-iPhone work: pre-fill of habit add-form by date, picker auto-close fix, toolbar overflow, kanban single-column on phones, search-input mobile overflow.

**Active dev loop**:
```
npm run build:deploy && npm run regen:mobile && npm run test:all
```
Then Cmd+R in Obsidian to reload. Drop `regen:mobile` if no mobile template changed. See [docs/dev-workflow.md](docs/dev-workflow.md) for the full command surface and bench numbers.

**Bundle**: 720 KB minified, lazy-loaded. Startup parse+eval 0.9 ms. SheetJS only initialises when an xlsx is opened; Chart.js only when dashboard renders. `node bench-load.mjs main.js` reproduces.

<a id="mobile-note"></a>**XLSX files now open natively on iPhone Obsidian** — discovered mid-session. Used to be folklore that this was impossible. Most likely it was always API-supported and only the previous eager-loaded SheetJS made the plugin fail-to-register fast enough on mobile webview. Lazy-load + minify tipped it over the threshold. Mobile bugs surface from here; the path was never designed for, so they're worth fixing eagerly as the user reports them.

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

- **CSV-only architecture (drop XLSX entirely).** User's original reason for xlsx-as-source was that hand-rolled CSV parsing broke on multiline cells. That parser is gone (Papa handles multiline-quoted fields correctly). With XLSX retired we'd shed SheetJS entirely (~700 KB lazy chunk → 0), drop the `_csv_helpers/` mirror complexity, and have one canonical format that Dataview already reads natively on mobile. Real work: convert existing xlsx → csv with a one-off script (preserve stars, quotes-in-quotes, embedded newlines), update `generateMobileFiles` to drop the helper-write path, remove SheetJS code + `loadXLSX` helper, update file-extension registration. Validate byte-stable round-trips for representative rows. Probably 2–3 commits + a normalization script. Big win in bundle size + simplicity.

- **main.ts at ~2300 lines.** The `src/view/{toolbar,table,kanban,dashboard,library,mobile}.ts` split is overdue but risky without DOM-level test coverage. Deserves a dedicated session and a minimal regression harness designed first.

- **regenerate-mobile-dashboards.mjs still has a parallel template copy** of what's in `src/mobile-templates.ts`. Eliminating needs a plain-JS rewrite so both `.ts` (esbuild) and `.mjs` (node) callers can import the templates without esbuild.

- **fileConfigs auto-detected with no override** — the current "auto" path for `cardFields` and `habitColumns` recomputes every render. Could cache once when first promoted. Minor.

- **Per-file view configuration — views themselves.** Currently `kanban-genre` and `table` are global and fixed. Future: per-file `views: ViewDefinition[]` so a movies file could declare "By Director" + "By Decade" instead of "By Genre". `ViewDefinition` would carry `type`, `label`, `groupCol`, `subgroupCol`. Toolbar renders buttons from the array; ⚙ Columns modal lets the user add/remove/rename.

- **Multi-value select for Category** — the picker sets a single string. Proper multi-select with individual chips would be better (comma-split for kanban columns already works on the read side).

- **Mobile UI polish backlog** — resize handles don't work on touch; some narrow-screen layouts still need iteration.

- **Mobile file opening** — historically tapping a CSV/XLSX file opened the system share dialog on mobile. As noted above this turned out not to be a hard limit — xlsx opens natively now. If we drop XLSX in the migration above, csv may also need re-validating on mobile.

---

## Two patterns worth carrying forward

1. **Measure before the perf claim.** `bench-load.mjs` is checked in for this reason. Lazy-loading SheetJS sounded obviously good but cost +47 KB minified before the eval win made the trade clearly worth it.
2. **One affordance per action.** If the user can click the thing, don't put a button next to it that does the same. Hover-tint, `cursor`, placeholder text. Several past UX commits deleted ceremony around things that already worked (kanban "Edit note" button, expander "Edit"/"Preview" toggle, table "⤢" inline button).
3. **Generated artifacts are not the source of truth.** Mobile dashboards are stamped from `src/mobile-templates.ts`. Manual `.md` edits get wiped the next "📱 Mobile" click. Fix bugs in the template, run `npm run regen:mobile`. (The simulator catches drift empirically.)
4. **Build the test harness before the third bug.** `test-mobile-dashboards.mjs` runs each dataviewjs block against a stubbed Dataview runtime backed by real CSVs. Turned "I think this works" into "the CI knows this works." Every subsequent feature was cheaper because the safety net was already there.
