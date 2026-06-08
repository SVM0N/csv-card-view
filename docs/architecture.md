# Architecture

Reference doc — load when working on the plugin's data model, view classes, modals, or mobile dashboard generation. For CSS class names see [css-classes.md](css-classes.md); for build/test commands see [dev-workflow.md](dev-workflow.md).

## What this is

An Obsidian plugin that opens `.csv` files as a kanban, table, dashboard, or library UI. Built for Simon's book library and habit tracking. Four view modes:
- **Dashboard** — date-based habit tracking with chart, streaks, and stats (auto-detected when first column is dates).
- **Library** — grid of cards with filters (status, genre, search), collapsible genre sections, green-dot for done items, ratings, tags.
- **By Genre** — kanban grouped by category column, with status subgroups inside each column.
- **Table** — spreadsheet view with resizable columns.

The plugin used to also handle `.xlsx` (via SheetJS lazy-loaded chunk + `_csv_helpers/` mirror for Dataview). That whole stack was retired in commit "SWITCH TO CSV AS MAIN" — see [handoff.md](../handoff.md) for the rationale and the round-trip validator that proved the migration was lossless.

## FileView (not TextFileView)

Extends `FileView` directly. Historical reason: `TextFileView` decodes everything as UTF-8 before handing off — destroyed binary xlsx data when xlsx was still a registered extension. Now that the plugin is CSV-only, `TextFileView` would technically work, but `FileView` is left in place because the modal/view lifecycle is identical and switching is pure churn.

- **CSV read:** `vault.read()` → `parseCSV` (Papa wrapper in `src/utils.ts`)
- **CSV save:** `vault.modify()` with `Papa.unparse(...)`

All saves are debounced 600ms via `scheduleSave()` → `doSave()`. Edits commit to disk automatically — no explicit save button. Read/write failures surface to the user as `Notice`s, not silent `console.error`s.

## Data model

```typescript
interface CSVRow { [key: string]: string; }
// headers: string[]  — column order preserved
// rows: CSVRow[]     — all values stored as strings
```

Everything in memory. `onLoadFile` populates, `doSave` flushes.

## View modes

`type ViewMode = "kanban-genre" | "table" | "dashboard" | "library" | "travel"`. Switched via toolbar (only modes valid for the file's columns are shown). Full re-render on each switch.

## Module map (main.ts)

### Top-level

**`showSelectPicker(anchor, currentValue, allValues, onSelect, container)`** (in `src/utils.ts`)
Floating dropdown for select fields. Fixed-positioned below anchor. Search/filter, clear, "+ Add new", arrow-key navigation + Enter to commit. On desktop, dismisses on scroll/resize of any ancestor (capture-phase listener) and flips up when there isn't room below. On touch (`matchMedia("(pointer: coarse)")`) those listeners are skipped — focusing the search input on iOS pops the virtual keyboard which fires `resize`, which would dismiss the picker immediately.

### Classes

**`AddEntryModal extends Modal`**
"+ Add" toolbar button. Labeled form for every column. Notes → `<textarea>`, select cols → chip that opens `showSelectPicker`, everything else → `<input type="text">`. Requires at least one field filled.

**`NoteExpanderModal extends Modal`**
Wide modal (~780px) for viewing/editing a full entry. Three sections: header (title), fields bar (all non-notes columns, inline-editable), notes section (rendered markdown by default, click to enter edit). Works on a shallow copy; Cancel discards.

**`FileConfigModal extends Modal`**
"⚙ Columns" toolbar button. Dropdowns for category/status/notes/default-view + checkbox grid for habit-columns and `cardFields`. Saved to `settings.fileConfigs[filePath]`.

**`CardView extends FileView`**

| Method | Purpose |
|---|---|
| `onLoadFile(file)` | Reads CSV via `vault.read` + `parseCSV`, applies per-file default mode, calls `renderView()` |
| `doSave()` | `Papa.unparse` → `vault.modify` |
| `scheduleSave()` | 600ms debounce wrapper |
| `renderView()` | Clears and rebuilds entire `contentEl` |
| `renderToolbar(root)` | Mode buttons + search + ⚙ Columns + 📱 Mobile + 💾 Backup + + Add (mobile collapses Cols/Mobile/Backup into ⋯) |
| `renderKanbanGenre/Table/Dashboard/Library` | The four view renderers |
| `renderKanbanCard(container, row, ...)` | Single kanban card |
| `renderSelectField/makeEditable` | Inline editors |
| `openNoteExpander/openAddModal` | Modal openers |
| `openOrCreateNotes(row)` | Creates/opens sidecar `.md` |
| `resolveCol(candidates)` | First header matching any candidate (case-insensitive) |
| `getNotesCol/getStatusCol/getCategoryCol/getDateCol` | Per-file override → fallback chain |
| `getFilteredRows()` | Rows matching current search query |
| `generateMobileFiles()` | Stamps `<folder>/Mobile/<basename>.md` from one of three templates |
| `deleteWithUndo(row)` | Routes every delete path through a 6s Notice with Undo |
| `backupToArchive()` | Copies the current csv to `Archive/<basename>_YYYY-MM-DD.csv` (byte-identical, `readBinary` → `writeBinary`) |

The class constructor takes a typed `persistSettings: () => Promise<void>` callback. Previously `saveFileCfg()` reached the plugin via `(app as any).plugins.plugins["csv-card-view"]?.saveSettings()` — brittle and untyped. Now passed explicitly.

**`CardViewSettingTab extends PluginSettingTab`**
Global settings UI.

**`CardViewPlugin extends Plugin`**
Entry point. Registers view for `csv`, registers `csv-add` and `csv-refresh` code block processors. `vault.on("rename")` / `vault.on("delete")` hooks migrate or drop `fileConfigs` keys so per-file config survives file moves (see `migrateFileConfigKey` in `src/utils.ts`).

Key methods:
- `renderAddEntryForm(source, el, ctx)` — renders the `csv-add` code block as a form. Parses `file:`, reads headers, auto-detects select fields (cols with ≤15 unique values), writes new entries directly to the file. For habit-shape files (file has a date col), pre-fills from existing row matching the date input → submit reads as "Update". Title flips to "Updating ‹date›" and submit button label flips to "Update" (vs "Add") when the date matches.

## Column auto-detection (fallback chains)

When no per-file override is set, columns are resolved by trying candidates in order against actual headers (case-insensitive). First match wins.

| Role | Candidates |
|---|---|
| Notes | Notes → Note → Summary → Review → Quote → Quotes → Comment → Comments → Description → Annotation |
| Category | Category → Categories → Genre → Genres → Type → Types → Tag → Tags → Topic → Topics → Subject → Section |
| Status | Status → State → Progress → Stage → Read |
| Title | Title → Name |
| Author/subtitle | Author → Authors → Director → Artist → Creator → By |

## Per-file configuration

```typescript
interface FileConfig {
  categoryColumn?: string;
  notesColumn?: string;
  statusColumn?: string;
  habitColumns?: string[];   // dashboard habit toggles
  cardFields?: string[];     // fields surfaced on Library/Kanban cards
  defaultMode?: ViewMode;
  sortNewestFirst?: boolean; // table sort toggle
}
```

Stored in `settings.fileConfigs[file.path]`. Accessed via `this.fileCfg` getter. Saved via `saveFileCfg(cfg)`. `undefined` fields fall back to the chain above. Keys follow file renames/deletes via vault hooks (see `migrateFileConfigKey` in `src/utils.ts`, 4 tests in `test-plugin-logic.mjs`).

**Habit columns** — if `habitColumns` is unset, auto-detected by scanning for columns with binary values (0/1, true/false, yes/no, empty). FileConfigModal has a checkbox grid to override.

**cardFields** — if unset, auto-detects author + year + rating + theme. Checkbox grid in FileConfigModal lets the user pick which fields to render on cards.

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

Persisted to `<vault>/.obsidian/plugins/csv-card-view/data.json`. Travels with the vault on iCloud sync.

## Notes system

### Inline notes (in the xlsx cell)
Any column resolved by `getNotesCol()` is the notes field.

- **Kanban card** — preview (120 chars, markdown stripped) is itself the click-to-edit affordance. Empty state shows hover-revealed "+ Add note". Scroll position saved before opening expander, restored via multi-layer approach (immediate + double rAF + setTimeout). Textarea focus uses `preventScroll: true`.
- **Table** — 2-line preview. Clicking the cell opens `NoteExpanderModal`.

### Sidecar notes file
"✚ Notes file" / "📄 Open notes file" button. Path: `<csv-folder>/<notesSubfolder>/<sanitized-title>.md`. Created with YAML frontmatter from all non-notes columns + inline notes as seed content. Opens in new tab. `notesFileExists(row)` checks via `vault.getAbstractFileByPath()`.

## Dashboard view (date-based files)

Auto-selected when first column is detected as dates (YYYY-MM-DD pattern or named "date"/"day"/"datum").

- **Date navigator** — prev/next buttons, date dropdown, Today button
- **Habit toggles** — clickable ○/● for each habit column
- **Line chart** — habits completed per day (Chart.js, lazy-loaded)
- **Stats bar** — days logged, average per day, perfect days, current streak, best streak
- **Per-habit cards** — individual stats with progress bar; click expands a heatmap timeline

### Streak calculation
Streaks **break if a day is missed**. Algorithm checks consecutive rows are exactly 1 day apart. Current streak starts from today (or yesterday if today has no entry) and counts backwards only while dates are consecutive.

### Per-habit timeline
Heatmap grid: done (green), missed (red), no entry (grey). Month separators. Individual habit streak stats. Click card again or ✕ to close.

## Kanban by Genre

- Genres from splitting Category column on `,` — multi-genre entries appear in multiple columns
- Columns sorted alphabetically; column titles use `var(--text-accent)` to match Library headers
- Within each column, rows grouped by status with colored labels: `In progress` → blue, `Finished/Watched` → green, `Not started/Unwatched` → grey, `dropped` → red
- Status order: In progress → Finished → Not started (then any others)
- Right-click context menu: change status, open/create notes file, delete (uses `deleteWithUndo`)
- On mobile, CSS scroll-snap + `calc(100vw - 60px)` columns so swipe lands cleanly on the next column (desktop columns are 260–300px and looked half-cut on phones)
- Single scrollbar per direction — kanban content area gets a `.csv-content-area--no-yscroll` modifier and column bodies fill viewport via `min-height: 0` (the flex-min-content trap), so the page doesn't double-scroll

## Chip truncation
Long non-select field values in kanban cards truncate at 40 chars with `…`. Full text on hover via `title=`. CSS enforces `max-width: 200px; text-overflow: ellipsis` on `.csv-chip-value` as a second layer.

## Mobile dashboard system

Mobile dashboards remain useful for habit logging and read-only browsing because Dataview rendering is cheaper than the full plugin lift, even though the CSV is now natively opened by the plugin on mobile too.

"📱 Mobile" toolbar button stamps `<folder>/Mobile/<basename>.md` from one of three templates in `src/mobile-templates.ts`. Each template returns a complete markdown file with frontmatter (`obsidianUIMode: preview` for the Force View Mode community plugin), one or more `csv-add` / `csv-refresh` / `dataviewjs` blocks. Three template types:

1. **Habit tracker** — when first column is dates: csv-add form (pre-fills from existing row by date) + entries table.
2. **Library** — when category column exists: csv-add form + kanban/table toggle (collapsible genre sections with cards).
3. **Generic** — fallback: csv-add form + expandable scrollable table (used for dictionary etc.).

Both the `csv-add` write target and the `dataviewjs` read target point at the same canonical CSV. Pre-migration these were split because xlsx couldn't be read by Dataview directly, so a `_csv_helpers/<file>.csv` mirror was kept in sync on every save via three separate code paths (`doSave()`, `generateMobileFiles()`, and the `csv-add` submit handler). The mirror folder is gone — **one file, zero sync, zero possibility of drift between source and read-target.** If a future change tempts you to add a "secondary copy" of the data anywhere, push back: that's the bug class this architecture eliminated.

### csv-add code block
The plugin registers a `csv-add` markdown code block processor. Renders a labeled form for every column. Auto-detects column types from existing data: cols with ≤15 unique values become dropdowns with a "+ Custom" option. Writes directly to the CSV file. For habit-shape files (date col present), `syncFromExisting()` pre-fills the form when the date input matches an existing row; the card gets an `is-updating` class (subtle accent ring + tinted title) and the submit button label flips to "Update".

```csv-add
file: ../books.csv
```

File-path forms (resolved by `resolvePath` in `src/utils.ts`, 9 tests in `test-plugin-logic.mjs`):
- `books.csv` — sibling of the current note
- `../books.csv` / `../../foo.csv` — walked up from current folder (clamps at vault root)
- `Knowledge/Library/books.csv` — vault-relative

Generated dashboards always emit the `../` form so the data folder is portable — move the folder anywhere in the vault and dashboards still resolve.

### Three gotchas in the library template
- **CSV type coercion.** `dv.io.csv` parses with `dynamicTyping: true`, so a numeric-looking title like the book "1984" comes back as `Number`. Any string-only call (`.localeCompare`, `.toLowerCase`, `.split`) on a raw field must be wrapped in `String(...)`.
- **titleKey fallback.** Quotes/dictionary have no Title/Name column — the library template falls back through `Quote/Headline/Phrase`, then `headers[0]`.
- **Negative status values clutter the kanban.** `NEGATIVE_STATUS` filters out `no/not started/unwatched/unread/todo`. Affirmative finished values (`yes/watched/seen/finished/read`) render as a green dot on the title row, not a "Yes" chip.

Regressions in any of these are caught by `npm run test:mobile` (simulator runs each dataviewjs block against a stubbed runtime + real CSVs).

⚠️ **Generated `.md` files are NOT the source of truth — `src/mobile-templates.ts` is.** Manual edits get wiped the next time the user clicks "📱 Mobile" or runs `npm run regen:mobile`. Fix bugs in the template, then `npm run build:deploy && npm run regen:mobile && npm run test:mobile` to update + verify.

**Known still-duplicated:** `regenerate-mobile-dashboards.mjs` keeps its own parallel template copy — unifying needs a plain-JS rewrite so both `.ts` (esbuild) and `.mjs` (node) callers can import.

## Module layout

```
main.ts                  # CardView lifecycle + shared helpers (col detection, notes,
                         # context menu, renderView dispatch, renderViewPreservingScroll,
                         # getFilteredRows, renderSelectField, backupToArchive, loadMapSvg)
                         # + CardViewPlugin entry point. ~770 lines.
src/
├── types.ts             # Types, DEFAULT_SETTINGS, ResidencyRule, CARD_VIEW_TYPE
├── utils.ts             # parseCSV (Papa wrapper), showSelectPicker, sanitizeFilename, titleCase,
│                        # formatRatingForDisplay, resolvePath, migrateFileConfigKey
├── modals.ts            # AddEntryModal, NoteExpanderModal, FileConfigModal, SearchModal, makeFieldInput
├── field-types.ts       # column-type heuristics for the editor (pure, tested)
├── settings-tab.ts      # CardViewSettingTab + residency-rule editor
├── add-entry-form.ts    # the csv-add mobile entry form
├── mobile-templates.ts  # generateHabit/Library/GenericMobileDashboard (pure)
├── travel-data.ts       # analyzeTravel + country reference data (pure, tested)
├── residency.ts         # evaluateResidency rule engine (pure, tested)
├── travel-view.ts       # travel view renderer
└── view/
    ├── table.ts library.ts kanban.ts toolbar.ts dashboard.ts mobile.ts
```

**Renderer pattern.** Each view renderer is a free function `renderX(view, container)`
taking the `CardView` via a type-only import (no runtime cycle); the members they
reach are public on `CardView`. `dashboard.ts` owns the lazy `loadChart` so non-dashboard
sessions never load Chart.js.

**Test net.** `test-view-smoke.mjs` (+ `test-support/`) renders each view into jsdom
with Obsidian's `createEl`/etc. polyfilled onto `Element.prototype`; renderers are
driven by hand-built `view` stubs. `npm run test:view` / `test:all`. Add a renderer →
add a smoke case.

*(Optional future polish: a `ViewContext` interface so renderers depend on an explicit
contract instead of the whole `CardView` type. Not needed — current setup is type-safe.)*
