# Privacy Policy — Notes Maker

_Last updated: April 26, 2026_

Notes Maker is a Chrome extension that turns text selections from web pages and PDFs into local Markdown notes. **It does not collect, transmit, or sell any of your data.** Everything you highlight, every note you write, every notebook you create lives only on your computer, inside the Chrome profile that has the extension installed.

This document explains, in plain language, exactly what the extension does and does not do with your information. It is written to satisfy the disclosure requirements of the Chrome Web Store and to be auditable against the source code at <https://github.com/0xmuon/notes-maker>.

---

## Short version

- Notes Maker has **no servers**, no analytics, no telemetry, no crash reporters, no third-party SDKs.
- Nothing you highlight or annotate ever leaves your device.
- The only "remote" requests the extension makes are the ones **you** initiate by visiting a URL in your own browser — for example, when you open a PDF, the extension's PDF viewer fetches that PDF the same way Chrome would.
- The only files the extension creates are the `.md` files you explicitly download by clicking *Download .md*, saved by Chrome's normal download flow to a location you choose.

If you'd like to verify any of this, the entire source code is open and the relevant logic lives in `background.ts`, `contents/highlighter.tsx`, `tabs/pdfviewer.tsx`, and `lib/storage.ts`.

---

## What is stored, and where

All data is kept in [`chrome.storage.local`](https://developer.chrome.com/docs/extensions/reference/api/storage), which is a sandboxed key/value store private to this extension on this Chrome profile. The keys used are:

| Key | Contents |
| --- | --- |
| `notes-maker:pages` | For every page you've highlighted: its URL, page title, domain, and the list of highlights (text, color, your note, heading breadcrumb, source-link fragment, anchor data used to re-locate the highlight on reload, optional `notebookId`, optional `parentId`, timestamps). |
| `notes-maker:notebooks` | The notebooks (projects) you've created: id, name, description, timestamps. |
| `notes-maker:activeNotebookId` | Which notebook, if any, is currently set as the destination for new highlights. |
| `notes-maker:settings` | Your preferences: default highlight color, whether the floating toolbar is shown, whether breadcrumbs/source-links are included in exports, and whether `*.pdf` URLs are auto-opened in the bundled viewer. |

This storage is wiped if you uninstall the extension, clear the extension's storage from `chrome://extensions`, or use the *Delete all saved notes & notebooks* button in the side panel.

The extension does **not** use:

- `chrome.storage.sync` (so nothing syncs to your Google account or other devices);
- `chrome.storage.session`;
- `IndexedDB`, `localStorage`, or cookies under any origin;
- any external database, cloud storage, or backup service.

---

## What is sent over the network

Nothing — by us. The extension's service worker, content script, and side panel make **zero outbound network requests** of their own. There is no analytics endpoint, no error reporting endpoint, no auto-update beacon, no font CDN, no remote configuration.

The only fetches that happen on your behalf are:

1. **The page you're currently visiting.** That's Chrome doing its normal job; the extension just runs a content script on top of it. The host page sees no extra traffic from us.
2. **PDF files you open in our bundled viewer.** When you navigate to a `*.pdf` URL (or open one through the side panel's *Open PDF in viewer* button), the viewer page calls `fetch()` on that URL to read the bytes, then renders them locally with a bundled copy of [PDF.js](https://mozilla.github.io/pdf.js/). The fetch goes to whatever server hosts the PDF (or to your own filesystem for `file://` URLs); it does not pass through any server we control. PDF.js itself does not phone home.

We do not load any remote scripts, iframes, fonts, or images. The PDF.js worker is bundled inside the extension and served from `chrome-extension://<your install id>/`.

---

## Highlight context — what's captured

When you save a highlight, the extension records, locally, the minimum information needed to re-find that passage on reload and to render a clean Markdown export:

- The selected **text** itself, plus the ~32 characters of context immediately before and after it (the "text-quote anchor"), so the highlight can be re-located even if the site re-renders its DOM.
- The page's **URL** and **title** at the time of capture.
- The **heading path** above the selection (e.g. `Article › Section A › Subsection 1`), if present.
- A Chrome **text fragment URL** (`#:~:text=...`) that scrolls back to the passage.
- An optional **note** that you type in the side panel.
- The **color** you chose, and a timestamp.

If you delete a highlight from the side panel, all of the above is removed from `chrome.storage.local` immediately. If you delete the page entry, every highlight on that page is removed. There are no soft deletes, no recycle bin, no remote backup.

---

## Permission justifications

Chrome will surface the following permissions when you install the extension. Each one exists for a single, narrow reason:

- **Read your data on all websites (`<all_urls>` host permission)** — required so the content script can read your text selection and inject the highlight toolbar on whatever page you're reading. We don't read anything you don't actively select.
- **Storage (`storage`)** — to persist your highlights, notebooks, and settings on your device, as described above.
- **Downloads (`downloads`)** — to write `.md` files when you click *Download this page .md*, *Download notebook .md*, or *Export all .md*. We never download anything without an explicit click.
- **Tabs (`tabs`)** — used by the side panel to read the active tab's URL and title (so highlights match the page you're viewing), by the keyboard shortcut and context menu to send a save message to that tab's content script, and by *Open PDF in viewer* to open the bundled viewer in a new tab.
- **Side panel (`sidePanel`)** — to host the main UI in Chrome's side panel.
- **Context menus (`contextMenus`)** — to add the *"Save selection to Notes Maker"* and *"Open PDF in Notes Maker viewer"* right-click options.
- **Declarative net request (`declarativeNetRequest`)** — used **solely** to install one local rule that rewrites top-level navigations to `*.pdf` URLs into the extension's bundled PDF.js viewer, so that you can highlight inside PDFs. The rule never reaches the network, never tracks anything, and is removed entirely when you turn off *Auto-open PDFs in our viewer* in the side panel settings.

We do not use, and have no plans to add: `webRequest`, `cookies`, `history`, `bookmarks`, `topSites`, `geolocation`, `identity`, `system.*`, or any other permission not listed above.

---

## What is **not** collected

To leave no doubt:

- **No personal information.** We do not ask for, store, or transmit your name, email, IP address, account identifiers, or any device fingerprint.
- **No browsing history.** We only record URLs/titles for pages on which you have explicitly saved at least one highlight.
- **No analytics.** No page-view counters, session recorders, A/B testing frameworks, or feature-usage trackers of any kind.
- **No third parties.** No SDKs, ad networks, error trackers, or marketing pixels are bundled or loaded at runtime.
- **No PDF content beyond what's needed to render and select.** The bundled PDF.js viewer parses PDFs entirely in the browser; no part of a PDF's contents is uploaded anywhere.

---

## Children

This extension is intended for general audiences. It does not knowingly collect any information from children, because it does not knowingly collect any information from anyone.

---

## Changes to this policy

If a future version of Notes Maker ever introduces functionality that affects this policy — for example optional cloud sync, a paid tier, or anything else that changes what's stored or transmitted — that change will be:

1. Disclosed in the release notes for that version.
2. Reflected here, with the *Last updated* date at the top bumped accordingly.
3. Made strictly opt-in. The default behavior of the extension will always be the local-only behavior described above.

---

## Contact

Questions, concerns, or audit requests: open an issue at <https://github.com/0xmuon/notes-maker/issues>.
