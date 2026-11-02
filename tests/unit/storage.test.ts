// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  advanceTrail,
  clearHistory,
  currentTrailStore,
  historyStore,
  isSaved,
  markSeen,
  notePendingNavigation,
  recordVisit,
  removeSaved,
  savedStore,
  seenStore,
  toggleSaved,
  trailsStore,
} from "@/lib/storage/collections";
import { createStore } from "@/lib/storage/store";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  for (const store of [savedStore, historyStore, trailsStore, currentTrailStore, seenStore]) store.reset();
});

describe("createStore", () => {
  const make = (key: string) => createStore({ key, schema: z.array(z.number()), fallback: [] as number[] });

  it("persists values across store instances (a page refresh)", () => {
    make("nums").set([1, 2, 3]);
    expect(make("nums").get()).toEqual([1, 2, 3]);
    expect(JSON.parse(localStorage.getItem("wikihole:v1:nums")!)).toEqual([1, 2, 3]);
  });

  it("returns referentially stable snapshots", () => {
    const store = make("stable");
    store.set([1]);
    expect(store.get()).toBe(store.get());
  });

  it("falls back on malformed JSON and on schema mismatches", () => {
    localStorage.setItem("wikihole:v1:bad", "{not json");
    expect(make("bad").get()).toEqual([]);
    localStorage.setItem("wikihole:v1:wrong", JSON.stringify({ hello: "world" }));
    expect(make("wrong").get()).toEqual([]);
  });

  it("keeps working in memory when storage throws (quota, private mode)", () => {
    const store = make("quota");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    store.set([9]);
    expect(store.get()).toEqual([9]);
    spy.mockRestore();
  });

  it("notifies subscribers, including for changes from other tabs", () => {
    const store = make("events");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set([1]);
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.setItem("wikihole:v1:events", JSON.stringify([5]));
    window.dispatchEvent(new StorageEvent("storage", { key: "wikihole:v1:events" }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toEqual([5]);
    unsubscribe();
  });
});

describe("saved articles", () => {
  it("saves, persists and removes", () => {
    expect(toggleSaved({ title: "Halting problem", description: "Problem in computer science" })).toBe(true);
    expect(isSaved(savedStore.get(), "Halting problem")).toBe(true);
    expect(JSON.parse(localStorage.getItem("wikihole:v1:saved")!)[0].title).toBe("Halting problem");
    expect(toggleSaved({ title: "Halting problem" })).toBe(false);
    expect(savedStore.get()).toEqual([]);
    toggleSaved({ title: "Busy beaver" });
    removeSaved("Busy beaver");
    expect(savedStore.get()).toEqual([]);
  });

  it("drops only the malformed entries of a partially corrupted list", () => {
    localStorage.setItem(
      "wikihole:v1:saved",
      JSON.stringify([{ title: "Good", savedAt: 1 }, { title: 42 }, null, { savedAt: 2 }, { title: "Also good", savedAt: 3 }]),
    );
    expect(savedStore.get().map((s) => s.title)).toEqual(["Good", "Also good"]);
  });
});

describe("exploration trails and history", () => {
  it("extends, truncates and restarts trails", () => {
    const start = advanceTrail(null, "Halting problem", null, 1);
    expect(start.steps).toEqual(["Halting problem"]);
    const deeper = advanceTrail(start, "Turing machine", "Halting problem", 2);
    expect(deeper.steps).toEqual(["Halting problem", "Turing machine"]);
    expect(deeper.id).toBe(start.id);
    const deepest = advanceTrail(deeper, "Computability theory", "Turing machine", 3);
    expect(advanceTrail(deepest, "Halting problem", null, 4).steps).toEqual(["Halting problem"]);
    const unrelated = advanceTrail(deepest, "Enigma machine", null, 5);
    expect(unrelated.steps).toEqual(["Enigma machine"]);
    expect(unrelated.id).not.toBe(deepest.id);
  });

  it("records visits with trail depth and keeps history de-duplicated", () => {
    recordVisit("Halting problem", "Problem in computer science");
    notePendingNavigation("Halting problem");
    recordVisit("Turing machine");
    expect(currentTrailStore.get()?.steps).toEqual(["Halting problem", "Turing machine"]);
    expect(historyStore.get().map((h) => [h.title, h.depth])).toEqual([
      ["Turing machine", 2],
      ["Halting problem", 1],
    ]);
    recordVisit("Halting problem");
    expect(historyStore.get().map((h) => h.title)).toEqual(["Halting problem", "Turing machine"]);
    expect(trailsStore.get()).toHaveLength(1);
    // Stepping back moves the breadcrumbs but the log keeps the deepest path explored.
    expect(currentTrailStore.get()?.steps).toEqual(["Halting problem"]);
    expect(trailsStore.get()[0].steps).toEqual(["Halting problem", "Turing machine"]);
    clearHistory();
    expect(historyStore.get()).toEqual([]);
    expect(trailsStore.get()).toEqual([]);
  });

  it("tracks seen feed items without duplicates", () => {
    markSeen([1, 2]);
    markSeen([2, 3]);
    expect(seenStore.get()).toEqual([1, 2, 3]);
  });
});
