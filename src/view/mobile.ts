// Mobile dashboard generation. Writes a Mobile/<file>.md dashboard (DataviewJS
// over the canonical CSV) next to the data file. Extracted from CardView;
// reached members are public. Type-only CardView import → no runtime cycle.

import { Notice, TFile } from "obsidian";
import type { CardView } from "../../main";
import { titleCase } from "../utils";
// .mjs on purpose — the same module is imported directly by node in
// regenerate-mobile-dashboards.mjs, so the templates have one source.
import {
  generateHabitMobileDashboard as habitMobileTemplate,
  generateLibraryMobileDashboard as libraryMobileTemplate,
  generateGenericMobileDashboard as genericMobileTemplate,
} from "../mobile-templates.mjs";

export async function generateMobileFiles(view: CardView): Promise<void> {
  if (!view.file) return;

  const csvFolder = view.file.parent?.path ?? "";
  // Dashboards live in a Mobile/ subfolder to keep the main folder uncluttered.
  const mobileFolder = csvFolder ? `${csvFolder}/Mobile` : "Mobile";
  if (!await view.app.vault.adapter.exists(mobileFolder)) {
    await view.app.vault.adapter.mkdir(mobileFolder);
  }
  const dashboardPath = `${mobileFolder}/${view.file.basename}.md`;

  // Single canonical CSV path — both csv-add (write) and dataviewjs (read)
  // point at the same file. (Pre-migration the read path went through a
  // _csv_helpers/ mirror because the source was xlsx; that's gone now.)
  const csvPath = view.file.path;

  // Determine file type (habit tracker vs library)
  const dateCol = view.getDateCol();
  const categoryCol = view.getCategoryCol();
  // Note-relative path so `csv-add file:` still resolves if the parent
  // folder is moved or renamed (the dashboard lives one folder deeper
  // than the data file, under Mobile/).
  const filePath = "../" + view.file.name;

  let dashboardContent: string;

  if (dateCol) {
    // Habit tracker - use Dataview to query CSV
    const habitCols = view.getBooleanColumns();
    dashboardContent = habitMobileTemplate({
      filePath,
      csvPath,
      habitCols,
      // Labels are computed here (not in the template) so the template
      // module stays dependency-free for the node regen script.
      labels: habitCols.map(titleCase),
      dateCol,
    });
  } else if (categoryCol) {
    // Library (books, movies) - cards grouped by category.
    // titleKey falls back through Quote/Headline/Phrase for files like
    // quotes/dictionary that have no Title/Name column.
    const titleKey = view.titleKey()
      ?? view.resolveCol(["Quote", "quote", "Headline", "headline", "Phrase", "phrase"])
      ?? view.headers[0]
      ?? "Title";
    dashboardContent = libraryMobileTemplate({
      filePath,
      csvPath,
      titleKey,
      categoryCol,
      statusCol: view.getStatusCol() ?? "Status",
      authorKey: view.authorKey() ?? "",
      yearCol: view.resolveCol(["Year", "year", "Released", "released"]) ?? "",
      ratingCol: view.resolveCol(["Rating", "rating", "Score", "score", "Stars", "stars"]) ?? "",
      themeCol: view.resolveCol(["Theme", "theme", "Subgenre", "subgenre", "Mood", "mood"]) ?? "",
      // 2-col grid when the title is a short label (book/movie name); 1-col
      // when titleKey fell back to Quote/Headline (long sentences).
      compactGrid: view.titleKey() !== null,
    });
  } else {
    // Generic - scrollable table over all headers
    dashboardContent = genericMobileTemplate({
      filePath,
      csvPath,
      headers: view.headers,
    });
  }

  try {
    const existingDashboard = view.app.vault.getAbstractFileByPath(dashboardPath);
    if (existingDashboard && existingDashboard instanceof TFile) {
      await view.app.vault.modify(existingDashboard, dashboardContent);
      new Notice(`Updated: ${dashboardPath}`);
    } else {
      await view.app.vault.create(dashboardPath, dashboardContent);
      new Notice(`Created: ${dashboardPath}`);
    }
  } catch {
    // File exists but wasn't found - try modify
    const f = view.app.vault.getAbstractFileByPath(dashboardPath);
    if (f instanceof TFile) {
      await view.app.vault.modify(f, dashboardContent);
      new Notice(`Updated: ${dashboardPath}`);
    }
  }
}
