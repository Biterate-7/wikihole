/**
 * WikiHole's topic taxonomy. Each subtopic is defined by real Wikipedia
 * categories (validated against the live API by tests/live/topics.test.ts).
 * Candidates are drawn from these categories with randomised CirrusSearch
 * queries, so topics are working filters rather than labels.
 */

export type GroupId =
  | "computer-science"
  | "mathematics"
  | "physics"
  | "engineering"
  | "biology"
  | "economics"
  | "curiosities";

export interface Subtopic {
  slug: string;
  label: string;
  /** Wikipedia category names (without the "Category:" prefix). */
  categories: string[];
}

export interface TopicGroup {
  id: GroupId;
  label: string;
  blurb: string;
  subtopics: string[];
}

export const SUBTOPICS: Record<string, Subtopic> = {
  // Computer science
  algorithms: {
    slug: "algorithms",
    label: "Algorithms",
    categories: [
      "Graph algorithms",
      "Sorting algorithms",
      "Search algorithms",
      "Randomized algorithms",
      "Approximation algorithms",
      "Online algorithms",
      "Probabilistic data structures",
      "String matching algorithms",
    ],
  },
  "distributed-systems": {
    slug: "distributed-systems",
    label: "Distributed systems",
    categories: [
      "Distributed computing problems",
      "Distributed algorithms",
      "Fault-tolerant computer systems",
      "Distributed data storage",
      "Concurrency control",
      "Fault tolerance",
      "Distributed computing architecture",
    ],
  },
  "operating-systems": {
    slug: "operating-systems",
    label: "Operating systems",
    categories: [
      "Operating system technology",
      "Operating system kernels",
      "Memory management",
      "Processor scheduling algorithms",
      "Computer file systems",
      "Virtual memory",
      "Inter-process communication",
    ],
  },
  "programming-languages": {
    slug: "programming-languages",
    label: "Programming languages",
    categories: [
      "Programming language concepts",
      "Programming language theory",
      "Type theory",
      "Type systems",
      "Esoteric programming languages",
      "Compiler optimizations",
      "Lambda calculus",
      "Parsing algorithms",
    ],
  },
  "computational-complexity": {
    slug: "computational-complexity",
    label: "Computational complexity",
    categories: [
      "Computational complexity theory",
      "Complexity classes",
      "NP-complete problems",
      "Computational hardness assumptions",
      "Undecidable problems",
      "Computability theory",
      "Circuit complexity",
    ],
  },
  cryptography: {
    slug: "cryptography",
    label: "Cryptography",
    categories: [
      "Cryptographic algorithms",
      "Cryptographic primitives",
      "Cryptographic attacks",
      "Cryptographic protocols",
      "Classical ciphers",
      "Post-quantum cryptography",
      "Side-channel attacks",
      "History of cryptography",
    ],
  },
  "computer-architecture": {
    slug: "computer-architecture",
    label: "Computer architecture",
    categories: [
      "Computer architecture",
      "Instruction processing",
      "Cache (computing)",
      "Instruction set architectures",
      "Parallel computing",
      "Computer arithmetic",
    ],
  },
  "artificial-intelligence": {
    slug: "artificial-intelligence",
    label: "Artificial intelligence",
    categories: [
      "Machine learning algorithms",
      "Artificial neural networks",
      "Unsupervised learning",
      "Reinforcement learning",
      "Knowledge representation",
      "Automated theorem proving",
      "Philosophy of artificial intelligence",
      "History of artificial intelligence",
    ],
  },
  "information-theory": {
    slug: "information-theory",
    label: "Information theory",
    categories: [
      "Information theory",
      "Coding theory",
      "Data compression",
      "Error detection and correction",
      "Entropy and information",
      "Lossless compression algorithms",
    ],
  },

  // Mathematics
  "number-theory": {
    slug: "number-theory",
    label: "Number theory",
    categories: [
      "Analytic number theory",
      "Algebraic number theory",
      "Conjectures about prime numbers",
      "Diophantine equations",
      "Theorems in number theory",
      "Unsolved problems in number theory",
      "Modular arithmetic",
      "Additive number theory",
    ],
  },
  "abstract-algebra": {
    slug: "abstract-algebra",
    label: "Abstract algebra",
    categories: [
      "Abstract algebra",
      "Group theory",
      "Ring theory",
      "Category theory",
      "Lie groups",
      "Representation theory",
      "Homological algebra",
      "Theorems in abstract algebra",
    ],
  },
  topology: {
    slug: "topology",
    label: "Topology",
    categories: [
      "General topology",
      "Algebraic topology",
      "Knot theory",
      "Differential topology",
      "Geometric topology",
      "Theorems in topology",
      "Low-dimensional topology",
    ],
  },
  "set-theory": {
    slug: "set-theory",
    label: "Set theory",
    categories: [
      "Set theory",
      "Large cardinals",
      "Axioms of set theory",
      "Forcing (mathematics)",
      "Cardinal numbers",
      "Ordinal numbers",
      "Paradoxes of naive set theory",
      "Paradoxes of set theory",
    ],
  },
  "mathematical-logic": {
    slug: "mathematical-logic",
    label: "Mathematical logic",
    categories: [
      "Mathematical logic",
      "Model theory",
      "Proof theory",
      "Metatheorems",
      "Theorems in the foundations of mathematics",
      "Logical paradoxes",
      "Systems of formal logic",
    ],
  },
  probability: {
    slug: "probability",
    label: "Probability",
    categories: [
      "Probability theory",
      "Stochastic processes",
      "Probability theory paradoxes",
      "Martingale theory",
      "Random graphs",
      "Statistical paradoxes",
      "Markov processes",
      "Theorems in probability theory",
    ],
  },
  "game-theory": {
    slug: "game-theory",
    label: "Game theory",
    categories: [
      "Game theory",
      "Game theory game classes",
      "Non-cooperative games",
      "Cooperative games",
      "Combinatorial game theory",
      "Game theory equilibrium concepts",
    ],
  },

  // Physics
  "quantum-mechanics": {
    slug: "quantum-mechanics",
    label: "Quantum mechanics",
    categories: [
      "Quantum mechanics",
      "Quantum measurement",
      "Quantum information science",
      "Interpretations of quantum mechanics",
      "Quantum field theory",
      "Thought experiments in quantum mechanics",
      "Quantum phases",
    ],
  },
  thermodynamics: {
    slug: "thermodynamics",
    label: "Thermodynamics",
    categories: [
      "Thermodynamics",
      "Thermodynamic entropy",
      "Laws of thermodynamics",
      "Thermodynamic cycles",
      "Non-equilibrium thermodynamics",
      "Thermodynamic processes",
    ],
  },
  "particle-physics": {
    slug: "particle-physics",
    label: "Particle physics",
    categories: [
      "Particle physics",
      "Hypothetical particles",
      "Physics beyond the Standard Model",
      "Experimental particle physics",
      "Quantum chromodynamics",
      "Neutrinos",
      "Particle detectors",
    ],
  },
  relativity: {
    slug: "relativity",
    label: "Relativity",
    categories: [
      "Theory of relativity",
      "Special relativity",
      "General relativity",
      "Exact solutions in general relativity",
      "Black holes",
      "Tests of general relativity",
      "Wormhole theory",
    ],
  },
  cosmology: {
    slug: "cosmology",
    label: "Cosmology",
    categories: [
      "Physical cosmology",
      "Dark matter",
      "Dark energy",
      "Cosmic inflation",
      "Large-scale structure of the cosmos",
      "Ultimate fate of the universe",
    ],
  },
  "statistical-mechanics": {
    slug: "statistical-mechanics",
    label: "Statistical mechanics",
    categories: [
      "Statistical mechanics",
      "Lattice models",
      "Phase transitions",
      "Critical phenomena",
      "Exactly solvable models",
      "Spin models",
    ],
  },

  // Engineering
  aerospace: {
    slug: "aerospace",
    label: "Aerospace",
    categories: [
      "Aerospace engineering",
      "Spacecraft propulsion",
      "Rocket engines",
      "Astrodynamics",
      "Aerodynamics",
      "Orbital maneuvers",
      "Experimental aircraft",
    ],
  },
  "electrical-engineering": {
    slug: "electrical-engineering",
    label: "Electrical engineering",
    categories: [
      "Electronic circuits",
      "Signal processing",
      "Electronic oscillators",
      "Digital electronics",
      "Analog circuits",
      "Electrical phenomena",
      "Power electronics",
    ],
  },
  robotics: {
    slug: "robotics",
    label: "Robotics",
    categories: ["Robotics", "Robot kinematics", "Robotics engineering", "Robot control", "Robot navigation", "Robotic manipulation"],
  },
  "control-theory": {
    slug: "control-theory",
    label: "Control theory",
    categories: ["Control theory", "Cybernetics", "Systems theory", "Nonlinear control", "Control engineering", "Feedback"],
  },
  "materials-science": {
    slug: "materials-science",
    label: "Materials science",
    categories: [
      "Materials science",
      "Metamaterials",
      "Superconductivity",
      "Crystallography",
      "Smart materials",
      "Composite materials",
      "Allotropes of carbon",
    ],
  },

  // Biology
  neuroscience: {
    slug: "neuroscience",
    label: "Neuroscience",
    categories: [
      "Cellular neuroscience",
      "Computational neuroscience",
      "Neural coding",
      "Neurophysiology",
      "Neuroplasticity",
      "Cognitive neuroscience",
      "Unsolved problems in neuroscience",
    ],
  },
  genetics: {
    slug: "genetics",
    label: "Genetics",
    categories: [
      "Population genetics",
      "Epigenetics",
      "Molecular genetics",
      "Gene expression",
      "Genetic engineering",
      "Genetics concepts",
      "Mutation",
    ],
  },
  evolution: {
    slug: "evolution",
    label: "Evolution",
    categories: [
      "Evolutionary biology",
      "Evolutionary biology concepts",
      "Speciation",
      "Evolutionary developmental biology",
      "Sexual selection",
      "Evolutionary dynamics",
    ],
  },
  "molecular-biology": {
    slug: "molecular-biology",
    label: "Molecular biology",
    categories: [
      "Molecular biology",
      "Protein structure",
      "DNA replication",
      "Protein folding",
      "Molecular biology techniques",
      "Enzyme kinetics",
    ],
  },
  "systems-biology": {
    slug: "systems-biology",
    label: "Systems biology",
    categories: [
      "Systems biology",
      "Bioinformatics",
      "Mathematical and theoretical biology",
      "Metabolic pathways",
      "Computational biology",
    ],
  },

  // Economics
  "mechanism-design": {
    slug: "mechanism-design",
    label: "Mechanism design",
    categories: ["Mechanism design", "Auction theory", "Voting theory", "Social choice theory", "Fair division"],
  },
  "monetary-economics": {
    slug: "monetary-economics",
    label: "Monetary economics",
    categories: ["Monetary economics", "Monetary policy", "Monetary reform", "Inflation", "Hyperinflation", "Currency unions", "Economic bubbles"],
  },
  "behavioral-economics": {
    slug: "behavioral-economics",
    label: "Behavioral economics",
    categories: ["Behavioral economics", "Cognitive biases", "Behavioral finance", "Decision theory", "Prospect theory"],
  },
  "complexity-economics": {
    slug: "complexity-economics",
    label: "Complexity economics",
    categories: ["Complex systems theory", "Agent-based model", "Self-organization", "Network theory", "Emergence", "Chaos theory", "Systems science"],
  },

  // Curiosities
  paradoxes: {
    slug: "paradoxes",
    label: "Paradoxes",
    categories: [
      "Physical paradoxes",
      "Mathematical paradoxes",
      "Probability theory paradoxes",
      "Self-referential paradoxes",
      "Paradoxes in economics",
      "Logical paradoxes",
    ],
  },
  "unsolved-problems": {
    slug: "unsolved-problems",
    label: "Unsolved problems",
    categories: [
      "Unsolved problems in physics",
      "Unsolved problems in mathematics",
      "Unsolved problems in computer science",
      "Unsolved problems in neuroscience",
      "Unsolved problems in biology",
      "Conjectures",
    ],
  },
  "lost-technology": {
    slug: "lost-technology",
    label: "Forgotten machines",
    categories: [
      "Mechanical calculators",
      "Early computers",
      "Analog computers",
      "One-of-a-kind computers",
      "Vacuum tube computers",
      "History of computing hardware",
    ],
  },
  "thought-experiments": {
    slug: "thought-experiments",
    label: "Thought experiments",
    categories: [
      "Thought experiments",
      "Thought experiments in physics",
      "Thought experiments in quantum mechanics",
      "Hypothetical technology",
    ],
  },
};

export const GROUPS: TopicGroup[] = [
  {
    id: "computer-science",
    label: "Computer Science",
    blurb: "Computation, its limits, and the machinery built on it.",
    subtopics: [
      "algorithms",
      "distributed-systems",
      "operating-systems",
      "programming-languages",
      "computational-complexity",
      "cryptography",
      "computer-architecture",
      "artificial-intelligence",
      "information-theory",
    ],
  },
  {
    id: "mathematics",
    label: "Mathematics",
    blurb: "Structures, proofs, and the strange objects they admit.",
    subtopics: [
      "number-theory",
      "abstract-algebra",
      "topology",
      "set-theory",
      "mathematical-logic",
      "probability",
      "game-theory",
    ],
  },
  {
    id: "physics",
    label: "Physics",
    blurb: "From the smallest scales to the fate of the universe.",
    subtopics: [
      "quantum-mechanics",
      "thermodynamics",
      "particle-physics",
      "relativity",
      "cosmology",
      "statistical-mechanics",
    ],
  },
  {
    id: "engineering",
    label: "Engineering",
    blurb: "Theory made physical: control, flight, circuits, materials.",
    subtopics: ["aerospace", "electrical-engineering", "robotics", "control-theory", "materials-science"],
  },
  {
    id: "biology",
    label: "Biology",
    blurb: "Living systems as information-processing machines.",
    subtopics: ["neuroscience", "genetics", "evolution", "molecular-biology", "systems-biology"],
  },
  {
    id: "economics",
    label: "Economics",
    blurb: "Incentives, equilibria, and emergent markets.",
    subtopics: ["mechanism-design", "game-theory", "monetary-economics", "behavioral-economics", "complexity-economics"],
  },
  {
    id: "curiosities",
    label: "Curiosities",
    blurb: "Paradoxes, open problems, and machines history forgot.",
    subtopics: ["paradoxes", "unsolved-problems", "lost-technology", "thought-experiments"],
  },
];

export type TopicSlug = string;

export interface ResolvedTopic {
  slug: string;
  label: string;
  kind: "group" | "subtopic";
  group?: TopicGroup;
  subtopics: Subtopic[];
}

export function getGroup(id: string): TopicGroup | undefined {
  return GROUPS.find((g) => g.id === id);
}

/** Groups that list a subtopic (game theory is shared by two). */
export function groupsForSubtopic(slug: string): TopicGroup[] {
  return GROUPS.filter((g) => g.subtopics.includes(slug));
}

export function resolveTopic(slug: string | null | undefined): ResolvedTopic | null {
  if (!slug) return null;
  const group = getGroup(slug);
  if (group) {
    return {
      slug,
      label: group.label,
      kind: "group",
      group,
      subtopics: group.subtopics.map((s) => SUBTOPICS[s]).filter(Boolean),
    };
  }
  const sub = SUBTOPICS[slug];
  if (sub) return { slug, label: sub.label, kind: "subtopic", group: groupsForSubtopic(slug)[0], subtopics: [sub] };
  return null;
}

export function allSubtopics(): Subtopic[] {
  return Object.values(SUBTOPICS);
}

export function isTopicSlug(slug: string): boolean {
  return resolveTopic(slug) !== null;
}
