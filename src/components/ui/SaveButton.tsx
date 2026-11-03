"use client";

import { isSaved, savedStore, toggleSaved, type SavedArticle } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { Icon } from "./Icon";
import styles from "./ui.module.css";

interface Props {
  article: Omit<SavedArticle, "savedAt">;
  /** "action": inline link; "button": Codex button; "star": the page toolbar's watch star. */
  variant?: "action" | "button" | "star";
}

export function SaveButton({ article, variant = "action" }: Props) {
  const saved = useStore(savedStore);
  const hydrated = useHydrated();
  const active = hydrated && isSaved(saved, article.title, article.lang);
  const label = active ? `Remove ${article.title} from saved` : `Save ${article.title}`;
  if (variant === "star") {
    return (
      <button
        type="button"
        className={styles.star}
        aria-pressed={active}
        aria-label={label}
        title={active ? "Remove this article from your saved articles" : "Save this article to read later"}
        onClick={() => toggleSaved(article)}
        data-testid="save-button"
      >
        <Icon name={active ? "star-filled" : "star"} size={20} />
      </button>
    );
  }
  return (
    <button
      type="button"
      className={variant === "button" ? "btn" : "action"}
      aria-pressed={active}
      aria-label={label}
      onClick={() => toggleSaved(article)}
      data-testid="save-button"
    >
      <Icon name={active ? "bookmark-filled" : "bookmark"} size={variant === "button" ? 16 : 13} />
      {active ? "Saved" : "Save"}
    </button>
  );
}
