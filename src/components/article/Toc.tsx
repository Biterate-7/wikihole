"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PinnableHeader } from "@/components/layout/Chrome";
import type { Heading } from "@/lib/content/types";
import { scrollToSection } from "./scrollToSection";
import styles from "./article.module.css";

type Entry = Heading & { children: Heading[] };

/** How far below the top of the window a heading must pass to count as the one being read. */
const READING_LINE = 96;

function nest(headings: Heading[]): Entry[] {
  const out: Entry[] = [];
  for (const h of headings) {
    if (h.level === 2 || out.length === 0) out.push({ ...h, children: [] });
    else out[out.length - 1].children.push(h);
  }
  return out;
}

/**
 * The heading being read: the last one to have passed the reading line, or null
 * above the first. Only the current section's subheadings are measured, since
 * sections off screen skip layout (content-visibility) and have no positions to read.
 */
function useActiveHeading(tree: Entry[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const passed = (id: string) => {
      const element = document.getElementById(id);
      return element !== null && element.getBoundingClientRect().top <= READING_LINE;
    };
    const update = () => {
      frame = 0;
      let section: Entry | null = null;
      for (const entry of tree) {
        if (passed(entry.id)) section = entry;
        else break;
      }
      if (!section) {
        setActive(null);
        return;
      }
      const sub = section.children.filter((child) => passed(child.id)).pop();
      setActive((sub ?? section).id);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [tree]);
  return active;
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
  window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** Section links scroll smoothly; a modified click still does whatever the browser would. */
function onSectionClick(event: React.MouseEvent, id: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  scrollToSection(id);
}

/**
 * The pinned contents in the left sidebar, as on Wikipedia: "(Top)", the
 * sections, and subsections that unfold under the section being read (or
 * with the toggle). The active section is bold, and the list scrolls itself
 * so that the active section stays in view.
 */
export function Toc({ headings }: { headings: Heading[] }) {
  const tree = useMemo(() => nest(headings), [headings]);
  const active = useActiveHeading(tree);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="location"]');
    const list = nav.current?.parentElement;
    if (!current || !list) return;
    const item = current.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    if (item.top < view.top + 24) list.scrollTop -= view.top + 24 - item.top;
    else if (item.bottom > view.bottom - 24) list.scrollTop += item.bottom - view.bottom + 24;
  }, [active]);

  if (headings.length === 0) return null;

  const activeParent = tree.find((e) => e.id === active || e.children.some((c) => c.id === active))?.id;

  return (
    <nav ref={nav} className={styles.toc} aria-label="Article contents">
      <PinnableHeader label="Contents" panel="toc" place="sidebar" />
      <ul className={styles.tocList}>
        <li className={styles.tocItem}>
          <a href="#" onClick={scrollTop} className={`${styles.tocLink} ${styles.tocTop}`} aria-current={active === null ? "location" : undefined}>
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
              <a href={`#${entry.id}`} onClick={(event) => onSectionClick(event, entry.id)} className={styles.tocLink} aria-current={active === entry.id ? "location" : undefined}>
                {entry.text}
              </a>
              {entry.children.length && open ? (
                <ul className={styles.tocList}>
                  {entry.children.map((child) => (
                    <li key={child.id} className={`${styles.tocItem} ${active === child.id ? styles.tocActive : ""}`}>
                      <a href={`#${child.id}`} onClick={(event) => onSectionClick(event, child.id)} className={styles.tocLink} aria-current={active === child.id ? "location" : undefined}>
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
              <a
                href={`#${h.id}`}
                className={styles.tocLink}
                onClick={(event) => {
                  onSectionClick(event, h.id);
                  close();
                }}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Below the sidebar's breakpoint, or when the contents are hidden: a slim bar
 * that appears once the title has scrolled away, naming the section being read
 * and opening the full contents.
 */
export function SectionBar({ headings }: { headings: Heading[] }) {
  const tree = useMemo(() => nest(headings), [headings]);
  const active = useActiveHeading(tree);
  const [pastTitle, setPastTitle] = useState(false);
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const title = document.querySelector("h1");
    if (!title) return;
    const observer = new IntersectionObserver(([entry]) => {
      setPastTitle(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(title);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        bar.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    bar.current?.querySelector<HTMLElement>('[aria-current="location"]')?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (headings.length === 0) return null;
  const current = headings.find((h) => h.id === active)?.text ?? "Introduction";

  return (
    <div ref={bar} className={styles.sectionBar} hidden={!pastTitle} data-testid="section-bar">
      <button type="button" className={styles.sectionBarButton} aria-expanded={open} aria-label={`Contents. Current section: ${current}`} onClick={() => setOpen((v) => !v)}>
        <TocIcon />
        <span className={styles.sectionBarTitle}>{current}</span>
      </button>
      {open ? (
        <ul className={styles.sectionBarList}>
          {headings.map((h) => (
            <li key={h.id} className={h.level > 2 ? styles.tocSub : undefined}>
              <a
                href={`#${h.id}`}
                className={`${styles.tocLink} ${active === h.id ? styles.sectionBarCurrent : ""}`}
                aria-current={active === h.id ? "location" : undefined}
                onClick={(event) => {
                  onSectionClick(event, h.id);
                  setOpen(false);
                }}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
