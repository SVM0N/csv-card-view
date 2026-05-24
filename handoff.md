# XLSX Card View — Claude Code Handoff

## Session pickup

**Live data location**: `Knowledge/Library/` in the iCloud vault. Holds the five xlsx files (movies, books, quotes, dictionary, habit_tracker). `Mobile/`, `_csv_helpers/`, and `Archive/` are created as needed by the plugin on first click of the respective buttons. The old `Knowledge/Test/` folder is legacy and can be deleted.

**All paths in the dev scripts already point at the new location** — `test-mobile-dashboards.mjs`, `regenerate-mobile-dashboards.mjs`, `normalize-stars.mjs`, `normalize-watched.mjs`. Search/replace `Knowledge/Library/` to retarget again if the user moves the folder once more.

**Last shipped (commit `5caea8b`)**: picker arrow-key nav + Enter to commit. Capped a 14-commit session ("What else can we improve?") that ran four themes — stability quick-wins, perf, UX polish, and an honest before/after benchmark. 115 tests green (88 logic + 21 mobile + 6 csv). See **2026-05-23 session arc** below for the full breakdown.

**Active dev loop**:
```
npm run build:deploy && npm run regen:mobile && npm run test:all
```
(then Cmd+R in Obsidian to load the new plugin)

**Bundle now minified, lazy-loaded**: 1338 KB unminified-eager → 720 KB minified-lazy. Startup eval down from 3.4ms to 0.9ms because SheetJS no longer initialises until an xlsx is opened, and Chart.js no longer initialises until the dashboard view renders. `node bench-load.mjs main.js` reproduces the numbers anytime — keep an eye on parse+eval after big refactors.

**Watch mode** is unminified with inline sourcemaps (`npm run dev`); only production builds (`npm run build` / `build:deploy`) minify. So devtools in Obsidian is readable during dev.

**`fileConfigs` keys now follow renames/deletes** — the longstanding orphan-on-rename gotcha is fixed via a `vault.on("rename")` / `vault.on("delete")` hook. Old `Knowledge/Test/...` entries in your live `data.json` may still be orphaned from before the fix — hand-edit if you want them back; otherwise auto-detection runs from scratch.

---

## 2026-05-23 session arc — "what else can we improve?"

Open-ended brief: stability, UX, mobile, refactor, load speed. Worked four themes across 14 commits, all 115 tests green between each.

### Stability quick wins (4 commits)
- `eb594da` **fix(csv): replace hand-rolled parser with Papa wrapper.** The desktop view's `parseCSV` split on `\n` before parsing quoted fields, silently truncating any cell with embedded newlines (long Notes/Quote columns). Papa was already imported for 4 other paths. One `parseCSV` wrapper in `src/utils.ts` now backs every call site. Also dropped two orphaned `parseCSV` / `escapeCSV` copies from a prior refactor that were never wired up. Embedded-newline test now asserts the fix; duplicate-header test pins Papa's `_N` rename.
- `812f422` **fix: surface load/save errors to the user.** Both `onLoadFile` and `doSave` caught and `console.error`-only-ed. A read failure left an empty view; a save failure looked like "my edits stuck" until reload. Now both emit a `Notice`. The inline CSV serializer in `doSave` also swapped to `Papa.unparse` so `\r` round-trips properly.
- `d67a667` **feat: follow file renames/deletes in fileConfigs.** Longest-open handoff item. Renaming/moving a file in Obsidian no longer orphans its per-file config (cardFields, defaultMode, etc.). Implemented as a tiny pure helper (`migrateFileConfigKey` in utils) backed by `vault.on("rename")` and `vault.on("delete")` hooks. 4 new tests on the helper.
- `70c39c6` **refactor: pass saveSettings callback into the view.** `XLSXCardView.saveFileCfg()` previously reached back through `(this.app as any).plugins.plugins["csv-card-view"]?.saveSettings()` — brittle and untyped. Constructor now takes a typed `persistSettings: () => Promise<void>` callback. No behaviour change; coupling is explicit.

### Perf (2 commits, real numbers)
Bench captured with `bench-load.mjs` (committed) — `node bench-load.mjs main.js`, 5-run averages, measures V8 parse cost on the bundle text and parse+top-level eval.

| Stage | Size | Parse only | Parse+eval |
|---|---|---|---|
| Eager + unminified (before) | 1338 KB | 2.6 ms | 3.4 ms |
| Lazy + unminified | 1533 KB | 2.0 ms | 0.8 ms |
| **Lazy + minified (now)** | **720 KB** | 1.5 ms | 0.9 ms |

- `1150c9e` **perf: lazy-load SheetJS and Chart.js.** Both were static imports, so SheetJS's lookup tables and Chart.js's component registration ran every plugin enable, even before any xlsx/dashboard opened. Now wrapped behind cached `loadXLSX()` / `loadChart()` helpers using dynamic `import()` with TS `import type` for the type-only references. esbuild's cjs output keeps the modules bundled but defers their factory bodies. SheetJS only paid when an xlsx is opened, edited, or written to by the mobile `csv-add` form; Chart.js only paid when dashboard renders. Dashboard chrome paints synchronously; chart lands a tick later with an `isConnected` guard against detached canvases.
- `41a45d8` **build: minify production output (50% smaller bundle).** `esbuild.config.mjs` had `minify: false` always. Now production minifies; watch mode keeps minify off + adds inline sourcemaps so devtools stays readable during dev.

### UX polish (8 commits)
Theme: every visible affordance should do what it advertises, or stop advertising. Drop redundant ceremony; one good affordance beats two competing ones.

- `3ec69ce` **fix(kanban): consolidate scroll — one scrollbar per direction.** Page was y-scrolling AND each column was y-scrolling. Now `.csv-content-area--no-yscroll` modifier (toggled per-mode) hides the outer y-scroll in kanban; board uses `align-items: stretch`; column bodies fill viewport via `min-height: 0` (the flex-min-content trap) instead of the prior arbitrary `max-height: 70vh`.
- `73ec676` **ux: replace redundant edit buttons with click-to-edit affordances.** Three places had a "click here to edit" button next to a thing that was already click-to-edit:
  - **Kanban card**: dropped "✏️ Edit note". Preview is itself the editor; shows "+ Add note" (quiet, hover-revealed) when empty.
  - **NoteExpander modal**: dropped "✏️ Edit" / "👁 Preview" toggle. Click rendered markdown enters edit; blur or Escape returns to preview. Links/buttons inside the note pass through (still clickable); text-selection inside the note doesn't hijack to edit. Empty state is "+ Add note" and is itself click-to-edit.
  - **Table notes cell**: dropped the inline "⤢" button. Cell-click already opened the expander.
- `ce9077b` **ux(kanban): wire the title click — it was styled clickable but did nothing.** Title rendered with `cursor: pointer` and a dotted underline (a promise nothing kept). Now opens the expander. Also dropped a card-level `click → stopPropagation` no-op.
- `e6a8c6f` **feat: undo for deletes.** Every delete path (modal Delete, kanban right-click, table ✕) routes through a `deleteWithUndo(row)` helper that pops a 6s Notice with an Undo button. Restore preserves the original index (clamped if other deletes/adds shifted the array). Modal's `window.confirm` stays — that path is decisive; undo is the safety net for the lighter-weight paths.
- `d81bccd` **fix(picker): dismiss on scroll/resize, flip up at viewport bottom.** Fixed-positioned picker was anchored to viewport coords at open time and never updated, so scrolling left it floating detached. Now scroll on any ancestor (capture-phase listener) dismisses, matching native `<select>`. Resize too. Open position flips above the anchor when there isn't room below. While in there, every dismiss path routes through a single `dismiss()` so the new listeners are always cleaned up.
- `2909347` **feat: friendly empty states for empty files.** "Empty or unreadable file." → distinguished into "This file is empty" (no headers) and "No entries yet" (headers but no rows, with a "+ Add the first entry" CTA + a hint listing detected columns).
- `010cb41` **feat: right-click parity across kanban, library, and table.** Previously only kanban had a context menu. One shared `openRowContextMenu` helper now backs all three views: Open notes file, Open entry, Mark as: <each non-current status>, Delete (uses the new undo flow).
- `5caea8b` **feat(picker): arrow-key navigation + Enter to commit.** Typing in search narrowed the list but committing still required mousing. Now ↓/↑ wraps, Enter commits the cursor's pick, cursor resets to first match each filter change, scrollIntoView keeps it visible. Same `--hover` class for keyboard + mouse so the visual is consistent.

### Two patterns worth carrying forward
1. **Measure before the perf claim.** Lazy-loading SheetJS sounds obviously good, but the bench showed bundle GROWING +47KB minified (async wrappers cost something) before the eval win (3.3 → 0.9 ms) made the trade clearly worth it. Without numbers the trade would have been invisible. `bench-load.mjs` is checked in — use it next time someone proposes a refactor that "should be faster."
2. **One affordance per action.** Every commit in the UX block deleted ceremony around something that already worked. The principle is consistent: if the user can click the thing, don't put a button next to it that does the same thing. Keep one obvious affordance and make it visually discoverable (hover-tint, `cursor`, placeholder text).

---

## Final reflection (multi-session arc)

This codebase started the session as a working Obsidian plugin with a brittle mobile dashboard story. The arc went:

1. **Stop the bleeding** — three reported mobile bugs (books crashed on `1984.localeCompare`, quotes showed "Untitled" everywhere, movies showed "No" pills). Patching the generated `.md` files seemed obvious but turned out to be a trap because they're regenerated from `main.ts` templates on each "📱 Mobile" click. The right fix lives in the source.

2. **Build a regression net before more changes** — `test-mobile-dashboards.mjs` extracts each dashboard's `dataviewjs` block and runs it against a stubbed Dataview runtime backed by the real CSVs (Papa Parse with `dynamicTyping: true` so the `1984` Number coercion reproduces). This single investment paid off repeatedly: every subsequent change ran through it and surfaced regressions empirically rather than via user reports. A second tool, `regenerate-mobile-dashboards.mjs`, mirrors the plugin's dispatcher so dashboards can be stamped headlessly — no reload-Obsidian-and-click-five-buttons loop.

3. **Hand-tuning each file shape doesn't scale** — fixing movies to show year/rating/theme/green-dot via mobile-specific code was the easy path; refactoring Library into a single data-driven render that walks a `cardFields` list was the right one. The same logic now serves books, movies, quotes, and any future file shape. The Columns modal gained a checkbox grid so users override the auto-detection without editing code.

4. **Portable paths beat clever paths** — three rounds of path strategy: sibling (broke when dashboards moved to `Mobile/`) → vault-relative (broke when the parent folder moved) → `../` with a proper `resolvePath` segment walker (survives any folder move). 9 tests pin the resolver against future regressions. The user is about to test this for real by moving `Test/` → `Library/`.

5. **Data hygiene worth doing once** — the `⭐️` (U+2B50 + U+FE0F) vs `★` (U+2605) battle isn't visible to the eye but breaks CSV round-trips. Same with `Yes`/`No` vs `Watched`/`Unwatched` — semantically identical, but only the latter renders as a meaningful kanban subgroup label. Both fixed via one-shot normalization scripts with backups, run once and forgotten.

**Two lessons that should outlast this session**:

- **Generated artifacts are not the source of truth.** When the same content is regenerated from a template, fixing the artifact is a debt — fix the template or expect the patch to vanish.
- **Build the test harness before the third bug, not after.** A 175-line simulator turned "I think this works" into "the CI knows this works." Every subsequent feature was cheaper because the safety net was already there.

**Open follow-ups** (already in Known issues):
- ~~`fileConfigs` keys don't follow renames~~ — fixed 2026-05-23 (commit `d67a667`).
- Mobile folder structure could be configurable (currently hardcoded `Mobile/` sibling).
- Multi-value select for Category — picker sets a single string today.
- **Mobile dashboard templates still inline as TS template literals** (~600 lines across three `generate*MobileDashboard` methods). Extracting to `.txt` files loaded via esbuild would give real syntax highlighting and remove the regen-script's parallel copy. Stable + tested today, lower priority.
- **main.ts back to 2585 lines.** The handoff's `src/view/{toolbar,table,kanban,dashboard,library,mobile}.ts` split plan is overdue. Risky enough that it deserves a dedicated session rather than a tail-end commit.

---

## What this is

An Obsidian plugin that opens `.csv` and `.xlsx` files as a kanban, table, or dashboard UI. Built for Simon's book library and habit tracking. Three views:
- **Dashboard** — date-based habit tracking with chart, streaks, and stats (auto-detected when first column is dates)
- **By Genre** — kanban grouped by category column
- **Table** — spreadsheet-style with resizable columns

---

## Project structure

```
csv-card-view/
├── main.ts              # Main plugin source (~2585 lines) - XLSXCardView, Settings, Plugin
├── main.js              # Compiled output — do not edit directly (now minified ~720KB)
├── bench-load.mjs       # Measures bundle parse/eval cost; run after big refactors
├── src/
│   ├── types.ts         # Types, interfaces, DEFAULT_SETTINGS (~40 lines)
│   ├── utils.ts         # Utility functions, parseCSV (Papa), migrateFileConfigKey (~280 lines)
│   └── modals.ts        # Modal classes (~420 lines)
├── styles.css           # All plugin CSS (~2555 lines)
├── manifest.json        # Obsidian plugin manifest (id: csv-card-view)
├── package.json         # deps: xlsx (SheetJS), chart.js, esbuild, obsidian types
├── esbuild.config.mjs   # Build configuration
├── tsconfig.json        # TypeScript config
├── test-csv-parser.mjs  # CSV parsing tests (6 tests)
├── test-plugin-logic.mjs # Comprehensive plugin tests (84 tests) — sanitization,
│                        # CSV parsing, column resolution, round-trip, edge cases,
│                        # title case, binary cols, date cols, search, dup detect,
│                        # merge habit entry, sort order, formatRatingForDisplay
│                        # (9), resolvePath (9).
├── test-mobile-dashboards.mjs # Mobile dashboard simulator (21 assertions) —
│                        # extracts the dataviewjs block from each
│                        # `Knowledge/Test/Mobile/<basename>.md`, runs it against
│                        # a stubbed Dataview runtime backed by the real CSVs
│                        # (header + dynamicTyping, so e.g. the book "1984"
│                        # parses as a Number — same coercion that triggered the
│                        # original localeCompare bug). Asserts no thrown errors,
│                        # no Untitled cards, no negative status pills, ≥1
│                        # watched-dot, compact grid + year/rating/theme on
│                        # movies, and (for generic dashboards) a scrollable
│                        # table wrap. Skips missing files (e.g. mid-iCloud-sync)
│                        # rather than hard-crashing.
│                        # ⚠️ Hardcoded vault paths under `Knowledge/Test/...` —
│                        # update if the data folder moves.
├── regenerate-mobile-dashboards.mjs # Headless regenerator (`npm run regen:mobile`)
│                        # that mirrors the plugin's template logic and stamps
│                        # fresh dashboards into the vault without needing
│                        # Obsidian reload + button clicks. Use after template
│                        # changes in main.ts. Same hardcoded-path caveat as the
│                        # simulator.
├── normalize-stars.mjs  # One-shot: convert ⭐️ (U+2B50 + VS-16) → ★ (U+2605)
│                        # across all xlsx Rating cells. Backs up originals.
│                        # Already run on books.xlsx; safe to re-run (no-op if
│                        # nothing to change).
├── normalize-watched.mjs # One-shot: convert movies.xlsx Watched column
│                        # Yes→Watched, No→Unwatched. Already run.
├── csv-card-view/       # Symlink to Obsidian plugin folder
└── handoff.md           # This file
```

**Build & Deploy:**
```bash
npm install              # Install dependencies
npm run build            # Build main.js (~1.2MB with SheetJS + Chart.js)
npm run build:deploy     # Build and copy to Obsidian plugin folder
npm run dev              # Watch mode (rebuild on changes)
```

**Testing:**
```bash
npm run test             # Plugin logic tests (84)
npm run test:csv         # CSV parser tests (6)
npm run test:mobile      # Mobile dashboard simulator (21) — runs each
                         # dataviewjs block against a stubbed runtime + real CSVs
npm run test:all         # All of the above (111 total)
npm run typecheck        # TypeScript type checking
npm run check            # Full check: typecheck + tests + build + deploy
npm run regen:mobile     # Stamp fresh mobile dashboards into the vault
                         # (after a template change in main.ts)
```

**Install in Obsidian:** copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/csv-card-view/` and enable in Community plugins. Works on iOS/Android.

**Local development:** The `csv-card-view/` folder is a symlink to the Obsidian plugin directory. Running `npm run build:deploy` copies all necessary files automatically.

---

## Settings persistence

All plugin settings are saved to:
```
<vault>/.obsidian/plugins/csv-card-view/data.json
```

Obsidian writes this automatically via `saveData()` / `loadData()`. Persists across sessions, restarts, and devices (travels with vault on iCloud sync). Example structure:

```json
{
  "defaultMode": "kanban-genre",
  "statusColumn": "status",
  "categoryColumn": "category",
  "notesSubfolder": "Notes",
  "columnWidths": { "Name": 240, "Notes": 400 },
  "selectColumns": ["Category", "Type", "Rating", "Status"],
  "fileConfigs": {
    "Library/books.xlsx": {
      "categoryColumn": "Category",
      "notesColumn": "Notes",
      "statusColumn": "Status",
      "defaultMode": "kanban-genre"
    }
  }
}
```

**Known gap:** if a file is renamed or moved in Obsidian, its `fileConfigs` key (vault-relative path) won't follow it automatically. The entry becomes orphaned and the file reverts to auto-detected defaults.

---

## Architecture

### FileView, not TextFileView

Extends `FileView` directly. `TextFileView` decodes everything as UTF-8 before handing off — destroys binary xlsx data. Instead:

- **XLSX:** `vault.readBinary()` → `XLSX.read(buf, { type: "array" })` (SheetJS)
- **CSV:** `vault.read()` → custom parser (handles quoted fields, embedded newlines, Unicode)
- **XLSX saves:** `vault.modifyBinary()` with `XLSX.write(..., { type: "array" })`
- **CSV saves:** `vault.modify()` with manual CSV serialization

All saves are **debounced 600ms** via `scheduleSave()` → `doSave()`. Edits commit to disk automatically — no explicit save button.

### Data model

```typescript
interface CSVRow { [key: string]: string; }
// headers: string[]  — column order preserved
// rows: CSVRow[]     — all values stored as strings
```

Everything in memory. `onLoadFile` populates, `doSave` flushes.

### View modes

`type ViewMode = "kanban-genre" | "table" | "dashboard" | "library"` — four active modes. Switched via toolbar. Full re-render on each switch.

- **Dashboard** — Auto-selected when first column is detected as dates (YYYY-MM-DD format or named "date"/"day"). Shows date navigator, habit toggles, line chart (Chart.js), stats (days logged, avg/day, perfect days, streaks), and per-habit cards.
- **Library** — Grid view with filters (status, genre, search), collapsible genre sections, cards with green dot for done items, ratings, tags. Like the Dataview Movies Dashboard.
- **By Genre** — Kanban grouped by category column with status subgroups.
- **Table** — Spreadsheet view with resizable columns.

---

## Module map (main.ts)

### Top-level functions

**`showSelectPicker(anchor, currentValue, allValues, onSelect, container)`**
Floating dropdown for select fields. Fixed-positioned below anchor. Features: search/filter, clear, "+ Add new" for values not yet in the list. Options are always auto-built from existing column values — no hardcoded lists. Closes on outside click.

### Classes

**`AddEntryModal extends Modal`**
Opened by the "+ Add" toolbar button. Renders a labeled form for every column:
- Notes columns → `<textarea>`
- Select columns → chip that opens `showSelectPicker`
- Everything else → `<input type="text">` (Enter submits)
Requires at least one field filled. Calls `onSubmit(row)` on success.

**`NoteExpanderModal extends Modal`**
Wide modal (~780px) for viewing and editing a full entry. Three sections:

1. **Header** — entry title (read-only display)
2. **Fields bar** — all non-notes columns as inline-editable label/value pairs:
   - Select columns → clickable chip opens `showSelectPicker`
   - Text columns → click to reveal `<input>`, Enter/blur commits, Escape cancels
   - Long values truncated with `…`, full text on `title` hover attribute
3. **Notes section** — divider with column name + ✏️ Edit toggle; below it either rendered markdown (`MarkdownRenderer.render`) or a raw `<textarea>` editor

Works on a **shallow copy** of the row. Cancel closes without mutating. "Save & close" calls `onSave(updatedRow)` which does `Object.assign(originalRow, updatedRow)` then saves and re-renders.

**`FileConfigModal extends Modal`**
Opened by the "⚙ Columns" toolbar button. Four `<select>` dropdowns:
- Category column (kanban grouping)
- Status column (row subgroups within kanban)
- Notes column
- Default view for this file

All options are "— use global default —" + actual file headers. Saved to `settings.fileConfigs[filePath]`.

**`XLSXCardView extends FileView`**

| Method | Purpose |
|---|---|
| `onLoadFile(file)` | Reads file, applies per-file default mode, calls `renderView()` |
| `doSave()` | Writes current state to disk (binary for xlsx, text for csv) |
| `scheduleSave()` | 600ms debounce wrapper |
| `renderView()` | Clears and rebuilds entire `contentEl` |
| `renderToolbar(root)` | Mode buttons + "⚙ Columns" + entry count + "+ Add" |
| `renderKanbanGenre(container)` | By Genre kanban |
| `renderKanbanCard(container, row, ...)` | Single kanban card with inline note editor |
| `renderTable(container)` | Table with resizable columns |
| `renderSelectField(container, row, h)` | Chip that opens `showSelectPicker` |
| `makeEditable(el, row, h)` | Click-to-edit for plain text table cells |
| `openNoteExpander(row, notesCol)` | Opens `NoteExpanderModal` |
| `openAddModal()` | Opens `AddEntryModal` |
| `openOrCreateNotes(row)` | Creates/opens sidecar `.md` file |
| `resolveCol(candidates)` | Returns first header matching any candidate (case-insensitive) |
| `getNotesCol()` | Per-file override → fallback chain |
| `getStatusCol()` | Per-file override → fallback chain |
| `getCategoryCol()` | Per-file override → fallback chain |
| `getFilteredRows()` | Returns rows matching current search query |
| `generateMobileFiles()` | Creates mobile dashboard markdown file |
| `generateHabitMobileDashboard(...)` | Generates habit tracker mobile dashboard content |
| `generateLibraryMobileDashboard()` | Generates library (books/movies) mobile dashboard content |
| `generateGenericMobileDashboard()` | Generates generic mobile dashboard content |

**`CardViewSettingTab extends PluginSettingTab`**
Global settings UI (not per-file).

**`CardViewPlugin extends Plugin`**
Entry point. Registers view for `csv` and `xlsx`. Also registers the `csv-add` code block processor for mobile entry forms. Exposes `saveSettings()` so `XLSXCardView.saveFileCfg()` can persist without a direct plugin reference (accessed via `(app as any).plugins.plugins["csv-card-view"]?.saveSettings()`).

Key methods:
- `renderAddEntryForm(source, el, ctx)` — renders the `csv-add` code block as a form. Parses the `file:` parameter, reads headers from the CSV/XLSX, auto-detects select fields (columns with ≤15 unique values), and writes new entries directly to the file.

---

## Column auto-detection (fallback chains)

When no per-file override is set, columns are resolved by trying candidates in order against actual headers (case-insensitive). First match wins.

**Notes column:**
`Notes → Note → Summary → Review → Quote → Quotes → Comment → Comments → Description → Annotation`

**Category column** (kanban grouping):
`Category → Categories → Genre → Genres → Type → Types → Tag → Tags → Topic → Topics → Subject → Section`

**Status column** (kanban row subgroups):
`Status → State → Progress → Stage → Read`

**Title:**
`Title → Name`

**Author/subtitle:**
`Author → Authors → Director → Artist → Creator → By`

---

## Per-file configuration

```typescript
interface FileConfig {
  categoryColumn?: string;  // overrides getCategoryCol() fallback chain
  notesColumn?: string;     // overrides getNotesCol() fallback chain
  statusColumn?: string;    // overrides getStatusCol() fallback chain
  habitColumns?: string[];  // columns to track as habits in dashboard view
  defaultMode?: ViewMode;   // applied on onLoadFile
}
```

Stored in `settings.fileConfigs[file.path]`. Accessed via `this.fileCfg` getter. Saved via `saveFileCfg(cfg)`. When a field is `undefined`, the fallback chain runs normally.

**Habit columns:** If not set, auto-detected by scanning for columns with binary values (0/1, true/false, yes/no, empty). The FileConfigModal shows a checkbox grid to manually select/deselect columns.

---

## Settings (`CardViewSettings`)

| Field | Default | Description |
|---|---|---|
| `defaultMode` | `"kanban-genre"` | Global default opening view |
| `notesColumns` | `["Notes","notes",...]` | Legacy list — superseded by `getNotesCol()` chain but kept for CSV fallback |
| `statusColumn` | `"status"` | Global status column name (overridden per-file) |
| `categoryColumn` | `"category"` | Global category column name (overridden per-file) |
| `notesSubfolder` | `"Notes"` | Subfolder for sidecar `.md` files relative to the data file |
| `columnWidths` | `{}` | Persisted table column widths in px, keyed by header name |
| `selectColumns` | `["Category","Type","Rating","Status",...]` | Columns that use dropdown picker instead of plain text input |
| `fileConfigs` | `{}` | Per-file overrides, keyed by vault-relative file path |

---

## Notes system

### Inline notes (in the xlsx cell)
Any column resolved by `getNotesCol()` is the notes field.

- **Kanban card:** plain-text preview (120 chars, markdown stripped). "✏️ Edit note" opens textarea inline inside the card. "⤢ Expand" opens `NoteExpanderModal`. Scroll position of `.csv-content-area` is saved before opening and restored via multi-layer approach (immediate + double rAF + setTimeout) on close. The textarea focus uses `preventScroll: true` to avoid browser auto-scrolling.
- **Table:** 2-line plain-text preview. Clicking cell or "⤢" button both open `NoteExpanderModal` — no inline editing in table view.

### Sidecar notes file
"✚ Notes file" / "📄 Open notes file" button on kanban cards and table rows. Path: `<csv-folder>/<notesSubfolder>/<sanitized-title>.md`. Created with YAML frontmatter from all non-notes columns + inline notes as seed content. Opens in new Obsidian tab. `notesFileExists(row)` checks via `vault.getAbstractFileByPath()`.

---

## Dashboard view

For date-based CSV/XLSX files (first column is dates in YYYY-MM-DD format).

### Features
- **Date navigator** — prev/next buttons, date dropdown, Today button
- **Habit toggles** — clickable checkmarks for each habit column
- **Line chart** — habits completed per day over time (Chart.js)
- **Stats bar** — days logged, average per day, perfect days, current streak, best streak
- **Per-habit cards** — individual stats for each habit with progress bar

### Streak calculation
Streaks **break if a day is missed**. The algorithm checks that consecutive rows are exactly 1 day apart. For current streak, it starts from today (or yesterday if today has no entry) and counts backwards only while dates are consecutive.

### Date column detection
First column is used if:
1. Column name is "date", "day", or "datum" (case-insensitive)
2. OR first 5 values match YYYY-MM-DD pattern

### Habit column detection
Columns with only binary values (0, 1, true, false, yes, no, or empty) are auto-detected as habits. Can be overridden via "⚙ Columns" modal with checkbox grid.

### Per-habit timeline
Click any habit card to show a detailed timeline visualization:
- Heatmap grid showing done (green), missed (red), no entry (grey) for each day
- Month separators for readability
- Individual habit streak stats (done, missed, current streak, best streak)
- Click card again or ✕ to close

### Mobile dashboard (📱 Mobile button)
Since mobile Obsidian can't open CSV/XLSX files with the plugin, use the "📱 Mobile" button to generate a mobile-friendly markdown dashboard:

- Creates `<filename> - Mobile.md` in the same folder as the CSV/XLSX
- Uses **Dataview** to query the CSV file directly via `dv.io.csv()`
- Includes a `csv-add` code block for adding new entries from mobile
- Requires Dataview plugin with DataviewJS enabled on mobile

**Three dashboard types auto-detected:**
1. **Habit tracker** — when first column is dates: shows recent entries grid + quick add
2. **Library** — when category column exists: shows table + add form + entries by status
3. **Generic** — fallback: shows recent entries table + add form

### csv-add code block
The plugin registers a `csv-add` markdown code block processor for adding entries:

````markdown
```csv-add
file: books.xlsx
```
````

When rendered, displays a form with all columns from the specified file. Features:
- Auto-detects column types from existing data
- Columns with ≤15 unique values show as dropdowns
- "Custom" option allows entering new values
- Writes directly to the CSV/XLSX file
- Works on mobile (entries added on phone sync via iCloud/Obsidian Sync)

File path can be:
- Relative to the current note: `file: books.xlsx`
- Absolute vault path: `file: Library/books.xlsx`

---

## Kanban by Genre

- Genres from splitting Category column on `,` — multi-genre entries appear in multiple columns
- Columns sorted alphabetically
- Within each column, rows grouped by status with colored labels: `In progress` → blue, `Finished` → green, `Not started` → grey
- Status order: In progress → Finished → Not started (then any others found)
- Right-click context menu: change status, open/create notes file, delete

---

## Chip truncation

Long non-select field values in kanban cards are truncated at 40 chars with `…`. Full text available on hover via the `title` HTML attribute. CSS also enforces `max-width: 200px; text-overflow: ellipsis` on `.csv-chip-value` as a second layer.

---

## Refactoring Status

The `main.ts` file has been reduced from 2304 to 1839 lines by extracting modules to `src/`:

```
src/
├── types.ts       # ✅ Types, interfaces, DEFAULT_SETTINGS, CARD_VIEW_TYPE
├── utils.ts       # ✅ sanitizeFilename, titleCase, formatRating, showSelectPicker, parseCSV, escapeCSV
├── modals.ts      # ✅ AddEntryModal, NoteExpanderModal, FileConfigModal
```

**Current main.ts structure:**
- `XLSXCardView` class (~1400 lines) - the main view component
- `CardViewSettingTab` class (~25 lines) - settings UI
- `CardViewPlugin` class (~340 lines) - plugin entry + csv-add/csv-refresh code blocks

**Future refactoring (optional):**
If XLSXCardView needs to be split further:
```
src/view/
├── index.ts       # Main class shell, imports render methods
├── toolbar.ts     # renderToolbar
├── table.ts       # renderTable
├── kanban.ts      # renderKanbanGenre
├── dashboard.ts   # renderDashboard + stats + charts
└── mobile.ts      # generateMobileFiles, mobile dashboard generation
```

---

## Known issues / future work

- [ ] **Per-file view configuration — views themselves** — currently the two view types (kanban-genre, table) are global and fixed. A future improvement: let each file declare which views are available and what they're named. E.g. a movie database might want "By Director" and "By Decade" kanbans, not "By Genre". Implementation: store a `views: ViewDefinition[]` array in `fileConfigs[path]`, where each `ViewDefinition` has a `type`, `label`, `groupCol`, and `subgroupCol`. The toolbar would render buttons dynamically from that array. The "⚙ Columns" modal would let the user add/remove/rename views and pick their column mappings.

- [ ] **fileConfigs key doesn't follow renames** — if a file is moved or renamed, its config entry becomes orphaned. Fix: hook into Obsidian's `vault.on("rename", ...)` event in `onload()` to migrate the key.

- [x] **Search/filter** — search bar in kanban and table views filters entries by any column value

- [x] **Sort controls** — added sort toggle (↓ Newest / ↑ Oldest) in table view for files with date columns. Setting persisted per-file via `sortNewestFirst` in FileConfig.

### Desktop Library view (completed ✓)

- [x] **Library view mode** — new view for files with category columns, shows grid of cards grouped by genre
- [x] **Filters bar** — status dropdown (All/Done/In Progress/Not Started), genre dropdown, search by title
- [x] **Collapsible sections** — genre headers with ▶ arrow, entry count, click to expand/collapse
- [x] **Card design** — green dot for watched/read items, title, author/year, star ratings, tags
- [x] **Sorting** — in-progress items first, then alphabetically by title

### Mobile dashboard improvements (completed ✓)

- [x] **Minimalist Apple-esque design** — removed gray fills, transparent backgrounds, clean typography
- [x] **View toggle** — Recent/All toggle for entries, Kanban/Table toggle for library files
- [x] **Kanban view in mobile** — library mobile dashboard has collapsible genre sections with cards
- [x] **Form styling** — 95% width, larger inputs, clean checkboxes, subtle focus states
- [x] **Refresh button** — minimal `↻ refresh` button, no background
- [x] **Dataview note moved** — "Requires Dataview" now at bottom as subtle footer
- [x] **Auto-refresh after add** — note is reopened to force Dataview to re-execute
- [x] **CSV-XLSX sync** — syncs on both mobile add/update AND desktop edits
- [x] **localeCompare crash on numeric titles** — book "1984" parsed by `dv.io.csv` as `Number`, broke sort. Fixed: `String(...)` coercion on both sides of `localeCompare`.
- [x] **quotes mobile rendered "Untitled" on every card** — script used `titleKey = "Title"`, but `quotes.csv` has no Title column. Fixed: `titleKey = "Quote"` (the quote text is the headline).
- [x] **movies mobile rendered "No" pill on every card** — `Watched=No` was treated as a status worth surfacing. Fixed: `NEGATIVE_STATUS` set filters out `no/not started/unwatched/unread/todo`.
- [x] **Watched movies use green dot, not "Yes" pill** — affirmative `Watched` values (`yes/watched/seen/finished/read`) render as an 8px `#5A8C4A` dot prefix on the title row, matching the desktop Library design. Unwatched movies render nothing — clean.
- [x] **Empty-title rows skipped** — books with no `Name` and movies with no `Title` no longer render as "Untitled" placeholders. Three book rows and one movie row were affected.
- [x] **Mobile dashboard simulator** (`test-mobile-dashboards.mjs`, wired into `npm run test:mobile` and `test:all`) — extracts each dashboard's `dataviewjs` block, runs it against a stubbed Dataview runtime (real CSVs, Papa Parse with `dynamicTyping: true` to mirror the production type coercion), and asserts no thrown errors, no Untitled cards, no negative status pills, ≥1 watched-dot. Catches column-name typos and type-coercion regressions empirically rather than by inspection. Skips files that aren't present (e.g. mid-iCloud-sync) rather than hard-crashing.
- [x] **Library template fixed at the source** — the previous round of manual `.md` patches got wiped the next time the user clicked "📱 Mobile". The fix now lives in `generateLibraryMobileDashboard` in `main.ts`: `String()` coercion everywhere, `NEGATIVE_STATUS` filter, skip-empty-title, green-dot prefix on affirmative finished values, and an extended titleKey fallback chain (`Title/Name` → `Quote/Headline/Phrase` → first header). Quotes now correctly picks `Quote` as its title key.
- [x] **Generic dashboard rewritten as an expandable scrollable table** — used for files without a category column (e.g. `dictionary`). Replaces the old `dv.table(...)`-based view. Shows all columns with horizontal scroll and a sticky header; Recent (last 15) / All toggle.
- [x] **Headless regenerator** (`regenerate-mobile-dashboards.mjs`, wired into `npm run regen:mobile`) — stamps fresh mobile dashboards into the vault without needing an Obsidian reload + manual button clicks. Mirrors the plugin's dispatcher and templates. After any change to a template in `main.ts`, run `npm run build:deploy && npm run regen:mobile && npm run test:mobile` to update the vault and verify in one shot.
- [x] **Star glyph normalization** (`normalize-stars.mjs`, one-shot) — converts `⭐️` (U+2B50 + U+FE0F variation selector) to `★` (U+2605, single BMP code point) across all xlsx Rating cells and helper CSV mirrors. `★` is dramatically safer for CSV/XLSX round-trips because it's a single code unit with stable width; the VS-16 sequence gets stripped or escaped inconsistently by different writers. Books.xlsx had 9 cells (38 glyphs) normalized; movies/quotes already used `★`. Backup written to `<file>.before-star-normalize.xlsx`.
- [x] **Read-mode by default** — mobile dashboards include frontmatter `obsidianUIMode: preview` / `obsidianEditingMode: source`. The Force View Mode community plugin reads this and opens the note in Reading view. Stops the dashboard from accidentally opening in Source mode and showing the raw dataviewjs block on mobile.
- [x] **Backup button** — new "💾 Backup" toolbar button in the XLSX view copies the current file to `<folder>/Archive/<basename>_YYYY-MM-DD.xlsx`. Creates `Archive/` if missing, refuses to overwrite a same-day backup, uses `readBinary` → `writeBinary` so the xlsx is byte-identical (not re-serialized).
- [x] **Mobile/ subfolder** — generator now writes to `<folder>/Mobile/<basename>.md` instead of `<folder>/<basename> - Mobile.md`. Keeps the main folder uncluttered (movies.xlsx, books.xlsx, etc. without sibling dashboard noise). The `csv-add file:` line emits the vault-relative path (e.g. `Knowledge/Test/books.xlsx`) since the dashboard now lives one folder deeper than the xlsx. `regenerate-mobile-dashboards.mjs`, `test-mobile-dashboards.mjs`, and the migrated `habit_tracker.md` all updated.
- [x] **`../` relative paths in csv-add** — `resolvePath` in `src/utils.ts` walks `..` and `.` segments properly, so the data folder is now portable. Generators emit `file: ../<basename>.xlsx`. Move `Test/` anywhere in the vault and dashboards still resolve. 9 tests pin the resolver behaviour.
- [x] **Watched/Unwatched normalization** (`normalize-watched.mjs`, one-shot) — converts `movies.xlsx` Watched column from `Yes/No` to `Watched/Unwatched`. Same semantics, but renders as a meaningful subgroup label in the kanban-genre view and matches the affirmative-status set the Library green dot already recognised. Backup at `movies.before-watched-normalize.xlsx`.
- [x] **Status color palette extended** — kanban subgroup labels now color `watched/seen/done` as green, `unwatched/unread/no/todo` as gray, alongside the existing `finished/in-progress/not-started` palette. Single CSS edit in `styles.css`.
- [x] **Library card render is now data-driven** — single render path that walks a `cardFields` list. Each field renders by type: rating column → stars (already-glyph data passes through, numeric maps to ★, "unrated" hidden); theme/tag column → pill chips; year column → 4-digit extraction; everything else → meta line under title. Green dot prefix already worked for any status in `commonDone`; now triggers correctly for the normalized "Watched" value. Fixes the bug where already-rendered star strings (`★★★★☆`) silently failed to display.
- [x] **`fileConfig.cardFields` + picker in Columns modal** — new per-file array of column names to surface on Library/Kanban cards. If unset, auto-detects `author + year + rating + theme`. The "⚙ Columns" modal gains a checkbox grid where the user toggles which fields to render; auto-detected defaults are highlighted via `.auto-detected`. First click promotes the auto list into an explicit list (so subsequent renders are deterministic).
- [x] **Kanban category headers in accent color** — `.csv-kanban-col-title` now uses `var(--text-accent)`, matching the Library section headers.
- [x] **Mobile generic table column width fix** — the dictionary's Pronunciation column was being crushed because `width:100%` forced everything to fit the viewport. Now: `min-width:100%` on the table (so short tables still fill the viewport), `white-space:nowrap` on all but the last column (Pronunciation/Phrase stay readable), `white-space:normal; min-width:200px` on the last column (Meaning/Description wraps naturally).
- [x] **`formatRatingForDisplay` helper** in `src/utils.ts` — replaces the brittle inline logic in `renderLibrary`. Pins display rules across 9 tests covering empty/unrated/glyph-pass-through/numeric/text-mapped/out-of-range/unknown-on-rating-col/unknown-on-other-col.

### CSV Helper Architecture

**Source of truth:** XLSX is always the source of truth. CSV is a one-way mirror for Dataview.

**Folder:** `<xlsx-folder>/_csv_helpers/<filename>.csv` — Uses underscore prefix instead of dot to avoid Obsidian's hidden folder indexing issues.

**Sync points:**
1. **Mobile add form (`csv-add`)** — reads/writes XLSX directly, then syncs to CSV
2. **Desktop edits (`doSave()`)** — writes XLSX, then syncs to CSV if helper exists
3. **Duplicate detection** — re-reads file before each submit to avoid stale data issues

**File operations:** Uses `vault.adapter.exists/mkdir/write` instead of `vault.getAbstractFileByPath/createFolder/create` because Obsidian doesn't index `_csv_helpers` folder in its file cache.

### Mobile dashboard generation

- [ ] **Mobile folder structure** — instead of generating `filename - Mobile.md` in the same folder, create a `mobile/` subfolder with `filename.md`. Cleaner organization, avoids cluttering the main folder.

- [ ] **Mobile file opening** — On iOS/Android, tapping a CSV or XLSX file opens the system share dialog instead of the plugin. This is an Obsidian mobile limitation — custom views for binary/non-markdown files aren't fully supported. Workaround: use the generated mobile dashboard.

### Desktop improvements

- [ ] **Multi-value select for Category** — the picker sets a single string. Proper multi-select with individual chips would be better (comma-split for kanban columns already works on the read side)

- [ ] **Column widths not in the file** — widths saved in `data.json`, not the xlsx itself, so they don't travel if the file is opened in a different vault

- [ ] **Kanban per-column "+ Add"** — no per-column add button in kanban-genre; the toolbar "+ Add" opens the modal but doesn't pre-fill the genre/category

- [ ] **Library view enhancements** — add rating filter, theme/tag filter, sort options (by title, year, rating)

### Technical debt

- [ ] **saveFileCfg coupling** — `XLSXCardView.saveFileCfg()` accesses the plugin via `(app as any).plugins.plugins["csv-card-view"]`. This works but is fragile if the plugin ID changes. Better: pass a `saveSettings` callback into the view constructor.

- [ ] **Mobile UI polish** — resize handles don't work on touch; kanban horizontal scroll may be awkward on narrow screens

---

## CSS class reference

| Class | Where | Description |
|---|---|---|
| `.csv-card-view-root` | Root | Sets CSS vars, flex column layout |
| `.csv-toolbar` | Both | Top toolbar |
| `.csv-mode-group` | Both | Mode toggle button group |
| `.csv-cfg-btn` | Both | "⚙ Columns" button |
| `.csv-add-btn` | Both | "+ Add" button |
| `.csv-kanban-board` | Kanban | Horizontal flex container |
| `.csv-kanban-col` | Kanban | Single genre column |
| `.csv-kanban-col-header` | Kanban | Column title + count |
| `.csv-kanban-status-group` | Kanban | Status subgroup within column |
| `.csv-kanban-status-label` | Kanban | Colored status pill |
| `.csv-kanban-card` | Kanban | Individual entry card |
| `.csv-kanban-card-btns` | Kanban | Button row (visible on hover) |
| `.csv-kanban-notes-preview` | Kanban | Plain-text note excerpt; `--empty` modifier hides it |
| `.csv-kanban-notes-editor` | Kanban | Inline textarea wrapper (toggled via `display`) |
| `.csv-select-chip` | Both | Clickable dropdown chip; `.empty` = no value |
| `.csv-chip-value` | Both | Value span inside chip; `max-width: 200px`, ellipsis |
| `.csv-select-picker` | Both | Floating dropdown panel (fixed-positioned) |
| `.csv-picker-search` | Both | Picker search input |
| `.csv-picker-item` | Both | List item; `.active` = current; `.csv-picker-add` = new value |
| `.csv-table` | Table | Main table element |
| `.csv-table-notes-cell` | Table | Notes cell (relative-positioned for expand btn) |
| `.csv-table-expand-btn` | Table | "⤢" button, shown on row hover |
| `.csv-col-resize-handle` | Table | Drag handle on `<th>` right edge |
| `.csv-add-modal` | Modal | Add entry modal content |
| `.csv-modal-form` | Modal | Scrollable form area |
| `.csv-modal-row` | Modal | Label + input pair |
| `.csv-modal-select` | Modal | `<select>` dropdown in FileConfigModal |
| `.csv-note-expander-modal` | Modal | Wide modal override (`min(780px, 90vw)`) |
| `.csv-expander-header` | Modal | Title row |
| `.csv-expander-fields` | Modal | Flex-wrap row of label/value field pairs |
| `.csv-expander-field-row` | Modal | Single label + value pair |
| `.csv-expander-field-label` | Modal | Uppercase faint label |
| `.csv-expander-field-value` | Modal | Clickable editable value; truncated with ellipsis |
| `.csv-expander-divider` | Modal | Notes section header with label + Edit button |
| `.csv-expander-notes-label` | Modal | "Notes" column name label |
| `.csv-expander-rendered` | Modal | Markdown rendered view |
| `.csv-expander-editor` | Modal | Textarea editor view (toggled via `display`) |
| `.csv-expander-textarea` | Modal | Raw markdown textarea |
| `.csv-expander-footer` | Modal | Cancel + Save & close buttons |
| `.csv-dashboard` | Dashboard | Root container with max-width |
| `.csv-dash-nav` | Dashboard | Date navigator bar |
| `.csv-dash-nav-btn` | Dashboard | Prev/next arrow buttons |
| `.csv-dash-date-select` | Dashboard | Date dropdown |
| `.csv-dash-today-badge` | Dashboard | "Today" indicator pill |
| `.csv-dash-today-btn` | Dashboard | "Today" quick nav button |
| `.csv-dash-habits` | Dashboard | Habit toggles section |
| `.csv-dash-habits-grid` | Dashboard | Grid of habit toggle buttons |
| `.csv-dash-habit` | Dashboard | Single habit toggle; `.checked` variant |
| `.csv-dash-habit-check` | Dashboard | Clickable ○/● indicator |
| `.csv-dash-chart-section` | Dashboard | Chart container |
| `.csv-dash-stats-bar` | Dashboard | Stats summary row |
| `.csv-dash-cards-grid` | Dashboard | Per-habit stat cards grid |
| `.csv-dash-habit-card` | Dashboard | Individual habit stat card |
| `.csv-dash-habit-progress` | Dashboard | Progress bar container |
| `.csv-modal-checkbox-grid` | Modal | Habit column selector grid |
| `.csv-modal-checkbox-label` | Modal | Checkbox + label; `.auto-detected` variant |
| `.csv-dash-timeline-section` | Dashboard | Per-habit timeline container |
| `.csv-dash-timeline-grid` | Dashboard | Heatmap grid of day cells |
| `.csv-dash-timeline-cell` | Dashboard | Single day cell; `.done`, `.missed`, `.no-entry` |
| `.csv-dash-timeline-month` | Dashboard | Month label in timeline |
| `.csv-dash-habit-card-header` | Dashboard | Icon + name row in habit card |
| `.csv-dash-habit-icon` | Dashboard | Emoji icon for habit |
| `.csv-dash-habit-years` | Dashboard | Year badges (2024 · 2025 · 2026) |
| `.csv-search-wrap` | Toolbar | Search bar container |
| `.csv-search-input` | Toolbar | Search input field |
| `.csv-search-clear` | Toolbar | Clear search button (×) |
| `.csv-search-results` | Content | "Found X of Y entries" message |
| `.csv-add-form` | Code block | Mobile add entry form container |
| `.csv-add-title` | Code block | Form title |
| `.csv-add-field` | Code block | Field wrapper (label + input) |
| `.csv-add-label` | Code block | Field label |
| `.csv-add-input` | Code block | Text input |
| `.csv-add-select` | Code block | Dropdown select |
| `.csv-add-custom-input` | Code block | Custom value input (hidden by default) |
| `.csv-add-submit` | Code block | Submit button |
| `.csv-add-error` | Code block | Error message styling |
| `.csv-library-filters` | Library | Filters bar (flex, gap) |
| `.csv-library-filter-select` | Library | Status/genre dropdown |
| `.csv-library-search` | Library | Search input |
| `.csv-library-sections` | Library | Container for genre sections |
| `.csv-library-section` | Library | Collapsible `<details>` element |
| `.csv-library-section-header` | Library | Genre header with arrow + count |
| `.csv-library-grid` | Library | Card grid (auto-fill columns) |
| `.csv-library-card` | Library | Individual entry card |
| `.csv-library-card-title` | Library | Title with green dot |
| `.csv-library-done-dot` | Library | Green dot for watched/read |
| `.csv-library-card-meta` | Library | Author/year text |
| `.csv-library-card-rating` | Library | Star rating display |
| `.csv-library-card-tags` | Library | Tags container |
| `.csv-library-card-tag` | Library | Individual tag chip |

Status color variants: `.status-{slug}` where slug = value lowercased, spaces → `-`. Presets: `finished`/`read` → green, `in-progress`/`reading` → blue, `not-started`/`to-read` → grey, `dropped` → red.

---

## Dev workflow

```bash
cd csv-card-view
npm install
npm run check            # Full validation before committing

# Or for iterative development:
npm run dev              # Watch mode — rebuilds on file changes
npm run deploy           # Copy built files to Obsidian plugin folder
```

The `csv-card-view/` symlink points to the Obsidian plugin folder, so `npm run deploy` (or `npm run build:deploy`) updates the plugin in place. Reload Obsidian (Cmd+R) to pick up changes.

**Mobile dashboards** (`<folder>/Mobile/<basename>.md` in the iCloud vault) are standalone `dataviewjs` blocks **generated by the plugin** from templates in `main.ts` (`generateLibraryMobileDashboard`, `generateGenericMobileDashboard`, `generateHabitMobileDashboard`). They live in a `Mobile/` subfolder to keep the parent folder uncluttered. They read the `_csv_helpers/<file>.csv` mirror that the plugin writes on `csv-refresh`. Frontmatter `obsidianUIMode: preview` opens them in Reading mode by default (consumed by the Force View Mode community plugin). The `csv-add file:` line uses a **note-relative path with `../`** (e.g. `file: ../books.xlsx`) so the whole `<folder>` can be moved or renamed anywhere in the vault without breaking any dashboard.

**Path resolution** (`resolvePath` in `src/utils.ts`, used by `renderAddEntryForm`): accepts three forms in `csv-add file:`:
- `books.xlsx` — sibling of the current note
- `../books.xlsx` / `../../foo.csv` — walked up from the current folder (clamps at vault root)
- `Knowledge/Test/books.xlsx` — vault-relative (any path with `/` and no leading `./` or `../`)

Generated dashboards always emit the `../` form. Behaviour is covered by 9 tests in `test-plugin-logic.mjs` under "resolvePath".

⚠️ **The generated `.md` files are NOT the source of truth — main.ts is.** Manual edits to a dashboard get wiped the next time the user clicks the "📱 Mobile" button on its XLSX file. If you fix a bug in a dashboard, fix it in the template in `main.ts`, rebuild + deploy, then either reload Obsidian and re-click "📱 Mobile" on each file OR run `npm run regen:mobile` to stamp the new templates into the vault headlessly. `regenerate-mobile-dashboards.mjs` mirrors the plugin's dispatcher (date column → habit, category column → library, else → generic) and template logic — keep it in sync with main.ts.

Three gotchas live in the library template:

- **CSV type coercion.** `dv.io.csv` parses with `dynamicTyping: true`, so a numeric-looking value like the book title `1984` comes back as `Number`. Any string-only call (`.localeCompare`, `.toLowerCase`, `.split`) on raw field values must be wrapped in `String(...)`.
- **titleKey fallback.** Files like `quotes.xlsx` have no Title/Name column — the quote text itself is the headline. The library generator extends `titleKey()` with a `["Quote","Headline","Phrase"]` fallback, then `headers[0]` as last resort.
- **Negative status values clutter the kanban.** `NEGATIVE_STATUS` filters out `"no" / "not started" / "unwatched" / "unread" / "todo"` so unfinished items render quietly. Affirmative finished/watched values (`yes/watched/seen/finished/read`) render as a green dot prefix on the title row (matches desktop Library), not a "Yes" chip.

Regressions in any of these are caught by `npm run test:mobile`. The simulator runs each dashboard against a stubbed Dataview runtime, so a column-name typo or a missing `String()` guard fails the test the same way it would fail in Obsidian.

**Test suite (84 logic + 21 mobile + 6 csv = 111 checks):**
- Filename sanitization (illegal chars, whitespace, truncation, unicode)
- CSV parsing (CRLF, quotes, escaping, long fields, edge cases)
- Column resolution (case-insensitive matching, fallback chains)
- CSV round-trip serialization
- Edge cases (empty input, malformed data, special characters)
- Title case transformation
- Binary column detection (0/1, true/false, yes/no)
- Date column detection (by name and value pattern)
- Search filtering (partial match, case-insensitive, multi-column)
- Duplicate entry detection (findExistingRowByDate)
- Merge habit entry logic (mergeHabitEntry)
- Sort order (sortByDate newest/oldest first)
- `formatRatingForDisplay` (9 — empty/unrated/glyph-pass-through/numeric/text-mapped/out-of-range)
- `resolvePath` (9 — sibling/vault-relative/`../`/`../../`/`./`/mixed/root-clamp)
- Mobile dashboard simulator (21 — per-file no-throw + render assertions, plus movie-specific compactGrid/year/rating/theme checks and generic-table wrap)

**Manual test checklist:**
- Open `books.xlsx` → opens in By Genre view
- Genre columns render with status subgroups (In progress / Finished / Not started)
- Hover card → buttons appear; click "✏️ Edit note" → textarea opens inline; blur saves and scroll position restored
- Click "⤢ Expand" → NoteExpanderModal opens; fields bar shows all columns; text fields click-to-edit; select chips open picker; toggle edit/preview for notes; Cancel discards; Save & close commits
- Click "+ Add" → AddEntryModal opens; all fields present; select chips work; submit adds row, notice shown
- Click "⚙ Columns" → FileConfigModal opens; dropdowns show all headers; save persists to data.json
- Long chip values (e.g. "Where" field) truncate with `…`; full text shown on hover
- Switch to Table view; resize columns; click notes cell → NoteExpanderModal opens (no inline editing)
- Right-click kanban card → change status, delete
- Verify xlsx saved correctly by reopening file or checking file modification time
