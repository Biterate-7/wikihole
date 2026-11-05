import type { ReaderTerm } from "@/lib/content/terms";

/** Link text longer than this is a phrase rather than a term; the API accepts no longer. */
const MAX_TERM_CHARS = 120;

/**
 * Marks the terms the reader can explain, after hydration, by adding attributes
 * to the links and bold text already on the page. No text node or element is
 * replaced, so selection, React's tree and the server's HTML are all untouched.
 *
 * Only the first use of a term is marked, in running text, and at most one term
 * per paragraph: the point is a few useful handholds, not a page of underlines.
 */

const RUNNING_TEXT = "p, li, dd";
const NOT_RUNNING_TEXT = "table, figure, figcaption, blockquote, details, sup, [data-no-terms]";

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function markable(el: Element, used: Set<Element>): Element | null {
  const block = el.closest(RUNNING_TEXT);
  if (!block || el.closest(NOT_RUNNING_TEXT) || used.has(block)) return null;
  return block;
}

export function markTerms(root: Element, terms: ReaderTerm[]): void {
  const done = new Set<string>();
  const used = new Set<Element>();
  for (const el of root.querySelectorAll("[data-term]")) {
    done.add(norm(el.getAttribute("data-term") ?? ""));
    const block = el.closest(RUNNING_TEXT);
    if (block) used.add(block);
  }

  const byMatch = new Map(terms.map((t) => [norm(t.match), t]));
  if (byMatch.size === 0) return;

  for (const link of root.querySelectorAll("a[data-title]")) {
    const key = norm(link.getAttribute("data-title") ?? "");
    const term = byMatch.get(key);
    if (term?.kind !== "link" || done.has(key) || (link.textContent?.length ?? 0) > MAX_TERM_CHARS) continue;
    const block = markable(link, used);
    if (!block) continue;
    done.add(key);
    used.add(block);
    link.setAttribute("data-term", term.match);
    link.setAttribute("aria-haspopup", "dialog");
  }

  // The article marks definitions in bold, or in italics after "called" and the like.
  for (const strong of root.querySelectorAll("strong, em")) {
    const key = norm(strong.textContent ?? "");
    const term = byMatch.get(key);
    if (term?.kind !== "defined" || done.has(key) || strong.querySelector("a")) continue;
    const block = markable(strong, used);
    if (!block) continue;
    done.add(key);
    used.add(block);
    strong.setAttribute("data-term", term.match);
    strong.setAttribute("aria-haspopup", "dialog");
    strong.setAttribute("role", "button");
    strong.setAttribute("tabindex", "0");
  }
}
