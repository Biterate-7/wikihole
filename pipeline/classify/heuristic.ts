/**
 * Rule-based first pass over discussion mentions. It is deliberately strict
 * about what counts as a recommendation, because only that label feeds the
 * statistics: a link alone is never an endorsement. The rules read the words
 * close to the link, not the whole comment, so "I recommend Postgres (see
 * [[Foo]])" does not endorse Foo. See classify/ai.ts for the model-based pass.
 */

export const LABELS = ["recommendation", "interesting", "citation", "casual", "criticism", "spam"] as const;
export type Label = (typeof LABELS)[number];

export const HEURISTIC_VERSION = "heuristic-v7";

export interface MentionInput {
  kind: "comment" | "submission" | "essay";
  source: string;
  context: string;
  title: string;
  discussionTitle: string | null;
  points: number | null;
  linksInText: number;
  wordsInText: number;
  /** The article's short description, when the catalogue knows it. */
  articleDescription?: string | null;
}

export interface Verdict {
  label: Label;
  confidence: number;
  reason: string;
}

/** Threads that ask people for articles worth reading. */
const RECOMMENDATION_THREAD =
  /(favou?rite|best|most interesting|interesting|fascinating|weird(est)?|strangest|coolest|obscure|underrated|surprising)\b[^.?!]{0,40}\bwikipedia\b|\bwikipedia\b[^.?!]{0,40}\b(rabbit ?holes?|favou?rites?|articles? (you|to read|worth)|pages? (you|to read|worth))/i;

/** The page itself is the thing being praised: these name it, so other nouns nearby cannot take the credit. */
const ABOUT_THE_PAGE: Array<[RegExp, string]> = [
  [/\b(wikipedia|wiki)\b[^.?!]{0,50}\b(article|page|entry|history|writeup|write-up)?\b[^.?!]{0,30}\b(is|are|was|has)\b[^.?!]{0,25}\b(great|excellent|fascinating|wonderful|fantastic|amazing|superb|a treat|gripping|riveting|really good|very good|so good|a (good|great|fun|interesting|fascinating|wild|nice) read|worth (a |the )?(read|reading|look)|a rabbit ?hole)\b/i, "praises the Wikipedia page"],
  [/\b(the|this|that) (article|page|entry)\b[^.?!]{0,25}\b(is|are|was)\b[^.?!]{0,20}\b(great|excellent|fascinating|wonderful|fantastic|amazing|superb|a treat|gripping|riveting|really good|very good|so good|a (good|great|fun|fascinating|wild|nice) read|worth (a |the )?(read|reading))\b/i, "praises the article"],
  [/\b(great|excellent|fascinating|wonderful|fantastic|amazing|terrific|brilliant|incredible|lovely|delightful|riveting|wild|gripping|superb|good|fun|interesting) (wikipedia|wiki) (article|page|entry|read)\b/i, "praises the Wikipedia page"],
  [/\brecommend(ed)? (reading )?(the |this |that )?(wikipedia|wiki)\b|\b(wikipedia|wiki)\b[^.?!]{0,30}\bworth (a |the |your )?(read|reading|look|time)\b/i, "recommends the Wikipedia page"],
  [/\bfavou?rite (wikipedia|wiki)\b|\b(my|one of my|personal|all[- ]time) favou?rites?\b[^.?!]{0,30}\b(wikipedia|wiki)\b|\bfavou?rite (article|page|entry) (on|of) (wikipedia|wiki)\b/i, "names it a favourite Wikipedia page"],
  [/\bi (love|adore) (this|that|the) (wikipedia |wiki )?(article|page|entry)\b/i, "says they love the article"],
  [/\bwiki ?(hole|walk)\b|\b(lost|spent|wasted) (hours|an afternoon|a day|an evening|days)\b[^.?!]{0,30}\b(wikipedia|wiki|reading|this|that)\b/i, "describes getting lost in it"],
];

/** Praise that could be about anything nearby: it counts only right next to the link, with no other work named. */
const NEXT_TO_LINK: Array<[RegExp, string]> = [
  [/\brecommend(ed)? (reading|checking out|looking at|learning about)\b/i, "recommends reading it"],
  [/\b(well |definitely |really |totally )?worth\s+(a |the |your )?(read|reading|look|your time|checking out)\b/i, "says it is worth reading"],
  [/\b(great|excellent|fascinating|wonderful|fantastic|amazing|riveting|wild|gripping|superb|good|fun|interesting|enjoyable) (long ?)?read\b/i, "calls it a good read"],
  [/\bmust[- ]read\b|\byou (should|must|need to|have to|ought to)\s+(really |definitely )?(read|check out)\b|\bgo read\b|\bdo yourself a favou?r\b/i, "tells readers to read it"],
  [/\b(fun|great|good|fascinating|deep|nice|wonderful|interesting) (wiki(pedia)? )?rabbit ?hole\b|\bdown (the|that|this|a) (wiki(pedia)? )?rabbit ?hole\b/i, "calls it a rabbit hole worth entering"],
];

/** Another work being recommended: "I recommend his book [[Foo]]" is a pointer, not praise for the page. */
const OTHER_WORK = /\b(book|novel|memoir|biography|podcast|video|film|movie|documentary|series|episode|talk|lecture|paper|album|game|tool|library|app|software|course|textbook|blog|essay|newsletter)\b/i;

/** The article is about a work: "I recommend [[Foo]]" then praises the work, and the link only points to it. */
const WORK_DESCRIPTION =
  /\b(novel|novella|novels|book|film|movie|video game|computer game|board game|album|song|single|short story|television series|tv series|web series|miniseries|documentary|podcast|memoir|comic|manga|anime|poem|play|musical|opera|symphony)\b/i;

/** "It's a good read [1] ... [1] [[Foo]]": a footnote list hides which source the praise belongs to. */
const FOOTNOTED = /\[\d+\]\s*(\[\[|\[link\])/;

const NEGATED = /\b(not|n'?t|never|hardly|barely|wouldn'?t|no)\s+(\w+\s+){0,2}(recommend|worth|great read|good read|must[- ]read|fascinating)\b/i;

const CRITICISM =
  /\b(wikipedia|wiki|article|page|entry)\b[^.?!]{0,60}\b(is|are|was|were|seems?|looks?|reads?)\b[^.?!]{0,30}\b(wrong|inaccurate|misleading|biased|terrible|awful|garbage|bad|useless|incorrect|outdated|out of date|poorly written|confusing|unreadable|a mess|nonsense|propaganda|incomplete)\b|\b(don'?t|can'?t|never|wouldn'?t) trust\b[^.?!]{0,30}\bwiki|\bwikipedia\b[^.?!]{0,30}\b(not a|isn'?t a)\b[^.?!]{0,20}\b(reliable|source)\b|\bcitation needed\b|\bedit war\b/i;

const INTERESTING = /\b(interesting|cool|neat|fun fact|til|today i learned|curious|amusing|hilarious|funny|reminds me|wow|surprising|awesome|bizarre|strange|weird)\b/i;

const CITATION =
  /\baccording to\b|\[\d+\]|\bsee(:| also| e\.g\.|)\b|\bsource\b|\bper\b|\bcf\.|\bdefin(ed|ition)\b|\b(known|referred to) as\b|\bcalled\b|\be\.g\.|\bi\.e\.|\bwikipedia (says|states|describes|claims|lists|notes)\b|\brefers? to\b|\bmeans\b|\bthe term\b|\baka\b|\bfor example\b|\bfor instance\b|\bsuch as\b|\blike\b|\bcontext\b|\bbackground\b|\bexplain/i;

const SPAM = /\b(buy now|casino|viagra|promo code|crypto giveaway|click here to win)\b/i;

const OBITUARY = /\b(has )?(died|dies|dead at|passed away|obituary|rip|r\.i\.p\.?)\b/i;

/** The sentence holding the link and its neighbours, within a fixed reach. */
export function nearLink(context: string, reach = 130): string {
  const at = context.indexOf("[[");
  if (at < 0) return context;
  const end = context.indexOf("]]", at);
  return context.slice(Math.max(0, at - reach), (end < 0 ? at : end) + reach);
}

const SUBMISSION_POINTS = 10;

const words = (text: string) => new Set(text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2));

export function titlesOverlap(article: string, headline: string): boolean {
  const known = words(headline);
  for (const word of words(article)) if (known.has(word)) return true;
  return false;
}

export function classifyHeuristically(input: MentionInput): Verdict {
  if (SPAM.test(input.context)) return { label: "spam", confidence: 0.8, reason: "commercial spam pattern" };

  if (input.kind === "essay") return { label: "recommendation", confidence: 0.9, reason: "listed on a page written to recommend articles" };

  if (input.kind === "submission") {
    const title = input.discussionTitle ?? "";
    if (OBITUARY.test(title)) return { label: "casual", confidence: 0.8, reason: "news of a death, not a reading recommendation" };
    if (CRITICISM.test(title)) return { label: "criticism", confidence: 0.6, reason: "the title disputes the article" };
    const points = input.points ?? 0;
    if (points >= SUBMISSION_POINTS) {
      // Upvotes for a headline that has nothing to do with the page are not upvotes for the page.
      if (!titlesOverlap(input.title, title)) return { label: "recommendation", confidence: 0.4, reason: "submitted under a title unrelated to the article" };
      // The reason is a calibration bucket, so it must not contain the exact score.
      return { label: "recommendation", confidence: Math.min(0.9, 0.6 + Math.log10(points) / 8), reason: points >= 50 ? "submitted; 50 or more points from readers" : "submitted; 10 to 49 points from readers" };
    }
    // Tildes shows no score to anonymous readers, so a submission there stays a reference.
    if (points >= 3 || input.points === null) return { label: "interesting", confidence: 0.5, reason: "submitted, without enough votes to count as endorsed" };
    return { label: "casual", confidence: 0.5, reason: "submitted, with no sign readers endorsed it" };
  }

  const near = nearLink(input.context);
  if (CRITICISM.test(near)) return { label: "criticism", confidence: 0.7, reason: "disputes the article or Wikipedia" };
  const negated = NEGATED.test(near);

  if (!negated && input.discussionTitle && RECOMMENDATION_THREAD.test(input.discussionTitle)) {
    return { label: "recommendation", confidence: 0.9, reason: "offered in a thread asking for Wikipedia articles worth reading" };
  }

  if (!negated) {
    // Long lists dilute an endorsement: praise near one of many links says little about the others.
    const reachable = input.linksInText >= 5 ? nearLink(input.context, 60) : near;
    for (const [pattern, reason] of ABOUT_THE_PAGE) {
      if (pattern.test(reachable)) return { label: "recommendation", confidence: 0.8, reason };
    }
    const close = nearLink(input.context, 70);
    const aboutAWork = input.articleDescription ? WORK_DESCRIPTION.test(input.articleDescription) : false;
    if (!aboutAWork && !OTHER_WORK.test(close) && !FOOTNOTED.test(input.context)) {
      for (const [pattern, reason] of NEXT_TO_LINK) {
        if (pattern.test(close)) return { label: "recommendation", confidence: 0.65, reason };
      }
    }
  }

  if (INTERESTING.test(near)) return { label: "interesting", confidence: 0.6, reason: "points to it as an interesting aside" };
  if (input.linksInText >= 4 || CITATION.test(near)) return { label: "citation", confidence: 0.6, reason: "used as a reference for a claim or term" };
  return { label: "casual", confidence: 0.5, reason: "mentioned without any sign of endorsement" };
}
