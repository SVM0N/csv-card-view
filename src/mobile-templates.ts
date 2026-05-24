import { titleCase } from "./utils";

/**
 * Mobile dashboard templates.
 *
 * Each function returns a complete markdown file ready to be written under
 * `<folder>/Mobile/<basename>.md`. The body is a frontmatter block plus one
 * or more `csv-add` / `csv-refresh` / `dataviewjs` blocks. The xlsx-side
 * source of truth is the file referenced by `filePath`; the dataviewjs
 * reads from the CSV helper at `csvPath` because Dataview on mobile can't
 * parse xlsx.
 *
 * These were inline template literals on CardView for most of the
 * project's life. Moved out here so:
 *   - main.ts stops shipping ~400 lines of stringified JS that has no
 *     syntax-highlight, no type-check, no isolated test entry point;
 *   - any future template change is a contained diff in this file;
 *   - the regen script (`regenerate-mobile-dashboards.mjs`) still has a
 *     parallel copy — eliminating that duplication needs a plain-JS rewrite
 *     of these functions and is its own session. The mobile-dashboard
 *     simulator (`test-mobile-dashboards.mjs`) catches drift empirically.
 *
 * Three gotchas worth keeping in mind when editing:
 *   - CSV type coercion: Dataview's `dv.io.csv` returns numbers for
 *     numeric-looking values (the book title "1984" comes back as Number).
 *     Any string-only call (.localeCompare, .toLowerCase, .split) on a
 *     raw field must be wrapped in String(...).
 *   - titleKey fallback: quotes/dictionary have no Title/Name column —
 *     the library template falls back through Quote/Headline/Phrase.
 *   - Negative status values clutter the kanban: "no" / "unwatched" /
 *     "todo" are filtered out so unfinished items render quietly.
 *     Affirmative finished values (yes/watched/seen/finished/read)
 *     render as a green dot, not a "Yes" chip.
 */

const FRONTMATTER = `---
obsidianUIMode: preview
obsidianEditingMode: source
---
`;

const DATAVIEW_FOOTER = `
---
<small style="color:var(--text-faint)">Requires Dataview plugin with DataviewJS enabled</small>
`;

export interface HabitTemplateOptions {
  /** Note-relative path to the source xlsx (`../<basename>.xlsx`). */
  filePath: string;
  /** Vault-relative path to the CSV helper file. */
  csvPath: string;
  /** Columns to render as habit toggles. */
  habitCols: string[];
  /** Column name holding the date. Used inside the dataviewjs block. */
  dateCol: string;
}

export function generateHabitMobileDashboard(opts: HabitTemplateOptions): string {
  const { filePath, csvPath, habitCols, dateCol } = opts;
  const labels = habitCols.map(h => titleCase(h));

  return `${FRONTMATTER}## Quick Add

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
  const habits = [${habitCols.map(h => `"${h}"`).join(", ")}];
  const labels = [${labels.map(h => `"${h}"`).join(", ")}];

  // View toggle state (stored in localStorage)
  const viewKey = "csv-mobile-view-" + dv.current().file.path;
  let showAll = localStorage.getItem(viewKey) === "all";

  const container = dv.container;

  // View toggle buttons
  const toggleWrap = container.createEl("div", { cls: "csv-mobile-toggle" });
  const recentBtn = toggleWrap.createEl("button", { text: "Recent", cls: showAll ? "" : "active" });
  const allBtn = toggleWrap.createEl("button", { text: "All " + data.length, cls: showAll ? "active" : "" });

  recentBtn.onclick = () => { localStorage.setItem(viewKey, "recent"); location.reload(); };
  allBtn.onclick = () => { localStorage.setItem(viewKey, "all"); location.reload(); };

  // Apply minimal styles
  toggleWrap.style.cssText = "display:flex;gap:8px;margin-bottom:16px;";
  [recentBtn, allBtn].forEach(btn => {
    btn.style.cssText = "padding:6px 12px;border:none;background:transparent;color:var(--text-muted);font-size:13px;font-weight:500;cursor:pointer;border-radius:6px;";
    if (btn.classList.contains("active")) {
      btn.style.background = "var(--background-secondary)";
      btn.style.color = "var(--text-normal)";
    }
  });

  // Get entries based on view
  const entries = showAll ? [...data].reverse() : data.slice(-10).reverse();

  // Table wrapper
  const tableWrap = container.createEl("div");
  tableWrap.style.cssText = "overflow-x:auto;font-size:14px;";

  // Render table
  const table = tableWrap.createEl("table");
  table.style.cssText = "width:100%;border-collapse:collapse;";

  // Header
  const thead = table.createEl("thead");
  const headerRow = thead.createEl("tr");
  ["Date", ...labels].forEach(h => {
    const th = headerRow.createEl("th", { text: h });
    th.style.cssText = "text-align:left;padding:8px 10px;font-weight:500;color:var(--text-muted);font-size:12px;white-space:nowrap;border-bottom:1px solid var(--background-modifier-border);";
    if (h !== "Date") th.style.textAlign = "center";
  });

  // Body
  const tbody = table.createEl("tbody");
  entries.forEach(r => {
    const dateVal = r["${dateCol}"];
    let shortDate = "";
    if (dateVal?.toFormat) {
      shortDate = dateVal.toFormat("MM-dd");
    } else if (dateVal instanceof Date) {
      shortDate = (dateVal.getMonth()+1).toString().padStart(2,"0") + "-" + dateVal.getDate().toString().padStart(2,"0");
    } else {
      const s = String(dateVal ?? "");
      shortDate = s.length >= 10 ? s.slice(5, 10) : s;
    }

    const row = tbody.createEl("tr");
    const dateCell = row.createEl("td", { text: shortDate });
    dateCell.style.cssText = "padding:10px;color:var(--text-muted);font-size:13px;";

    habits.forEach(h => {
      const td = row.createEl("td");
      td.style.cssText = "padding:10px;text-align:center;";
      const done = r[h] == "1" || r[h] == "true";
      td.textContent = done ? "✓" : "·";
      td.style.color = done ? "var(--text-accent)" : "var(--text-faint)";
      td.style.fontWeight = done ? "600" : "400";
    });
  });

  if (!showAll && data.length > 10) {
    const hint = container.createEl("p");
    hint.style.cssText = "color:var(--text-faint);font-size:12px;margin-top:12px;";
    hint.textContent = "Showing last 10 of " + data.length + " entries";
  }
}
\`\`\`
${DATAVIEW_FOOTER}`;
}

export interface LibraryTemplateOptions {
  filePath: string;
  csvPath: string;
  titleKey: string;
  categoryCol: string;
  statusCol: string;
  /** Empty string when the file has no author/director-like column. */
  authorKey: string;
  yearCol: string;
  ratingCol: string;
  themeCol: string;
  /** 2-col grid for short titles (books/movies); 1-col for long ones (quotes). */
  compactGrid: boolean;
}

export function generateLibraryMobileDashboard(opts: LibraryTemplateOptions): string {
  const { filePath, csvPath, titleKey, categoryCol, statusCol, authorKey, yearCol, ratingCol, themeCol, compactGrid } = opts;

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
  const titleKey = "${titleKey}";
  const categoryCol = "${categoryCol}";
  const statusCol = "${statusCol}";
  const authorKey = "${authorKey}";
  const yearCol = "${yearCol}";
  const ratingCol = "${ratingCol}";
  const themeCol = "${themeCol}";
  const compactGrid = ${compactGrid};

  // View state
  const viewKey = "csv-mobile-view-" + dv.current().file.path;
  const modeKey = "csv-mobile-mode-" + dv.current().file.path;
  let viewMode = localStorage.getItem(modeKey) || "kanban";

  // Inject styles
  const style = container.createEl("style");
  style.textContent = \`
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
  \`;

  // View toggle
  const toggleWrap = container.createEl("div", { cls: "csv-m-toggle" });
  ["Kanban", "Table"].forEach(mode => {
    const btn = toggleWrap.createEl("button", { text: mode });
    if (mode.toLowerCase() === viewMode) btn.classList.add("active");
    btn.onclick = () => { localStorage.setItem(modeKey, mode.toLowerCase()); location.reload(); };
  });

  if (viewMode === "table") {
    // Table view
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

    // Negative/default states render as nothing — keeps cards quiet by default.
    const NEGATIVE_STATUS = new Set(["", "no", "not started", "unwatched", "unread", "todo"]);
    // Affirmative-finished values render as a green dot prefix on the title (matches desktop Library).
    const WATCHED_AFFIRMATIVE = new Set(["yes", "watched", "seen", "finished", "read"]);

    Object.keys(groups).sort().forEach(cat => {
      const items = groups[cat];
      const section = container.createEl("details", { cls: "csv-m-section" });
      section.open = true;
      const summary = section.createEl("summary");
      summary.innerHTML = '<span class="arrow">▶</span> ' + cat + ' <span class="count">' + items.length + '</span>';

      const grid = section.createEl("div", { cls: "csv-m-grid" + (compactGrid ? " compact" : "") });

      // Sort: green-dotted (read/watched/finished) first, then in-progress,
      // then the rest. Mirrors desktop Library: section reads as catalogue
      // (consumed → backlog), not a todo list.
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
        if (!title) return; // skip rows with no title — keeps the kanban free of "Untitled" cards
        const status = String(r[statusCol] || "").trim();
        const statusLc = status.toLowerCase();
        const affirmative = WATCHED_AFFIRMATIVE.has(statusLc);

        const card = grid.createEl("div", { cls: "csv-m-card" });
        const titleEl = card.createEl("div", { cls: "csv-m-card-title" });
        if (affirmative) {
          titleEl.createEl("span", { cls: "csv-m-watched-dot", attr: { title: status } });
        }
        titleEl.createEl("span", { text: title });

        // Year (small muted, just under title)
        const year = yearCol ? String(r[yearCol] ?? "").trim() : "";
        if (year) {
          card.createEl("div", { cls: "csv-m-card-year", text: year });
        }

        // Author/Director — only in non-compact mode (movies skip director to save vertical room).
        if (!compactGrid && authorKey && r[authorKey]) {
          card.createEl("div", { cls: "csv-m-card-meta", text: String(r[authorKey]) });
        }

        // Rating (data is already rendered as unicode stars — render as-is, hide "unrated").
        const rating = ratingCol ? String(r[ratingCol] ?? "").trim() : "";
        if (rating && rating.toLowerCase() !== "unrated") {
          card.createEl("div", { cls: "csv-m-card-rating", text: rating });
        }

        // Theme — small inline pill at the bottom. Multi-value (comma-separated) renders just the first.
        const theme = themeCol ? String(r[themeCol] ?? "").split(",")[0].trim() : "";
        if (theme) {
          card.createEl("span", { cls: "csv-m-card-theme", text: theme });
        }

        // Status pill only for non-trivial states (e.g. "In progress").
        // Affirmative values became the dot above; negative values render nothing.
        if (status && !NEGATIVE_STATUS.has(statusLc) && !affirmative) {
          const statusEl = card.createEl("span", { cls: "csv-m-card-status", text: status });
          statusEl.classList.add(statusLc.replace(/\\s+/g, "-"));
        }
      });
    });
  }
}
\`\`\`
${DATAVIEW_FOOTER}`;
}

export interface GenericTemplateOptions {
  filePath: string;
  csvPath: string;
  /** Header row from the file, written verbatim into the table. */
  headers: string[];
}

export function generateGenericMobileDashboard(opts: GenericTemplateOptions): string {
  const { filePath, csvPath, headers } = opts;

  return `${FRONTMATTER}## Add Entry

\`\`\`csv-add
file: ${filePath}
\`\`\`

## Entries

\`\`\`csv-refresh
\`\`\`

\`\`\`dataviewjs
// Generic mobile dashboard — expandable, scrollable table.
// Used for files without a category column (e.g. dictionary).
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

  // Recent / All toggle — expandable by tapping "All"
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
${DATAVIEW_FOOTER}`;
}
