"use client";

import { isSaved, savedStore, toggleSaved, type SavedArticle } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { Icon } from "./Icon";

interface Props {
  article: Omit<SavedArticle, "savedAt">;
  variant?: "action" | "button";
}

export function SaveButton({ article, variant = "action" }: Props) {
  const saved = useStore(savedStore);
  const hydrated = useHydrated();
  const active = hydrated && isSaved(saved, article.title, article.lang);
  return (
    <button
      type="button"
      className={variant === "button" ? "btn" : "action"}
      aria-pressed={active}
      aria-label={active ? `Remove ${article.title} from saved` : `Save ${article.title}`}
      onClick={() => toggleSaved(article)}
      data-testid="save-button"
    >
      <Icon name={active ? "bookmark-filled" : "bookmark"} size={12} />
      {active ? "Saved" : "Save"}
    </button>
  );
}
