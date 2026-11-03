"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SITE_SEARCH_ID, SearchBox } from "./SearchBox";
import styles from "./search.module.css";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Search shortcuts and the narrow-screen search overlay. "/" focuses the
 * header field (or opens the overlay when the field is collapsed into the
 * search icon); Ctrl/Cmd+K always opens the overlay.
 */
export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const combo = (event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey);
      if (!combo && (event.key !== "/" || isTypingTarget(event.target))) return;
      event.preventDefault();
      const field = document.getElementById(`${SITE_SEARCH_ID}-input`);
      if (!combo && field && field.offsetParent !== null) field.focus();
      else setOpen(true);
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
      if (triggerRef.current?.offsetParent) triggerRef.current.focus();
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
        title="Search Wikipedia"
      >
        <Icon name="search" size={20} />
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
              <span>Search Wikipedia</span>
              <button type="button" className="action" onClick={close} aria-label="Close search">
                <Icon name="close" size={14} /> Close
              </button>
            </div>
            <SearchBox variant="dialog" autoFocus onNavigate={close} onEscape={close} />
            <p className={`label ${styles.dialogHint}`}>↑↓ to move · Enter to open · Esc to close</p>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
