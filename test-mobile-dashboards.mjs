/**
 * Mobile dashboard simulator
 *
 * Loads each "<file> - Mobile.md" in the Obsidian vault, extracts the
 * dataviewjs block, and runs it against a stubbed Dataview runtime backed
 * by the real CSV files. Walks the resulting virtual DOM and asserts:
 *
 *   - script does not throw
 *   - every card title is non-empty (no "Untitled" everywhere)
 *   - movies cards never show a literal "No" status pill
 *   - watched movies render the green-dot indicator
 *
 * The CSV parser mirrors Dataview's behaviour: header row + dynamicTyping,
 * so a value like "1984" comes back as the Number 1984 — which is what
 * triggers the real `localeCompare is not a function` error.
 *
 * Run: node test-mobile-dashboards.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const VAULT = "/Users/simon/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain";
const DASHBOARDS = [
  "Knowledge/Test/Mobile/movies.md",
  "Knowledge/Test/Mobile/quotes.md",
  "Knowledge/Test/Mobile/books.md",
  "Knowledge/Test/Mobile/dictionary.md",
  "Knowledge/Test/Mobile/habit_tracker.md",
];

// ---------------------------------------------------------------------------
// Virtual DOM
// ---------------------------------------------------------------------------

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    classes: new Set(),
    text: "",
    innerHTML: "",
    style: { cssText: "" },
    open: false,
    onclick: null,
  };
  el.classList = {
    add: (...cs) => cs.forEach(c => c && el.classes.add(c)),
    remove: (...cs) => cs.forEach(c => el.classes.delete(c)),
    contains: c => el.classes.has(c),
  };
  el.createEl = (childTag, opts = {}) => {
    const child = makeEl(childTag);
    if (opts.text != null) child.text = String(opts.text);
    if (opts.cls) {
      String(opts.cls).split(/\s+/).filter(Boolean).forEach(c => child.classes.add(c));
    }
    if (opts.attr) Object.assign(child, opts.attr);
    el.children.push(child);
    return child;
  };
  // textContent is a setter the script uses for <style>
  Object.defineProperty(el, "textContent", {
    get() { return el.text; },
    set(v) { el.text = String(v); },
  });
  return el;
}

function walk(el, fn) {
  fn(el);
  el.children.forEach(c => walk(c, fn));
}

function collect(el, predicate) {
  const out = [];
  walk(el, e => { if (predicate(e)) out.push(e); });
  return out;
}

// Recursive text content (mirrors DOM textContent), used so that a card-title
// whose text lives in a child <span> still reads as that text.
function textContent(el) {
  let out = el.text || "";
  for (const c of el.children) out += textContent(c);
  return out;
}

// ---------------------------------------------------------------------------
// Dataview stub
// ---------------------------------------------------------------------------

function makeDv(dashboardPath) {
  const container = makeEl("div");
  const dv = {
    container,
    io: {
      async csv(p) {
        const full = path.join(VAULT, p);
        const raw = fs.readFileSync(full, "utf8");
        // Dataview uses Papa Parse with header + dynamicTyping; matches the
        // production behaviour that coerces "1984" to a Number.
        const result = Papa.parse(raw, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
        });
        const rows = result.data;
        // dv.io.csv returns a DataArray; .array() unwraps it.
        return {
          length: rows.length,
          array: () => rows,
        };
      },
    },
    current() {
      return { file: { path: dashboardPath } };
    },
    paragraph(text) {
      container.createEl("p", { text });
    },
  };
  return { dv, container };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const BLOCK_RE = /```dataviewjs\n([\s\S]*?)\n```/;

async function runDashboard(relPath) {
  const full = path.join(VAULT, relPath);
  if (!fs.existsSync(full)) {
    return { skipped: true, reason: "file not found (iCloud sync in flight?)" };
  }
  const md = fs.readFileSync(full, "utf8");
  const m = md.match(BLOCK_RE);
  if (!m) return { skipped: true, reason: "no dataviewjs block" };

  const { dv, container } = makeDv(relPath);
  const localStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
  };
  const location = { reload() {} };

  // Wrap in async IIFE so top-level await inside the block works.
  const body = `return (async () => {\n${m[1]}\n})();`;
  const fn = new Function("dv", "localStorage", "location", "console", body);

  let error = null;
  try {
    await fn(dv, localStorage, location, console);
  } catch (e) {
    error = e;
  }
  return { error, container };
}

// ---------------------------------------------------------------------------
// Assertions per dashboard
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`);
    failed++;
    failures.push(name);
  }
}

async function assertDashboard(relPath, expectations) {
  console.log(`\n— ${relPath}`);
  const { error, container, skipped, reason } = await runDashboard(relPath);
  if (skipped) {
    console.log(`  · skipped (${reason})`);
    return;
  }

  check("script does not throw", !error,
    error ? `${error.constructor.name}: ${error.message}` : "");
  if (error) return; // downstream checks meaningless

  const titles = collect(container, e => e.classes.has("csv-m-card-title"));
  const statuses = collect(container, e => e.classes.has("csv-m-card-status"));
  const metas = collect(container, e => e.classes.has("csv-m-card-meta"));
  const cards = collect(container, e => e.classes.has("csv-m-card"));

  check(`renders ≥1 card`, cards.length > 0, `got ${cards.length}`);

  if (expectations.minTitles != null) {
    check(`renders ≥${expectations.minTitles} titles`,
      titles.length >= expectations.minTitles,
      `got ${titles.length}`);
  }

  if (expectations.noUntitled) {
    const untitledCount = titles.filter(t => {
      const txt = textContent(t).trim();
      return txt === "" || txt === "Untitled";
    }).length;
    check("no Untitled placeholders",
      untitledCount === 0,
      `got ${untitledCount} of ${titles.length}`);
  }

  if (expectations.noNegativePills) {
    const bad = statuses.filter(s =>
      /^(no|not started|unwatched)$/i.test(s.text.trim()));
    check("no negative status pills",
      bad.length === 0,
      bad.length ? `${bad.length} bad pills, e.g. "${bad[0].text}"` : "");
  }

  if (expectations.watchedIndicator) {
    const watched = collect(container, e => e.classes.has("csv-m-watched-dot"));
    check(`renders ≥1 watched-dot indicator`,
      watched.length >= 1,
      `got ${watched.length}`);
  }

  if (expectations.compactGrid) {
    const grids = collect(container, e => e.classes.has("csv-m-grid"));
    const compact = grids.filter(g => g.classes.has("compact"));
    check(`grid uses 2-col compact layout`,
      compact.length > 0 && compact.length === grids.length,
      `${compact.length}/${grids.length} grids are compact`);
  }

  if (expectations.minYears != null) {
    const years = collect(container, e => e.classes.has("csv-m-card-year"));
    check(`renders ≥${expectations.minYears} year labels`,
      years.length >= expectations.minYears,
      `got ${years.length}`);
  }

  if (expectations.minRatings != null) {
    const ratings = collect(container, e => e.classes.has("csv-m-card-rating"));
    check(`renders ≥${expectations.minRatings} rating labels`,
      ratings.length >= expectations.minRatings,
      `got ${ratings.length}`);
  }

  if (expectations.minThemes != null) {
    const themes = collect(container, e => e.classes.has("csv-m-card-theme"));
    check(`renders ≥${expectations.minThemes} theme pills`,
      themes.length >= expectations.minThemes,
      `got ${themes.length}`);
  }
}

async function assertGenericDashboard(relPath, expectations) {
  console.log(`\n— ${relPath}`);
  const { error, container, skipped, reason } = await runDashboard(relPath);
  if (skipped) { console.log(`  · skipped (${reason})`); return; }

  check("script does not throw", !error,
    error ? `${error.constructor.name}: ${error.message}` : "");
  if (error) return;

  const wraps = collect(container, e => e.classes.has("csv-m-tablewrap"));
  check("renders one scrollable table wrap", wraps.length === 1, `got ${wraps.length}`);

  const rows = collect(container, e => e.tag === "tr");
  // First row is the header; data rows are the rest.
  const dataRows = rows.length > 0 ? rows.length - 1 : 0;
  if (expectations.minRows != null) {
    check(`renders ≥${expectations.minRows} data rows`,
      dataRows >= expectations.minRows,
      `got ${dataRows}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Mobile dashboard simulator\n==========================");

await assertDashboard("Knowledge/Test/Mobile/books.md", {
  minTitles: 5,
  noUntitled: true,
});

await assertDashboard("Knowledge/Test/Mobile/quotes.md", {
  minTitles: 5,
  noUntitled: true,
});

await assertDashboard("Knowledge/Test/Mobile/movies.md", {
  minTitles: 5,
  noUntitled: true,
  noNegativePills: true,
  watchedIndicator: true,
  compactGrid: true,
  minYears: 5,    // most rows have Year populated
  minRatings: 1,  // some rows have unicode stars
  minThemes: 5,   // most rows have Theme populated
});

// Generic dashboard (dictionary) — expandable scrollable table, no kanban cards.
await assertGenericDashboard("Knowledge/Test/Mobile/dictionary.md", {
  minRows: 5,
});

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\nFailures:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
