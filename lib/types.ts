export type HighlightColor =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "orange"
  | "purple"
  | "red";

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "purple",
  "red"
];

export const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#fde68a",
  green: "#bbf7d0",
  blue: "#bfdbfe",
  pink: "#fbcfe8",
  orange: "#fed7aa",
  purple: "#ddd6fe",
  red: "#f87171"
};

/**
 * Anchor used to re-locate a Range on a page after reload.
 * We rely primarily on a text-quote (prefix + exact + suffix) which
 * is robust to DOM changes, with offsets as a fast-path hint.
 */
export interface TextQuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  pageKey: string;
  url: string;
  pageTitle: string;
  domain: string;

  text: string;
  markdown: string;

  headingPath: string[];

  textFragmentUrl: string;

  color: HighlightColor;
  note: string;

  anchor: TextQuoteAnchor;

  /** Optional notebook (project file) this highlight belongs to. */
  notebookId: string | null;

  /**
   * If this highlight was a sub-part of another highlight on the same
   * page when it was created, that highlight's id. Lets us display
   * "↳ part of: '...'" in the side panel and Markdown export.
   */
  parentId: string | null;

  createdAt: number;
  updatedAt: number;
}

export interface Notebook {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotebookGroup {
  page: PageEntry;
  highlights: Highlight[];
}

export interface PageEntry {
  key: string;
  url: string;
  title: string;
  domain: string;
  highlights: Highlight[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  /**
   * Master switch for the extension. When false, the highlighter UI is
   * suppressed everywhere: the floating toolbar is hidden, painted
   * highlights are cleared from open pages, the keyboard shortcut and
   * context menu won't save anything, and the PDF auto-redirect rule
   * is removed. The side panel itself stays usable so the user can
   * still browse, export, and re-enable.
   */
  extensionEnabled: boolean;
  defaultColor: HighlightColor;
  showFloatingToolbar: boolean;
  includeBreadcrumbsInExport: boolean;
  includeSourceLinkInExport: boolean;
  exportSeparator: string;
  /**
   * When true, .pdf URLs (including local file://) are auto-redirected to
   * our bundled PDF.js viewer so highlighting works.
   */
  autoOpenPdfsInViewer: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  extensionEnabled: true,
  defaultColor: "yellow",
  showFloatingToolbar: true,
  includeBreadcrumbsInExport: true,
  includeSourceLinkInExport: true,
  exportSeparator: "\n\n---\n\n",
  autoOpenPdfsInViewer: true
};

export type Message =
  | {
      type: "save-highlight";
      payload: Omit<
        Highlight,
        "id" | "createdAt" | "updatedAt" | "pageKey" | "notebookId"
      >;
    }
  | { type: "delete-highlight"; payload: { pageKey: string; id: string } }
  | {
      type: "update-highlight";
      payload: { pageKey: string; id: string; patch: Partial<Highlight> };
    }
  | { type: "get-page"; payload: { pageKey: string } }
  | { type: "get-all-pages" }
  | { type: "export-page"; payload: { pageKey: string } }
  | { type: "export-all" }
  | { type: "open-side-panel" }
  | { type: "ping-content" }
  | { type: "trigger-save-from-shortcut" }
  | { type: "list-notebooks" }
  | { type: "create-notebook"; payload: { name: string; description?: string } }
  | { type: "rename-notebook"; payload: { id: string; name: string } }
  | {
      type: "delete-notebook";
      payload: { id: string; deleteHighlights?: boolean };
    }
  | { type: "get-active-notebook" }
  | { type: "set-active-notebook"; payload: { id: string | null } }
  | {
      type: "move-highlight";
      payload: {
        pageKey: string;
        id: string;
        notebookId: string | null;
      };
    }
  | { type: "get-notebook-detail"; payload: { id: string } }
  | { type: "export-notebook"; payload: { id: string } }
  | { type: "open-pdf-viewer"; payload?: { src?: string } };

export type MessageResponse<T extends Message["type"]> =
  T extends "save-highlight" ? { ok: boolean; highlight?: Highlight; error?: string } :
  T extends "get-page" ? { page: PageEntry | null } :
  T extends "get-all-pages" ? { pages: PageEntry[] } :
  T extends "export-page" ? { ok: boolean; downloadId?: number; error?: string } :
  T extends "export-all" ? { ok: boolean; downloadId?: number; error?: string } :
  T extends "list-notebooks" ? { notebooks: Notebook[] } :
  T extends "create-notebook" ? { ok: boolean; notebook?: Notebook; error?: string } :
  T extends "get-active-notebook" ? { notebookId: string | null; notebook: Notebook | null } :
  T extends "get-notebook-detail" ? { notebook: Notebook | null; groups: NotebookGroup[] } :
  T extends "export-notebook" ? { ok: boolean; downloadId?: number; error?: string } :
  T extends "open-pdf-viewer" ? { ok: boolean; tabId?: number; error?: string } :
  { ok: boolean; error?: string };
