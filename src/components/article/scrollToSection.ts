/**
 * In-page navigation for a long article. Off-screen sections use
 * content-visibility, so their heights are estimates until rendered, and a
 * scroll aimed by those estimates lands in the wrong place. For the length of a
 * navigation every section renders for real; each then remembers its true
 * height (the `auto` in contain-intrinsic-size), so nothing moves afterwards.
 */

const NAVIGATING = "data-section-nav";

/** Ends the navigation in progress, if any, so a second click takes over cleanly. */
let endCurrent: (() => void) | null = null;

/** Heights are remembered as a frame renders, so one must pass before estimates are allowed back. */
function releaseAfterFrames(onFrame?: () => void): void {
  let frame = window.requestAnimationFrame(() => {
    onFrame?.();
    frame = window.requestAnimationFrame(() => {
      endCurrent = null;
      document.documentElement.removeAttribute(NAVIGATING);
    });
  });
  endCurrent = () => {
    window.cancelAnimationFrame(frame);
    endCurrent = null;
  };
}

/** A smooth scroll to a section, for the contents and other section links. */
export function scrollToSection(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  endCurrent?.();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.setAttribute(NAVIGATING, "");
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  history.pushState(null, "", `#${encodeURIComponent(id)}`);

  // Move keyboard focus along with the view, as following a link would.
  const heading = document.getElementById(`${id}-h`) ?? target;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });

  let timer = 0;
  let readerScrolled = false;
  const onReaderScroll = () => {
    readerScrolled = true;
  };
  const stopListening = () => {
    window.clearTimeout(timer);
    window.removeEventListener("scrollend", finish);
    window.removeEventListener("wheel", onReaderScroll);
    window.removeEventListener("touchstart", onReaderScroll);
  };
  function finish() {
    stopListening();
    releaseAfterFrames(() => {
      // Images finishing on the way can nudge the page; correct that unless the reader has taken over.
      const margin = parseFloat(getComputedStyle(target as Element).scrollMarginTop) || 0;
      if (!readerScrolled && target && Math.abs(target.getBoundingClientRect().top - margin) > 4) target.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }
  endCurrent = () => {
    stopListening();
    endCurrent = null;
  };
  window.addEventListener("scrollend", finish, { once: true });
  window.addEventListener("wheel", onReaderScroll, { passive: true });
  window.addEventListener("touchstart", onReaderScroll, { passive: true });
  // For browsers without scrollend, and scrolls that never start because the target is already in place.
  timer = window.setTimeout(finish, 3000);
}

/**
 * An immediate jump, as for a citation. Going through the location keeps the
 * browser's own behaviour, including the :target highlight on a reference.
 */
export function jumpToAnchor(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  endCurrent?.();
  document.documentElement.setAttribute(NAVIGATING, "");
  if (decodeURIComponent(window.location.hash.slice(1)) === id) target.scrollIntoView({ block: "start" });
  else window.location.hash = encodeURIComponent(id);
  releaseAfterFrames();
}

/** Follows in-page links anywhere in the reader. Returns the cleanup. */
export function handleAnchorLinks(root: Element): () => void {
  const onClick = (event: Event) => {
    const { metaKey, ctrlKey, shiftKey, altKey } = event as MouseEvent;
    if (event.defaultPrevented || metaKey || ctrlKey || shiftKey || altKey || !(event.target instanceof Element)) return;
    const href = event.target.closest("a")?.getAttribute("href");
    if (!href?.startsWith("#") || href.length < 2) return;
    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    if (target.matches("section, h2, h3, h4, h5")) scrollToSection(id);
    else jumpToAnchor(id);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}

/**
 * Arriving at an address with a section in it. The browser made its attempt
 * before the article finished streaming in, so this makes the real one once
 * the target exists.
 */
export function jumpToAddressedSection(): void {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return;
  let tries = 0;
  const attempt = () => {
    if (document.getElementById(id)) jumpToAnchor(id);
    else if (++tries < 40) window.setTimeout(attempt, 150);
  };
  attempt();
}
