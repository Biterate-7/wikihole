import "server-only";

/**
 * Optional AI enrichment configuration. With no key configured the feature is
 * disabled and the product runs on deterministic extraction only.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface AiConfig {
  provider: "anthropic";
  apiKey: string;
  model: string;
}

let warned = false;

export function getAiConfig(): AiConfig | null {
  const provider = (process.env.AI_PROVIDER || "anthropic").trim().toLowerCase();
  const apiKey = (process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return null;
  if (provider !== "anthropic") {
    if (!warned) {
      console.warn(`[wikihole] AI_PROVIDER="${provider}" is not supported; AI enrichment is disabled.`);
      warned = true;
    }
    return null;
  }
  return { provider: "anthropic", apiKey, model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL };
}

export function isAiEnabled(): boolean {
  return getAiConfig() !== null;
}
