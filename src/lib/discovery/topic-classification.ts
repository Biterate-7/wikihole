import { countDistinct, termRegex } from "./lexicon";

/**
 * Discipline classifier for discovery sources whose text is short and informal
 * (Hacker News titles, Ask HN bodies). Like the Wikipedia feed's lexicon, terms
 * are word prefixes matched at word boundaries. The same classifier runs over
 * resolved Wikipedia descriptions and categories, so a submission's
 * disciplines end up grounded in the articles it maps to.
 */

export type DisciplineId =
  | "ai"
  | "programming-languages"
  | "systems"
  | "data"
  | "security"
  | "hardware"
  | "theory"
  | "mathematics"
  | "physics"
  | "biology"
  | "space"
  | "open-source"
  | "history"
  | "startups"
  | "philosophy"
  | "economics";

export interface Discipline {
  id: DisciplineId;
  label: string;
  /** Relative interest for WikiHole's audience (0..1): the configurable topic preference. */
  interest: number;
  terms: string[];
}

export const DISCIPLINES: Discipline[] = [
  {
    id: "ai",
    label: "AI & machine learning",
    interest: 0.95,
    terms: [
      "artificial intelligence", "machine learning", "deep learning", "neural net", "llm", "large language model",
      "language model", "transformer", "gpt", "diffusion model", "reinforcement learning", "embedding", "inference",
      "fine-tun", "backpropagation", "gradient descent", "attention mechanism", "tokeniz", "chatbot", "ai agent", "agentic",
      "computer vision", "speech recognition", "natural language", "classifier", "convolutional", "perceptron",
      "ai alignment", "interpretab", "lstm", "recurrent neural", "bayesian", "training data", "benchmark",
    ],
  },
  {
    id: "programming-languages",
    label: "Programming languages",
    interest: 1,
    terms: [
      "programming language", "compiler", "interpreter", "type system", "type checker", "type inference", "lambda",
      "lisp", "haskell", "ocaml", "rust", "zig", "golang", "python", "javascript", "typescript", "c++",
      "fortran", "cobol", "smalltalk", "prolog", "erlang", "elixir", "clojure", "forth", "assembly language",
      "webassembly", "wasm", "bytecode", "jit", "garbage collect", "borrow checker", "parser", "lexer",
      "syntax", "semantics", "monad", "functional programming", "object-oriented", "coroutine", "async",
      "llvm", "gcc", "repl", "dsl", "apl", "julia", "kotlin", "swift programming", "java", "ruby", "perl", "lua",
    ],
  },
  {
    id: "systems",
    label: "Systems & distributed computing",
    interest: 1,
    terms: [
      "operating system", "kernel", "linux", "unix", "bsd", "file system", "filesystem", "scheduler", "virtual memory",
      "distributed", "consensus", "raft", "paxos", "replication", "concurren", "lock-free", "multithread", "latency",
      "throughput", "network", "tcp", "udp", "dns", "bgp", "http", "protocol", "ebpf", "container", "virtualization",
      "hypervisor", "cache", "load balanc", "microservice", "io_uring", "syscall", "memory allocator", "posix",
      "real-time", "embedded", "firmware", "device driver", "web browser", "browser engine", "rendering engine",
      "layout engine", "javascript engine",
    ],
  },
  {
    id: "data",
    label: "Databases & data",
    interest: 0.95,
    terms: [
      "database", "sql", "postgres", "sqlite", "query", "b-tree", "lsm", "storage engine", "transaction",
      "acid transaction", "write-ahead", "key-value", "column store", "columnar", "olap", "oltp", "data structure", "hash table",
      "bloom filter", "compression", "crdt", "stream processing", "data warehouse", "vector database", "search engine",
    ],
  },
  {
    id: "security",
    label: "Security & cryptography",
    interest: 1,
    terms: [
      "security", "cryptograph", "encrypt", "cipher", "vulnerab", "exploit", "malware", "ransomware", "backdoor",
      "zero-day", "cve", "side-channel", "spectre", "meltdown", "rowhammer", "tls", "ssl", "certificate", "password",
      "authenticat", "hash function", "public-key", "rsa", "elliptic curve", "post-quantum", "privacy", "surveillance",
      "phishing", "fuzzing", "sandbox", "reverse engineer", "cyberattack", "botnet",
    ],
  },
  {
    id: "hardware",
    label: "Computer engineering",
    interest: 0.95,
    terms: [
      "cpu", "gpu", "processor", "microprocessor", "microcontroller", "risc-v", "risc", "aarch64", "x86", "instruction set",
      "fpga", "asic", "chip", "semiconductor", "transistor", "silicon", "circuit", "logic gate", "memory", "dram",
      "sram", "cache coherence", "simd", "vector unit", "motherboard", "oscilloscope", "soldering",
      "keyboard", "battery", "6502", "z80", "8086", "mainframe", "minicomputer", "punch card", "vacuum tube",
    ],
  },
  {
    id: "theory",
    label: "Theory of computation",
    interest: 1,
    terms: [
      "algorithm", "complexity", "np-complete", "np-hard", "p versus np", "turing", "automat", "computab", "decidab",
      "halting problem", "lambda calculus", "formal verification", "proof assistant", "coq", "lean prover", "isabelle",
      "model checking", "sorting algorithm", "graph theory", "shortest path", "dynamic programming", "information theory",
      "entropy", "kolmogorov", "randomized", "approximation", "cellular automat", "game of life",
    ],
  },
  {
    id: "mathematics",
    label: "Mathematics",
    interest: 0.95,
    terms: [
      "mathemat", "theorem", "conjecture", "proof", "lemma", "prime", "number theory", "algebra", "topolog",
      "geometr", "calculus", "matrix", "matrices", "linear algebra", "probabilit", "statistic", "combinator",
      "category theory", "set theory", "infinity", "fractal", "chaos", "differential equation", "fourier", "integral",
      "polynomial", "manifold", "knot", "riemann", "fermat", "euler", "gauss",
    ],
  },
  {
    id: "physics",
    label: "Physics",
    interest: 0.9,
    terms: [
      "physic", "quantum", "relativity", "gravit", "particle", "boson", "neutrino", "quark", "fusion", "fission",
      "nuclear", "thermodynam", "superconduct", "laser", "optic", "photon", "dark matter", "black hole", "cosmolog",
      "plasma", "magnet", "semiconductor physics", "condensed matter", "string theory", "entanglement", "qubit",
    ],
  },
  {
    id: "biology",
    label: "Biology & medicine",
    interest: 0.75,
    terms: [
      "biolog", "genetic", "genom", "gene editing", "gene therapy", "dna", "rna", "crispr", "protein", "enzyme", "cell biology", "stem cell", "neuron", "neuroscience",
      "brain", "evolution", "bacteri", "virus", "vaccine", "immun", "cancer", "drug", "clinical trial", "microbiome",
      "species", "fossil", "alphafold", "molecul",
    ],
  },
  {
    id: "space",
    label: "Space & astronomy",
    interest: 0.85,
    terms: [
      "spaceflight", "space station", "space probe", "space telescope", "nasa", "rocket", "orbit", "satellite", "spacecraft", "telescope", "astronom", "planet",
      "exoplanet", "asteroid", "comet", "lunar", "mars rover", "martian", "jupiter", "saturn", "galax", "supernova", "jwst", "hubble",
      "launch vehicle", "voyager",
    ],
  },
  {
    id: "open-source",
    label: "Open-source software",
    interest: 0.85,
    terms: [
      "open source", "open-source", "free software", "github", "gitlab", "license", "gpl", "mit license", "apache",
      "maintainer", "contributor", "git", "emacs", "vim", "gnu", "debian", "self-hosted", "package manager",
    ],
  },
  {
    id: "history",
    label: "History of technology",
    interest: 0.95,
    terms: [
      "history", "historical", "vintage", "retrocomputing", "invented", "invention", "pioneer", "archive",
      "museum", "ancient", "century", "obsolete", "forgotten", "bell labs", "xerox parc", "arpanet", "1950s", "1960s", "1970s", "1980s",
      "apollo", "enigma", "bletchley", "eniac", "digital equipment", "pdp", "commodore", "amiga", "atari", "symbolics",
    ],
  },
  {
    id: "startups",
    label: "Startups & industry",
    interest: 0.5,
    terms: [
      "startup", "founder", "venture capital", "acquisition", "ipo", "y combinator", "company", "business model",
      "revenue", "saas", "antitrust", "monopoly", "silicon valley",
    ],
  },
  {
    id: "philosophy",
    label: "Philosophy & ideas",
    interest: 0.8,
    terms: [
      "philosoph", "ethic", "consciousness", "epistemolog", "metaphysic", "logic", "paradox", "free will", "moral", "stoic", "thought experiment", "rationalis", "wittgenstein", "kant", "plato",
    ],
  },
  {
    id: "economics",
    label: "Economics",
    interest: 0.65,
    terms: [
      "econom", "market", "inflation", "monetary", "central bank", "game theory", "auction", "incentive", "trade",
      "currency", "bitcoin", "blockchain", "finance", "pricing",
    ],
  },
];

const DISCIPLINE_REGEX = new Map(DISCIPLINES.map((d) => [d.id, termRegex(d.terms)]));
export const DISCIPLINE_BY_ID = new Map(DISCIPLINES.map((d) => [d.id, d]));

/** Vocabulary of every discipline, for measuring how technical a text is. */
export const TECHNICAL_REGEX = termRegex([...new Set(DISCIPLINES.filter((d) => d.id !== "startups").flatMap((d) => d.terms))]);

export interface DisciplineScore {
  id: DisciplineId;
  label: string;
  score: number;
}

/**
 * Scores disciplines for weighted texts (e.g. title ×3, body ×1). Returns
 * disciplines with a positive score, strongest first.
 */
export function classifyDisciplines(texts: Array<{ text: string; weight: number }>): DisciplineScore[] {
  const scores: DisciplineScore[] = [];
  for (const discipline of DISCIPLINES) {
    const re = DISCIPLINE_REGEX.get(discipline.id)!;
    let score = 0;
    for (const { text, weight } of texts) if (text) score += countDistinct(re, text.toLowerCase()) * weight;
    if (score > 0) scores.push({ id: discipline.id, label: discipline.label, score });
  }
  return scores.sort((a, b) => b.score - a.score);
}

/** Distinct technical terms in a text (across all disciplines). */
export function technicalTermCount(text: string): number {
  return countDistinct(TECHNICAL_REGEX, text.toLowerCase());
}
