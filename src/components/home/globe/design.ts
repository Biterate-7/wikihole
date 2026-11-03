/**
 * The puzzle globe's look, fitted to the Wikipedia puzzle globe: at rest the
 * globe is tipped towards the viewer and leans to the left, so you look into
 * the opening at its top, with Ω, W and И across the middle, 維 below and
 * ウィ on the rim of the opening.
 */
import { mul, poseMatrix, transpose, type Mat3, type Vec3 } from "./geometry";

const deg = (d: number) => (d * Math.PI) / 180;

/** Orientation of the pieces at rest (see poseMatrix), fitted to the reference. */
export const REST_POSE = { spin: deg(66), tilt: deg(46), roll: deg(31) };

/** The spin axis: leans left (roll) and tips its top towards the viewer (tilt), like a desk globe. */
export const AXIS = { tilt: deg(24), roll: deg(16) };

/** Fixed rotation that puts the pieces in their rest orientation relative to the spin axis. */
const BODY = mul(transpose(poseMatrix(0, AXIS.tilt, AXIS.roll)), poseMatrix(REST_POSE.spin, REST_POSE.tilt, REST_POSE.roll));

/** Globe → view rotation, turned `spin` radians about the tilted axis from rest. */
export const globePose = (spin: number): Mat3 => mul(poseMatrix(spin, AXIS.tilt, AXIS.roll), BODY);

/** The spin axis in globe space (BODYᵀ · y). */
export const AXIS_GLOBE: Vec3 = [BODY[3], BODY[4], BODY[5]];

/**
 * The opening: the pieces around the top of the spin axis, so it stays at the
 * top as the globe turns. Seen at rest, the near ones open the hole and the far
 * ones let the sky show through above the far inside wall.
 */
export const MISSING = new Set([22, 20, 23, 6, 7, 8]);

/** Glyphs for the pieces seen at the rest pose, by piece id. Each is a script's "W" or "Wi". */
const FRONT_GLYPHS: Record<number, string> = {
  21: "Ω", // Greek
  18: "W", // Latin
  17: "И", // Cyrillic
  16: "維", // Chinese
  19: "ウィ", // Japanese
  44: "Ꮻ", // Cherokee
  43: "و", // Arabic
  40: "위", // Korean
  14: "ו", // Hebrew
  39: "ვ", // Georgian
  42: "Ж", // Cyrillic
  11: "Վ", // Armenian
  53: "वि", // Devanagari
  24: "ವಿ", // Kannada
  25: "வி", // Tamil
  26: "વિ", // Gujarati
  15: "ว", // Thai
  12: "ዊ", // Ethiopic
  13: "ཝི", // Tibetan
  10: "ওয়", // Bengali
  36: "ש", // Hebrew
  52: "λ", // Greek
};

/** The far side, revealed as the globe turns. */
const BACK_GLYPHS = [
  "Ж", "ש", "ع", "λ", "字", "の", "Ψ", "한", "Я", "ف", "ת", "Φ", "語", "ン", "ღ", "Ա",
  "ক", "ગ", "ம", "ས", "ሀ", "Σ", "ب", "Д", "文", "カ", "ד", "Ü", "ñ", "ß", "ء", "Ђ", "ζ",
];

/** Glyph per piece id (undefined for missing pieces). */
export function glyphFor(id: number): string | undefined {
  if (MISSING.has(id)) return undefined;
  return FRONT_GLYPHS[id] ?? BACK_GLYPHS[id % BACK_GLYPHS.length];
}

/** Lighting, in view space: a soft studio key from the upper left, in front. */
export const LIGHT: Vec3 = [-0.62, 0.5, 0.6];
