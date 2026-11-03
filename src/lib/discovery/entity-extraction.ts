import { classifyDisciplines, technicalTermCount, type DisciplineId } from "./topic-classification";

/**
 * Deterministic entity and concept extraction for short technical texts such
 * as Hacker News titles. It works on surface evidence only (casing, acronyms,
 * version-like tokens, technical vocabulary, repetition across the title, body
 * and discussion), so every candidate is a phrase that literally appears in
 * the source. Candidates are hypotheses: the Wikipedia resolver decides which
 * of them actually correspond to an article.
 */

export type CandidateSource = "title" | "text" | "comments" | "ai";

export interface EntityCandidate {
  /** Surface form as it appears in the source. */
  name: string;
  /** Lowercased, whitespace-normalised key used for de-duplication. */
  key: string;
  /** Additional Wikipedia queries (expanded abbreviations). */
  queries: string[];
  /** Shorter phrases contained in this one, tried if it does not resolve ("database" for "database architecture"). */
  fallbacks: string[];
  source: CandidateSource;
  /** How central the phrase is to the submission, 0..1. */
  salience: number;
  /** Times the phrase occurs across title, body and comments. */
  mentions: number;
  /** Why the phrase was selected, for transparency. */
  signals: string[];
  /** Name-like evidence: acronym, internal capitals, digits, or capitals where English would not use them. */
  proper: boolean;
  technical: boolean;
}

export interface ExtractionInput {
  subject: string;
  text?: string;
  comments?: string[];
  domain?: string;
}

export interface ExtractionResult {
  candidates: EntityCandidate[];
  disciplines: Array<{ id: DisciplineId; label: string; score: number }>;
  /** Plain context used for disambiguation (subject, body and discussion excerpts). */
  context: string;
}

/* ------------------------------------------------------------------------ */
/* Vocabulary                                                                */
/* ------------------------------------------------------------------------ */

const STOPWORDS = new Set(
  `a an the and or but nor of to in on at by for from with without into onto over under about above below after before
  during since until via vs versus per as is are was were be been being am do does did doing done have has had having
  i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those
  who whom whose which what when where why how whether if then than so such too very just only also even still now here
  there not no yes can could should would will shall may might must let lets get gets got getting go goes going went
  make makes made making use uses used using build builds built building show ask tell launch hn new news old more most
  less least much many few lot lots some any all every each both either neither other another same own one two three
  four five six seven eight nine ten first second third last next way ways thing things stuff really actually basically
  simply simple easy hard fast faster fastest slow better best good great bad worse worst big bigger small smaller tiny
  huge little long short high low free cheap open introducing announcing announces announced released releases release
  launches launched launching available now today yesterday tomorrow year years month months week weeks day days time
  times hour hours minute minutes ago part guide intro introduction overview tutorial tips tricks lessons learned notes
  thoughts story stories post blog article essay video talk podcast paper book books review reviews update updates
  version versions vs feature features support supports supported anyone someone everyone people person folks users
  user developers developer engineers engineer programmers programmer team company companies here's heres it's its im
  i'm i've ive we're weve we've you're youre don't dont doesn't doesnt can't cant won't wont isn't isnt didn't didnt
  wasn't i'd i'll you'll that's whats what's there's let's using via behind inside within beyond across against toward
  towards among between through throughout upon like unlike almost nearly maybe perhaps probably really quite rather
  again ever never always often sometimes back away off out up down around else instead yet already though although
  because while whereas able unable need needs needed want wants wanted try tries tried trying think thinks thought know
  knows knew known see sees saw seen look looks looking find finds found work works worked working start starts started
  stop stops stopped keep keeps kept give gives gave take takes took come comes came say says said call calls called
  run runs running ran write writes wrote written read reads reading turn turns turned help helps helped mean means
  meant explain explains explained explore explores explored learn learns learning compare comparing compared beat beats
  replace replaces replaced`.split(/\s+/),
);

/** Words that are too broad to be an entity on their own (they may still head a longer phrase). */
const GENERIC = new Set(
  `system systems software hardware computer computers program programs programming tool tools app apps application
  applications project projects platform platforms service services product products solution solutions technology
  technologies tech science research study studies problem problems approach approaches method methods technique
  techniques idea ideas concept concepts design designs data model models code coding performance web internet online
  world life home work job jobs career money business market industry future history problem question questions answer
  answers example examples result results experiment experiments process processes framework frameworks library
  libraries engine engines api apis interface interfaces language languages network networks file files page pages
  site website websites list lists set sets type types game games image images text texts number numbers value values
  state states function functions object objects class classes structure structures pattern patterns layer layers stack
  stacks server servers client clients machine machines device devices chip chips memory storage speed size scale cost
  costs price prices thing open source source edition implementation implementations engineering development
  developments analysis architecture architectures infrastructure security privacy safety quality design system's
  lines line minutes hours month record records step steps level levels alternative alternatives options option
  release releases rewrite rewrites clone clones demo demos prototype prototypes port ports benchmark benchmarks
  explanation explanations visualization visualizations simulation simulations deep dive deep-dive internals
  guarantee guarantees researchers scientists physicists mathematicians engineers hackers founders experts
  startup startups everything nothing something marketplace marketplaces extension extensions era posts
  agents agent`.split(/\s+/),
);

/** Verbs common in headlines; they end a phrase. */
const VERBS = new Set(
  `pass passes passed observe observes observed achieve achieves achieved reach reaches reached hit hits break breaks
  broke cause causes caused reveal reveals revealed discover discovers discovered detect detects detected win wins won
  lose loses lost raise raises raised cut cuts add adds added remove removes removed kill kills killed ship ships
  shipped deal deals adopt adopts adopted drop drops dropped bring brings brought become becomes became enable enables
  enabled allow allows allowed require requires required solve solves solved prove proves proved proven compute
  computes computed generate generates generated outperform outperforms outperformed surpass surpasses surpassed
  improve improves improved grow grows grew fail fails failed fix fixes fixed leak leaks leaked sue sues sued ban bans
  banned acquire acquires acquired introduce introduces introduced unveil unveils unveiled debut debuts debuted
  rewrote rewritten hire hires hired fire fires fired quit quits leave leaves left join joins joined claim claims
  claimed warn warns warned plan plans planned meets offers feels seems appears ends begins began begun gone
  open-sources powers powered save saves saved deal hates loves wrote`.split(/\s+/),
);

/** Nouns that can follow a name to form one ("Linux kernel", "Antikythera mechanism"). */
const HEAD_NOUNS = new Set(
  `kernel mechanism browser engine compiler interpreter language protocol algorithm theorem conjecture lemma
  hypothesis paradox problem effect principle equation formula constant number machine computer processor chip
  architecture project system database library framework server editor shell filesystem format cipher code
  telescope mission probe rover spacecraft satellite rocket reactor collider experiment attack vulnerability bug
  worm virus exploit test sort transform model network calculus distribution function space manifold
  game automaton automata index curve set group lattice hash tree graph filter process operator`.split(/\s+/),
);

/** Common abbreviations and their Wikipedia article names (queries, not results: every expansion is still resolved and validated). */
export const ABBREVIATIONS: Record<string, string[]> = {
  llm: ["Large language model"],
  llms: ["Large language model"],
  ai: ["Artificial intelligence"],
  ml: ["Machine learning"],
  rl: ["Reinforcement learning"],
  nlp: ["Natural language processing"],
  gpu: ["Graphics processing unit"],
  gpus: ["Graphics processing unit"],
  cpu: ["Central processing unit"],
  cpus: ["Central processing unit"],
  tpu: ["Tensor Processing Unit"],
  fpga: ["Field-programmable gate array"],
  asic: ["Application-specific integrated circuit"],
  os: ["Operating system"],
  gc: ["Garbage collection (computer science)"],
  jit: ["Just-in-time compilation"],
  wasm: ["WebAssembly"],
  crdt: ["Conflict-free replicated data type"],
  crdts: ["Conflict-free replicated data type"],
  wal: ["Write-ahead logging"],
  lsm: ["Log-structured merge-tree"],
  mvcc: ["Multiversion concurrency control"],
  acid: ["ACID"],
  dns: ["Domain Name System"],
  bgp: ["Border Gateway Protocol"],
  tcp: ["Transmission Control Protocol"],
  udp: ["User Datagram Protocol"],
  tls: ["Transport Layer Security"],
  ssh: ["Secure Shell"],
  http: ["HTTP"],
  quic: ["QUIC"],
  ebpf: ["eBPF"],
  rpc: ["Remote procedure call"],
  sat: ["Boolean satisfiability problem"],
  smt: ["Satisfiability modulo theories"],
  fft: ["Fast Fourier transform"],
  sql: ["SQL"],
  nosql: ["NoSQL"],
  rnn: ["Recurrent neural network"],
  cnn: ["Convolutional neural network"],
  gan: ["Generative adversarial network"],
  rag: ["Retrieval-augmented generation"],
  ocr: ["Optical character recognition"],
  vm: ["Virtual machine"],
  vms: ["Virtual machine"],
  ssd: ["Solid-state drive"],
  ram: ["Random-access memory"],
  dram: ["Dynamic random-access memory"],
  simd: ["Single instruction, multiple data"],
  isa: ["Instruction set architecture"],
  risc: ["Reduced instruction set computer"],
  "risc-v": ["RISC-V"],
  qc: ["Quantum computing"],
  pki: ["Public key infrastructure"],
  zk: ["Zero-knowledge proof"],
  zkp: ["Zero-knowledge proof"],
  ide: ["Integrated development environment"],
  repl: ["Read–eval–print loop"],
  dsl: ["Domain-specific language"],
  ffi: ["Foreign function interface"],
  orm: ["Object–relational mapping"],
  cdn: ["Content delivery network"],
  p2p: ["Peer-to-peer"],
  iot: ["Internet of things"],
  agi: ["Artificial general intelligence"],
  bci: ["Brain–computer interface"],
  jwst: ["James Webb Space Telescope"],
  lhc: ["Large Hadron Collider"],
  cern: ["CERN"],
  nasa: ["NASA"],
  arpanet: ["ARPANET"],
  "c++": ["C++"],
  "c#": ["C Sharp (programming language)"],
  "f#": ["F Sharp (programming language)"],
  golang: ["Go (programming language)"],
};

/* ------------------------------------------------------------------------ */
/* Tokenisation                                                              */
/* ------------------------------------------------------------------------ */

interface Token {
  raw: string;
  lower: string;
  /** Index in the source sentence (0 = first word). */
  index: number;
  stop: boolean;
  /** Breaks a phrase: sentence punctuation follows this token. */
  boundaryAfter: boolean;
}

const TOKEN_RE = /[A-Za-z0-9.][A-Za-z0-9+#.'’_\-/]*[A-Za-z0-9+#]|[A-Za-z0-9]/g;

/** Adverbs ("extremely", "finally") never belong to a name or a concept. */
const ADVERB = /(?:ally|ely|ily|ously|ively|fully|tly|dly|rly|wly)$/;

function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  for (const match of sentence.matchAll(TOKEN_RE)) {
    const whole = match[0].replace(/[’']s$/i, "").replace(/\.+$/, "").replace(/^\.(?!net$)/i, "");
    if (!whole) continue;
    // "Node.js" stays whole; "TCP/IP" or "and/or" split into words.
    const parts = whole.includes("/") ? whole.split("/") : [whole];
    const end = (match.index ?? 0) + match[0].length;
    const boundary = /^\s*[:;,!?()[\]"“”|—–]|^\.(?:\s|$)|^\s+-\s/.test(sentence.slice(end, end + 3));
    parts.forEach((raw, p) => {
      if (!raw) return;
      const lower = raw.toLowerCase();
      tokens.push({
        raw,
        lower,
        index: index++,
        stop:
          STOPWORDS.has(lower) ||
          VERBS.has(lower) ||
          (ADVERB.test(lower) && lower.length > 4) ||
          /^\d{1,3}$/.test(raw) ||
          /^\d+(?:k|m|x|%|ms|s|gb|mb|kb|tb|hz|mhz|ghz)$/i.test(raw),
        boundaryAfter: p === parts.length - 1 && boundary,
      });
    });
  }
  return tokens;
}

const isAcronym = (raw: string) => /^[A-Z][A-Z0-9+#\-]{1,9}s?$/.test(raw) && /[A-Z]/.test(raw.slice(1));
const hasInnerCapital = (raw: string) => /^[A-Za-z]*[a-z][A-Z]/.test(raw);
const hasDigitsAndLetters = (raw: string) => /\d/.test(raw) && /[A-Za-z]/.test(raw) && raw.length >= 2;
const isCapitalized = (raw: string) => /^[A-Z][a-z]/.test(raw);
const VERSION = /^v?\d+(?:\.\d+)+[a-z]?$/i;
const SPECIAL_NAME = /^(?:c\+\+|c#|f#|\.net|node\.js|next\.js|vue\.js|d3\.js)$/i;

/** Title case ("The Unreasonable Effectiveness Of...") makes capitals uninformative. */
function isTitleCase(tokens: Token[]): boolean {
  const words = tokens.filter((t) => !t.stop && /^[A-Za-z]/.test(t.raw));
  if (words.length < 3) return false;
  return words.filter((t) => isCapitalized(t.raw) || isAcronym(t.raw)).length / words.length > 0.7;
}

type Evidence = "acronym" | "internal capitals" | "alphanumeric name" | "language name" | "capitalised mid-sentence" | "leading name";

function properEvidence(token: Token, titleCase: boolean, isTitle: boolean): Evidence | null {
  if (isAcronym(token.raw)) return "acronym";
  if (hasInnerCapital(token.raw)) return "internal capitals";
  if (hasDigitsAndLetters(token.raw) && !VERSION.test(token.raw)) return "alphanumeric name";
  if (SPECIAL_NAME.test(token.raw)) return "language name";
  if (!titleCase && token.index > 0 && isCapitalized(token.raw) && !GENERIC.has(token.lower)) return "capitalised mid-sentence";
  // Hacker News titles usually lead with their subject ("Ladybird passes Acid3"): a capitalised
  // first word that is not a common or inflected English word is weak evidence of a name.
  if (
    isTitle &&
    !titleCase &&
    token.index === 0 &&
    isCapitalized(token.raw) &&
    !GENERIC.has(token.lower) &&
    !/(?:ing|ed|tion|ness|ment|ies|ers|ists|ians|ants)$/.test(token.lower) &&
    token.raw.length > 2
  ) {
    return "leading name";
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Phrase grammar                                                            */
/* ------------------------------------------------------------------------ */

interface Phrase {
  tokens: Token[];
  text: string;
  key: string;
}

/**
 * Maximal runs of content words. "of" joins two names ("Game of Life",
 * "Bank of England") but never ordinary words ("lines of Zig").
 */
function runs(tokens: Token[], titleCase: boolean): Token[][] {
  const out: Token[][] = [];
  let current: Token[] = [];
  const flush = () => {
    if (current.length) out.push(current);
    current = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = current[current.length - 1];
    const next = tokens[i + 1];
    const joiner =
      t.lower === "of" && !titleCase && prev && next && !next.stop && isCapitalized(prev.raw) && isCapitalized(next.raw) && !prev.boundaryAfter;
    if ((t.stop && !joiner) || VERSION.test(t.raw)) {
      flush();
      continue;
    }
    current.push(t);
    if (t.boundaryAfter) flush();
  }
  flush();
  return out;
}

function phrasesOf(run: Token[], maxLength = 4): Phrase[] {
  const out: Phrase[] = [];
  for (let len = Math.min(maxLength, run.length); len >= 1; len--) {
    for (let start = 0; start + len <= run.length; start++) {
      const tokens = run.slice(start, start + len);
      if (tokens[0].lower === "of" || tokens[tokens.length - 1].lower === "of") continue;
      const text = tokens.map((t) => t.raw).join(" ");
      out.push({ tokens, text, key: normalizeKey(text) });
    }
  }
  return out;
}

export function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countOccurrences(haystack: string, key: string): number {
  if (!key) return 0;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (haystack.match(new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "g")) ?? []).length;
}

/* ------------------------------------------------------------------------ */
/* Extraction                                                                */
/* ------------------------------------------------------------------------ */

const SOURCE_WEIGHT: Record<CandidateSource, number> = { title: 1, text: 0.6, comments: 0.4, ai: 0.8 };

interface Scored {
  score: number;
  proper: boolean;
  allProper: boolean;
  technical: boolean;
  signals: string[];
}

/**
 * Accepts three shapes, which cover what Hacker News titles name:
 * - a name: every word carries name evidence ("Linus Torvalds", "RISC-V", "Acid3");
 * - a name with a head noun ("Linux kernel", "Antikythera mechanism", "Ladybird browser");
 * - a technical noun phrase of up to three words ("write-ahead logging", "memory safety").
 */
function scorePhrase(phrase: Phrase, titleCase: boolean, isTitle: boolean): Scored | null {
  const words = phrase.tokens;
  const evidence = words.map((t) => properEvidence(t, titleCase, isTitle));
  const properCount = evidence.filter(Boolean).length;
  const technicalHits = technicalTermCount(phrase.text);
  const abbreviation = ABBREVIATIONS[phrase.key] !== undefined;
  const first = words[0];
  const last = words[words.length - 1];

  if (words.length === 1 && first.raw.length < 2 && !abbreviation) return null;
  if (/^\d+$/.test(first.raw) && technicalHits === 0) return null;
  if (words.length > 1 && /(?:ing|ed)$/.test(first.lower) && evidence[0] === null) return null;

  const allProper = properCount === words.length;
  const nameWithHead = words.length > 1 && properCount === words.length - 1 && evidence[words.length - 1] === null && HEAD_NOUNS.has(last.lower);
  const generic = words.every((t) => GENERIC.has(t.lower));
  const technicalPhrase = properCount === 0 && technicalHits > 0 && words.length <= 3 && !(generic && words.length === 1);

  if (!(allProper || nameWithHead || technicalPhrase || abbreviation)) return null;

  const leadingOnly = properCount === 1 && evidence[0] === "leading name";
  const weak = allProper && evidence.every((e) => e === "leading name" || e === "capitalised mid-sentence");
  const technical = technicalHits > 0 || abbreviation;
  const signals: string[] = [];
  let score = 0.3;
  if (allProper || nameWithHead) {
    score += leadingOnly ? 0.15 : weak ? 0.22 : 0.32;
    signals.push(evidence.find(Boolean) ?? "name");
  }
  if (technical) {
    score += Math.min(0.3, 0.16 * technicalHits + (abbreviation ? 0.14 : 0));
    signals.push(abbreviation ? "known abbreviation" : "technical vocabulary");
  }
  // A specific multi-word term ("write-ahead logging") is worth more than its parts.
  if (words.length > 1 && (technicalPhrase || nameWithHead)) score += 0.06 * (words.length - 1);
  if (words.length === 4) score -= 0.08;
  if (generic && words.length === 1) score -= 0.2;
  return { score: Math.min(1, score), proper: allProper || nameWithHead, allProper, technical, signals };
}

interface Draft extends EntityCandidate {
  allProper: boolean;
}

function collect(
  source: CandidateSource,
  text: string,
  into: Map<string, Draft>,
  options: { maxPhrases: number; requireSignal?: (c: Scored) => boolean },
): void {
  const found: Draft[] = [];
  for (const sentence of sentences(text)) {
    const tokens = tokenize(sentence);
    const titleCase = source === "title" && isTitleCase(tokens);
    for (const run of runs(tokens, titleCase)) {
      for (const phrase of phrasesOf(run)) {
        const scored = scorePhrase(phrase, titleCase, source === "title");
        if (!scored || (options.requireSignal && !options.requireSignal(scored))) continue;
        found.push({
          name: phrase.text,
          key: phrase.key,
          queries: ABBREVIATIONS[phrase.key] ?? [],
          fallbacks: [],
          source,
          salience: scored.score * SOURCE_WEIGHT[source],
          mentions: 0,
          signals: scored.signals,
          proper: scored.proper,
          allProper: scored.allProper,
          technical: scored.technical,
        });
      }
    }
  }
  found.sort((a, b) => b.salience - a.salience);
  for (const candidate of found.slice(0, options.maxPhrases)) {
    const existing = into.get(candidate.key);
    if (!existing || candidate.salience > existing.salience) {
      into.set(candidate.key, existing ? { ...candidate, signals: [...new Set([...existing.signals, ...candidate.signals])] } : candidate);
    }
  }
}

/**
 * When a longer phrase contains a shorter candidate, the shorter one survives
 * on its own only if it occurs outside the longer phrase, or if it is a name
 * inside a "name + head noun" phrase ("Linux" in "Linux kernel"). Parts of a
 * full name ("Torvalds" in "Linus Torvalds") are dropped. Suppressed parts
 * become fallback queries for the longer phrase.
 */
function suppressContained(candidates: Draft[], corpus: string): Draft[] {
  const words = (key: string) => key.split(" ").length;
  const byLength = [...candidates].sort((a, b) => words(b.key) - words(a.key) || b.salience - a.salience);
  const kept: Draft[] = [];
  for (const candidate of byLength) {
    const containers = kept.filter((k) => k.key !== candidate.key && countOccurrences(k.key, candidate.key) > 0);
    if (containers.length === 0) {
      kept.push(candidate);
      continue;
    }
    const inside = containers.reduce((n, k) => n + countOccurrences(corpus, k.key), 0);
    const standalone = countOccurrences(corpus, candidate.key) - inside > 0;
    const nameInsideHeadPhrase = candidate.allProper && containers.every((k) => !k.allProper);
    if (standalone || nameInsideHeadPhrase) {
      kept.push({ ...candidate, salience: candidate.salience * 0.92 });
    } else {
      for (const container of containers) if (!container.fallbacks.includes(candidate.name)) container.fallbacks.push(candidate.name);
    }
  }
  return kept;
}

/** URLs in posts and comments carry no concepts, only fragments ("https", "github.com user repo"). */
function stripUrls(text: string): string {
  return text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|ai|app|sh|so|co|me|xyz|gg)(?:\/\S*)?/gi, " ");
}

export function extractEntities(input: ExtractionInput, { limit = 14 } = {}): ExtractionResult {
  const subject = input.subject.trim();
  const text = stripUrls(input.text ?? "").slice(0, 2500);
  const comments = (input.comments ?? []).map((c) => stripUrls(c).slice(0, 1200));
  const corpus = normalizeKey([subject, text, ...comments].join("\n"));
  const map = new Map<string, Draft>();

  collect("title", subject, map, { maxPhrases: 16 });
  if (text) collect("text", text, map, { maxPhrases: 10 });
  // The discussion only corroborates: names and technical terms raised by at least two commenters.
  if (comments.length) {
    const fromComments = new Map<string, Draft>();
    comments.forEach((comment) => collect("comments", comment, fromComments, { maxPhrases: 6, requireSignal: (c) => c.proper || c.technical }));
    for (const candidate of fromComments.values()) {
      if (map.has(candidate.key)) continue;
      const commenters = comments.filter((c) => countOccurrences(normalizeKey(c), candidate.key) > 0).length;
      if (commenters >= 2) map.set(candidate.key, { ...candidate, signals: [...candidate.signals, `raised by ${commenters} commenters`] });
    }
  }

  const domainStem = input.domain?.split(".").slice(-2, -1)[0]?.toLowerCase();
  const scored = [...map.values()].map((candidate) => {
    const mentions = Math.max(1, countOccurrences(corpus, candidate.key));
    let salience = candidate.salience + Math.min(0.15, 0.05 * (mentions - 1));
    const signals = [...candidate.signals];
    if (domainStem && domainStem.length > 2 && candidate.key.replace(/[^a-z0-9]/g, "") === domainStem) {
      salience += 0.15;
      signals.push(`matches the submission domain (${input.domain})`);
    }
    if (mentions > 1) signals.push(`${mentions} mentions`);
    return { ...candidate, mentions, salience: Math.min(1, salience), signals };
  });

  const candidates: EntityCandidate[] = suppressContained(scored, corpus)
    .sort((a, b) => b.salience - a.salience)
    .slice(0, limit)
    .map((draft) => {
      const { allProper, ...candidate } = draft;
      void allProper;
      return candidate;
    });

  const disciplines = classifyDisciplines([
    { text: subject, weight: 3 },
    { text, weight: 1 },
    { text: comments.join("\n"), weight: 0.5 },
  ]).slice(0, 5);

  return { candidates, disciplines, context: [subject, text, ...comments].filter(Boolean).join("\n").slice(0, 6000) };
}
