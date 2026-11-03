/**
 * Generates public/wikihole-globe.svg: WikiHole's puzzle globe. A sphere of
 * interlocking jigsaw pieces (orthographic projection, lit from the upper
 * left) with two pieces missing at the top: the hole the name refers to.
 *
 *   node scripts/generate-globe.mjs
 *
 * Deterministic (seeded), so the output only changes when this file does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 220;
const R = 100;
const C = SIZE / 2;
const TILT = (24 * Math.PI) / 180; // north pole tipped towards the viewer
const SPIN = 18; // degrees of longitude facing the viewer
const LIGHT = normalize([-0.55, 0.62, 0.56]);

let seed = 20240607;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function normalize([x, y, z]) {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

const rad = (d) => (d * Math.PI) / 180;

/** Sphere point for (lon, lat) in degrees, rotated into view. */
function toView(lon, lat) {
  const l = rad(lon - SPIN);
  const p = rad(lat);
  const x = Math.cos(p) * Math.sin(l);
  const y = Math.sin(p);
  const z = Math.cos(p) * Math.cos(l);
  return [x, y * Math.cos(TILT) - z * Math.sin(TILT), y * Math.sin(TILT) + z * Math.cos(TILT)];
}

/** Screen point; back-facing points are pushed onto the limb so fills stay inside the disc. */
function project(lon, lat) {
  let [x, y, z] = toView(lon, lat);
  if (z < 0) {
    const r = Math.hypot(x, y) || 1;
    x /= r;
    y /= r;
  }
  return { X: C + R * x, Y: C - R * y, z };
}

/* ---------------------------------------------------------------------- */
/* Jigsaw edges                                                            */
/* ---------------------------------------------------------------------- */

// A classic tab in local edge coordinates: s along the edge (0..1), v outward.
const TAB = [
  [[0, 0], [0.3, 0], [0.43, -0.02], [0.42, 0.06]],
  [[0.42, 0.06], [0.41, 0.12], [0.33, 0.19], [0.39, 0.25]],
  [[0.39, 0.25], [0.45, 0.31], [0.55, 0.31], [0.61, 0.25]],
  [[0.61, 0.25], [0.67, 0.19], [0.59, 0.12], [0.58, 0.06]],
  [[0.58, 0.06], [0.57, -0.02], [0.7, 0], [1, 0]],
];

function bezier([a, b, c, d], t) {
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ];
}

/** Local (s, v) samples for one edge with its own tab size, position and direction. */
function tabProfile() {
  const shift = (random() - 0.5) * 0.12;
  const scale = 0.85 + random() * 0.3;
  const sign = random() < 0.5 ? -1 : 1;
  const points = [];
  TAB.forEach((segment, i) => {
    const steps = i === 0 || i === TAB.length - 1 ? 6 : 5;
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const [s, v] = bezier(segment, k / steps);
      const inner = s > 0 && s < 1;
      points.push([inner ? 0.5 + (s - 0.5) * scale + shift * Math.sin(Math.PI * s) : s, sign * v * scale]);
    }
  });
  return points;
}

/** Edge along a parallel (constant latitude) from lon0 to lon1. */
function parallelEdge(lat, lon0, lon1) {
  const span = Math.abs(lon1 - lon0) * Math.cos(rad(lat));
  return tabProfile().map(([s, v]) => [lon0 + s * (lon1 - lon0), lat + v * span]);
}

/** Edge along a meridian from lat0 to lat1. */
function meridianEdge(lon, lat0, lat1, { tab = true } = {}) {
  const span = Math.abs(lat1 - lat0);
  const profile = tab ? tabProfile() : [[0, 0], [0.25, 0], [0.5, 0], [0.75, 0], [1, 0]];
  return profile.map(([s, v]) => {
    const lat = lat0 + s * (lat1 - lat0);
    return [lon + (v * span) / Math.max(Math.cos(rad(lat)), 0.2), lat];
  });
}

/** Long straight stretches are densified so they follow the sphere's curvature. */
function densify(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const BANDS = [-90, -60, -30, 0, 30, 60, 90];
const STEP = 30;
const CAP_STEP = 60;

const parallels = new Map(); // `${lat}|${k}` → points (lon increasing)
for (const lat of [-60, -30, 0, 30, 60]) {
  for (let k = 0; k < 360 / STEP; k++) parallels.set(`${lat}|${k}`, densify(parallelEdge(lat, k * STEP, (k + 1) * STEP)));
}
const meridians = new Map(); // `${band}|${lon}` → points (lat increasing)
for (let b = 0; b < BANDS.length - 1; b++) {
  const [lo, hi] = [BANDS[b], BANDS[b + 1]];
  const cap = lo === -90 || hi === 90;
  const step = cap ? CAP_STEP : STEP;
  for (let lon = 0; lon < 360; lon += step) meridians.set(`${b}|${lon}`, densify(meridianEdge(lon, lo, hi)));
}

const reverse = (points) => [...points].reverse();

/* ---------------------------------------------------------------------- */
/* Pieces                                                                  */
/* ---------------------------------------------------------------------- */

const pieces = [];
for (let b = 0; b < BANDS.length - 1; b++) {
  const [lo, hi] = [BANDS[b], BANDS[b + 1]];
  const cap = lo === -90 || hi === 90;
  const step = cap ? CAP_STEP : STEP;
  for (let lon = 0; lon < 360; lon += step) {
    const next = lon + step;
    const ks = Array.from({ length: step / STEP }, (_, i) => lon / STEP + i);
    const outline = [];
    if (lo !== -90) for (const k of ks) outline.push(...parallels.get(`${lo}|${k}`));
    else outline.push([lon, -90], [next, -90]);
    outline.push(...meridians.get(`${b}|${next % 360}`).map(([x, y]) => [x + (next === 360 ? 360 : 0), y]));
    if (hi !== 90) for (const k of [...ks].reverse()) outline.push(...reverse(parallels.get(`${hi}|${k}`)));
    else outline.push([next, 90], [lon, 90]);
    outline.push(...reverse(meridians.get(`${b}|${lon}`)));
    pieces.push({ band: b, lon, lo, hi, outline, center: [lon + step / 2, (lo + hi) / 2 + (cap ? (hi === 90 ? 8 : -8) : 0)] });
  }
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

function pathOf(points) {
  return (
    points
      .map((p, i) => {
        const { X, Y } = project(p[0], p[1]);
        return `${i ? "L" : "M"}${fmt(X)} ${fmt(Y)}`;
      })
      .join("") + "Z"
  );
}

/** Visible runs of an open polyline (front hemisphere only). */
function visibleRuns(points) {
  const runs = [];
  let run = [];
  for (const p of points) {
    const q = project(p[0], p[1]);
    if (q.z > 0.02) run.push(q);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs.map((r) => r.map((q, i) => `${i ? "L" : "M"}${fmt(q.X)} ${fmt(q.Y)}`).join(""));
}

const isMissing = (p) => (p.hi === 90 && p.lon === 0) || (p.lo === 30 && p.lon === 30);

const fills = [];
const holes = [];
for (const piece of pieces) {
  const [x, y, z] = toView(piece.center[0], piece.center[1]);
  if (z < -0.25) continue;
  const d = pathOf(piece.outline);
  if (isMissing(piece)) {
    holes.push(d);
    continue;
  }
  const lambert = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
  const tone = Math.round(142 + lambert * 100 + (random() - 0.5) * 26);
  const grey = Math.max(96, Math.min(242, tone));
  fills.push(`<path d="${d}" fill="rgb(${grey},${grey},${grey + 2})"/>`);
}

const seams = [];
for (const points of [...parallels.values(), ...meridians.values()]) {
  for (const d of visibleRuns(points)) seams.push(d);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="WikiHole puzzle globe">
<defs>
<clipPath id="disc"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
<radialGradient id="shade" cx="38%" cy="30%" r="75%">
<stop offset="0" stop-color="#fff" stop-opacity=".22"/>
<stop offset=".45" stop-color="#fff" stop-opacity="0"/>
<stop offset=".82" stop-color="#0b0e11" stop-opacity=".28"/>
<stop offset="1" stop-color="#0b0e11" stop-opacity=".62"/>
</radialGradient>
<linearGradient id="depth" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0d1014"/>
<stop offset=".55" stop-color="#1d2126"/>
<stop offset="1" stop-color="#3a3f45"/>
</linearGradient>
</defs>
<g clip-path="url(#disc)">
<circle cx="${C}" cy="${C}" r="${R}" fill="#8d9298"/>
${fills.join("\n")}
<path d="${seams.join("")}" fill="none" stroke="#2b2f34" stroke-width=".85" stroke-linejoin="round" stroke-opacity=".9"/>
<circle cx="${C}" cy="${C}" r="${R}" fill="url(#shade)"/>
</g>
<g>
<path d="${holes.join("")}" fill="#c9ccd0" transform="translate(0 1.6)"/>
<path d="${holes.join("")}" fill="url(#depth)"/>
<path d="${holes.join("")}" fill="none" stroke="#3a3f45" stroke-width=".7"/>
</g>
<circle cx="${C}" cy="${C}" r="${R - 0.4}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".8"/>
</svg>
`;

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "wikihole-globe.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${fills.length} pieces)`);
