/**
 * Regenerate mobile dashboards using the same templates as the deployed plugin.
 *
 * Why this exists: clicking "📱 Mobile" in Obsidian regenerates dashboards from
 * the plugin's templates, but that requires reloading Obsidian after each plugin
 * build and clicking the button on every CSV file. This script does the same
 * thing headlessly — useful for CI, for syncing all dashboards after a template
 * change, and for `test-mobile-dashboards.mjs` to verify against fresh files.
 *
 * The templates are kept in sync with main.ts by hand. If you change the
 * generators in main.ts, mirror the change here. The simulator catches drift
 * empirically by running both.
 *
 * Run: node regenerate-mobile-dashboards.mjs
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

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
// Templates (mirror main.ts generators)
// ---------------------------------------------------------------------------

const LIBRARY_STYLES = `
    .csv-m-toggle { display:flex; gap:8px; margin-bottom:16px; }
    .csv-m-toggle button { padding:6px 12px; border:none; background:transparent; color:var(--text-muted); font-size:13px; font-weight:500; cursor:pointer; border-radius:6px; }
    .csv-m-toggle button.active { background:var(--background-secondary); color:var(--text-normal); }
    .csv-m-section { margin-bottom:14px; }
    .csv-m-section summary { list-style:none; cursor:pointer; padding:6px 4px; font-weight:600; font-size:13px; display:flex; align-items:center; gap:8px; user-select:none; color:var(--text-normal); }
    .csv-m-section summary::-webkit-details-marker { display:none; }
    .csv-m-section summary .arrow { font-size:11px; color:var(--text-faint); transition:transform 0.2s; line-height:1; }
    .csv-m-section[open] summary .arrow { transform:rotate(90deg); }
    .csv-m-section summary .count { font-weight:500; font-size:12px; color:var(--text-faint); margin-left:auto; }
    .csv-m-grid { display:grid; grid-template-columns:1fr; gap:8px; padding:8px 0 2px; }
    .csv-m-grid.compact { grid-template-columns:1fr 1fr; gap:8px; }
    .csv-m-card { padding:10px 12px; border-radius:10px; background:var(--background-secondary); display:flex; flex-direction:column; gap:4px; }
    .csv-m-card-title { font-weight:600; font-size:13px; display:flex; align-items:center; gap:8px; line-height:1.3; }
    .csv-m-watched-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--csv-green, #30A14E); flex-shrink:0; }
    .csv-m-card-meta { font-size:12px; color:var(--text-muted); }
    .csv-m-card-year { font-size:11px; color:var(--text-muted); }
    .csv-m-card-rating { font-size:11px; color:var(--text-muted); letter-spacing:1px; }
    .csv-m-card-theme { display:inline-block; align-self:flex-start; font-size:11px; padding:2px 8px; border-radius:999px; background:var(--background-modifier-border); color:var(--text-muted); margin-top:4px; }
    .csv-m-card-status { display:inline-block; align-self:flex-start; font-size:11px; padding:2px 8px; border-radius:999px; margin-top:4px; background:var(--background-modifier-border); color:var(--text-muted); }
    .csv-m-card-status.finished, .csv-m-card-status.read, .csv-m-card-status.watched { background:var(--csv-green-bg, rgba(52,199,89,0.13)); color:var(--csv-green, #30A14E); }
    .csv-m-card-status.in-progress, .csv-m-card-status.reading, .csv-m-card-status.watching { background:var(--csv-blue-bg, rgba(0,122,255,0.13)); color:var(--csv-blue, #2E7CE6); }
  `;

const FRONTMATTER = `---
obsidianUIMode: preview
obsidianEditingMode: source
---
`;

function libraryTemplate({ filePath, csvPath, tKey, cCol, sCol, aKey, yCol, rCol, thCol, compact }) {
  return `${FRONTMATTER}## Add Entry

\`\`\`csv-add
file: ${filePath}
\`\`\`

## Library

\`\`\`csv-refresh
\`\`\`

\`\`\`dataviewjs
const csvData = await dv.io.csv("${csvPath}");
if (!csvData || !csvData.length) {
  dv.paragraph("No data found");
} else {
  const data = csvData.array();
  const container = dv.container;

  // Keys
  const titleKey = "${tKey}";
  const categoryCol = "${cCol}";
  const statusCol = "${sCol}";
  const authorKey = "${aKey || ""}";
  const yearCol = "${yCol || ""}";
  const ratingCol = "${rCol || ""}";
  const themeCol = "${thCol || ""}";
  const compactGrid = ${compact};

  // View state
  const viewKey = "csv-mobile-view-" + dv.current().file.path;
  const modeKey = "csv-mobile-mode-" + dv.current().file.path;
  let viewMode = localStorage.getItem(modeKey) || "kanban";

  // Inject styles
  const style = container.createEl("style");
  style.textContent = \`${LIBRARY_STYLES}\`;

  // View toggle
  const toggleWrap = container.createEl("div", { cls: "csv-m-toggle" });
  ["Kanban", "Table"].forEach(mode => {
    const btn = toggleWrap.createEl("button", { text: mode });
    if (mode.toLowerCase() === viewMode) btn.classList.add("active");
    btn.onclick = () => { localStorage.setItem(modeKey, mode.toLowerCase()); location.reload(); };
  });

  if (viewMode === "table") {
    const tableWrap = container.createEl("div");
    tableWrap.style.cssText = "overflow-x:auto;font-size:14px;";
    const table = tableWrap.createEl("table");
    table.style.cssText = "width:100%;border-collapse:collapse;";
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    [titleKey, categoryCol, statusCol].filter(Boolean).forEach(h => {
      const th = headerRow.createEl("th", { text: h });
      // Match desktop table convention: uppercase, 11px, tracked, muted.
      th.style.cssText = "text-align:left;padding:8px 10px;font-weight:600;color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--background-modifier-border);";
    });
    const tbody = table.createEl("tbody");
    data.slice(-30).reverse().forEach(r => {
      const row = tbody.createEl("tr");
      [titleKey, categoryCol, statusCol].filter(Boolean).forEach(col => {
        const td = row.createEl("td", { text: String(r[col] ?? "") });
        td.style.cssText = "padding:10px;font-size:13px;";
      });
    });
  } else {
    // Kanban view — group by category. String() guards against numeric values that
    // Dataview's CSV parser coerces (e.g. the book "1984" → Number).
    const groups = {};
    data.forEach(r => {
      const cats = String(r[categoryCol] || "Uncategorized").split(",").map(c => c.trim());
      cats.forEach(cat => {
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(r);
      });
    });

    const NEGATIVE_STATUS = new Set(["", "no", "not started", "unwatched", "unread", "todo"]);
    const WATCHED_AFFIRMATIVE = new Set(["yes", "watched", "seen", "finished", "read"]);

    Object.keys(groups).sort().forEach(cat => {
      const items = groups[cat];
      const section = container.createEl("details", { cls: "csv-m-section" });
      section.open = true;
      const summary = section.createEl("summary");
      summary.innerHTML = '<span class="arrow">▶</span> ' + cat + ' <span class="count">' + items.length + '</span>';

      const grid = section.createEl("div", { cls: "csv-m-grid" + (compactGrid ? " compact" : "") });

      // Sort: green-dotted (read/watched/finished) first, then in-progress,
      // then the rest. Mirrors desktop Library.
      items.sort((a, b) => {
        const statusA = String(a[statusCol] || "").toLowerCase();
        const statusB = String(b[statusCol] || "").toLowerCase();
        const isDone = (s) => /^(yes|watched|seen|finished|read|done|completed)$/.test(s);
        const isInProgress = (s) => s.includes("progress") || s.includes("reading") || s.includes("watching");
        const doneA = isDone(statusA), doneB = isDone(statusB);
        if (doneA !== doneB) return doneA ? -1 : 1;
        const inProgressA = isInProgress(statusA), inProgressB = isInProgress(statusB);
        if (inProgressA !== inProgressB) return inProgressA ? -1 : 1;
        return String(a[titleKey] || "").localeCompare(String(b[titleKey] || ""));
      });

      items.forEach(r => {
        const title = String(r[titleKey] ?? "").trim();
        if (!title) return;
        const status = String(r[statusCol] || "").trim();
        const statusLc = status.toLowerCase();
        const affirmative = WATCHED_AFFIRMATIVE.has(statusLc);

        const card = grid.createEl("div", { cls: "csv-m-card" });
        const titleEl = card.createEl("div", { cls: "csv-m-card-title" });
        if (affirmative) {
          titleEl.createEl("span", { cls: "csv-m-watched-dot", attr: { title: status } });
        }
        titleEl.createEl("span", { text: title });

        const year = yearCol ? String(r[yearCol] ?? "").trim() : "";
        if (year) card.createEl("div", { cls: "csv-m-card-year", text: year });

        if (!compactGrid && authorKey && r[authorKey]) {
          card.createEl("div", { cls: "csv-m-card-meta", text: String(r[authorKey]) });
        }

        const rating = ratingCol ? String(r[ratingCol] ?? "").trim() : "";
        if (rating && rating.toLowerCase() !== "unrated") {
          card.createEl("div", { cls: "csv-m-card-rating", text: rating });
        }

        const theme = themeCol ? String(r[themeCol] ?? "").split(",")[0].trim() : "";
        if (theme) card.createEl("span", { cls: "csv-m-card-theme", text: theme });

        if (status && !NEGATIVE_STATUS.has(statusLc) && !affirmative) {
          const statusEl = card.createEl("span", { cls: "csv-m-card-status", text: status });
          statusEl.classList.add(statusLc.replace(/\\s+/g, "-"));
        }
      });
    });
  }
}
\`\`\`

---
<small style="color:var(--text-faint)">Requires Dataview plugin with DataviewJS enabled</small>
`;
}

function genericTemplate({ filePath, csvPath, headers }) {
  return `${FRONTMATTER}## Add Entry

\`\`\`csv-add
file: ${filePath}
\`\`\`

## Entries

\`\`\`csv-refresh
\`\`\`

\`\`\`dataviewjs
const csvData = await dv.io.csv("${csvPath}");
if (!csvData || !csvData.length) {
  dv.paragraph("No data found");
} else {
  const data = csvData.array();
  const headers = [${headers.map(h => JSON.stringify(h)).join(", ")}];
  const container = dv.container;

  const viewKey = "csv-mobile-view-" + dv.current().file.path;
  let showAll = localStorage.getItem(viewKey) === "all";

  const style = container.createEl("style");
  style.textContent = \`
    .csv-m-toggle { display:flex; gap:8px; margin-bottom:16px; }
    .csv-m-toggle button { padding:6px 12px; border:none; background:transparent; color:var(--text-muted); font-size:13px; font-weight:500; cursor:pointer; border-radius:6px; }
    .csv-m-toggle button.active { background:var(--background-secondary); color:var(--text-normal); }
    .csv-m-tablewrap { overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid var(--background-modifier-border); border-radius:8px; }
    .csv-m-tablewrap table { min-width:100%; border-collapse:collapse; font-size:13px; }
    .csv-m-tablewrap th { text-align:left; padding:10px 12px; font-weight:600; color:var(--text-faint); font-size:11px; text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap; border-bottom:1px solid var(--background-modifier-border); background:var(--background-secondary); position:sticky; top:0; }
    .csv-m-tablewrap td { padding:10px 12px; vertical-align:top; border-bottom:1px solid var(--background-modifier-border); }
    /* Keep short fields on one line; the last column (typically long text like
       Meaning or Description) is the only one that wraps. */
    .csv-m-tablewrap td:not(:last-child) { white-space:nowrap; }
    .csv-m-tablewrap td:last-child { white-space:normal; min-width:200px; }
    .csv-m-tablewrap tr:last-child td { border-bottom:none; }
    .csv-m-hint { color:var(--text-faint); font-size:12px; margin-top:8px; }
  \`;

  const toggleWrap = container.createEl("div", { cls: "csv-m-toggle" });
  const recentBtn = toggleWrap.createEl("button", { text: "Recent" });
  const allBtn = toggleWrap.createEl("button", { text: "All " + data.length });
  if (!showAll) recentBtn.classList.add("active");
  else allBtn.classList.add("active");
  recentBtn.onclick = () => { localStorage.setItem(viewKey, "recent"); location.reload(); };
  allBtn.onclick = () => { localStorage.setItem(viewKey, "all"); location.reload(); };

  const entries = showAll ? [...data].reverse() : data.slice(-15).reverse();

  const tableWrap = container.createEl("div", { cls: "csv-m-tablewrap" });
  const table = tableWrap.createEl("table");
  const thead = table.createEl("thead");
  const headerRow = thead.createEl("tr");
  headers.forEach(h => headerRow.createEl("th", { text: h }));
  const tbody = table.createEl("tbody");
  entries.forEach(r => {
    const row = tbody.createEl("tr");
    headers.forEach(h => row.createEl("td", { text: String(r[h] ?? "") }));
  });

  if (!showAll && data.length > 15) {
    const hint = container.createEl("p", { cls: "csv-m-hint" });
    hint.textContent = "Showing last 15 of " + data.length + " entries — tap All to expand";
  }
}
\`\`\`

---
<small style="color:var(--text-faint)">Requires Dataview plugin with DataviewJS enabled</small>
`;
}

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
    const sCol = statusCol(headers) ?? "Status";
    content = libraryTemplate({
      filePath,
      csvPath,
      tKey: titleKey(headers),
      cCol,
      sCol,
      aKey: authorKey(headers),
      yCol: yearCol(headers),
      rCol: ratingCol(headers),
      thCol: themeCol(headers),
      // 2-col compact grid when the file has a short Title/Name column
      // (books + movies). Quotes/dictionary have longer headline columns
      // so they stay 1-col. Mirrors main.ts.
      compact: !!resolve(headers, ["Title","title","Name","name"]),
    });
  } else {
    content = genericTemplate({ filePath, csvPath, headers });
  }

  const outPath = path.join(mobileAbs, `${base}.md`);
  fs.writeFileSync(outPath, content);
  const kind = cCol ? "library" : "generic";
  console.log(`✓ wrote Mobile/${base}.md  (${kind}, titleKey="${titleKey(headers)}")`);
  written++;
}

console.log(`\n${written} dashboards regenerated.`);
