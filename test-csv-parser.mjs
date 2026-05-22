/**
 * Simple test for CSV parsing logic
 * Run with: node test-csv-parser.mjs
 */

// Copy of parseCSV from main.ts for isolated testing
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

// Test cases
const tests = [
  {
    name: "Simple CSV",
    input: `Name,Age,City
John,25,NYC
Jane,30,LA`,
    expected: {
      headers: ["Name", "Age", "City"],
      rows: [
        { Name: "John", Age: "25", City: "NYC" },
        { Name: "Jane", Age: "30", City: "LA" }
      ]
    }
  },
  {
    name: "Quoted fields with commas",
    input: `Title,Description
"Hello, World","A simple greeting"
Test,"No quotes needed"`,
    expected: {
      headers: ["Title", "Description"],
      rows: [
        { Title: "Hello, World", Description: "A simple greeting" },
        { Title: "Test", Description: "No quotes needed" }
      ]
    }
  },
  {
    name: "Escaped quotes",
    input: `Name,Quote
John,"He said ""Hello"""
Jane,"She replied ""Hi""!"`,
    expected: {
      headers: ["Name", "Quote"],
      rows: [
        { Name: "John", Quote: 'He said "Hello"' },
        { Name: "Jane", Quote: 'She replied "Hi"!' }
      ]
    }
  },
  {
    name: "Empty fields",
    input: `A,B,C
1,,3
,2,
,,`,
    expected: {
      headers: ["A", "B", "C"],
      rows: [
        { A: "1", B: "", C: "3" },
        { A: "", B: "2", C: "" },
        { A: "", B: "", C: "" }
      ]
    }
  },
  {
    name: "Unicode content",
    input: `Name,Emoji,Japanese
Test,🎉,こんにちは
Book,📚,日本語`,
    expected: {
      headers: ["Name", "Emoji", "Japanese"],
      rows: [
        { Name: "Test", Emoji: "🎉", Japanese: "こんにちは" },
        { Name: "Book", Emoji: "📚", Japanese: "日本語" }
      ]
    }
  },
  {
    name: "Empty CSV",
    input: "",
    expected: { headers: [], rows: [] }
  }
];

let passed = 0;
let failed = 0;

console.log("Running CSV parser tests...\n");

for (const test of tests) {
  const result = parseCSV(test.input);
  const resultStr = JSON.stringify(result);
  const expectedStr = JSON.stringify(test.expected);

  if (resultStr === expectedStr) {
    console.log(`✓ ${test.name}`);
    passed++;
  } else {
    console.log(`✗ ${test.name}`);
    console.log(`  Expected: ${expectedStr}`);
    console.log(`  Got:      ${resultStr}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
