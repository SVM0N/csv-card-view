# CSV Card View

An [Obsidian](https://obsidian.md) plugin that opens `.csv` files as rich,
editable views — cards, kanban, table, a habit dashboard, a library browser,
a stats page, a one-entry-at-a-time focus reader, and an interactive travel
map — instead of raw text. Notes columns render as Markdown. Everything edits
in place and writes straight back to the one canonical CSV (no shadow copies,
no sync).

## Features

- **Nine view modes**, auto-selected from the columns in the file (see below).
- **Inline editing** — click a cell to edit; changes save back to the CSV.
  Date columns get a native `yyyy-mm-dd` picker; known columns get non-strict
  dropdowns (pick a suggestion or type your own).
- **Notes as Markdown** — any "notes"-style column renders and edits as
  Markdown, inline or in an expander.
- **Per-file configuration** — pick the category/status/notes columns, card
  fields, and default view per file (⚙ Columns). Kanban group-by and library
  sort choices persist per file too.
- **Mobile dashboards** — generate a DataviewJS dashboard with an add-entry
  form for phone use (📱 Mobile).
- **Anki sync** — push rows to Anki as flashcards in one click (🎴 Anki).
  Great for quotes and dictionary files. See [Anki sync](#anki-sync) for setup.
- **Multi-select for list columns** — category/genre/tags pickers toggle
  multiple values (✓ checkmarks, joined with `, `).
- **`csv-random` code block** — embed a random entry (quote of the day, word
  of the day) in any note, with a ↻ reshuffle button:

  ```
  ```csv-random
  file: ../quotes.csv
  ```
  ```

- **Palette commands** — "Add entry to current CSV", "Cycle view mode", and
  "Create tasks/travel/habit tracker file" (scaffold a new CSV preconfigured
  for that view), all hotkey-able.
- **Travel view** — an interactive world map + trip timeline + configurable
  residency/visa day-counters, for travel-log CSVs.

## View modes

The toolbar's view dropdown shows only the modes that make sense for the
file's columns (the ⚙ Columns "Default view" picker offers the same set):

| Mode | Appears when… | What it shows |
|------|---------------|---------------|
| **Travel** | `country` + `date_entered` + `date_left` + `source` columns | World choropleth, stats, per-country day totals, year timeline, editable trips |
| **Dashboard** | a date column is detected | Habit tracker: daily toggles, progress chart, streaks, per-habit calendars |
| **Tasks** | a `due`/`priority` column, or a `type` column with task/note/idea values | Project dashboard: rows grouped by `project` into three sections — Tasks (sorted done → priority → due, overdue flagged), Notes, and Ideas. Add+ prefills Type (Task/Note/Idea), Priority (Low/Medium/High) and a date picker for Due. Click-to-toggle done, click-to-edit priority, click a name for the entry overview, 📄/+ to open/create an optional backing page |
| **Cards** (library) | any groupable column exists (category preferred, else auto-picked) | Cards grouped by genre/category, with status dots, ratings, tags, and a sort selector (status / title / rating / year) |
| **Kanban** | any groupable column exists (category preferred, else auto-picked) | Columns by genre (or any column via the per-file "Group by" selector — year columns bucket into decades), grouped by status, with inline notes |
| **Table** | always | Editable spreadsheet view with resizable columns and click-to-sort headers |
| **Focus** | any non-empty file | One entry at a time, big typography — built for quote and dictionary files. Prev / random / next, ←/→ keys |
| **Stats** | a category, status, rating, or author column exists | Bar-chart insights: status breakdown, categories, rating histogram + average, entries per year, top authors. Status/category bars click through to the filtered library |

## Inline view (`csv-view` block)

Embed an editable table / cards / kanban view of a CSV **inside any note** — like
a `.base` block or a Notion linked-database view in a page. Point a fenced
`csv-view` block at a CSV file:

````
```csv-view
file: ../movies.csv      ← sibling name, ../walked, or vault-relative path (like csv-add)
mode: kanban             ← table | cards | kanban   (default: table)
height: 480              ← optional max content height in px
collapse: Removed, Done  ← optional: group values collapsed by default (Cards)
```
````

- **Reuses the real renderers** — `Table` / `Cards` / `Kanban` look and behave
  exactly like the full-page view, with a compact toolbar (mode switch, search,
  + Add). The title links to the source `.csv` in its own tab.
- **Fully editable.** Inline cell edits, status chips, the entry expander, + Add,
  and right-click → Delete (with Undo) all write back to the source CSV via the
  same path as the full view. Other open views of the same file (a `.csv` tab,
  another block) re-sync off the vault `modify` event.
- **`collapse:`** lists group values that start collapsed in Cards view; manual
  collapse/expand is also remembered per file (shared with the full-page view).
- Mode/search are per-block; group-by and sort persist to the same per-file
  config as the full-page view (one source of truth per file).

### Images in Cards / Kanban

If a column is named **Image / Cover / Poster / Thumbnail / Photo / Picture / Img**
(or you set an image column in per-file config), its value is rendered as a
thumbnail on each card. Accepts a vault path, `![[wikilink]]`, `![](path)`, or a
URL. Lazy-loaded; broken images quietly drop out. Works inline and full-page.

### Adding rows

The **+ Add** form renders the right control per column: a dropdown for
select/option columns, a textarea for notes, a date picker for date columns, and
a **toggle** for habit-style 0/1 columns (so logging a day is a tap, not typing
each value).

## Travel view

Point the plugin at a flat travel CSV with these columns:

```
date_entered,date_left,country,city,visa_status,notes,source,resolved
```

- `country` is an ISO-2 code (`US`, `GB`, `FR`…); `source` is `confirmed`,
  `inferred` (e.g. photo-derived), or `conflict`.
- The map colours **confirmed** countries gold and **photo-only** countries
  blue; conflict rows and photo rows that overlap a confirmed trip are excluded
  from the map/timeline/counts.
- **Click a country** (map, Countries table, or timeline segment) to open a
  detail panel with every trip there; click again or ✕ to close.
- If today falls inside a confirmed trip (a blank `date_left` counts as
  ongoing), a "📍 Currently in …" banner shows under the stats.
- Blank or partial dates (`2022-06-??`) are allowed — counted as
  visited-but-undated.
- The Confirmed-trips table is click-to-edit (dates, city, visa, notes).

The world map ships as `world-map.svg` beside the plugin and is loaded at
runtime, so it stays out of the JS bundle.

### Residency counters

Configurable day-counters render in the travel view as `used / threshold`
gauges (e.g. Schengen 90/180). Add and edit them in
**Settings → CSV Card View → Residency rules**. Each rule:

| Field | Meaning |
|-------|---------|
| **Label** | Display name, e.g. `🇺🇸 US substantial presence` |
| **Countries** | ISO-2 codes, comma-separated (one or many) |
| **Window** | `Calendar year`, `Rolling N days`, or `All time` |
| **Rolling days** | The N for a rolling window |
| **Threshold (days)** | The limit to compare against |
| **Exempt visas** | `visa_status` values that count as zero days (e.g. `F-1, J-1`) |
| **On-exceed label** | Text shown when over (e.g. `tax resident`) |
| **Note** | Optional caveat shown on the card |

A rule computes: *days in the listed countries, within the window, minus
exempt-visa rows, vs the threshold.* Counts confirmed trips only.
**These are indicators, not legal or tax advice.**

## Anki sync

The **🎴 Anki** toolbar button (also in the ⋯ menu) pushes the current CSV's
rows into [Anki](https://apps.ankiweb.net/) as flashcards — handy for quotes,
dictionary, and vocabulary files.

Each row becomes one **Basic** note: the front is the file's title/primary
column (or whichever column you pick), and every other non-empty column is
joined onto the back. Cards land in a deck named after the file (`quotes.csv`
→ deck "Quotes"), created automatically. Re-running the sync only adds rows
that aren't already in the deck, so it's safe to click repeatedly.

Pick which column is the card front per file in **⚙ Columns → Anki card
front** (defaults to the title/primary field).

**Setup (one-time):**

1. Install the [AnkiConnect](https://ankiweb.net/shared/info/2055492159)
   add-on in Anki: *Tools → Add-ons → Get Add-ons…* and paste code
   `2055492159`, then restart Anki.
2. Keep the Anki desktop app **running** when you sync.

Sync is desktop-only — it talks to AnkiConnect at `http://127.0.0.1:8765`, so
it won't work from the Obsidian mobile app. If Anki isn't running you'll get a
notice telling you so.

## Installation

Manual install (single-user / not in the community store):

1. Build: `npm install && npm run build`.
2. Copy `main.js`, `manifest.json`, `styles.css`, and `world-map.svg` into
   `<vault>/.obsidian/plugins/csv-card-view/`.
3. Enable **CSV Card View** in Settings → Community plugins.

`npm run deploy` does step 2 if your plugin folder is symlinked as
`./csv-card-view`.

## Development

```bash
npm run build        # bundle main.ts → main.js (esbuild)
npm run dev          # watch build
npm run build:deploy # build + copy assets to the plugin folder
npm run test:all     # csv-parser + plugin-logic + mobile + view smoke tests
npm run typecheck    # tsc --noEmit
```

### Layout

`main.ts` holds the `CardView` lifecycle, shared helpers, the `renderView`
dispatch, and the plugin entry point. Each view renderer and feature lives in
`src/`:

```
src/
  types.ts            settings + shared types
  utils.ts            pure helpers (CSV parse, rating format, select picker, column sort)
  modals.ts           add-entry / note-expander / search / file-config modals
  field-types.ts      column-type heuristics for the editor (pure, tested)
  settings-tab.ts     plugin settings + residency-rule editor
  add-entry-form.ts   the csv-add mobile entry form
  mobile-templates.mjs DataviewJS dashboard templates (plain JS — shared with the node regen script)
  travel-data.ts      travel analysis + country reference data (pure, tested)
  residency.ts        residency-rule evaluation (pure, tested)
  travel-view.ts      travel view renderer
  view/
    table.ts library.ts kanban.ts toolbar.ts dashboard.ts mobile.ts
    stats.ts focus.ts
```

### Tests

- `test-plugin-logic.mjs` / `test-csv-parser.mjs` — pure-logic unit tests
  (CSV parsing, field types, travel analysis, residency evaluation).
- `test-view-smoke.mjs` — renders each view into a jsdom DOM (Obsidian's
  `createEl`/etc. polyfilled in `test-support/`) and asserts structure;
  view renderers are exercised with hand-built `view` stubs.

See [handoff.md](handoff.md) and [docs/](docs/) (architecture, CSS classes,
dev workflow) for deeper reference.
