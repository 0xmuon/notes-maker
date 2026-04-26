import {
  DEFAULT_SETTINGS,
  type Highlight,
  type Notebook,
  type NotebookGroup,
  type PageEntry,
  type Settings
} from "./types";

const PAGES_KEY = "notes-maker:pages";
const SETTINGS_KEY = "notes-maker:settings";
const NOTEBOOKS_KEY = "notes-maker:notebooks";
const ACTIVE_NOTEBOOK_KEY = "notes-maker:activeNotebookId";

/**
 * Stable key for a page. We strip hash and trailing slash so that the
 * same article reloaded with `#section` still maps to the same notebook.
 */
export function pageKeyForUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return rawUrl;
  }
}

export function domainOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

type PagesMap = Record<string, PageEntry>;

async function readPages(): Promise<PagesMap> {
  const out = await chrome.storage.local.get(PAGES_KEY);
  return (out[PAGES_KEY] as PagesMap | undefined) ?? {};
}

async function writePages(pages: PagesMap): Promise<void> {
  await chrome.storage.local.set({ [PAGES_KEY]: pages });
}

export async function getAllPages(): Promise<PageEntry[]> {
  const pages = await readPages();
  return Object.values(pages).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getPage(pageKey: string): Promise<PageEntry | null> {
  const pages = await readPages();
  return pages[pageKey] ?? null;
}

export async function upsertHighlight(h: Highlight): Promise<PageEntry> {
  const pages = await readPages();
  const now = Date.now();
  const existing = pages[h.pageKey];
  if (existing) {
    const idx = existing.highlights.findIndex((x) => x.id === h.id);
    if (idx >= 0) {
      existing.highlights[idx] = { ...h, updatedAt: now };
    } else {
      existing.highlights.push({ ...h, updatedAt: now });
    }
    existing.title = h.pageTitle || existing.title;
    existing.url = h.url || existing.url;
    existing.updatedAt = now;
    pages[h.pageKey] = existing;
  } else {
    pages[h.pageKey] = {
      key: h.pageKey,
      url: h.url,
      title: h.pageTitle,
      domain: h.domain,
      highlights: [{ ...h, updatedAt: now }],
      createdAt: now,
      updatedAt: now
    };
  }
  await writePages(pages);
  return pages[h.pageKey];
}

export async function deleteHighlight(
  pageKey: string,
  id: string
): Promise<PageEntry | null> {
  const pages = await readPages();
  const page = pages[pageKey];
  if (!page) return null;
  page.highlights = page.highlights
    .filter((h) => h.id !== id)
    .map((h) => (h.parentId === id ? { ...h, parentId: null } : h));
  page.updatedAt = Date.now();
  if (page.highlights.length === 0) {
    delete pages[pageKey];
    await writePages(pages);
    return null;
  }
  pages[pageKey] = page;
  await writePages(pages);
  return page;
}

export async function updateHighlight(
  pageKey: string,
  id: string,
  patch: Partial<Highlight>
): Promise<PageEntry | null> {
  const pages = await readPages();
  const page = pages[pageKey];
  if (!page) return null;
  const idx = page.highlights.findIndex((h) => h.id === id);
  if (idx < 0) return page;
  page.highlights[idx] = {
    ...page.highlights[idx],
    ...patch,
    updatedAt: Date.now()
  };
  page.updatedAt = Date.now();
  pages[pageKey] = page;
  await writePages(pages);
  return page;
}

export async function deletePage(pageKey: string): Promise<void> {
  const pages = await readPages();
  delete pages[pageKey];
  await writePages(pages);
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.remove(PAGES_KEY);
}

export async function getSettings(): Promise<Settings> {
  const out = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(out[SETTINGS_KEY] ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function makeId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

/* -------------------------------------------------------------- */
/*  Notebooks                                                      */
/* -------------------------------------------------------------- */

type NotebooksMap = Record<string, Notebook>;

async function readNotebooks(): Promise<NotebooksMap> {
  const out = await chrome.storage.local.get(NOTEBOOKS_KEY);
  return (out[NOTEBOOKS_KEY] as NotebooksMap | undefined) ?? {};
}

async function writeNotebooks(map: NotebooksMap): Promise<void> {
  await chrome.storage.local.set({ [NOTEBOOKS_KEY]: map });
}

export async function listNotebooks(): Promise<Notebook[]> {
  const map = await readNotebooks();
  return Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNotebook(id: string): Promise<Notebook | null> {
  const map = await readNotebooks();
  return map[id] ?? null;
}

export async function createNotebook(
  name: string,
  description = ""
): Promise<Notebook> {
  const map = await readNotebooks();
  const trimmed = name.trim() || "Untitled notebook";
  const now = Date.now();
  const id = makeId();
  const nb: Notebook = {
    id,
    name: trimmed,
    description,
    createdAt: now,
    updatedAt: now
  };
  map[id] = nb;
  await writeNotebooks(map);
  return nb;
}

export async function renameNotebook(
  id: string,
  name: string
): Promise<Notebook | null> {
  const map = await readNotebooks();
  const nb = map[id];
  if (!nb) return null;
  nb.name = name.trim() || nb.name;
  nb.updatedAt = Date.now();
  map[id] = nb;
  await writeNotebooks(map);
  return nb;
}

/**
 * Delete a notebook. By default highlights inside it are kept and just
 * un-tagged (notebookId set to null). If `deleteHighlights` is true, the
 * highlights themselves are removed.
 */
export async function deleteNotebook(
  id: string,
  deleteHighlights = false
): Promise<void> {
  const nbMap = await readNotebooks();
  if (!nbMap[id]) return;
  delete nbMap[id];
  await writeNotebooks(nbMap);

  const pages = await readPages();
  let dirty = false;
  for (const key of Object.keys(pages)) {
    const page = pages[key];
    const before = page.highlights.length;
    if (deleteHighlights) {
      page.highlights = page.highlights.filter((h) => h.notebookId !== id);
    } else {
      page.highlights = page.highlights.map((h) =>
        h.notebookId === id ? { ...h, notebookId: null } : h
      );
    }
    if (page.highlights.length !== before) {
      page.updatedAt = Date.now();
    }
    if (page.highlights.length === 0) {
      delete pages[key];
      dirty = true;
    } else {
      pages[key] = page;
      dirty = true;
    }
  }
  if (dirty) await writePages(pages);

  const active = await getActiveNotebookId();
  if (active === id) await setActiveNotebookId(null);
}

export async function getActiveNotebookId(): Promise<string | null> {
  const out = await chrome.storage.local.get(ACTIVE_NOTEBOOK_KEY);
  return (out[ACTIVE_NOTEBOOK_KEY] as string | null | undefined) ?? null;
}

export async function setActiveNotebookId(id: string | null): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove(ACTIVE_NOTEBOOK_KEY);
  } else {
    await chrome.storage.local.set({ [ACTIVE_NOTEBOOK_KEY]: id });
  }
}

export async function moveHighlightToNotebook(
  pageKey: string,
  id: string,
  notebookId: string | null
): Promise<void> {
  await updateHighlight(pageKey, id, { notebookId });

  if (notebookId) {
    const map = await readNotebooks();
    const nb = map[notebookId];
    if (nb) {
      nb.updatedAt = Date.now();
      map[notebookId] = nb;
      await writeNotebooks(map);
    }
  }
}

/**
 * Collect every highlight tagged with `notebookId`, grouped by their
 * source page. Pages with no matching highlights are omitted. Pages are
 * ordered by the time their first highlight in this notebook was captured.
 */
export async function getNotebookGroups(
  notebookId: string
): Promise<NotebookGroup[]> {
  const pages = await readPages();
  const groups: NotebookGroup[] = [];
  for (const page of Object.values(pages)) {
    const matches = page.highlights.filter(
      (h) => h.notebookId === notebookId
    );
    if (matches.length === 0) continue;
    matches.sort((a, b) => a.createdAt - b.createdAt);
    groups.push({ page, highlights: matches });
  }
  groups.sort((a, b) => {
    const aFirst = a.highlights[0]?.createdAt ?? 0;
    const bFirst = b.highlights[0]?.createdAt ?? 0;
    return aFirst - bFirst;
  });
  return groups;
}

/**
 * For each notebook, count the number of highlights and source pages.
 * Useful for the library overview without loading every highlight body.
 */
export async function notebookStats(): Promise<
  Record<string, { highlights: number; pages: number; lastCapturedAt: number }>
> {
  const pages = await readPages();
  const stats: Record<
    string,
    { highlights: number; pages: number; lastCapturedAt: number }
  > = {};
  for (const page of Object.values(pages)) {
    const seen = new Set<string>();
    for (const h of page.highlights) {
      if (!h.notebookId) continue;
      if (!stats[h.notebookId]) {
        stats[h.notebookId] = {
          highlights: 0,
          pages: 0,
          lastCapturedAt: 0
        };
      }
      stats[h.notebookId].highlights++;
      stats[h.notebookId].lastCapturedAt = Math.max(
        stats[h.notebookId].lastCapturedAt,
        h.createdAt
      );
      seen.add(h.notebookId);
    }
    for (const id of seen) stats[id].pages++;
  }
  return stats;
}
