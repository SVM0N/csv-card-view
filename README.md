# CSV Card View

An [Obsidian](https://obsidian.md) plugin that opens `.csv` files as rich,
editable views — cards, kanban, table, a habit dashboard, a library browser,
and an interactive travel map — instead of raw text. Notes columns render as
Markdown. Everything edits in place and writes straight back to the one
canonical CSV (no shadow copies, no sync).

## Features

- **Six view modes**, auto-selected from the columns in the file (see below).
- **Inline editing** — click a cell to edit; changes save back to the CSV.
  Date columns get a native `yyyy-mm-dd` picker; known columns get non-strict
  dropdowns (pick a suggestion or type your own).
- **Notes as Markdown** — any "notes"-style column renders and edits as
  Markdown, inline or in an expander.
- **Per-file configuration** — pick the category/status/notes columns, card
  fields, and default view per file (⚙ Columns).
- **Mobile dashboards** — generate a DataviewJS dashboard with an add-entry
  form for phone use (📱 Mobile).
- **Travel view** — an interactive world map + trip timeline + configurable
  residency/visa day-counters, for travel-log CSVs.

## View modes

The toolbar shows only the modes that make sense for the file's columns:

| Mode | Appears when… | What it shows |
|------|---------------|---------------|
| **Travel** | `country` + `date_entered` + `date_left` + `source` columns | World choropleth, stats, per-country day totals, year timeline, editable trips |
| **Dashboard** | a date column is detected | Habit tracker: daily toggles, progress chart, streaks, per-habit calendars |
| **Cards** (library) | a category column is detected | Cards grouped by genre/category, with status dots, ratings, tags |
| **Kanban** | a category column is detected | Columns by genre, grouped by status, with inline notes |
| **Table** | always | Editable spreadsheet view with resizable columns |

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
  utils.ts            pure helpers (CSV parse, rating format, select picker)
  modals.ts           add-entry / note-expander / search / file-config modals
  field-types.ts      column-type heuristics for the editor (pure, tested)
  settings-tab.ts     plugin settings + residency-rule editor
  add-entry-form.ts   the csv-add mobile entry form
  mobile-templates.ts DataviewJS dashboard templates
  travel-data.ts      travel analysis + country reference data (pure, tested)
  residency.ts        residency-rule evaluation (pure, tested)
  travel-view.ts      travel view renderer
  view/
    table.ts library.ts kanban.ts toolbar.ts dashboard.ts mobile.ts
```

### Tests

- `test-plugin-logic.mjs` / `test-csv-parser.mjs` — pure-logic unit tests
  (CSV parsing, field types, travel analysis, residency evaluation).
- `test-view-smoke.mjs` — renders each view into a jsdom DOM (Obsidian's
  `createEl`/etc. polyfilled in `test-support/`) and asserts structure;
  view renderers are exercised with hand-built `view` stubs.

See [handoff.md](handoff.md) and [docs/](docs/) (architecture, CSS classes,
dev workflow) for deeper reference.
