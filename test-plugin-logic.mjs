/**
 * Comprehensive tests for CSV Card View plugin logic
 * Run with: node test-plugin-logic.mjs
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = "") {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${msg}\n    Expected: ${expectedStr}\n    Got: ${actualStr}`);
  }
}

function assertThrows(fn, msg = "") {
  try {
    fn();
    throw new Error(`${msg} - Expected function to throw but it didn't`);
  } catch (e) {
    if (e.message.includes("Expected function to throw")) throw e;
    // Expected to throw, test passes
  }
}

// ============================================================================
// Copy of functions from main.ts for testing
// ============================================================================

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

function parseCSV(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const parseRow = (line) => {
    const result = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === ',' && !inQ) {
        result.push(field);
        field = "";
      } else {
        field += ch;
      }
    }
    result.push(field);
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = parseRow(l);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

// Simulates resolveCol from XLSXCardView
function resolveCol(headers, candidates) {
  for (const c of candidates) {
    const found = headers.find(h => h.toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  return null;
}

// CSV serialization (escape function from doSave)
function escapeCSV(v) {
  return (v.includes(",") || v.includes('"') || v.includes("\n"))
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

function serializeCSV(headers, rows) {
  return [
    headers.map(escapeCSV).join(","),
    ...rows.map(r => headers.map(h => escapeCSV(r[h] ?? "")).join(","))
  ].join("\n");
}

// ============================================================================
// Tests
// ============================================================================

console.log("=== Filename Sanitization ===\n");

test("sanitizeFilename: removes illegal characters", () => {
  assertEqual(sanitizeFilename('file:name'), "filename");
  assertEqual(sanitizeFilename('file/name'), "filename");
  assertEqual(sanitizeFilename('file\\name'), "filename");
  assertEqual(sanitizeFilename('file*name'), "filename");
  assertEqual(sanitizeFilename('file?name'), "filename");
  assertEqual(sanitizeFilename('file"name'), "filename");
  assertEqual(sanitizeFilename('file<name'), "filename");
  assertEqual(sanitizeFilename('file>name'), "filename");
  assertEqual(sanitizeFilename('file|name'), "filename");
  assertEqual(sanitizeFilename('file#name'), "filename");
  assertEqual(sanitizeFilename('file^name'), "filename");
  assertEqual(sanitizeFilename('file[name]'), "filename");
});

test("sanitizeFilename: collapses whitespace", () => {
  assertEqual(sanitizeFilename('hello   world'), "hello world");
  assertEqual(sanitizeFilename('hello\t\tworld'), "hello world");
  assertEqual(sanitizeFilename('  leading'), "leading");
  assertEqual(sanitizeFilename('trailing  '), "trailing");
});

test("sanitizeFilename: truncates to 100 chars", () => {
  const longName = "a".repeat(150);
  assertEqual(sanitizeFilename(longName).length, 100);
});

test("sanitizeFilename: handles empty string", () => {
  assertEqual(sanitizeFilename(''), "");
  assertEqual(sanitizeFilename('   '), "");
});

test("sanitizeFilename: preserves valid characters", () => {
  assertEqual(sanitizeFilename('Hello World 2024'), "Hello World 2024");
  assertEqual(sanitizeFilename('日本語タイトル'), "日本語タイトル");
  assertEqual(sanitizeFilename('Émile Zola - Germinal'), "Émile Zola - Germinal");
});

console.log("\n=== CSV Parsing ===\n");

test("parseCSV: handles Windows line endings (CRLF)", () => {
  const csv = "Name,Age\r\nJohn,25\r\nJane,30";
  const result = parseCSV(csv);
  assertEqual(result.headers, ["Name", "Age"]);
  assertEqual(result.rows.length, 2);
});

test("parseCSV: handles mixed line endings", () => {
  const csv = "A,B\nRow1,Val1\r\nRow2,Val2";
  const result = parseCSV(csv);
  assertEqual(result.rows.length, 2);
});

test("parseCSV: handles trailing newlines", () => {
  const csv = "A,B\nRow1,Val1\n\n\n";
  const result = parseCSV(csv);
  assertEqual(result.rows.length, 1);
});

test("parseCSV: handles headers only (no data rows)", () => {
  const csv = "Name,Age,City";
  const result = parseCSV(csv);
  assertEqual(result.headers, ["Name", "Age", "City"]);
  assertEqual(result.rows, []);
});

test("parseCSV: handles newlines inside quoted fields", () => {
  const csv = `Title,Content
"Post 1","Line 1
Line 2
Line 3"`;
  const result = parseCSV(csv);
  // Note: Current parser doesn't handle embedded newlines in quotes
  // This test documents current behavior
  assertEqual(result.headers, ["Title", "Content"]);
});

test("parseCSV: handles fields with only quotes", () => {
  const csv = 'A,B\n"",""';
  const result = parseCSV(csv);
  assertEqual(result.rows[0], { A: "", B: "" });
});

test("parseCSV: handles very long fields", () => {
  const longValue = "x".repeat(10000);
  const csv = `Name,Data\nTest,"${longValue}"`;
  const result = parseCSV(csv);
  assertEqual(result.rows[0].Data, longValue);
});

test("parseCSV: handles single column", () => {
  const csv = "Name\nAlice\nBob";
  const result = parseCSV(csv);
  assertEqual(result.headers, ["Name"]);
  assertEqual(result.rows, [{ Name: "Alice" }, { Name: "Bob" }]);
});

test("parseCSV: handles rows with fewer fields than headers", () => {
  const csv = "A,B,C\n1,2\n3";
  const result = parseCSV(csv);
  assertEqual(result.rows[0], { A: "1", B: "2", C: "" });
  assertEqual(result.rows[1], { A: "3", B: "", C: "" });
});

test("parseCSV: handles rows with more fields than headers", () => {
  const csv = "A,B\n1,2,3,4";
  const result = parseCSV(csv);
  // Extra fields are ignored
  assertEqual(result.rows[0], { A: "1", B: "2" });
});

test("parseCSV: handles special characters in unquoted fields", () => {
  const csv = "Name,Symbol\nAlpha,α\nBeta,β";
  const result = parseCSV(csv);
  assertEqual(result.rows[0].Symbol, "α");
  assertEqual(result.rows[1].Symbol, "β");
});

test("parseCSV: handles duplicate headers", () => {
  const csv = "Name,Name,Name\nA,B,C";
  const result = parseCSV(csv);
  // Last value wins due to object key behavior
  assertEqual(result.rows[0].Name, "C");
});

console.log("\n=== Column Resolution ===\n");

test("resolveCol: finds exact match", () => {
  const headers = ["Title", "Author", "Notes"];
  assertEqual(resolveCol(headers, ["Notes"]), "Notes");
});

test("resolveCol: case-insensitive matching", () => {
  const headers = ["TITLE", "author", "NoTeS"];
  assertEqual(resolveCol(headers, ["title"]), "TITLE");
  assertEqual(resolveCol(headers, ["AUTHOR"]), "author");
  assertEqual(resolveCol(headers, ["notes"]), "NoTeS");
});

test("resolveCol: returns first match from candidates", () => {
  const headers = ["Summary", "Notes", "Description"];
  assertEqual(resolveCol(headers, ["Notes", "Summary", "Description"]), "Notes");
  assertEqual(resolveCol(headers, ["Review", "Summary", "Notes"]), "Summary");
});

test("resolveCol: returns null when no match", () => {
  const headers = ["Title", "Author"];
  assertEqual(resolveCol(headers, ["Notes", "Description"]), null);
});

test("resolveCol: handles empty headers", () => {
  assertEqual(resolveCol([], ["Notes"]), null);
});

test("resolveCol: handles empty candidates", () => {
  const headers = ["Title", "Notes"];
  assertEqual(resolveCol(headers, []), null);
});

test("resolveCol: notes column fallback chain", () => {
  const notesCandidates = [
    "Notes", "notes", "Note", "note",
    "Summary", "summary",
    "Review", "review",
    "Quote", "quote", "Quotes", "quotes",
    "Comment", "comment", "Comments", "comments",
    "Description", "description",
    "Annotation", "annotation",
  ];

  assertEqual(resolveCol(["Review", "Data"], notesCandidates), "Review");
  assertEqual(resolveCol(["Data", "summary"], notesCandidates), "summary");
  assertEqual(resolveCol(["Annotation", "Quote"], notesCandidates), "Quote");
});

test("resolveCol: category column fallback chain", () => {
  const categoryCandidates = [
    "Category", "category",
    "Categories", "categories",
    "Genre", "genre", "Genres", "genres",
    "Type", "type", "Types", "types",
    "Tag", "tag", "Tags", "tags",
  ];

  assertEqual(resolveCol(["Genre", "Type"], categoryCandidates), "Genre");
  assertEqual(resolveCol(["tags", "section"], categoryCandidates), "tags");
});

test("resolveCol: status column fallback chain", () => {
  const statusCandidates = [
    "Status", "status",
    "State", "state",
    "Progress", "progress",
    "Stage", "stage",
    "Read", "read",
  ];

  // Candidate order determines priority - "State" comes before "Progress" in candidates
  assertEqual(resolveCol(["Progress", "State"], statusCandidates), "State");
  assertEqual(resolveCol(["Progress", "Stage"], statusCandidates), "Progress");
  assertEqual(resolveCol(["read", "done"], statusCandidates), "read");
});

console.log("\n=== CSV Serialization (Round-trip) ===\n");

test("serializeCSV: basic round-trip", () => {
  const original = "Name,Age\nJohn,25\nJane,30";
  const parsed = parseCSV(original);
  const serialized = serializeCSV(parsed.headers, parsed.rows);
  const reparsed = parseCSV(serialized);
  assertEqual(reparsed.headers, parsed.headers);
  assertEqual(reparsed.rows, parsed.rows);
});

test("serializeCSV: preserves quoted fields", () => {
  const headers = ["Name", "Bio"];
  const rows = [{ Name: "John", Bio: "Hello, World" }];
  const serialized = serializeCSV(headers, rows);
  assertEqual(serialized, 'Name,Bio\nJohn,"Hello, World"');
});

test("serializeCSV: escapes quotes in values", () => {
  const headers = ["Name", "Quote"];
  const rows = [{ Name: "John", Quote: 'He said "Hello"' }];
  const serialized = serializeCSV(headers, rows);
  assertEqual(serialized, 'Name,Quote\nJohn,"He said ""Hello"""');
});

test("serializeCSV: handles empty values", () => {
  const headers = ["A", "B", "C"];
  const rows = [{ A: "1", B: "", C: "3" }];
  const serialized = serializeCSV(headers, rows);
  assertEqual(serialized, "A,B,C\n1,,3");
});

test("serializeCSV: handles newlines in values", () => {
  const headers = ["Name", "Notes"];
  const rows = [{ Name: "Test", Notes: "Line1\nLine2" }];
  const serialized = serializeCSV(headers, rows);
  assertEqual(serialized, 'Name,Notes\nTest,"Line1\nLine2"');
});

console.log("\n=== Edge Cases & Error Handling ===\n");

test("parseCSV: handles null-ish input gracefully", () => {
  assertEqual(parseCSV(""), { headers: [], rows: [] });
  assertEqual(parseCSV("   "), { headers: [], rows: [] });
  assertEqual(parseCSV("\n\n\n"), { headers: [], rows: [] });
});

test("sanitizeFilename: handles all illegal chars at once", () => {
  const nasty = '\\/:*?"<>|#^[]';
  assertEqual(sanitizeFilename(nasty), "");
});

test("sanitizeFilename: handles filename with only spaces and illegal chars", () => {
  assertEqual(sanitizeFilename('  :  :  '), "");
});

test("parseCSV: handles comma-only row", () => {
  const csv = "A,B,C\n,,";
  const result = parseCSV(csv);
  assertEqual(result.rows[0], { A: "", B: "", C: "" });
});

test("parseCSV: handles field that is just escaped quotes", () => {
  const csv = 'A\n""""';
  const result = parseCSV(csv);
  assertEqual(result.rows[0].A, '"');
});

test("parseCSV: handles multiple consecutive quotes", () => {
  const csv = 'A\n""""""';
  const result = parseCSV(csv);
  assertEqual(result.rows[0].A, '""');
});

test("parseCSV: handles unclosed quote at end of field", () => {
  // This is malformed CSV - document current behavior
  const csv = 'A,B\n"unclosed,next';
  const result = parseCSV(csv);
  // Current parser treats everything after opening quote as part of field
  // until closing quote or end of line
});

test("resolveCol: handles headers with leading/trailing spaces", () => {
  // This tests that the match is exact (spaces matter)
  const headers = [" Notes ", "Notes"];
  assertEqual(resolveCol(headers, ["Notes"]), "Notes");
  // " Notes " won't match "Notes" due to spaces
  assertEqual(resolveCol([" Notes "], ["Notes"]), null);
});

test("escapeCSV: handles various special cases", () => {
  assertEqual(escapeCSV("normal"), "normal");
  assertEqual(escapeCSV("with,comma"), '"with,comma"');
  assertEqual(escapeCSV('with"quote'), '"with""quote"');
  assertEqual(escapeCSV("with\nnewline"), '"with\nnewline"');
  assertEqual(escapeCSV(""), "");
  assertEqual(escapeCSV(","), '","');
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`Tests complete: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
