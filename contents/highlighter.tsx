import type { PlasmoCSConfig } from "plasmo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  findRangeForAnchor,
  rangeRelation,
  rangeToTextQuoteAnchor
} from "~lib/anchor";
import { getHeadingPath, pageTitle, rangeToCleanHtml } from "~lib/context";
import { buildTextFragmentUrl, htmlToMarkdown } from "~lib/markdown";
import { sendMessage } from "~lib/messages";
import { domainOf, pageKeyForUrl } from "~lib/storage";
import {
  COLOR_HEX,
  HIGHLIGHT_COLORS,
  type Highlight,
  type HighlightColor,
  type PageEntry,
  type Settings
} from "~lib/types";

const SETTINGS_STORAGE_KEY = "notes-maker:settings";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false,
  run_at: "document_idle"
};

/* ------------------------------------------------------------------ */
/*  Highlight rendering using the CSS Custom Highlight API            */
/* ------------------------------------------------------------------ */

const STYLE_ID = "notes-maker-highlight-styles";

function ensureHighlightStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  const rules = HIGHLIGHT_COLORS.map(
    (c) =>
      `::highlight(notes-maker-${c}) { background-color: ${COLOR_HEX[c]}cc; color: inherit; }`
  ).join("\n");
  style.textContent = rules;
  document.documentElement.appendChild(style);
}

const supportsHighlightApi =
  typeof (CSS as unknown as { highlights?: Map<string, unknown> }).highlights !==
    "undefined" &&
  typeof (window as unknown as { Highlight?: unknown }).Highlight !==
    "undefined";

function paintHighlights(highlights: Highlight[]) {
  ensureHighlightStyles();
  if (!supportsHighlightApi) {
    paintHighlightsFallback(highlights);
    return;
  }

  const buckets = new Map<HighlightColor, Range[]>();
  for (const c of HIGHLIGHT_COLORS) buckets.set(c, []);

  for (const h of highlights) {
    const r = findRangeForAnchor(h.anchor);
    if (r) buckets.get(h.color)?.push(r);
  }

  for (const c of HIGHLIGHT_COLORS) {
    const ranges = buckets.get(c) || [];
    const name = `notes-maker-${c}`;
    if (ranges.length === 0) {
      (CSS as any).highlights.delete(name);
      continue;
    }
    const HL = (window as any).Highlight as new (...r: Range[]) => unknown;
    const reg = new HL(...ranges);
    (CSS as any).highlights.set(name, reg);
  }
}

const FALLBACK_CLASS = "notes-maker-fallback-mark";

function clearFallbackHighlights() {
  document.querySelectorAll(`.${FALLBACK_CLASS}`).forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
}

function clearAllPaintedHighlights() {
  if (supportsHighlightApi) {
    for (const c of HIGHLIGHT_COLORS) {
      (CSS as any).highlights.delete(`notes-maker-${c}`);
    }
  }
  clearFallbackHighlights();
}

function paintHighlightsFallback(highlights: Highlight[]) {
  clearFallbackHighlights();

  for (const h of highlights) {
    const range = findRangeForAnchor(h.anchor);
    if (!range) continue;
    try {
      const mark = document.createElement("mark");
      mark.className = FALLBACK_CLASS;
      mark.style.backgroundColor = COLOR_HEX[h.color] + "cc";
      mark.style.color = "inherit";
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
    } catch {
      // skip ranges that span unsplittable boundaries
    }
  }
}

/* ------------------------------------------------------------------ */
/*  React UI: floating selection toolbar                               */
/* ------------------------------------------------------------------ */

type SelectionRelation = {
  kind: "new" | "equal" | "subset" | "superset" | "overlap";
  /** Existing highlights that match this selection in some way. */
  matches: Highlight[];
};

const NO_RELATION: SelectionRelation = { kind: "new", matches: [] };

type ToolbarState = {
  visible: boolean;
  top: number;
  left: number;
  range: Range | null;
  relation: SelectionRelation;
};

const HIDDEN: ToolbarState = {
  visible: false,
  top: 0,
  left: 0,
  range: null,
  relation: NO_RELATION
};

export default function HighlighterCSUI() {
  const [tb, setTb] = useState<ToolbarState>(HIDDEN);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [pageHighlights, setPageHighlights] = useState<Highlight[]>([]);
  const [enabled, setEnabled] = useState(true);
  const enabledRef = useRef(true);
  enabledRef.current = enabled;
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const pageHighlightsRef = useRef<Highlight[]>([]);
  pageHighlightsRef.current = pageHighlights;

  // Load + watch the master on/off setting.
  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get(SETTINGS_STORAGE_KEY).then((out) => {
      if (cancelled) return;
      const s = (out[SETTINGS_STORAGE_KEY] as Partial<Settings> | undefined) ?? {};
      setEnabled(s.extensionEnabled !== false);
    });
    const onChanged = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes[SETTINGS_STORAGE_KEY]) {
        const next = (changes[SETTINGS_STORAGE_KEY].newValue as
          | Partial<Settings>
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

  // Apply the on/off state: clear paint + hide toolbar when off,
  // re-paint stored highlights when flipped back on.
  useEffect(() => {
    if (enabled) {
      paintHighlights(pageHighlightsRef.current);
    } else {
      clearAllPaintedHighlights();
      setTb(HIDDEN);
    }
  }, [enabled]);

  /**
   * Compute how the user's selection relates to existing highlights on
   * this page. Priority: equal > subset > superset > overlap > new.
   */
  const computeRelation = useCallback(
    (range: Range, highlights: Highlight[]): SelectionRelation => {
      let equal: Highlight | null = null;
      const subset: Highlight[] = [];
      const superset: Highlight[] = [];
      const overlap: Highlight[] = [];

      for (const h of highlights) {
        const existing = findRangeForAnchor(h.anchor);
        if (!existing) continue;
        const rel = rangeRelation(range, existing);
        if (rel === "equal") {
          equal = h;
          break;
        } else if (rel === "subset") subset.push(h);
        else if (rel === "superset") superset.push(h);
        else if (rel === "overlap") overlap.push(h);
      }

      if (equal) return { kind: "equal", matches: [equal] };
      if (subset.length > 0) return { kind: "subset", matches: subset };
      if (superset.length > 0) return { kind: "superset", matches: superset };
      if (overlap.length > 0) return { kind: "overlap", matches: overlap };
      return NO_RELATION;
    },
    []
  );

  // 1. Listen for selection changes -> show/hide toolbar.
  useEffect(() => {
    const onSelectionChange = () => {
      if (!enabledRef.current) {
        setTb(HIDDEN);
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setTb(HIDDEN);
        return;
      }
      const text = sel.toString();
      if (!text || !text.trim()) {
        setTb(HIDDEN);
        return;
      }
      const range = sel.getRangeAt(0);

      const root = toolbarRef.current;
      if (root && root.contains(range.startContainer)) return;

      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      const relation = computeRelation(range, pageHighlightsRef.current);

      const rawLeft = rect.left + window.scrollX;
      const pad = 8;
      const maxW = 320;
      const left = Math.max(
        window.scrollX + pad,
        Math.min(rawLeft, window.scrollX + window.innerWidth - maxW - pad)
      );

      setTb({
        visible: true,
        top: rect.bottom + window.scrollY + 8,
        left,
        range,
        relation
      });
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [computeRelation]);

  // 2. Load existing highlights for this page and paint them.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const resp = await sendMessage({
        type: "get-page",
        payload: { pageKey: pageKeyForUrl(location.href) }
      });
      if (cancelled) return;
      const list = (resp.page as PageEntry | null)?.highlights ?? [];
      setPageHighlights(list);
      requestAnimationFrame(() => {
        if (enabledRef.current) paintHighlights(list);
      });
    };
    load();

    const onChanged = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes["notes-maker:pages"]) load();
    };
    chrome.storage.onChanged.addListener(onChanged);

    const onMessage = (msg: any) => {
      if (msg?.type === "trigger-save-from-shortcut") {
        if (!enabledRef.current) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) {
          const range = sel.getRangeAt(0);
          const relation = computeRelation(range, pageHighlightsRef.current);
          handleAction(range, "yellow", relation);
        }
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Re-paint when page DOM changes substantially (SPA navigation).
  useEffect(() => {
    let scheduled = 0;
    const obs = new MutationObserver(() => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(() => {
        if (enabledRef.current) paintHighlights(pageHighlights);
      }, 250);
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false
    });
    return () => {
      obs.disconnect();
      window.clearTimeout(scheduled);
    };
  }, [pageHighlights]);

  /**
   * Centralized handler for "user wants to apply color C to selection".
   *   - exact dup, same color    -> no-op (with feedback)
   *   - exact dup, diff color    -> change color of the existing highlight
   *   - subset of an existing    -> save as a new highlight tagged with parentId
   *   - everything else          -> save as a fresh highlight
   */
  async function handleAction(
    range: Range,
    color: HighlightColor,
    relation: SelectionRelation
  ) {
    if (busy) return;
    setBusy(true);
    try {
      if (relation.kind === "equal" && relation.matches[0]) {
        const existing = relation.matches[0];
        if (existing.color === color) {
          flash(`Already saved as ${color}`);
          return;
        }
        const resp = await sendMessage({
          type: "update-highlight",
          payload: {
            pageKey: existing.pageKey,
            id: existing.id,
            patch: { color }
          }
        });
        flash(
          resp.ok
            ? `Color changed to ${color}`
            : `Couldn't change: ${resp.error || "unknown error"}`
        );
        return;
      }

      const text = range.toString().trim();
      if (!text) return;

      const html = rangeToCleanHtml(range);
      const md = htmlToMarkdown(html) || text;
      const path = getHeadingPath(range);
      const anchor = rangeToTextQuoteAnchor(range);
      const url = location.href;
      const fragmentUrl = buildTextFragmentUrl(url, text);

      const parentId =
        relation.kind === "subset" && relation.matches[0]
          ? relation.matches[0].id
          : null;

      const resp = await sendMessage({
        type: "save-highlight",
        payload: {
          url,
          pageTitle: pageTitle(),
          domain: domainOf(url),
          text,
          markdown: md,
          headingPath: path,
          textFragmentUrl: fragmentUrl,
          color,
          note: "",
          anchor,
          parentId
        }
      });

      if (!resp.ok) {
        flash(`Couldn't save: ${resp.error || "unknown error"}`);
        return;
      }

      if (parentId) flash(`Saved as part of an earlier highlight`);
      else if (relation.kind === "superset")
        flash(`Saved (covers ${relation.matches.length} earlier highlight${relation.matches.length === 1 ? "" : "s"})`);
      else if (relation.kind === "overlap")
        flash(`Saved (overlaps an earlier highlight)`);
      else flash(`Saved as ${color} highlight`);
    } finally {
      setBusy(false);
      window.getSelection()?.removeAllRanges();
      setTb(HIDDEN);
    }
  }

  async function handleUnhighlight() {
    const existing = tb.relation.matches[0];
    if (!existing) return;
    setBusy(true);
    try {
      const resp = await sendMessage({
        type: "delete-highlight",
        payload: { pageKey: existing.pageKey, id: existing.id }
      });
      flash(resp.ok ? "Removed from notes" : `Couldn't remove`);
    } finally {
      setBusy(false);
      window.getSelection()?.removeAllRanges();
      setTb(HIDDEN);
    }
  }

  function flash(msg: string) {
    setConfirmation(msg);
    window.setTimeout(() => setConfirmation(null), 1400);
  }

  const message = useMemo(() => {
    switch (tb.relation.kind) {
      case "equal":
        return `Already highlighted (${tb.relation.matches[0]?.color})`;
      case "subset":
        return "↳ Inside an earlier highlight";
      case "superset":
        return `↪ Includes ${tb.relation.matches.length} earlier highlight${tb.relation.matches.length === 1 ? "" : "s"}`;
      case "overlap":
        return "⚠ Overlaps an earlier highlight";
      default:
        return busy ? "Saving…" : "Highlight";
    }
  }, [tb.relation, busy]);

  const colorButtons = useMemo(
    () =>
      HIGHLIGHT_COLORS.map((c) => {
        const isCurrent =
          tb.relation.kind === "equal" &&
          tb.relation.matches[0]?.color === c;
        return (
          <button
            key={c}
            aria-label={`Apply ${c}`}
            title={
              tb.relation.kind === "equal"
                ? isCurrent
                  ? `Already ${c}`
                  : `Change to ${c}`
                : `Save as ${c} highlight`
            }
            onMouseDown={(e) => {
              e.preventDefault();
              if (tb.range) handleAction(tb.range, c, tb.relation);
            }}
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: COLOR_HEX[c],
              border: isCurrent
                ? "2px solid #fff"
                : "1px solid rgba(0,0,0,.18)",
              boxShadow: isCurrent ? "0 0 0 1px rgba(0,0,0,.35)" : "none",
              cursor: "pointer",
              transition: "transform .12s ease",
              padding: 0
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1.15)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1)";
            }}
          />
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tb.range, tb.relation, busy]
  );

  return (
    <>
      {enabled && tb.visible && (
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="Notes Maker highlight toolbar"
          style={{
            position: "absolute",
            top: tb.top,
            left: tb.left,
            zIndex: 2147483647,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            rowGap: 6,
            maxWidth: "min(calc(100vw - 16px), 420px)",
            padding: "8px 12px",
            background: "rgba(22,22,24,.96)",
            color: "#fff",
            borderRadius: 12,
            boxShadow:
              "0 4px 6px rgba(0,0,0,.12), 0 12px 28px rgba(0,0,0,.32)",
            border: "1px solid rgba(255,255,255,.08)",
            backdropFilter: "blur(8px)",
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            fontSize: 12,
            lineHeight: 1.25
          }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {colorButtons}
          </div>

          <span
            style={{
              width: 1,
              alignSelf: "stretch",
              minHeight: 20,
              background: "rgba(255,255,255,.15)"
            }}
          />

          <span
            style={{
              opacity: 0.88,
              userSelect: "none",
              flex: "1 1 120px",
              minWidth: 0,
              fontSize: 11,
              lineHeight: 1.35
            }}>
            {message}
          </span>

          {tb.relation.kind === "equal" && (
            <>
              <span
                style={{
                  width: 1,
                  height: 18,
                  background: "rgba(255,255,255,.18)"
                }}
              />
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleUnhighlight();
                }}
                title="Remove this highlight from notes"
                aria-label="Remove highlight from notes"
                style={{
                  background: "rgba(255,255,255,.08)",
                  border: "1px solid rgba(255,255,255,.22)",
                  color: "#fff",
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4
                }}>
                <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>
                  ✕
                </span>
                Remove
              </button>
            </>
          )}
        </div>
      )}

      {confirmation && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 2147483647,
            background: "rgba(22,22,24,.96)",
            color: "#fff",
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,.1)",
            boxShadow:
              "0 4px 6px rgba(0,0,0,.12), 0 12px 28px rgba(0,0,0,.28)",
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            fontSize: 13,
            maxWidth: "min(calc(100vw - 32px), 320px)"
          }}>
          {confirmation}
        </div>
      )}
    </>
  );
}
