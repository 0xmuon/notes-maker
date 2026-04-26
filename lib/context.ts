/**
 * Build a hierarchical heading breadcrumb for a Range.
 *
 * Given a range like:
 *   <h1>Article</h1>
 *   <h2>Section A</h2>
 *   <h3>Subsection 1</h3>
 *   <p>...selected text here...</p>
 *
 * returns ["Article", "Section A", "Subsection 1"].
 */
export function getHeadingPath(range: Range): string[] {
  const start = range.startContainer;
  const ref =
    start.nodeType === Node.ELEMENT_NODE
      ? (start as Element)
      : start.parentElement;
  if (!ref) return [];

  const allHeadings = Array.from(
    document.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6")
  );

  const beforeOrContaining = allHeadings.filter((h) => {
    const pos = h.compareDocumentPosition(ref);
    return (
      h === ref ||
      h.contains(ref) ||
      (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  });

  type Frame = { level: number; text: string };
  const stack: Frame[] = [];
  for (const h of beforeOrContaining) {
    const level = parseInt(h.tagName[1], 10);
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const text = (h.textContent || "").trim();
    if (text) stack.push({ level, text });
  }
  return stack.map((s) => s.text);
}

/**
 * Returns a clean HTML string for the selection that we can hand to Turndown.
 * We clone the contents and strip noisy attributes and elements.
 */
export function rangeToCleanHtml(range: Range): string {
  const fragment = range.cloneContents();
  const wrapper = document.createElement("div");
  wrapper.appendChild(fragment);

  wrapper
    .querySelectorAll("script, style, noscript, iframe, button, svg")
    .forEach((el) => el.remove());

  wrapper.querySelectorAll<HTMLElement>("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n === "href" || n === "src" || n === "alt" || n === "title") continue;
      el.removeAttribute(attr.name);
    }
  });

  return wrapper.innerHTML;
}

export function pageTitle(): string {
  return (
    document.title ||
    (document.querySelector("h1")?.textContent || "").trim() ||
    location.hostname
  );
}
