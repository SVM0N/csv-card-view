#!/usr/bin/env node
// Round-trip validator: prove the XLSX → CSV migration would be lossless
// before touching any code.
//
// For each live xlsx file in the vault:
//   1. Parse with SheetJS the same way the plugin does
//      (`sheet_to_json(ws, { header: 1, defval: "" })`, all strings).
//   2. Papa.unparse(rows, { columns: headers }) → CSV text.
//   3. Papa.parse(csvText, { header: true, skipEmptyLines: false, dynamicTyping: false }).
//   4. Cell-by-cell compare. Any mismatch is a hard fail with the byte diff
//      (hex codes) so it's obvious whether it's CRLF vs LF, smart-quote
//      autocorrect, BOM, or something else.
//
// Also cross-checks the existing _csv_helpers/<file>.csv mirror against the
// xlsx as a side-validation (the plugin writes those on every save — if they
// drift from the xlsx, that's a separate bug worth knowing about).
//
// Run with:
//   node xlsx-to-csv-roundtrip.mjs
// Exit 0 = lossless, exit 1 = at least one mismatch.

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import Papa from "papaparse";

const VAULT = "/Users/simon/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain";
const LIB = "Knowledge/Library";
const HELPERS = `${LIB}/_csv_helpers`;

const FILES = ["books", "movies", "quotes", "dictionary", "habit_tracker"];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mirror of XLSXCardView.onLoadFile for xlsx — strings only, empty=""  */
function readXlsx(absPath) {
  const buf = fs.readFileSync(absPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!raw.length) return { headers: [], rows: [] };
  const headers = raw[0].map(String);
  const rows = raw.slice(1).map(r => {
    const row = {};
    headers.forEach((h, i) => { row[h] = String(r[i] ?? ""); });
    return row;
  });
  return { headers, rows };
}

/** Mirror of plugin's CSV read path (Papa, header mode, no dynamic typing). */
function readCsv(absPath) {
  const text = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  return { headers: parsed.meta.fields ?? [], rows: parsed.data };
}

function unparseCsv(headers, rows) {
  return Papa.unparse(rows, { columns: headers });
}

function hex(s) {
  return [...s].map(c => c.codePointAt(0).toString(16).padStart(4, "0")).join(" ");
}

/** Compare two parsed datasets cell-by-cell. Returns array of mismatch records. */
function diff(label, a, b) {
  const mismatches = [];
  const headersA = a.headers;
  const headersB = b.headers;

  if (headersA.length !== headersB.length || headersA.some((h, i) => h !== headersB[i])) {
    mismatches.push({
      kind: "header-mismatch",
      detail: `expected [${headersA.join(", ")}] got [${headersB.join(", ")}]`,
    });
  }

  const n = Math.max(a.rows.length, b.rows.length);
  if (a.rows.length !== b.rows.length) {
    mismatches.push({
      kind: "row-count-mismatch",
      detail: `expected ${a.rows.length} rows, got ${b.rows.length}`,
    });
  }

  for (let i = 0; i < n; i++) {
    const ra = a.rows[i] ?? {};
    const rb = b.rows[i] ?? {};
    for (const h of headersA) {
      // Empty/missing should not count as a mismatch — Papa parse vs xlsx
      // sometimes disagree on trailing-empty rows; we normalize both to "".
      const va = (ra[h] ?? "").toString();
      const vb = (rb[h] ?? "").toString();
      if (va !== vb) {
        mismatches.push({
          kind: "cell-mismatch",
          row: i + 1, // 1-indexed for human-readability (skipping header row)
          col: h,
          expected: va,
          got: vb,
          expectedHex: hex(va.slice(0, 60)),
          gotHex: hex(vb.slice(0, 60)),
        });
      }
    }
  }
  return mismatches;
}

function printMismatches(label, mismatches) {
  console.log(`\n  ✗ ${label} (${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"})`);
  // Cap at 5 per check so the output stays readable; full counts above tell the story.
  mismatches.slice(0, 5).forEach(m => {
    if (m.kind === "cell-mismatch") {
      const trim = (s) => s.length > 80 ? s.slice(0, 80) + "…" : s;
      console.log(`    · row ${m.row}, col "${m.col}":`);
      console.log(`        expected: ${JSON.stringify(trim(m.expected))}`);
      console.log(`        got:      ${JSON.stringify(trim(m.got))}`);
      if (m.expected.length < 60 && m.got.length < 60) {
        console.log(`        expected hex: ${m.expectedHex}`);
        console.log(`        got hex:      ${m.gotHex}`);
      }
    } else {
      console.log(`    · ${m.kind}: ${m.detail}`);
    }
  });
  if (mismatches.length > 5) {
    console.log(`    · …and ${mismatches.length - 5} more`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

let totalFail = 0;
let totalChecks = 0;

console.log("─────────────────────────────────────────────────────────────────");
console.log("  XLSX ↔ CSV round-trip validator");
console.log("─────────────────────────────────────────────────────────────────");

for (const name of FILES) {
  const xlsxPath = path.join(VAULT, LIB, `${name}.xlsx`);
  const helperPath = path.join(VAULT, HELPERS, `${name}.csv`);

  if (!fs.existsSync(xlsxPath)) {
    console.log(`\n· skip ${name}: xlsx not found at ${xlsxPath}`);
    continue;
  }

  console.log(`\n── ${name} ─────────────────────────────────`);
  const source = readXlsx(xlsxPath);
  console.log(`  source xlsx: ${source.headers.length} cols × ${source.rows.length} rows`);

  // Check A: lossless round-trip XLSX → unparse → parse
  totalChecks++;
  const csvText = unparseCsv(source.headers, source.rows);
  const reparsed = (() => {
    const text = csvText.replace(/^﻿/, "");
    const p = Papa.parse(text, { header: true, skipEmptyLines: false, dynamicTyping: false });
    return { headers: p.meta.fields ?? [], rows: p.data };
  })();
  const roundtripMismatches = diff("roundtrip", source, reparsed);
  if (roundtripMismatches.length === 0) {
    console.log(`  ✓ Check A: XLSX → unparse → parse is byte-identical`);
  } else {
    totalFail++;
    printMismatches(`Check A: XLSX → unparse → parse`, roundtripMismatches);
  }

  // Check B: existing helper CSV matches XLSX (catches helper-drift)
  if (fs.existsSync(helperPath)) {
    totalChecks++;
    const helper = readCsv(helperPath);
    const helperMismatches = diff("helper", source, helper);
    if (helperMismatches.length === 0) {
      console.log(`  ✓ Check B: existing _csv_helpers/${name}.csv matches xlsx`);
    } else {
      totalFail++;
      printMismatches(`Check B: _csv_helpers/${name}.csv vs xlsx`, helperMismatches);
    }
  } else {
    console.log(`  · Check B skipped: no helper at ${helperPath}`);
  }
}

console.log("\n─────────────────────────────────────────────────────────────────");
if (totalFail === 0) {
  console.log(`  ✓ All ${totalChecks} checks passed — migration is lossless`);
  process.exit(0);
} else {
  console.log(`  ✗ ${totalFail} of ${totalChecks} checks failed`);
  process.exit(1);
}
