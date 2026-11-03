import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";

/**
 * Durable server-side storage for processed data (e.g. Hacker News rabbit
 * holes), so work survives restarts and is never repeated needlessly.
 *
 * Each store is one JSON document, validated on load, written atomically
 * (temp file + rename) and debounced. The directory is WIKIHOLE_DATA_DIR,
 * defaulting to `.data/` in the project; if it is not writable (read-only
 * serverless filesystems) the store falls back to the OS temp directory, and
 * then to memory. WIKIHOLE_DATA_DIR=":memory:" disables disk entirely.
 * Storage failures never break a request.
 */

export interface DocumentStore<T> {
  /** Loads the document once (validated); later calls return the in-memory copy. */
  read(): Promise<T>;
  /** Replaces the document and schedules a write. */
  write(next: T): void;
  /** Writes immediately (tests, shutdown). */
  flush(): Promise<void>;
  /** Where the document is stored ("memory" when not on disk). */
  location(): string;
}

const WRITE_DELAY_MS = 750;

function candidates(): string[] {
  const configured = process.env.WIKIHOLE_DATA_DIR?.trim();
  if (configured === ":memory:") return [];
  return [configured || join(process.cwd(), ".data"), join(tmpdir(), "wikihole")];
}

export function createDocumentStore<T>(name: string, schema: z.ZodType<T>, fallback: () => T): DocumentStore<T> {
  let value: T | undefined;
  let loading: Promise<T> | undefined;
  let directory: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const file = (dir: string) => join(dir, `${name}.json`);

  async function writableDirectory(): Promise<string | null> {
    if (directory !== undefined) return directory;
    for (const dir of candidates()) {
      try {
        await mkdir(dir, { recursive: true });
        directory = dir;
        return dir;
      } catch {
        // try the next location
      }
    }
    directory = null;
    return null;
  }

  async function load(): Promise<T> {
    for (const dir of candidates()) {
      try {
        const raw = await readFile(file(dir), "utf8");
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          directory = dir;
          return parsed.data;
        }
        console.warn(`[wikihole] ignoring invalid ${name} store at ${dir}`);
      } catch {
        // missing or unreadable: try the next location
      }
    }
    return fallback();
  }

  async function persist(): Promise<void> {
    if (value === undefined) return;
    const dir = await writableDirectory();
    if (!dir) return;
    const target = file(dir);
    const temp = `${target}.${process.pid}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value), "utf8");
      await rename(temp, target);
    } catch (error) {
      // A read-only or full disk degrades to memory for this process.
      console.warn(`[wikihole] could not persist ${name}:`, error instanceof Error ? error.message : error);
      directory = null;
    }
  }

  return {
    async read() {
      if (value !== undefined) return value;
      loading ??= load().then((loaded) => {
        value ??= loaded;
        return value;
      });
      return loading;
    },
    write(next) {
      value = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        writing = writing.then(persist);
      }, WRITE_DELAY_MS);
      timer.unref?.();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      writing = writing.then(persist);
      await writing;
    },
    location() {
      return directory ? file(directory) : "memory";
    },
  };
}
