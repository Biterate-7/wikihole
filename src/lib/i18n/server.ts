import "server-only";
import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, resolveLanguage } from "./languages";

/**
 * The edition chosen by this request's reader (cookie), for pages that are
 * rendered on demand anyway. Calling it makes a route dynamic, so static
 * pages leave the language to the browser instead.
 */
export async function requestLanguage(): Promise<string> {
  return resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
}
