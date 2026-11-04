"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const MARGIN = 12;
const GAP = 6;

/**
 * Places a panel beside an anchor, in page coordinates so it scrolls with the
 * text it describes rather than chasing it. It prefers the given side and flips
 * when the viewport has no room there.
 */
function place(panel: HTMLElement, anchor: DOMRect, prefer: "below" | "above"): void {
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(MARGIN, Math.min(anchor.left, viewportWidth - width - MARGIN));
  const fitsBelow = anchor.bottom + GAP + height <= viewportHeight - MARGIN;
  const fitsAbove = anchor.top - GAP - height >= MARGIN;
  const above = prefer === "above" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
  const top = above ? anchor.top - GAP - height : anchor.bottom + GAP;
  panel.style.left = `${left + window.scrollX}px`;
  panel.style.top = `${top + window.scrollY}px`;
}

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  /** Reads the anchor's current position, so the panel can follow layout changes. */
  anchor: () => DOMRect | null;
  prefer?: "below" | "above";
}

/** Only ever rendered in response to a reader's action, so never on the server. */
export const FloatingPanel = forwardRef<HTMLDivElement, Props>(function FloatingPanel({ anchor, prefer = "below", style, ...props }, forwarded) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwarded, () => ref.current as HTMLDivElement);
  const latest = useRef(anchor);

  useEffect(() => {
    latest.current = anchor;
  });

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const update = () => {
      const rect = latest.current();
      if (rect) place(panel, rect, prefer);
    };
    const initial = anchor();
    if (initial) place(panel, initial, prefer);
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
    // Position once on mount; later changes arrive through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefer]);

  return createPortal(<div ref={ref} style={{ position: "absolute", top: 0, left: 0, ...style }} {...props} />, document.body);
});
