import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { TtlCache } from "@/lib/cache";
import { articlePlainText, keyConcepts, rankLinks } from "@/lib/content/concepts";
import type { ArticleDocument } from "@/lib/content/types";
import { getAiConfig } from "./config";
import { isGrounded, normalizeForMatch } from "./grounding";

/**
 * AI enrichment for the reader. The model sees only retrieved Wikipedia text;
 * every claim must carry a verbatim quote that we verify against that text,
 * and "read next" suggestions must be articles the source actually links to.
 * Anything that fails verification is dropped before it reaches the UI.
 */

const evidenced = { evidence: z.string() };

const InsightsSchema = z.object({
  complexity: z.number(),
  complexityRationale: z.string(),
  whyInteresting: z.array(z.object({ point: z.string(), ...evidenced })),
  prerequisites: z.array(z.object({ concept: z.string(), ...evidenced })),
  keyIdeas: z.array(z.object({ idea: z.string(), ...evidenced })),
  terms: z.array(z.object({ term: z.string(), explanation: z.string(), ...evidenced })),
  readNext: z.array(z.object({ title: z.string(), reason: z.string() })),
});
type RawInsights = z.infer<typeof InsightsSchema>;

export interface Insights {
  title: string;
  revId: number;
  model: string;
  complexity: number;
  complexityRationale: string;
  whyInteresting: Array<{ point: string; evidence: string }>;
  prerequisites: Array<{ concept: string; evidence: string; linked?: string }>;
  keyIdeas: Array<{ idea: string; evidence: string }>;
  terms: Array<{ term: string; explanation: string; evidence: string }>;
  readNext: Array<{ title: string; reason: string }>;
  /** Items removed because their evidence was not found in the article. */
  rejected: number;
}

export class InsightsError extends Error {
  constructor(
    message: string,
    readonly code: "disabled" | "refused" | "failed",
  ) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You annotate Wikipedia articles for WikiHole, a site for technically curious readers.
You will receive the text of one Wikipedia article and a list of articles it links to.

Rules:
- Use only the supplied article text. Do not add facts from memory, even if you are confident.
- Every item with an "evidence" field must quote 6 to 30 consecutive words copied exactly from the article text, without changes, so it can be verified by string matching.
- "readNext" titles must be copied exactly from the supplied list of linked articles.
- complexity is an integer 1 (accessible to anyone) to 5 (graduate-level), judged from the concepts the text relies on.
- Return at most 3 whyInteresting points, 5 prerequisites, 5 keyIdeas, 6 terms and 4 readNext items. Prefer fewer, well-supported items over many weak ones.
- Write plainly and concretely. No hype.`;

const cache = new TtlCache<Insights>(500, 24 * 60 * 60 * 1000);
let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  client ??= new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  return client;
}

export function verifyInsights(raw: RawInsights, doc: ArticleDocument, source: string, model: string): Insights {
  const normalized = normalizeForMatch(source);
  const linkTitles = new Map(doc.links.map((l) => [l.title.toLowerCase(), l.title]));
  let rejected = 0;
  const keep = <T extends { evidence: string }>(items: T[], max: number): T[] => {
    const out: T[] = [];
    for (const item of items) {
      if (out.length >= max) break;
      if (isGrounded(item.evidence, normalized)) out.push({ ...item, evidence: item.evidence.trim() });
      else rejected++;
    }
    return out;
  };
  const readNext: Insights["readNext"] = [];
  for (const item of raw.readNext) {
    const title = linkTitles.get(item.title.trim().toLowerCase());
    if (title && title !== doc.title && !readNext.some((r) => r.title === title) && readNext.length < 4) {
      readNext.push({ title, reason: item.reason.trim() });
    } else if (!title) rejected++;
  }
  return {
    title: doc.title,
    revId: doc.revId,
    model,
    complexity: Math.min(5, Math.max(1, Math.round(raw.complexity))),
    complexityRationale: raw.complexityRationale.trim(),
    whyInteresting: keep(raw.whyInteresting, 3),
    prerequisites: keep(raw.prerequisites, 5).map((p) => {
      const linked = linkTitles.get(p.concept.trim().toLowerCase());
      return linked ? { ...p, linked } : p;
    }),
    keyIdeas: keep(raw.keyIdeas, 5),
    terms: keep(raw.terms, 6),
    readNext,
    rejected,
  };
}

export async function generateInsights(doc: ArticleDocument): Promise<Insights> {
  const config = getAiConfig();
  if (!config) throw new InsightsError("AI enrichment is not configured", "disabled");

  return cache.getOrLoad(`${doc.pageId}|${doc.revId}|${config.model}`, async () => {
    const source = articlePlainText(doc, 40000);
    const linked = rankLinks(doc.links)
      .slice(0, 80)
      .map((l) => l.title);
    const concepts = keyConcepts(doc, 10).map((c) => c.title);

    const response = await getClient(config.apiKey).beta.messages.parse({
      model: config.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(InsightsSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `<article title="${doc.title.replace(/"/g, "'")}">\n${source}\n</article>\n\n<linked_articles>\n${linked.join("\n")}\n</linked_articles>\n\n<most_linked_concepts>\n${concepts.join("\n")}\n</most_linked_concepts>`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new InsightsError("The model declined to analyse this article", "refused");
    }
    if (!response.parsed_output) throw new InsightsError("The model returned an unusable response", "failed");
    return verifyInsights(response.parsed_output, doc, source, response.model);
  });
}
