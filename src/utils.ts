import { CSVRow } from "./types";

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g,"").replace(/\s+/g," ").trim().slice(0,100);
}

/**
 * Resolve a path the user typed in a `csv-add file:` block against the folder
 * of the note that contains the block. Three forms accepted:
 *
 *   "books.xlsx"                      → sibling of current note
 *   "./books.xlsx"                    → same as sibling
 *   "../books.xlsx" / "../../foo.csv" → walked up from current folder
 *   "Knowledge/Test/books.xlsx"       → vault-relative (any other path with "/"
 *                                        and no leading "./" or "../" is treated
 *                                        as vault-relative for back-compat with
 *                                        existing dashboards)
 *
 * Returns the resolved vault-relative path. Walking past the vault root clamps
 * at the root rather than throwing — Obsidian's lookup will fail with a clear
 * "File not found" message in that case.
 */
export function resolvePath(input: string, baseFolder: string): string {
  if (!input) return input;
  const isRelative = input.startsWith("./") || input.startsWith("../") || input === "." || input === "..";
  // Vault-relative form: any path with "/" that isn't dot-relative.
  if (!isRelative && input.includes("/")) return input;
  // Sibling form: no "/" at all, no leading "./" or "../" → just join with baseFolder.
  if (!isRelative) return baseFolder ? `${baseFolder}/${input}` : input;
  // Dot-relative: walk the segments.
  const stack = baseFolder ? baseFolder.split("/").filter(Boolean) : [];
  for (const seg of input.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { stack.pop(); continue; }
    stack.push(seg);
  }
  return stack.join("/");
}

export function titleCase(str: string): string {
  return str.split(/[\s_-]+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

/**
 * Display-ready rating string for a card. Returns "" if the value should not
 * be shown (empty, "unrated", or unmappable). Three input shapes handled:
 *   - already-star glyphs: "★★★★☆" / "⭐️⭐️⭐️"     → returned as-is
 *   - numeric 1–5:          "4" / "5"                   → "★★★★" / "★★★★★"
 *   - text labels:          "excellent" / "good" / etc. → mapped via formatRating
 */
export function formatRatingForDisplay(raw: string, columnName: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (lower === "unrated" || v === "—" || v === "-") return "";
  if (/[★⭐☆]/.test(v)) return v; // already glyph-based, render as-is
  if (/^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 5) return "★".repeat(n);
  }
  const mapped = formatRating(v, columnName);
  return mapped && mapped !== v && mapped !== "—" ? mapped : "";
}

export function formatRating(value: string, columnName: string): string {
  const col = columnName.toLowerCase();
  if (!["rating", "score", "score /5"].includes(col)) return value;

  const val = value.toLowerCase().trim();
  const ratingMap: Record<string, string> = {
    "excellent": "★★★★★",
    "great": "★★★★★",
    "good": "★★★★☆",
    "fair": "★★★☆☆",
    "poor": "★★☆☆☆",
    "bad": "★☆☆☆☆",
    "5": "★★★★★",
    "4": "★★★★☆",
    "3": "★★★☆☆",
    "2": "★★☆☆☆",
    "1": "★☆☆☆☆",
    "0": "☆☆☆☆☆",
    "unrated": "—",
    "": "—",
  };
  return ratingMap[val] ?? value;
}

export function showSelectPicker(
  anchor: HTMLElement,
  currentValue: string,
  allValues: string[],
  onSelect: (val: string) => void,
  _container: HTMLElement
): void {
  // Always append to document.body so `position: fixed` is anchored to the
  // viewport. If we nested inside the caller's container, any ancestor with
  // `transform`, `filter`, or `backdrop-filter` (Obsidian's modal has these)
  // would become the containing block for `position: fixed`, and the
  // viewport-relative coords from getBoundingClientRect() would get applied
  // as offsets from that ancestor — making the dropdown appear far to the
  // right of the chip that opened it. `_container` is kept in the signature
  // for backward compatibility.
  document.body.querySelectorAll(".csv-select-picker").forEach(el => el.remove());
  const picker = document.body.createDiv({ cls: "csv-select-picker" });
  const anchorRect = anchor.getBoundingClientRect();
  picker.style.position = "fixed";
  picker.style.left = anchorRect.left + "px";
  picker.style.top = (anchorRect.bottom + 4) + "px";
  picker.style.zIndex = "9999";

  const search = picker.createEl("input", { cls: "csv-picker-search", type: "text", placeholder: "Search or add…" });
  search.focus();
  const listEl = picker.createDiv({ cls: "csv-picker-list" });
  const unique = Array.from(new Set(allValues.filter(Boolean)));

  const renderList = (filter: string) => {
    listEl.empty();
    const filtered = filter ? unique.filter(v => v.toLowerCase().includes(filter.toLowerCase())) : unique;
    if (currentValue) {
      const clearItem = listEl.createDiv({ cls: "csv-picker-item csv-picker-clear" });
      clearItem.setText("✕ Clear");
      clearItem.addEventListener("mousedown", e => { e.preventDefault(); onSelect(""); picker.remove(); });
    }
    filtered.forEach(val => {
      const item = listEl.createDiv({ cls: `csv-picker-item ${val === currentValue ? "active" : ""}` });
      item.setText(val);
      item.addEventListener("mousedown", e => { e.preventDefault(); onSelect(val); picker.remove(); });
    });
    if (filter && !unique.some(v => v.toLowerCase() === filter.toLowerCase())) {
      const addItem = listEl.createDiv({ cls: "csv-picker-item csv-picker-add" });
      addItem.setText(`+ Add "${filter}"`);
      addItem.addEventListener("mousedown", e => { e.preventDefault(); onSelect(filter); picker.remove(); });
    }
    if (!filtered.length && !filter) {
      listEl.createDiv({ cls: "csv-picker-empty", text: "No options yet. Type to add." });
    }
  };

  renderList("");
  search.addEventListener("input", () => renderList(search.value));

  const close = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node) && e.target !== anchor) {
      picker.remove(); document.removeEventListener("mousedown", close);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
  search.addEventListener("keydown", e => {
    if (e.key === "Escape") { picker.remove(); document.removeEventListener("mousedown", close); }
    if (e.key === "Enter") {
      const val = search.value.trim();
      if (val) { onSelect(val); picker.remove(); document.removeEventListener("mousedown", close); }
    }
  });
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

export function parseCSV(text: string): { headers: string[]; rows: CSVRow[] } {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || (char === '\r' && text[i + 1] === '\n')) && !inQuotes) {
      lines.push(current);
      current = "";
      if (char === '\r') i++;
    } else if (char === '\r' && !inQuotes) {
      lines.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) lines.push(current);

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { field += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        fields.push(field);
        field = "";
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  };

  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = parseRow(nonEmpty[0]);
  const rows: CSVRow[] = nonEmpty.slice(1).map(line => {
    const vals = parseRow(line);
    const row: CSVRow = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

export function escapeCSV(val: string): string {
  if (!val) return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}
