import {
  libraryToMarkdown,
  notebookToMarkdown,
  pageToMarkdown,
  safeFilename
} from "~lib/markdown";
import {
  createNotebook,
  deleteHighlight,
  deleteNotebook,
  domainOf,
  getActiveNotebookId,
  getAllPages,
  getNotebook,
  getNotebookGroups,
  getPage,
  getSettings,
  listNotebooks,
  makeId,
  moveHighlightToNotebook,
  pageKeyForUrl,
  renameNotebook,
  setActiveNotebookId,
  updateHighlight,
  upsertHighlight
} from "~lib/storage";
import type { Highlight, Message } from "~lib/types";

const PDF_REDIRECT_RULE_ID = 1001;
const SETTINGS_STORAGE_KEY = "notes-maker:settings";

function pdfViewerUrl(src?: string): string {
  const base = chrome.runtime.getURL("tabs/pdfviewer.html");
  if (!src) return base;
  return `${base}?src=${encodeURIComponent(src)}`;
}

/**
 * Install / update a single dynamic declarativeNetRequest rule that
 * redirects every top-level navigation to a .pdf URL into our bundled
 * PDF.js viewer so the highlight pipeline works on PDFs the same way
 * it does on HTML pages.
 *
 * The rule is removed when the user disables auto-redirect in settings.
 */
async function syncPdfRedirectRule(): Promise<void> {
  try {
    const settings = await getSettings();
    const viewer = chrome.runtime.getURL("tabs/pdfviewer.html");

    // Always remove first so we never keep a stale rule around.
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [PDF_REDIRECT_RULE_ID]
    });

    if (!settings.autoOpenPdfsInViewer) return;

    const rule: chrome.declarativeNetRequest.Rule = {
      id: PDF_REDIRECT_RULE_ID,
      priority: 1,
      action: {
        type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
        redirect: {
          regexSubstitution: `${viewer}?src=\\0`
        }
      },
      condition: {
        // Match http(s) and file URLs ending in .pdf, with optional
        // query string or fragment. chrome-extension:// is excluded by the
        // alternation so we never redirect our own viewer.
        regexFilter: "^(file|https?)://[^?#]+\\.pdf([?#].*)?$",
        resourceTypes: [
          "main_frame" as chrome.declarativeNetRequest.ResourceType
        ]
      }
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [rule]
    });
  } catch (err) {
    console.warn("[notes-maker] failed to sync PDF redirect rule", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Initial setup                                                      */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // setPanelBehavior is gated on Chrome 114+; no-op on older builds.
  }

  chrome.contextMenus.create({
    id: "notes-maker-save",
    title: "Save selection to Notes Maker",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "notes-maker-open-pdf",
    title: "Open PDF in Notes Maker viewer",
    contexts: ["link"],
    targetUrlPatterns: ["*://*/*.pdf*", "file:///*.pdf*"]
  });

  await syncPdfRedirectRule();
});

chrome.runtime.onStartup.addListener(() => {
  void syncPdfRedirectRule();
});

// Re-sync the rule whenever the user toggles the setting from the side panel.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[SETTINGS_STORAGE_KEY]) void syncPdfRedirectRule();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "notes-maker-save") {
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, {
      type: "trigger-save-from-shortcut"
    });
    return;
  }

  if (info.menuItemId === "notes-maker-open-pdf") {
    const target = info.linkUrl;
    if (!target) return;
    await chrome.tabs.create({ url: pdfViewerUrl(target) });
    return;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-highlight") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "trigger-save-from-shortcut" });
});

/* ------------------------------------------------------------------ */
/*  Message dispatcher                                                 */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener(
  (msg: Message, _sender, sendResponse) => {
    handleMessage(msg)
      .then((resp) => sendResponse(resp))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err?.message ?? err) })
      );
    return true; // keep the channel open for async response
  }
);

async function handleMessage(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case "save-highlight": {
      const p = msg.payload;
      const now = Date.now();
      const activeNotebookId = await getActiveNotebookId();
      const highlight: Highlight = {
        id: makeId(),
        pageKey: pageKeyForUrl(p.url),
        url: p.url,
        pageTitle: p.pageTitle,
        domain: p.domain || domainOf(p.url),
        text: p.text,
        markdown: p.markdown,
        headingPath: p.headingPath,
        textFragmentUrl: p.textFragmentUrl,
        color: p.color,
        note: p.note ?? "",
        anchor: p.anchor,
        notebookId: activeNotebookId,
        parentId: p.parentId ?? null,
        createdAt: now,
        updatedAt: now
      };
      await upsertHighlight(highlight);
      return { ok: true, highlight };
    }

    case "update-highlight": {
      const updated = await updateHighlight(
        msg.payload.pageKey,
        msg.payload.id,
        msg.payload.patch
      );
      return { ok: !!updated };
    }

    case "delete-highlight": {
      await deleteHighlight(msg.payload.pageKey, msg.payload.id);
      return { ok: true };
    }

    case "get-page": {
      const page = await getPage(msg.payload.pageKey);
      return { page };
    }

    case "get-all-pages": {
      const pages = await getAllPages();
      return { pages };
    }

    case "export-page": {
      const page = await getPage(msg.payload.pageKey);
      if (!page) return { ok: false, error: "Page not found" };
      const settings = await getSettings();
      const md = pageToMarkdown(page, settings);
      const filename = `${safeFilename(page.title)}.md`;
      const downloadId = await downloadMarkdown(md, filename);
      return { ok: true, downloadId };
    }

    case "export-all": {
      const pages = await getAllPages();
      if (pages.length === 0) return { ok: false, error: "No notes yet" };
      const settings = await getSettings();
      const md = libraryToMarkdown(pages, settings);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `notes-library-${stamp}.md`;
      const downloadId = await downloadMarkdown(md, filename);
      return { ok: true, downloadId };
    }

    case "open-side-panel": {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      if (tab?.windowId !== undefined) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      }
      return { ok: true };
    }

    case "list-notebooks": {
      const notebooks = await listNotebooks();
      return { notebooks };
    }

    case "create-notebook": {
      const name = (msg.payload.name ?? "").trim();
      if (!name) return { ok: false, error: "Name required" };
      const notebook = await createNotebook(
        name,
        msg.payload.description ?? ""
      );
      return { ok: true, notebook };
    }

    case "rename-notebook": {
      const updated = await renameNotebook(
        msg.payload.id,
        msg.payload.name ?? ""
      );
      return { ok: !!updated };
    }

    case "delete-notebook": {
      await deleteNotebook(msg.payload.id, !!msg.payload.deleteHighlights);
      return { ok: true };
    }

    case "get-active-notebook": {
      const id = await getActiveNotebookId();
      const nb = id ? await getNotebook(id) : null;
      return { notebookId: nb ? id : null, notebook: nb };
    }

    case "set-active-notebook": {
      await setActiveNotebookId(msg.payload.id);
      return { ok: true };
    }

    case "move-highlight": {
      await moveHighlightToNotebook(
        msg.payload.pageKey,
        msg.payload.id,
        msg.payload.notebookId
      );
      return { ok: true };
    }

    case "get-notebook-detail": {
      const notebook = await getNotebook(msg.payload.id);
      const groups = notebook
        ? await getNotebookGroups(msg.payload.id)
        : [];
      return { notebook, groups };
    }

    case "export-notebook": {
      const notebook = await getNotebook(msg.payload.id);
      if (!notebook) return { ok: false, error: "Notebook not found" };
      const groups = await getNotebookGroups(msg.payload.id);
      if (groups.length === 0) {
        return { ok: false, error: "No highlights in this notebook yet" };
      }
      const settings = await getSettings();
      const md = notebookToMarkdown(notebook, groups, settings);
      const filename = `${safeFilename(notebook.name)}.md`;
      const downloadId = await downloadMarkdown(md, filename);
      return { ok: true, downloadId };
    }

    case "open-pdf-viewer": {
      const tab = await chrome.tabs.create({
        url: pdfViewerUrl(msg.payload?.src)
      });
      return { ok: true, tabId: tab.id };
    }

    default:
      return { ok: false, error: "Unknown message" };
  }
}

/* ------------------------------------------------------------------ */
/*  Markdown download                                                  */
/* ------------------------------------------------------------------ */

async function downloadMarkdown(md: string, filename: string): Promise<number> {
  // Service workers can't use URL.createObjectURL on Blobs. Use a data URL.
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;
  return new Promise<number>((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, saveAs: true },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err || downloadId === undefined) {
          reject(err?.message || "Download failed");
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}
