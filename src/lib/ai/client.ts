import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** One SDK client per server instance, shared by every AI feature. */
export function getClient(apiKey: string): Anthropic {
  client ??= new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  return client;
}
