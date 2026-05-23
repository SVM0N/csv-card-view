/**
 * One-shot script: normalize rating-column star glyphs across all xlsx files
 * to ★ (U+2605, BLACK STAR — single BMP code point, parser-safe).
 *
 * Replaces:
 *   ⭐️ (U+2B50 + U+FE0F)  → ★
 *   ⭐  (U+2B50)            → ★
 *   ☆  (U+2606, WHITE STAR) → ★  (only if part of a star string)
 *
 * Backs up the original to <basename>.before-star-normalize.xlsx in the same
 * folder. Reports per-file how many cells changed.
 *
 * Run: node normalize-stars.mjs
 */

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const VAULT = "/Users/simon/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain";
const TEST_DIR = path.join(VAULT, "Knowledge/Test");
const HELPERS_DIR = path.join(TEST_DIR, "_csv_helpers");

// Glyphs we treat as "filled star" candidates.
const STAR_VARIANTS = /[⭐️]+/gu;   // ⭐ + optional VS-16 → drop both
const TARGET = "★";                      // ★

function normalize(value) {
  if (typeof value !== "string") return value;
  if (!/[⭐]/.test(value)) return value; // nothing to do
  // Each ⭐ (with or without VS) becomes one ★. The VS alone is also stripped.
  return value
    .replace(/⭐️?/gu, TARGET)
    .replace(/️/g, ""); // any leftover stray VS-16
}

function processFile(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    console.log(`· skip ${path.basename(xlsxPath)}: not found`);
    return;
  }
  const wb = XLSX.readFile(xlsxPath, { cellDates: false, raw: true });
  let changed = 0;
  let touchedCells = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    for (const ref of Object.keys(ws)) {
      if (ref.startsWith("!")) continue;
      const cell = ws[ref];
      if (cell.t !== "s") continue; // only string cells
      const normalized = normalize(cell.v);
      if (normalized !== cell.v) {
        touchedCells.push(`${ref}: "${cell.v}" → "${normalized}"`);
        cell.v = normalized;
        if (cell.w) cell.w = normalized; // formatted text mirror
        changed++;
      }
    }
  }

  if (changed === 0) {
    console.log(`✓ ${path.basename(xlsxPath)}: already normalized (0 changes)`);
    return;
  }

  // Backup before overwrite
  const backup = xlsxPath.replace(/\.xlsx$/, ".before-star-normalize.xlsx");
  fs.copyFileSync(xlsxPath, backup);

  XLSX.writeFile(wb, xlsxPath);
  console.log(`✓ ${path.basename(xlsxPath)}: ${changed} cells normalized (backup: ${path.basename(backup)})`);
  if (touchedCells.length <= 5) {
    touchedCells.forEach(c => console.log(`    ${c}`));
  } else {
    console.log(`    e.g. ${touchedCells[0]}`);
    console.log(`    ... (${touchedCells.length - 1} more)`);
  }
}

const XLSX_FILES = [
  path.join(TEST_DIR, "books.xlsx"),
  path.join(TEST_DIR, "movies.xlsx"),
  path.join(TEST_DIR, "quotes.xlsx"),
];

console.log("Normalizing star glyphs to ★ (U+2605)...\n");
for (const f of XLSX_FILES) processFile(f);

// Also normalize the helper CSV mirrors so Dataview sees the change immediately
// (without waiting for the plugin to rewrite them on next save).
console.log("\nNormalizing helper CSVs...\n");
for (const name of ["books.csv", "movies.csv", "quotes.csv"]) {
  const p = path.join(HELPERS_DIR, name);
  if (!fs.existsSync(p)) { console.log(`· skip ${name}: not found`); continue; }
  const raw = fs.readFileSync(p, "utf8");
  const next = normalize(raw);
  if (raw === next) {
    console.log(`✓ ${name}: already normalized`);
  } else {
    fs.writeFileSync(p, next);
    const before = (raw.match(/⭐/g) || []).length;
    console.log(`✓ ${name}: ${before} ⭐ → ★`);
  }
}
