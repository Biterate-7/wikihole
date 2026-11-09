import type { Thumbnail } from "@/lib/wikipedia/types";

/**
 * Unexpected Connections: a trail from an ordinary article to a surprising
 * one, where every step says why one article leads to the next. Shared by
 * server and client.
 */

/** Why one article leads to the next. */
export interface TrailConnection {
  /** One line, always shown between the two cards. */
  summary: string;
  /** A fuller explanation, shown when the connection is expanded. */
  detail: string;
  /**
   * Wikipedia's own sentence that links the two articles, copied from the
   * earlier article. Generated trails always carry one; it is what makes a
   * generated step verifiable.
   */
  evidence?: { quote: string; source: string };
}

/** A trail as authored or generated: titles and the connections between them. */
export interface TrailDefinition {
  id: string;
  /** Article titles in order: the start, the intermediate articles, the destination. */
  titles: string[];
  /** `connections[i]` explains `titles[i]` → `titles[i + 1]`. */
  connections: TrailConnection[];
  /** Why the destination is surprising, in one sentence. */
  payoff: string;
  /** Curated trails are written by hand; generated ones by the AI and then verified. */
  origin: "curated" | "generated";
}

/** One article on a trail, with whatever Wikipedia could tell us about it. */
export interface TrailStop {
  title: string;
  description?: string;
  thumbnail?: Thumbnail;
  /**
   * "ok": Wikipedia returned metadata. "missing": Wikipedia says the article
   * does not exist (deleted or renamed). "unknown": the metadata request failed,
   * so the card shows the title alone and still links to the reader.
   */
  status: "ok" | "missing" | "unknown";
  /** A trail can be started from this article: a curated path leads on from it, or generation is available. */
  startable: boolean;
}

export interface ResolvedTrail extends Omit<TrailDefinition, "titles"> {
  stops: TrailStop[];
}
