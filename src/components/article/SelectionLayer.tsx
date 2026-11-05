"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PassageAction } from "@/lib/ai/explain-types";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { articlePath } from "@/lib/wikipedia/titles";
import { AiTag, ExplainFailure, ExplainLoading, ExplanationText, useExplanation } from "./Explanation";
import { FloatingPanel } from "./FloatingPanel";
import styles from "./reading.module.css";

const MIN_CHARS = 3;
const MAX_CHARS = 4000;
const SETTLE_MS = 180;

const ACTIONS: Array<{ id: PassageAction; label: string; heading: string }> = [
  { id: "explain", label: "Explain", heading: "Explanation" },
  { id: "summarise", label: "Summarise", heading: "Summary" },
  { id: "simplify", label: "Simplify", heading: "In simpler words" },
  { id: "connections", label: "Explore connections", heading: "Connections" },
];

interface Passage {
  text: string;
  links: string[];
  rect: DOMRect;
}

/** The selected words without citation markers or KaTeX's duplicate accessibility copy. */
function readSelection(selection: Selection, root: Element): Passage | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const fragment = range.cloneContents();
  fragment.querySelectorAll("[data-cite], .katex-mathml").forEach((node) => node.remove());
  const text = (fragment.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) return null;
  const links = [...new Set([...fragment.querySelectorAll("a[data-title]")].map((a) => a.getAttribute("data-title") ?? ""))].filter(Boolean).slice(0, 30);
  const rects = range.getClientRects();
  return { text, links, rect: rects[0] ?? range.getBoundingClientRect() };
}

/**
 * The toolbar for a selected passage. It appears only once a selection has
 * settled, never moves the selection, and does nothing while the reader is
 * still dragging. Without a configured model, only the article's own links are
 * offered, since those need no generation.
 */
export function SelectionLayer({ title, lang, aiEnabled, rootId }: { title: string; lang: string; aiEnabled: boolean; rootId: string }) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [action, setAction] = useState<PassageAction | null>(null);
  const [coarse, setCoarse] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const hasResult = useRef(false);

  useEffect(() => {
    hasResult.current = action !== null;
  }, [action]);

  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    let timer = 0;
    let pressed = false;

    const check = () => {
      if (pressed || hasResult.current) return;
      const selection = window.getSelection();
      const next = selection ? readSelection(selection, root) : null;
      setPassage(next);
      if (next) setCoarse(window.matchMedia("(pointer: coarse)").matches);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, SETTLE_MS);
    };
    const onDown = (event: PointerEvent) => {
      if (toolbar.current?.contains(event.target as Node)) return;
      pressed = true;
      setPassage((state) => (hasResult.current ? state : null));
    };
    const onUp = () => {
      pressed = false;
      schedule();
    };
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [rootId]);

  /* Keyboard: Tab moves from a selection into the toolbar, arrows move along it, Escape dismisses. */
  useEffect(() => {
    if (!passage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAction(null);
        setPassage(null);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey && !action && toolbar.current && !toolbar.current.contains(document.activeElement)) {
        const first = toolbar.current.querySelector("button");
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (action && !result.current?.contains(event.target as Node)) {
        setAction(null);
        setPassage(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [passage, action]);

  if (!passage) return null;

  const actions = aiEnabled ? ACTIONS : ACTIONS.filter((a) => a.id === "connections" && passage.links.length > 0);
  if (actions.length === 0) return null;
  const anchor = () => passage.rect;

  if (action) {
    return (
      <FloatingPanel
        ref={result}
        anchor={anchor}
        prefer="below"
        className={styles.popover}
        role="dialog"
        aria-label={ACTIONS.find((a) => a.id === action)?.heading}
        data-testid="passage-result"
      >
        <PassageResult
          title={title}
          lang={lang}
          aiEnabled={aiEnabled}
          passage={passage}
          action={action}
          onClose={() => {
            setAction(null);
            setPassage(null);
          }}
        />
      </FloatingPanel>
    );
  }

  const buttons = (
    <div
      ref={toolbar}
      className={`${styles.toolbar} ${coarse ? styles.toolbarDocked : ""}`}
      role="toolbar"
      aria-label="Tools for the selected passage"
      data-testid="selection-toolbar"
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const items = [...(toolbar.current?.querySelectorAll("button") ?? [])];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length]?.focus();
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          className={styles.toolbarButton}
          // Keep the reader's selection: the press must not move focus or collapse it.
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setAction(a.id)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );

  // On touch screens the system's own selection menu sits by the text, so the toolbar docks at the bottom instead.
  return coarse ? buttons : <FloatingPanel anchor={anchor} prefer="above" style={{ zIndex: 80 }}>{buttons}</FloatingPanel>;
}

function PassageResult({
  title,
  lang,
  aiEnabled,
  passage,
  action,
  onClose,
}: {
  title: string;
  lang: string;
  aiEnabled: boolean;
  passage: Passage;
  action: PassageAction;
  onClose: () => void;
}) {
  const article = { title, ...(lang === DEFAULT_LANGUAGE ? {} : { lang }) };
  const state = useExplanation(aiEnabled ? { ...article, kind: "passage", action, passage: passage.text, ...(passage.links.length ? { links: passage.links } : {}) } : null);
  const heading = ACTIONS.find((a) => a.id === action)?.heading;
  const linksOnly = !aiEnabled || state.status === "disabled";

  return (
    <>
      <div className={styles.popoverHead}>
        <strong className={styles.popoverTerm}>{heading}</strong>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <blockquote className={styles.passage} lang={lang} dir="auto">
        {passage.text}
      </blockquote>
      {linksOnly ? (
        <>
          <p className={styles.sourceLabel}>Articles linked from this passage</p>
          <ul className={styles.connections}>
            {passage.links.map((link) => (
              <li key={link}>
                <Link href={articlePath(link, undefined, lang)} prefetch={false}>
                  {link}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div aria-live="polite" lang={lang} dir="auto">
          {state.status === "loading" ? <ExplainLoading /> : null}
          {state.status === "error" ? <ExplainFailure message={state.message} onRetry={state.retry} /> : null}
          {state.status === "done" ? (
            <>
              <ExplanationText explanation={state.explanation} list={action === "summarise"} lang={lang} />
              <p className={styles.provenance}>
                <AiTag /> Not part of the Wikipedia article. Check it against the text.
              </p>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
