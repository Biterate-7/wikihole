"use client";

import { useEffect, useState } from "react";
import type { Heading } from "@/lib/content/types";
import styles from "./article.module.css";

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
      { rootMargin: "-80px 0px -65% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function TocList({ headings, active, onNavigate }: { headings: Heading[]; active: string | null; onNavigate?: () => void }) {
  return (
    <ol className={styles.tocList}>
      {headings.map((h) => (
        <li key={h.id} className={h.level > 2 ? styles.tocSub : undefined}>
          <a href={`#${h.id}`} aria-current={active === h.id ? "location" : undefined} onClick={onNavigate}>
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Sticky desktop contents plus a collapsible mobile variant. */
export function Toc({ headings }: { headings: Heading[] }) {
  const [ids] = useState(() => headings.map((h) => h.id));
  const active = useActiveHeading(ids);
  const [open, setOpen] = useState(false);
  if (headings.length === 0) return null;
  return (
    <>
      <nav className={styles.tocDesktop} aria-label="Article contents">
        <p className="label">Contents</p>
        <TocList headings={headings} active={active} />
      </nav>
      <details className={styles.tocMobile} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <span className="label">Contents</span>
          <span className="label">{headings.filter((h) => h.level === 2).length} sections</span>
        </summary>
        <TocList headings={headings} active={active} onNavigate={() => setOpen(false)} />
      </details>
    </>
  );
}
