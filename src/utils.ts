import { CSVRow } from "./types";

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g,"").replace(/\s+/g," ").trim().slice(0,100);
}

export function titleCase(str: string): string {
  return str.split(/[\s_-]+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
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
  container: HTMLElement
): void {
  container.querySelectorAll(".csv-select-picker").forEach(el => el.remove());
  const picker = container.createDiv({ cls: "csv-select-picker" });
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
