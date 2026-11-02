import { z } from "zod";
import { createStore } from "./store";

/** Persisted user data: saved articles, reading history, exploration trails. */

const thumbnail = z.object({ src: z.string(), width: z.number(), height: z.number() });

export const savedArticleSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(500).optional(),
  extract: z.string().max(2000).optional(),
  thumbnail: thumbnail.optional(),
  readingMinutes: z.number().optional(),
  groupLabel: z.string().optional(),
  savedAt: z.number(),
});
export type SavedArticle = z.infer<typeof savedArticleSchema>;

export const historyEntrySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(500).optional(),
  visitedAt: z.number(),
  trailId: z.string().optional(),
  depth: z.number().optional(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const trailSchema = z.object({
  id: z.string(),
  steps: z.array(z.string().min(1).max(300)).max(200),
  startedAt: z.number(),
  updatedAt: z.number(),
});
export type Trail = z.infer<typeof trailSchema>;

const MAX_SAVED = 500;
const MAX_HISTORY = 300;
const MAX_TRAILS = 20;
const MAX_SEEN = 800;

/**
 * Array schemas drop invalid entries individually rather than discarding the
 * whole list when a single item is malformed.
 */
function lenientArray<T>(item: z.ZodType<T>) {
  return z.array(z.unknown()).transform((items) =>
    items.flatMap((value) => {
      const parsed = item.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

export const savedStore = createStore<SavedArticle[]>({
  key: "saved",
  schema: lenientArray(savedArticleSchema),
  fallback: [],
  sanitize: (items) => items.slice(0, MAX_SAVED),
});

export const historyStore = createStore<HistoryEntry[]>({
  key: "history",
  schema: lenientArray(historyEntrySchema),
  fallback: [],
  sanitize: (items) => items.slice(0, MAX_HISTORY),
});

export const trailsStore = createStore<Trail[]>({
  key: "trails",
  schema: lenientArray(trailSchema),
  fallback: [],
  sanitize: (items) => items.slice(0, MAX_TRAILS),
});

/** The trail being explored in this tab. */
export const currentTrailStore = createStore<Trail | null>({
  key: "trail",
  schema: trailSchema.nullable(),
  fallback: null,
  backend: "session",
});

/** Page ids already shown in the feed this session (avoid repeats on refresh). */
export const seenStore = createStore<number[]>({
  key: "seen",
  schema: z.array(z.number()),
  fallback: [],
  backend: "session",
  sanitize: (ids) => ids.slice(-MAX_SEEN),
});

/* ------------------------------- actions -------------------------------- */

export function isSaved(items: SavedArticle[], title: string): boolean {
  return items.some((i) => i.title === title);
}

export function toggleSaved(article: Omit<SavedArticle, "savedAt">): boolean {
  let nowSaved = false;
  savedStore.set((items) => {
    if (isSaved(items, article.title)) return items.filter((i) => i.title !== article.title);
    nowSaved = true;
    return [{ ...article, savedAt: Date.now() }, ...items];
  });
  return nowSaved;
}

export function removeSaved(title: string): void {
  savedStore.set((items) => items.filter((i) => i.title !== title));
}

export function markSeen(ids: number[]): void {
  if (ids.length === 0) return;
  seenStore.set((existing) => {
    const set = new Set(existing);
    const added = ids.filter((id) => !set.has(id));
    return added.length ? [...existing, ...added] : existing;
  });
}

const PENDING_KEY = "wikihole:v1:pending-from";

/** Remembers that the next article was opened by following a link from `title`. */
export function notePendingNavigation(fromTitle: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, fromTitle);
  } catch {
    // ignore: the trail simply restarts
  }
}

function takePendingNavigation(): string | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}

function newTrailId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Pure trail transition used when an article is opened:
 * - revisiting a step (back navigation, breadcrumb) truncates the trail there;
 * - following a link from the trail's last step extends it;
 * - anything else starts a new trail.
 */
export function advanceTrail(trail: Trail | null, title: string, from: string | null, now = Date.now()): Trail {
  if (trail) {
    const index = trail.steps.indexOf(title);
    if (index >= 0) return { ...trail, steps: trail.steps.slice(0, index + 1), updatedAt: now };
    if (from && trail.steps[trail.steps.length - 1] === from) {
      return { ...trail, steps: [...trail.steps, title].slice(-200), updatedAt: now };
    }
  }
  return { id: newTrailId(), steps: [title], startedAt: now, updatedAt: now };
}

/** Records an article visit: updates the current trail, trail log and history. */
export function recordVisit(title: string, description?: string): Trail {
  const from = takePendingNavigation();
  const trail = advanceTrail(currentTrailStore.get(), title, from);
  currentTrailStore.set(trail);
  // The log keeps the deepest path explored; stepping back up a trail only moves the breadcrumbs.
  trailsStore.set((trails) => {
    const logged = trails.find((t) => t.id === trail.id);
    const isPrefix = logged && trail.steps.every((step, i) => logged.steps[i] === step);
    const entry = isPrefix ? { ...logged, updatedAt: trail.updatedAt } : trail;
    return [entry, ...trails.filter((t) => t.id !== trail.id)];
  });
  historyStore.set((entries) => [
    { title, ...(description ? { description } : {}), visitedAt: Date.now(), trailId: trail.id, depth: trail.steps.length },
    ...entries.filter((e) => e.title !== title),
  ]);
  return trail;
}

export function clearHistory(): void {
  historyStore.reset();
  trailsStore.reset();
  currentTrailStore.reset();
}
