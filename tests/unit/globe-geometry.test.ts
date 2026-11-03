import { describe, expect, it } from "vitest";
import { apply, buildPieces, cellOf, dot, normalize, outlineDistance, PIECE_COUNT, seeded, type Vec3 } from "@/components/home/globe/geometry";
import { AXIS_GLOBE, globePose, glyphFor, MISSING } from "@/components/home/globe/design";

const pieces = buildPieces();

describe("puzzle globe geometry", () => {
  it("cuts the sphere into 54 pieces, each with four distinct neighbours that point back", () => {
    expect(pieces).toHaveLength(PIECE_COUNT);
    for (const piece of pieces) {
      expect(cellOf(piece.center)).toBe(piece.id);
      const neighbours = piece.edges.map((e) => e.neighbor);
      expect(new Set(neighbours).size).toBe(4);
      for (const id of neighbours) expect(pieces[id].edges.map((e) => e.neighbor)).toContain(piece.id);
    }
  });

  it("gives each shared edge one knob, owned by one side and cut from the other, on the same curve", () => {
    for (const piece of pieces) {
      for (const edge of piece.edges) {
        const twin = pieces[edge.neighbor].edges.find((e) => e.neighbor === piece.id)!;
        expect(Math.sign(twin.knobRadius)).toBe(-Math.sign(edge.knobRadius));
        expect(Math.abs(twin.knobRadius)).toBeCloseTo(Math.abs(edge.knobRadius), 9);
        expect(dot(twin.knob, edge.knob)).toBeCloseTo(1, 9);
        expect(dot(twin.tangent, edge.tangent)).toBeCloseTo(1, 9);
        expect(twin.wave).toBeCloseTo(-edge.wave, 9);
      }
    }
  });

  it("assigns every point of the sphere to exactly one piece", () => {
    const random = seeded(7);
    let checked = 0;
    for (let n = 0; n < 4000; n++) {
      const p = normalize([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1] as Vec3);
      const distances = pieces.map((piece) => outlineDistance(piece.edges, p));
      if (distances.some((d) => Math.abs(d) < 2e-3)) continue; // on a seam
      expect(distances.filter((d) => d < 0)).toHaveLength(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(3500);
  });

  it("rests like the reference: W facing the viewer, Ω to its left, the opening at the top", () => {
    const rest = globePose(0);
    const view = (id: number) => apply(rest, pieces[id].center);
    const [w, omega] = [18, 21].map((id) => {
      expect(glyphFor(id)).toBe(id === 18 ? "W" : "Ω");
      return view(id);
    });
    expect(w[2]).toBeGreaterThan(0.9);
    expect(omega[0]).toBeLessThan(w[0]);
    for (const id of MISSING) {
      expect(view(id)[1]).toBeGreaterThan(0.5);
      // Within 50° of the spin axis, so the opening stays at the top as the globe turns.
      expect(dot(pieces[id].center, normalize(AXIS_GLOBE))).toBeGreaterThan(Math.cos((50 * Math.PI) / 180));
    }
  });

  it("keeps the spin axis tilted, whatever the spin", () => {
    for (const spin of [0, 1, 2.5, 4]) {
      const axis = apply(globePose(spin), normalize(AXIS_GLOBE));
      expect(axis[0]).toBeLessThan(-0.2); // leans left
      expect(axis[2]).toBeGreaterThan(0.3); // tips towards the viewer
      expect(axis[1]).toBeCloseTo(apply(globePose(0), normalize(AXIS_GLOBE))[1], 9);
    }
  });
});
