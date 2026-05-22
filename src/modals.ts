import {
  App,
  Modal,
  Component,
  MarkdownRenderer,
  Notice,
} from "obsidian";
import { CSVRow, FileConfig, ViewMode } from "./types";
import { showSelectPicker } from "./utils";

// ─── Add Entry Modal ──────────────────────────────────────────────────────────

export class AddEntryModal extends Modal {
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

export class NoteExpanderModal extends Modal {
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

export class FileConfigModal extends Modal {
  headers: string[];
  filePath: string;
  current: FileConfig;
  autoDetectedHabits: string[];
  onSave: (cfg: FileConfig) => void;

  constructor(app: App, headers: string[], filePath: string, current: FileConfig, autoDetectedHabits: string[], onSave: (cfg: FileConfig) => void) {
    super(app);
    this.headers = headers;
    this.filePath = filePath;
    this.current = { ...current, habitColumns: current.habitColumns ? [...current.habitColumns] : undefined };
    this.autoDetectedHabits = autoDetectedHabits;
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

    // Habit columns (multi-select with checkboxes)
    const habitRow = form.createDiv({ cls: "csv-modal-row" });
    habitRow.createEl("label", { text: "Habit columns (dashboard)", cls: "csv-modal-label" });
    const habitDesc = habitRow.createEl("p", { cls: "csv-modal-hint", text: "Select columns to track as habits. Auto-detected columns with binary values (0/1) are pre-selected." });
    const habitGrid = habitRow.createDiv({ cls: "csv-modal-checkbox-grid" });

    // Determine which columns are selected (use config if set, else auto-detected)
    const selectedHabits = new Set(this.current.habitColumns ?? this.autoDetectedHabits);

    this.headers.forEach(h => {
      const label = habitGrid.createEl("label", { cls: "csv-modal-checkbox-label" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = selectedHabits.has(h);
      if (this.autoDetectedHabits.includes(h) && !this.current.habitColumns) {
        label.addClass("auto-detected");
      }
      label.createSpan({ text: h });

      checkbox.addEventListener("change", () => {
        if (!this.current.habitColumns) {
          this.current.habitColumns = [...this.autoDetectedHabits];
        }
        if (checkbox.checked) {
          if (!this.current.habitColumns.includes(h)) {
            this.current.habitColumns.push(h);
          }
        } else {
          this.current.habitColumns = this.current.habitColumns.filter(c => c !== h);
        }
      });
    });

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
