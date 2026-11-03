/**
 * Geometry of the puzzle globe: a unit sphere cut into 54 interlocking
 * jigsaw pieces (a cube-sphere, 3 × 3 pieces per face, equiangular so every
 * piece spans ~30° of arc). Each shared edge gets one knob, owned by one side
 * and cut out of the other, plus a gentle S-shaped wave so no two pieces are
 * alike. Everything is deterministic (seeded) and pure, so the shader data,
 * the pose search and the tests all see the same globe.
 *
 * Coordinates: globe space has the rotation axis on +Y. The pose matrix maps
 * globe space to view space (x right, y up, z towards the viewer).
 */

export type Vec3 = [number, number, number];
/** Row-major 3 × 3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const GRID = 3;
export const PIECE_COUNT = 6 * GRID * GRID;

/** Cube faces: outward normal n and the in-face axes u, v. */
export const FACES: { n: Vec3; u: Vec3; v: Vec3 }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

const QUARTER = Math.PI / 4;
/** Equiangular cell boundary k (0..GRID) as an angle from the face centre. */
const boundary = (k: number) => (-1 + (2 * k) / GRID) * QUARTER;

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

export function faceOf([x, y, z]: Vec3): number {
  const [ax, ay, az] = [Math.abs(x), Math.abs(y), Math.abs(z)];
  if (ax >= ay && ax >= az) return x > 0 ? 0 : 1;
  if (ay >= az) return y > 0 ? 2 : 3;
  return z > 0 ? 4 : 5;
}

/** Piece index (face * 9 + row * 3 + column) of the cell containing direction p. */
export function cellOf(p: Vec3): number {
  const face = faceOf(p);
  const { n, u, v } = FACES[face];
  const depth = dot(p, n);
  const cell = (axis: Vec3) => {
    const a = Math.atan(dot(p, axis) / depth) / QUARTER;
    return Math.min(GRID - 1, Math.max(0, Math.floor(((a + 1) * GRID) / 2)));
  };
  return face * GRID * GRID + cell(v) * GRID + cell(u);
}

/** Point on the sphere at equiangular face angles (a, b). */
function facePoint(face: number, a: number, b: number): Vec3 {
  const { n, u, v } = FACES[face];
  return normalize(add(add(n, u, Math.tan(a)), v, Math.tan(b)));
}

export interface Edge {
  /** Outward unit normal of the edge's great-circle plane (dot > 0 is outside this piece). */
  normal: Vec3;
  /** Canonical direction along the edge, identical from both sides. */
  tangent: Vec3;
  /** Signed S-wave amplitude, negated on the neighbouring side. */
  wave: number;
  /** Arc length of the edge. */
  length: number;
  /** Knob centre (unit vector). */
  knob: Vec3;
  /** Knob radius (chord); positive when this piece owns the knob, negative when it is cut out of it. */
  knobRadius: number;
  neighbor: number;
}

export interface Piece {
  id: number;
  face: number;
  center: Vec3;
  edges: Edge[];
  /** The point deepest inside the piece and its distance to the outline: where the glyph goes. */
  inner: { center: Vec3; radius: number };
  /** Albedo, 0..1: mostly white, a few light greys. */
  tone: number;
}

export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A direction that no edge is perpendicular to, used to orient tangents canonically. */
const CANON: Vec3 = normalize([0.31, 0.57, 0.76]);

export function buildPieces(seed = 20100513): Piece[] {
  const random = seeded(seed);
  const shared = new Map<string, KnobSpec>();
  let cells = cut(shared, random);
  // Small corner cells can get two knobs cut into them close enough to touch: shrink those knobs.
  for (let pass = 0; pass < 12; pass++) {
    const crowded = crowdedKnobs(cells);
    if (!crowded.size) break;
    for (const key of crowded) shared.get(key)!.radius *= 0.92;
    cells = cut(shared, random);
  }
  const shade = seeded(seed ^ 0x5eed);
  return cells.map((cell) => {
    const t = shade();
    return { ...cell, inner: deepestPoint(cell.edges, cell.center), tone: t < 0.12 ? 0.86 + shade() * 0.04 : 0.95 + t * 0.05 };
  });
}

interface KnobSpec {
  owner: number;
  shift: number;
  radius: number;
  wave: number;
}

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

function crowdedKnobs(cells: Pick<Piece, "id" | "edges">[]): Set<string> {
  const crowded = new Set<string>();
  for (const { id, edges } of cells) {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const [a, b] = [edges[i], edges[j]];
        const gap = Math.hypot(a.knob[0] - b.knob[0], a.knob[1] - b.knob[1], a.knob[2] - b.knob[2]);
        if (gap < Math.abs(a.knobRadius) + Math.abs(b.knobRadius) + 2 * FILLET) {
          crowded.add(edgeKey(id, a.neighbor));
          crowded.add(edgeKey(id, b.neighbor));
        }
      }
    }
  }
  return crowded;
}

/** Cuts the cells and their edges, drawing knob specs for edges not yet in `shared`. */
function cut(shared: Map<string, KnobSpec>, random: () => number) {
  const cells: Pick<Piece, "id" | "face" | "center" | "edges">[] = [];
  for (let face = 0; face < 6; face++) {
    const { n, u, v } = FACES[face];
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const id = face * GRID * GRID + j * GRID + i;
        const [a0, a1, b0, b1] = [boundary(i), boundary(i + 1), boundary(j), boundary(j + 1)];
        const [am, bm] = [(a0 + a1) / 2, (b0 + b1) / 2];
        // Each side: outward normal of its plane, plus its two end points.
        const plane = (axis: Vec3, angle: number, sign: number) =>
          scale(add(scale(axis, Math.cos(angle)), n, -Math.sin(angle)), sign);
        const sides: [Vec3, Vec3, Vec3][] = [
          [plane(u, a0, -1), facePoint(face, a0, b0), facePoint(face, a0, b1)],
          [plane(u, a1, 1), facePoint(face, a1, b0), facePoint(face, a1, b1)],
          [plane(v, b0, -1), facePoint(face, a0, b0), facePoint(face, a1, b0)],
          [plane(v, b1, 1), facePoint(face, a0, b1), facePoint(face, a1, b1)],
        ];
        const mids = [facePoint(face, a0, bm), facePoint(face, a1, bm), facePoint(face, am, b0), facePoint(face, am, b1)];

        const edges = sides.map(([normal, e0, e1], k): Edge => {
          const mid = mids[k];
          const neighbor = cellOf(normalize(add(mid, normal, 0.05)));
          const key = edgeKey(id, neighbor);
          let spec = shared.get(key);
          if (!spec) {
            spec = {
              owner: random() < 0.5 ? id : neighbor,
              shift: (random() - 0.5) * 0.16,
              radius: 0.19 + random() * 0.035,
              wave: (0.025 + random() * 0.03) * (random() < 0.5 ? -1 : 1),
            };
            shared.set(key, spec);
          }
          let tangent = normalize(cross(normal, mid));
          if (dot(tangent, CANON) < 0) tangent = scale(tangent, -1);
          const length = Math.acos(Math.min(1, dot(e0, e1)));
          const owns = spec.owner === id;
          const radius = spec.radius * length;
          // The knob sits past the edge on the receiving side; its neck is the chord where it crosses the edge.
          const outward = owns ? normal : scale(normal, -1);
          const knob = normalize(add(add(mid, tangent, spec.shift * length), outward, radius * 0.74));
          // The wave is defined relative to the lower id so both sides cut the same curve.
          const wave = (id < neighbor ? 1 : -1) * spec.wave * length;
          return { normal, tangent, wave, length, knob, knobRadius: owns ? radius : -radius, neighbor };
        });

        cells.push({ id, face, center: facePoint(face, am, bm), edges });
      }
    }
  }
  return cells;
}

/** Rounding of knob necks (chord units), shared with the shader. */
export const FILLET = 0.02;

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Signed distance from unit direction p to a piece's outline, negative inside; mirrors the shader. */
export function outlineDistance(edges: Edge[], p: Vec3): number {
  let d = -1e3;
  for (const e of edges) {
    // One S-wave along the edge, flat beyond its ends.
    const along = Math.min(0.5, Math.max(-0.5, dot(p, e.tangent) / e.length));
    d = Math.max(d, dot(p, e.normal) + e.wave * Math.sin(2 * Math.PI * along));
  }
  for (const e of edges) {
    const dk = Math.hypot(p[0] - e.knob[0], p[1] - e.knob[1], p[2] - e.knob[2]) - Math.abs(e.knobRadius);
    d = e.knobRadius > 0 ? smin(d, dk, FILLET) : -smin(-d, dk, FILLET);
  }
  return d;
}

/** Grid search near the cell centre for the most interior point, gently preferring the centre. */
function deepestPoint(edges: Edge[], center: Vec3) {
  const t1 = normalize(cross(center, Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const t2 = cross(center, t1);
  let best = { center, radius: -outlineDistance(edges, center), score: -Infinity };
  for (let x = -0.2; x <= 0.2; x += 0.01) {
    for (let y = -0.2; y <= 0.2; y += 0.01) {
      const p = normalize(add(add(center, t1, x), t2, y));
      const radius = -outlineDistance(edges, p);
      const score = radius - 0.25 * Math.hypot(x, y);
      if (score > best.score) best = { center: p, radius, score };
    }
  }
  return { center: best.center, radius: best.radius };
}

/* ---------------------------------------------------------------------- */
/* Pose                                                                    */
/* ---------------------------------------------------------------------- */

export const mul = (a: Mat3, b: Mat3): Mat3 => {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
};

/**
 * Globe → view rotation: spin about the globe's own axis, then tip the axis
 * towards the viewer (tilt) and lean it sideways (roll, counter-clockwise).
 * Spin happens innermost, so the axis stays tilted however the globe turns.
 */
export function poseMatrix(spin: number, tilt: number, roll: number): Mat3 {
  const [cs, ss, ct, st, cr, sr] = [Math.cos(spin), Math.sin(spin), Math.cos(tilt), Math.sin(tilt), Math.cos(roll), Math.sin(roll)];
  const ry: Mat3 = [cs, 0, ss, 0, 1, 0, -ss, 0, cs];
  const rx: Mat3 = [1, 0, 0, 0, ct, -st, 0, st, ct];
  const rz: Mat3 = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  return mul(rz, mul(rx, ry));
}

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const apply = (m: Mat3, p: Vec3): Vec3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];
