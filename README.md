# Notes Maker

> Highlight any webpage and turn it into clean, contextual Markdown notes. Drafts persist across browser sessions. Download as `.md` whenever you want.

A Chrome extension built with [Plasmo](https://www.plasmo.com/) + React + TypeScript + Tailwind. Designed for one job: making it effortless to capture passages from blogs and articles into a single, well-formatted Markdown notebook.

---

## Features

- **Works on PDFs too.** Local `file://` PDFs and online `*.pdf` URLs are auto-redirected through the bundled [PDF.js](https://mozilla.github.io/pdf.js/) viewer so the same selection toolbar, notebooks, and exports work on PDFs identically to webpages. Drag-and-drop also works.
- **Two ways to organize.**
  - **Per page** (default): every page becomes its own `.md`, downloadable on demand.
  - **Notebook**: name a notebook (e.g. *Fuzzing research*), set it as **active** in the banner at the top of the side panel, and every highlight you save on any page joins that notebook. Export it as one combined `.md` with the notebook name as the filename.
- **Floating toolbar on selection.** Pick a color (yellow / green / blue / pink / red) and your highlight is saved instantly to whichever destination is currently active.
- **Smart re-selection.** Re-select an already-highlighted passage and the toolbar shows it's saved — pick a new color to **change it**, or click **Unhighlight** to remove it from your notes. Same color = no-op (won't create a duplicate).
- **Sub-highlight detection.** If your new selection is a sub-part of an earlier highlight on the page, the new highlight is automatically tagged `↳ part of "..."` — visible in the side panel and rendered in the `.md` export. The bigger one stays intact.
- **Move between modes anytime.** Each highlight has a **Move** action — promote a per-page note into a notebook, or move it back, without losing anything.
- **Persistent visual highlights.** Saved passages re-appear on every visit, rendered with the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API) — no DOM mutation, so the host page stays untouched.
- **Smart heading breadcrumbs.** Each highlight is tagged with its hierarchical heading path (e.g. `Article › Section A › Subsection 1`) so you always know where it came from.
- **Clean Markdown.** Selections are converted via [Turndown](https://github.com/mixmark-io/turndown) (with GFM) — links, lists, code, emphasis are preserved.
- **Source linkbacks.** Every highlight links to a [Chrome text fragment URL](https://developer.mozilla.org/en-US/docs/Web/Text_fragments) (`#:~:text=...`) that jumps right back to the exact passage in the original page.
- **Side panel.** Three views: **Page** (live notebook for the current tab), **Notebooks** (your projects), **Library** (everything searchable).
- **Live `.md` preview.** Toggle it open on any page or notebook to see exactly what will be downloaded before you click *Download .md*.
- **Keyboard + context menu.** `Ctrl+Shift+H` (or right-click → *Save selection to Notes Maker*) to capture without touching the toolbar.
- **Drafts never get lost.** Everything is stored in `chrome.storage.local`. Closing the browser, tab, or even Chrome itself does not erase a single highlight.
- **Robust to DOM changes.** Highlights are anchored using a text-quote scheme (prefix + exact + suffix), the same approach used by [Hypothesis](https://web.hypothes.is/) and the [W3C Web Annotation spec](https://www.w3.org/TR/annotation-model/). They survive most layout/SPA re-renders.

---

## Install (load unpacked)

```bash
npm install
npm run build
```

Then in Chrome (or any Chromium browser):

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select the `build/chrome-mv3-prod/` folder.

The extension icon appears in the toolbar. Click it to open the side panel — or press `Ctrl+Shift+N`.

### Development mode (with HMR)

```bash
npm run dev
```

Then load `build/chrome-mv3-dev/` the same way. Changes to source files reload the extension automatically.

---

## How to use

### Capturing

1. Open any article, blog post, or web page.
2. Select some text.
3. A floating pill-shaped toolbar appears below the selection — click any color to save the highlight, or press `Ctrl+Shift+H`.

The toolbar is context-aware:

- **New text** → click a color to save.
- **Already-highlighted text** (re-selecting it) → toolbar shows *Already highlighted (yellow)* with the saved color ringed white. Click a different color to **change it**, click **Unhighlight** to remove it from notes, or click the same color and it just dismisses (no duplicate).
- **Selection inside an existing highlight** → toolbar shows *↳ Inside an earlier highlight*. Saving creates a new highlight with a parent link — the side panel and the `.md` export both note it as `↳ part of "..."`.
- **Selection covers earlier highlights** → toolbar shows `↪ Includes N earlier highlights`. Saved as normal; the smaller ones are not deleted.

### Choosing where it goes

Open the side panel (click the icon or `Ctrl+Shift+N`). At the top there's a **Saving to** banner:

- **Per page** — each page becomes its own `.md` file. (Default.)
- **Notebook** — pick an existing notebook, or click *+ New notebook* and give it a name (e.g. `Fuzzing research`). Until you change this, every highlight you save anywhere on the web joins that notebook.

The banner turns **amber** while a notebook is active so you always know where new highlights are landing.

### Browsing & exporting

- **Page** tab — what's saved for the current tab. Edit notes, change colors, copy, delete, *Move* into a notebook, *Preview .md*, or *Download this page .md*.
- **Notebooks** tab — list of your project notebooks. Open one to see all its highlights grouped by source page; rename, delete, set active, and *Download notebook .md* (filename = notebook name).
- **Library** tab — every page you've ever highlighted, with full-text search and *Export all .md*.
- **⋯** tab — keyboard shortcuts, tips, danger zone (delete everything).

Drafts auto-save with every highlight. There is no "publish" step — the side panel always reflects the current state of your notebooks. Closing the browser, tab, or even Chrome itself does not erase a single highlight.

### Highlighting PDFs

PDF support uses a bundled copy of Mozilla's [PDF.js](https://mozilla.github.io/pdf.js/) so highlights, notebooks, and `.md` export work the same way they do on webpages.

- **Online PDFs** (anything ending in `.pdf`): just open the link as usual. A dynamic [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) rule transparently redirects the navigation into Notes Maker's bundled viewer.
- **Local PDFs** (`file:///…/foo.pdf`): same redirect, **plus** you must enable *Allow access to file URLs* on the extension's card at `chrome://extensions`. Without that toggle, Chrome refuses to let any extension see local files at all.
- **Drag-and-drop**: drop a `.pdf` anywhere onto the viewer page to load it without needing a URL.
- **Manual open**: side panel → ⋯ tab → *PDFs → Open PDF in viewer…*. Or right-click a PDF link → *Open PDF in Notes Maker viewer*.
- **Don't want auto-redirect?** Toggle *Auto-open PDFs in our viewer* off in the side panel settings — links to PDFs will then open in Chrome's built-in reader as usual (where highlighting won't work).

Once a PDF is open in the viewer, selecting text shows the same floating toolbar; highlights are saved per file (the page key includes the original file URL or filename).

---

## Architecture

```
notes-maker/
├── background.ts                # Service worker: messaging, downloads, commands, PDF redirect rule
├── sidepanel.tsx                # React side-panel UI
├── contents/
│   └── highlighter.tsx          # Content script: floating toolbar + highlight painting
├── tabs/
│   ├── pdfviewer.tsx            # Bundled PDF.js viewer (rendered as a chrome-extension tab page)
│   └── pdfviewer.css            # Trimmed pdf.js text-layer styles
├── lib/
│   ├── types.ts                 # Highlight, PageEntry, Notebook, Message types
│   ├── storage.ts               # chrome.storage.local helpers + URL keys
│   ├── markdown.ts              # Turndown wrapper + page/library/notebook renderers
│   ├── anchor.ts                # Text-quote range serialization & restoration
│   ├── context.ts               # Heading-path detection + range cleanup
│   └── messages.ts              # Typed sendMessage helpers
├── style.css                    # Tailwind entry
├── tailwind.config.js
├── postcss.config.js
└── package.json                 # Plasmo manifest config + scripts
```

### How highlights re-find themselves

When you save a highlight, the content script records:

```ts
{
  exact:  "the highlighted text",
  prefix: "the 32 chars before it",
  suffix: "the 32 chars after it"
}
```

On page load, every text node is walked, the page text is normalized (whitespace collapsed) and every occurrence of `exact` is scored by how well its surrounding context matches `prefix` + `suffix`. The best match wins, gets converted back to a `Range`, and registered with `CSS.highlights` — which paints it without touching the live DOM.

### Data model

```ts
chrome.storage.local["notes-maker:pages"] = {
  [pageKey]: {
    key, url, title, domain,
    highlights: Highlight[],   // each may have notebookId: string | null
    createdAt, updatedAt
  }
};

chrome.storage.local["notes-maker:notebooks"] = {
  [notebookId]: {
    id, name, description,
    createdAt, updatedAt
  }
};

chrome.storage.local["notes-maker:activeNotebookId"] = string | null;
```

`pageKey` strips the `#fragment` and trailing slash from the URL, so reloading the same article doesn't create a duplicate page. Highlights live under their source page regardless of notebook membership — a notebook is just a label that groups a subset of highlights into one `.md` export.

---

## What this extension does *not* do (yet)

- **Cloud sync.** Notes are local. If you want them in another machine, export the `.md` and put it wherever you keep notes (Obsidian, GitHub, iCloud Drive, etc.).
- **Image highlights.** Selection-based only — text content for now.
- **Scanned PDFs without a text layer.** PDF.js can only select text that's actually present in the PDF. Image-only / scanned PDFs need OCR first; we don't run that for you.

---

## Customizing

- **Shortcuts:** open `chrome://extensions/shortcuts` to rebind `Ctrl+Shift+H` and `Ctrl+Shift+N`.
- **Export format:** `lib/markdown.ts` has the formatting (breadcrumb, blockquote body, source link, note). Tweak there.
- **Highlight colors:** `lib/types.ts → COLOR_HEX`. Add a new entry, then update the `HIGHLIGHT_COLORS` array; the toolbar and side panel pick it up automatically.

---

## Privacy

Nothing you highlight ever leaves your device. There are no servers, no analytics, no third-party SDKs — every byte of your notes lives only in `chrome.storage.local` on this Chrome profile. See [`PRIVACY.md`](./PRIVACY.md) for the full disclosure (and the permission-by-permission justification you'll need when submitting to the Chrome Web Store).

---

## License

MIT. Use it however helps you read better.
