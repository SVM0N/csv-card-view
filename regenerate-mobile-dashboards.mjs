/**
 * Regenerate mobile dashboards using the same templates as the deployed plugin.
 *
 * Why this exists: clicking "📱 Mobile" in Obsidian regenerates dashboards from
 * the plugin's templates, but that requires reloading Obsidian after each plugin
 * build and clicking the button on every CSV file. This script does the same
 * thing headlessly — useful for CI, for syncing all dashboards after a template
 * change, and for `test-mobile-dashboards.mjs` to verify against fresh files.
 *
 * The templates themselves are imported from `src/mobile-templates.mjs` — the
 * SAME module the plugin bundles, so there is no parallel copy to keep in
 * sync anymore. Only the column resolvers below mirror main.ts (they're a
 * few lines and main.ts's versions hang off the CardView instance).
 *
 * Run: node regenerate-mobile-dashboards.mjs
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  generateLibraryMobileDashboard,
  generateGenericMobileDashboard,
} from "./src/mobile-templates.mjs";

const VAULT = "/Users/simon/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain";
const LIB = "Knowledge/Library";

// ---------------------------------------------------------------------------
// Column resolvers (mirror main.ts)
// ---------------------------------------------------------------------------

const resolve = (headers, candidates) => {
  for (const c of candidates) {
    const found = headers.find(h => h.toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  return null;
};

const titleKey = headers =>
  resolve(headers, ["Title","title","Name","name"])
  ?? resolve(headers, ["Quote","quote","Headline","headline","Phrase","phrase"])
  ?? headers[0];

const categoryCol = headers => resolve(headers, [
  "Category","category","Categories","categories",
  "Genre","genre","Genres","genres",
  "Type","type","Tag","tag","Tags","tags",
  "Topic","topic","Topics","topics",
  "Subject","subject","Section","section",
]);

const statusCol = headers => resolve(headers, [
  "Status","status",
  "Watched","watched","Read","read","Done","done",
  "State","state",
]);

const authorKey = headers => resolve(headers, [
  "Author","author","Authors","authors",
  "Director","director","Artist","artist",
  "Creator","creator","By","by",
]);

const dateCol = headers => resolve(headers, [
  "Date","date","Day","day","Timestamp","timestamp","When","when",
]);

const yearCol = headers => resolve(headers, ["Year","year","Released","released"]);
const ratingCol = headers => resolve(headers, ["Rating","rating","Score","score","Stars","stars"]);
const themeCol = headers => resolve(headers, ["Theme","theme","Subgenre","subgenre","Mood","mood"]);

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const TARGETS = ["books", "movies", "quotes", "dictionary"];
// habit_tracker has a date column → uses the habit template (unchanged).
// Skip here; regenerate via the Obsidian button if needed.

const MOBILE_DIR_REL = `${LIB}/Mobile`;
const mobileAbs = path.join(VAULT, MOBILE_DIR_REL);
if (!fs.existsSync(mobileAbs)) fs.mkdirSync(mobileAbs, { recursive: true });

let written = 0;
for (const base of TARGETS) {
  // Post-migration: the canonical CSV lives next to the dashboard's parent
  // folder. csvPath (for dataviewjs read) and filePath (for csv-add write)
  // both resolve to the same file — used to be split because xlsx needed
  // a _csv_helpers/ mirror for Dataview.
  const csvPath = `${LIB}/${base}.csv`;
  const absCsv = path.join(VAULT, csvPath);
  if (!fs.existsSync(absCsv)) {
    console.log(`· skip ${base}: csv not found at ${csvPath}`);
    continue;
  }
  const raw = fs.readFileSync(absCsv, "utf8");
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields;
  // "../" so csv-add (which resolves relative to the dashboard's folder,
  // Mobile/) finds the data file in the parent folder. Stays valid if the
  // user later moves the parent folder anywhere in the vault.
  const filePath = `../${base}.csv`;

  let content;
  const cCol = categoryCol(headers);
  const dCol = dateCol(headers);
  if (dCol) {
    console.log(`· skip ${base}: has date column (regenerate habit dashboard via Obsidian)`);
    continue;
  } else if (cCol) {
    content = generateLibraryMobileDashboard({
      filePath,
      csvPath,
      titleKey: titleKey(headers),
      categoryCol: cCol,
      statusCol: statusCol(headers) ?? "Status",
      authorKey: authorKey(headers) ?? "",
      yearCol: yearCol(headers) ?? "",
      ratingCol: ratingCol(headers) ?? "",
      themeCol: themeCol(headers) ?? "",
      // 2-col compact grid when the file has a short Title/Name column
      // (books + movies). Quotes/dictionary have longer headline columns
      // so they stay 1-col. Mirrors main.ts.
      compactGrid: !!resolve(headers, ["Title","title","Name","name"]),
    });
  } else {
    content = generateGenericMobileDashboard({ filePath, csvPath, headers });
  }

  const outPath = path.join(mobileAbs, `${base}.md`);
  fs.writeFileSync(outPath, content);
  const kind = cCol ? "library" : "generic";
  console.log(`✓ wrote Mobile/${base}.md  (${kind}, titleKey="${titleKey(headers)}")`);
  written++;
}

console.log(`\n${written} dashboards regenerated.`);
