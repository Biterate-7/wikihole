"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PANEL_EVENT, setPanelHidden, type Panel } from "./pinning";
import styles from "./layout.module.css";

/** Closes an open <details> dropdown on outside click, Escape and navigation. */
function useDismiss(ref: React.RefObject<HTMLDetailsElement | null>) {
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname, ref]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && !details.contains(event.target as Node)) details.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      const details = ref.current;
      if (event.key !== "Escape" || !details?.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}

/** A compact disclosure menu (Wikipedia's dropdowns): a summary button and a floating panel. */
export function Dropdown({
  label,
  icon,
  className,
  panelClassName,
  hideLabel,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  className?: string;
  panelClassName?: string;
  /** Show only the icon; the label stays available to assistive technology. */
  hideLabel?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismiss(ref);
  return (
    <details ref={ref} className={`${styles.dropdown} ${className ?? ""}`}>
      <summary className={`${styles.dropdownSummary} ${hideLabel ? styles.iconOnly : ""}`} aria-label={hideLabel ? label : undefined} title={hideLabel ? label : undefined}>
        {icon}
        {hideLabel ? null : <span>{label}</span>}
        {hideLabel ? null : <Chevron />}
      </summary>
      <div className={`${styles.dropdownPanel} ${panelClassName ?? ""}`}>{children}</div>
    </details>
  );
}

export function Chevron() {
  return (
    <svg className={styles.chevron} width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="currentColor" d="m17.5 4.75-7.5 7.5-7.5-7.5L1 6.25l9 9 9-9z" />
    </svg>
  );
}

/** "Main menu  [hide]": the heading of a sidebar that can move between the page and a dropdown. */
export function PinnableHeader({ label, panel, place }: { label: string; panel: Panel; place: "sidebar" | "dropdown" | "both" }) {
  return (
    <div className={styles.pinnableHeader}>
      <span className={styles.pinnableLabel}>{label}</span>
      {place !== "dropdown" ? (
        <button type="button" className={`${styles.pinButton} ${styles.hideButton}`} onClick={() => setPanelHidden(panel, true)}>
          hide
        </button>
      ) : null}
      {place !== "sidebar" ? (
        <button
          type="button"
          className={`${styles.pinButton} ${styles.moveToSidebar}`}
          data-panel={panel}
          onClick={(event) => {
            setPanelHidden(panel, false);
            const details = event.currentTarget.closest("details");
            if (details) details.open = false;
          }}
        >
          move to sidebar
        </button>
      ) : null}
    </div>
  );
}

/**
 * "Tools ▾" in the page toolbar: opens the tools column as a dropdown when it
 * is not pinned (narrow screens, or after "hide").
 */
export function ToolsToggle({ controls }: { controls: string }) {
  const pathname = usePathname();
  // Open for the page it was opened on only: navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) =>
    setOpenOn((current) => ((typeof next === "function" ? next(current === pathname) : next) ? pathname : null));
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-tools-open", open);
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !document.getElementById(controls)?.contains(target)) setOpenOn(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenOn(null);
        button.current?.focus();
      }
    };
    const onPanel = () => setOpenOn(null);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener(PANEL_EVENT, onPanel);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(PANEL_EVENT, onPanel);
      document.documentElement.removeAttribute("data-tools-open");
    };
  }, [open, controls]);

  return (
    <button
      ref={button}
      type="button"
      className={`${styles.dropdownSummary} ${styles.toolsToggle}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={() => setOpen((v) => !v)}
    >
      <span>Tools</span>
      <Chevron />
    </button>
  );
}
