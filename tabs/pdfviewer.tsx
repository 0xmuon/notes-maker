import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy
} from "pdfjs-dist/types/src/display/api";

import "../style.css";
import "./pdfviewer.css";

// Content scripts don't run on chrome-extension:// pages, so we mount the
// highlight selection UI directly inside the viewer. The component already
// uses inline styles, manages its own state, and reads the current page key
// from `location.href`, so it works identically here.
import HighlighterCSUI from "../contents/highlighter";

// Parcel statically rewrites this URL pattern at build time and emits the
// worker file as a separate asset inside the extension bundle. Resulting URL
// looks like `chrome-extension://<id>/pdf.worker.min.<hash>.js`, which the
// extension can load same-origin.
const workerUrl = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
);

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.toString();

type Status =
  | { kind: "idle" }
  | { kind: "loading"; src: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; numPages: number; src: string; name: string };

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export default function PdfViewer() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [scale, setScale] = useState<number>(1.5);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* -------- loaders -------- */

  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer, name: string, src: string) => {
      try {
        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(data),
          isEvalSupported: false,
          disableAutoFetch: false,
          disableStream: false
        }).promise;
        setDoc(pdf);
        setStatus({
          kind: "ready",
          numPages: pdf.numPages,
          src,
          name
        });
        document.title = `${name} — Notes Maker`;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err ?? "Failed");
        setStatus({ kind: "error", message });
        setDoc(null);
      }
    },
    []
  );

  const loadFromUrl = useCallback(
    async (src: string) => {
      setStatus({ kind: "loading", src });
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const name = friendlyNameFromUrl(src);
        await loadFromArrayBuffer(buf, name, src);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err ?? "Failed");
        setStatus({ kind: "error", message });
      }
    },
    [loadFromArrayBuffer]
  );

  const loadFromFile = useCallback(
    async (file: File) => {
      setStatus({ kind: "loading", src: file.name });
      const buf = await file.arrayBuffer();
      // Use a synthetic URL containing the file name so the page key in
      // chrome.storage stays stable for this PDF across viewer sessions.
      const synthetic =
        chrome.runtime.getURL("tabs/pdfviewer.html") +
        `?local=${encodeURIComponent(file.name)}`;
      // Replace the real URL so highlight storage uses the stable key.
      try {
        history.replaceState(null, "", synthetic);
      } catch {
        // Some Chrome versions don't allow replaceState across origins; safe
        // to ignore — the page key fallback is still consistent enough.
      }
      await loadFromArrayBuffer(buf, file.name, synthetic);
    },
    [loadFromArrayBuffer]
  );

  /* -------- read ?src= on first mount -------- */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get("src");
    if (src) void loadFromUrl(src);
  }, [loadFromUrl]);

  /* -------- render pages whenever doc / scale changes -------- */

  useEffect(() => {
    if (!doc || !containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;

    container.innerHTML = "";

    (async () => {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i);
        if (cancelled) return;
        await renderPage(page, container, scale);
      }
    })().catch((err) => {
      console.error("[pdf viewer] render failed", err);
    });

    return () => {
      cancelled = true;
    };
  }, [doc, scale]);

  /* -------- UI -------- */

  const onPickFile = () => fileInputRef.current?.click();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void loadFromFile(f);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === "application/pdf") void loadFromFile(f);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const zoomIn = () => {
    const next = ZOOM_STEPS.find((s) => s > scale + 0.001);
    if (next !== undefined) setScale(next);
  };
  const zoomOut = () => {
    const next = [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.001);
    if (next !== undefined) setScale(next);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      className="min-h-screen bg-ink-100 dark:bg-ink-900 text-ink-900 dark:text-ink-100 flex flex-col">
      <header className="sticky top-0 z-50 px-4 py-2.5 bg-white/95 dark:bg-ink-800/95 backdrop-blur border-b border-ink-200 dark:border-ink-700 flex items-center gap-3">
        <div className="font-semibold text-sm flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
          Notes Maker · PDF
        </div>

        <div className="flex-1 truncate text-[12px] text-ink-500 dark:text-ink-300">
          {status.kind === "ready" && status.name}
          {status.kind === "loading" && `Loading ${status.src}…`}
          {status.kind === "error" && (
            <span className="text-red-500">Error: {status.message}</span>
          )}
          {status.kind === "idle" && "No PDF loaded"}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={zoomOut}
            disabled={!doc || scale <= ZOOM_STEPS[0]}
            className="px-2 py-1 text-[12px] border border-ink-200 dark:border-ink-700 rounded-md hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-40">
            −
          </button>
          <div className="text-[12px] tabular-nums w-12 text-center">
            {Math.round(scale * 100)}%
          </div>
          <button
            onClick={zoomIn}
            disabled={!doc || scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="px-2 py-1 text-[12px] border border-ink-200 dark:border-ink-700 rounded-md hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-40">
            +
          </button>
        </div>

        <button
          onClick={onPickFile}
          className="px-2.5 py-1 text-[12px] border border-ink-200 dark:border-ink-700 rounded-md hover:bg-ink-50 dark:hover:bg-ink-800">
          Open file
        </button>
        <button
          onClick={() =>
            chrome.runtime.sendMessage({ type: "open-side-panel" })
          }
          className="px-2.5 py-1 text-[12px] bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900 rounded-md hover:opacity-90">
          Open notes panel
        </button>
        <input
          type="file"
          accept="application/pdf,.pdf"
          ref={fileInputRef}
          onChange={onFile}
          className="hidden"
        />
      </header>

      <main className="flex-1">
        {status.kind === "idle" && <EmptyState onPick={onPickFile} />}
        {status.kind === "loading" && (
          <div className="flex items-center justify-center py-24 text-ink-500 text-sm">
            Loading…
          </div>
        )}
        {status.kind === "error" && <ErrorState status={status} />}
        <div ref={containerRef} className="pdf-pages" />
      </main>

      {/* Selection toolbar + highlight painting (same code path as websites). */}
      <HighlighterCSUI />
    </div>
  );
}

/* ---------------------------------------------------------- */

async function renderPage(
  page: PDFPageProxy,
  parent: HTMLElement,
  scale: number
) {
  const viewport = page.getViewport({ scale });

  // CSS pixel size of the page on the screen.
  const cssWidth = Math.floor(viewport.width);
  const cssHeight = Math.floor(viewport.height);

  // Render the canvas at the device pixel ratio so it stays crisp on
  // high-DPI screens. CSS size stays at the viewport size.
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));

  const wrapper = document.createElement("div");
  wrapper.className = "pdfPage";
  wrapper.style.width = `${cssWidth}px`;
  wrapper.style.height = `${cssHeight}px`;
  wrapper.dataset.pageNumber = String(page.pageNumber);

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  wrapper.appendChild(canvas);

  const textLayerEl = document.createElement("div");
  textLayerEl.className = "textLayer";
  // PDF.js v5's setLayerDimensions sizes the text layer using
  // `calc(var(--total-scale-factor) * pageWidth)` and individual spans
  // read `--total-scale-factor` for their font-size. The variable MUST
  // be set before the TextLayer is rendered or every span collapses to
  // font-size 0 and selection wraps randomly across the page.
  textLayerEl.style.setProperty("--total-scale-factor", String(scale));
  // Older pdfjs builds used `--scale-factor`; set both so we work with
  // either bundle.
  textLayerEl.style.setProperty("--scale-factor", String(scale));
  wrapper.appendChild(textLayerEl);

  parent.appendChild(wrapper);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Tell PDF.js to render at DPR by scaling the rendering transform.
  const renderTransform: [number, number, number, number, number, number] | null =
    dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;

  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: renderTransform
  } as Parameters<PDFPageProxy["render"]>[0]).promise;

  const textContent = await page.getTextContent();

  // pdfjs >=4 ships the TextLayer class on the main module. Use a runtime
  // lookup to avoid TS pulling in non-public types.
  const TextLayer = (
    pdfjsLib as unknown as {
      TextLayer?: new (opts: {
        textContentSource: typeof textContent;
        container: HTMLElement;
        viewport: typeof viewport;
      }) => { render: () => Promise<void> };
    }
  ).TextLayer;

  if (TextLayer) {
    const layer = new TextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport
    });
    await layer.render();
  } else {
    // Fallback for older builds that still expose `renderTextLayer`.
    const renderTextLayer = (
      pdfjsLib as unknown as {
        renderTextLayer?: (opts: {
          textContentSource: typeof textContent;
          container: HTMLElement;
          viewport: typeof viewport;
          textDivs: HTMLElement[];
        }) => { promise: Promise<void> };
      }
    ).renderTextLayer;
    if (renderTextLayer) {
      await renderTextLayer({
        textContentSource: textContent,
        container: textLayerEl,
        viewport,
        textDivs: []
      }).promise;
    }
  }

  // Append PDF.js's "endOfContent" sentinel + wire selection management.
  // While the user is actively dragging a selection, we add `.selecting`
  // which expands the sentinel to cover the page, and that prevents the
  // browser from wrapping the selection through unrelated spans.
  const endOfContent = document.createElement("div");
  endOfContent.className = "endOfContent";
  textLayerEl.appendChild(endOfContent);

  const onPointerDown = () => {
    textLayerEl.classList.add("selecting");
    const onUp = () => {
      textLayerEl.classList.remove("selecting");
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };
  textLayerEl.addEventListener("pointerdown", onPointerDown);
}

/* ---------------------------------------------------------- */

function friendlyNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last ?? "document.pdf");
  } catch {
    return "document.pdf";
  }
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 grid place-items-center mb-4 text-xl">
        📄
      </div>
      <h2 className="text-lg font-semibold mb-1.5">Open a PDF</h2>
      <p className="text-sm text-ink-500 max-w-md leading-relaxed mb-5">
        Drop a PDF anywhere on this page, or click <em>Open file</em> in the
        toolbar. Once it loads, select text and the Notes Maker toolbar will
        appear just like on any other webpage.
      </p>
      <button
        onClick={onPick}
        className="px-4 py-2 rounded-md bg-ink-900 text-white text-sm hover:opacity-90 dark:bg-ink-100 dark:text-ink-900">
        Choose PDF…
      </button>
      <div className="mt-6 text-[11px] text-ink-400 max-w-md leading-relaxed">
        Tip: any <code className="font-mono">.pdf</code> URL you open
        (including local <code className="font-mono">file://</code> ones) is
        automatically routed to this viewer when{" "}
        <em>Auto-open PDFs in viewer</em> is enabled in the side panel
        settings. For local files, also enable
        <em> Allow access to file URLs</em> on the extension's{" "}
        <code className="font-mono">chrome://extensions</code> card.
      </div>
    </div>
  );
}

function ErrorState({
  status
}: {
  status: { kind: "error"; message: string };
}) {
  return (
    <div className="px-6 py-12 max-w-xl mx-auto text-center">
      <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-700 grid place-items-center mx-auto mb-4">
        !
      </div>
      <h2 className="text-base font-semibold mb-2">Couldn't load that PDF</h2>
      <p className="text-sm text-ink-500 leading-relaxed mb-4">
        {status.message}
      </p>
      <p className="text-[12px] text-ink-500 leading-relaxed">
        If this is a local file, open the extension's card on{" "}
        <code className="font-mono">chrome://extensions</code> and turn on{" "}
        <em>Allow access to file URLs</em>, then try again.
      </p>
    </div>
  );
}
