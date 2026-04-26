import { useCallback, useEffect, useMemo, useState } from "react";

import "./style.css";

import {
  formatDate,
  libraryToMarkdown,
  notebookToMarkdown,
  pageToMarkdown
} from "~lib/markdown";
import { sendMessage } from "~lib/messages";
import { pageKeyForUrl } from "~lib/storage";
import {
  COLOR_HEX,
  HIGHLIGHT_COLORS,
  type Highlight,
  type HighlightColor,
  type Notebook,
  type NotebookGroup,
  type PageEntry
} from "~lib/types";

type Tab = "page" | "notebooks" | "library" | "settings";

export default function SidePanel() {
  const [tab, setTab] = useState<Tab>("page");
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [activeTitle, setActiveTitle] = useState<string>("");
  const [page, setPage] = useState<PageEntry | null>(null);
  const [allPages, setAllPages] = useState<PageEntry[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebook, setActiveNotebook] = useState<Notebook | null>(null);
  const [query, setQuery] = useState<string>("");
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [openNotebookId, setOpenNotebookId] = useState<string | null>(null);

  const refreshActiveTab = useCallback(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (t?.url) {
      setActiveUrl(t.url);
      setActiveTitle(t.title || "");
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const r = await sendMessage({ type: "get-all-pages" });
    if ("pages" in r) setAllPages(r.pages);
  }, []);

  const refreshPage = useCallback(async () => {
    if (!activeUrl) return;
    const r = await sendMessage({
      type: "get-page",
      payload: { pageKey: pageKeyForUrl(activeUrl) }
    });
    if ("page" in r) setPage(r.page);
  }, [activeUrl]);

  const refreshNotebooks = useCallback(async () => {
    const r = await sendMessage({ type: "list-notebooks" });
    if ("notebooks" in r) setNotebooks(r.notebooks);
    const a = await sendMessage({ type: "get-active-notebook" });
    if ("notebook" in a) setActiveNotebook(a.notebook);
  }, []);

  useEffect(() => {
    refreshActiveTab();
    refreshAll();
    refreshNotebooks();
    const onTab = () => refreshActiveTab();
    chrome.tabs.onActivated.addListener(onTab);
    chrome.tabs.onUpdated.addListener(onTab);
    return () => {
      chrome.tabs.onActivated.removeListener(onTab);
      chrome.tabs.onUpdated.removeListener(onTab);
    };
  }, [refreshActiveTab, refreshAll, refreshNotebooks]);

  useEffect(() => {
    refreshPage();
  }, [activeUrl, refreshPage]);

  useEffect(() => {
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes["notes-maker:pages"]) {
        refreshPage();
        refreshAll();
      }
      if (
        changes["notes-maker:notebooks"] ||
        changes["notes-maker:activeNotebookId"]
      ) {
        refreshNotebooks();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refreshPage, refreshAll, refreshNotebooks]);

  const totalHighlights = useMemo(
    () => allPages.reduce((n, p) => n + p.highlights.length, 0),
    [allPages]
  );

  return (
    <div className="flex h-screen w-full flex-col bg-white text-ink-900 dark:bg-ink-900 dark:text-ink-50 font-sans">
      <Header
        tab={tab}
        onChangeTab={(t) => {
          setTab(t);
          if (t !== "notebooks") setOpenNotebookId(null);
        }}
        pageCount={allPages.length}
        highlightCount={totalHighlights}
      />

      <DestinationBanner
        notebooks={notebooks}
        active={activeNotebook}
        onPick={async (id) => {
          await sendMessage({
            type: "set-active-notebook",
            payload: { id }
          });
        }}
        onCreate={async (name) => {
          const r = await sendMessage({
            type: "create-notebook",
            payload: { name }
          });
          if ("notebook" in r && r.notebook) {
            await sendMessage({
              type: "set-active-notebook",
              payload: { id: r.notebook.id }
            });
          }
        }}
        onManage={() => {
          setTab("notebooks");
          setOpenNotebookId(null);
        }}
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {tab === "page" && (
          <CurrentPagePanel
            page={page}
            activeUrl={activeUrl}
            activeTitle={activeTitle}
            notebooks={notebooks}
            activeNotebook={activeNotebook}
            showPreview={showPreview}
            onTogglePreview={() => setShowPreview((v) => !v)}
          />
        )}
        {tab === "notebooks" &&
          (openNotebookId ? (
            <NotebookDetailPanel
              id={openNotebookId}
              notebooks={notebooks}
              onBack={() => setOpenNotebookId(null)}
            />
          ) : (
            <NotebooksPanel
              notebooks={notebooks}
              activeNotebookId={activeNotebook?.id ?? null}
              onOpen={(id) => setOpenNotebookId(id)}
            />
          ))}
        {tab === "library" && (
          <LibraryPanel
            pages={allPages}
            notebooks={notebooks}
            query={query}
            onQuery={setQuery}
          />
        )}
        {tab === "settings" && <SettingsPanel pages={allPages} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                              */
/* ------------------------------------------------------------------ */

function Header({
  tab,
  onChangeTab,
  pageCount,
  highlightCount
}: {
  tab: Tab;
  onChangeTab: (t: Tab) => void;
  pageCount: number;
  highlightCount: number;
}) {
  const cls = (active: boolean) =>
    `px-2.5 py-1 text-[11px] rounded-full transition-colors ${
      active
        ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900"
        : "text-ink-500 hover:text-ink-800 dark:hover:text-ink-100"
    }`;

  return (
    <header className="border-b border-ink-100 dark:border-ink-800 px-4 py-3 flex items-center justify-between gap-2">
      <div>
        <div className="text-sm font-semibold tracking-tight">Notes Maker</div>
        <div className="text-[11px] text-ink-500">
          {pageCount} page{pageCount === 1 ? "" : "s"} · {highlightCount}{" "}
          highlight{highlightCount === 1 ? "" : "s"}
        </div>
      </div>
      <nav className="flex items-center gap-1">
        <button onClick={() => onChangeTab("page")} className={cls(tab === "page")}>
          Page
        </button>
        <button
          onClick={() => onChangeTab("notebooks")}
          className={cls(tab === "notebooks")}>
          Notebooks
        </button>
        <button
          onClick={() => onChangeTab("library")}
          className={cls(tab === "library")}>
          Library
        </button>
        <button
          onClick={() => onChangeTab("settings")}
          className={cls(tab === "settings")}>
          ⋯
        </button>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Destination banner — picks where new highlights go                 */
/* ------------------------------------------------------------------ */

function DestinationBanner({
  notebooks,
  active,
  onPick,
  onCreate,
  onManage
}: {
  notebooks: Notebook[];
  active: Notebook | null;
  onPick: (id: string | null) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName("");
    setCreating(false);
    setOpen(false);
  };

  const isActive = !!active;

  return (
    <div
      className={`relative border-b border-ink-100 dark:border-ink-800 px-4 py-2.5 ${
        isActive
          ? "bg-amber-50 dark:bg-amber-900/15"
          : "bg-ink-50/50 dark:bg-ink-800/40"
      }`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            isActive ? "bg-amber-500" : "bg-ink-300 dark:bg-ink-600"
          }`}
        />
        <span className="text-[11px] text-ink-500 uppercase tracking-wider">
          Saving to
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center justify-between gap-2 px-2.5 py-1 text-[12px] rounded-md border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 hover:border-ink-300 dark:hover:border-ink-600">
          <span className="truncate text-left">
            {active ? (
              <>
                <span className="font-medium">{active.name}</span>{" "}
                <span className="text-ink-400">notebook</span>
              </>
            ) : (
              <>
                <span className="font-medium">Per page</span>{" "}
                <span className="text-ink-400">
                  · each page exports separately
                </span>
              </>
            )}
          </span>
          <span className="text-ink-400">▾</span>
        </button>
      </div>

      {open && (
        <div
          className="absolute left-4 right-4 top-full mt-1 z-30 rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg overflow-hidden"
          role="menu">
          <button
            onClick={async () => {
              await onPick(null);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-ink-50 dark:hover:bg-ink-800 flex items-center justify-between ${
              !active ? "bg-ink-50 dark:bg-ink-800" : ""
            }`}>
            <div>
              <div className="font-medium">Per page</div>
              <div className="text-[11px] text-ink-500">
                Each page becomes its own .md
              </div>
            </div>
            {!active && <span className="text-[11px]">✓</span>}
          </button>

          {notebooks.length > 0 && (
            <div className="border-t border-ink-100 dark:border-ink-800 py-1">
              {notebooks.map((nb) => (
                <button
                  key={nb.id}
                  onClick={async () => {
                    await onPick(nb.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-[12px] hover:bg-ink-50 dark:hover:bg-ink-800 flex items-center justify-between ${
                    active?.id === nb.id ? "bg-ink-50 dark:bg-ink-800" : ""
                  }`}>
                  <div className="truncate">
                    <span className="font-medium">{nb.name}</span>
                  </div>
                  {active?.id === nb.id && (
                    <span className="text-[11px]">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-ink-100 dark:border-ink-800 p-2">
            {creating ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setName("");
                    }
                  }}
                  placeholder="Notebook name (e.g. Fuzzing research)"
                  className="flex-1 text-[12px] px-2 py-1 border border-ink-200 dark:border-ink-700 rounded-md bg-white dark:bg-ink-900 focus:outline-none focus:ring-1 focus:ring-amber-300"
                />
                <button
                  onClick={submit}
                  className="text-[11px] px-2 py-1 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900">
                  Create
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setCreating(true)}
                  className="text-[12px] text-ink-700 dark:text-ink-200 hover:text-ink-900 dark:hover:text-white">
                  + New notebook
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    onManage();
                  }}
                  className="text-[11px] text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
                  Manage →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Current page panel                                                  */
/* ------------------------------------------------------------------ */

function CurrentPagePanel({
  page,
  activeUrl,
  activeTitle,
  notebooks,
  activeNotebook,
  showPreview,
  onTogglePreview
}: {
  page: PageEntry | null;
  activeUrl: string;
  activeTitle: string;
  notebooks: Notebook[];
  activeNotebook: Notebook | null;
  showPreview: boolean;
  onTogglePreview: () => void;
}) {
  const previewMd = useMemo(() => (page ? pageToMarkdown(page) : ""), [page]);

  if (!page || page.highlights.length === 0) {
    return (
      <EmptyState
        title={activeTitle || activeUrl || "No page selected"}
        url={activeUrl}
        activeNotebook={activeNotebook}
      />
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="rounded-lg border border-ink-100 dark:border-ink-800 p-3">
        <div className="text-sm font-medium line-clamp-2">{page.title}</div>
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-ink-500 hover:text-ink-800 dark:hover:text-ink-200 break-all">
          {page.url}
        </a>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button
            onClick={() =>
              sendMessage({
                type: "export-page",
                payload: { pageKey: page.key }
              })
            }
            className="text-xs px-2.5 py-1.5 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900 hover:opacity-90">
            Download this page .md
          </button>
          <button
            onClick={onTogglePreview}
            className="text-xs px-2.5 py-1.5 rounded-md border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800">
            {showPreview ? "Hide preview" : "Preview .md"}
          </button>
          <span className="text-[11px] text-ink-500 ml-auto">
            {page.highlights.length} saved
          </span>
        </div>
      </div>

      {showPreview && (
        <pre className="rounded-lg border border-ink-100 dark:border-ink-800 bg-ink-50 dark:bg-ink-800 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-72 overflow-auto scrollbar-thin">
          {previewMd}
        </pre>
      )}

      <ul className="space-y-2">
        {[...page.highlights]
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((h) => (
            <HighlightCard
              key={h.id}
              h={h}
              notebooks={notebooks}
              pageHighlights={page.highlights}
            />
          ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Highlight card                                                      */
/* ------------------------------------------------------------------ */

function HighlightCard({
  h,
  notebooks,
  pageHighlights,
  hideNotebookChip
}: {
  h: Highlight;
  notebooks: Notebook[];
  pageHighlights?: Highlight[];
  hideNotebookChip?: boolean;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(h.note ?? "");
  const [movingOpen, setMovingOpen] = useState(false);

  useEffect(() => setNote(h.note ?? ""), [h.note]);

  const onPickColor = (c: HighlightColor) => {
    sendMessage({
      type: "update-highlight",
      payload: { pageKey: h.pageKey, id: h.id, patch: { color: c } }
    });
  };

  const onSaveNote = () => {
    sendMessage({
      type: "update-highlight",
      payload: { pageKey: h.pageKey, id: h.id, patch: { note } }
    });
    setEditingNote(false);
  };

  const onDelete = () => {
    sendMessage({
      type: "delete-highlight",
      payload: { pageKey: h.pageKey, id: h.id }
    });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(h.markdown || h.text);
    } catch {
      /* ignore */
    }
  };

  const onMove = async (notebookId: string | null) => {
    await sendMessage({
      type: "move-highlight",
      payload: { pageKey: h.pageKey, id: h.id, notebookId }
    });
    setMovingOpen(false);
  };

  const notebookName = notebooks.find((nb) => nb.id === h.notebookId)?.name;
  const parent = h.parentId
    ? pageHighlights?.find((x) => x.id === h.parentId)
    : null;
  const parentSnippet = parent
    ? parent.text.length > 70
      ? parent.text.slice(0, 70).replace(/\s+/g, " ").trim() + "…"
      : parent.text.replace(/\s+/g, " ").trim()
    : null;

  return (
    <li
      className="rounded-lg border border-ink-100 dark:border-ink-800 p-3 hover:border-ink-200 dark:hover:border-ink-700 transition-colors"
      style={{
        boxShadow: `inset 4px 0 0 0 ${COLOR_HEX[h.color]}`
      }}>
      {(!!parentSnippet || (!hideNotebookChip && notebookName)) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {!hideNotebookChip && notebookName && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {notebookName}
            </span>
          )}
          {parentSnippet && (
            <span
              title={`Sub-part of: "${parent?.text ?? ""}"`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200 max-w-full">
              <span aria-hidden>↳</span>
              <span className="truncate max-w-[180px]">part of "{parentSnippet}"</span>
            </span>
          )}
        </div>
      )}

      {h.headingPath.length > 0 && (
        <div className="text-[11px] text-ink-500 mb-1 truncate">
          {h.headingPath.join(" › ")}
        </div>
      )}
      <blockquote className="text-[13px] leading-relaxed border-l-2 border-ink-200 dark:border-ink-700 pl-2 whitespace-pre-wrap">
        {h.text}
      </blockquote>

      {(editingNote || h.note) && (
        <div className="mt-2">
          {editingNote ? (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={onSaveNote}
              autoFocus
              placeholder="Add a note…"
              className="w-full text-[12px] border border-ink-200 dark:border-ink-700 rounded p-1.5 bg-white dark:bg-ink-900 focus:outline-none focus:ring-1 focus:ring-ink-300"
              rows={2}
            />
          ) : (
            <div
              onClick={() => setEditingNote(true)}
              className="text-[12px] text-ink-700 dark:text-ink-200 italic cursor-text">
              {h.note}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onPickColor(c)}
            title={`Change to ${c}`}
            className={`w-4 h-4 rounded-full border ${
              h.color === c
                ? "border-ink-900 dark:border-white"
                : "border-ink-200 dark:border-ink-700"
            }`}
            style={{ background: COLOR_HEX[c] }}
          />
        ))}

        <div className="ml-auto flex items-center gap-2 text-[11px] relative">
          <a
            href={h.textFragmentUrl}
            target="_blank"
            rel="noreferrer"
            className="text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
            Open
          </a>
          {!editingNote && !h.note && (
            <button
              onClick={() => setEditingNote(true)}
              className="text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
              + Note
            </button>
          )}
          <button
            onClick={onCopy}
            className="text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
            Copy
          </button>
          <button
            onClick={() => setMovingOpen((v) => !v)}
            className="text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
            Move
          </button>
          <button
            onClick={onDelete}
            className="text-red-500 hover:text-red-600">
            Delete
          </button>

          {movingOpen && (
            <div className="absolute right-0 top-5 z-20 w-48 rounded-md border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg overflow-hidden">
              <button
                onClick={() => onMove(null)}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-ink-50 dark:hover:bg-ink-800 ${
                  !h.notebookId ? "bg-ink-50 dark:bg-ink-800" : ""
                }`}>
                Per page (no notebook)
              </button>
              {notebooks.length > 0 && (
                <div className="border-t border-ink-100 dark:border-ink-800">
                  {notebooks.map((nb) => (
                    <button
                      key={nb.id}
                      onClick={() => onMove(nb.id)}
                      className={`w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-ink-50 dark:hover:bg-ink-800 ${
                        h.notebookId === nb.id
                          ? "bg-ink-50 dark:bg-ink-800"
                          : ""
                      }`}>
                      {nb.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 text-[10px] text-ink-400">
        {formatDate(h.createdAt)}
      </div>
    </li>
  );
}

function EmptyState({
  title,
  url,
  activeNotebook
}: {
  title: string;
  url: string;
  activeNotebook: Notebook | null;
}) {
  const looksLikePdf = /\.pdf(\?|#|$)/i.test(url);
  const isInBuiltinPdfViewer =
    looksLikePdf && !url.startsWith(chrome.runtime.getURL(""));

  return (
    <div className="px-6 py-10 text-center">
      {isInBuiltinPdfViewer && (
        <div className="mb-4 px-3 py-2.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/15 text-[12px] text-amber-900 dark:text-amber-200 text-left">
          <div className="font-semibold mb-0.5">Open this PDF in the viewer?</div>
          <div className="leading-relaxed">
            Chrome's built-in PDF reader doesn't allow extensions to read text
            selections. Reload it through Notes Maker's bundled viewer to
            highlight as usual.
          </div>
          <button
            onClick={async () => {
              await sendMessage({
                type: "open-pdf-viewer",
                payload: { src: url }
              });
            }}
            className="mt-2 px-2.5 py-1 text-[12px] rounded-md bg-amber-600 text-white hover:bg-amber-700">
            Open in Notes Maker viewer
          </button>
        </div>
      )}

      <div className="text-sm text-ink-500">No highlights on this page yet.</div>
      <div className="mt-3 text-[12px] text-ink-400 leading-relaxed">
        Select any text on{" "}
        <span className="text-ink-700 dark:text-ink-200 break-all">
          {title || url || "the page"}
        </span>{" "}
        and pick a color from the toolbar that pops up — or hit{" "}
        <kbd className="px-1.5 py-0.5 border border-ink-200 dark:border-ink-700 rounded text-[10px]">
          Ctrl+Shift+H
        </kbd>{" "}
        / <kbd className="px-1.5 py-0.5 border border-ink-200 dark:border-ink-700 rounded text-[10px]">⌘⇧H</kbd>.
      </div>
      {activeNotebook ? (
        <div className="mt-3 text-[12px] text-amber-700 dark:text-amber-300">
          New highlights will be added to <strong>{activeNotebook.name}</strong>.
        </div>
      ) : (
        <div className="mt-3 text-[12px] text-ink-400">
          Highlights are saved as a per-page draft until you download them.
          Switch to a notebook above to collect highlights from multiple pages
          into one project file.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Notebooks panel                                                     */
/* ------------------------------------------------------------------ */

function NotebooksPanel({
  notebooks,
  activeNotebookId,
  onOpen
}: {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  onOpen: (id: string) => void;
}) {
  const [stats, setStats] = useState<
    Record<string, { highlights: number; pages: number }>
  >({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const out: Record<string, { highlights: number; pages: number }> = {};
      for (const nb of notebooks) {
        const r = await sendMessage({
          type: "get-notebook-detail",
          payload: { id: nb.id }
        });
        if ("groups" in r) {
          out[nb.id] = {
            highlights: r.groups.reduce((n, g) => n + g.highlights.length, 0),
            pages: r.groups.length
          };
        }
      }
      if (!cancelled) setStats(out);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [notebooks]);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await sendMessage({
      type: "create-notebook",
      payload: { name: trimmed }
    });
    setName("");
    setCreating(false);
  };

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Notebooks</h2>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="text-xs px-2.5 py-1.5 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900">
            + New notebook
          </button>
        )}
      </div>

      {creating && (
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
            placeholder="Notebook name"
            className="flex-1 text-xs px-2 py-1.5 border border-ink-200 dark:border-ink-700 rounded-md bg-white dark:bg-ink-900 focus:outline-none focus:ring-1 focus:ring-amber-300"
          />
          <button
            onClick={onCreate}
            className="text-xs px-2.5 py-1.5 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900">
            Create
          </button>
          <button
            onClick={() => {
              setCreating(false);
              setName("");
            }}
            className="text-xs px-2 py-1.5 text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
            Cancel
          </button>
        </div>
      )}

      {notebooks.length === 0 ? (
        <div className="px-2 py-8 text-center text-[12px] text-ink-500 leading-relaxed">
          You don't have any notebooks yet.
          <br />
          Create one to collect highlights from multiple pages into a single
          project file.
        </div>
      ) : (
        <ul className="space-y-2">
          {notebooks.map((nb) => {
            const s = stats[nb.id] ?? { highlights: 0, pages: 0 };
            const isActive = activeNotebookId === nb.id;
            return (
              <li
                key={nb.id}
                className={`rounded-lg border p-3 ${
                  isActive
                    ? "border-amber-300 bg-amber-50 dark:bg-amber-900/15"
                    : "border-ink-100 dark:border-ink-800"
                }`}>
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => onOpen(nb.id)}
                    className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {nb.name}
                      {isActive && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      {s.highlights} highlight{s.highlights === 1 ? "" : "s"} ·{" "}
                      {s.pages} source{s.pages === 1 ? "" : "s"} · updated{" "}
                      {formatDate(nb.updatedAt)}
                    </div>
                  </button>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() =>
                        sendMessage({
                          type: "export-notebook",
                          payload: { id: nb.id }
                        })
                      }
                      disabled={s.highlights === 0}
                      className="text-[11px] px-2 py-1 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900 disabled:opacity-40">
                      .md
                    </button>
                    <button
                      onClick={() => onOpen(nb.id)}
                      className="text-[11px] px-2 py-1 rounded-md border border-ink-200 dark:border-ink-700">
                      Open
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Notebook detail (drilldown)                                         */
/* ------------------------------------------------------------------ */

function NotebookDetailPanel({
  id,
  notebooks,
  onBack
}: {
  id: string;
  notebooks: Notebook[];
  onBack: () => void;
}) {
  const [groups, setGroups] = useState<NotebookGroup[]>([]);
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    const r = await sendMessage({
      type: "get-notebook-detail",
      payload: { id }
    });
    if ("groups" in r) {
      setGroups(r.groups);
      setNotebook(r.notebook);
      setName(r.notebook?.name ?? "");
    }
  }, [id]);

  useEffect(() => {
    load();
    const onChanged = (changes: { [k: string]: chrome.storage.StorageChange }) => {
      if (
        changes["notes-maker:pages"] ||
        changes["notes-maker:notebooks"]
      ) {
        load();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  const totalHl = groups.reduce((n, g) => n + g.highlights.length, 0);
  const previewMd = useMemo(
    () => (notebook ? notebookToMarkdown(notebook, groups) : ""),
    [notebook, groups]
  );

  const onRename = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await sendMessage({
      type: "rename-notebook",
      payload: { id, name: trimmed }
    });
    setRenaming(false);
  };

  const onDelete = async () => {
    if (!notebook) return;
    if (
      !confirm(
        `Delete notebook "${notebook.name}"? Its ${totalHl} highlight${totalHl === 1 ? "" : "s"} will be kept and become per-page notes.`
      )
    )
      return;
    await sendMessage({
      type: "delete-notebook",
      payload: { id, deleteHighlights: false }
    });
    onBack();
  };

  if (!notebook) {
    return (
      <div className="px-4 py-6 text-[12px] text-ink-500">
        Notebook not found.{" "}
        <button onClick={onBack} className="underline">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <button
        onClick={onBack}
        className="text-[11px] text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
        ← All notebooks
      </button>

      <div className="rounded-lg border border-ink-100 dark:border-ink-800 p-3">
        {renaming ? (
          <div className="flex items-center gap-1.5">
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename();
                if (e.key === "Escape") {
                  setRenaming(false);
                  setName(notebook.name);
                }
              }}
              className="flex-1 text-sm font-medium px-2 py-1 border border-ink-200 dark:border-ink-700 rounded-md bg-white dark:bg-ink-900 focus:outline-none focus:ring-1 focus:ring-amber-300"
            />
            <button
              onClick={onRename}
              className="text-xs px-2 py-1 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900">
              Save
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium flex-1 truncate">
              {notebook.name}
            </div>
            <button
              onClick={() => setRenaming(true)}
              className="text-[11px] text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
              Rename
            </button>
          </div>
        )}
        <div className="text-[11px] text-ink-500 mt-1">
          {totalHl} highlight{totalHl === 1 ? "" : "s"} · {groups.length} source
          {groups.length === 1 ? "" : "s"} · updated{" "}
          {formatDate(notebook.updatedAt)}
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button
            onClick={() =>
              sendMessage({
                type: "export-notebook",
                payload: { id }
              })
            }
            disabled={totalHl === 0}
            className="text-xs px-2.5 py-1.5 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900 disabled:opacity-40">
            Download notebook .md
          </button>
          <button
            onClick={() => setShowPreview((v) => !v)}
            disabled={totalHl === 0}
            className="text-xs px-2.5 py-1.5 rounded-md border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-40">
            {showPreview ? "Hide preview" : "Preview .md"}
          </button>
          <button
            onClick={() =>
              sendMessage({
                type: "set-active-notebook",
                payload: { id }
              })
            }
            className="text-xs px-2.5 py-1.5 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20">
            Make active
          </button>
          <button
            onClick={onDelete}
            className="ml-auto text-xs text-red-500 hover:text-red-600">
            Delete notebook
          </button>
        </div>
      </div>

      {showPreview && (
        <pre className="rounded-lg border border-ink-100 dark:border-ink-800 bg-ink-50 dark:bg-ink-800 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-72 overflow-auto scrollbar-thin">
          {previewMd}
        </pre>
      )}

      {groups.length === 0 ? (
        <div className="text-[12px] text-ink-500 px-2 py-8 text-center">
          No highlights yet. Make this notebook active and start highlighting.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.page.key} className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 flex items-center gap-2">
                <span className="truncate flex-1">{g.page.title}</span>
                <a
                  href={g.page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 normal-case tracking-normal">
                  open
                </a>
              </div>
              <ul className="space-y-2">
                {g.highlights.map((h) => (
                  <HighlightCard
                    key={h.id}
                    h={h}
                    notebooks={notebooks}
                    pageHighlights={g.page.highlights}
                    hideNotebookChip
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Library                                                             */
/* ------------------------------------------------------------------ */

function LibraryPanel({
  pages,
  notebooks,
  query,
  onQuery
}: {
  pages: PageEntry[];
  notebooks: Notebook[];
  query: string;
  onQuery: (s: string) => void;
}) {
  const filtered = useMemo(() => {
    if (!query.trim()) return pages;
    const q = query.toLowerCase();
    return pages
      .map((p) => {
        const matches = p.highlights.filter(
          (h) =>
            h.text.toLowerCase().includes(q) ||
            h.note.toLowerCase().includes(q) ||
            h.headingPath.join(" ").toLowerCase().includes(q)
        );
        const titleMatch =
          p.title.toLowerCase().includes(q) ||
          p.url.toLowerCase().includes(q) ||
          p.domain.toLowerCase().includes(q);
        if (matches.length === 0 && !titleMatch) return null;
        return {
          ...p,
          highlights: matches.length > 0 ? matches : p.highlights
        };
      })
      .filter(Boolean) as PageEntry[];
  }, [pages, query]);

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search across all notes…"
          className="flex-1 text-xs px-2.5 py-1.5 border border-ink-200 dark:border-ink-700 rounded-md bg-white dark:bg-ink-900 focus:outline-none focus:ring-1 focus:ring-ink-300"
        />
        <button
          onClick={() => sendMessage({ type: "export-all" })}
          className="text-xs px-2.5 py-1.5 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900 hover:opacity-90 whitespace-nowrap">
          Export all .md
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-xs text-ink-500 py-8 text-center">
          {pages.length === 0
            ? "No notes saved yet."
            : "No matches for that search."}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((p) => (
            <PageCard key={p.key} page={p} notebooks={notebooks} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PageCard({
  page,
  notebooks
}: {
  page: PageEntry;
  notebooks: Notebook[];
}) {
  const [open, setOpen] = useState(false);

  const usedNotebookIds = new Set(
    page.highlights.map((h) => h.notebookId).filter((x): x is string => !!x)
  );
  const usedNotebooks = notebooks.filter((nb) => usedNotebookIds.has(nb.id));

  return (
    <li className="rounded-lg border border-ink-100 dark:border-ink-800 overflow-hidden">
      <div className="flex items-start gap-2 p-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left">
          <div className="text-sm font-medium line-clamp-2">{page.title}</div>
          <div className="text-[11px] text-ink-500 truncate">{page.domain}</div>
          <div className="text-[11px] text-ink-400 mt-1">
            {page.highlights.length} highlight
            {page.highlights.length === 1 ? "" : "s"} · updated{" "}
            {formatDate(page.updatedAt)}
          </div>
          {usedNotebooks.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {usedNotebooks.map((nb) => (
                <span
                  key={nb.id}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                  {nb.name}
                </span>
              ))}
            </div>
          )}
        </button>
        <div className="flex flex-col gap-1">
          <button
            onClick={() =>
              sendMessage({
                type: "export-page",
                payload: { pageKey: page.key }
              })
            }
            className="text-[11px] px-2 py-1 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900 whitespace-nowrap">
            .md
          </button>
          <button
            onClick={() => chrome.tabs.create({ url: page.url })}
            className="text-[11px] px-2 py-1 rounded-md border border-ink-200 dark:border-ink-700 whitespace-nowrap">
            Open
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-ink-100 dark:border-ink-800 px-3 py-2 space-y-2 bg-ink-50/40 dark:bg-ink-800/40">
          {page.highlights.map((h) => (
            <div
              key={h.id}
              className="text-[12px] leading-relaxed pl-2 border-l-2"
              style={{ borderColor: COLOR_HEX[h.color] }}>
              {h.headingPath.length > 0 && (
                <div className="text-[10px] text-ink-500">
                  {h.headingPath.join(" › ")}
                </div>
              )}
              <div className="line-clamp-3 whitespace-pre-wrap">{h.text}</div>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings                                                            */
/* ------------------------------------------------------------------ */

function SettingsPanel({ pages }: { pages: PageEntry[] }) {
  const [busy, setBusy] = useState(false);
  const [autoOpenPdfs, setAutoOpenPdfs] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get("notes-maker:settings").then((out) => {
      if (cancelled) return;
      const s = (out["notes-maker:settings"] as
        | { autoOpenPdfsInViewer?: boolean }
        | undefined) ?? {};
      setAutoOpenPdfs(s.autoOpenPdfsInViewer ?? true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePdfs = async (next: boolean) => {
    setAutoOpenPdfs(next);
    const out = await chrome.storage.local.get("notes-maker:settings");
    const current =
      (out["notes-maker:settings"] as Record<string, unknown> | undefined) ??
      {};
    await chrome.storage.local.set({
      "notes-maker:settings": { ...current, autoOpenPdfsInViewer: next }
    });
  };

  const openPdfViewer = async () => {
    await sendMessage({ type: "open-pdf-viewer" });
  };

  const onClearAll = async () => {
    if (!confirm("Delete ALL saved notes and notebooks? This cannot be undone."))
      return;
    setBusy(true);
    try {
      await chrome.storage.local.remove([
        "notes-maker:pages",
        "notes-maker:notebooks",
        "notes-maker:activeNotebookId"
      ]);
    } finally {
      setBusy(false);
    }
  };

  const totalHl = pages.reduce((n, p) => n + p.highlights.length, 0);

  return (
    <div className="px-4 py-4 space-y-4 text-sm">
      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          About your notes
        </h3>
        <div className="text-[12px] text-ink-700 dark:text-ink-200">
          {pages.length} page{pages.length === 1 ? "" : "s"} · {totalHl}{" "}
          highlight{totalHl === 1 ? "" : "s"}
        </div>
        <div className="text-[12px] text-ink-500 leading-relaxed">
          Drafts live in <code className="font-mono">chrome.storage.local</code>{" "}
          and persist across browser restarts. Use{" "}
          <em>Library → Export all .md</em> to download a single combined file,
          or use a <strong>notebook</strong> to collect highlights from multiple
          pages into one project file with a name of your choice.
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          PDFs
        </h3>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoOpenPdfs}
            onChange={(e) => togglePdfs(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[12px] text-ink-700 dark:text-ink-200 leading-relaxed">
            <strong>Auto-open PDFs in our viewer.</strong> Any{" "}
            <code className="font-mono">.pdf</code> URL you visit (including
            local <code className="font-mono">file://</code> ones) is routed
            through the bundled PDF.js viewer so you can highlight just like
            on any webpage.
          </span>
        </label>
        <button
          onClick={openPdfViewer}
          className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800">
          Open PDF in viewer…
        </button>
        <div className="text-[11px] text-ink-500 leading-relaxed">
          For local files, also enable{" "}
          <em>Allow access to file URLs</em> on the extension's card at{" "}
          <a
            href="chrome://extensions"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              chrome.tabs.create({ url: "chrome://extensions" });
            }}
            className="underline hover:text-ink-700 dark:hover:text-ink-200">
            chrome://extensions
          </a>
          .
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Two ways to organize
        </h3>
        <ul className="text-[12px] text-ink-700 dark:text-ink-200 list-disc pl-5 space-y-1">
          <li>
            <strong>Per page (default):</strong> every page becomes its own .md
            file when you click <em>Download this page .md</em>.
          </li>
          <li>
            <strong>Notebook:</strong> create a notebook for a project, set it
            as <em>active</em> in the banner, and every highlight you save on
            any page joins that notebook. Export it as one .md with the name
            you chose.
          </li>
        </ul>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Keyboard shortcuts
        </h3>
        <ul className="text-[12px] text-ink-700 dark:text-ink-200 space-y-1">
          <li>
            <kbd className="px-1.5 py-0.5 border border-ink-200 dark:border-ink-700 rounded text-[10px]">
              Ctrl+Shift+H
            </kbd>{" "}
            — save current selection
          </li>
          <li>
            <kbd className="px-1.5 py-0.5 border border-ink-200 dark:border-ink-700 rounded text-[10px]">
              Ctrl+Shift+N
            </kbd>{" "}
            — open this side panel
          </li>
        </ul>
        <a
          href="chrome://extensions/shortcuts"
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault();
            chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
          }}
          className="text-[12px] text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          Customize shortcuts →
        </a>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Tips
        </h3>
        <ul className="text-[12px] text-ink-700 dark:text-ink-200 list-disc pl-5 space-y-1">
          <li>
            Each highlight links back to the exact passage on the source page
            using a Chrome text fragment (the{" "}
            <code className="font-mono">#:~:text=</code> URL).
          </li>
          <li>
            Highlights re-appear automatically when you revisit a page, even if
            the site re-renders its DOM.
          </li>
          <li>
            Right-click selected text → <em>Save selection to Notes Maker</em>{" "}
            also works.
          </li>
          <li>
            Already saved a highlight without picking a notebook? Open it on the
            <em> Page</em> tab and use <em>Move</em> to drop it into one.
          </li>
        </ul>
      </section>

      <section className="space-y-2 pt-2 border-t border-ink-100 dark:border-ink-800">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-red-500">
          Danger zone
        </h3>
        <button
          onClick={onClearAll}
          disabled={busy || pages.length === 0}
          className="text-[12px] px-2.5 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
          Delete all saved notes & notebooks
        </button>
      </section>

      <section className="pt-2 text-[10px] text-ink-400">
        v0.4.0 ·{" "}
        <button
          onClick={() => {
            const md = libraryToMarkdown(pages);
            navigator.clipboard.writeText(md).catch(() => {});
          }}
          className="underline hover:text-ink-700 dark:hover:text-ink-200">
          Copy library to clipboard
        </button>
      </section>
    </div>
  );
}
