import type { GroupId } from "./topics";

/**
 * Vocabulary used by the deterministic classifier and scorer. Terms are word
 * prefixes matched at word boundaries (so "comput" matches "computation").
 */

export const GROUP_TERMS: Record<GroupId, string[]> = {
  "computer-science": [
    "algorithm", "comput", "software", "programming", "data structure", "compiler", "cryptograph", "cipher",
    "encrypt", "protocol", "distributed", "concurren", "operating system", "kernel", "database", "turing",
    "automat", "machine learning", "neural network", "artificial intelligence", "information theory",
    "coding theory", "compression", "hash", "parallel", "processor", "instruction set", "cache", "parsing",
    "type system", "type theory", "lambda calculus", "boolean", "binary", "bit", "byte", "byzantine",
    "consensus", "scheduling", "virtual memory", "file system", "graph theory", "np-", "polynomial time",
    "decidab", "undecidab", "formal language", "grammar", "error correct", "checksum", "network",
  ],
  mathematics: [
    "theorem", "lemma", "conjecture", "mathemat", "algebra", "topolog", "geometr", "number theory", "prime",
    "integer", "manifold", "group theory", "ring theory", "field theory", "set theory", "cardinal", "ordinal",
    "logic", "proof", "probabilit", "stochastic", "combinator", "polynomial", "matrix", "matrices", "equation",
    "calculus", "category theory", "measure theory", "invariant", "isomorph", "homolog", "homotop", "axiom",
    "paradox", "dimension", "knot", "function", "vector space", "eigen", "markov", "random variable",
    "game theory", "equilibrium", "fractal",
  ],
  physics: [
    "physic", "quantum", "particle", "relativ", "thermodynam", "entropy", "cosmolog", "gravit",
    "electromagnet", "optic", "boson", "fermion", "spin", "energy", "mechanics", "plasma", "condensed matter",
    "superconduct", "black hole", "universe", "statistical mechanics", "lattice", "phase transition",
    "photon", "neutrino", "quark", "hadron", "lepton", "spacetime", "dark matter", "dark energy", "inflation",
    "wave function", "hamiltonian", "lagrangian", "symmetry", "ising", "critical point",
  ],
  engineering: [
    "engineering", "aerospace", "rocket", "spacecraft", "propulsion", "aerodynam", "circuit", "electronic",
    "signal processing", "control theory", "control system", "feedback", "robot", "actuator", "sensor",
    "material", "semiconductor", "alloy", "crystal", "metamaterial", "turbine", "oscillator", "transistor",
    "amplifier", "filter", "orbit", "aircraft", "kinematic", "cybernetic", "servo", "composite",
  ],
  biology: [
    "biolog", "neur", "brain", "synap", "gene", "genetic", "genom", "dna", "rna", "protein", "enzyme", "cell",
    "evolution", "species", "molecular", "metabol", "bacteri", "virus", "organism", "phylogen", "cortex",
    "axon", "dendrit", "mutation", "selection", "epigenetic", "chromosom", "receptor", "membrane",
  ],
  economics: [
    "econom", "market", "auction", "mechanism design", "game theory", "equilibrium", "monetary", "inflation",
    "currency", "central bank", "behavioral", "bias", "utility", "voting", "social choice", "finance",
    "incentive", "price", "pricing", "decision theory", "heuristic", "money", "trade", "fair division",
  ],
  curiosities: [
    "paradox", "unsolved", "conjecture", "thought experiment", "hypothetical", "anomal", "mechanical calculator",
    "analog computer", "early computer", "vacuum tube", "obsolete", "historical",
  ],
};

/** Signals of formal, conceptual content. */
export const DEPTH_TERMS = [
  "theorem", "lemma", "conjecture", "proof", "axiom", "formal", "theory", "model", "equation", "formula",
  "algorithm", "complexity", "invariant", "isomorphism", "eigen", "tensor", "hamiltonian", "lagrangian",
  "entropy", "stochastic", "asymptotic", "topolog", "manifold", "homolog", "undecidab", "quantum", "nonlinear",
  "differential", "recursive", "bound", "optimal", "symmetr", "dual", "transform", "operator", "space",
  "mechanism", "principle", "law", "hypothesis", "framework", "abstract", "generaliz", "computab", "polynomial",
];

/** Signals of intellectual surprise or unusualness. */
export const CURIOSITY_TERMS = [
  "paradox", "anomal", "counterintuitive", "counter-intuitive", "unsolved", "open problem", "surprising",
  "unexpected", "puzzle", "mystery", "mysterious", "thought experiment", "hypothetical", "esoteric", "obscure",
  "curious", "strange", "exotic", "accident", "serendip", "illusion", "phenomenon", "earliest", "forgotten",
  "obsolete", "unusual", "controvers", "notorious", "impossib", "infinite", "self-referen", "undecidab",
  "never", "first known", "remarkabl", "bizarre", "weird", "unproven", "speculative",
];

/** Category fragments that mark people. */
export const BIOGRAPHY_CATEGORY = /\b(\d{1,4}s? births|\d{1,4}s? deaths|living people|people from|alumni|recipients of|fellows of the|members of the|year of birth|(?:american|british|german|french|russian|indian|chinese|japanese|italian|canadian|australian|dutch|swiss|polish|hungarian|israeli|swedish|soviet) (?:\w+ )?(?:scientists|mathematicians|physicists|engineers|computer scientists|biologists|economists|chemists|inventors|businesspeople|politicians|writers|philosophers))\b/i;

export const ENTERTAINMENT_CATEGORY = /\b(\d{4}s? films|films? (?:directed|produced|about|set in|based on)|(?:american|british|english-language|documentary|animated|independent|indian|japanese|french) films|film series|albums|songs|singles|video games?|television (?:series|programs|programmes|shows|episodes|films|seasons|channels)|tv series|episodes|novels|fictional characters|characters in|musicians|singers|actors|actresses|(?:rock|pop|musical) (?:music )?groups|anime|manga|comics|soundtracks|discographies|youtubers|podcasts)\b/i;

export const SPORTS_CATEGORY = /\b(football|soccer|basketball|baseball|cricket|rugby|tennis|golf|olympic|athletes|sportspeople|footballers|tournaments|leagues?|seasons|clubs|racing drivers|wrestl|boxers|cyclists|chess players)\b/i;

export const GEOGRAPHY_CATEGORY = /\b(villages|towns|cities|populated places|municipalities|communes|rivers of|mountains of|lakes of|islands of|districts of|neighbourhoods|census-designated|unincorporated communities|railway stations|buildings and structures in|tourist attractions)\b/i;

export const ORGANIZATION_CATEGORY = /\b(companies|corporations|brands|organizations based|non-profit organizations|software companies|startups|universities and colleges|schools in|record labels|political parties)\b/i;

/** Low-curiosity reference entries (gene/protein stubs, chemical compounds). */
export const REFERENCE_ENTRY_CATEGORY = /\b(genes on human chromosome|human proteins|ec \d|protein families|chemical compounds|minor planets|asteroids)\b/i;

/** Short descriptions of commercial products, which rarely make good discoveries. */
export const PRODUCT_DESCRIPTION = /^(?:computer |proprietary |open[- ]source |free )?(?:software|software product|computer program|web browser|software framework|software library|database|database management system|mobile app|website|web service|company|brand)$/i;

export const LIST_TITLE = /^(lists? of|index of|outline of|timeline of|glossary of|comparison of|table of|bibliography of|history of .* in \d{4})\b/i;

export const DATE_TITLE = /^(\d{1,4}( BC| AD| BCE| CE)?|\d{1,4}s|\d{1,2}(st|nd|rd|th) century.*|(january|february|march|april|may|june|july|august|september|october|november|december)( \d{1,2})?|\d{4} in .+)$/i;

export const NUMBER_TITLE = /^\d[\d,]* \(number\)$/i;

/** Builds a word-prefix regex for a list of terms. */
export function termRegex(terms: string[]): RegExp {
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${escaped.join("|")})`, "gi");
}

export function countDistinct(re: RegExp, text: string): number {
  const found = new Set<string>();
  for (const match of text.matchAll(re)) found.add(match[0].toLowerCase());
  return found.size;
}
