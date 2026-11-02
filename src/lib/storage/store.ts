import type { z } from "zod";

/**
 * A tiny persistent store over localStorage/sessionStorage.
 *
 * - Values are schema-validated on read; malformed or foreign data falls back
 *   to the default instead of crashing the app.
 * - Storage failures (private mode, quota, disabled storage) degrade to an
 *   in-memory value for the session.
 * - Snapshots are referentially stable for useSyncExternalStore, and changes
 *   made in other tabs are picked up via the `storage` event.
 */

export interface Store<T> {
  get(): T;
  getServerSnapshot(): T;
  set(next: T | ((previous: T) => T)): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

type Backend = "local" | "session";

function storageFor(backend: Backend): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return backend === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export interface StoreOptions<T> {
  key: string;
  schema: z.ZodType<T>;
  fallback: T;
  backend?: Backend;
  /** Applied after every read and write, e.g. to cap list length. */
  sanitize?: (value: T) => T;
}

const PREFIX = "wikihole:v1:";

export function createStore<T>({ key, schema, fallback, backend = "local", sanitize = (v) => v }: StoreOptions<T>): Store<T> {
  const storageKey = PREFIX + key;
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cached: T = fallback;
  let memoryOnly = false;

  const read = (): T => {
    if (memoryOnly) return cached;
    const storage = storageFor(backend);
    if (!storage) return cached;
    let raw: string | null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      memoryOnly = true;
      return cached;
    }
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (raw === null) {
      cached = fallback;
      return cached;
    }
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      cached = parsed.success ? sanitize(parsed.data) : fallback;
    } catch {
      cached = fallback;
    }
    return cached;
  };

  const notify = () => listeners.forEach((l) => l());

  const write = (value: T) => {
    cached = sanitize(value);
    const raw = JSON.stringify(cached);
    cachedRaw = raw;
    const storage = storageFor(backend);
    if (storage && !memoryOnly) {
      try {
        storage.setItem(storageKey, raw);
      } catch {
        // Quota exceeded or storage disabled: keep the value for this session.
        memoryOnly = true;
      }
    }
    notify();
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      cachedRaw = undefined;
      notify();
    }
  };

  return {
    get: read,
    getServerSnapshot: () => fallback,
    set(next) {
      const previous = read();
      write(typeof next === "function" ? (next as (p: T) => T)(previous) : next);
    },
    reset() {
      cached = fallback;
      cachedRaw = null;
      const storage = storageFor(backend);
      try {
        storage?.removeItem(storageKey);
      } catch {
        // ignore
      }
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
  };
}
