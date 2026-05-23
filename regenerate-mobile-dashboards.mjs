/**
 * Regenerate mobile dashboards using the same templates as the deployed plugin.
 *
 * Why this exists: clicking "📱 Mobile" in Obsidian regenerates dashboards from
 * the plugin's templates, but that requires reloading Obsidian after each plugin
 * build and clicking the button on every XLSX file. This script does the same
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
const TEST_DIR = "Knowledge/Test";
const HELPERS_REL = `${TEST_DIR}/_csv_helpers`;

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
    .csv-m-section { margin-bottom:20px; }
    .csv-m-section summary { list-style:none; cursor:pointer; padding:8px 12px; border-radius:8px; font-weight:600; font-size:13px; letter-spacing:0.03em; display:flex; align-items:center; gap:8px; user-select:none; border:1px solid var(--background-modifier-border); }
    .csv-m-section summary::-webkit-details-marker { display:none; }
    .csv-m-section summary .arrow { font-size:10px; transition:transform 0.2s; }
    .csv-m-section[open] summary .arrow { transform:rotate(90deg); }
    .csv-m-section summary .count { font-weight:400; font-size:11px; opacity:0.5; margin-left:auto; }
    .csv-m-grid { display:grid; grid-template-columns:1fr; gap:10px; padding:12px 0; }
    .csv-m-grid.compact { grid-template-columns:1fr 1fr; gap:8px; }
    .csv-m-card { padding:12px 14px; border-radius:10px; background:var(--background-secondary); display:flex; flex-direction:column; gap:4px; }
    .csv-m-grid.compact .csv-m-card { padding:10px 12px; }
    .csv-m-card-title { font-weight:600; font-size:14px; display:flex; align-items:center; gap:8px; }
    .csv-m-grid.compact .csv-m-card-title { font-size:13px; }
    .csv-m-watched-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#5A8C4A; flex-shrink:0; }
    .csv-m-card-meta { font-size:12px; color:var(--text-muted); }
    .csv-m-card-year { font-size:11px; color:var(--text-muted); }
    .csv-m-card-rating { font-size:11px; color:var(--text-muted); letter-spacing:1px; }
    .csv-m-card-theme { display:inline-block; align-self:flex-start; font-size:10px; padding:2px 6px; border-radius:3px; background:var(--background-modifier-border); color:var(--text-muted); margin-top:2px; }
    .csv-m-card-status { display:inline-block; font-size:11px; padding:2px 8px; border-radius:4px; margin-top:6px; background:var(--background-modifier-border); color:var(--text-muted); }
    .csv-m-card-status.finished, .csv-m-card-status.read, .csv-m-card-status.watched { background:rgba(90,140,74,0.2); color:#5A8C4A; }
    .csv-m-card-status.in-progress, .csv-m-card-status.reading, .csv-m-card-status.watching { background:rgba(74,122,155,0.2); color:#4A7A9B; }
  `;

function libraryTemplate({ fileName, csvPath, tKey, cCol, sCol, aKey, yCol, rCol, thCol, compact }) {
  return `## Add Entry

\`\`\`csv-add
file: ${fileName}
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
      th.style.cssText = "text-align:left;padding:8px 10px;font-weight:500;color:var(--text-muted);font-size:12px;border-bottom:1px solid var(--background-modifier-border);";
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

      items.sort((a, b) => {
        const statusA = String(a[statusCol] || "").toLowerCase();
        const statusB = String(b[statusCol] || "").toLowerCase();
        const inProgressA = statusA.includes("progress") || statusA.includes("reading") || statusA.includes("watching");
        const inProgressB = statusB.includes("progress") || statusB.includes("reading") || statusB.includes("watching");
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

function genericTemplate({ fileName, csvPath, headers }) {
  return `## Add Entry

\`\`\`csv-add
file: ${fileName}
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
    .csv-m-tablewrap table { width:100%; border-collapse:collapse; font-size:13px; }
    .csv-m-tablewrap th { text-align:left; padding:10px 12px; font-weight:500; color:var(--text-muted); font-size:12px; white-space:nowrap; border-bottom:1px solid var(--background-modifier-border); background:var(--background-secondary); position:sticky; top:0; }
    .csv-m-tablewrap td { padding:10px 12px; vertical-align:top; border-bottom:1px solid var(--background-modifier-border); }
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

const TARGETS = [
  { xlsxBase: "books",         fileName: "books.xlsx" },
  { xlsxBase: "movies",        fileName: "movies.xlsx" },
  { xlsxBase: "quotes",        fileName: "quotes.xlsx" },
  { xlsxBase: "dictionary",    fileName: "dictionary.xlsx" },
  // habit_tracker has a date column and uses the habit template, which is unchanged.
  // Skip it here — the user can regenerate via the Obsidian button if needed.
];

let written = 0;
for (const t of TARGETS) {
  const csvPath = `${HELPERS_REL}/${t.xlsxBase}.csv`;
  const absCsv = path.join(VAULT, csvPath);
  if (!fs.existsSync(absCsv)) {
    console.log(`· skip ${t.xlsxBase}: helper CSV not found at ${csvPath}`);
    continue;
  }
  const raw = fs.readFileSync(absCsv, "utf8");
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields;

  let content;
  const cCol = categoryCol(headers);
  const dCol = dateCol(headers);
  if (dCol) {
    console.log(`· skip ${t.xlsxBase}: has date column (regenerate habit dashboard via Obsidian)`);
    continue;
  } else if (cCol) {
    const sCol = statusCol(headers) ?? "Status";
    content = libraryTemplate({
      fileName: t.fileName,
      csvPath,
      tKey: titleKey(headers),
      cCol,
      sCol,
      aKey: authorKey(headers),
      yCol: yearCol(headers),
      rCol: ratingCol(headers),
      thCol: themeCol(headers),
      compact: /^(watched|seen)$/i.test(sCol),
    });
  } else {
    content = genericTemplate({ fileName: t.fileName, csvPath, headers });
  }

  const outPath = path.join(VAULT, TEST_DIR, `${t.xlsxBase} - Mobile.md`);
  fs.writeFileSync(outPath, content);
  const kind = cCol ? "library" : "generic";
  console.log(`✓ wrote ${t.xlsxBase} - Mobile.md  (${kind}, titleKey="${titleKey(headers)}")`);
  written++;
}

console.log(`\n${written} dashboards regenerated.`);
