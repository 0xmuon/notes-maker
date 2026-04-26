import type { TextQuoteAnchor } from "./types";

/**
 * Build a text-quote anchor for a Range:
 *  { exact, prefix (~30 chars before), suffix (~30 chars after) }
 *
 * This is the format used by Hypothesis / W3C Web Annotations and is
 * far more robust to DOM changes than CSS-selector + offset schemes.
 */
export function rangeToTextQuoteAnchor(range: Range): TextQuoteAnchor {
  const exact = range.toString();

  const root = document.body;
  const rootText = root.innerText || root.textContent || "";

  // Find absolute character offset of the range's start in rootText.
  const before = textBeforeRange(range);
  const start = before.length;
  const end = start + exact.length;

  const PAD = 32;
  const prefix = rootText.slice(Math.max(0, start - PAD), start);
  const suffix = rootText.slice(end, end + PAD);

  return {
    exact,
    prefix: normalize(prefix),
    suffix: normalize(suffix)
  };
}

/**
 * Resolve a TextQuoteAnchor back to a Range on the current document.
 * Strategy:
 *   1) Walk every text node, accumulating textContent.
 *   2) Find candidate matches of `exact`.
 *   3) Score candidates by how well prefix/suffix match.
 *   4) Return the best match's Range.
 */
export function findRangeForAnchor(anchor: TextQuoteAnchor): Range | null {
  const target = normalize(anchor.exact);
  if (!target) return null;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  type Chunk = { node: Text; start: number; end: number };
  const chunks: Chunk[] = [];
  let cursor = 0;
  let full = "";

  let n: Node | null = walker.nextNode();
  while (n) {
    const t = n as Text;
    const value = t.nodeValue ?? "";
    chunks.push({ node: t, start: cursor, end: cursor + value.length });
    full += value;
    cursor += value.length;
    n = walker.nextNode();
  }

  const normalizedFull = normalize(full);

  // Find all occurrences of `target` in the normalized text.
  const occurrences: number[] = [];
  let from = 0;
  while (true) {
    const i = normalizedFull.indexOf(target, from);
    if (i < 0) break;
    occurrences.push(i);
    from = i + Math.max(1, target.length);
  }
  if (occurrences.length === 0) return null;

  // Score by prefix/suffix overlap.
  const wantPrefix = normalize(anchor.prefix);
  const wantSuffix = normalize(anchor.suffix);

  let bestIdx = occurrences[0];
  let bestScore = -1;
  for (const idx of occurrences) {
    const beforeSlice = normalizedFull.slice(Math.max(0, idx - wantPrefix.length), idx);
    const afterSlice = normalizedFull.slice(idx + target.length, idx + target.length + wantSuffix.length);
    const score = commonSuffix(beforeSlice, wantPrefix) + commonPrefix(afterSlice, wantSuffix);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }

  // Map normalized index back to original-string index by reversing the
  // (very simple) normalization (collapsing whitespace).
  const originalIdx = mapNormalizedToOriginal(full, bestIdx);
  if (originalIdx < 0) return null;
  const originalEnd = originalIdx + originalSpanLength(full, originalIdx, target.length);

  // Convert [originalIdx, originalEnd] to (Text node, offset) endpoints.
  const startLoc = locate(chunks, originalIdx);
  const endLoc = locate(chunks, originalEnd);
  if (!startLoc || !endLoc) return null;

  const range = document.createRange();
  try {
    range.setStart(startLoc.node, startLoc.offset);
    range.setEnd(endLoc.node, endLoc.offset);
  } catch {
    return null;
  }
  return range;
}

function locate(
  chunks: { node: Text; start: number; end: number }[],
  pos: number
): { node: Text; offset: number } | null {
  for (const c of chunks) {
    if (pos >= c.start && pos <= c.end) {
      return { node: c.node, offset: pos - c.start };
    }
  }
  return null;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Compute how many characters of the original (un-collapsed) text correspond
 * to a normalized substring starting at normalized-index `nIdx` of length `nLen`.
 * Used because the normalized string collapses runs of whitespace into one space.
 */
function originalSpanLength(original: string, originalStart: number, normalizedLen: number): number {
  let consumed = 0;
  let i = originalStart;
  let lastWasSpace = false;
  while (i < original.length && consumed < normalizedLen) {
    const ch = original[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        consumed++;
        lastWasSpace = true;
      }
    } else {
      consumed++;
      lastWasSpace = false;
    }
    i++;
  }
  return i - originalStart;
}

/**
 * Map a normalized-index back to the equivalent index in the original (raw) string.
 * Both strings differ only by collapsed whitespace.
 */
function mapNormalizedToOriginal(original: string, normalizedIdx: number): number {
  // First trim leading whitespace - normalize() trims, so the original may
  // have a leading whitespace run that maps to position 0 of normalized.
  let oi = 0;
  while (oi < original.length && /\s/.test(original[oi])) oi++;

  let ni = 0;
  let lastWasSpace = false;
  while (oi < original.length && ni < normalizedIdx) {
    const ch = original[oi];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        ni++;
        lastWasSpace = true;
      }
    } else {
      ni++;
      lastWasSpace = false;
    }
    oi++;
  }
  // Skip any whitespace right before the target match start.
  while (oi < original.length && /\s/.test(original[oi])) oi++;
  return oi;
}

function textBeforeRange(range: Range): string {
  const before = document.createRange();
  before.setStart(document.body, 0);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString();
}

/* ------------------------------------------------------------------ */
/*  Range-vs-range relation utilities                                  */
/* ------------------------------------------------------------------ */

export interface RangeOffsets {
  start: number;
  end: number;
}

/** Absolute character offsets of `range` within the document body. */
export function getRangeOffsets(range: Range): RangeOffsets {
  const before = document.createRange();
  before.setStart(document.body, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const text = range.toString();
  return { start, end: start + text.length };
}

export type RangeRelation =
  | "equal"
  | "subset"
  | "superset"
  | "overlap"
  | "disjoint";

/**
 * Compare two ranges as character spans on the page.
 * `selection` is the new selection the user is about to save.
 * `existing` is an already-saved highlight's range.
 *
 *   equal     → same passage (with a tiny tolerance for whitespace)
 *   subset    → selection is wholly inside existing
 *   superset  → selection wholly contains existing
 *   overlap   → partial overlap
 *   disjoint  → no overlap
 */
export function rangeRelation(selection: Range, existing: Range): RangeRelation {
  const a = getRangeOffsets(selection);
  const b = getRangeOffsets(existing);

  const aText = selection.toString().trim().replace(/\s+/g, " ");
  const bText = existing.toString().trim().replace(/\s+/g, " ");
  if (aText === bText && Math.abs(a.start - b.start) <= 5) return "equal";

  // Allow a few characters of slop at each end (whitespace, punctuation).
  if (a.start <= b.start + 2 && a.end >= b.end - 2) return "superset";
  if (a.start >= b.start - 2 && a.end <= b.end + 2) return "subset";
  if (a.end <= b.start || a.start >= b.end) return "disjoint";
  return "overlap";
}
