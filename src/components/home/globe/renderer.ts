/**
 * WebGL2 renderer for the puzzle globe. A full-screen fragment shader ray
 * traces a hollow shell (outer radius 1, a few percent thick) seen through a
 * perspective camera. Every hit is classified into its jigsaw piece from the
 * per-piece data texture, so seams, bevels, knobs, glyphs, the missing pieces
 * and the walls and interior seen through them all come from the same
 * geometry, and all of it turns with the globe.
 */
import { add, buildPieces, cross, dot, FILLET, normalize, PIECE_COUNT, type Vec3 } from "./geometry";
import { AXIS_GLOBE, globePose, glyphFor, LIGHT, MISSING } from "./design";

const DATA_WIDTH = 16;
const ATLAS_GRID = 8;
const ATLAS_CELL = 128;
/** Half-size of a glyph's box in tangent-plane units (a piece spans ~0.52), at most and at least. */
const GLYPH_HALF = 0.16;
const GLYPH_HALF_MIN = 0.135;
const CAMERA_DISTANCE = 10;

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vNdc;
out vec4 outColor;

uniform highp sampler2D uData;
uniform sampler2D uGlyphs;
uniform mat3 uPose;     // globe -> view
uniform float uTanHalf;
uniform float uDist;
uniform float uPx;      // one device pixel, in NDC units
uniform vec3 uLight;

const float QUARTER = 0.78539816;
const float INNER = 0.945;    // inner radius of the shell
const float BEVEL = 0.014;    // width of the rounded piece edges
const float FILLET = ${FILLET.toFixed(4)}; // knob neck rounding
const float ATLAS = ${ATLAS_GRID}.0;

const vec3 FN[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
const vec3 FU[6] = vec3[6](vec3(0,0,-1), vec3(0,0,1), vec3(1,0,0), vec3(1,0,0), vec3(1,0,0), vec3(-1,0,0));
const vec3 FV[6] = vec3[6](vec3(0,1,0), vec3(0,1,0), vec3(0,0,-1), vec3(0,0,1), vec3(0,1,0), vec3(0,1,0));

vec4 D(int id, int k) { return texelFetch(uData, ivec2(k, id), 0); }

int cellOf(vec3 p) {
  vec3 a = abs(p);
  int f = a.x >= a.y && a.x >= a.z ? (p.x > 0.0 ? 0 : 1) : a.y >= a.z ? (p.y > 0.0 ? 2 : 3) : (p.z > 0.0 ? 4 : 5);
  float depth = dot(p, FN[f]);
  int i = clamp(int(floor((atan(dot(p, FU[f]) / depth) / QUARTER + 1.0) * 1.5)), 0, 2);
  int j = clamp(int(floor((atan(dot(p, FV[f]) / depth) / QUARTER + 1.0) * 1.5)), 0, 2);
  return f * 9 + j * 3 + i;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Signed distance from unit direction p to piece id's outline (negative inside).
// across: the edge whose neighbour owns p when the distance is positive.
float pieceSdf(int id, vec3 p, out int across) {
  float d = -1e3;
  across = 0;
  for (int k = 0; k < 4; k++) {
    vec4 e = D(id, 1 + k);
    vec4 t = D(id, 5 + k);
    float dk = dot(p, e.xyz) + e.w * sin(6.2831853 * clamp(dot(p, t.xyz) / t.w, -0.5, 0.5));
    if (dk > d) { d = dk; across = k; }
  }
  float nearest = FILLET;
  for (int k = 0; k < 4; k++) {
    vec4 kn = D(id, 9 + k);
    float dk = length(p - kn.xyz) - abs(kn.w);
    if (kn.w > 0.0) d = smin(d, dk, FILLET);
    else {
      d = -smin(-d, dk, FILLET);
      if (dk < nearest) { nearest = dk; across = k; }
    }
  }
  return d;
}

float sdfOf(int id, vec3 p) { int k; return pieceSdf(id, p, k); }

// The piece that owns direction p, and the distance to its outline (<= 0).
int ownerOf(vec3 p, out float d) {
  int id = cellOf(p);
  int k;
  d = pieceSdf(id, p, k);
  if (d > 0.0) {
    id = int(D(id, 13)[k]);
    d = sdfOf(id, p);
  }
  d = -abs(d);
  return id;
}

// Tangent-plane gradient of the piece's distance field: points out of the piece.
vec3 outlineGradient(int id, vec3 p, float d) {
  vec3 t1 = normalize(cross(p, abs(p.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  vec3 t2 = cross(p, t1);
  const float E = 0.0015;
  float d1 = sdfOf(id, normalize(p + t1 * E));
  float d2 = sdfOf(id, normalize(p + t2 * E));
  vec3 g = (t1 * (d1 - d) + t2 * (d2 - d)) / E;
  float len = length(g);
  return len > 1e-4 ? g / len : t1;
}

bool sphere(vec3 ro, vec3 rd, float r, out float t0, out float t1) {
  float b = dot(ro, rd);
  float h = b * b - dot(ro, ro) + r * r;
  if (h < 0.0) return false;
  h = sqrt(h);
  t0 = -b - h;
  t1 = -b + h;
  return true;
}

float lit(vec3 nView, vec3 viewDir, float albedo, float ambient) {
  float ndl = dot(nView, uLight);
  float diffuse = clamp((ndl + 0.15) / 1.15, 0.0, 1.0);
  float spec = pow(max(dot(reflect(-uLight, nView), viewDir), 0.0), 18.0);
  return albedo * (ambient + (1.0 - ambient) * 1.1 * diffuse) + 0.05 * spec;
}

vec3 grey(float v) { return vec3(v, v, v * 1.008); }

// Outer surface of a present piece.
vec3 shadeOuter(vec3 p, int id, float d, vec3 viewDir) {
  vec4 info = D(id, 0);
  float s = -d;
  vec3 g = outlineGradient(id, p, d);
  float x = clamp(1.0 - s / BEVEL, 0.0, 1.0);
  vec3 n = normalize(p + g * (0.75 * x * x));
  vec3 nView = uPose * n;

  float albedo = info.y;
  if (info.x >= 0.0) {
    vec3 G = D(id, 14).xyz;
    vec3 east = D(id, 15).xyz;
    vec3 north = cross(G, east);
    vec3 q = p / dot(p, G);
    vec2 uv = vec2(dot(q, east), dot(q, north)) / (2.0 * info.w) + 0.5;
    if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
      float cell = info.x;
      vec2 origin = vec2(mod(cell, ATLAS), floor(cell / ATLAS));
      vec2 auv = (origin + vec2(uv.x, 1.0 - uv.y)) / ATLAS;
      float foreshorten = max(dot(nView, viewDir), 0.15);
      float lod = log2(max(1.0, ${ATLAS_CELL}.0 * uPx / (2.0 * info.w) / foreshorten));
      float ink = textureLod(uGlyphs, auv, lod).a;
      albedo = mix(albedo, 0.1, ink * 0.97);
    }
  }

  float ao = mix(0.88, 1.0, smoothstep(0.0, BEVEL * 1.4, s));
  float v = lit(nView, viewDir, albedo, 0.26) * ao;
  float seam = 1.0 - smoothstep(0.0, uPx * 1.1, s);
  v = mix(v, v * 0.66, seam);
  return grey(v);
}

// Side wall of a present piece, seen through a gap: faces out of the piece.
// Walls on the far side are inside the ball, in its shadow.
vec3 shadeWall(vec3 q, int id, float d, vec3 viewDir, bool far) {
  vec3 u = normalize(q);
  vec3 nView = uPose * outlineGradient(id, u, d);
  float depth = clamp((1.0 - length(q)) / (1.0 - INNER), 0.0, 1.0);
  float v = lit(nView, viewDir, D(id, 0).y * 0.92, 0.42) * mix(1.0, 0.72, depth);
  return grey(far ? 0.3 + 0.25 * v : v);
}

// Inside face of a piece on the far side of the opening.
vec3 shadeInner(vec3 q, int id, float d, vec3 viewDir) {
  vec3 nView = uPose * -normalize(q);
  float v = 0.34 + 0.12 * clamp(dot(nView, uLight) * 0.5 + 0.5, 0.0, 1.0);
  float s = -d;
  v *= mix(0.8, 1.0, smoothstep(0.0, uPx * 2.0, s));
  return grey(v);
}

// First present piece along the ray between t0 and t1 inside the shell; returns its wall colour.
bool marchShell(vec3 ro, vec3 rd, float t0, float t1, vec3 viewDir, bool far, out vec3 colour) {
  const int STEPS = 14;
  float prev = t0;
  for (int i = 1; i <= STEPS; i++) {
    float t = mix(t0, t1, float(i) / float(STEPS));
    vec3 q = ro + rd * t;
    float d;
    int id = ownerOf(normalize(q), d);
    if (D(id, 0).z < 0.5) {
      float lo = prev, hi = t;
      for (int k = 0; k < 5; k++) {
        float mid = 0.5 * (lo + hi);
        float dm;
        int im = ownerOf(normalize(ro + rd * mid), dm);
        if (D(im, 0).z < 0.5) { hi = mid; id = im; d = dm; } else lo = mid;
      }
      colour = shadeWall(ro + rd * hi, id, d, viewDir, far);
      return true;
    }
    prev = t;
  }
  return false;
}

vec4 trace(vec2 ndc) {
  vec3 roV = vec3(0.0, 0.0, uDist);
  vec3 rdV = normalize(vec3(ndc * uTanHalf, -1.0));
  mat3 toGlobe = transpose(uPose);
  vec3 ro = toGlobe * roV;
  vec3 rd = toGlobe * rdV;
  vec3 viewDir = -rdV;

  float o0, o1;
  if (!sphere(ro, rd, 1.0, o0, o1)) return vec4(0.0);
  vec3 p = normalize(ro + rd * o0);
  float d;
  int id = ownerOf(p, d);
  if (D(id, 0).z < 0.5) return vec4(shadeOuter(p, id, d, viewDir), 1.0);

  // Through the opening: front walls, then the far inside, then the far walls.
  vec3 colour;
  float i0, i1;
  bool inner = sphere(ro, rd, INNER, i0, i1);
  if (marchShell(ro, rd, o0, inner ? i0 : o1, viewDir, false, colour)) return vec4(colour, 1.0);
  if (!inner) return vec4(0.0);
  vec3 q = ro + rd * i1;
  id = ownerOf(normalize(q), d);
  if (D(id, 0).z < 0.5) return vec4(shadeInner(q, id, d, viewDir), 1.0);
  if (marchShell(ro, rd, i1, o1, viewDir, true, colour)) return vec4(colour, 1.0);
  return vec4(0.0);
}

void main() {
  // 2 x 2 supersampling; colours are premultiplied for the transparent canvas.
  vec4 sum = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 offset = (vec2(float(k & 1), float(k >> 1)) - 0.5) * 0.5 * uPx;
    vec4 c = trace(vNdc + offset);
    sum += vec4(c.rgb * c.a, c.a);
  }
  outColor = sum * 0.25;
}`;

/* ---------------------------------------------------------------------- */
/* Data                                                                    */
/* ---------------------------------------------------------------------- */

/** Per-piece rows for the shader: info, edge planes, tangents, knobs, neighbours, glyph frame. */
function pieceData(glyphSlots: Map<string, number>): Float32Array {
  const data = new Float32Array(DATA_WIDTH * PIECE_COUNT * 4);
  // Glyphs facing the viewer at rest lean towards screen-up; the rest follow
  // the spin axis, so every glyph is the right way up when it turns to the front.
  const rest = globePose(0);
  const screenUp: Vec3 = [rest[3], rest[4], rest[5]]; // restᵀ · y
  const towardsViewer: Vec3 = [rest[6], rest[7], rest[8]]; // restᵀ · z

  for (const piece of buildPieces()) {
    const row = piece.id * DATA_WIDTH * 4;
    const put = (k: number, v: [number, number, number, number]) => data.set(v, row + k * 4);
    const glyph = glyphFor(piece.id);
    // The glyph box fits inside the piece, clear of the knobs cut into it.
    const half = Math.min(GLYPH_HALF, Math.max(GLYPH_HALF_MIN, piece.inner.radius * 1.05));
    put(0, [glyph ? glyphSlots.get(glyph)! : -1, piece.tone, MISSING.has(piece.id) ? 1 : 0, half]);
    piece.edges.forEach((e, k) => {
      put(1 + k, [...e.normal, e.wave]);
      put(5 + k, [...e.tangent, e.length]);
      put(9 + k, [...e.knob, e.knobRadius]);
    });
    put(13, piece.edges.map((e) => e.neighbor) as [number, number, number, number]);
    const g = piece.inner.center;
    const up = add(AXIS_GLOBE, screenUp, Math.max(0, dot(g, towardsViewer)));
    let north = add(up, g, -dot(up, g));
    if (Math.hypot(...north) < 1e-3) north = [0, 0, 1];
    north = normalize(north);
    const east = normalize(cross(north, g));
    put(14, [...g, 0]);
    put(15, [...east, 0]);
  }
  return data;
}

const GLYPH_FONT = '"Linux Libertine O", "Linux Libertine", "Libertinus Serif", "Hoefler Text", Georgia, "Times New Roman", serif';

/** Draws every glyph into an 8 × 8 atlas, ink centred in its cell. */
function glyphAtlas(): { canvas: HTMLCanvasElement; slots: Map<string, number> } {
  const glyphs = new Set<string>();
  for (let id = 0; id < PIECE_COUNT; id++) {
    const glyph = glyphFor(id);
    if (glyph) glyphs.add(glyph);
  }
  const slots = new Map([...glyphs].map((g, i) => [g, i]));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS_GRID * ATLAS_CELL;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = ctx.strokeStyle = "#000";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const [glyph, slot] of slots) {
    let size = 104;
    ctx.font = `${size}px ${GLYPH_FONT}`;
    let m = ctx.measureText(glyph);
    // Dense square CJK glyphs read larger than alphabetic ones of the same box.
    const share = /[\u2e80-\u9fff\uac00-\ud7af]/u.test(glyph) ? 0.68 : 0.84;
    const fit = (ATLAS_CELL * share) / Math.max(m.actualBoundingBoxLeft + m.actualBoundingBoxRight, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, 1);
    if (fit < 1) {
      size *= fit;
      ctx.font = `${size}px ${GLYPH_FONT}`;
      m = ctx.measureText(glyph);
    }
    const cx = (slot % ATLAS_GRID) * ATLAS_CELL + ATLAS_CELL / 2;
    const cy = Math.floor(slot / ATLAS_GRID) * ATLAS_CELL + ATLAS_CELL / 2;
    const x = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const y = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(glyph, x, y);
    // A hairline of extra weight, like the printed glyphs on the reference globe.
    ctx.strokeText(glyph, x, y);
  }
  return { canvas, slots };
}

/* ---------------------------------------------------------------------- */
/* Renderer                                                                */
/* ---------------------------------------------------------------------- */

export interface GlobeRenderer {
  /** Draws the globe turned `spin` radians about its axis from the rest pose. */
  render(spin: number): void;
  /** Matches the drawing buffer to the canvas's CSS size. */
  resize(): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed to compile");
  return shader;
}

/** Returns null when WebGL2 (or float textures) are unavailable. */
export function createGlobeRenderer(canvas: HTMLCanvasElement): GlobeRenderer | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;

  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
  } catch (error) {
    console.warn("Puzzle globe: falling back to the static image.", error);
    return null;
  }
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const atlas = glyphAtlas();
  const dataTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, dataTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, DATA_WIDTH, PIECE_COUNT, 0, gl.RGBA, gl.FLOAT, pieceData(atlas.slots));

  const glyphTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, glyphTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(uniform("uData"), 0);
  gl.uniform1i(uniform("uGlyphs"), 1);
  gl.uniform1f(uniform("uDist"), CAMERA_DISTANCE);
  // Frame the sphere's silhouette edge to edge.
  gl.uniform1f(uniform("uTanHalf"), 1 / Math.sqrt(CAMERA_DISTANCE ** 2 - 1));
  gl.uniform3fv(uniform("uLight"), normalize(LIGHT));
  const uPose = uniform("uPose");
  const uPx = uniform("uPx");

  return {
    render(spin) {
      // Row-major, so transposed on upload.
      gl.uniformMatrix3fv(uPose, true, globePose(spin));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uPx, 2 / canvas.width);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.max(1, Math.round(canvas.clientWidth * ratio));
      if (canvas.width !== size || canvas.height !== size) canvas.width = canvas.height = size;
    },
    dispose() {
      gl.deleteTexture(dataTex);
      gl.deleteTexture(glyphTex);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
    },
  };
}
