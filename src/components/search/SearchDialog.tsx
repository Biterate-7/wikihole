"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SearchBox } from "./SearchBox";
import styles from "./search.module.css";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Header search: a modal opened by the button, "/" or Ctrl/Cmd+K. */
export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const combo = (event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey);
      if (combo || (event.key === "/" && !isTypingTarget(event.target))) {
        // On the home page "/" focuses the inline search instead.
        const inline = document.querySelector<HTMLInputElement>("[data-hero-search] input");
        event.preventDefault();
        if (inline && !combo) inline.focus();
        else setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      dialog.close();
      triggerRef.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Search Wikipedia"
      >
        <Icon name="search" size={14} />
        <span className={styles.triggerText}>Search</span>
        <kbd className={styles.kbd} aria-hidden="true">
          /
        </kbd>
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label="Search Wikipedia"
        onClose={close}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        {open ? (
          <div className={styles.dialogInner}>
            <div className={styles.dialogHead}>
              <span className="label">Search Wikipedia</span>
              <button type="button" className="action" onClick={close} aria-label="Close search">
                Esc <Icon name="close" size={12} />
              </button>
            </div>
            <SearchBox variant="dialog" autoFocus onNavigate={close} onEscape={close} />
            <p className={styles.dialogHint}>
              <span className="label">↑↓ to move · Enter to open · Esc to close</span>
            </p>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
