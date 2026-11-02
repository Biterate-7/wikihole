import type { PageMeta } from "@/lib/wikipedia/types";

let nextId = 1000;

/** Builds a realistic PageMeta for tests. */
export function meta(overrides: Partial<PageMeta> = {}): PageMeta {
  return {
    pageId: nextId++,
    title: `Article ${nextId}`,
    description: "Theorem in computability theory",
    extract:
      "In computability theory, this theorem states that every non-trivial semantic property of programs is undecidable. It generalises the halting problem and has consequences for static analysis of algorithms.",
    length: 24000,
    disambiguation: false,
    assessment: "B",
    recentViews: 600,
    categories: ["Computability theory", "Theorems in the foundations of mathematics", "Undecidable problems"],
    ...overrides,
  };
}
