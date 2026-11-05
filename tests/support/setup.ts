import { afterEach, vi } from "vitest";

// Server-side stores stay in memory during tests (persistence tests opt in with a temp directory).
process.env.WIKIHOLE_DATA_DIR ??= ":memory:";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
