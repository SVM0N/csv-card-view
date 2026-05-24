# Dev workflow

Reference doc — load when running the dev loop, adding tests, or debugging build/deploy. For what the code does, see [architecture.md](architecture.md); for the CSS surface, see [css-classes.md](css-classes.md).

## Project structure

```
csv-card-view/
├── main.ts                       # XLSXCardView (legacy name), Settings, Plugin (~2200 lines)
├── main.js                       # Compiled output — do not edit directly (minified ~297 KB
│                                 # post-CSV migration; was 720 KB with SheetJS)
├── bench-load.mjs                # Measures bundle parse/eval cost; run after big refactors
├── src/
│   ├── types.ts                  # Types, interfaces, DEFAULT_SETTINGS (~40 lines)
│   ├── utils.ts                  # parseCSV (Papa), showSelectPicker, resolvePath,
│   │                             # migrateFileConfigKey, formatRatingForDisplay (~280 lines)
│   ├── modals.ts                 # Modal classes (~420 lines)
│   └── mobile-templates.ts       # Three dashboard template functions (~440 lines)
├── styles.css                    # All plugin CSS (~2700 lines)
├── manifest.json                 # Obsidian plugin manifest (id: csv-card-view)
├── package.json                  # deps: chart.js, papaparse, esbuild, obsidian types
│                                 # (xlsx/SheetJS removed in "SWITCH TO CSV AS MAIN")
├── esbuild.config.mjs            # Build config
├── tsconfig.json                 # TypeScript config
├── test-csv-parser.mjs           # CSV parsing tests (6)
├── test-plugin-logic.mjs         # Plugin logic tests (88) — sanitization, parsing, column
│                                 # resolution, round-trip, edge cases, title case, binary
│                                 # cols, date cols, search, dup detect, merge habit entry,
│                                 # sort order, formatRatingForDisplay (9), resolvePath (9),
│                                 # migrateFileConfigKey (4)
├── test-mobile-dashboards.mjs    # Mobile dashboard simulator (21) — extracts each dashboard's
│                                 # dataviewjs block from `Knowledge/Library/Mobile/<basename>.md`,
│                                 # runs it against a stubbed Dataview runtime backed by the real
│                                 # CSVs (Papa Parse with `dynamicTyping: true` — mirrors the
│                                 # `1984` Number coercion that triggered the original
│                                 # localeCompare bug). Asserts no thrown errors, no Untitled
│                                 # cards, no negative status pills, ≥1 watched-dot, compact
│                                 # grid + year/rating/theme on movies, scrollable table wrap
│                                 # on generic dashboards. Skips missing files mid-iCloud-sync.
│                                 # ⚠️ Hardcoded vault paths under `Knowledge/Library/...` —
│                                 # update if the data folder moves.
├── regenerate-mobile-dashboards.mjs  # Headless regenerator (`npm run regen:mobile`) — mirrors
│                                 # the plugin's template dispatcher and stamps fresh dashboards
│                                 # without needing Obsidian reload + button clicks. Same
│                                 # hardcoded-path caveat as the simulator.
├── xlsx-to-csv-roundtrip.mjs     # One-shot validator (kept for record). Proved Papa
│                                 # round-trips xlsx losslessly before the CSV migration.
├── migrate-xlsx-to-csv.mjs       # One-shot migration script (kept for record). Wrote
│                                 # canonical csv, archived xlsx to Archive/, dropped
│                                 # _csv_helpers/, rewrote fileConfigs keys.
├── normalize-stars.mjs           # One-shot: convert ⭐️ (U+2B50 + VS-16) → ★ (U+2605).
│                                 # Operated on xlsx pre-migration; kept for reference.
├── normalize-watched.mjs         # One-shot: convert movies Watched column Yes→Watched,
│                                 # No→Unwatched. Already run.
├── csv-card-view/                # Symlink to Obsidian plugin folder
├── docs/                         # Reference docs (architecture, css-classes, dev-workflow)
└── handoff.md                    # Session pickup (lean — points here for details)
```

## Live data location

`Knowledge/Library/` in the iCloud vault holds the five canonical CSV files (movies, books, quotes, dictionary, habit_tracker). `Mobile/` and `Archive/` are created as needed by the plugin on first click of the respective buttons. `Archive/` also contains `*_pre-csv-migration.xlsx` originals preserved during the SWITCH TO CSV AS MAIN migration. All dev scripts already point at `Knowledge/Library/` — search/replace if the user moves the folder again.

## Build & Deploy

```bash
npm install              # Install dependencies
npm run build            # Build main.js (minified, ~720 KB)
npm run build:deploy     # Build and copy to Obsidian plugin folder
npm run dev              # Watch mode (rebuild on changes, unminified, inline sourcemaps)
npm run deploy           # Copy already-built files to Obsidian plugin folder
```

Watch mode is unminified with inline sourcemaps so DevTools in Obsidian stays readable during dev. Production builds (`npm run build`, `build:deploy`) minify.

Install in Obsidian: copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/csv-card-view/` and enable in Community plugins. The `csv-card-view/` folder in this repo is a symlink to that path, so `npm run deploy` (or `build:deploy`) updates the plugin in place. Cmd+R in Obsidian reloads.

## Testing

```bash
npm run test             # Plugin logic tests (88)
npm run test:csv         # CSV parser tests (6)
npm run test:mobile      # Mobile dashboard simulator (21)
npm run test:all         # All of the above (115 total)
npm run typecheck        # TypeScript type checking
npm run check            # Full check: typecheck + tests + build + deploy
npm run regen:mobile     # Stamp fresh mobile dashboards into the vault (after template change)
```

### Test surface

- **CSV parsing** — CRLF, quotes, escaping, long fields, embedded newlines, Unicode, empty input.
- **Column resolution** — case-insensitive matching, fallback chains.
- **Round-trip serialization** — Papa unparse → parseCSV round-trip stability.
- **Title case, binary col detection, date col detection, search filtering.**
- **`findExistingRowByDate` / `mergeHabitEntry` / `sortByDate`** — habit-tracker write paths.
- **`formatRatingForDisplay`** (9) — empty / unrated / glyph-pass-through / numeric / text-mapped / out-of-range / unknown-on-rating-col / unknown-on-other-col.
- **`resolvePath`** (9) — sibling / vault-relative / `../` / `../../` / `./` / mixed / root-clamp.
- **`migrateFileConfigKey`** (4) — rename moves config, delete drops it, no-op for missing keys, caller-set new entry wins.
- **Mobile dashboard simulator** (21) — per-file no-throw + render assertions, movie-specific compact-grid/year/rating/theme checks, generic-table wrap, watched-dot count.

The mobile simulator runs the dataviewjs body against real CSVs via Papa Parse with `dynamicTyping: true`, so any drift between template and rendered output fails the test the same way it would fail in Obsidian.

## Active dev loop

```bash
npm run build:deploy && npm run regen:mobile && npm run test:all
# then Cmd+R in Obsidian to load the new plugin
```

If you only changed plugin code (not a mobile template): drop `regen:mobile`. If you only changed a mobile template: still run `regen:mobile` to push it into the vault, then `test:mobile` to verify.

## Bench

`node bench-load.mjs main.js` measures V8 parse cost on the bundle text + parse+top-level eval. 5-run averages. Current baseline:

| Stage | Size | Parse only | Parse+eval |
|---|---|---|---|
| Eager + unminified (historical) | 1338 KB | 2.6 ms | 3.4 ms |
| Lazy + unminified | 1533 KB | 2.0 ms | 0.8 ms |
| Lazy + minified (with SheetJS) | 720 KB | 1.5 ms | 0.9 ms |
| **CSV-only (current, post-migration)** | **297 KB** | **0.7 ms** | **0.5 ms** |

Chart.js is dynamic-imported (only initialises when dashboard renders). SheetJS is gone entirely — the CSV-only migration retired it. Run the bench after any refactor that touches imports/bundling.

## Settings persistence (data.json)

All plugin settings saved to:

```
<vault>/.obsidian/plugins/csv-card-view/data.json
```

Obsidian writes this automatically via `saveData()` / `loadData()`. Persists across sessions, restarts, and devices (travels with vault on iCloud sync). Example:

```json
{
  "defaultMode": "kanban-genre",
  "statusColumn": "status",
  "categoryColumn": "category",
  "notesSubfolder": "Notes",
  "columnWidths": { "Name": 240, "Notes": 400 },
  "selectColumns": ["Category", "Type", "Rating", "Status"],
  "fileConfigs": {
    "Knowledge/Library/books.csv": {
      "categoryColumn": "Category",
      "notesColumn": "Notes",
      "statusColumn": "Status",
      "defaultMode": "kanban-genre"
    }
  }
}
```

File-rename/delete hooks migrate `fileConfigs` keys automatically — old `Knowledge/Test/...` entries in the user's live `data.json` may still be orphaned from before that fix; hand-edit if you want them back. The SWITCH TO CSV AS MAIN migration also rewrote `*.xlsx` keys to `*.csv` in-place.

## Manual test checklist

- Open `books.csv` → opens in By Genre view.
- Genre columns render with status subgroups (In progress / Finished / Not started).
- Hover card → buttons appear; click the note preview → textarea opens inline; blur saves and scroll position restored.
- Click "⤢ Expand" → NoteExpanderModal opens; fields bar shows all columns; text fields click-to-edit; select chips open picker; click rendered notes to edit; Cancel discards; Save & close commits.
- Click "+ Add" → AddEntryModal opens; all fields present; select chips work; submit adds row, notice shown.
- Click "⚙ Columns" → FileConfigModal opens; dropdowns show all headers; checkbox grid for habit cols + cardFields; save persists to data.json.
- Long chip values truncate with `…`; full text shown on hover.
- Switch to Table view; resize columns; click notes cell → NoteExpanderModal opens (no inline editing).
- Right-click kanban / library / table row → change status, delete (with undo).
- Delete a row → 6s Notice with Undo button → click Undo, row restored to original index.
- Click "💾 Backup" → `Archive/<basename>_<date>.csv` appears (byte-identical to source); same-day repeat refused.
- Click "📱 Mobile" → `<folder>/Mobile/<basename>.md` appears; open on phone — Reading view; csv-add form pre-fills for habit tracker; submit writes to the canonical csv (no helper mirror).
- Verify csv saved correctly by reopening or checking mtime.
