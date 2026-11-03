"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PinnableHeader } from "@/components/layout/Chrome";
import type { Heading } from "@/lib/content/types";
import styles from "./article.module.css";

type Entry = Heading & { children: Heading[] };

function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const elements = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        if (visible.size) {
          const first = [...visible.entries()].sort((a, b) => a[1] - b[1])[0][0];
          setActive(first);
        }
      },
      { rootMargin: "0px 0px -65% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function nest(headings: Heading[]): Entry[] {
  const out: Entry[] = [];
  for (const h of headings) {
    if (h.level === 2 || out.length === 0) out.push({ ...h, children: [] });
    else out[out.length - 1].children.push(h);
  }
  return out;
}

function TocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="currentColor" d="M3 9h14V7H3zm0 4h14v-2H3zm0 4h14v-2H3zM3 3v2h14V3z" />
    </svg>
  );
}

function scrollTop(event: React.MouseEvent) {
  event.preventDefault();
  window.scrollTo({ top: 0 });
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/**
 * The pinned contents in the left sidebar, as on Wikipedia: "(Top)", the
 * sections, and subsections that unfold under the section being read (or
 * with the toggle). The active section is bold.
 */
export function Toc({ headings }: { headings: Heading[] }) {
  const [ids] = useState(() => headings.map((h) => h.id));
  const active = useActiveHeading(ids);
  const tree = useMemo(() => nest(headings), [headings]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  if (headings.length === 0) return null;

  const activeParent = tree.find((e) => e.id === active || e.children.some((c) => c.id === active))?.id;

  return (
    <nav className={styles.toc} aria-label="Article contents">
      <PinnableHeader label="Contents" panel="toc" place="sidebar" />
      <ul className={styles.tocList}>
        <li className={styles.tocItem}>
          <a href="#" onClick={scrollTop} className={styles.tocLink}>
            (Top)
          </a>
        </li>
        {tree.map((entry) => {
          const open = expanded.has(entry.id) || activeParent === entry.id;
          return (
            <li key={entry.id} className={`${styles.tocItem} ${activeParent === entry.id ? styles.tocActive : ""}`}>
              {entry.children.length ? (
                <button
                  type="button"
                  className={styles.tocToggle}
                  aria-expanded={open}
                  aria-label={`Toggle ${entry.text} subsection`}
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
                    <path fill="currentColor" d="m17.5 4.75-7.5 7.5-7.5-7.5L1 6.25l9 9 9-9z" />
                  </svg>
                </button>
              ) : null}
              <a href={`#${entry.id}`} className={styles.tocLink} aria-current={active === entry.id ? "location" : undefined}>
                {entry.text}
              </a>
              {entry.children.length && open ? (
                <ul className={styles.tocList}>
                  {entry.children.map((child) => (
                    <li key={child.id} className={`${styles.tocItem} ${active === child.id ? styles.tocActive : ""}`}>
                      <a href={`#${child.id}`} className={styles.tocLink} aria-current={active === child.id ? "location" : undefined}>
                        {child.text}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The collapsed contents button before the title (narrow screens, or after
 * "hide"): a dropdown listing every section.
 */
export function TocDropdown({ headings }: { headings: Heading[] }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (headings.length === 0) return null;
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details ref={ref} className={styles.tocDropdown}>
      <summary className={styles.tocSummary} title="Contents">
        <TocIcon />
        <span className="visually-hidden">Contents</span>
      </summary>
      <div className={styles.tocPanel}>
        <div className={styles.tocPanelHead}>
          <span>Contents</span>
          <span className={styles.tocCount}>{headings.filter((h) => h.level === 2).length} sections</span>
        </div>
        <ul className={styles.tocList}>
          <li className={styles.tocItem}>
            <a
              href="#"
              className={styles.tocLink}
              onClick={(e) => {
                scrollTop(e);
                close();
              }}
            >
              (Top)
            </a>
          </li>
          {headings.map((h) => (
            <li key={h.id} className={`${styles.tocItem} ${h.level > 2 ? styles.tocSub : ""}`}>
              <a href={`#${h.id}`} className={styles.tocLink} onClick={close}>
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
