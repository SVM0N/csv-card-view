---
projectFilter: ""
nameFilter: ""
obsidianUIMode: preview
---

```meta-bind-button
label: Sync to Anki
id: anki-sync
style: default
action:
  type: templaterCreateNote
  templateFile: Settings/Templates/anki-sync.md
  folderPath: /
  openNote: false
```
```meta-bind-button
label: New Index
id: new-index
style: default
action:
  type: templaterCreateNote
  templateFile: Settings/Templates/new-index.md
  folderPath: /
  openNote: false
```

`BUTTON[new-task]`

`BUTTON[new-note]`

`BUTTON[new-idea]`

`BUTTON[new-reference]`
```meta-bind-button
label: New Task
id: new-task
style: default
hidden: true
action:
  type: templaterCreateNote
  templateFile: Settings/Templates/task-template.md
  folderPath: /
  openNote: true
```
```meta-bind-button
label: New Note
id: new-note
style: default
hidden: true
action:
  type: templaterCreateNote
  templateFile: Settings/Templates/note-template.md
  folderPath: /
  openNote: true
```
```meta-bind-button
label: New Idea
id: new-idea
style: default
hidden: true
action:
  type: templaterCreateNote
  templateFile: Settings/Templates/idea-template.md
  folderPath: /
  openNote: true
```
```meta-bind-button
label: New Reference
id: new-reference
style: default
hidden: true
action:
  type: templaterCreateNote
  templateFile: Settings/Templates/reference-template.md
  folderPath: /
  openNote: true
```
---
`INPUT[text(placeholder(filter by tag e.g. work/textile)):projectFilter]` `INPUT[text(placeholder(search by name...)):nameFilter]`

```dataviewjs
const filter = (dv.current().projectFilter || "").trim().toLowerCase();
const hasFilter = filter.length > 0;
const nameFilter = (dv.current().nameFilter || "").trim().toLowerCase();

function getTags(p) {
  if (!p.tags) return [];
  return Array.from(p.tags);
}

function getProject(tags) {
  const t = tags.find(t =>
    t.endsWith("/task") || t.endsWith("/note") || t.endsWith("/idea") || t.endsWith("/reference")
  );
  if (!t) return "other";
  return t.split("/").slice(0, -1).join("/");
}

function getType(tags) {
  const t = tags.find(t =>
    t.endsWith("/task") || t.endsWith("/note") || t.endsWith("/idea") || t.endsWith("/reference")
  );
  return t ? t.split("/").pop() : "—";
}

const allPages = dv.pages('""')
  .where(function(p) {
    const tags = getTags(p);
    if (!tags.length) return false;
    const isStructured = tags.some(t =>
      t.endsWith("/task") || t.endsWith("/note") || t.endsWith("/idea") || t.endsWith("/reference")
    );
    if (!isStructured) return false;
    if (hasFilter && !tags.some(t => t.toLowerCase().startsWith(filter))) return false;
    if (nameFilter && !p.file.name.toLowerCase().includes(nameFilter)) return false;
    return true;
  })
  .array();

if (allPages.length === 0) {
  dv.paragraph(hasFilter ? "No results for `" + filter + "`." : "No notes yet.");
} else {
  const priorityOrder = {"high": 0, "medium": 1, "low": 2};

  // Add styles
  const style = document.createElement("style");
  style.textContent = `
    .dash-section { margin-bottom: 24px; }
    .dash-section details { margin-bottom: 8px; }
    .dash-section summary {
      list-style: none;
      cursor: pointer;
      padding: 4px 0;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--color-text-tertiary);
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      border-bottom: 0.5px solid var(--color-border-tertiary);
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .dash-section summary::-webkit-details-marker { display: none; }
    .dash-section summary .arr { font-size: 9px; transition: transform 0.15s; display: inline-block; }
    .dash-section details[open] summary .arr { transform: rotate(90deg); }
    .dash-section summary .cnt { opacity: 0.5; font-weight: 400; }
    .dash-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 4px; }
    .dash-table th { text-align: left; font-weight: 500; font-size: 11px; color: var(--color-text-tertiary); padding: 6px 12px; border-bottom: 0.5px solid var(--color-border-tertiary); }
    .dash-table td { padding: 8px 12px; border-bottom: 0.5px solid var(--color-border-tertiary); color: var(--color-text-secondary); vertical-align: top; }
    .dash-table tr:last-child td { border-bottom: none; }
    .dash-link { color: var(--color-text-accent); cursor: pointer; }
    .dash-link:hover { text-decoration: underline; }
    .dash-done { text-decoration: line-through; opacity: 0.4; }
    .dash-section-header { font-size: 13px; font-weight: 600; color: var(--color-text-primary); margin: 20px 0 12px; letter-spacing: 0; border: none; text-transform: none; padding: 0; }
  `;
  this.container.appendChild(style);

  const wrap = document.createElement("div");

  // Group pages by project
  const tasksByProject = {};
  const notesByProject = {};

  allPages.forEach(p => {
    const tags = getTags(p);
    const isTask = tags.some(t => t.endsWith("/task"));
    const project = getProject(tags);
    if (isTask) {
      if (!tasksByProject[project]) tasksByProject[project] = [];
      tasksByProject[project].push(p);
    } else {
      if (!notesByProject[project]) notesByProject[project] = [];
      notesByProject[project].push(p);
    }
  });

  const makeTable = (pages, isTask) => {
    const table = document.createElement("table");
    table.className = "dash-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const cols = isTask ? ["Name", "Due", "Priority"] : ["Modified", "Name"];
    cols.forEach(c => {
      const th = document.createElement("th");
      th.textContent = c;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    const sorted = isTask
      ? pages.sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;
          return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
        })
      : pages.sort((a, b) => b.file.mtime - a.file.mtime);

    sorted.forEach(p => {
      const tr = document.createElement("tr");
      const nameCell = document.createElement("td");
      const link = document.createElement("span");
      link.className = "dash-link" + (p.done ? " dash-done" : "");
      link.textContent = p.file.name;
      link.addEventListener("click", () => app.workspace.openLinkText(p.file.path, "", false));
      nameCell.appendChild(link);
      tr.appendChild(nameCell);

      if (isTask) {
        const dueCell = document.createElement("td");
        dueCell.textContent = p.due ? String(p.due).slice(0, 10) : "—";
        const priCell = document.createElement("td");
        priCell.textContent = p.priority || "—";
        tr.appendChild(dueCell);
        tr.appendChild(priCell);
      } else {
        const dateCell = document.createElement("td");
        const mtime = p.file.mtime;
        dateCell.textContent = mtime ? mtime.toFormat("yyyy-MM-dd") : "—";
        dateCell.style.cssText = "color: var(--color-text-tertiary); font-size: 12px; white-space: nowrap; width: 90px;";
        tr.insertBefore(dateCell, tr.firstChild);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  };

  const makeSection = (byProject, isTask, title) => {
    if (Object.keys(byProject).length === 0) return;
    const header = document.createElement("div");
    header.className = "dash-section-header";
    header.textContent = title;
    wrap.appendChild(header);

    const section = document.createElement("div");
    section.className = "dash-section";

    const projects = Object.keys(byProject).sort();
    projects.forEach(project => {
      const items = byProject[project];
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      summary.innerHTML = `<span class="arr">▶</span> ${project} <span class="cnt">${items.length}</span>`;
      details.appendChild(summary);
      details.appendChild(makeTable(items, isTask));
      section.appendChild(details);
    });

    wrap.appendChild(section);
  };

  makeSection(tasksByProject, true, "Tasks");
  makeSection(notesByProject, false, "Notes & Ideas");

  this.container.appendChild(wrap);
}
```

