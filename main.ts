import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  FileView,
  WorkspaceLeaf,
  MarkdownRenderer,
  MarkdownPostProcessorContext,
  Component,
  Menu,
  Notice,
  TFile,
  normalizePath,
} from "obsidian";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip } from "chart.js";

// Import from src modules
import { CSVRow, ViewMode, FileConfig, CardViewSettings, DEFAULT_SETTINGS, CARD_VIEW_TYPE } from "./src/types";
import { sanitizeFilename, titleCase, formatRating, showSelectPicker } from "./src/utils";
import { AddEntryModal, NoteExpanderModal, FileConfigModal } from "./src/modals";

// Register Chart.js components
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

// ─── View ────────────────────────────────────────────────────────────────────

export class XLSXCardView extends FileView {
  settings: CardViewSettings;
  headers: string[] = [];
  rows: CSVRow[] = [];
  mode: ViewMode;
  private renderComponent: Component;
  private isXlsx = false;
  private saveTimer: number | null = null;
  private searchQuery: string = "";

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

        // Also sync to CSV helper file if it exists (use adapter for helper folder)
        const csvFolder = this.file.parent?.path ?? "";
        const helperFolder = csvFolder ? `${csvFolder}/_csv_helpers` : "_csv_helpers";
        const csvPath = `${helperFolder}/${this.file.basename}.csv`;
        if (await this.app.vault.adapter.exists(csvPath)) {
          const csvContent = Papa.unparse(this.rows, { columns: this.headers });
          await this.app.vault.adapter.write(csvPath, csvContent);
        }
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

  private contentArea: HTMLElement | null = null;

  private renderView(contentOnly = false): void {
    const root = this.contentEl;

    if (!contentOnly) {
      root.empty(); root.addClass("csv-card-view-root");
      this.renderComponent.unload();
      this.renderComponent = new Component(); this.renderComponent.load();
      this.renderToolbar(root);
      this.contentArea = root.createDiv({ cls: "csv-content-area" });
    } else if (this.contentArea) {
      this.contentArea.empty();
    }

    const content = this.contentArea;
    if (!content) return;

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

    // Search bar (only for kanban/table views, not dashboard)
    if (this.mode !== "dashboard") {
      const searchWrap = ctrl.createDiv({ cls: "csv-search-wrap" });
      const searchInput = searchWrap.createEl("input", {
        cls: "csv-search-input",
        type: "text",
        placeholder: "Search...",
        value: this.searchQuery
      });
      const clearBtn = searchWrap.createEl("button", { cls: "csv-search-clear", text: "×" });
      clearBtn.style.display = this.searchQuery ? "block" : "none";
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value;
        clearBtn.style.display = this.searchQuery ? "block" : "none";
        this.renderView(true); // Only re-render content, not toolbar
      });
      clearBtn.addEventListener("click", () => {
        this.searchQuery = "";
        searchInput.value = "";
        clearBtn.style.display = "none";
        this.renderView(true);
      });
    }

    // Sort order toggle (only for table view with date column)
    if (this.mode === "table" && this.hasDateColumn()) {
      const sortNewest = this.fileCfg.sortNewestFirst ?? true;
      const sortBtn = ctrl.createEl("button", {
        cls: `csv-cfg-btn ${sortNewest ? "active" : ""}`,
        text: sortNewest ? "↓ Newest" : "↑ Oldest",
        title: "Toggle sort order"
      });
      sortBtn.addEventListener("click", () => {
        const cfg = this.fileCfg;
        cfg.sortNewestFirst = !(cfg.sortNewestFirst ?? true);
        this.saveFileCfg(cfg);
        this.renderView();
      });
    }

    // Per-file column config
    const cfgBtn = ctrl.createEl("button", { cls: "csv-cfg-btn", text: "⚙ Columns", title: "Configure columns for this file" });
    cfgBtn.addEventListener("click", () => {
      new FileConfigModal(this.app, this.headers, this.file?.path ?? "", this.fileCfg, this.autoDetectBooleanColumns(), (cfg) => {
        this.saveFileCfg(cfg);
        if (cfg.defaultMode) this.mode = cfg.defaultMode;
        this.renderView();
      }).open();
    });

    // Mobile dashboard button (works for all file types)
    const mobileBtn = ctrl.createEl("button", { cls: "csv-cfg-btn", text: "📱 Mobile", title: "Generate mobile dashboard with add form" });
    mobileBtn.addEventListener("click", () => this.generateMobileFiles());

    ctrl.createEl("button",{cls:"csv-add-btn",text:"+ Add"}).addEventListener("click",()=>this.openAddModal());
  }

  // ── Date detection ──────────────────────────────────────────────────────────

  private hasDateColumn(): boolean {
    const dateCol = this.getDateCol();
    return dateCol !== null;
  }

  // ── Search filtering ─────────────────────────────────────────────────────────

  private getFilteredRows(): CSVRow[] {
    let result = this.rows;

    // Filter by search query
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();
      result = result.filter(row => {
        return this.headers.some(h => {
          const val = row[h] ?? "";
          return val.toLowerCase().includes(query);
        });
      });
    }

    // Sort by date if in table view and has date column
    const dateCol = this.getDateCol();
    if (this.mode === "table" && dateCol) {
      const sortNewest = this.fileCfg.sortNewestFirst ?? true;
      result = [...result].sort((a, b) => {
        const dateA = a[dateCol] ?? "";
        const dateB = b[dateCol] ?? "";
        const cmp = dateA.localeCompare(dateB);
        return sortNewest ? -cmp : cmp;
      });
    }

    return result;
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
    // Use configured habit columns if set, otherwise auto-detect
    if (this.fileCfg.habitColumns && this.fileCfg.habitColumns.length > 0) {
      return this.fileCfg.habitColumns.filter(h => this.headers.includes(h));
    }
    return this.autoDetectBooleanColumns();
  }

  private autoDetectBooleanColumns(): string[] {
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
  private selectedHabit: string | null = null;
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
    // Compute all dates first (includes today even if no entry exists)
    const allDates = [...new Set([...sortedRows.map(r => r[dateCol]), today])].filter(Boolean).sort();

    const nav = container.createDiv({ cls: "csv-dash-nav" });

    const prevBtn = nav.createEl("button", { cls: "csv-dash-nav-btn csv-dash-back-btn", text: "◀" });
    prevBtn.addEventListener("click", () => {
      const idx = allDates.indexOf(this.selectedDate!);
      if (idx > 0) {
        this.selectedDate = allDates[idx - 1];
        this.renderView();
      } else if (idx === -1 && allDates.length > 0) {
        // Selected date not in list, go to most recent existing
        const earlier = allDates.filter(d => d < this.selectedDate!);
        if (earlier.length > 0) {
          this.selectedDate = earlier[earlier.length - 1];
          this.renderView();
        }
      }
    });

    const dateDisplay = nav.createDiv({ cls: "csv-dash-date" });

    // Green dot indicator if it's today
    if (isToday) {
      dateDisplay.createSpan({ cls: "csv-dash-today-dot" });
    }

    const dateSelect = dateDisplay.createEl("select", { cls: "csv-dash-date-select" });

    allDates.forEach(d => {
      const opt = dateSelect.createEl("option", { text: d, value: d });
      if (d === this.selectedDate) opt.selected = true;
    });
    dateSelect.addEventListener("change", () => {
      this.selectedDate = dateSelect.value;
      this.renderView();
    });

    const nextBtn = nav.createEl("button", { cls: "csv-dash-nav-btn", text: "▶" });
    nextBtn.addEventListener("click", () => {
      const idx = allDates.indexOf(this.selectedDate!);
      if (idx >= 0 && idx < allDates.length - 1) {
        this.selectedDate = allDates[idx + 1];
        this.renderView();
      } else if (idx === -1) {
        // Selected date not in list, go to next available
        const later = allDates.filter(d => d > this.selectedDate!);
        if (later.length > 0) {
          this.selectedDate = later[0];
          this.renderView();
        }
      }
    });

    // Only show "Today" button if not already on today
    if (!isToday) {
      const todayBtn = nav.createEl("button", { cls: "csv-dash-today-btn", text: "Today" });
      todayBtn.addEventListener("click", () => {
        this.selectedDate = today;
        this.renderView();
      });
    }

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

    // Streaks - must account for missing days (gaps break the streak)
    let bestStreak = 0, streak = 0;
    let prevDate: Date | null = null;
    for (const r of sortedRows) {
      const done = habitCols.filter(h => this.isTruthy(r[h])).length;
      const currentDate = this.parseDate(r[dateCol] ?? "");

      // Check if this is a consecutive day (no gap)
      let isConsecutive = true;
      if (prevDate && currentDate) {
        const dayDiff = Math.round((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        if (dayDiff !== 1) isConsecutive = false;
      }

      if (done >= 1 && (isConsecutive || prevDate === null)) {
        streak++;
        if (streak > bestStreak) bestStreak = streak;
      } else if (done >= 1) {
        // Had a gap, start new streak
        streak = 1;
        if (streak > bestStreak) bestStreak = streak;
      } else {
        streak = 0;
      }
      prevDate = currentDate;
    }

    // Current streak - check backwards from today, accounting for gaps
    let currentStreak = 0;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    let expectedDate = todayDate;

    for (let i = sortedRows.length - 1; i >= 0; i--) {
      const rowDate = this.parseDate(sortedRows[i][dateCol] ?? "");
      if (!rowDate) break;

      const dayDiff = Math.round((expectedDate.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24));

      // Allow today or yesterday as starting point, then must be consecutive
      if (currentStreak === 0 && dayDiff > 1) break; // Too old to start current streak
      if (currentStreak > 0 && dayDiff !== 1) break; // Gap in streak

      const done = habitCols.filter(h => this.isTruthy(sortedRows[i][h])).length;
      if (done >= 1) {
        currentStreak++;
        expectedDate = rowDate;
      } else {
        break;
      }
    }

    // Format stats like Dataview: "105 days logged · 2.0 avg/day · 0 perfect days · current streak 8d · best streak 90d"
    const statsBar = statsSection.createDiv({ cls: "csv-dash-stats-bar" });
    statsBar.innerHTML = `<strong>${totalDays}</strong> days logged · <strong>${avgPerDay}</strong> avg/day · <strong>${perfectDays}</strong> perfect days · current streak <strong>${currentStreak}d</strong> · best streak <strong>${bestStreak}d</strong>`;

    // ── Per-habit cards ───────────────────────────────────────────────────────
    const cardsSection = container.createDiv({ cls: "csv-dash-cards-section" });
    const cardsGrid = cardsSection.createDiv({ cls: "csv-dash-cards-grid" });

    // Get current year for "this year" stats
    const currentYear = new Date().getFullYear();

    // Habit icons - customize per habit name (fallback to ○)
    const habitIcons: { [key: string]: string } = {
      "language": "○", "read": "≡", "gym": "⊞", "vitamins": "⊙",
      "cardio": "↑", "meditate": "◎", "challenge": "✿", "journal": "✎",
      "exercise": "⊞", "water": "💧", "sleep": "🌙", "study": "📚",
    };

    const habitStats = habitCols.map(h => {
      const doneDays = sortedRows.filter(r => this.isTruthy(r[h]));
      const lastDone = doneDays.length > 0 ? doneDays[doneDays.length - 1][dateCol] : null;

      // Get years with data for this habit
      const yearsWithData = new Set<number>();
      doneDays.forEach(r => {
        const d = this.parseDate(r[dateCol] ?? "");
        if (d) yearsWithData.add(d.getFullYear());
      });

      // Count this year
      const thisYearRows = sortedRows.filter(r => {
        const d = this.parseDate(r[dateCol] ?? "");
        return d && d.getFullYear() === currentYear;
      });
      const doneThisYear = thisYearRows.filter(r => this.isTruthy(r[h])).length;

      return {
        habit: h,
        doneCount: doneDays.length,
        doneThisYear,
        totalThisYear: thisYearRows.length,
        lastDone,
        years: Array.from(yearsWithData).sort()
      };
    }).sort((a, b) => {
      // Sort by last done date (most recent first)
      if (!a.lastDone && !b.lastDone) return 0;
      if (!a.lastDone) return 1;
      if (!b.lastDone) return -1;
      return b.lastDone.localeCompare(a.lastDone);
    });

    habitStats.forEach(({ habit, doneCount, doneThisYear, totalThisYear, lastDone, years }) => {
      const card = cardsGrid.createDiv({ cls: "csv-dash-habit-card" });

      // Header with icon and name
      const icon = habitIcons[habit.toLowerCase()] ?? "○";
      const header = card.createDiv({ cls: "csv-dash-habit-card-header" });
      header.createSpan({ cls: "csv-dash-habit-icon", text: icon });
      header.createSpan({ cls: "csv-dash-habit-card-name", text: titleCase(habit) });

      // Year badges
      if (years.length > 0) {
        const yearBadges = card.createDiv({ cls: "csv-dash-habit-years" });
        yearBadges.setText(years.join(" · "));
      }

      // Stats
      card.createDiv({ cls: "csv-dash-habit-card-thisyear", text: `${doneThisYear} of ${totalThisYear} complete this year` });
      card.createDiv({ cls: "csv-dash-habit-card-alltime", text: `${doneCount} of ${totalDays} all time` });

      // Last logged with formatted date
      if (lastDone) {
        const d = this.parseDate(lastDone);
        const formatted = d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : lastDone;
        card.createDiv({ cls: "csv-dash-habit-card-last", text: `Last logged: ${formatted}` });
      } else {
        card.createDiv({ cls: "csv-dash-habit-card-last", text: "Never logged" });
      }

      // Progress bar
      const pct = totalDays > 0 ? (doneCount / totalDays) * 100 : 0;
      const progressWrap = card.createDiv({ cls: "csv-dash-habit-progress" });
      const progressBar = progressWrap.createDiv({ cls: "csv-dash-habit-progress-bar" });
      progressBar.style.width = `${pct}%`;

      // Click to show per-habit timeline
      card.addEventListener("click", () => {
        this.selectedHabit = this.selectedHabit === habit ? null : habit;
        this.renderView();
      });
      if (this.selectedHabit === habit) {
        card.addClass("selected");
      }
    });

    // ── Per-habit timeline (if a habit is selected) ───────────────────────────
    if (this.selectedHabit && habitCols.includes(this.selectedHabit)) {
      this.renderHabitTimeline(container, sortedRows, dateCol, this.selectedHabit);
    }
  }

  private timelineYear: number = new Date().getFullYear();

  private renderHabitTimeline(container: HTMLElement, sortedRows: CSVRow[], dateCol: string, habit: string): void {
    const timelineSection = container.createDiv({ cls: "csv-dash-timeline-section" });
    const header = timelineSection.createDiv({ cls: "csv-dash-timeline-header" });
    header.createEl("h3", { text: `${titleCase(habit)} Timeline`, cls: "csv-dash-section-title" });

    // Year selector
    const yearSelect = header.createEl("select", { cls: "csv-dash-year-select" });
    const availableYears = new Set<number>();
    sortedRows.forEach(r => {
      const d = this.parseDate(r[dateCol] ?? "");
      if (d) availableYears.add(d.getFullYear());
    });
    availableYears.add(new Date().getFullYear());
    Array.from(availableYears).sort().reverse().forEach(y => {
      const opt = yearSelect.createEl("option", { text: String(y), value: String(y) });
      if (y === this.timelineYear) opt.selected = true;
    });
    yearSelect.addEventListener("change", () => {
      this.timelineYear = parseInt(yearSelect.value);
      this.renderView();
    });

    const closeBtn = header.createEl("button", { cls: "csv-dash-timeline-close", text: "✕" });
    closeBtn.addEventListener("click", () => {
      this.selectedHabit = null;
      this.renderView();
    });

    // Build a map of date -> done status
    const dateMap = new Map<string, boolean>();
    sortedRows.forEach(r => {
      dateMap.set(r[dateCol] ?? "", this.isTruthy(r[habit]));
    });

    // Create calendar-style grid (like GitHub contribution graph)
    const gridWrap = timelineSection.createDiv({ cls: "csv-dash-timeline-grid-wrap" });

    // Month labels row
    const monthRow = gridWrap.createDiv({ cls: "csv-dash-timeline-months" });
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach(m => monthRow.createSpan({ cls: "csv-dash-timeline-month-label", text: m }));

    // Grid of days (12 months x ~31 days)
    const grid = gridWrap.createDiv({ cls: "csv-dash-timeline-calendar" });

    // Day labels (1-31)
    const dayLabels = grid.createDiv({ cls: "csv-dash-timeline-day-labels" });
    for (let d = 1; d <= 31; d++) {
      dayLabels.createDiv({ cls: "csv-dash-timeline-day-label", text: d % 5 === 0 || d === 1 ? String(d) : "" });
    }

    // Each month column
    for (let month = 0; month < 12; month++) {
      const monthCol = grid.createDiv({ cls: "csv-dash-timeline-month-col" });
      const daysInMonth = new Date(this.timelineYear, month + 1, 0).getDate();

      for (let day = 1; day <= 31; day++) {
        if (day > daysInMonth) {
          monthCol.createDiv({ cls: "csv-dash-timeline-cell empty" });
          continue;
        }

        const dateStr = `${this.timelineYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const isDone = dateMap.get(dateStr) ?? false;
        const hasEntry = dateMap.has(dateStr);
        const isFuture = new Date(this.timelineYear, month, day) > new Date();

        const cell = monthCol.createDiv({
          cls: `csv-dash-timeline-cell ${isFuture ? "future" : ""} ${isDone ? "done" : ""} ${hasEntry && !isDone ? "missed" : ""} ${!hasEntry && !isFuture ? "no-entry" : ""}`
        });
        cell.title = `${dateStr}: ${isFuture ? "Future" : isDone ? "✓ Done" : hasEntry ? "✗ Missed" : "No entry"}`;
      }
    }

    // Stats for this habit (filtered by selected year)
    const yearRows = sortedRows.filter(r => {
      const d = this.parseDate(r[dateCol] ?? "");
      return d && d.getFullYear() === this.timelineYear;
    });
    const doneDays = yearRows.filter(r => this.isTruthy(r[habit])).length;
    const totalEntries = yearRows.length;

    // Calculate streak for this specific habit
    let habitStreak = 0, habitBestStreak = 0, tempStreak = 0;
    let prevDate: Date | null = null;
    for (const r of sortedRows) {
      const done = this.isTruthy(r[habit]);
      const currentDateParsed = this.parseDate(r[dateCol] ?? "");
      let isConsecutive = true;
      if (prevDate && currentDateParsed) {
        const dayDiff = Math.round((currentDateParsed.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        if (dayDiff !== 1) isConsecutive = false;
      }
      if (done && (isConsecutive || prevDate === null)) {
        tempStreak++;
        if (tempStreak > habitBestStreak) habitBestStreak = tempStreak;
      } else if (done) {
        tempStreak = 1;
      } else {
        tempStreak = 0;
      }
      prevDate = currentDateParsed;
    }

    // Current streak for this habit
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    let expectedDate = todayDate;
    for (let i = sortedRows.length - 1; i >= 0; i--) {
      const rowDate = this.parseDate(sortedRows[i][dateCol] ?? "");
      if (!rowDate) break;
      const dayDiff = Math.round((expectedDate.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24));
      if (habitStreak === 0 && dayDiff > 1) break;
      if (habitStreak > 0 && dayDiff !== 1) break;
      if (this.isTruthy(sortedRows[i][habit])) {
        habitStreak++;
        expectedDate = rowDate;
      } else {
        break;
      }
    }

    const statsEl = timelineSection.createDiv({ cls: "csv-dash-timeline-stats" });
    statsEl.innerHTML = `<strong>${doneDays}</strong> of ${totalEntries} in ${this.timelineYear} · current streak <strong>${habitStreak}d</strong> · best streak <strong>${habitBestStreak}d</strong>`;
  }

  // ── Mobile Files Generation ─────────────────────────────────────────────────

  private async generateMobileFiles(): Promise<void> {
    if (!this.file) return;

    const csvFolder = this.file.parent?.path ?? "";
    const dashboardPath = csvFolder ? `${csvFolder}/${this.file.basename} - Mobile.md` : `${this.file.basename} - Mobile.md`;

    // For XLSX files, export a CSV copy to helper folder for Dataview
    let csvPath = this.file.path;
    if (this.isXlsx) {
      const helperFolder = csvFolder ? `${csvFolder}/_csv_helpers` : "_csv_helpers";
      csvPath = `${helperFolder}/${this.file.basename}.csv`;

      // Create helper folder and CSV using adapter (helper folder not indexed by vault)
      if (!await this.app.vault.adapter.exists(helperFolder)) {
        await this.app.vault.adapter.mkdir(helperFolder);
      }
      const csvContent = Papa.unparse(this.rows, { columns: this.headers });
      await this.app.vault.adapter.write(csvPath, csvContent);
    }

    // Determine file type (habit tracker vs library)
    const dateCol = this.getDateCol();
    const categoryCol = this.getCategoryCol();

    let dashboardContent: string;

    if (dateCol) {
      // Habit tracker - use Dataview to query CSV
      const habitCols = this.getBooleanColumns();
      dashboardContent = this.generateHabitMobileDashboard(habitCols, dateCol, csvPath);
    } else if (categoryCol) {
      // Library (books, movies) - display table and add form
      dashboardContent = this.generateLibraryMobileDashboard(csvPath);
    } else {
      // Generic - just show table and add form
      dashboardContent = this.generateGenericMobileDashboard(csvPath);
    }

    try {
      const existingDashboard = this.app.vault.getAbstractFileByPath(dashboardPath);
      if (existingDashboard && existingDashboard instanceof TFile) {
        await this.app.vault.modify(existingDashboard, dashboardContent);
        new Notice(`Updated: ${dashboardPath}`);
      } else {
        await this.app.vault.create(dashboardPath, dashboardContent);
        new Notice(`Created: ${dashboardPath}`);
      }
    } catch {
      // File exists but wasn't found - try modify
      const f = this.app.vault.getAbstractFileByPath(dashboardPath);
      if (f instanceof TFile) {
        await this.app.vault.modify(f, dashboardContent);
        new Notice(`Updated: ${dashboardPath}`);
      }
    }
  }

  private generateHabitMobileDashboard(habitCols: string[], dateCol: string, csvPath: string): string {
    const fileName = this.file?.name ?? "";
    const labels = habitCols.map(h => titleCase(h));

    return `> Requires **Dataview** plugin with DataviewJS enabled.

## Quick Add

\`\`\`csv-add
file: ${fileName}
\`\`\`

## Recent Entries

\`\`\`csv-refresh
\`\`\`

\`\`\`dataviewjs
const csvData = await dv.io.csv("${csvPath}");
if (!csvData || !csvData.length) {
  dv.paragraph("No data found");
} else {
  const data = csvData.array();
  const recent = data.slice(-10).reverse();
  const habits = [${habitCols.map(h => `"${h}"`).join(", ")}];
  const labels = [${labels.map(h => `"${h}"`).join(", ")}];

  const container = dv.container;
  container.style.overflowX = "auto";
  container.style.fontSize = "12px";

  // Style table headers to prevent word breaks
  setTimeout(() => {
    container.querySelectorAll("th").forEach(th => {
      th.style.whiteSpace = "nowrap";
      th.style.padding = "4px 8px";
    });
    container.querySelectorAll("td").forEach(td => {
      td.style.padding = "4px 8px";
      td.style.textAlign = "center";
    });
  }, 50);

  dv.table(
    ["Date", ...labels],
    recent.map(r => {
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
      return [shortDate, ...habits.map(h => r[h] == "1" || r[h] == "true" ? "✓" : "·")];
    })
  );
}
\`\`\`
`;
  }

  private generateLibraryMobileDashboard(csvPath: string): string {
    const fileName = this.file?.name ?? "";
    const titleKey = this.titleKey();
    const categoryCol = this.getCategoryCol();
    const statusCol = this.getStatusCol();

    const displayCols = [titleKey, categoryCol, statusCol].filter(Boolean) as string[];

    return `# ${this.file?.basename} - Mobile

> Requires **Dataview** plugin with DataviewJS enabled.

## Add New Entry

\`\`\`csv-add
file: ${fileName}
\`\`\`

## Library

\`\`\`dataviewjs
const csvData = await dv.io.csv("${csvPath}");
if (!csvData || !csvData.length) {
  dv.paragraph("No data found");
} else {
  const data = csvData.array();
  dv.table(
    [${displayCols.map(c => `"${c}"`).join(", ")}],
    data.slice(-20).reverse().map(r => [${displayCols.map(c => `r["${c}"] || ""`).join(", ")}])
  );
  dv.paragraph(\`*Showing last 20 of \${data.length} entries*\`);
}
\`\`\`

## Search by Status

\`\`\`dataviewjs
const csvData = await dv.io.csv("${csvPath}");
if (!csvData || !csvData.length) {
  dv.paragraph("No data");
} else {
  const data = csvData.array();
  const statusCol = "${statusCol || "Status"}";
  const statuses = [...new Set(data.map(r => r[statusCol]).filter(Boolean))];

  for (const status of statuses) {
    const items = data.filter(r => r[statusCol] === status);
    dv.header(3, \`\${status} (\${items.length})\`);
    dv.list(items.slice(0, 5).map(r => r["${titleKey}"]));
    if (items.length > 5) dv.paragraph(\`*... and \${items.length - 5} more*\`);
  }
}
\`\`\`
`;
  }

  private generateGenericMobileDashboard(csvPath: string): string {
    const fileName = this.file?.name ?? "";
    const displayCols = this.headers.slice(0, 4);

    return `# ${this.file?.basename} - Mobile

> Requires **Dataview** plugin with DataviewJS enabled.

## Add New Entry

\`\`\`csv-add
file: ${fileName}
\`\`\`

## Recent Entries

\`\`\`dataviewjs
const csvData = await dv.io.csv("${csvPath}");
if (!csvData || !csvData.length) {
  dv.paragraph("No data found");
} else {
  const data = csvData.array();
  dv.table(
    [${displayCols.map(c => `"${c}"`).join(", ")}],
    data.slice(-15).reverse().map(r => [${displayCols.map(c => `r["${c}"] || ""`).join(", ")}])
  );
  dv.paragraph(\`*Showing last 15 of \${data.length} entries*\`);
}
\`\`\`
`;
  }

  // ── Kanban by Genre ────────────────────────────────────────────────────────

  private renderKanbanGenre(container: HTMLElement): void {
    const cc = this.getCategoryCol();
    const sc = this.getStatusCol();
    if (!cc) { container.createEl("p",{text:`No "${this.settings.categoryColumn}" column found.`,cls:"csv-empty-state"}); return; }

    const filteredRows = this.getFilteredRows();

    // Show search result count if searching
    if (this.searchQuery.trim()) {
      container.createDiv({ cls: "csv-search-results", text: `Found ${filteredRows.length} of ${this.rows.length} entries` });
    }

    const genreSet = new Set<string>();
    filteredRows.forEach(r => (r[cc]??"").split(",").map(s=>s.trim()).filter(Boolean).forEach(c=>genreSet.add(c)));
    const genres = Array.from(genreSet).sort();
    if (!genres.length) {
      container.createEl("p",{text: this.searchQuery ? "No matching entries found." : "No genre values found.",cls:"csv-empty-state"});
      return;
    }

    const statusOrder = ["In progress","Finished","Not started"];
    const statuses = sc
      ? Array.from(new Set([...statusOrder,...filteredRows.map(r=>r[sc]??"").filter(Boolean)])).filter(s=>filteredRows.some(r=>(r[sc]??"")==s))
      : [];

    const board = container.createDiv({cls:"csv-kanban-board"});
    genres.forEach(genre => {
      const genreRows = filteredRows.filter(r=>(r[cc]??"").split(",").map(s=>s.trim()).includes(genre));
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
    const filteredRows = this.getFilteredRows();

    // Show search result count if searching
    if (this.searchQuery.trim()) {
      container.createDiv({ cls: "csv-search-results", text: `Found ${filteredRows.length} of ${this.rows.length} entries` });
    }

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
    filteredRows.forEach((row) => {
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
        .addEventListener("click",()=>{ const actualIdx = this.rows.indexOf(row); if(actualIdx>=0) this.rows.splice(actualIdx,1); this.scheduleSave(); this.renderView(); });
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

    // Register csv-add code block for mobile entry
    this.registerMarkdownCodeBlockProcessor("csv-add", async (source, el, ctx) => {
      await this.renderAddEntryForm(source.trim(), el, ctx);
    });

    // Register csv-refresh code block for manual refresh button
    this.registerMarkdownCodeBlockProcessor("csv-refresh", (source, el, ctx) => {
      const btn = el.createEl("button", {
        text: "🔄 Refresh",
        cls: "csv-refresh-btn"
      });
      btn.addEventListener("click", async () => {
        // Close and reopen the note to force Dataview to re-read CSV
        const currentPath = ctx.sourcePath;
        const file = this.app.vault.getAbstractFileByPath(currentPath);
        if (file instanceof TFile) {
          const leaf = this.app.workspace.activeLeaf;
          if (leaf) {
            await leaf.openFile(file, { state: { mode: "preview" } });
          }
        }
      });
    });
  }

  async renderAddEntryForm(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    // Parse source to get file path
    const lines = source.split("\n").map(l => l.trim()).filter(Boolean);
    let filePath = "";
    for (const line of lines) {
      if (line.startsWith("file:")) {
        filePath = line.replace("file:", "").trim();
        break;
      }
    }

    if (!filePath) {
      el.createEl("p", { text: "Error: No file specified. Use: file: yourfile.csv", cls: "csv-add-error" });
      return;
    }

    // Resolve path relative to current note
    const currentFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    const baseFolder = currentFile?.parent?.path ?? "";
    const fullPath = filePath.includes("/") ? filePath : (baseFolder ? `${baseFolder}/${filePath}` : filePath);

    const file = this.app.vault.getAbstractFileByPath(fullPath);
    if (!file || !(file instanceof TFile)) {
      el.createEl("p", { text: `Error: File not found: ${fullPath}`, cls: "csv-add-error" });
      return;
    }

    // Read the file to get headers
    let headers: string[] = [];
    let rows: CSVRow[] = [];
    const isXlsx = file.extension === "xlsx";

    try {
      if (isXlsx) {
        const buf = await this.app.vault.readBinary(file);
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
        if (raw.length) {
          headers = (raw[0] as string[]).map(String);
          rows = raw.slice(1).map(r => {
            const row: CSVRow = {};
            headers.forEach((h, i) => { row[h] = String((r as string[])[i] ?? ""); });
            return row;
          });
        }
      } else {
        const text = await this.app.vault.read(file);
        const result = Papa.parse(text, { header: true, skipEmptyLines: true });
        headers = result.meta.fields ?? [];
        rows = result.data as CSVRow[];
      }
    } catch (e) {
      el.createEl("p", { text: `Error reading file: ${e}`, cls: "csv-add-error" });
      return;
    }

    if (!headers.length) {
      el.createEl("p", { text: "Error: No columns found in file", cls: "csv-add-error" });
      return;
    }

    // Detect column types
    const binaryPatterns = ["0", "1", "true", "false", "yes", "no", ""];
    const isBinaryCol = (h: string): boolean => {
      const vals = rows.map(r => (r[h] ?? "").toLowerCase().trim());
      return vals.length > 0 && vals.every(v => binaryPatterns.includes(v));
    };

    const isDateCol = (h: string): boolean => {
      const hLower = h.toLowerCase();
      if (["date", "day", "datum"].includes(hLower)) return true;
      const vals = rows.slice(0, 5).map(r => r[h] ?? "");
      return vals.length > 0 && vals.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
    };

    const isNotesCol = (h: string): boolean => {
      const hLower = h.toLowerCase();
      return ["notes", "note", "comments", "description", "journal"].includes(hLower);
    };

    // Categorize columns
    const binaryCols = headers.filter(h => isBinaryCol(h) && !isDateCol(h));
    const dateCols = headers.filter(h => isDateCol(h));
    const notesCols = headers.filter(h => isNotesCol(h));
    const otherCols = headers.filter(h => !binaryCols.includes(h) && !dateCols.includes(h) && !notesCols.includes(h));

    // Render compact form
    const form = el.createDiv({ cls: "csv-add-form csv-add-compact" });

    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const toggleStates: Record<string, boolean> = {};

    // Date field first (if habit tracker)
    dateCols.forEach(h => {
      const fieldWrap = form.createDiv({ cls: "csv-add-field csv-add-date-field" });
      fieldWrap.createEl("label", { text: titleCase(h), cls: "csv-add-label" });
      const dateInput = fieldWrap.createEl("input", { cls: "csv-add-input", type: "date" });
      dateInput.value = new Date().toISOString().split("T")[0]; // Default to today
      inputs[h] = dateInput;
    });

    // Binary columns as toggles in a grid
    if (binaryCols.length > 0) {
      const toggleGrid = form.createDiv({ cls: "csv-add-toggle-grid" });
      binaryCols.forEach(h => {
        toggleStates[h] = false;
        const toggle = toggleGrid.createDiv({ cls: "csv-add-toggle" });
        const checkbox = toggle.createEl("input", { type: "checkbox", cls: "csv-add-checkbox" });
        checkbox.id = `toggle-${h}`;
        const label = toggle.createEl("label", { text: titleCase(h), cls: "csv-add-toggle-label" });
        label.setAttribute("for", `toggle-${h}`);
        checkbox.addEventListener("change", () => { toggleStates[h] = checkbox.checked; });
        inputs[h] = checkbox;
      });
    }

    // Other fields (title, author, category, etc.)
    otherCols.forEach(h => {
      const fieldWrap = form.createDiv({ cls: "csv-add-field" });
      fieldWrap.createEl("label", { text: titleCase(h), cls: "csv-add-label" });

      const uniqueVals = new Set(rows.map(r => (r[h] ?? "").trim()).filter(Boolean));
      if (uniqueVals.size > 0 && uniqueVals.size <= 15) {
        const select = fieldWrap.createEl("select", { cls: "csv-add-select" });
        select.createEl("option", { text: "", value: "" });
        Array.from(uniqueVals).sort().forEach(v => select.createEl("option", { text: v, value: v }));
        select.createEl("option", { text: "+ Custom", value: "__custom__" });
        const customInput = fieldWrap.createEl("input", { cls: "csv-add-input csv-add-custom-input", type: "text", placeholder: "Enter custom value" });
        customInput.style.display = "none";
        select.addEventListener("change", () => {
          customInput.style.display = select.value === "__custom__" ? "block" : "none";
          if (select.value === "__custom__") customInput.focus();
        });
        inputs[h] = select;
        inputs[`${h}__custom`] = customInput as HTMLInputElement;
      } else {
        inputs[h] = fieldWrap.createEl("input", { cls: "csv-add-input", type: "text", placeholder: titleCase(h) });
      }
    });

    // Notes field last (if any)
    notesCols.forEach(h => {
      const fieldWrap = form.createDiv({ cls: "csv-add-field csv-add-notes-field" });
      fieldWrap.createEl("label", { text: titleCase(h), cls: "csv-add-label" });
      inputs[h] = fieldWrap.createEl("textarea", { cls: "csv-add-textarea", placeholder: "Optional notes..." }) as any;
    });

    // Submit button
    const submitBtn = form.createEl("button", { text: "Add Entry", cls: "csv-add-submit" });

    submitBtn.addEventListener("click", async () => {
      // Gather values
      const newRow: CSVRow = {};
      headers.forEach(h => {
        if (binaryCols.includes(h)) {
          newRow[h] = toggleStates[h] ? "1" : "0";
        } else if (inputs[h] instanceof HTMLSelectElement && (inputs[h] as HTMLSelectElement).value === "__custom__") {
          newRow[h] = (inputs[`${h}__custom`] as HTMLInputElement)?.value ?? "";
        } else if (inputs[h] instanceof HTMLTextAreaElement) {
          newRow[h] = (inputs[h] as HTMLTextAreaElement).value;
        } else {
          newRow[h] = (inputs[h] as HTMLInputElement)?.value ?? "";
        }
      });

      // Check if at least one field is filled (for non-habit trackers) or date is set (for habit trackers)
      const hasDate = dateCols.length > 0 && dateCols.some(h => (newRow[h] ?? "").trim());
      const hasOtherValue = [...otherCols, ...notesCols].some(h => (newRow[h] ?? "").trim());
      const hasToggle = binaryCols.some(h => toggleStates[h]);

      if (!hasDate && !hasOtherValue && !hasToggle) {
        new Notice("Please fill at least one field");
        return;
      }

      // Re-read file to get latest data (avoids stale data issues)
      let currentRows: CSVRow[] = [];
      try {
        if (isXlsx) {
          const buf = await this.app.vault.readBinary(file);
          const wb = XLSX.read(buf, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
          if (raw.length) {
            currentRows = raw.slice(1).map(r => {
              const row: CSVRow = {};
              headers.forEach((h, i) => { row[h] = String((r as string[])[i] ?? ""); });
              return row;
            });
          }
        } else {
          const text = await this.app.vault.read(file);
          const result = Papa.parse(text, { header: true, skipEmptyLines: true });
          currentRows = result.data as CSVRow[];
        }
      } catch (e) {
        new Notice(`Error reading file: ${e}`);
        return;
      }

      // Check for duplicate date entry (for habit trackers)
      let isUpdate = false;
      let existingRowIdx = -1;
      if (dateCols.length > 0) {
        const dateCol = dateCols[0];
        const dateVal = newRow[dateCol];
        existingRowIdx = currentRows.findIndex(r => r[dateCol] === dateVal);
        if (existingRowIdx >= 0) {
          // Update existing row - merge values (only update non-empty new values)
          isUpdate = true;
          const existingRow = currentRows[existingRowIdx];
          headers.forEach(h => {
            if (binaryCols.includes(h)) {
              // For binary cols, always use the new toggle state
              existingRow[h] = newRow[h];
            } else if ((newRow[h] ?? "").trim()) {
              // For other cols, only update if new value is non-empty
              existingRow[h] = newRow[h];
            }
          });
        } else {
          currentRows.push(newRow);
        }
      } else {
        currentRows.push(newRow);
      }

      // Use currentRows instead of stale rows
      const rows = currentRows;

      try {
        // Save to main file (XLSX or CSV)
        if (isXlsx) {
          const ws = XLSX.utils.json_to_sheet(rows.map(r => {
            const obj: Record<string, string> = {};
            headers.forEach(h => { obj[h] = r[h] ?? ""; });
            return obj;
          }), { header: headers });
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
          const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
          await this.app.vault.modifyBinary(file, buf);

          // Also update the CSV helper file for Dataview
          const csvFolder = file.parent?.path ?? "";
          const helperFolder = csvFolder ? `${csvFolder}/_csv_helpers` : "_csv_helpers";
          const csvPath = `${helperFolder}/${file.basename}.csv`;

          // Ensure helper folder exists and write CSV (use adapter for helper folder)
          if (!await this.app.vault.adapter.exists(helperFolder)) {
            await this.app.vault.adapter.mkdir(helperFolder);
          }
          const csvContent = Papa.unparse(rows, { columns: headers });
          await this.app.vault.adapter.write(csvPath, csvContent);
        } else {
          const csv = Papa.unparse(rows, { columns: headers });
          await this.app.vault.modify(file, csv);
        }

        new Notice(isUpdate ? `Updated entry for ${newRow[dateCols[0]] || ""}` : `Added entry to ${file.basename}`);

        // Clear form (but keep date for quick re-entry)
        binaryCols.forEach(h => {
          toggleStates[h] = false;
          const checkbox = inputs[h] as HTMLInputElement;
          if (checkbox) checkbox.checked = false;
        });
        [...otherCols, ...notesCols].forEach(h => {
          const input = inputs[h];
          if (input instanceof HTMLSelectElement) {
            input.selectedIndex = 0;
          } else if (input instanceof HTMLTextAreaElement) {
            input.value = "";
          } else if (input) {
            (input as HTMLInputElement).value = "";
          }
          const customInput = inputs[`${h}__custom`];
          if (customInput) {
            (customInput as HTMLInputElement).value = "";
            (customInput as HTMLInputElement).style.display = "none";
          }
        });
        // Update toggle visual state
        form.querySelectorAll(".csv-add-toggle").forEach(t => t.classList.remove("checked"));

        // Auto-refresh: reopen the note to force Dataview to re-read CSV
        setTimeout(async () => {
          const noteFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
          if (noteFile instanceof TFile) {
            const leaf = this.app.workspace.activeLeaf;
            if (leaf) {
              await leaf.openFile(noteFile, { state: { mode: "preview" } });
            }
          }
        }, 300);
      } catch (e) {
        new Notice(`Error saving: ${e}`);
      }
    });
  }

  async loadSettings(): Promise<void> { this.settings=Object.assign({},DEFAULT_SETTINGS,await this.loadData()); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
