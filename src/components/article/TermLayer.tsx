"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EXPLAIN_LEVELS, type ExplainLevel } from "@/lib/ai/explain-types";
import { fetchTerms } from "@/lib/api-client";
import type { ReaderTerm } from "@/lib/content/terms";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { articlePath } from "@/lib/wikipedia/titles";
import { AiTag, ExplainFailure, ExplainLoading, ExplanationText, useExplanation } from "./Explanation";
import { FloatingPanel } from "./FloatingPanel";
import { markTerms } from "./termMarks";
import styles from "./reading.module.css";

/** Long enough that a pointer crossing the text does not open anything (or spend anything). */
const HOVER_DELAY_MS = 500;
const FOCUS_DELAY_MS = 700;
/** Grace period for moving the pointer from the term into the popover. */
const CLOSE_DELAY_MS = 280;

const LEVEL_LABELS: Record<ExplainLevel, string> = { simple: "Simple", standard: "Standard", advanced: "Advanced" };

interface OpenTerm {
  element: HTMLElement;
  text: string;
  sectionId?: string;
  info?: ReaderTerm;
  /** The reader chose this one (tap, click, or interacting with it), so moving away keeps it open. */
  pinned: boolean;
}

const termElement = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>("[data-term]") : null);

const FOCUSABLE = "a[href], button:not(:disabled)";

export function TermLayer({ title, lang, aiEnabled, rootId }: { title: string; lang: string; aiEnabled: boolean; rootId: string }) {
  const [open, setOpen] = useState<OpenTerm | null>(null);
  const terms = useRef<Map<string, ReaderTerm>>(new Map());
  const panel = useRef<HTMLDivElement>(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const lastPointer = useRef("mouse");
  const current = useRef<OpenTerm | null>(null);

  useEffect(() => {
    current.current = open;
    if (!open) return;
    const { element } = open;
    element.setAttribute("aria-expanded", "true");
    return () => element.setAttribute("aria-expanded", "false");
  }, [open]);

  const close = useCallback((restoreFocus = false) => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    if (restoreFocus) current.current?.element.focus();
    setOpen(null);
  }, []);

  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen((state) => (state && !state.pinned ? null : state));
    }, CLOSE_DELAY_MS);
  }, []);

  const show = useCallback((element: HTMLElement, pinned: boolean) => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setOpen((state) =>
      state?.element === element
        ? { ...state, pinned: state.pinned || pinned }
        : {
            element,
            text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
            sectionId: element.closest("section[id]")?.id,
            info: terms.current.get(element.getAttribute("data-term") ?? ""),
            pinned,
          },
    );
  }, []);

  /* Find and mark the terms, including in sections that stream in later. */
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    let live = true;
    let timer = 0;
    let observer: MutationObserver | undefined;
    fetchTerms(title, lang)
      .then((list) => {
        if (!live) return;
        terms.current = new Map(list.map((t) => [t.match, t]));
        markTerms(root, list);
        observer = new MutationObserver(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => markTerms(root, list), 200);
        });
        observer.observe(root, { childList: true, subtree: true });
      })
      // Without the list the article simply reads as normal.
      .catch(() => {});
    return () => {
      live = false;
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [title, lang, rootId]);

  /* A single set of listeners on the article, rather than one component per term. */
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;

    const onPointerDown = (event: PointerEvent) => {
      lastPointer.current = event.pointerType;
      // Pressing starts a click or a text selection; neither should open a popover mid-gesture.
      window.clearTimeout(openTimer.current);
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const element = termElement(event.target);
      if (!element) return;
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(openTimer.current);
      if (event.buttons !== 0 || !window.getSelection()?.isCollapsed) return;
      openTimer.current = window.setTimeout(() => show(element, false), HOVER_DELAY_MS);
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!termElement(event.target)) return;
      window.clearTimeout(openTimer.current);
      scheduleClose();
    };
    const onClick = (event: MouseEvent) => {
      const element = termElement(event.target);
      if (!element || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const isLink = element.tagName === "A";
      // A mouse click on a link still follows it; a tap has no hover, so it opens the popover, which links onward.
      if (isLink && lastPointer.current === "mouse") return;
      if (!window.getSelection()?.isCollapsed) return;
      event.preventDefault();
      event.stopPropagation();
      show(element, true);
    };
    const onFocusIn = (event: FocusEvent) => {
      const element = termElement(event.target);
      if (!element || !element.matches(":focus-visible")) return;
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => show(element, false), FOCUS_DELAY_MS);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!termElement(event.target)) return;
      window.clearTimeout(openTimer.current);
      if (event.relatedTarget instanceof Node && panel.current?.contains(event.relatedTarget)) return;
      scheduleClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const element = termElement(event.target);
      if (!element) return;
      if ((event.key === "Enter" || event.key === " ") && element.tagName !== "A") {
        event.preventDefault();
        show(element, true);
      }
    };

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerout", onPointerOut);
    // In the capture phase, so a tap can stop the link's client-side navigation.
    root.addEventListener("click", onClick, true);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    };
  }, [rootId, scheduleClose, show]);

  /* While open: Escape closes, Tab from the term enters the popover, clicking elsewhere dismisses it. */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(document.activeElement === open.element || Boolean(panel.current?.contains(document.activeElement)));
        return;
      }
      if (event.key === "Tab" && !event.shiftKey && document.activeElement === open.element) {
        const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
        if (first) {
          event.preventDefault();
          setOpen((state) => (state ? { ...state, pinned: true } : state));
          first.focus();
        }
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || open.element.contains(target)) return;
      setOpen(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <FloatingPanel
      ref={panel}
      key={open.text}
      anchor={() => (open.element.isConnected ? open.element.getClientRects()[0] ?? open.element.getBoundingClientRect() : null)}
      className={styles.popover}
      role="dialog"
      aria-label={`About “${open.text}”`}
      data-testid="term-popover"
      onPointerEnter={() => window.clearTimeout(closeTimer.current)}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") scheduleClose();
      }}
      onPointerDown={() => setOpen((state) => (state ? { ...state, pinned: true } : state))}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && (panel.current?.contains(next) || open.element.contains(next))) return;
        if (next instanceof Node) setOpen(null);
      }}
    >
      <TermBody open={open} articleTitle={title} lang={lang} aiEnabled={aiEnabled} onClose={() => close(true)} />
    </FloatingPanel>
  );
}

function TermBody({
  open,
  articleTitle,
  lang,
  aiEnabled,
  onClose,
}: {
  open: OpenTerm;
  articleTitle: string;
  lang: string;
  aiEnabled: boolean;
  onClose: () => void;
}) {
  const [level, setLevel] = useState<ExplainLevel>("standard");
  const [deeper, setDeeper] = useState<ExplainLevel | null>(null);
  const { info, text, sectionId } = open;
  const article = { title: articleTitle, ...(lang === DEFAULT_LANGUAGE ? {} : { lang }) };
  const base = { ...article, kind: "term" as const, term: text, ...(info?.link ? { link: info.link } : {}), ...(sectionId ? { sectionId } : {}), level };
  const state = useExplanation(aiEnabled ? base : null);
  const deep = useExplanation(aiEnabled && deeper === level ? { ...base, deeper: true } : null);
  const unavailable = !aiEnabled || state.status === "disabled";

  return (
    <>
      <div className={styles.popoverHead}>
        <strong className={styles.popoverTerm} dir="auto">
          {text}
        </strong>
        {open.pinned ? (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        ) : null}
      </div>

      {unavailable ? null : (
        <>
          <div className={styles.levels} role="group" aria-label="Explanation level">
            {EXPLAIN_LEVELS.map((option) => (
              <button key={option} type="button" className={styles.level} aria-pressed={level === option} onClick={() => setLevel(option)}>
                {LEVEL_LABELS[option]}
              </button>
            ))}
          </div>
          <div aria-live="polite" lang={lang} dir="auto">
            {state.status === "loading" ? <ExplainLoading /> : null}
            {state.status === "error" ? <ExplainFailure message={state.message} onRetry={state.retry} /> : null}
            {state.status === "done" ? (
              <>
                <ExplanationText explanation={state.explanation} lang={lang} />
                {state.explanation.simpler && level !== "simple" ? (
                  <p className={styles.simpler}>
                    <span className={styles.simplerLabel}>In simpler words: </span>
                    {state.explanation.simpler}
                  </p>
                ) : null}
                {deep.status === "idle" ? (
                  <button type="button" className={styles.linkButton} onClick={() => setDeeper(level)}>
                    Go deeper
                  </button>
                ) : null}
                {deep.status === "loading" ? <ExplainLoading label="Writing a longer explanation…" /> : null}
                {deep.status === "error" ? <ExplainFailure message={deep.message} onRetry={deep.retry} /> : null}
                {deep.status === "done" ? (
                  <div className={styles.deeper}>
                    <ExplanationText explanation={deep.explanation} lang={lang} />
                  </div>
                ) : null}
                <p className={styles.provenance}>
                  <AiTag /> from this passage and Wikipedia&rsquo;s text. It can misread them.
                </p>
              </>
            ) : null}
          </div>
        </>
      )}

      {info?.link ? (
        <div className={styles.source}>
          {info.description ? (
            <p className={styles.sourceText} lang={lang} dir="auto">
              <span className={styles.sourceLabel}>Wikipedia: </span>
              {info.description}
            </p>
          ) : null}
          {unavailable && info.extract ? (
            <p className={styles.sourceText} lang={lang} dir="auto">
              {info.extract}
            </p>
          ) : null}
          <Link className={styles.sourceLink} href={articlePath(info.link, undefined, lang)} prefetch={false}>
            Read “{info.link}”
          </Link>
        </div>
      ) : unavailable ? (
        <p className={styles.sourceText}>The article defines this term in the surrounding text.</p>
      ) : null}
    </>
  );
}
