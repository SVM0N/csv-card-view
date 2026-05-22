# XLSX Card View — Claude Code Handoff

## What this is

An Obsidian plugin that opens `.csv` and `.xlsx` files as a kanban, table, or dashboard UI. Built for Simon's book library and habit tracking. Three views:
- **Dashboard** — date-based habit tracking with chart, streaks, and stats (auto-detected when first column is dates)
- **By Genre** — kanban grouped by category column
- **Table** — spreadsheet-style with resizable columns

---

## Project structure

```
csv-card-view/
├── main.ts              # Full plugin source (TypeScript) — edit this
├── main.js              # Compiled output — do not edit directly
├── styles.css           # All plugin CSS (~1300+ lines)
├── manifest.json        # Obsidian plugin manifest (id: csv-card-view)
├── package.json         # deps: xlsx (SheetJS), chart.js, esbuild, obsidian types
├── esbuild.config.mjs   # Build configuration
├── tsconfig.json        # TypeScript config
├── test-csv-parser.mjs  # CSV parsing tests (6 tests)
├── test-plugin-logic.mjs # Comprehensive plugin tests (54 tests)
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
npm run test             # Run plugin logic tests (54 tests)
npm run test:csv         # Run CSV parser tests (6 tests)
npm run test:all         # Run all tests (60 total)
npm run typecheck        # TypeScript type checking
npm run check            # Full check: typecheck + tests + build + deploy
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

`type ViewMode = "kanban-genre" | "table" | "dashboard"` — three active modes. Switched via toolbar. Full re-render on each switch.

- **Dashboard** — Auto-selected when first column is detected as dates (YYYY-MM-DD format or named "date"/"day"). Shows date navigator, habit toggles, line chart (Chart.js), stats (days logged, avg/day, perfect days, streaks), and per-habit cards.
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

## Known issues / future work

- [ ] **Per-file view configuration — views themselves** — currently the two view types (kanban-genre, table) are global and fixed. A future improvement: let each file declare which views are available and what they're named. E.g. a movie database might want "By Director" and "By Decade" kanbans, not "By Genre". Implementation: store a `views: ViewDefinition[]` array in `fileConfigs[path]`, where each `ViewDefinition` has a `type`, `label`, `groupCol`, and `subgroupCol`. The toolbar would render buttons dynamically from that array. The "⚙ Columns" modal would let the user add/remove/rename views and pick their column mappings.

- [ ] **fileConfigs key doesn't follow renames** — if a file is moved or renamed, its config entry becomes orphaned. Fix: hook into Obsidian's `vault.on("rename", ...)` event in `onload()` to migrate the key.

- [x] **Search/filter** — search bar in kanban and table views filters entries by any column value

- [ ] **Sort controls** — no column sorting in either view

- [ ] **Multi-value select for Category** — the picker sets a single string. Proper multi-select with individual chips would be better (comma-split for kanban columns already works on the read side)

- [ ] **Column widths not in the file** — widths saved in `data.json`, not the xlsx itself, so they don't travel if the file is opened in a different vault

- [ ] **Mobile file opening** — On iOS/Android, tapping a CSV or XLSX file opens the system share dialog instead of the plugin. This is an Obsidian mobile limitation — custom views for binary/non-markdown files aren't fully supported. Workaround: none currently; files must be viewed/edited on desktop.

- [ ] **Mobile UI** — resize handles don't work on touch; kanban horizontal scroll may be awkward on narrow screens

- [ ] **Kanban per-column "+ Add"** — no per-column add button in kanban-genre; the toolbar "+ Add" opens the modal but doesn't pre-fill the genre/category

- [ ] **saveFileCfg coupling** — `XLSXCardView.saveFileCfg()` accesses the plugin via `(app as any).plugins.plugins["csv-card-view"]`. This works but is fragile if the plugin ID changes. Better: pass a `saveSettings` callback into the view constructor.

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

**Test suite (60 tests):**
- Filename sanitization (illegal chars, whitespace, truncation, unicode)
- CSV parsing (CRLF, quotes, escaping, long fields, edge cases)
- Column resolution (case-insensitive matching, fallback chains)
- CSV round-trip serialization
- Edge cases (empty input, malformed data, special characters)
- Title case transformation
- Binary column detection (0/1, true/false, yes/no)
- Date column detection (by name and value pattern)
- Search filtering (partial match, case-insensitive, multi-column)

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
