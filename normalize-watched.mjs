/**
 * One-shot script: normalize Yes/No values in movies.xlsx Watched column to
 * Watched/Unwatched. Same semantics, more readable as a subgroup label in the
 * By Genre kanban (and matches the WATCHED_AFFIRMATIVE set the mobile dashboard
 * already uses).
 *
 * Backs up the original to movies.before-watched-normalize.xlsx.
 *
 * Run: node normalize-watched.mjs
 */

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const VAULT = "/Users/simon/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain";
const TEST_DIR = path.join(VAULT, "Knowledge/Test");
const HELPERS_DIR = path.join(TEST_DIR, "_csv_helpers");

const REPLACE = {
  "yes": "Watched",
  "no":  "Unwatched",
};

function normalizeXlsx(xlsxPath, columnName) {
  if (!fs.existsSync(xlsxPath)) { console.log(`· skip ${path.basename(xlsxPath)}: not found`); return; }
  const wb = XLSX.readFile(xlsxPath, { cellDates: false, raw: true });
  let changed = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    // Find the column index for the target column by scanning row 0 headers.
    let colIdx = -1;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const headerCell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (headerCell && String(headerCell.v).toLowerCase() === columnName.toLowerCase()) {
        colIdx = c; break;
      }
    }
    if (colIdx === -1) continue;

    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: colIdx });
      const cell = ws[ref];
      if (!cell || cell.t !== "s") continue;
      const next = REPLACE[String(cell.v).trim().toLowerCase()];
      if (next && next !== cell.v) {
        cell.v = next;
        if (cell.w) cell.w = next;
        changed++;
      }
    }
  }

  if (changed === 0) {
    console.log(`✓ ${path.basename(xlsxPath)}: already normalized (0 changes)`);
    return;
  }

  const backup = xlsxPath.replace(/\.xlsx$/, ".before-watched-normalize.xlsx");
  fs.copyFileSync(xlsxPath, backup);
  XLSX.writeFile(wb, xlsxPath);
  console.log(`✓ ${path.basename(xlsxPath)}: ${changed} ${columnName} cells normalized (backup: ${path.basename(backup)})`);
}

function normalizeCsv(csvPath, columnName) {
  if (!fs.existsSync(csvPath)) { console.log(`· skip ${path.basename(csvPath)}: not found`); return; }
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/);
  if (!lines.length) return;
  const headers = lines[0].split(",");
  const idx = headers.findIndex(h => h.trim().toLowerCase() === columnName.toLowerCase());
  if (idx === -1) { console.log(`· skip ${path.basename(csvPath)}: no "${columnName}" column`); return; }

  let changed = 0;
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) { out.push(lines[i]); continue; }
    // Naive split — fine because Watched values are bare Yes/No, never quoted.
    const fields = lines[i].split(",");
    const v = (fields[idx] ?? "").trim().toLowerCase();
    if (REPLACE[v]) {
      fields[idx] = REPLACE[v];
      changed++;
    }
    out.push(fields.join(","));
  }
  if (changed === 0) {
    console.log(`✓ ${path.basename(csvPath)}: already normalized`);
  } else {
    fs.writeFileSync(csvPath, out.join("\n"));
    console.log(`✓ ${path.basename(csvPath)}: ${changed} rows normalized`);
  }
}

console.log("Normalizing movies.xlsx Watched column: Yes→Watched, No→Unwatched...\n");
normalizeXlsx(path.join(TEST_DIR, "movies.xlsx"), "Watched");
console.log("\nNormalizing helper CSV...");
normalizeCsv(path.join(HELPERS_DIR, "movies.csv"), "Watched");
