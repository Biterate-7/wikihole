"use client";

import { useSyncExternalStore } from "react";
import type { Store } from "./store";

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.getServerSnapshot);
}

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards (for storage-dependent UI). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
