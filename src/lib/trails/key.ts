import { normalizeTitle } from "@/lib/wikipedia/titles";

/** Case-insensitive key for comparing titles (MediaWiki capitalises only the first letter). */
export function titleKey(title: string): string {
  return normalizeTitle(title).toLowerCase();
}
