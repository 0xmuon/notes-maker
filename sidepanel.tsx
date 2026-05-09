import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./style.css";

import {
  formatDate,
  libraryToMarkdown,
  notebookToMarkdown,
  pageToMarkdown
} from "~lib/markdown";
import { EXTENSION_VERSION } from "~lib/version";
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

const SETTINGS_STORAGE_KEY = "notes-maker:settings";

async function readEnabled(): Promise<boolean> {
  const out = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const s = (out[SETTINGS_STORAGE_KEY] as { extensionEnabled?: boolean } | undefined) ?? {};
  return s.extensionEnabled !== false;
}

async function writeEnabled(next: boolean): Promise<void> {
  const out = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const current =
    (out[SETTINGS_STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
  await chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: { ...current, extensionEnabled: next }
  });
}

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
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    readEnabled().then((v) => {
      if (!cancelled) setEnabled(v);
    });
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes[SETTINGS_STORAGE_KEY]) {
        const next = (changes[SETTINGS_STORAGE_KEY].newValue as
          | { extensionEnabled?: boolean }
          | undefined) ?? {};
        setEnabled(next.extensionEnabled !== false);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

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
    <div className="flex h-screen w-full flex-col bg-ink-50/40 text-ink-900 dark:bg-ink-900 dark:text-ink-50 font-sans">
      <Header
        tab={tab}
        onChangeTab={(t) => {
          setTab(t);
          if (t !== "notebooks") setOpenNotebookId(null);
        }}
        pageCount={allPages.length}
        highlightCount={totalHighlights}
        enabled={enabled}
        onToggleEnabled={() => writeEnabled(!enabled)}
        activePageTitle={activeTitle}
      />

      {!enabled && <PausedBanner onResume={() => writeEnabled(true)} />}

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
  highlightCount,
  enabled,
  onToggleEnabled,
  activePageTitle
}: {
  tab: Tab;
  onChangeTab: (t: Tab) => void;
  pageCount: number;
  highlightCount: number;
  enabled: boolean;
  onToggleEnabled: () => void;
  activePageTitle: string;
}) {
  const cls = (active: boolean) =>
    `focus-ring px-2.5 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
      active
        ? "bg-ink-900 text-white shadow-sm dark:bg-white dark:text-ink-900"
        : "text-ink-600 hover:bg-ink-100/80 dark:text-ink-300 dark:hover:bg-ink-800/80"
    }`;

  return (
    <header className="shrink-0 border-b border-ink-200/80 dark:border-ink-800 bg-white/90 dark:bg-ink-900/95 backdrop-blur-sm px-3 py-3 sm:px-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight text-ink-900 dark:text-ink-50">
              Notes Maker
            </h1>
            <PowerSwitch enabled={enabled} onToggle={onToggleEnabled} />
          </div>
          <p className="text-[11px] text-ink-500 mt-0.5 leading-snug">
            {pageCount} page{pageCount === 1 ? "" : "s"} · {highlightCount}{" "}
            highlight{highlightCount === 1 ? "" : "s"}
            {tab === "page" && activePageTitle ? (
              <>
                <span className="text-ink-300 dark:text-ink-600 mx-1">·</span>
                <span className="text-ink-600 dark:text-ink-300 truncate inline-block max-w-[200px] align-bottom">
                  {activePageTitle}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <nav
        className="flex flex-wrap gap-1"
        role="tablist"
        aria-label="Notes Maker sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "page"}
          onClick={() => onChangeTab("page")}
          className={cls(tab === "page")}>
          This page
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notebooks"}
          onClick={() => onChangeTab("notebooks")}
          className={cls(tab === "notebooks")}>
          Notebooks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "library"}
          onClick={() => onChangeTab("library")}
          className={cls(tab === "library")}>
          Library
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "settings"}
          onClick={() => onChangeTab("settings")}
          className={cls(tab === "settings")}
          title="Shortcuts, PDFs, and data">
          More
        </button>
      </nav>
    </header>
  );
}

function PowerSwitch({
  enabled,
  onToggle
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      title={
        enabled
          ? "Extension is on — click to pause highlighting"
          : "Extension is paused — click to resume"
      }
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-ring ${
        enabled
          ? "bg-emerald-500"
          : "bg-ink-300 dark:bg-ink-700"
      }`}>
      <span
        aria-hidden
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
      <span className="sr-only">
        {enabled ? "Turn extension off" : "Turn extension on"}
      </span>
    </button>
  );
}

function PausedBanner({ onResume }: { onResume: () => void }) {
  return (
    <div
      role="status"
      className="border-b border-ink-100 dark:border-ink-800 px-4 py-2 bg-ink-100 dark:bg-ink-800/60 flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-full bg-ink-400 dark:bg-ink-500" />
      <div className="flex-1 text-[12px] text-ink-700 dark:text-ink-200 leading-snug">
        <span className="font-medium">Highlighting paused.</span>{" "}
        <span className="text-ink-500">
          The toolbar, shortcut, and PDF redirect are off. Saved notes are
          still here.
        </span>
      </div>
      <button
        onClick={onResume}
        className="text-[11px] px-2.5 py-1 rounded-md bg-ink-900 text-white dark:bg-white dark:text-ink-900 hover:opacity-90">
        Resume
      </button>
    </div>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

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
      ref={rootRef}
      className={`relative shrink-0 border-b border-ink-200/80 dark:border-ink-800 px-3 py-2.5 sm:px-4 ${
        isActive
          ? "bg-amber-50/90 dark:bg-amber-900/20"
          : "bg-white/60 dark:bg-ink-900/50"
      }`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 shrink-0 rounded-full ${
            isActive ? "bg-amber-500" : "bg-ink-300 dark:bg-ink-600"
          }`}
        />
        <span className="text-[10px] font-semibold text-ink-500 uppercase tracking-wider shrink-0">
          New highlights →
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
          className="focus-ring flex-1 flex items-center justify-between gap-2 min-h-[36px] px-3 py-1.5 text-[12px] rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 hover:border-ink-300 dark:hover:border-ink-600 shadow-sm">
          <span className="truncate text-left">
            {active ? (
              <>
                <span className="font-semibold text-ink-900 dark:text-ink-50">
                  {active.name}
                </span>{" "}
                <span className="text-ink-400 font-normal">notebook</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-ink-900 dark:text-ink-50">
                  This page only
                </span>{" "}
                <span className="text-ink-400 font-normal">
                  · one .md per URL
                </span>
              </>
            )}
          </span>
          <span
            className={`text-ink-400 text-[10px] transition-transform ${
              open ? "rotate-180" : ""
            }`}>
            ▾
          </span>
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
    <div className="px-3 py-3 sm:px-4 space-y-3">
      <div className="rounded-xl border border-ink-200/80 dark:border-ink-800 bg-white dark:bg-ink-900/40 shadow-sm p-3.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1">
          Source
        </div>
        <div className="text-sm font-semibold text-ink-900 dark:text-ink-50 line-clamp-2 leading-snug">
          {page.title}
        </div>
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-ink-500 hover:text-amber-700 dark:hover:text-amber-300 break-all mt-1 inline-block">
          {page.url}
        </a>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() =>
              sendMessage({
                type: "export-page",
                payload: { pageKey: page.key }
              })
            }
            className="focus-ring text-xs font-medium px-3 py-2 rounded-lg bg-ink-900 text-white dark:bg-white dark:text-ink-900 hover:opacity-95">
            Download .md
          </button>
          <button
            type="button"
            onClick={onTogglePreview}
            className="focus-ring text-xs font-medium px-3 py-2 rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 hover:bg-ink-50 dark:hover:bg-ink-800">
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <span className="text-[11px] text-ink-500 ml-auto tabular-nums">
            {page.highlights.length} on this page
          </span>
        </div>
      </div>

      {showPreview && (
        <pre className="rounded-xl border border-ink-200/80 dark:border-ink-800 bg-ink-100/50 dark:bg-ink-800/60 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-72 overflow-auto scrollbar-thin">
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
  const actionsRef = useRef<HTMLDivElement>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(h.note ?? "");
  const [movingOpen, setMovingOpen] = useState(false);

  useEffect(() => setNote(h.note ?? ""), [h.note]);

  useEffect(() => {
    if (!movingOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = actionsRef.current;
      if (el && !el.contains(e.target as Node)) setMovingOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMovingOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [movingOpen]);

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
      className="rounded-xl border border-ink-200/80 dark:border-ink-800 bg-white dark:bg-ink-900/30 p-3 shadow-sm hover:border-ink-300/80 dark:hover:border-ink-700 transition-colors"
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
      <blockquote className="text-[13px] leading-relaxed text-ink-800 dark:text-ink-100 border-l-[3px] border-ink-200 dark:border-ink-600 pl-3 whitespace-pre-wrap">
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

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Highlight color ${c}`}
              aria-pressed={h.color === c}
              onClick={() => onPickColor(c)}
              title={`Change to ${c}`}
              className={`focus-ring w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                h.color === c
                  ? "border-ink-900 dark:border-white ring-2 ring-ink-900/20 dark:ring-white/25"
                  : "border-ink-200 dark:border-ink-600"
              }`}
              style={{ background: COLOR_HEX[c] }}
            />
          ))}
        </div>

        <div
          ref={actionsRef}
          className="flex flex-wrap items-center gap-1 sm:ml-auto sm:justify-end text-[12px] relative">
          <a
            href={h.textFragmentUrl}
            target="_blank"
            rel="noreferrer"
            className="focus-ring font-medium px-2 py-1 rounded-md text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">
            Open source
          </a>
          {!editingNote && !h.note && (
            <button
              type="button"
              onClick={() => setEditingNote(true)}
              className="focus-ring font-medium px-2 py-1 rounded-md text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">
              Add note
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="focus-ring font-medium px-2 py-1 rounded-md text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">
            Copy
          </button>
          <button
            type="button"
            aria-expanded={movingOpen}
            onClick={() => setMovingOpen((v) => !v)}
            className="focus-ring font-medium px-2 py-1 rounded-md text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">
            Move…
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="focus-ring font-medium px-2 py-1 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
            Delete
          </button>

          {movingOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => onMove(null)}
                className={`focus-ring w-full text-left px-3 py-2 text-[12px] hover:bg-ink-50 dark:hover:bg-ink-800 ${
                  !h.notebookId ? "bg-ink-50 dark:bg-ink-800" : ""
                }`}>
                This page only
              </button>
              {notebooks.length > 0 && (
                <div className="border-t border-ink-100 dark:border-ink-800">
                  {notebooks.map((nb) => (
                    <button
                      type="button"
                      key={nb.id}
                      onClick={() => onMove(nb.id)}
                      className={`focus-ring w-full text-left px-3 py-2 text-[12px] hover:bg-ink-50 dark:hover:bg-ink-800 ${
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
    <div className="px-4 py-8 sm:px-6 text-center max-w-md mx-auto">
      {isInBuiltinPdfViewer && (
        <div className="mb-5 px-3 py-3 rounded-xl border border-amber-300/80 bg-amber-50 dark:bg-amber-900/20 text-[12px] text-amber-950 dark:text-amber-100 text-left shadow-sm">
          <div className="font-semibold mb-1">PDFs need the Notes Maker viewer</div>
          <div className="leading-relaxed text-amber-900/90 dark:text-amber-100/90">
            Chrome’s built-in PDF tab can’t expose text selections to extensions.
            Open the file here to highlight like on a normal page.
          </div>
          <button
            type="button"
            onClick={async () => {
              await sendMessage({
                type: "open-pdf-viewer",
                payload: { src: url }
              });
            }}
            className="focus-ring mt-3 w-full sm:w-auto px-3 py-2 text-[12px] font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700">
            Open in Notes Maker viewer
          </button>
        </div>
      )}

      <div className="text-[15px] font-semibold text-ink-800 dark:text-ink-100">
        Nothing saved for this page yet
      </div>
      <p className="mt-2 text-[12px] text-ink-500 leading-relaxed">
        On{" "}
        <span className="text-ink-700 dark:text-ink-200 font-medium break-all">
          {title || url || "this tab"}
        </span>
        , select text — a toolbar appears under your selection.
      </p>

      <ol className="mt-5 text-left text-[12px] text-ink-600 dark:text-ink-300 space-y-2 rounded-xl border border-ink-200/80 dark:border-ink-800 bg-white dark:bg-ink-900/40 p-3.5 shadow-sm">
        <li className="flex gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white dark:bg-white dark:text-ink-900">
            1
          </span>
          <span>Select the passage you care about.</span>
        </li>
        <li className="flex gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white dark:bg-white dark:text-ink-900">
            2
          </span>
          <span>
            Tap a color — or press{" "}
            <kbd className="px-1 py-0.5 rounded border border-ink-200 dark:border-ink-600 font-mono text-[10px]">
              Ctrl+Shift+H
            </kbd>{" "}
            /{" "}
            <kbd className="px-1 py-0.5 rounded border border-ink-200 dark:border-ink-600 font-mono text-[10px]">
              ⌘⇧H
            </kbd>
            .
          </span>
        </li>
        <li className="flex gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white dark:bg-white dark:text-ink-900">
            3
          </span>
          <span>Come back here to preview or download Markdown.</span>
        </li>
      </ol>

      {activeNotebook ? (
        <p className="mt-4 text-[12px] text-amber-800 dark:text-amber-200/90 rounded-lg bg-amber-50/90 dark:bg-amber-900/25 px-3 py-2">
          New highlights go into{" "}
          <span className="font-semibold">{activeNotebook.name}</span>.
        </p>
      ) : (
        <p className="mt-4 text-[12px] text-ink-500 leading-relaxed">
          Use <strong className="text-ink-700 dark:text-ink-300">New highlights →</strong>{" "}
          above to stay per-page or route clips into a notebook project.
        </p>
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
    <div className="px-3 py-3 sm:px-4 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search highlights, notes, headings…"
          aria-label="Search library"
          className="focus-ring flex-1 text-xs px-3 py-2 border border-ink-200 dark:border-ink-700 rounded-lg bg-white dark:bg-ink-900 shadow-sm"
        />
        <button
          type="button"
          onClick={() => sendMessage({ type: "export-all" })}
          className="focus-ring text-xs font-medium px-3 py-2 rounded-lg bg-ink-900 text-white dark:bg-white dark:text-ink-900 hover:opacity-95 whitespace-nowrap">
          Export all
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
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get(SETTINGS_STORAGE_KEY).then((out) => {
      if (cancelled) return;
      const s = (out[SETTINGS_STORAGE_KEY] as
        | { autoOpenPdfsInViewer?: boolean; extensionEnabled?: boolean }
        | undefined) ?? {};
      setAutoOpenPdfs(s.autoOpenPdfsInViewer ?? true);
      setEnabled(s.extensionEnabled !== false);
    });
    const onChanged = (changes: { [k: string]: chrome.storage.StorageChange }) => {
      if (changes[SETTINGS_STORAGE_KEY]) {
        const next = (changes[SETTINGS_STORAGE_KEY].newValue as
          | { autoOpenPdfsInViewer?: boolean; extensionEnabled?: boolean }
          | undefined) ?? {};
        setAutoOpenPdfs(next.autoOpenPdfsInViewer ?? true);
        setEnabled(next.extensionEnabled !== false);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const togglePdfs = async (next: boolean) => {
    setAutoOpenPdfs(next);
    const out = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    const current =
      (out[SETTINGS_STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { ...current, autoOpenPdfsInViewer: next }
    });
  };

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next);
    await writeEnabled(next);
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
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Extension
        </h3>
        <div
          className={`rounded-lg border p-3 flex items-start gap-3 ${
            enabled
              ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-900/10 dark:border-emerald-900/40"
              : "border-ink-200 bg-ink-50 dark:bg-ink-800/40 dark:border-ink-700"
          }`}>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  enabled ? "bg-emerald-500" : "bg-ink-400 dark:bg-ink-500"
                }`}
              />
              <div className="text-[13px] font-medium">
                {enabled ? "Notes Maker is on" : "Notes Maker is paused"}
              </div>
            </div>
            <div className="text-[11px] text-ink-500 mt-1 leading-relaxed">
              {enabled
                ? "Highlighting toolbar, keyboard shortcut, and PDF redirect are active on every page."
                : "The selection toolbar, keyboard shortcut, and PDF redirect are all off. Your saved notes remain available here."}
            </div>
          </div>
          <PowerSwitch enabled={enabled} onToggle={() => toggleEnabled(!enabled)} />
        </div>
      </section>

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
        v{EXTENSION_VERSION} ·{" "}
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
