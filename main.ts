import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  FileView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Component,
  Menu,
  Modal,
  Notice,
  TFile,
  normalizePath,
} from "obsidian";
import * as XLSX from "xlsx";
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip } from "chart.js";

// Register Chart.js components
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

// ─── Types ────────────────────────────────────────────────────────────────────

interface CSVRow { [key: string]: string; }
type ViewMode = "kanban-genre" | "table" | "dashboard";

// Per-file overrides, keyed by vault file path
interface FileConfig {
  categoryColumn?: string;
  notesColumn?: string;
  statusColumn?: string;
  defaultMode?: ViewMode;
}

interface CardViewSettings {
  defaultMode: ViewMode;
  notesColumns: string[];
  statusColumn: string;
  categoryColumn: string;
  notesSubfolder: string;
  columnWidths: { [header: string]: number };
  selectColumns: string[];
  fileConfigs: { [filePath: string]: FileConfig };
}

const DEFAULT_SETTINGS: CardViewSettings = {
  defaultMode: "kanban-genre",
  notesColumns: ["notes","note","Notes","Note","description","Description","review","Review"],
  statusColumn: "status",
  categoryColumn: "category",
  notesSubfolder: "Notes",
  columnWidths: {},
  selectColumns: ["Category","Type","Rating","Status","rating","type","category","status","Score /5"],
  fileConfigs: {},
};

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g,"").replace(/\s+/g," ").trim().slice(0,100);
}

// ─── Select Picker ────────────────────────────────────────────────────────────

function showSelectPicker(
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

// ─── Add Entry Modal ──────────────────────────────────────────────────────────

class AddEntryModal extends Modal {
  headers: string[];
  isNotesCol: (h: string) => boolean;
  isSelectCol: (h: string) => boolean;
  getColumnValues: (h: string) => string[];
  onSubmit: (row: CSVRow) => void;

  constructor(
    app: App,
    headers: string[],
    isNotesCol: (h: string) => boolean,
    isSelectCol: (h: string) => boolean,
    getColumnValues: (h: string) => string[],
    onSubmit: (row: CSVRow) => void
  ) {
    super(app);
    this.headers = headers;
    this.isNotesCol = isNotesCol;
    this.isSelectCol = isSelectCol;
    this.getColumnValues = getColumnValues;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("csv-add-modal");

    contentEl.createEl("h2", { text: "Add new entry", cls: "csv-modal-title" });

    const form = contentEl.createDiv({ cls: "csv-modal-form" });
    const values: CSVRow = {};
    this.headers.forEach(h => values[h] = "");

    this.headers.forEach(h => {
      const row = form.createDiv({ cls: "csv-modal-row" });
      row.createEl("label", { text: h, cls: "csv-modal-label" });

      if (this.isNotesCol(h)) {
        const ta = row.createEl("textarea", { cls: "csv-modal-textarea", placeholder: "Markdown supported…" });
        ta.addEventListener("input", () => { values[h] = ta.value; });

      } else if (this.isSelectCol(h)) {
        // Render as a chip that opens the picker, scoped to the modal
        const chipWrap = row.createDiv({ cls: "csv-modal-select-wrap" });
        const chip = chipWrap.createDiv({ cls: "csv-select-chip empty" });
        chip.setText("— click to select —");
        chip.addEventListener("click", e => {
          e.stopPropagation();
          showSelectPicker(chip, values[h], this.getColumnValues(h), (newVal) => {
            values[h] = newVal;
            chip.setText(newVal || "— click to select —");
            chip.toggleClass("empty", !newVal);
          }, contentEl);
        });

      } else {
        const input = row.createEl("input", { cls: "csv-modal-input", type: "text", placeholder: h });
        input.addEventListener("input", () => { values[h] = input.value; });
        // Submit on Enter for non-textarea fields
        input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
      }
    });

    const btnRow = contentEl.createDiv({ cls: "csv-modal-btns" });

    const cancelBtn = btnRow.createEl("button", { text: "Cancel", cls: "csv-modal-cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = btnRow.createEl("button", { text: "Add entry", cls: "csv-modal-submit" });
    submitBtn.addEventListener("click", () => submit());

    const submit = () => {
      // Require at least one field filled
      const hasAny = Object.values(values).some(v => v.trim());
      if (!hasAny) { new Notice("Fill in at least one field."); return; }
      this.onSubmit(values);
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─── Note Expander Modal ──────────────────────────────────────────────────────

class NoteExpanderModal extends Modal {
  private row: CSVRow;
  private notesCol: string;
  private headers: string[];
  private filePath: string;
  private renderComponent: Component;
  private isNotesCol: (h: string) => boolean;
  private isSelectCol: (h: string) => boolean;
  private getColumnValues: (h: string) => string[];
  private onSave: (row: CSVRow) => void;

  constructor(
    app: App,
    row: CSVRow,
    notesCol: string,
    headers: string[],
    filePath: string,
    isNotesCol: (h: string) => boolean,
    isSelectCol: (h: string) => boolean,
    getColumnValues: (h: string) => string[],
    onSave: (row: CSVRow) => void
  ) {
    super(app);
    // Work on a shallow copy so cancel doesn't mutate
    this.row = { ...row };
    this.notesCol = notesCol;
    this.headers = headers;
    this.filePath = filePath;
    this.renderComponent = new Component();
    this.isNotesCol = isNotesCol;
    this.isSelectCol = isSelectCol;
    this.getColumnValues = getColumnValues;
    this.onSave = onSave;
    this.modalEl.addClass("csv-note-expander-modal");
  }

  onOpen(): void {
    this.renderComponent.load();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("csv-note-expander");

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv({ cls: "csv-expander-header" });
    header.createDiv({ cls: "csv-expander-title", text: this.row[this.headers.find(h => ["title","name","Title","Name"].includes(h)) ?? this.headers[0]] ?? "—" });
    const headerBtns = header.createDiv({ cls: "csv-expander-header-btns" });

    // ── Fields section (non-notes columns) ──────────────────────────────────
    const fieldsEl = contentEl.createDiv({ cls: "csv-expander-fields" });
    const titleKey = this.headers.find(h => ["title","name","Title","Name"].includes(h));
    const authorKey = this.headers.find(h => ["author","Author","director","Director","artist","Artist","creator","Creator"].includes(h));

    this.headers.forEach(h => {
      if (this.isNotesCol(h)) return; // notes rendered separately below
      const fieldRow = fieldsEl.createDiv({ cls: "csv-expander-field-row" });
      fieldRow.createDiv({ cls: "csv-expander-field-label", text: h });

      if (this.isSelectCol(h)) {
        const chip = fieldRow.createDiv({ cls: `csv-select-chip ${this.row[h] ? "" : "empty"}` });
        chip.setText(this.row[h] || "—");
        chip.addEventListener("click", e => {
          e.stopPropagation();
          showSelectPicker(chip, this.row[h], this.getColumnValues(h), (newVal) => {
            this.row[h] = newVal;
            chip.setText(newVal || "—");
            chip.toggleClass("empty", !newVal);
          }, contentEl);
        });
      } else {
        const val = fieldRow.createDiv({ cls: "csv-expander-field-value", text: this.row[h] || "—" });
        val.addEventListener("click", () => {
          val.empty();
          const input = val.createEl("input", { cls: "csv-inline-input", value: this.row[h] ?? "", type: "text" });
          input.focus(); input.select();
          const commit = () => { this.row[h] = input.value; val.empty(); val.setText(input.value || "—"); };
          input.addEventListener("blur", commit);
          input.addEventListener("keydown", e => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { val.empty(); val.setText(this.row[h] || "—"); } });
        });
      }
    });

    // ── Notes section ────────────────────────────────────────────────────────
    const notesDivider = contentEl.createDiv({ cls: "csv-expander-divider" });
    notesDivider.createDiv({ cls: "csv-expander-notes-label", text: this.notesCol });
    const editBtn = notesDivider.createEl("button", { cls: "csv-expander-edit-btn", text: "✏️ Edit" });

    let isEditing = false;
    let currentText = this.row[this.notesCol] ?? "";

    const rendered = contentEl.createDiv({ cls: "csv-expander-rendered markdown-rendered" });
    const editorWrap = contentEl.createDiv({ cls: "csv-expander-editor" });
    editorWrap.style.display = "none";

    const renderMarkdown = () => {
      rendered.empty();
      if (currentText.trim()) {
        MarkdownRenderer.render(this.app, currentText, rendered, this.filePath, this.renderComponent);
      } else {
        rendered.createDiv({ cls: "csv-notes-empty", text: "No notes yet. Click ✏️ Edit to add." });
      }
    };
    renderMarkdown();

    const ta = editorWrap.createEl("textarea", { cls: "csv-expander-textarea" });
    ta.value = currentText;
    ta.addEventListener("input", () => { currentText = ta.value; });

    editBtn.addEventListener("click", () => {
      isEditing = !isEditing;
      if (isEditing) {
        rendered.style.display = "none";
        editorWrap.style.display = "flex";
        ta.value = currentText;
        ta.focus();
        editBtn.setText("👁 Preview");
      } else {
        editorWrap.style.display = "none";
        rendered.style.display = "";
        currentText = ta.value;
        renderMarkdown();
        editBtn.setText("✏️ Edit");
      }
    });

    // ── Footer buttons ───────────────────────────────────────────────────────
    const footer = contentEl.createDiv({ cls: "csv-expander-footer" });
    footer.createEl("button", { cls: "csv-modal-cancel", text: "Cancel" })
      .addEventListener("click", () => this.close()); // close without saving

    footer.createEl("button", { cls: "csv-expander-save-btn", text: "Save & close" })
      .addEventListener("click", () => {
        if (isEditing) currentText = ta.value;
        this.row[this.notesCol] = currentText;
        this.onSave(this.row);
        this.close();
      });
  }

  onClose(): void {
    this.renderComponent.unload();
    this.contentEl.empty();
  }
}

// ─── File Config Modal ────────────────────────────────────────────────────────
// Per-file column mapping — which column is the kanban group, notes, status

class FileConfigModal extends Modal {
  headers: string[];
  filePath: string;
  current: FileConfig;
  onSave: (cfg: FileConfig) => void;

  constructor(app: App, headers: string[], filePath: string, current: FileConfig, onSave: (cfg: FileConfig) => void) {
    super(app);
    this.headers = headers;
    this.filePath = filePath;
    this.current = { ...current };
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("csv-add-modal");
    contentEl.createEl("h2", { text: "View settings for this file", cls: "csv-modal-title" });
    contentEl.createEl("p", { text: "These settings apply only to this file and override the global defaults.", cls: "csv-modal-desc" });

    const form = contentEl.createDiv({ cls: "csv-modal-form" });
    const none = "— use global default —";
    const opts = [none, ...this.headers];

    const makeDropdown = (label: string, currentVal: string | undefined, onChange: (v: string | undefined) => void) => {
      const row = form.createDiv({ cls: "csv-modal-row" });
      row.createEl("label", { text: label, cls: "csv-modal-label" });
      const sel = row.createEl("select", { cls: "csv-modal-select" });
      opts.forEach(o => {
        const opt = sel.createEl("option", { text: o, value: o });
        if ((currentVal ?? none) === o) opt.selected = true;
      });
      sel.addEventListener("change", () => onChange(sel.value === none ? undefined : sel.value));
    };

    makeDropdown("Category column (kanban grouping)", this.current.categoryColumn, v => { this.current.categoryColumn = v; });
    makeDropdown("Status column (row subgroups)", this.current.statusColumn, v => { this.current.statusColumn = v; });
    makeDropdown("Notes column", this.current.notesColumn, v => { this.current.notesColumn = v; });

    // Default mode for this file
    const modeRow = form.createDiv({ cls: "csv-modal-row" });
    modeRow.createEl("label", { text: "Default view", cls: "csv-modal-label" });
    const modeSel = modeRow.createEl("select", { cls: "csv-modal-select" });
    ([["— use global default —",""], ["Dashboard","dashboard"], ["By Genre","kanban-genre"], ["Table","table"]] as [string,string][]).forEach(([label, val]) => {
      const opt = modeSel.createEl("option", { text: label, value: val });
      if ((this.current.defaultMode ?? "") === val) opt.selected = true;
    });
    modeSel.addEventListener("change", () => { this.current.defaultMode = modeSel.value ? modeSel.value as ViewMode : undefined; });

    const btnRow = contentEl.createDiv({ cls: "csv-modal-btns" });
    btnRow.createEl("button", { text: "Cancel", cls: "csv-modal-cancel" }).addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: "Save", cls: "csv-modal-submit" }).addEventListener("click", () => {
      this.onSave(this.current);
      this.close();
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

// ─── View ────────────────────────────────────────────────────────────────────

export const CARD_VIEW_TYPE = "xlsx-card-view";

export class XLSXCardView extends FileView {
  settings: CardViewSettings;
  headers: string[] = [];
  rows: CSVRow[] = [];
  mode: ViewMode;
  private renderComponent: Component;
  private isXlsx = false;
  private saveTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, settings: CardViewSettings) {
    super(leaf);
    this.settings = settings;
    this.mode = settings.defaultMode;
    this.renderComponent = new Component();
    this.renderComponent.load();
  }

  getViewType() { return CARD_VIEW_TYPE; }
  getDisplayText() { return this.file?.basename ?? "Card View"; }
  getIcon() { return "table"; }

  // ── File I/O ───────────────────────────────────────────────────────────────

  async onLoadFile(file: TFile): Promise<void> {
    this.isXlsx = file.extension === "xlsx";
    try {
      if (this.isXlsx) {
        const buf = await this.app.vault.readBinary(file);
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
        if (!raw.length) { this.headers = []; this.rows = []; }
        else {
          this.headers = (raw[0] as string[]).map(String);
          this.rows = raw.slice(1).map(r => {
            const row: CSVRow = {};
            this.headers.forEach((h, i) => { row[h] = String((r as string[])[i] ?? ""); });
            return row;
          });
        }
      } else {
        const text = await this.app.vault.read(file);
        const parsed = this.parseCSV(text);
        this.headers = parsed.headers;
        this.rows = parsed.rows;
      }
    } catch (e) { console.error("CardView load error", e); this.headers = []; this.rows = []; }
    // Apply per-file default mode if set, or auto-detect based on columns
    if (this.file && this.settings.fileConfigs[this.file.path]?.defaultMode) {
      this.mode = this.settings.fileConfigs[this.file.path].defaultMode!;
    } else if (this.hasDateColumn()) {
      // Auto-default to dashboard if date column detected
      this.mode = "dashboard";
    } else {
      this.mode = this.settings.defaultMode;
    }
    this.selectedDate = null; // Reset selected date when loading new file
    this.renderView();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    if (this.chartInstance) { this.chartInstance.destroy(); this.chartInstance = null; }
    this.headers = []; this.rows = []; this.contentEl.empty();
  }

  private scheduleSave(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.doSave(), 600);
  }

  private async doSave(): Promise<void> {
    if (!this.file) return;
    try {
      if (this.isXlsx) {
        const wb = XLSX.utils.book_new();
        const data = [this.headers, ...this.rows.map(r => this.headers.map(h => r[h] ?? ""))];
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        await this.app.vault.modifyBinary(this.file, buf);
      } else {
        const esc = (v: string) => (v.includes(",") || v.includes('"') || v.includes("\n")) ? `"${v.replace(/"/g,'""')}"` : v;
        const csv = [this.headers.map(esc).join(","), ...this.rows.map(r => this.headers.map(h => esc(r[h]??"")).join(","))].join("\n");
        await this.app.vault.modify(this.file, csv);
      }
    } catch (e) { console.error("CardView save error", e); }
  }

  // ── CSV ────────────────────────────────────────────────────────────────────

  private parseCSV(raw: string): { headers: string[]; rows: CSVRow[] } {
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { headers: [], rows: [] };
    const parseRow = (line: string): string[] => {
      const result: string[] = []; let field = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (inQ && line[i+1]==='"') { field+='"'; i++; } else inQ=!inQ; }
        else if (ch===',' && !inQ) { result.push(field); field=""; }
        else field+=ch;
      }
      result.push(field); return result;
    };
    const headers = parseRow(lines[0]);
    const rows = lines.slice(1).map(l => {
      const vals = parseRow(l); const row: CSVRow = {};
      headers.forEach((h,i) => { row[h] = vals[i]??""; }); return row;
    });
    return { headers, rows };
  }

  // ── Per-file config ────────────────────────────────────────────────────────

  private get fileCfg(): FileConfig {
    return this.file ? (this.settings.fileConfigs[this.file.path] ?? {}) : {};
  }

  private saveFileCfg(cfg: FileConfig): void {
    if (!this.file) return;
    this.settings.fileConfigs[this.file.path] = cfg;
    // Persist via plugin — we get a reference to the plugin through the app
    (this.app as any).plugins.plugins["csv-card-view"]?.saveSettings();
  }

  // ── Field helpers ──────────────────────────────────────────────────────────

  // ── Field helpers with fallback chains ────────────────────────────────────

  // Tries each candidate in order, returns first match found in headers
  private resolveCol(candidates: string[]): string | null {
    for (const c of candidates) {
      const found = this.headers.find(h => h.toLowerCase() === c.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  private getNotesCol(): string | null {
    // 1. Per-file override
    if (this.fileCfg.notesColumn) return this.fileCfg.notesColumn;
    // 2. Fallback chain
    return this.resolveCol([
      "Notes","notes","Note","note",
      "Summary","summary",
      "Review","review",
      "Quote","quote","Quotes","quotes",
      "Comment","comment","Comments","comments",
      "Description","description",
      "Annotation","annotation",
    ]);
  }

  private isNotesCol(h: string): boolean {
    const notesCol = this.getNotesCol();
    // If we resolved a specific column, only that one qualifies
    if (notesCol) return h === notesCol;
    // Otherwise fall back to global list (shouldn't normally reach here)
    return this.settings.notesColumns.some(n => n.toLowerCase() === h.toLowerCase());
  }

  private isSelectCol(h: string) { return this.settings.selectColumns.some(s => s.toLowerCase()===h.toLowerCase()); }

  private getStatusCol(): string | null {
    if (this.fileCfg.statusColumn) {
      return this.headers.find(h => h.toLowerCase() === this.fileCfg.statusColumn!.toLowerCase()) ?? null;
    }
    return this.resolveCol([
      "Status","status",
      "State","state",
      "Progress","progress",
      "Stage","stage",
      "Read","read",
    ]);
  }

  private getCategoryCol(): string | null {
    if (this.fileCfg.categoryColumn) {
      return this.headers.find(h => h.toLowerCase() === this.fileCfg.categoryColumn!.toLowerCase()) ?? null;
    }
    return this.resolveCol([
      "Category","category",
      "Categories","categories",
      "Genre","genre","Genres","genres",
      "Type","type","Types","types",
      "Tag","tag","Tags","tags",
      "Topic","topic","Topics","topics",
      "Subject","subject",
      "Section","section",
    ]);
  }

  private titleKey(): string | undefined {
    return this.resolveCol(["Title","title","Name","name"]) ?? undefined;
  }

  private authorKey(): string | undefined {
    return this.resolveCol([
      "Author","author","Authors","authors",
      "Director","director",
      "Artist","artist",
      "Creator","creator",
      "By","by",
    ]) ?? undefined;
  }
  private getTitle(row: CSVRow) { const k=this.titleKey(); return (k?row[k]:row[this.headers[0]])??"—"; }
  private getSubtitle(row: CSVRow) { const k=this.authorKey(); return k?row[k]??"":""; }
  private getColumnValues(h: string) { return Array.from(new Set(this.rows.map(r=>r[h]??"").filter(Boolean))).sort(); }

  // ── Notes file ─────────────────────────────────────────────────────────────

  private notesFilePath(row: CSVRow): string {
    const title = sanitizeFilename(this.getTitle(row));
    const csvFolder = this.file?.parent?.path??"";
    const sub = this.settings.notesSubfolder.trim();
    const folder = sub?(csvFolder?`${csvFolder}/${sub}`:sub):csvFolder;
    return normalizePath(`${folder}/${title}.md`);
  }

  private notesFileExists(row: CSVRow) { return !!this.app.vault.getAbstractFileByPath(this.notesFilePath(row)); }

  private async openOrCreateNotes(row: CSVRow): Promise<void> {
    const path = this.notesFilePath(row);
    let file = this.app.vault.getAbstractFileByPath(path) as TFile|null;
    if (!file) {
      const fm = ["---",...this.headers.filter(h=>!this.isNotesCol(h)&&row[h]).map(h=>`${h}: "${row[h].replace(/"/g,'\\"')}"`),"---","",`# ${this.getTitle(row)}`,"",""].join("\n");
      const notesCol = this.headers.find(h=>this.isNotesCol(h));
      const content = fm+(notesCol&&row[notesCol]?.trim()?row[notesCol]:"");
      const folderPath = path.substring(0,path.lastIndexOf("/"));
      if (folderPath&&!this.app.vault.getAbstractFileByPath(folderPath)) await this.app.vault.createFolder(folderPath);
      file = await this.app.vault.create(path,content);
      new Notice(`Created: ${file.name}`);
    }
    await this.app.workspace.getLeaf("tab").openFile(file as TFile);
  }

  private openNoteExpander(row: CSVRow, notesCol: string): void {
    new NoteExpanderModal(
      this.app,
      row,
      notesCol,
      this.headers,
      this.file?.path ?? "",
      this.isNotesCol.bind(this),
      this.isSelectCol.bind(this),
      this.getColumnValues.bind(this),
      (updatedRow) => {
        // Apply all field changes back to the original row
        Object.assign(row, updatedRow);
        this.scheduleSave();
        this.renderView();
      }
    ).open();
  }

  private openAddModal(): void {
    new AddEntryModal(
      this.app,
      this.headers,
      this.isNotesCol.bind(this),
      this.isSelectCol.bind(this),
      this.getColumnValues.bind(this),
      (row) => {
        this.rows.push(row);
        this.scheduleSave();
        this.renderView();
        new Notice(`Added: ${this.getTitle(row)}`);
      }
    ).open();
  }

  // ── Select field ───────────────────────────────────────────────────────────

  private renderSelectField(container: HTMLElement, row: CSVRow, h: string): HTMLElement {
    const val = row[h] ?? "";
    const chip = container.createDiv({ cls: `csv-select-chip ${val ? "" : "empty"}` });
    chip.setText(val || "—");
    if (h.toLowerCase() === "status" && val) chip.addClass(`status-chip-${val.toLowerCase().replace(/\s+/g,"-")}`);
    chip.addEventListener("click", e => {
      e.stopPropagation();
      showSelectPicker(chip, val, this.getColumnValues(h), (newVal) => {
        row[h] = newVal;
        chip.setText(newVal || "—");
        chip.className = `csv-select-chip ${newVal ? "" : "empty"}`;
        if (h.toLowerCase() === "status" && newVal) chip.addClass(`status-chip-${newVal.toLowerCase().replace(/\s+/g,"-")}`);
        this.scheduleSave();
      }, this.contentEl);
    });
    return chip;
  }

  // ── Render root ────────────────────────────────────────────────────────────

  private renderView(): void {
    const root = this.contentEl;
    root.empty(); root.addClass("csv-card-view-root");
    this.renderComponent.unload();
    this.renderComponent = new Component(); this.renderComponent.load();
    this.renderToolbar(root);
    const content = root.createDiv({ cls: "csv-content-area" });
    if (!this.headers.length) { content.createEl("p",{text:"Empty or unreadable file.",cls:"csv-empty-state"}); return; }
    if (this.mode === "dashboard") this.renderDashboard(content);
    else if (this.mode === "kanban-genre") this.renderKanbanGenre(content);
    else this.renderTable(content);
  }

  private renderToolbar(root: HTMLElement): void {
    const bar = root.createDiv({cls:"csv-toolbar"});
    bar.createDiv({cls:"csv-toolbar-title", text: this.file?.basename??""});
    const ctrl = bar.createDiv({cls:"csv-toolbar-controls"});
    ctrl.createDiv({cls:"csv-row-count", text:`${this.rows.length} entries`});
    const mg = ctrl.createDiv({cls:"csv-mode-group"});

    // Build view mode buttons based on detected columns
    const modes: {id: ViewMode, label: string}[] = [];
    if (this.hasDateColumn()) modes.push({id: "dashboard", label: "Dashboard"});
    if (this.getCategoryCol()) modes.push({id: "kanban-genre", label: "By Genre"});
    modes.push({id: "table", label: "Table"});

    modes.forEach(({id, label}) => {
      const btn = mg.createEl("button",{cls:`csv-mode-btn ${this.mode===id?"active":""}`, text:label});
      btn.addEventListener("click",()=>{ this.mode=id; this.renderView(); });
    });

    // Per-file column config
    const cfgBtn = ctrl.createEl("button", { cls: "csv-cfg-btn", text: "⚙ Columns", title: "Configure columns for this file" });
    cfgBtn.addEventListener("click", () => {
      new FileConfigModal(this.app, this.headers, this.file?.path ?? "", this.fileCfg, (cfg) => {
        this.saveFileCfg(cfg);
        if (cfg.defaultMode) this.mode = cfg.defaultMode;
        this.renderView();
      }).open();
    });

    ctrl.createEl("button",{cls:"csv-add-btn",text:"+ Add"}).addEventListener("click",()=>this.openAddModal());
  }

  // ── Date detection ──────────────────────────────────────────────────────────

  private hasDateColumn(): boolean {
    const dateCol = this.getDateCol();
    return dateCol !== null;
  }

  private getDateCol(): string | null {
    // Check first column - if it looks like dates, use it
    if (this.headers.length === 0) return null;
    const firstCol = this.headers[0];
    const firstColLower = firstCol.toLowerCase();

    // Check by column name
    if (["date", "day", "datum"].includes(firstColLower)) return firstCol;

    // Check if first few values look like dates (YYYY-MM-DD or similar)
    const sampleRows = this.rows.slice(0, 5);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const looksLikeDates = sampleRows.length > 0 &&
      sampleRows.every(r => datePattern.test(r[firstCol] ?? ""));

    if (looksLikeDates) return firstCol;
    return null;
  }

  private getBooleanColumns(): string[] {
    // Detect columns that look like boolean/habit columns (values are 0/1, true/false, yes/no, or empty)
    const boolPatterns = ["0", "1", "true", "false", "yes", "no", ""];
    return this.headers.filter(h => {
      if (h === this.getDateCol() || this.isNotesCol(h)) return false;
      const values = this.rows.map(r => (r[h] ?? "").toLowerCase().trim());
      return values.every(v => boolPatterns.includes(v));
    });
  }

  private parseDate(dateStr: string): Date | null {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private isTruthy(val: string): boolean {
    const v = (val ?? "").toLowerCase().trim();
    return v === "1" || v === "true" || v === "yes";
  }

  // ── Dashboard view ──────────────────────────────────────────────────────────

  private selectedDate: string | null = null;
  private chartInstance: Chart | null = null;

  private renderDashboard(container: HTMLElement): void {
    const dateCol = this.getDateCol();
    if (!dateCol) {
      container.createEl("p", { text: "No date column detected.", cls: "csv-empty-state" });
      return;
    }

    const habitCols = this.getBooleanColumns();
    const notesCol = this.getNotesCol();
    const today = this.formatDate(new Date());

    // Sort rows by date
    const sortedRows = [...this.rows].sort((a, b) => {
      return (a[dateCol] ?? "").localeCompare(b[dateCol] ?? "");
    });

    // Find or initialize selected date
    if (!this.selectedDate) this.selectedDate = today;
    let currentRow = sortedRows.find(r => r[dateCol] === this.selectedDate);
    const isToday = this.selectedDate === today;

    container.addClass("csv-dashboard");

    // ── Date Navigator ────────────────────────────────────────────────────────
    const nav = container.createDiv({ cls: "csv-dash-nav" });

    const prevBtn = nav.createEl("button", { cls: "csv-dash-nav-btn", text: "◀" });
    prevBtn.addEventListener("click", () => {
      const dates = sortedRows.map(r => r[dateCol]).filter(Boolean);
      const idx = dates.indexOf(this.selectedDate!);
      if (idx > 0) {
        this.selectedDate = dates[idx - 1];
        this.renderView();
      }
    });

    const dateDisplay = nav.createDiv({ cls: "csv-dash-date" });
    const dateSelect = dateDisplay.createEl("select", { cls: "csv-dash-date-select" });

    // Add all existing dates + today if not exists
    const allDates = [...new Set([...sortedRows.map(r => r[dateCol]), today])].sort();
    allDates.forEach(d => {
      const opt = dateSelect.createEl("option", { text: d, value: d });
      if (d === this.selectedDate) opt.selected = true;
    });
    dateSelect.addEventListener("change", () => {
      this.selectedDate = dateSelect.value;
      this.renderView();
    });

    if (isToday) {
      dateDisplay.createSpan({ cls: "csv-dash-today-badge", text: "Today" });
    }

    const nextBtn = nav.createEl("button", { cls: "csv-dash-nav-btn", text: "▶" });
    nextBtn.addEventListener("click", () => {
      const dates = sortedRows.map(r => r[dateCol]).filter(Boolean);
      const idx = dates.indexOf(this.selectedDate!);
      if (idx < dates.length - 1) {
        this.selectedDate = dates[idx + 1];
        this.renderView();
      } else if (this.selectedDate !== today) {
        this.selectedDate = today;
        this.renderView();
      }
    });

    const todayBtn = nav.createEl("button", { cls: "csv-dash-today-btn", text: "Today" });
    todayBtn.addEventListener("click", () => {
      this.selectedDate = today;
      this.renderView();
    });

    // ── Add new date if not exists ────────────────────────────────────────────
    if (!currentRow) {
      const addSection = container.createDiv({ cls: "csv-dash-add-section" });
      addSection.createEl("p", { text: `No entry for ${this.selectedDate}` });
      const addBtn = addSection.createEl("button", { cls: "csv-dash-add-btn", text: `+ Add entry for ${this.selectedDate}` });
      addBtn.addEventListener("click", () => {
        const newRow: CSVRow = {};
        this.headers.forEach(h => newRow[h] = "");
        newRow[dateCol] = this.selectedDate!;
        this.rows.push(newRow);
        this.scheduleSave();
        this.renderView();
      });
      // Still show chart and stats below
    }

    // ── Today's Habits ────────────────────────────────────────────────────────
    if (currentRow) {
      const habitsSection = container.createDiv({ cls: "csv-dash-habits" });
      habitsSection.createEl("h3", { text: this.selectedDate === today ? "Today" : this.selectedDate!, cls: "csv-dash-section-title" });

      const habitsGrid = habitsSection.createDiv({ cls: "csv-dash-habits-grid" });

      habitCols.forEach(h => {
        const isChecked = this.isTruthy(currentRow![h]);
        const habitEl = habitsGrid.createDiv({ cls: `csv-dash-habit ${isChecked ? "checked" : ""}` });
        const checkbox = habitEl.createEl("button", { cls: "csv-dash-habit-check", text: isChecked ? "●" : "○" });
        habitEl.createSpan({ cls: "csv-dash-habit-label", text: h });

        checkbox.addEventListener("click", () => {
          currentRow![h] = isChecked ? "0" : "1";
          this.scheduleSave();
          this.renderView();
        });
      });

      // Habits done count
      const doneCount = habitCols.filter(h => this.isTruthy(currentRow![h])).length;
      habitsSection.createDiv({ cls: "csv-dash-habits-count", text: `${doneCount} of ${habitCols.length} complete` });

      // Notes preview
      if (notesCol && currentRow[notesCol]?.trim()) {
        const notesPreview = habitsSection.createDiv({ cls: "csv-dash-notes-preview" });
        notesPreview.createEl("strong", { text: "Notes: " });
        notesPreview.createSpan({ text: currentRow[notesCol].slice(0, 200) + (currentRow[notesCol].length > 200 ? "…" : "") });
      }
    }

    // ── Chart ─────────────────────────────────────────────────────────────────
    const chartSection = container.createDiv({ cls: "csv-dash-chart-section" });
    chartSection.createEl("h3", { text: "Progress", cls: "csv-dash-section-title" });
    const chartWrap = chartSection.createDiv({ cls: "csv-dash-chart-wrap" });
    const canvas = chartWrap.createEl("canvas", { cls: "csv-dash-chart" });

    // Prepare chart data
    const chartLabels = sortedRows.map(r => {
      const d = r[dateCol] ?? "";
      return d.slice(5); // MM-DD format
    });
    const chartData = sortedRows.map(r => {
      return habitCols.filter(h => this.isTruthy(r[h])).length;
    });

    // Destroy previous chart if exists
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }

    // Create chart
    this.chartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels: chartLabels,
        datasets: [{
          label: "Habits done",
          data: chartData,
          borderColor: "#378ADD",
          backgroundColor: "rgba(55,138,221,0.08)",
          borderWidth: 1.5,
          pointRadius: 3,
          tension: 0.3,
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: habitCols.length || 8, ticks: { stepSize: 1 } }
        },
        plugins: { tooltip: { enabled: true } }
      }
    });

    // ── Stats ─────────────────────────────────────────────────────────────────
    const statsSection = container.createDiv({ cls: "csv-dash-stats-section" });
    statsSection.createEl("h3", { text: "Stats", cls: "csv-dash-section-title" });

    const totalDays = sortedRows.length;
    const totalHabitsDone = sortedRows.reduce((acc, r) => {
      return acc + habitCols.filter(h => this.isTruthy(r[h])).length;
    }, 0);
    const avgPerDay = totalDays > 0 ? (totalHabitsDone / totalDays).toFixed(1) : "0";
    const perfectDays = sortedRows.filter(r => {
      return habitCols.every(h => this.isTruthy(r[h]));
    }).length;

    // Streaks
    let bestStreak = 0, streak = 0;
    for (const r of sortedRows) {
      const done = habitCols.filter(h => this.isTruthy(r[h])).length;
      if (done >= 1) { streak++; if (streak > bestStreak) bestStreak = streak; }
      else streak = 0;
    }
    let currentStreak = 0;
    for (let i = sortedRows.length - 1; i >= 0; i--) {
      const done = habitCols.filter(h => this.isTruthy(sortedRows[i][h])).length;
      if (done >= 1) currentStreak++;
      else break;
    }

    const statsBar = statsSection.createDiv({ cls: "csv-dash-stats-bar" });
    statsBar.innerHTML = `
      <span><strong>${totalDays}</strong> days logged</span>
      <span><strong>${avgPerDay}</strong> avg/day</span>
      <span><strong>${perfectDays}</strong> perfect days</span>
      <span>current streak <strong>${currentStreak}d</strong></span>
      <span>best streak <strong>${bestStreak}d</strong></span>
    `;

    // ── Per-habit cards ───────────────────────────────────────────────────────
    const cardsSection = container.createDiv({ cls: "csv-dash-cards-section" });
    const cardsGrid = cardsSection.createDiv({ cls: "csv-dash-cards-grid" });

    const habitStats = habitCols.map(h => {
      const doneDays = sortedRows.filter(r => this.isTruthy(r[h]));
      const lastDone = doneDays.length > 0 ? doneDays[doneDays.length - 1][dateCol] : null;
      return { habit: h, doneCount: doneDays.length, lastDone };
    }).sort((a, b) => {
      // Sort by last done date (most recent first)
      if (!a.lastDone && !b.lastDone) return 0;
      if (!a.lastDone) return 1;
      if (!b.lastDone) return -1;
      return b.lastDone.localeCompare(a.lastDone);
    });

    habitStats.forEach(({ habit, doneCount, lastDone }) => {
      const card = cardsGrid.createDiv({ cls: "csv-dash-habit-card" });
      card.createDiv({ cls: "csv-dash-habit-card-name", text: habit });
      card.createDiv({ cls: "csv-dash-habit-card-count", text: `${doneCount} of ${totalDays} days` });
      card.createDiv({ cls: "csv-dash-habit-card-last", text: lastDone ? `Last: ${lastDone}` : "Never" });

      // Progress bar
      const pct = totalDays > 0 ? (doneCount / totalDays) * 100 : 0;
      const progressWrap = card.createDiv({ cls: "csv-dash-habit-progress" });
      const progressBar = progressWrap.createDiv({ cls: "csv-dash-habit-progress-bar" });
      progressBar.style.width = `${pct}%`;
    });
  }

  // ── Kanban by Genre ────────────────────────────────────────────────────────

  private renderKanbanGenre(container: HTMLElement): void {
    const cc = this.getCategoryCol();
    const sc = this.getStatusCol();
    if (!cc) { container.createEl("p",{text:`No "${this.settings.categoryColumn}" column found.`,cls:"csv-empty-state"}); return; }

    const genreSet = new Set<string>();
    this.rows.forEach(r => (r[cc]??"").split(",").map(s=>s.trim()).filter(Boolean).forEach(c=>genreSet.add(c)));
    const genres = Array.from(genreSet).sort();
    if (!genres.length) { container.createEl("p",{text:"No genre values found.",cls:"csv-empty-state"}); return; }

    const statusOrder = ["In progress","Finished","Not started"];
    const statuses = sc
      ? Array.from(new Set([...statusOrder,...this.rows.map(r=>r[sc]??"").filter(Boolean)])).filter(s=>this.rows.some(r=>(r[sc]??"")==s))
      : [];

    const board = container.createDiv({cls:"csv-kanban-board"});
    genres.forEach(genre => {
      const genreRows = this.rows.filter(r=>(r[cc]??"").split(",").map(s=>s.trim()).includes(genre));
      if (!genreRows.length) return;
      const col = board.createDiv({cls:"csv-kanban-col"});
      const ch = col.createDiv({cls:"csv-kanban-col-header"});
      ch.createDiv({cls:"csv-kanban-col-title", text:genre});
      ch.createDiv({cls:"csv-kanban-col-count", text:String(genreRows.length)});
      const cb = col.createDiv({cls:"csv-kanban-col-body"});

      if (sc && statuses.length) {
        statuses.forEach(status => {
          const statusRows = genreRows.filter(r=>(r[sc]??"")=== status);
          if (!statusRows.length) return;
          const groupEl = cb.createDiv({cls:"csv-kanban-status-group"});
          groupEl.createDiv({cls:`csv-kanban-status-label status-${status.toLowerCase().replace(/\s+/g,"-")}`, text:status});
          statusRows.forEach(row => this.renderKanbanCard(groupEl, row, statuses, sc));
        });
      } else {
        genreRows.forEach(row => this.renderKanbanCard(cb, row, statuses, sc));
      }
    });
  }

  // ── Kanban card ────────────────────────────────────────────────────────────

  private renderKanbanCard(container: HTMLElement, row: CSVRow, statuses: string[], sc: string|null): void {
    const card = container.createDiv({cls:"csv-kanban-card"});
    card.createDiv({cls:"csv-kanban-card-title", text:this.getTitle(row)});
    const sub = this.getSubtitle(row);
    if (sub) card.createDiv({cls:"csv-kanban-card-sub", text:sub});

    // Meta chips for select fields (skip category, title, author, status)
    const tk=this.titleKey(), ak=this.authorKey(), ccol=this.getCategoryCol();
    const skipInCard = new Set([sc, tk, ak, ccol].filter(Boolean) as string[]);
    const metaEl = card.createDiv({cls:"csv-kanban-card-meta"});
    this.headers.forEach(h => {
      if (skipInCard.has(h) || this.isNotesCol(h) || !row[h]) return;
      const chip = metaEl.createDiv({cls:"csv-kanban-chip"});
      chip.createSpan({cls:"csv-chip-label", text:h+": "});
      if (this.isSelectCol(h)) {
        const valSpan = chip.createSpan({cls:"csv-chip-value csv-chip-select", text:row[h]});
        valSpan.addEventListener("click", e => {
          e.stopPropagation();
          showSelectPicker(valSpan, row[h], this.getColumnValues(h), (newVal) => {
            row[h]=newVal; valSpan.setText(newVal||"—"); this.scheduleSave();
          }, this.contentEl);
        });
      } else {
        const display = row[h].length > 40 ? row[h].slice(0, 38) + "…" : row[h];
        const valSpan = chip.createSpan({cls:"csv-chip-value", text: display});
        if (row[h].length > 40) valSpan.title = row[h]; // full text on hover
      }
    });

    // Inline notes
    const notesCol = this.getNotesCol();
    const hasInlineNotes = !!(notesCol && row[notesCol]?.trim());
    const hasFile = this.notesFileExists(row);

    const notesPreviewEl = card.createDiv({cls:"csv-kanban-notes-preview"});
    if (hasInlineNotes && notesCol) {
      const plain = row[notesCol].replace(/#{1,6}\s/g,"").replace(/[*_>`]/g,"").replace(/\n+/g," ").trim();
      notesPreviewEl.setText(plain.slice(0,120) + (plain.length > 120 ? "…" : ""));
    } else {
      notesPreviewEl.addClass("csv-kanban-notes-preview--empty");
    }

    const notesEditorEl = card.createDiv({cls:"csv-kanban-notes-editor"});
    notesEditorEl.style.display = "none";

    const openInlineEditor = () => {
      // Save scroll position of the content area so we can restore it on close
      const contentArea = this.contentEl.querySelector(".csv-content-area") as HTMLElement | null;
      const scrollLeft = contentArea?.scrollLeft ?? 0;
      const scrollTop = contentArea?.scrollTop ?? 0;

      notesPreviewEl.style.display = "none";
      notesEditorEl.style.display = "block";
      notesEditorEl.empty();
      const ta = notesEditorEl.createEl("textarea", {cls:"csv-notes-textarea"});
      ta.value = (notesCol ? row[notesCol] : "") ?? "";
      ta.style.height = Math.max(120, ta.scrollHeight) + "px";
      ta.addEventListener("click", e => e.stopPropagation());
      ta.addEventListener("mousedown", e => e.stopPropagation());
      ta.addEventListener("input", () => { ta.style.height="auto"; ta.style.height=ta.scrollHeight+"px"; });
      ta.addEventListener("keydown", e => { if (e.key==="Escape") closeInlineEditor(ta.value, contentArea, scrollLeft, scrollTop); });
      ta.addEventListener("blur", () => closeInlineEditor(ta.value, contentArea, scrollLeft, scrollTop));
      // Use preventScroll to avoid browser auto-scrolling the content area
      ta.focus({ preventScroll: true });
    };

    const closeInlineEditor = (newVal: string, contentArea: HTMLElement | null, scrollLeft: number, scrollTop: number) => {
      if (notesCol) { row[notesCol]=newVal; this.scheduleSave(); }
      notesEditorEl.style.display = "none";
      notesPreviewEl.style.display = "";
      notesPreviewEl.removeClass("csv-kanban-notes-preview--empty");
      if (newVal.trim()) {
        const plain = newVal.replace(/#{1,6}\s/g,"").replace(/[*_>`]/g,"").replace(/\n+/g," ").trim();
        notesPreviewEl.setText(plain.slice(0,120) + (plain.length > 120 ? "…" : ""));
      } else {
        notesPreviewEl.addClass("csv-kanban-notes-preview--empty");
        notesPreviewEl.setText("");
      }
      // Restore scroll position after the DOM settles
      // Use multiple approaches to ensure scroll is restored even if browser does post-blur adjustments
      if (contentArea) {
        contentArea.scrollLeft = scrollLeft;
        contentArea.scrollTop = scrollTop;
        requestAnimationFrame(() => {
          contentArea.scrollLeft = scrollLeft;
          contentArea.scrollTop = scrollTop;
          requestAnimationFrame(() => {
            contentArea.scrollLeft = scrollLeft;
            contentArea.scrollTop = scrollTop;
          });
        });
        setTimeout(() => {
          contentArea.scrollLeft = scrollLeft;
          contentArea.scrollTop = scrollTop;
        }, 50);
      }
    };

    notesPreviewEl.addEventListener("click", e => { e.stopPropagation(); openInlineEditor(); });

    // Buttons (visible on hover)
    const btnRow = card.createDiv({cls:"csv-kanban-card-btns"});
    if (notesCol) {
      btnRow.createEl("button",{cls:"csv-kanban-notes-btn", text:"✏️ Edit note"})
        .addEventListener("click", e => { e.stopPropagation(); openInlineEditor(); });
      btnRow.createEl("button",{cls:"csv-kanban-notes-btn", text:"⤢ Expand"})
        .addEventListener("click", e => { e.stopPropagation(); this.openNoteExpander(row, notesCol); });
    }
    btnRow.createEl("button",{cls:`csv-kanban-notes-btn ${hasFile?"":"csv-kanban-create-btn"}`, text:hasFile?"📄 Open notes file":"✚ Notes file"})
      .addEventListener("click", e => { e.stopPropagation(); this.openOrCreateNotes(row); });

    card.addEventListener("click", e => e.stopPropagation());
    card.addEventListener("contextmenu", e => {
      const menu = new Menu();
      menu.addItem(i=>i.setTitle("Open / Create Notes file").setIcon("file-text").onClick(()=>this.openOrCreateNotes(row)));
      if (sc) {
        menu.addSeparator();
        statuses.forEach(s => {
          if (s===row[sc]) return;
          menu.addItem(i=>i.setTitle(`Mark as: ${s}`).onClick(()=>{ row[sc]=s; this.scheduleSave(); this.renderView(); }));
        });
      }
      menu.addSeparator();
      menu.addItem(i=>i.setTitle("Delete").setIcon("trash").onClick(()=>{ this.rows.splice(this.rows.indexOf(row),1); this.scheduleSave(); this.renderView(); }));
      menu.showAtMouseEvent(e);
    });
  }

  // ── Table ──────────────────────────────────────────────────────────────────

  private renderTable(container: HTMLElement): void {
    const wrap = container.createDiv({cls:"csv-table-wrapper"});
    const table = wrap.createEl("table",{cls:"csv-table"});
    const hr = table.createEl("thead").createEl("tr");

    this.headers.forEach(h => {
      const th = hr.createEl("th");
      th.setText(h);
      const savedWidth = this.settings.columnWidths[h];
      if (savedWidth) th.style.width = savedWidth + "px";
      const handle = th.createDiv({cls:"csv-col-resize-handle"});
      let startX = 0, startW = 0;
      handle.addEventListener("mousedown", e => {
        e.preventDefault(); startX=e.clientX; startW=th.offsetWidth;
        const onMove = (ev: MouseEvent) => { th.style.width=Math.max(60,startW+ev.clientX-startX)+"px"; };
        const onUp = (ev: MouseEvent) => { this.settings.columnWidths[h]=Math.max(60,startW+ev.clientX-startX); document.removeEventListener("mousemove",onMove); document.removeEventListener("mouseup",onUp); };
        document.addEventListener("mousemove",onMove); document.addEventListener("mouseup",onUp);
      });
    });
    hr.createEl("th",{text:""});

    const tbody = table.createEl("tbody");
    this.rows.forEach((row, idx) => {
      const tr = tbody.createEl("tr");
      this.headers.forEach(h => {
        const td = tr.createEl("td");
        if (this.isNotesCol(h)) {
          td.addClass("csv-table-notes-cell");
          const preview = (row[h]??"").replace(/#{1,6}\s/g,"").replace(/[*_>`]/g,"").split("\n").filter(l=>l.trim()).slice(0,2).join(" · ");
          td.createSpan({ text: preview.slice(0,100)+(preview.length>100?"…":"") });
          const expandBtn = td.createEl("button", { cls: "csv-table-expand-btn", text: "⤢", title: "Open note" });
          // Both the cell and the button open the expander
          const openExpander = (e: MouseEvent) => { e.stopPropagation(); this.openNoteExpander(row, h); };
          expandBtn.addEventListener("click", openExpander);
          td.addEventListener("click", openExpander);
        } else if (this.isSelectCol(h)) {
          this.renderSelectField(td, row, h);
        } else {
          td.setText(row[h]??"");
          this.makeEditable(td, row, h);
        }
      });
      const at = tr.createEl("td",{cls:"csv-table-action"});
      const hasFile = this.notesFileExists(row);
      at.createEl("button",{cls:`csv-table-notes-btn ${hasFile?"exists":""}`,text:hasFile?"📄":"✚",title:hasFile?"Open notes":"Create notes"})
        .addEventListener("click",()=>this.openOrCreateNotes(row));
      at.createEl("button",{cls:"csv-table-del-btn",text:"✕"})
        .addEventListener("click",()=>{ this.rows.splice(idx,1); this.scheduleSave(); this.renderView(); });
    });
  }

  private makeEditable(el: HTMLElement, row: CSVRow, h: string): void {
    el.addEventListener("click", () => {
      el.empty();
      const input = el.createEl("input",{cls:"csv-inline-input",value:row[h]??"",type:"text"});
      input.focus(); input.select();
      input.addEventListener("blur",()=>{ row[h]=input.value; this.scheduleSave(); el.empty(); el.setText(input.value||"—"); });
      input.addEventListener("keydown",e=>{ if(e.key==="Enter")input.blur(); if(e.key==="Escape"){el.empty();el.setText(row[h]||"—");} });
    });
  }

  onunload(): void { this.renderComponent.unload(); if(this.saveTimer) window.clearTimeout(this.saveTimer); }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

class CardViewSettingTab extends PluginSettingTab {
  plugin: CardViewPlugin;
  constructor(app: App, plugin: CardViewPlugin){super(app,plugin); this.plugin=plugin;}
  display(): void {
    const {containerEl}=this; containerEl.empty();
    containerEl.createEl("h2",{text:"XLSX Card View"});
    new Setting(containerEl).setName("Default view mode")
      .addDropdown(d=>d.addOption("kanban-genre","By Genre").addOption("table","Table")
        .setValue(this.plugin.settings.defaultMode)
        .onChange(async v=>{ this.plugin.settings.defaultMode=v as ViewMode; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Status column name")
      .addText(t=>t.setValue(this.plugin.settings.statusColumn).onChange(async v=>{ this.plugin.settings.statusColumn=v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Category/Genre column name")
      .addText(t=>t.setValue(this.plugin.settings.categoryColumn).onChange(async v=>{ this.plugin.settings.categoryColumn=v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Notes column names").setDesc("Comma-separated.")
      .addText(t=>t.setValue(this.plugin.settings.notesColumns.join(", ")).onChange(async v=>{ this.plugin.settings.notesColumns=v.split(",").map(s=>s.trim()); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Select/dropdown columns").setDesc("Comma-separated column names that use a dropdown picker.")
      .addText(t=>t.setValue(this.plugin.settings.selectColumns.join(", ")).onChange(async v=>{ this.plugin.settings.selectColumns=v.split(",").map(s=>s.trim()); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Notes subfolder")
      .addText(t=>t.setPlaceholder("Notes").setValue(this.plugin.settings.notesSubfolder).onChange(async v=>{ this.plugin.settings.notesSubfolder=v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Reset column widths")
      .addButton(b=>b.setButtonText("Reset").onClick(async()=>{ this.plugin.settings.columnWidths={}; await this.plugin.saveSettings(); new Notice("Column widths reset."); }));
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class CardViewPlugin extends Plugin {
  settings: CardViewSettings = DEFAULT_SETTINGS;
  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(CARD_VIEW_TYPE, leaf=>new XLSXCardView(leaf, this.settings));
    this.registerExtensions(["csv","xlsx"], CARD_VIEW_TYPE);
    this.addSettingTab(new CardViewSettingTab(this.app, this));
  }
  async loadSettings(): Promise<void> { this.settings=Object.assign({},DEFAULT_SETTINGS,await this.loadData()); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
