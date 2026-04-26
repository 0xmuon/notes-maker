import TurndownService from "turndown";
// @ts-expect-error - no types ship for the gfm plugin
import { gfm } from "turndown-plugin-gfm";

import {
  type Highlight,
  type Notebook,
  type NotebookGroup,
  type PageEntry,
  type Settings,
  DEFAULT_SETTINGS
} from "./types";

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (service) return service;
  service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined"
  });
  service.use(gfm);
  // Drop noisy elements that don't make sense in notes.
  service.remove([
    "script",
    "style",
    "noscript",
    "iframe",
    "button"
  ] as unknown as Parameters<typeof service.remove>[0]);
  return service;
}

export function htmlToMarkdown(html: string): string {
  return getService()
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Render a single highlight as a Markdown block.
 * Includes:
 *   - heading breadcrumb (if any)
 *   - quoted markdown body
 *   - source link with a text-fragment that re-opens the exact passage
 *   - optional user note
 */
export function highlightToMarkdown(
  h: Highlight,
  settings: Settings = DEFAULT_SETTINGS,
  pageHighlights?: Map<string, Highlight>
): string {
  const parts: string[] = [];

  if (settings.includeBreadcrumbsInExport && h.headingPath.length > 0) {
    parts.push(`**${h.headingPath.join(" › ")}**`);
  }

  const body = (h.markdown || h.text)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  parts.push(body);

  if (h.parentId) {
    const parent = pageHighlights?.get(h.parentId);
    if (parent) {
      const snippet = snippetOf(parent.text, 80);
      parts.push(`↳ *part of an earlier highlight on this page: "${snippet}"*`);
    } else {
      parts.push(`↳ *part of an earlier highlight on this page*`);
    }
  }

  const meta: string[] = [];
  if (settings.includeSourceLinkInExport && h.textFragmentUrl) {
    meta.push(`[Source](${h.textFragmentUrl})`);
  }
  meta.push(`*${h.color} highlight · ${formatDate(h.createdAt)}*`);
  parts.push(meta.join(" · "));

  if (h.note && h.note.trim()) {
    parts.push(`**Note:** ${h.note.trim()}`);
  }

  return parts.join("\n\n");
}

function snippetOf(s: string, max: number): string {
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1) + "…";
}

export function pageToMarkdown(
  page: PageEntry,
  settings: Settings = DEFAULT_SETTINGS
): string {
  const header = [
    `# ${page.title || page.url}`,
    "",
    `Source: <${page.url}>`,
    `Captured ${page.highlights.length} highlight${page.highlights.length === 1 ? "" : "s"} · last updated ${formatDate(page.updatedAt)}`,
    ""
  ].join("\n");

  const ordered = [...page.highlights].sort(
    (a, b) => a.createdAt - b.createdAt
  );
  const map = new Map(page.highlights.map((h) => [h.id, h]));

  const body = ordered
    .map((h) => highlightToMarkdown(h, settings, map))
    .join(settings.exportSeparator);

  return `${header}\n${body}\n`;
}

export function notebookToMarkdown(
  notebook: Notebook,
  groups: NotebookGroup[],
  settings: Settings = DEFAULT_SETTINGS
): string {
  const totalHl = groups.reduce((n, g) => n + g.highlights.length, 0);

  const headerLines: string[] = [];
  headerLines.push(`# ${notebook.name}`);
  headerLines.push("");
  if (notebook.description.trim()) {
    headerLines.push(notebook.description.trim());
    headerLines.push("");
  }
  headerLines.push(
    `${groups.length} source${groups.length === 1 ? "" : "s"} · ${totalHl} highlight${totalHl === 1 ? "" : "s"} · last updated ${formatDate(notebook.updatedAt)}`
  );
  headerLines.push("");
  headerLines.push("---");
  headerLines.push("");

  const sections = groups.map((g) => {
    const pageHead = [
      `## ${g.page.title || g.page.domain}`,
      "",
      `Source: <${g.page.url}>`,
      ""
    ].join("\n");
    const ordered = [...g.highlights].sort(
      (a, b) => a.createdAt - b.createdAt
    );
    const map = new Map(g.page.highlights.map((h) => [h.id, h]));
    const body = ordered
      .map((h) => highlightToMarkdown(h, settings, map))
      .join(settings.exportSeparator);
    return `${pageHead}${body}`;
  });

  return headerLines.join("\n") + sections.join("\n\n") + "\n";
}

export function libraryToMarkdown(
  pages: PageEntry[],
  settings: Settings = DEFAULT_SETTINGS
): string {
  const head = [
    `# My Notes Library`,
    "",
    `${pages.length} page${pages.length === 1 ? "" : "s"} · ${pages.reduce(
      (n, p) => n + p.highlights.length,
      0
    )} highlights`,
    "",
    "---",
    ""
  ].join("\n");

  const body = pages
    .map((p) => pageToMarkdown(p, settings))
    .join("\n\n=====\n\n");

  return head + "\n" + body;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function safeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "notes";
}

/** Build a Chrome text fragment URL pointing back at the exact passage. */
export function buildTextFragmentUrl(url: string, text: string): string {
  const base = url.split("#")[0];
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return url;

  const enc = (s: string) =>
    encodeURIComponent(s).replace(/-/g, "%2D").replace(/'/g, "%27");

  if (cleaned.length <= 120) {
    return `${base}#:~:text=${enc(cleaned)}`;
  }
  const words = cleaned.split(" ");
  const start = words.slice(0, 5).join(" ");
  const end = words.slice(-5).join(" ");
  return `${base}#:~:text=${enc(start)},${enc(end)}`;
}
